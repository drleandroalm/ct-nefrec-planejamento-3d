// Modo path tracing (three-gpu-pathtracer 0.0.23, vendorizado): refinamento progressivo só com a câmera parada.
// Usa o gancho stage.refiner (reset/step/converged). Cena própria: cópias das malhas visíveis em coordenadas do mundo
// (float32, sem quantização), materiais FOSCOS iguais aos do raster (mesma cor/rugosidade/especular), luz só do HDRI.
// Limitações honestas: plano de corte e mapa de calor não entram no path tracing; fantasmas viram translúcidos.
import * as THREE from 'three';

export function ptSupported(renderer) {
  try {
    const gl = renderer.getContext();
    return renderer.capabilities.isWebGL2 && !!gl.getExtension('EXT_color_buffer_float') && renderer.capabilities.maxTextureSize >= 4096;
  } catch (_) { return false; }
}

function bakeGeometry(mesh) {
  const g = mesh.geometry, pos = g.attributes.position; if (!pos) return null;
  const n = pos.count, M = mesh.matrixWorld, N = new THREE.Matrix3().getNormalMatrix(M);
  const P = new Float32Array(n * 3), NR = new Float32Array(n * 3), v = new THREE.Vector3();
  const nor = g.attributes.normal;
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(M); P[3 * i] = v.x; P[3 * i + 1] = v.y; P[3 * i + 2] = v.z;
    if (nor) { v.fromBufferAttribute(nor, i).applyMatrix3(N).normalize(); NR[3 * i] = v.x; NR[3 * i + 1] = v.y; NR[3 * i + 2] = v.z; }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  if (nor) out.setAttribute('normal', new THREE.BufferAttribute(NR, 3));
  if (g.index) out.setIndex(new THREE.BufferAttribute(Uint32Array.from(g.index.array), 1));
  if (!nor) out.computeVertexNormals();
  return out;
}

export class PathTracer {
  constructor(stage, S) {
    this.stage = stage; this.S = S; this.pt = null; this.scene = null; this.on = false;
    this.maxSamples = stage.lowPower ? 96 : 384; this.samples = 0; this.onStatus = null; this._dirtyScene = true;
  }
  get converged() { return !this.on || !this.pt || this.pt.samples >= this.maxSamples; }
  markScene() { this._dirtyScene = true; }
  async enable() {
    if (this.on) return true;
    const st = this.stage;
    if (!ptSupported(st.renderer)) { this.onStatus?.('indisponível neste aparelho (sem float render targets)'); return false; }
    this.onStatus?.('preparando cena…');
    const { WebGLPathTracer } = await import('three-gpu-pathtracer');
    const pt = (this.pt = this.pt || new WebGLPathTracer(st.renderer));
    pt.renderToCanvas = true; pt.rasterizeScene = true; pt.minSamples = 2; pt.fadeDuration = 350; pt.renderDelay = 0;
    pt.bounces = st.lowPower ? 3 : 5; pt.filterGlossyFactor = 0.5; pt.renderScale = st.lowPower ? 0.5 : 1;
    pt.tiles.set(st.lowPower ? 3 : 2, st.lowPower ? 3 : 2);
    this.on = true; this._dirtyScene = true;
    st.refiner = this; st.invalidate();
    return true;
  }
  disable() {
    this.on = false; if (this.stage.refiner === this) this.stage.refiner = null;
    this.onStatus?.(null); this.stage.invalidate();
  }
  _build() {
    const st = this.stage, S = this.S;
    const sc = new THREE.Scene();
    sc.background = new THREE.Color('#12161d');
    sc.environment = st.hdrTex || null; sc.environmentIntensity = (st.scene.environmentIntensity || 0.7) * 1.25;
    if (st.scene.environmentRotation) sc.environmentRotation = st.scene.environmentRotation.clone();
    if (!sc.environment) { const h = new THREE.HemisphereLight(0xffffff, 0x333333, 1.2); sc.add(h); }
    let tris = 0;
    for (const it of S.items.values()) {
      if (!it.visible || !it.meshes.length) continue;
      const ghost = S.effGhost(it), src = it.solid;
      const op = ghost ? 0.14 : Math.min(1, it.opacity ?? 1) * (it.def.kind === 'estimated' ? 0.45 : 1);
      const mat = new THREE.MeshStandardMaterial({
        color: (src.userData.baseColor || src.color).clone(), roughness: Math.max(0.85, src.roughness ?? 0.9), metalness: 0,
        transparent: op < 0.999, opacity: op, side: THREE.DoubleSide,
      });
      for (const m of it.meshes) {
        if (!m.visible && !m.parent) continue;
        m.updateWorldMatrix(true, false);
        const g = bakeGeometry(m); if (!g) continue;
        tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
        sc.add(new THREE.Mesh(g, mat));
      }
    }
    if (this.scene) this.scene.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    this.scene = sc; this.tris = tris;
    this.pt.setScene(sc, st.camera);
    this._dirtyScene = false;
  }
  reset() {
    if (!this.on || !this.pt) return;
    if (this._dirtyScene) {
      this.onStatus?.('preparando cena…');
      const t0 = performance.now();
      try { this._build(); } catch (e) { console.warn('path tracing falhou', e); this.onStatus?.('falhou: ' + e.message); this.disable(); return; }
      this.buildMs = Math.round(performance.now() - t0);
    } else this.pt.updateCamera();
    this.pt.reset();
  }
  step(stage) {
    const r = stage.renderer, tm = r.toneMapping, ex = r.toneMappingExposure;
    r.toneMapping = THREE.NeutralToneMapping; r.toneMappingExposure = 1;
    this.pt.renderSample();
    r.toneMapping = tm; r.toneMappingExposure = ex;
    this.samples = this.pt.samples;
    const clip = stage.clipActive ? ' · corte não aplicado' : '';
    this.onStatus?.(`path tracing · ${Math.floor(this.samples)}/${this.maxSamples} amostras${clip}`);
  }
}
