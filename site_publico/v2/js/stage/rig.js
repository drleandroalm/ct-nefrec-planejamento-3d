// Câmera + camada de gestos própria (Pointer Events), no espírito da manipulação de objetos do AR Quick Look / RealityKit.
// Estado: alvo (pivô), orientação (quaternion, permite rolagem), distância. Posição = alvo + q·(0,0,1)·dist.
//  • 1 dedo / botão esquerdo: gira em torno dos eixos da TELA (guinada/arfagem), com inércia e desaceleração suave.
//  • pinça: zoom em direção ao ponto médio (o ponto sob os dedos fica parado), limites elásticos.
//  • 2 dedos arrastando: mover (pan). Torção de 2 dedos: rolagem em torno do eixo de visão.
//  • 3 dedos para os lados: vista nomeada anterior/seguinte. Toque duplo / toque longo / toque: callbacks.
//  • Animações por mola exponencial, interrompíveis: qualquer toque novo “pega” a câmera onde ela está.
// API compatível com o subconjunto de camera-controls usado no app: setLookAt, fitToSphere, rotate, updateCameraUp,
// getTarget, update(dt) → moveu?, addEventListener('rest'|'controlstart'|'control'|'controlend'), enabled.
import * as THREE from 'three';

const V3 = THREE.Vector3, Q = THREE.Quaternion;
const _v = new V3(), _v2 = new V3(), _q = new Q();
const Y = new V3(0, 1, 0);

export class CameraRig extends THREE.EventDispatcher {
  constructor(camera, dom) {
    super();
    this.camera = camera; this.dom = dom;
    this.enabled = true;
    this.minDistance = 30; this.maxDistance = 2600;
    this.rotateSpeed = 2.6;        // rad por largura de tela
    this.friction = 5.5;           // decaimento da inércia (1/s)
    this.springK = 11;             // rigidez da animação (1/s)
    this.target = new V3(); this.q = new Q(); this.dist = 900;
    this.goal = null;              // { target, q, dist }
    this.vel = { yaw: 0, pitch: 0, roll: 0, pan: new V3() };
    this.pointers = new Map();
    this.g = null;                 // gesto atual
    this.shouldIgnore = null;      // () => bool (ex.: gizmo do plano de corte ativo)
    this.cb = { tap: null, doubleTap: null, longPress: null, swipe3: null, hover: null };
    this._lastTap = null; this._moving = false; this._restT = 0; this._changed = true; this._elasticAt = null;
    this._fromCamera();
    this._bind();
  }

  // ------------------------------------------------ estado ↔ câmera
  _fromCamera() {
    const c = this.camera;
    this.q.copy(c.quaternion);
    this.target.copy(c.position).addScaledVector(_v.set(0, 0, -1).applyQuaternion(this.q), this.dist);
  }
  _apply() {
    const c = this.camera;
    c.quaternion.copy(this.q);
    c.position.copy(this.target).add(_v.set(0, 0, 1).applyQuaternion(this.q).multiplyScalar(this.dist));
    c.up.copy(Y).applyQuaternion(this.q);
    c.updateMatrixWorld();
  }
  getTarget(out = new V3()) { return out.copy(this.target); }
  getPosition(out = new V3()) { return out.copy(this.camera.position); }
  updateCameraUp() { /* setLookAt usa camera.up como “para cima” desejado */ }
  _poseLookAt(px, py, pz, tx, ty, tz) {
    const t = new V3(tx, ty, tz), p = new V3(px, py, pz);
    const m = new THREE.Matrix4().lookAt(p, t, this.camera.up.clone().normalize());
    return { target: t, q: new Q().setFromRotationMatrix(m), dist: Math.max(1e-3, p.distanceTo(t)) };
  }
  setLookAt(px, py, pz, tx, ty, tz, animate = false) {
    const pose = this._poseLookAt(px, py, pz, tx, ty, tz);
    this._stopInertia();
    if (animate) this.goal = pose;
    else { this.goal = null; this.target.copy(pose.target); this.q.copy(pose.q); this.dist = pose.dist; this._apply(); }
    this._changed = true;
    return Promise.resolve();
  }
  fitToSphere(sphere, animate = true) {
    const c = this.camera;
    const vfov = THREE.MathUtils.degToRad(c.fov) / 2, hfov = Math.atan(Math.tan(vfov) * c.aspect);
    const dist = this._clampDist((sphere.radius / Math.sin(Math.min(vfov, hfov))) * 1.05);
    const pose = { target: sphere.center.clone(), q: (this.goal?.q || this.q).clone(), dist };
    this._stopInertia();
    if (animate) this.goal = pose; else { this.goal = null; this.target.copy(pose.target); this.dist = dist; this._apply(); }
    this._changed = true;
    return Promise.resolve();
  }
  rotate(az, pol) { this._orbit(az, pol); this._changed = true; return Promise.resolve(); }
  _clampDist(d) { return Math.min(this.maxDistance, Math.max(this.minDistance, d)); }
  _stopInertia() { const v = this.vel; v.yaw = v.pitch = v.roll = 0; v.pan.set(0, 0, 0); }
  stop() { this._stopInertia(); this.goal = null; }
  get animating() { return !!this.goal || Math.abs(this.vel.yaw) + Math.abs(this.vel.pitch) + Math.abs(this.vel.roll) > 1e-4 || this.vel.pan.lengthSq() > 1e-4; }

  // ------------------------------------------------ primitivas
  _orbit(yaw, pitch) {
    const up = _v.set(0, 1, 0).applyQuaternion(this.q), right = _v2.set(1, 0, 0).applyQuaternion(this.q);
    _q.setFromAxisAngle(up, -yaw); this.q.premultiply(_q);
    _q.setFromAxisAngle(right, -pitch); this.q.premultiply(_q);
    this.q.normalize();
  }
  _roll(a) { _q.setFromAxisAngle(_v.set(0, 0, -1).applyQuaternion(this.q), a); this.q.premultiply(_q).normalize(); }
  _worldPerPixel() { return (2 * this.dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) / (this.dom.clientHeight || 1); }
  _pan(dxPx, dyPx) {
    const k = this._worldPerPixel();
    this.target.addScaledVector(_v.set(1, 0, 0).applyQuaternion(this.q), -dxPx * k).addScaledVector(_v2.set(0, 1, 0).applyQuaternion(this.q), dyPx * k);
  }
  _planePoint(x, y, out = new V3()) {
    const w = this.dom.clientWidth || 1, h = this.dom.clientHeight || 1, k = this._worldPerPixel();
    return out.copy(this.target).addScaledVector(_v.set(1, 0, 0).applyQuaternion(this.q), (x - w / 2) * k).addScaledVector(_v2.set(0, 1, 0).applyQuaternion(this.q), -(y - h / 2) * k);
  }
  // zoom multiplicativo (s < 1 aproxima) mantendo parado o ponto sob (x,y); elástico além dos limites
  _zoomAt(s, x, y, elastic = false) {
    const lo = this.minDistance, hi = this.maxDistance;
    let nd = this.dist * s;
    if (elastic) {
      // resistência: além do limite o excesso cresce só logaritmicamente (máx. ~35 %)
      const raw = nd;
      if (raw < lo && s < 1) { const over = Math.log(lo / Math.min(this.dist, lo)) + Math.log(1 / s); nd = lo * Math.exp(-0.35 * (1 - Math.exp(-over / 0.35))); nd = Math.min(nd, this.dist); }
      else if (raw > hi && s > 1) { const over = Math.log(Math.max(this.dist, hi) / hi) + Math.log(s); nd = hi * Math.exp(0.35 * (1 - Math.exp(-over / 0.35))); nd = Math.max(nd, this.dist); }
    } else nd = this._clampDist(nd);
    const P = this._planePoint(x, y, new V3());
    this.target.sub(P).multiplyScalar(nd / this.dist).add(P);
    this.dist = nd;
  }

  // ------------------------------------------------ laço
  update(dt) {
    dt = Math.min(dt, 0.2);   // aparelho lento: animações ainda convergem no tempo real
    let moved = this._changed; this._changed = false;
    const v = this.vel;
    if (!this.g) {
      const damp = Math.exp(-this.friction * dt);
      if (Math.abs(v.yaw) + Math.abs(v.pitch) > 1e-3) { this._orbit(v.yaw * dt, v.pitch * dt); v.yaw *= damp; v.pitch *= damp; moved = true; } else v.yaw = v.pitch = 0;
      if (Math.abs(v.roll) > 1e-3) { this._roll(v.roll * dt); v.roll *= damp; moved = true; } else v.roll = 0;
      if (v.pan.lengthSq() > 1e-2) { this.target.addScaledVector(v.pan, dt); v.pan.multiplyScalar(damp); moved = true; } else v.pan.set(0, 0, 0);
      if (!this.goal && (this.dist < this.minDistance - 1e-3 || this.dist > this.maxDistance + 1e-3)) {   // volta elástica
        const d = this._clampDist(this.dist), a = 1 - Math.exp(-this.springK * dt);
        const e = this._elasticAt || { x: (this.dom.clientWidth || 1) / 2, y: (this.dom.clientHeight || 1) / 2 };
        this._zoomAt((this.dist + (d - this.dist) * a) / this.dist, e.x, e.y, false);
        if (Math.abs(this.dist - d) < 0.05) { this.dist = d; this._elasticAt = null; }
        moved = true;
      }
    }
    if (this.goal) {
      const a = 1 - Math.exp(-this.springK * dt);
      this.target.lerp(this.goal.target, a); this.dist += (this.goal.dist - this.dist) * a; this.q.slerp(this.goal.q, a);
      moved = true;
      if (this.target.distanceTo(this.goal.target) < 0.02 && Math.abs(this.dist - this.goal.dist) < 0.02 && this.q.angleTo(this.goal.q) < 1e-4) {
        this.target.copy(this.goal.target); this.dist = this.goal.dist; this.q.copy(this.goal.q); this.goal = null;
      }
    }
    if (moved) { this._apply(); this._moving = true; this._restT = 0; }
    else if (this._moving && !this.g) { this._restT += dt; if (this._restT > 0.12) { this._moving = false; this.dispatchEvent({ type: 'rest' }); } }
    return moved;
  }

  // ------------------------------------------------ entrada
  _xy(e) { const r = this.dom.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  _bind() {
    const d = this.dom;
    d.style.touchAction = 'none';
    d.addEventListener('pointerdown', (e) => this._down(e));
    d.addEventListener('pointermove', (e) => this._move(e));
    d.addEventListener('pointerup', (e) => this._up(e));
    d.addEventListener('pointercancel', (e) => this._up(e, true));
    d.addEventListener('contextmenu', (e) => e.preventDefault());
    d.addEventListener('wheel', (e) => this._wheel(e), { passive: false });
    // Safari (macOS/iPadOS com trackpad): pinça/rotação
    d.addEventListener('gesturestart', (e) => { e.preventDefault(); if (this.g) return; this._sg = { s: 1, r: 0 }; this._startInteraction(); });
    d.addEventListener('gesturechange', (e) => {
      e.preventDefault(); if (!this._sg || !this.enabled || this.g) return; const p = this._xy(e);
      this._zoomAt(this._sg.s / e.scale, p.x, p.y, true); this._elasticAt = p; this._roll(-THREE.MathUtils.degToRad(e.rotation - this._sg.r));
      this._sg = { s: e.scale, r: e.rotation }; this._changed = true; this.dispatchEvent({ type: 'control' });
    });
    d.addEventListener('gestureend', (e) => { e.preventDefault(); if (!this._sg) return; this._sg = null; this._endInteraction(); });
  }
  _startInteraction(emit = true) { this.goal = null; this._stopInertia(); if (emit) this.dispatchEvent({ type: 'controlstart' }); }
  _endInteraction() { this.dispatchEvent({ type: 'controlend' }); this._changed = true; }
  _baseline() {
    const ps = [...this.pointers.values()], n = ps.length, g = this.g;
    g.n = n; g.cx = ps.reduce((a, p) => a + p.x, 0) / n; g.cy = ps.reduce((a, p) => a + p.y, 0) / n; g.t = g._evT || performance.now();
    if (n >= 2) { const [a, b] = ps; g.d = Math.hypot(b.x - a.x, b.y - a.y) || 1; g.ang = Math.atan2(b.y - a.y, b.x - a.x); }
  }
  _down(e) {
    if (e.pointerType === 'mouse' && e.button > 2) return;
    const p = this._xy(e);
    this.pointers.set(e.pointerId, { ...p, x0: p.x, y0: p.y, type: e.pointerType, button: e.button, shift: e.shiftKey, alt: e.altKey || e.ctrlKey || e.metaKey });
    try { this.dom.setPointerCapture(e.pointerId); } catch (_) {}
    if (!this.g) { this._startInteraction(false); this.g = { moved: false, maxN: 0, mode: null, swiped: false, sx: 0, samples: [] }; }
    this.g._evT = e.timeStamp || performance.now();
    this.g.maxN = Math.max(this.g.maxN, this.pointers.size);
    if (this.pointers.size > 1 && !this.g.moved) { this.g.moved = true; this.dispatchEvent({ type: 'controlstart' }); }   // 2+ dedos: é gesto
    this._baseline(); this.g.samples = [];
    clearTimeout(this._lp);
    if (this.pointers.size === 1) {
      const ev = { clientX: e.clientX, clientY: e.clientY, pointerType: e.pointerType };
      this._lp = setTimeout(() => { const g = this.g; if (g && !g.moved && this.pointers.size === 1) { g.longPressed = true; this.cb.longPress?.(ev); } }, 520);
    }
  }
  _move(e) {
    const pp = this.pointers.get(e.pointerId);
    if (!pp) { if (e.pointerType === 'mouse' && !e.buttons) this.cb.hover?.(e); return; }
    const p = this._xy(e); pp.x = p.x; pp.y = p.y;
    const g = this.g; if (!g) return;
    g._evT = e.timeStamp || performance.now();   // tempo do evento (não do processamento): inércia correta mesmo com o thread ocupado
    if (!g.moved && Math.hypot(pp.x - pp.x0, pp.y - pp.y0) > (e.pointerType === 'mouse' ? 3 : 7)) { g.moved = true; clearTimeout(this._lp); this._baseline(); if (!g.longPressed) this.dispatchEvent({ type: 'controlstart' }); return; }
    if (!g.moved || g.longPressed) return;
    if (!this.enabled || (g.mode == null && this.shouldIgnore?.())) { this._baseline(); g.blocked = true; return; }
    if (g.blocked) return;
    const ps = [...this.pointers.values()], n = ps.length;
    if (n !== g.n) this._baseline();
    const cx = ps.reduce((a, q) => a + q.x, 0) / n, cy = ps.reduce((a, q) => a + q.y, 0) / n;
    const dx = cx - g.cx, dy = cy - g.cy;
    const now = e.timeStamp || performance.now(), dt = Math.max(1, now - g.t) / 1000, W = this.dom.clientWidth || 1;
    if (n === 1) {
      const pan = pp.type === 'mouse' && (pp.button === 2 || pp.button === 1 || pp.shift);
      const roll = pp.type === 'mouse' && pp.alt && !pan;
      if (pan) { this._pan(dx, dy); this._track({ px: dx, py: dy }, dt); g.mode = 'pan'; }
      else if (roll) { const a = (dx / W) * Math.PI; this._roll(a); this._track({ roll: a }, dt); g.mode = 'roll'; }
      else { const yaw = (dx / W) * this.rotateSpeed, pitch = (dy / W) * this.rotateSpeed; this._orbit(yaw, pitch); this._track({ yaw, pitch }, dt); g.mode = 'orbit'; }
    } else if (n === 2) {
      const [a, b] = ps, dd = Math.hypot(b.x - a.x, b.y - a.y) || 1, ang = Math.atan2(b.y - a.y, b.x - a.x);
      let da = ang - g.ang; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
      this._pan(dx, dy);
      this._zoomAt(g.d / dd, cx, cy, true); this._elasticAt = { x: cx, y: cy };
      this._roll(-da);
      this._track({ px: dx, py: dy, roll: -da }, dt);
      g.d = dd; g.ang = ang; g.mode = 'two';
    } else {
      g.sx += dx; g.mode = 'swipe3';
      if (!g.swiped && Math.abs(g.sx) > Math.min(120, W * 0.12)) { g.swiped = true; this.cb.swipe3?.(g.sx > 0 ? -1 : 1); }
    }
    g.cx = cx; g.cy = cy; g.t = now;
    this._changed = true; this.dispatchEvent({ type: 'control' });
  }
  _track(s, dt) {
    const g = this.g, now = g._evT || performance.now();
    g.samples.push({ ...s, dt, t: now });
    while (g.samples.length && now - g.samples[0].t > 90) g.samples.shift();
  }
  _up(e, cancel = false) {
    const pp = this.pointers.get(e.pointerId); if (!pp) return;
    this.pointers.delete(e.pointerId);
    try { this.dom.releasePointerCapture(e.pointerId); } catch (_) {}
    const g = this.g; if (!g) return;
    clearTimeout(this._lp);
    if (this.pointers.size > 0) { this._baseline(); g.samples = []; return; }   // dedo removido: segue sem salto
    this.g = null;
    const now = e.timeStamp || performance.now();
    const recent = g.samples.filter((s) => now - s.t < 90);
    if (!cancel && !g.blocked && g.moved && g.mode !== 'swipe3' && recent.length && now - recent[recent.length - 1].t < 70) {
      const T = recent.reduce((a, s) => a + s.dt, 0) || 1, sum = (k) => recent.reduce((a, s) => a + (s[k] || 0), 0) / T;
      const v = this.vel, cap = 9, cl = (x) => THREE.MathUtils.clamp(x, -cap, cap);
      v.yaw = cl(sum('yaw')); v.pitch = cl(sum('pitch')); v.roll = cl(sum('roll'));
      const k = this._worldPerPixel(), px = sum('px'), py = sum('py');
      v.pan.set(0, 0, 0).addScaledVector(_v.set(1, 0, 0).applyQuaternion(this.q), -px * k).addScaledVector(_v2.set(0, 1, 0).applyQuaternion(this.q), py * k);
    }
    this._endInteraction();
    if (cancel || g.moved || g.longPressed || g.maxN > 1) return;
    const ev = { clientX: e.clientX, clientY: e.clientY, pointerType: e.pointerType };
    const lt = this._lastTap;
    if (lt && now - lt.t < 350 && Math.hypot(e.clientX - lt.x, e.clientY - lt.y) < 30) { this._lastTap = null; this.cb.doubleTap?.(ev); return; }
    this._lastTap = { t: now, x: e.clientX, y: e.clientY };
    this.cb.tap?.(ev);
  }
  _wheel(e) {
    if (!this.enabled) return;
    e.preventDefault();
    if (this.goal || this.animating) { this.goal = null; this._stopInertia(); }
    const p = this._xy(e);
    const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
    this._zoomAt(Math.exp(dy * (e.ctrlKey ? 0.01 : 0.0016)), p.x, p.y, false);   // ctrl+roda = pinça do trackpad
    this._changed = true;
    this.dispatchEvent({ type: 'controlstart' }); this.dispatchEvent({ type: 'control' });
    clearTimeout(this._wt); this._wt = setTimeout(() => this.dispatchEvent({ type: 'controlend' }), 150);
  }
}
