// Visualizador 3D (three.js vendorizado) para GLBs de segmentação.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { describe, modelFromName, isDivergenceName, DIVERGENCE_COLOR, DIVERGENCE_OPACITY } from "./structures.js";

// Convenções de coordenadas do GLB. Todas são levadas a "Y para cima" no three.js:
// rot = rotação aplicada ao grupo do GLB em torno de X; R/A/S = direções do paciente
// (direita, anterior, superior) no espaço do mundo APÓS a rotação.
export const CONVENTIONS = {
  ras_zup: { label: "RAS mm, Z superior (girado −90° em X) — padrão", rot: -Math.PI / 2, R: [1, 0, 0], A: [0, 0, -1], S: [0, 1, 0] },
  lps_zup: { label: "LPS mm, Z superior (ITK/DICOM; girado −90° em X)", rot: -Math.PI / 2, R: [-1, 0, 0], A: [0, 0, 1], S: [0, 1, 0] },
  yup: { label: "Já em Y-up (glTF: +Y superior, −Z anterior, +X direita)", rot: 0, R: [1, 0, 0], A: [0, 0, -1], S: [0, 1, 0] },
  // por ARQUIVO (não aparece no seletor global): glTF Y-up = (x, z, −y) de RAS mm, centrado (fusão / viewer_assets);
  // o deslocamento centre_offset_gltf_mm é somado de volta para alinhar com os GLBs em RAS mm.
  gltf_yup: { label: "glTF Y-up = (x, z, −y) de RAS mm, centrado (fusão / viewer_assets)", rot: 0, R: [1, 0, 0], A: [0, 0, -1], S: [0, 1, 0], perFile: true },
};
// convenção efetiva de um GLB: a do manifesto (por arquivo) > extras da cena glTF (convention: ras_yup) > seletor global
function sourceConvention(source, sceneExtras, globalKey) {
  const ex = sceneExtras || {};
  let key = source.convention_locked ? source.convention : null;
  let offset = source.centre_offset_gltf_mm || null;
  if (!key && (ex.convention === "ras_yup" || ex.convention === "gltf_yup")) { key = "gltf_yup"; offset = offset || ex.centre_offset_gltf_mm || null; }
  if (key === "gltf_yup" && !offset && Array.isArray(ex.centre_offset_gltf_mm)) offset = ex.centre_offset_gltf_mm;
  return { key: key || globalKey, locked: !!key, offset };
}
export const DEFAULT_CONVENTION = "ras_zup";

// dir = de onde a câmera olha (a partir do alvo); off = pequeno desvio para evitar o polo
// da órbita nas vistas superior/inferior (mantém anterior no topo da tela).
export const VIEWS = {
  anterior: { label: "Anterior", dir: (c) => v(c.A) },
  posterior: { label: "Posterior", dir: (c) => v(c.A).negate() },
  right: { label: "Direita", dir: (c) => v(c.R) },
  left: { label: "Esquerda", dir: (c) => v(c.R).negate() },
  superior: { label: "Superior", dir: (c) => v(c.S).add(v(c.A).multiplyScalar(-0.002)) },
  inferior: { label: "Inferior", dir: (c) => v(c.S).negate().add(v(c.A).multiplyScalar(0.002)) },
};
function v(a) { return new THREE.Vector3(a[0], a[1], a[2]); }

let uid = 0;

// Materiais foscos (pedido do Leo: sem brilho "de plástico"/especular). Faixas obrigatórias: rugosidade 0,85–1,0,
// metalicidade 0, specularIntensity ≤ 0,1, sem clearcoat/sheen. Se o manifesto trouxer
// out/cinematic/v2_matte/viewer_material_spec.json, os valores por estrutura vêm dele (limitados a essas faixas).
export const MATTE_DEFAULT = { roughness: 0.92, metalness: 0, specularIntensity: 0.05 };
const clamp = (x, lo, hi, dflt) => (typeof x === "number" && isFinite(x) ? Math.min(hi, Math.max(lo, x)) : dflt);
const KIND_BY_CAT = { onco: "tumor", vein: "vein", artery: "artery", kidney: "organ", ug: "duct", adrenal: "organ", organ: "organ", bone: "bone", leo: "organ", review: "organ" };
function specLookup(spec, name, info) {
  if (!spec) return null;
  const S = spec.structures || spec.per_structure || spec.nodes || null;
  const keys = [name, name && name.split("__").pop(), info && info.key, info && info.baseKey].filter(Boolean);
  // 1) chave exata da estrutura (nome do nó, sufixo após "__", chave anatômica)
  if (S && !Array.isArray(S)) { for (const k of keys) if (S[k]) return [S[k], "estrutura:" + k]; }
  if (Array.isArray(S)) {
    for (const k of keys) {
      const hit = S.find((x) => [x.node_name, x.node, x.name, x.structure, x.id, x.key].includes(k));
      if (hit) return [hit, "estrutura:" + k];
    }
  }
  // 2) materiais com "match_node_name_contains"
  const M = spec.materials && !Array.isArray(spec.materials) ? Object.entries(spec.materials) : [];
  const lname = String(name || "").toLowerCase();
  for (const [mk, mv] of M) if ((mv.match_node_name_contains || []).some((t) => lname.includes(String(t).toLowerCase()))) return [mv, "material:" + mk];
  // 3) por tipo (categoria do visualizador)
  if (spec.by_kind && info) {
    let kind = KIND_BY_CAT[info.cat] || null;
    if (/thromb/.test(lname)) kind = "thrombus";
    else if (/psoas/.test(lname)) kind = "muscle";
    else if (/estimad|trajetoria/.test(lname)) kind = "estimated";
    if (kind && spec.by_kind[kind]) return [spec.by_kind[kind], "tipo:" + kind];
  }
  return null;
}
export function matteParams(spec, name, info) {
  const d = (spec && (spec.defaults || spec.default || spec.global)) || {};
  const [s, src] = specLookup(spec, name, info) || [{}, null];
  const pick = (k, alt) => (s[k] ?? s[alt] ?? d[k] ?? d[alt]);
  const rawR = pick("roughness"), rawS = pick("specularIntensity", "specular_intensity");
  const r = { roughness: clamp(rawR, 0.85, 1.0, MATTE_DEFAULT.roughness), metalness: 0,
    specularIntensity: clamp(rawS, 0, 0.1, MATTE_DEFAULT.specularIntensity),
    source: src ? "spec " + src : Object.keys(d).length ? "spec padrão" : "padrão do visualizador" };
  r.clamped = (typeof rawR === "number" && rawR !== r.roughness) || (typeof rawS === "number" && rawS !== r.specularIntensity);
  return r;   // cor NUNCA vem da spec: fica extras.cor; opacidade segue as regras do visualizador
}

export class Viewer3D {
  constructor(container, opts = {}) {
    this.container = container;
    this.opts = opts;
    this.convention = CONVENTIONS[opts.convention] ? opts.convention : DEFAULT_CONVENTION;
    this.entries = [];
    this.sources = [];
    this.currentView = "anterior";
    this.clip = {
      axial: { enabled: false, pos: 0.5, flip: false },
      coronal: { enabled: false, pos: 0.5, flip: false },
      sagittal: { enabled: false, pos: 0.5, flip: false },
    };

    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.setClearColor(0x0c1013, 1);
    r.localClippingEnabled = false;
    r.autoClear = false;
    container.appendChild(r.domElement);
    r.domElement.classList.add("three-canvas");

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.5, 20000);
    this.camera.position.set(0, 500, 0);
    // iluminação suave, sem pontos quentes: hemisférica + ambiente dominam; luz de cabeça fraca e difusa (só para relevo)
    this.materialSpec = opts.materialSpec || null;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x4a4a52, 1.35));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.3));
    this.headLight = new THREE.DirectionalLight(0xffffff, 1.25);
    this.camera.add(this.headLight);
    this.headLight.position.set(0.3, 0.6, 1);
    this.fillLight = new THREE.DirectionalLight(0xffffff, 0.35);   // contraluz fraca, evita lado totalmente escuro
    this.camera.add(this.fillLight);
    this.fillLight.position.set(-0.5, -0.4, -0.6);
    this.scene.add(this.camera);
    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.enablePan = true;
    this.controls.enableZoom = true;

    this._initGizmo();
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(container);
    this.resize();
    const loop = () => {
      requestAnimationFrame(loop);
      if (!this.container.offsetParent) return; // oculto: não renderizar
      this.controls.update();
      this.render();
    };
    loop();
  }

  get conv() { return CONVENTIONS[this.convention] || CONVENTIONS[DEFAULT_CONVENTION]; }

  resize() {
    const w = Math.max(50, this.container.clientWidth);
    const h = Math.max(50, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + "px";
    this.renderer.domElement.style.height = h + "px";
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() {
    const r = this.renderer;
    const size = r.getSize(new THREE.Vector2());
    r.setViewport(0, 0, size.x, size.y);
    r.setScissorTest(false);
    r.clear();
    r.render(this.scene, this.camera);
    // gizmo de orientação (canto inferior esquerdo), sem clipping
    const planes = r.clippingPlanes;
    r.clippingPlanes = [];
    const g = 130;
    r.setViewport(8, 8, g, g);
    r.setScissor(8, 8, g, g);
    r.setScissorTest(true);
    r.clearDepth();
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target).normalize();
    this.gizmoCam.position.copy(dir.multiplyScalar(5.6));
    this.gizmoCam.up.copy(this.camera.up);
    this.gizmoCam.quaternion.copy(this.camera.quaternion);
    r.render(this.gizmoScene, this.gizmoCam);
    r.setScissorTest(false);
    r.setViewport(0, 0, size.x, size.y);
    r.clippingPlanes = planes;
  }

  _label(text, color) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const x = c.getContext("2d");
    x.fillStyle = color;
    x.beginPath(); x.arc(32, 32, 26, 0, Math.PI * 2); x.fill();
    x.fillStyle = "#0b0e10";
    x.font = "bold 34px sans-serif";
    x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText(text, 32, 34);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
    s.scale.set(0.85, 0.85, 0.85);
    return s;
  }

  _initGizmo() {
    this.gizmoScene = new THREE.Scene();
    this.gizmoCam = new THREE.PerspectiveCamera(40, 1, 0.1, 20);
    this._buildGizmo();
  }

  _buildGizmo() {
    const gs = this.gizmoScene;
    while (gs.children.length) gs.remove(gs.children[0]);
    const c = this.conv;
    // pt-BR: D = direita, E = esquerda, A = anterior, P = posterior, S = superior, I = inferior
    const axes = [
      [c.R, "D", "#ff8a8a"], [c.A, "A", "#8aff9a"], [c.S, "S", "#8ab8ff"],
    ];
    for (const [a, t, col] of axes) {
      const d = v(a);
      gs.add(new THREE.ArrowHelper(d, new THREE.Vector3(), 1.1, new THREE.Color(col).getHex(), 0.25, 0.14));
      const s = this._label(t, col); s.position.copy(d.clone().multiplyScalar(1.45)); gs.add(s);
      const opp = { D: "E", A: "P", S: "I" }[t];
      const s2 = this._label(opp, "#9aa4ab"); s2.position.copy(d.clone().multiplyScalar(-1.25)); s2.scale.set(0.6, 0.6, 0.6); gs.add(s2);
    }
  }

  setConvention(key) {
    if (!CONVENTIONS[key]) return;
    this.convention = key;
    // só os GLBs sem convenção própria acompanham o seletor global
    for (const src of this.sources) { if (src.convLocked) continue; src.group.rotation.set(this.conv.rot, 0, 0); src.group.updateMatrixWorld(true); }
    this._buildGizmo();
    const b = this.bbox(false);
    if (!b.isEmpty()) this.controls.target.copy(b.getCenter(new THREE.Vector3()));
    this.setView(this.currentView);
    this.updateClipping();
  }

  clearSources() {
    for (const e of this.entries) {
      e.object.parent && e.object.parent.remove(e.object);
    }
    this.root.clear();
    this.entries = [];
    this.sources = [];
  }

  // Carrega um GLB. source: {id, label, model, url, synthetic}
  async loadGLB(source) {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(source.url + (source.url.includes("?") ? "&" : "?") + "t=" + Date.now());
    const group = gltf.scene;
    group.name = "src:" + source.id;
    const sc = sourceConvention(source, group.userData, this.convention);
    group.rotation.set((CONVENTIONS[sc.key] || this.conv).rot, 0, 0);
    if (sc.offset) group.position.set(sc.offset[0], sc.offset[1], sc.offset[2]);
    group.updateMatrixWorld(true);
    const meshes = [];
    group.traverse((o) => { if (o.isMesh) meshes.push(o); });
    const created = [];
    for (const mesh of meshes) {
      // nome: o próprio mesh ou o ancestral nomeado mais próximo
      let name = mesh.name;
      let p = mesh;
      while ((!name || /^mesh_?\d*$/i.test(name)) && p.parent && p.parent !== group) { p = p.parent; name = p.name; }
      name = name || mesh.name || "sem_nome";
      const info = describe(name);
      const divergence = info.divergence || isDivergenceName(name);
      const model = divergence ? "Divergência entre modelos" : modelFromName(name, source.model);
      // cor original do arquivo (fallback quando a estrutura não é reconhecida)
      let origColor = "#b8b8b8";
      const om = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const colAttr = mesh.geometry.getAttribute("color");
      if (colAttr && colAttr.count) {
        const cc = new THREE.Color().setRGB(colAttr.getX(0), colAttr.getY(0), colAttr.getZ(0), THREE.LinearSRGBColorSpace);
        origColor = "#" + cc.getHexString();
      } else if (om && om.color) origColor = "#" + om.color.getHexString();
      // extras glTF do nó/mesh (viewer_assets: cor, confiavel, grupo, volume_ml) — cor do arquivo tem prioridade
      let extras = {};
      for (let q = mesh; q && q !== group; q = q.parent) if (q.userData) extras = { ...q.userData, ...extras };   // o mais próximo do mesh vence
      const exCor = typeof extras.cor === "string" && /^#?[0-9a-f]{6}$/i.test(extras.cor) ? (extras.cor[0] === "#" ? extras.cor : "#" + extras.cor) : null;
      const color = divergence ? DIVERGENCE_COLOR : (exCor || info.color || origColor);
      const opacity = divergence ? DIVERGENCE_OPACITY : info.op;
      const mp = matteParams(this.materialSpec, name, info);
      const mat = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(color), roughness: mp.roughness, metalness: mp.metalness, specularIntensity: mp.specularIntensity,
        clearcoat: 0, sheen: 0, envMapIntensity: 0, iridescence: 0, transmission: 0,
        side: THREE.DoubleSide, transparent: opacity < 0.999, opacity, depthWrite: opacity >= 0.999,
      });
      mat.userData.matteSource = mp.source; mat.userData.matteClamped = mp.clamped;
      mesh.material = mat;
      if (mesh.geometry.getAttribute("normal") == null) mesh.geometry.computeVertexNormals();
      mesh.renderOrder = divergence ? 10 : (opacity < 0.999 ? 5 : 0);
      const e = {
        id: "e" + (++uid), name, info, divergence, model, source, object: mesh, extras, unreliable: extras.confiavel === false || !!source.unreliable,
        anatColor: color, color, opacity, defaultOpacity: opacity, visible: true,
        cat: divergence ? "diverg" : info.cat,
      };
      created.push(e);
    }
    this.root.add(group);
    this.entries.push(...created);
    this.sources.push({ ...source, group, entries: created, convKey: sc.key, convLocked: sc.locked, convOffset: sc.offset });
    this.updateClipping();
    return created;
  }

  setVisible(e, on) { e.visible = on; e.object.visible = on; }
  setOpacity(e, op) {
    e.opacity = op;
    const m = e.object.material;
    m.opacity = op; m.transparent = op < 0.999; m.depthWrite = op >= 0.999; m.needsUpdate = true;
    e.object.renderOrder = e.divergence ? 10 : (op < 0.999 ? 5 : 0);
  }
  setColor(e, hex) { e.color = hex; e.object.material.color.set(hex); }
  setSourceVisible(sourceId, on) {
    const s = this.sources.find((x) => x.id === sourceId);
    if (s) s.group.visible = on;
  }

  bbox(onlyVisible = false) {
    const b = new THREE.Box3();
    for (const e of this.entries) {
      if (onlyVisible && (!e.visible || !e.object.parent?.visible)) continue;
      b.expandByObject(e.object);
    }
    return b;
  }

  fit() {
    let b = this.bbox(true);
    if (b.isEmpty()) b = this.bbox(false);
    if (b.isEmpty()) return;
    const c = b.getCenter(new THREE.Vector3());
    const r = b.getSize(new THREE.Vector3()).length() / 2;
    this.controls.target.copy(c);
    this._radius = r;
    this.setView(this.currentView, true);
  }

  setView(name, keepTarget = true) {
    const vw = VIEWS[name] || VIEWS.anterior;
    this.currentView = name;
    const c = this.conv;
    const r = this._radius || 200;
    const dist = r / Math.sin((this.camera.fov * Math.PI) / 360) * 1.05;
    const t = this.controls.target;
    this.camera.up.set(0, 1, 0); // S é sempre +Y no mundo (ver CONVENTIONS)
    this.camera.position.copy(t.clone().add(vw.dir(c).normalize().multiplyScalar(dist)));
    this.camera.near = Math.max(0.1, dist / 200);
    this.camera.far = dist * 20;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(t);
    this.controls.update();
  }

  // Planos de corte: axial (eixo S), coronal (eixo A), sagital (eixo R)
  updateClipping() {
    const b = this.bbox(false);
    const planes = [];
    if (!b.isEmpty()) {
      const c = this.conv;
      const axes = { axial: v(c.S), coronal: v(c.A), sagittal: v(c.R) };
      const corners = [];
      for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) corners.push(new THREE.Vector3(x, y, z));
      for (const k of Object.keys(axes)) {
        const cl = this.clip[k];
        if (!cl.enabled) continue;
        const ax = axes[k];
        const proj = corners.map((p) => p.dot(ax));
        const lo = Math.min(...proj), hi = Math.max(...proj);
        const pos = lo + (hi - lo) * cl.pos;
        // mantém o lado "abaixo" de pos (inferior/posterior/esquerdo); flip mantém o outro lado
        planes.push(cl.flip ? new THREE.Plane(ax.clone(), -pos) : new THREE.Plane(ax.clone().negate(), pos));
      }
    }
    this.renderer.clippingPlanes = planes;
  }

  // Captura de tela com faixa de aviso embutida
  screenshot({ title = "", synthetic = false } = {}) {
    this.controls.update();
    this.render();
    const src = this.renderer.domElement;
    const strip = Math.round(56 * (src.width / Math.max(1, src.clientWidth)));
    const out = document.createElement("canvas");
    out.width = src.width; out.height = src.height + strip;
    const x = out.getContext("2d");
    x.drawImage(src, 0, 0);
    x.fillStyle = synthetic ? "#7a0010" : "#3a2c00";
    x.fillRect(0, src.height, out.width, strip);
    const fs = Math.max(11, Math.round(strip * 0.27));
    x.font = `600 ${fs}px sans-serif`;
    x.fillStyle = "#ffe08a";
    x.fillText("Segmentação automática por IA — uso educacional/planejamento, não diagnóstico; validar com radiologista.", 10, src.height + fs + 6);
    x.fillStyle = "#ffffff";
    const ts = new Date().toLocaleString("pt-BR");
    x.fillText(`${synthetic ? "DADOS SINTÉTICOS DE TESTE — NÃO É PACIENTE · " : ""}${title} · Vista: ${VIEWS[this.currentView]?.label || ""} · ${ts}`, 10, src.height + fs * 2 + 12);
    const a = document.createElement("a");
    a.download = `nefrec_3d_${this.currentView}_${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
    a.href = out.toDataURL("image/png");
    document.body.appendChild(a); a.click(); a.remove();
    return a.href;
  }
}
