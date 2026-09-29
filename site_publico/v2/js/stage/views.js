// Vistas anatômicas. Mundo: +X direita do paciente, +Y superior, +Z posterior (câmera anterior em −Z olhando +Z).
import * as THREE from 'three';

export const VIEWS = [
  { id: 'anterior', label: 'Anterior', key: '1', dir: [0, 0, -1], up: [0, 1, 0] },
  { id: 'posterior', label: 'Posterior', key: '2', dir: [0, 0, 1], up: [0, 1, 0] },
  { id: 'esquerda', label: 'Lateral E', key: '3', dir: [-1, 0, 0], up: [0, 1, 0] },
  { id: 'direita', label: 'Lateral D', key: '4', dir: [1, 0, 0], up: [0, 1, 0] },
  { id: 'cranial', label: 'Cranial', key: '5', dir: [0, 1, 0], up: [0, 0, -1] },
  { id: 'caudal', label: 'Caudal', key: '6', dir: [0, -1, 0], up: [0, 0, -1] },
  { id: 'flanco', label: 'Flanco E', key: '7', dir: [-1, 0, -0.35], up: [0, 0, 1], target: 'tumor', proposal: true,
    note: 'Decúbito lateral direito; tela ↑ = posterior. Proposta, a confirmar com o Leo.' },
  { id: 'lap_hilo', label: 'Laparoscópica · hilo E', key: '8', dir: [0.3, -0.4, -1], up: [-1, 0, 0], target: 'hilum', fov: 60, dist: 190, proposal: true,
    note: 'Porta umbilical → hilo renal esquerdo, decúbito lateral direito (tela ↑ = lado esquerdo do paciente, voltado para o teto). Proposta, a confirmar com o Leo.' },
  { id: 'lombotomia', label: 'Dorsal · lombotomia E', key: '9', dir: [-0.55, 0.1, 1], up: [0, 1, 0], target: 'tumor', proposal: true,
    note: 'Acesso posterior-lateral esquerdo. Proposta, a confirmar com o Leo.' },
];

export class Views {
  constructor(stage, structures, C) {
    this.stage = stage; this.S = structures; this.C = C; this.current = null;
    this._fovAnim = null;
    stage.tickers.add((dt) => this._tickFov(dt));
  }
  byId(id) { return VIEWS.find((v) => v.id === id); }
  targetFor(v) {
    const L = this.C.landmarks || {};
    if (v.target === 'hilum') {
      const p = L.left_renal_hilum_world || L.medial_point_world;
      if (p) return new THREE.Vector3(...p);
    }
    if (v.target === 'tumor') {
      const tid = [...this.S.items.values()].find((it) => it.def.kind === 'tumor' && it.visible)?.id;
      if (tid) return this.S.boxOf([tid]).getCenter(new THREE.Vector3());
    }
    return null;
  }
  sphere(ids) {
    const b = this.S.boxOf(ids && ids.length ? ids : this.S.visibleIds(true));
    if (b.isEmpty()) return new THREE.Sphere(new THREE.Vector3(), 200);
    return b.getBoundingSphere(new THREE.Sphere());
  }
  set(id, animate = true, ids = null) {
    const v = this.byId(id) || VIEWS[0];
    const cam = this.stage.camera, c = this.stage.controls;
    const s = this.sphere(ids);
    const fov = v.fov || this.stage.baseFov;
    const t = this.targetFor(v) || s.center;
    const dir = new THREE.Vector3(...v.dir).normalize();
    const dist = v.dist || (s.radius / Math.sin(THREE.MathUtils.degToRad(Math.min(fov, fov * cam.aspect) / 2))) * 1.02;
    cam.up.set(...v.up); c.updateCameraUp();
    const p = t.clone().addScaledVector(dir, dist);
    c.setLookAt(p.x, p.y, p.z, t.x, t.y, t.z, animate);
    this._animFov(fov, animate);
    this.current = v.id; this.lastNamed = v.id;
    this.stage.invalidate();
    return v;
  }
  _animFov(to, animate) {
    const cam = this.stage.camera;
    if (!animate) { cam.fov = to; cam.updateProjectionMatrix(); this._fovAnim = null; return; }
    this._fovAnim = { from: cam.fov, to, t: 0 };
  }
  _tickFov(dt) {
    const a = this._fovAnim; if (!a) return false;
    a.t = Math.min(1, a.t + dt / 0.5);
    const e = a.t < 0.5 ? 2 * a.t * a.t : 1 - Math.pow(-2 * a.t + 2, 2) / 2;
    const cam = this.stage.camera; cam.fov = a.from + (a.to - a.from) * e; cam.updateProjectionMatrix();
    if (a.t >= 1) this._fovAnim = null;
    return true;
  }
  focus(ids, animate = true) {
    const b = this.S.boxOf(ids); if (b.isEmpty()) return;
    this.stage.controls.fitToSphere(b.getBoundingSphere(new THREE.Sphere()), animate);
    this.stage.invalidate();
  }
  // leitura de orientação: para onde apontam as direções da tela, em termos do paciente
  orientation() {
    const cam = this.stage.camera;
    const e = cam.matrixWorld.elements;
    const right = new THREE.Vector3(e[0], e[1], e[2]), up = new THREE.Vector3(e[4], e[5], e[6]);
    return { right: dirName(right), up: dirName(up), rightVec: right, upVec: up };
  }
}
const NAMES = [
  [new THREE.Vector3(1, 0, 0), 'direita do paciente', 'D'], [new THREE.Vector3(-1, 0, 0), 'esquerda do paciente', 'E'],
  [new THREE.Vector3(0, 1, 0), 'superior (cranial)', 'S'], [new THREE.Vector3(0, -1, 0), 'inferior (caudal)', 'I'],
  [new THREE.Vector3(0, 0, 1), 'posterior', 'P'], [new THREE.Vector3(0, 0, -1), 'anterior', 'A'],
];
export function dirName(v) {
  let best = null, bd = -2;
  for (const [n, name, ab] of NAMES) { const d = n.dot(v); if (d > bd) { bd = d; best = { name, ab, dot: d }; } }
  return best;
}
export const AXES = NAMES;
