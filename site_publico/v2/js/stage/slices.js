// Fatias da TC dentro do 3D (textura 3D float16) e plano de corte livre com gizmo.
// Perfil público (sem TC publicada): só a textura de rótulos; fundo escuro neutro no lugar da TC.
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { fetchBuf } from '../core/util.js';

export const WINDOWS = {
  soft: { label: 'Partes moles', lo: -160, hi: 240 },
  vessel: { label: 'Vascular', lo: -150, hi: 450 },
  bone: { label: 'Osso', lo: -500, hi: 1300 },
  wide: { label: 'Ampla', lo: -500, hi: 500 },
};

const VS = /* glsl */ `
varying vec3 vW;
void main() { vec4 w = modelMatrix * vec4( position, 1.0 ); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const FS = /* glsl */ `
precision highp sampler3D;
uniform sampler3D uCT; uniform sampler3D uLab; uniform sampler2D uLUT;
uniform mat4 uW2U; uniform vec2 uWin; uniform float uMix; uniform float uOpacity; uniform float uHasCT;
varying vec3 vW;
vec3 s2l( vec3 c ) { return mix( c / 12.92, pow( ( c + 0.055 ) / 1.055, vec3( 2.4 ) ), step( 0.04045, c ) ); }
void main() {
  vec3 uvw = ( uW2U * vec4( vW, 1.0 ) ).xyz;
  if ( any( lessThan( uvw, vec3( 0.0 ) ) ) || any( greaterThan( uvw, vec3( 1.0 ) ) ) ) discard;
  vec3 col = vec3( 0.07, 0.08, 0.10 );
  if ( uHasCT > 0.5 ) {
    float hu = texture( uCT, uvw ).r;
    col = vec3( clamp( ( hu - uWin.x ) / ( uWin.y - uWin.x ), 0.0, 1.0 ) );
  }
  float id = floor( texture( uLab, uvw ).r * 255.0 + 0.5 );
  vec4 lc = texture( uLUT, vec2( ( id + 0.5 ) / 256.0, 0.5 ) );
  col = mix( col, lc.rgb, lc.a * ( uHasCT > 0.5 ? uMix : max( uMix, 0.85 ) ) );
  gl_FragColor = vec4( s2l( col ), uOpacity );
  #include <colorspace_fragment>
}`;

export class Slices {
  constructor(stage, structures, C) {
    this.stage = stage; this.S = structures; this.C = C; this.meta = C.slices;
    this.group = new THREE.Group(); this.group.name = 'fatias'; this.group.userData.noAO = true; stage.scene.add(this.group);
    this.ready = null; this.planes = {}; this.cursor = new THREE.Vector3();
    this.uniforms = { uCT: { value: null }, uLab: { value: null }, uLUT: { value: null }, uW2U: { value: new THREE.Matrix4() }, uWin: { value: new THREE.Vector2(-160, 240) }, uMix: { value: 0.35 }, uOpacity: { value: 1 }, uHasCT: { value: 0 } };
    this.hasCT = !!this.meta?.ct;   // perfil público: slices.ct ausente → só rótulos
    if (this.meta) this.uniforms.uW2U.value.fromArray(this.meta.world_to_uvw.flat()).transpose();
    // limites no mundo
    const U = new THREE.Matrix4().fromArray((this.meta?.uvw_to_world || [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]).flat()).transpose();
    const b = new THREE.Box3();
    for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) b.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(U));
    this.box = b; b.getCenter(this.cursor);
    // plano de corte
    this.clip = { on: false, plane: new THREE.Plane(new THREE.Vector3(0, 0, 1), 0) };
    this.handle = new THREE.Object3D(); stage.scene.add(this.handle);
    this.tc = new TransformControls(stage.camera, stage.renderer.domElement);
    this.tc.setSize(0.85); this.tc.setSpace('local');
    this.tcHelper = this.tc.getHelper(); this.tcHelper.userData.noAO = true;
    this.tc.addEventListener('dragging-changed', (e) => { stage.controls.enabled = !e.value; });
    this.tc.addEventListener('objectChange', () => this._fromHandle());
    this.tc.addEventListener('change', () => stage.invalidate());
    this.clipQuad = null; this.onChange = null;
  }
  load() {
    if (this.ready) return this.ready;
    const m = this.meta; if (!m || m.available === false || !m.labels) return (this.ready = Promise.resolve(false));   // público: sem fatias
    const [ni, nj, nk] = m.dims;
    const get = (f) => fetchBuf('data/' + f);
    this.ready = Promise.all([this.hasCT ? get(m.ct) : null, get(m.labels)]).then(([ct, lab]) => {
      let t;
      if (ct) {
        t = new THREE.Data3DTexture(new Uint16Array(ct), ni, nj, nk);
        t.type = THREE.HalfFloatType; t.format = THREE.RedFormat; t.minFilter = t.magFilter = THREE.LinearFilter; t.unpackAlignment = 1; t.needsUpdate = true;
      } else {   // sem TC: textura 1×1×1 só para o sampler existir
        t = new THREE.Data3DTexture(new Uint8Array(1), 1, 1, 1); t.format = THREE.RedFormat; t.type = THREE.UnsignedByteType; t.needsUpdate = true;
      }
      this.uniforms.uHasCT.value = ct ? 1 : 0;
      const l = new THREE.Data3DTexture(new Uint8Array(lab), ni, nj, nk);
      l.format = THREE.RedFormat; l.type = THREE.UnsignedByteType; l.minFilter = l.magFilter = THREE.NearestFilter; l.unpackAlignment = 1; l.needsUpdate = true;
      this.uniforms.uCT.value = t; this.uniforms.uLab.value = l;
      this.updateLUT();
      return true;
    });
    return this.ready;
  }
  // LUT de rótulos → cor da estrutura exibida (segue substituições pelos viewer_assets)
  updateLUT() {
    const d = new Uint8Array(256 * 4);
    for (const r of this.C.label_table || []) {
      const def = this.C.structures.find((s) => s.id === r.struct); if (!def) continue;
      const shown = def.replacedBy ? this.C.structures.find((s) => s.id === def.replacedBy) || def : def;
      const it = this.S.items.get(shown.id);
      const c = new THREE.Color(shown.color || '#888888');
      const [R, G, B] = [c.r, c.g, c.b].map((x) => Math.round(x * 255));
      d.set([R, G, B, it && it.visible ? 255 : 110], r.id * 4);
    }
    const t = new THREE.DataTexture(d, 256, 1, THREE.RGBAFormat); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true;
    this.uniforms.uLUT.value?.dispose?.(); this.uniforms.uLUT.value = t; this.stage.invalidate();
  }
  _mat() { return new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: this.uniforms, side: THREE.DoubleSide, transparent: false, toneMapped: false }); }
  setOrtho(axes) {
    const size = this.box.getSize(new THREE.Vector3());
    for (const ax of ['ax', 'co', 'sa']) {
      const want = !!axes[ax];
      if (want && !this.planes[ax]) {
        let geo;
        if (ax === 'ax') { geo = new THREE.PlaneGeometry(size.x, size.z); geo.rotateX(-Math.PI / 2); }
        else if (ax === 'co') geo = new THREE.PlaneGeometry(size.x, size.y);
        else { geo = new THREE.PlaneGeometry(size.z, size.y); geo.rotateY(Math.PI / 2); }
        const m = new THREE.Mesh(geo, this._mat()); m.userData.noAO = true; m.renderOrder = 1; m.userData.slice = ax;
        this.planes[ax] = m; this.group.add(m);
      } else if (!want && this.planes[ax]) { this.group.remove(this.planes[ax]); this.planes[ax].geometry.dispose(); delete this.planes[ax]; }
    }
    this.setCursor(this.cursor);
  }
  setCursor(p) {
    this.cursor.copy(p).clamp(this.box.min, this.box.max);
    const c = this.box.getCenter(new THREE.Vector3());
    if (this.planes.ax) this.planes.ax.position.set(c.x, this.cursor.y, c.z);
    if (this.planes.co) this.planes.co.position.set(c.x, c.y, this.cursor.z);
    if (this.planes.sa) this.planes.sa.position.set(this.cursor.x, c.y, c.z);
    this.stage.invalidate();
  }
  setWindow(lo, hi) { this.uniforms.uWin.value.set(lo, hi); this.stage.invalidate(); }
  setMix(v) { this.uniforms.uMix.value = v; this.stage.invalidate(); }

  // ---- corte livre
  setClip(on, { p, n } = {}) {
    this.clip.on = on;
    if (p && n) this._setHandle(new THREE.Vector3(...p), new THREE.Vector3(...n));
    if (on) { this.tc.attach(this.handle); this.stage.scene.add(this.tcHelper); }
    else { this.tc.detach(); this.stage.scene.remove(this.tcHelper); }
    this._fromHandle();
  }
  _setHandle(p, n) { this.handle.position.copy(p); this.handle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n.clone().normalize()); this.handle.updateMatrixWorld(); }
  preset(kind, cam) {
    const t = this.handle.position.lengthSq() ? this.handle.position.clone() : this.cursor.clone();
    const N = { coronal: [0, 0, 1], axial: [0, -1, 0], sagital: [1, 0, 0] };
    let n = N[kind] ? new THREE.Vector3(...N[kind]) : cam.getWorldDirection(new THREE.Vector3());
    this._setHandle(t, n); this._fromHandle();
  }
  moveTo(p) { this._setHandle(p, this.normal()); this._fromHandle(); }
  flip() { this._setHandle(this.handle.position.clone(), this.normal().negate()); this._fromHandle(); }
  normal() { return new THREE.Vector3(0, 0, 1).applyQuaternion(this.handle.quaternion).normalize(); }
  setMode(m) { this.tc.setMode(m === 'rotate' ? 'rotate' : 'translate'); this.stage.invalidate(); }
  _fromHandle() {
    const n = this.normal(), p = this.handle.position;
    this.clip.plane.setFromNormalAndCoplanarPoint(n, p);
    this.S.setClip(this.clip.on ? [this.clip.plane] : []);
    this._updateQuad();
    if (this.onChange) this.onChange({ p: p.toArray().map((v) => +v.toFixed(1)), n: n.toArray().map((v) => +v.toFixed(4)) });
    this.stage.invalidate(true);
  }
  setClipCT(on) { this.clipCT = on; this._updateQuad(); }
  _updateQuad() {
    const want = this.clip.on && this.clipCT;
    if (want && !this.clipQuad) {
      const s = this.box.getSize(new THREE.Vector3()).length();
      this.clipQuad = new THREE.Mesh(new THREE.PlaneGeometry(s, s), this._mat()); this.clipQuad.userData.noAO = true; this.clipQuad.renderOrder = 2;
      this.group.add(this.clipQuad);
    } else if (!want && this.clipQuad) { this.group.remove(this.clipQuad); this.clipQuad.geometry.dispose(); this.clipQuad = null; }
    if (this.clipQuad) { this.clipQuad.position.copy(this.handle.position).addScaledVector(this.normal(), 0.05); this.clipQuad.quaternion.copy(this.handle.quaternion); }
    this.stage.invalidate();
  }
}
