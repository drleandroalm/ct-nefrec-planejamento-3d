// Relações tumor ↔ estruturas: linhas de distância mínima (pontos mais próximos) e mapa de proximidade na superfície do tumor.
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { setHeatOn } from './structures.js';
import { h, fmt, fetchBuf } from '../core/util.js';

export const HEAT_PRESETS = [
  { id: 'vasos', label: 'Vasos confiáveis', test: (c) => c.reliable && c.category === 'vaso' },
  { id: 'orgaos', label: 'Órgãos', test: (c) => c.reliable && c.category === 'órgão' },
  { id: 'todos', label: 'Todas as estruturas confiáveis', test: (c) => c.reliable },
];
export const DEFAULT_LINES = ['inferior_vena_cava', 'aorta', 'portal_vein_and_splenic_vein'];

export class Relations {
  constructor(stage, structures, C) {
    this.stage = stage; this.S = structures; this.C = C;
    this.group = new THREE.Group(); this.group.name = 'relacoes'; this.group.userData.noAO = true; stage.scene.add(this.group);
    this.shells = new Map(); this.lines = new Map(); this.heatKey = null; this.ref = null; this.heatInfo = null;
    this.mats = [];
    stage.tickers.add(() => { this.group.traverse((o) => { if (o.userData.billboard) o.quaternion.copy(stage.camera.quaternion); }); return false; });
    stage.onRender.push(() => { const s = stage.renderer.getSize(new THREE.Vector2()); for (const m of this.mats) m.resolution.copy(s); });
    structures.on((ev, x) => { if (ev === 'loaded' && this.heatKey) { const tid = this.tumorId(); if (x.ids.includes(tid)) this.applyHeat(this.heatKey); } });
  }
  refs() { return Object.keys(this.C.distances?.by_tumor || {}); }
  tumorId(ref = this.ref) { return this.S.resolve(this.C.distances?.tumors?.[ref]) || null; }
  rows(ref = this.ref) { return (this.C.distances?.by_tumor?.[ref] || []); }
  setRef(ref) { this.ref = ref; }

  // ---------- linhas
  endpoints(row) {
    const a = row.assets && row.assets.p_tumor_world && row.assets.p_target_world ? row.assets : null;
    if (a) return { a: a.p_tumor_world, b: a.p_target_world, src: 'scene_manifest (COLAB) — pontos mais próximos máscara×máscara' };
    if (row.p_tumor_world && row.p_target_world) return { a: row.p_tumor_world, b: row.p_target_world, src: row.only_assets ? 'COLAB (scene_manifest) — pontos informados' : 'build_case (EDT das máscaras) — voxels mais próximos' };
    return null;
  }
  setLines(keys) {
    for (const [k, o] of this.lines) { this.group.remove(o.obj); o.dispose(); }
    this.lines.clear();
    for (const k of keys || []) {
      const row = this.rows().find((r) => r.key === k);
      if (!row || !row.available) continue;
      const ep = this.endpoints(row); if (!ep) continue;
      const o = this._makeLine(row, ep); this.group.add(o.obj); this.lines.set(k, o);
    }
    this.stage.invalidate();
  }
  _makeLine(row, ep) {
    const tgt = row.target_struct_id && this.S.item(row.target_struct_id);
    const col = new THREE.Color(tgt?.def.color || '#e8eef7');
    const a = new THREE.Vector3(...ep.a), b = new THREE.Vector3(...ep.b);
    const g = new THREE.Group(); g.userData.noAO = true;
    const contact = row.min_mm != null && (row.min_mm <= 1.5 || (row.overlap_ml || 0) > 0);
    const mk = (opts) => { const m = new LineMaterial({ color: col.getHex(), linewidth: 3, worldUnits: false, ...opts }); this.mats.push(m); return m; };
    const geo = new LineGeometry(); geo.setPositions([a.x, a.y, a.z, b.x, b.y, b.z]);
    const front = new Line2(geo, mk({})); front.computeLineDistances(); front.renderOrder = 40;
    const through = new Line2(geo, mk({ transparent: true, opacity: 0.38, depthTest: false, dashed: true, dashSize: 3, gapSize: 2.5 })); through.computeLineDistances(); through.renderOrder = 41;
    g.add(front, through);
    const sg = new THREE.SphereGeometry(contact ? 2.6 : 1.7, 16, 12);
    for (const [p, c] of [[a, new THREE.Color('#c2185b')], [b, col]]) {
      const m = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: c, depthTest: false, transparent: true, opacity: 0.95 })); m.position.copy(p); m.renderOrder = 42; g.add(m);
    }
    if (contact) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(5, 0.6, 8, 40), new THREE.MeshBasicMaterial({ color: 0xffe600, depthTest: false, transparent: true, opacity: 0.9 }));
      ring.position.copy(a); ring.renderOrder = 43; ring.userData.billboard = true; g.add(ring);
    }
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const text = `${row.label} · ${fmt(row.min_mm, 1)} mm`;
    const sub = contact ? (row.contact_note || '') : '';
    const el = h('div', { class: 'dlabel' + (contact ? ' contact' : '') }, h('i', { style: { background: col.getStyle() } }), h('b', {}, text), sub ? h('small', {}, sub) : null);
    const lab = new CSS2DObject(el); lab.position.copy(contact ? a : mid); lab.center.set(-0.08, 0.5); g.add(lab);
    return { obj: g, row, text, sub, world: (contact ? a : mid).clone(), color: col.getStyle(), dispose: () => { geo.dispose(); sg.dispose(); el.remove(); } };
  }
  labelsForCapture() { return [...this.lines.values()].map((o) => ({ text: o.text, sub: o.sub, world: o.world, color: o.color })); }

  // ---------- mapa de proximidade
  shellFor(ref) {
    const hs = this.C.heat_shell || {};
    const tid = this.tumorId(ref); const tdef = this.S.items.get(tid)?.def;
    for (const [k, m] of Object.entries(hs)) if (k === ref || (tdef && m.tumor_mask === tdef.mask_file)) return { key: k, meta: m };
    return null;
  }
  async loadShell(ref) {
    const sh = this.shellFor(ref); if (!sh) return null;
    if (sh.meta.baked) return { meta: sh.meta, baked: sh.meta.baked, C: sh.meta.channels.length };   // público: valores já nos vértices
    if (this.shells.has(sh.key)) return this.shells.get(sh.key);
    const p = fetchBuf('data/' + sh.meta.file).then((buf) => {
      const n = sh.meta.n, C = sh.meta.channels.length;
      return { meta: sh.meta, n, C, lin: new Uint32Array(buf, 0, n), d: new Uint8Array(buf, 4 * n, n * C) };
    });
    this.shells.set(sh.key, p);
    return p;
  }
  channelsFor(preset, meta) {
    if (preset && preset.startsWith('k:')) { const k = preset.slice(2); return meta.channels.map((c, i) => (c.key === k ? i : -1)).filter((i) => i >= 0); }
    const P = HEAT_PRESETS.find((p) => p.id === preset) || HEAT_PRESETS[0];
    return meta.channels.map((c, i) => (P.test(c) ? i : -1)).filter((i) => i >= 0);
  }
  async applyHeat(preset) {
    this.heatKey = preset;
    const tid = this.tumorId(); const it = this.S.items.get(tid);
    for (const x of this.S.items.values()) setHeatOn(x.solid, false);
    if (!preset || !it) { this.heatInfo = null; this.stage.invalidate(); return null; }
    const sh = await this.loadShell(this.ref);
    if (!sh) { this.heatInfo = { error: 'sem campo de distância para este tumor' }; return this.heatInfo; }
    const ch = this.channelsFor(preset, sh.meta);
    if (sh.baked) return this._applyBaked(it, tid, preset, sh, ch);
    const inv = new THREE.Matrix4().fromArray(this.C.slices.ras_to_ijk.flat()).transpose();
    const O = this.C.frame.centre_offset; const [NI, NJ] = this.C.grid.shape;
    const v = new THREE.Vector3(); let miss = 0, total = 0, hist = [0, 0, 0, 0];
    const look = (i, j, k) => {
      const key = i + NI * (j + NJ * k); let lo = 0, hi = sh.n - 1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; const x = sh.lin[mid]; if (x === key) return mid; if (x < key) lo = mid + 1; else hi = mid - 1; }
      return -1;
    };
    const valAt = (idx) => { let m = 255; for (const c of ch) { const q = sh.d[idx * sh.C + c]; if (q < m) m = q; } return m; };
    for (const mesh of it.meshes) {
      const pos = mesh.geometry.attributes.position; const n = pos.count;
      const arr = new Float32Array(n);
      mesh.updateMatrixWorld();
      for (let q = 0; q < n; q++) {
        v.fromBufferAttribute(pos, q).applyMatrix4(mesh.matrixWorld);
        const r = new THREE.Vector3(v.x + O[0], -(v.z + O[2]), v.y + O[1]).applyMatrix4(inv);
        const i = Math.round(r.x), j = Math.round(r.y), k = Math.round(r.z);
        let idx = look(i, j, k), best = 255;
        if (idx >= 0) best = valAt(idx);
        else {
          for (let dk = -1; dk <= 1; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
            const id2 = look(i + di, j + dj, k + dk); if (id2 >= 0) { const vv = valAt(id2); if (vv < best) best = vv; idx = id2; }
          }
        }
        total++;
        if (idx < 0) { arr[q] = -1; miss++; continue; }
        const mm = best >= 255 ? 99 : best / 8;
        arr[q] = mm; hist[mm < 2 ? 0 : mm < 5 ? 1 : mm < 10 ? 2 : 3]++;
      }
      mesh.geometry.setAttribute('aDist', new THREE.BufferAttribute(arr, 1));
    }
    setHeatOn(it.solid, true);
    this.heatInfo = { preset, channels: ch.map((i) => sh.meta.channels[i]), miss, total, hist, meta: sh.meta, tumor: tid };
    this.stage.invalidate();
    return this.heatInfo;
  }
  // perfil público: distâncias assadas no build em atributos _HEAT0.._HEATn (uint8 mm×8) dos vértices da própria malha
  _applyBaked(it, tid, preset, sh, ch) {
    const B = sh.baked; let miss = 0, total = 0; const hist = [0, 0, 0, 0];
    for (const mesh of it.meshes) {
      const at = B.attrs.map((n) => mesh.geometry.attributes[n]);
      const n = mesh.geometry.attributes.position.count; const arr = new Float32Array(n);
      if (at.some((a) => !a || a.count !== n)) { arr.fill(-1); miss += n; total += n; mesh.geometry.setAttribute('aDist', new THREE.BufferAttribute(arr, 1)); continue; }
      const fs = B.found_slot, fa = at[fs >> 2].array, fo = fs & 3;
      for (let q = 0; q < n; q++) {
        total++;
        if (!fa[q * 4 + fo]) { arr[q] = -1; miss++; continue; }
        let m = 255; for (const c of ch) { const v = at[c >> 2].array[q * 4 + (c & 3)]; if (v < m) m = v; }
        const mm = m >= 255 ? 99 : m / 8; arr[q] = mm; hist[mm < 2 ? 0 : mm < 5 ? 1 : mm < 10 ? 2 : 3]++;
      }
      mesh.geometry.setAttribute('aDist', new THREE.BufferAttribute(arr, 1));
    }
    setHeatOn(it.solid, true);
    this.heatInfo = { preset, channels: ch.map((i) => sh.meta.channels[i]), miss, total, hist, meta: sh.meta, tumor: tid, baked: true };
    this.stage.invalidate();
    return this.heatInfo;
  }
}
