// Estruturas anatômicas: carregamento (GLB próprios + viewer_assets lite/full), materiais, fantasma, isolar, opacidade, corte.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { fetchBuf } from '../core/util.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// Khronos PBR Neutral: preserva as cores da legenda (sem desvio do vermelho para laranja como no ACES)
const NEUTRAL = /* glsl */ `
vec3 nfNeutral( vec3 color ) {
  const float startCompression = 0.8 - 0.04; const float desaturation = 0.15;
  float x = min( color.r, min( color.g, color.b ) ); float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max( color.r, max( color.g, color.b ) );
  if ( peak < startCompression ) return color;
  const float d = 1.0 - startCompression; float newPeak = 1.0 - d * d / ( peak + d - startCompression );
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / ( desaturation * ( peak - newPeak ) + 1.0 );
  return mix( color, vec3( newPeak ), g );
}`;
const ACES = /* glsl */ `
vec3 nfRRT( vec3 v ) { vec3 a = v * ( v + 0.0245786 ) - 0.000090537; vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081; return a / b; }
vec3 nfACES( vec3 color ) {
  const mat3 IM = mat3( vec3( 0.59719, 0.07600, 0.02840 ), vec3( 0.35458, 0.90834, 0.13383 ), vec3( 0.04823, 0.01566, 0.83777 ) );
  const mat3 OM = mat3( vec3( 1.60475, -0.10208, -0.00327 ), vec3( -0.53108, 1.10813, -0.07276 ), vec3( -0.07367, -0.00605, 1.07602 ) );
  color *= 1.05 / 0.6; color = IM * color; color = nfRRT( color ); color = OM * color; return clamp( color, 0.0, 1.0 );
}`;

export const HEAT = {
  bands: [
    { max: 2, color: '#ffe600', label: '< 2 mm' },
    { max: 5, color: '#ff8a00', label: '2–5 mm' },
    { max: 10, color: '#ffc2dc', label: '5–10 mm' },
    { max: Infinity, color: null, label: '> 10 mm (cor do tumor)' },
  ],
};
const heatUniforms = {
  uH0: { value: new THREE.Color(HEAT.bands[0].color) },
  uH1: { value: new THREE.Color(HEAT.bands[1].color) },
  uH2: { value: new THREE.Color(HEAT.bands[2].color) },
};

function patch(m, { heat = false, dash = false } = {}) {
  m.onBeforeCompile = (sh) => {
    if (dash) {
      // trajetória estimada: tracejado ao longo do eixo craniocaudal (mundo +Y), 6 mm de período
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vNfY;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvNfY = ( modelMatrix * vec4( transformed, 1.0 ) ).y;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vNfY;')
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif ( fract( vNfY / 6.0 ) > 0.55 ) discard;');
    }
    if (heat) {
      Object.assign(sh.uniforms, heatUniforms, m.userData.heat);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aDist;\nvarying float vDist;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDist = aDist;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vDist;\nuniform float uHeatOn;\nuniform vec3 uH0, uH1, uH2;')
        .replace('#include <color_fragment>', `#include <color_fragment>
if ( uHeatOn > 0.5 && vDist >= 0.0 ) {
  float d = vDist; vec3 c = diffuseColor.rgb;
  if ( d < 2.0 ) c = uH0; else if ( d < 5.0 ) c = uH1; else if ( d < 10.0 ) c = uH2;
  float w = max( fwidth( d ), 1e-3 ); float iso = 0.0;
  iso = max( iso, 1.0 - smoothstep( 0.0, 1.4 * w, abs( d - 2.0 ) ) );
  iso = max( iso, 1.0 - smoothstep( 0.0, 1.4 * w, abs( d - 5.0 ) ) );
  iso = max( iso, 1.0 - smoothstep( 0.0, 1.4 * w, abs( d - 10.0 ) ) );
  diffuseColor.rgb = mix( c, vec3( 0.03 ), iso * 0.8 );
}`);
    }
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + ACES + NEUTRAL)
      .replace('#include <tonemapping_fragment>', 'if ( ! gl_FrontFacing ) { gl_FragColor.rgb = diffuse * 0.5 + 0.015; }\ngl_FragColor.rgb = ' + (TONE.op === 'aces' ? 'nfACES' : 'nfNeutral') + '( gl_FragColor.rgb * ' + TONE.exposure.toFixed(3) + ' );');
  };
  m.customProgramCacheKey = () => 'nf' + (heat ? 'H' : '') + (dash ? 'D' : '');
}
export function setHeatOn(material, on) { if (material?.userData.heat) material.userData.heat.uHeatOn.value = on ? 1 : 0; }

// Materiais FOSCOS (pedido do Leo: nada brilhante/plástico, fidelidade anatômica): rugosidade 0,85–1, metal 0,
// especular ≤ 0,1, sem clearcoat e sem sheen. Valores por estrutura vêm de out/cinematic/v2_matte/viewer_material_spec.json
// (case.material_spec) quando publicado; senão, estes padrões.
const KIND = {
  tumor: { roughness: 0.9, specularIntensity: 0.08 },
  artery: { roughness: 0.85, specularIntensity: 0.1 },
  vein: { roughness: 0.85, specularIntensity: 0.1 },
  organ: { roughness: 0.92, specularIntensity: 0.06 },
  duct: { roughness: 0.88, specularIntensity: 0.08 },
  muscle: { roughness: 0.95, specularIntensity: 0.05 },
  bone: { roughness: 0.95, specularIntensity: 0.05 },
  thrombus: { roughness: 0.92, specularIntensity: 0.06 },
  estimated: { roughness: 0.95, specularIntensity: 0.04 },
  ghost: { roughness: 0.95, specularIntensity: 0.04 },
};
export const TONE = { op: 'neutral', exposure: 1.0 };
let SPEC = null;
export function setMaterialSpec(spec) {
  SPEC = spec || null;
  const t = String(spec?.tone_mapping || spec?.toneMapping || '').toLowerCase();
  if (t.includes('aces')) TONE.op = 'aces';
  const ex = +(spec?.exposure ?? spec?.tone_mapping_exposure); if (ex > 0.2 && ex < 3) TONE.exposure = ex;
}
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
function specFor(def) {
  if (!SPEC) return {};
  const S = SPEC.structures || SPEC.materials || SPEC.per_structure || {};
  const byKey = S[def.key] || S[def.id] || S[(def.key || '').replace(/_left$|_right$/, '')] || (Array.isArray(S) ? S.find((x) => x.key === def.key || x.structure === def.key) : null);
  const byKind = (SPEC.by_kind || SPEC.kinds || {})[def.kind];
  const d = { ...(SPEC.defaults || SPEC.default || {}), ...(byKind || {}), ...(byKey || {}) };
  const o = {};
  // o pedido fosco vale sempre: limita o que vier da especificação
  if (d.roughness != null) o.roughness = clamp(+d.roughness, 0.85, 1);
  if (d.metalness != null) o.metalness = 0;
  const si = d.specularIntensity ?? d.specular_intensity ?? d.specular; if (si != null) o.specularIntensity = clamp(+si, 0, 0.1);
  const ei = d.envMapIntensity ?? d.env_intensity; if (ei != null) o.envMapIntensity = clamp(+ei, 0, 2);
  return o;
}

function makeSolid(def) {
  const k = { ...(KIND[def.kind] || KIND.organ), ...specFor(def) };
  const color = new THREE.Color(def.color || '#cccccc');
  const m = new THREE.MeshPhysicalMaterial({ color, metalness: 0, clearcoat: 0, sheen: 0, ...k });
  m.userData.baseColor = color.clone();
  if (def.kind === 'tumor') m.userData.heat = { uHeatOn: { value: 0 } };
  patch(m, { heat: def.kind === 'tumor', dash: def.kind === 'estimated' });
  return m;
}

const ghostVS = /* glsl */ `
#include <common>
#include <clipping_planes_pars_vertex>
varying vec3 vN; varying vec3 vV;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
  vN = normalize( normalMatrix * normal ); vV = -mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
  #include <clipping_planes_vertex>
}`;
const ghostFS = /* glsl */ `
#include <common>
#include <clipping_planes_pars_fragment>
uniform vec3 uColor; uniform float uOpacity; varying vec3 vN; varying vec3 vV;
void main() {
  #include <clipping_planes_fragment>
  float f = pow( 1.0 - abs( dot( normalize( vN ), normalize( vV ) ) ), 2.0 );
  gl_FragColor = vec4( uColor * ( 0.45 + 0.9 * f ), ( 0.035 + 0.55 * f ) * uOpacity );
  #include <colorspace_fragment>
}`;
function makeGhost(color) {
  const m = new THREE.ShaderMaterial({ vertexShader: ghostVS, fragmentShader: ghostFS, transparent: true, depthWrite: false, clipping: true,
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 1 } }, side: THREE.FrontSide });
  return m;
}

export class Structures {
  constructor(stage, C) {
    this.stage = stage; this.C = C;
    this.root = new THREE.Group(); this.root.name = 'anatomia'; stage.scene.add(this.root);
    this.items = new Map(); this.files = new Map(); this.nodeIndex = new Map();
    this.loader = new GLTFLoader(); this.loader.setMeshoptDecoder(MeshoptDecoder);
    this.xray = false; this.isolated = null; this.selected = null; this.clipPlanes = [];
    this.listeners = new Set(); this.lod = 'lite';
    const assetsOk = !!(C.assets && C.assets.ok);
    for (const d of C.structures) {
      if (d.replacedBy) continue;
      if (d.file && d.file.startsWith('assets:') && !assetsOk) continue;
      const it = { id: d.id, def: d, meshes: [], solid: makeSolid(d), ghostMat: makeGhost(d.color || '#cccccc'), visible: !!d.defaultOn, opacity: d.opacity ?? 1, ghost: this.defaultGhost(d), loaded: false };
      if (!d.reliable) { it.opacity = Math.min(it.opacity, 0.7); }
      this.items.set(d.id, it);
      if (d.file && d.node) {
        const fk = d.file;
        if (!this.nodeIndex.has(fk)) this.nodeIndex.set(fk, new Map());
        this.nodeIndex.get(fk).set(d.node, d.id);
      }
    }
  }
  // fígado e baço em fantasma (borda de Fresnel) por padrão: contexto sem esconder rim/tumor/vasos
  defaultGhost(d) { const g = SPEC?.ghost_default || SPEC?.ghost; return Array.isArray(g) ? g.includes(d.key) : ['liver', 'spleen'].includes(d.key); }
  // segue substituições (ex.: fusao:aorta → assets:aorta)
  resolve(id) {
    let d = this.C.structures.find((x) => x.id === id), n = 0;
    while (d && d.replacedBy && n++ < 4) { const nx = this.C.structures.find((x) => x.id === d.replacedBy); if (!nx) break; d = nx; }
    return d && this.items.has(d.id) ? d.id : null;
  }
  item(id) { const r = this.resolve(id); return r ? this.items.get(r) : null; }
  on(fn) { this.listeners.add(fn); }
  _emit(ev, x) { for (const fn of this.listeners) fn(ev, x); }

  urlFor(fk, lod) {
    const A = this.C.assets;
    if (fk === 'assets:main') return lod === 'full' ? A.files.main.full : A.files.main.lite;
    if (fk === 'assets:optional') return A.files.optional.full;
    if (fk.startsWith('extra:')) return this.C.extra_files[fk];
    return 'data/' + fk;
  }
  fileKeys() { return [...this.nodeIndex.keys()]; }
  neededFiles(onlyVisible = true) {
    const s = new Set();
    for (const it of this.items.values()) if (it.def.file && (!onlyVisible || it.visible)) s.add(it.def.file);
    return [...s];
  }

  ensureFile(fk, lod = this.lod) {
    const key = fk + '|' + (fk === 'assets:main' ? lod : '');
    if (this.files.has(key)) return this.files.get(key);
    const p = fetchBuf(this.urlFor(fk, lod)).then((buf) => this.loader.parseAsync(buf, '')).then((g) => { this._ingest(fk, g, lod); return true; })
      .catch((e) => { console.warn('Falha ao carregar', fk, e); this._emit('loaderror', { fk, e }); return false; });
    this.files.set(key, p);
    return p;
  }

  _ingest(fk, gltf, lod) {
    const idx = this.nodeIndex.get(fk) || new Map();
    gltf.scene.updateMatrixWorld(true);
    const found = new Map();
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      let p = o, id = null;
      while (p && !id) { id = idx.get(p.name) || null; p = p.parent; }
      if (!id) return;
      if (!found.has(id)) found.set(id, []);
      found.get(id).push(o);
    });
    for (const [id, meshes] of found) {
      const it = this.items.get(id); if (!it) continue;
      for (const m of it.meshes) { this.root.remove(m); m.geometry.disposeBoundsTree?.(); m.geometry.dispose(); }
      it.meshes = [];
      for (const m of meshes) {
        this.root.attach(m); // preserva a transformação (inclusive desquantização), sem reescrever atributos
        m.userData.sid = id;
        if (!m.geometry.attributes.normal) m.geometry.computeVertexNormals();
        it.meshes.push(m);
      }
      it.loaded = true; it.lod = fk === 'assets:main' ? lod : 'own';
      this._apply(it);
    }
    this._emit('loaded', { fk, lod, ids: [...found.keys()] });
    this.stage.invalidate(true);
  }

  // ---- estado visual
  effGhost(it) {
    if (this.isolated) return this.isolated !== it.id;
    if (it.ghost) return true;
    if (this.xray) return !['tumor', 'artery', 'vein'].includes(it.def.kind);
    return false;
  }
  _apply(it) {
    const g = this.effGhost(it);
    const m = it.solid;
    const op = it.opacity;
    m.transparent = op < 0.999; m.opacity = op; m.depthWrite = op > 0.5;
    m.clippingPlanes = this.clipPlanes.length ? this.clipPlanes : null; m.clipShadows = true;
    const side = this.clipPlanes.length && !m.transparent ? THREE.DoubleSide : THREE.FrontSide;
    if (m.side !== side) { m.side = side; m.needsUpdate = true; }
    it.ghostMat.clippingPlanes = m.clippingPlanes;
    const sel = this.selected === it.id;
    m.emissive.copy(sel ? m.userData.baseColor : new THREE.Color(0)); m.emissiveIntensity = sel ? 0.22 : 0;
    it.ghostMat.uniforms.uOpacity.value = sel ? 1.8 : 1;
    for (const mesh of it.meshes) {
      mesh.visible = it.visible;
      mesh.material = g ? it.ghostMat : m;
      mesh.castShadow = !g && !m.transparent; mesh.receiveShadow = !g;
      mesh.renderOrder = g ? 20 : m.transparent ? 10 : 0;
    }
  }
  applyAll() { for (const it of this.items.values()) this._apply(it); this.stage.invalidate(true); this._emit('state'); }

  setVisible(id, v) { const it = this.items.get(id); if (!it) return; it.visible = v; if (v && !it.loaded && it.def.file) this.ensureFile(it.def.file); this._apply(it); this.stage.invalidate(true); this._emit('state', id); }
  setOpacity(id, op) { const it = this.items.get(id); if (!it) return; it.opacity = op; this._apply(it); this.stage.invalidate(true); this._emit('opacity', id); }
  setGhost(id, g) { const it = this.items.get(id); if (!it) return; it.ghost = g; this._apply(it); this.stage.invalidate(true); this._emit('state', id); }
  setXray(on) { this.xray = on; this.applyAll(); }
  isolate(id) { this.isolated = id; if (id) { const it = this.items.get(id); if (it && !it.visible) this.setVisible(id, true); } this.applyAll(); }
  select(id) { const prev = this.selected; this.selected = id; for (const k of [prev, id]) { const it = this.items.get(k); if (it) this._apply(it); } this.stage.invalidate(); this._emit('select', id); }
  setClip(planes) { this.clipPlanes = planes || []; this.applyAll(); this.stage.setClipPlanes(this.clipPlanes); }

  boxOf(ids) {
    const b = new THREE.Box3();
    for (const id of ids) {
      const it = this.items.get(id); if (!it) continue;
      const bb = it.def.bbox_world;
      if (bb) { b.expandByPoint(new THREE.Vector3(...bb[0])); b.expandByPoint(new THREE.Vector3(...bb[1])); }
      else for (const m of it.meshes) b.expandByObject(m);
    }
    return b;
  }
  visibleIds(reliableOnly = false) { return [...this.items.values()].filter((it) => it.visible && (!reliableOnly || it.def.reliable)).map((it) => it.id); }

  raycast(raycaster) {
    raycaster.firstHitOnly = !this.clipPlanes.length;
    const solid = [], ghost = [];
    for (const it of this.items.values()) {
      if (!it.visible) continue;
      (this.effGhost(it) ? ghost : solid).push(...it.meshes);
    }
    for (const m of solid.concat(ghost)) if (!m.geometry.boundsTree && !m.userData.noBVH) { try { m.geometry.computeBoundsTree(); } catch (e) { m.userData.noBVH = true; } }
    const clipOk = (p) => this.clipPlanes.every((pl) => pl.distanceToPoint(p) >= 0);
    for (const set of [solid, ghost]) {
      const hits = raycaster.intersectObjects(set, false).filter((h) => clipOk(h.point));
      if (hits.length) return { id: hits[0].object.userData.sid, point: hits[0].point.clone(), object: hits[0].object };
    }
    return null;
  }
}
