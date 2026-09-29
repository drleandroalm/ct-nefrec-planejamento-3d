// MPR 2D (Niivue): convenção radiológica, rótulos das estruturas, cursor sincronizado com o 3D.
// Perfil público (fase labelsOnly): base = mapa de rótulos em cinza apagado (fundo escuro), sem nenhuma intensidade de TC;
// índices 1 (rótulos) e 2 (GT Leo) seguem iguais ao perfil local.
import { hexToRgb, vurl, staticEntry, fetchBuf, niftiFromRaw } from './core/util.js';
// site estático: volume publicado como raw gzip + metadados mínimos → NIfTI montado no navegador (blob:)
const _blobs = new Map();
async function vol(u, o) {
  const e = staticEntry(u);
  if (e && e.nifti) {
    const url = URL.createObjectURL(niftiFromRaw(await fetchBuf(u), e.nifti));
    _blobs.set(url, true);   // revogado depois que o Niivue ler (libera a cópia do blob)
    return { url, name: e.nifti.name || 'volume.nii', ...o };
  }
  return { url: vurl(u), name: u.split('/').pop(), ...o };
}

export class MPR {
  constructor(canvas, C, { onCursor } = {}) {
    this.canvas = canvas; this.C = C; this.onCursor = onCursor; this.nv = null; this.ready = null; this._guard = false; this.phase = null;
  }
  get labelsOnly() { return !!this.phase?.labelsOnly || this.C.ct_publicada === false; }
  get O() { return this.C.frame.centre_offset; }
  worldToRAS(w) { const O = this.O; return [w[0] + O[0], -(w[2] + O[2]), w[1] + O[1]]; }
  rasToWorld(r) { const O = this.O; return [r[0] - O[0], r[2] - O[1], -r[1] - O[2]]; }
  init(phaseId = 'venous', win) {
    if (this.ready) return this.ready;
    const NV = window.niivue;
    if (!NV) return (this.ready = Promise.reject(new Error('Niivue ausente')));
    const nv = (this.nv = new NV.Niivue({
      isRadiologicalConvention: true, backColor: [0.035, 0.04, 0.055, 1], crosshairColor: [0.24, 0.84, 0.78, 1], crosshairWidth: 1,
      multiplanarShowRender: NV.SHOW_RENDER.NEVER, multiplanarLayout: NV.MULTIPLANAR_TYPE.ROW, isColorbar: false, show3Dcrosshair: false,
      textHeight: 0.035, fontColor: [0.85, 0.9, 0.95, 1], isOrientationTextVisible: true, loadingText: this.C.ct_publicada === false ? 'Carregando rótulos…' : 'Carregando TC…', dragAndDropEnabled: false,
      logLevel: 'error',
    }));
    this.ready = nv.attachToCanvas(this.canvas).then(async () => {
      nv.setSliceType(nv.sliceTypeMultiplanar);
      this._gestures();
      nv.onLocationChange = (d) => { if (this._guard || !d || !d.mm) return; this.onCursor && this.onCursor(this.rasToWorld([d.mm[0], d.mm[1], d.mm[2]]), d); };
      await this.loadPhase(phaseId, win);
      return true;
    });
    return this.ready;
  }
  async loadPhase(id, win) {
    const ph = (this.C.phases || []).find((p) => p.id === id) || this.C.phases[0];
    const nv = this.nv; const keep = nv.volumes.length ? [...nv.scene.crosshairPos] : null;
    while (nv.volumes.length) nv.removeVolume(nv.volumes[nv.volumes.length - 1]);
    // sem TC: o próprio mapa de rótulos vira a base com janela enorme (tudo praticamente preto) só para dar grade/cursor
    const specs = [[ph.url, ph.labelsOnly ? { colormap: 'gray', cal_min: 0, cal_max: 100000, opacity: 1 } : { colormap: 'gray', cal_min: win?.lo ?? -160, cal_max: win?.hi ?? 240, opacity: 1 }]];
    const registered = !ph.note;
    if (registered) specs.push(['data/labels_v2.nii.gz', { opacity: ph.labelsOnly ? 0.9 : 0.42 }]);
    if (registered && this.C.leo?.stage) specs.push(['data/labels_leo.nii.gz', { opacity: 0.6 }]);
    const vols = []; for (const [u, o] of specs) vols.push(await vol(u, o));   // em sequência: pico de memória menor (iPad)
    await nv.loadVolumes(vols);
    for (const b of _blobs.keys()) URL.revokeObjectURL(b); _blobs.clear();
    if (registered && nv.volumes[1]) this.applyLabels();
    if (registered && nv.volumes[2]) this.applyLeoLabels();
    this.phase = ph;
    if (keep) { nv.scene.crosshairPos = keep; nv.drawScene(); }
    return ph;
  }
  applyLabels(visibleIds, knownIds) {
    const nv = this.nv; const v = nv?.volumes[1]; if (!v) return;
    const tbl = this.C.label_table || []; const maxId = Math.max(0, ...tbl.map((r) => r.id));
    const R = [], G = [], B = [], A = [], I = [], labels = [];
    for (let i = 0; i <= maxId; i++) { R.push(0); G.push(0); B.push(0); A.push(0); I.push(i); labels.push(''); }
    for (const r of tbl) {
      const def = this.C.structures.find((s) => s.id === r.struct); if (!def) continue;
      const shown = def.replacedBy ? this.C.structures.find((s) => s.id === def.replacedBy) || def : def;
      const [rr, gg, bb] = hexToRgb(shown.color || '#888888');
      const on = !visibleIds || visibleIds.has(shown.id) || (knownIds && !knownIds.has(shown.id));
      R[r.id] = rr; G[r.id] = gg; B[r.id] = bb; A[r.id] = on ? 255 : 0; labels[r.id] = shown.label || '';
    }
    v.setColormapLabel({ R, G, B, A, I, labels });
    nv.updateGLVolume();
  }
  applyLeoLabels(visible = true) {
    const nv = this.nv; const v = nv?.volumes[2]; if (!v) return;
    const R = [0], G = [0], B = [0], A = [0], I = [0], labels = [''];
    ['kidney_left', 'tumor', 'collecting_system'].forEach((k, n) => {
      const d = this.C.structures.find((s) => s.id === 'leo:' + k);
      const [r, g, b] = hexToRgb(d?.color || '#ffffff');
      R.push(r); G.push(g); B.push(b); A.push(d && visible ? 255 : 0); I.push(n + 1); labels.push(d ? d.label + ' (GT Leo)' : '');
    });
    v.setColormapLabel({ R, G, B, A, I, labels }); nv.updateGLVolume();
  }
  // estado do corte axial k no desenho do Leo
  leoSliceStatus(k) {
    const L = this.C.leo; if (!L || !L.drawn_k_range) return null;
    const [a, b] = L.drawn_k_range;
    if (k < a || k > b) return 'fora da região desenhada pelo Leo';
    if ((L.interp_slices_k || []).includes(k)) return 'corte INTERPOLADO (não desenhado pelo Leo)';
    return 'corte desenhado pelo Leo';
  }
  setWindow(lo, hi) { if (this.labelsOnly) return; const v = this.nv?.volumes[0]; if (!v) return; v.cal_min = lo; v.cal_max = hi; this.nv.updateGLVolume(); }
  setCursorWorld(w) {
    const nv = this.nv; if (!nv || !nv.volumes.length) return;
    const r = this.worldToRAS(w);
    this._guard = true;
    try { nv.scene.crosshairPos = nv.mm2frac(r); nv.drawScene(); } finally { this._guard = false; }
  }
  resize() { if (this.nv) { this.nv.resizeListener(); } }

  // pinça/2 dedos no MPR: zoom em direção ao ponto médio e mover; 1 dedo continua com o Niivue (cursor). Ctrl+roda = zoom.
  _gestures() {
    const cv = this.canvas, nv = this.nv; let g = null;
    const pos = (t) => { const r = cv.getBoundingClientRect(), k = nv.uiData?.dpr || window.devicePixelRatio || 1; return [(t.clientX - r.left) * k, (t.clientY - r.top) * k]; };
    const mid = (ts) => { const a = pos(ts[0]), b = pos(ts[1]); return { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1 }; };
    const zoomAt = (z, x, y) => {
      const z0 = nv.scene.pan2Dxyzmm[3]; const zn = Math.min(12, Math.max(0.6, z));
      const before = nv.screenXY2mm(x, y);
      nv.scene.pan2Dxyzmm[3] = zn; nv.drawScene();
      const after = nv.screenXY2mm(x, y);
      if (before && after && !isNaN(before[0]) && !isNaN(after[0])) for (let i = 0; i < 3; i++) nv.scene.pan2Dxyzmm[i] += zn * (after[i] - before[i]);
      nv.drawScene(); return z0 !== zn;
    };
    const pan = (x0, y0, x1, y1) => { nv.uiData.pan2DxyzmmAtMouseDown = [...nv.scene.pan2Dxyzmm]; nv.dragForPanZoom([x0, y0, x1, y1]); nv.drawScene(); };
    const start = (e) => { if (e.touches.length < 2) return; e.preventDefault(); e.stopImmediatePropagation(); g = mid(e.touches); };
    const move = (e) => {
      if (e.touches.length < 2 || !g) return; e.preventDefault(); e.stopImmediatePropagation();
      const m = mid(e.touches);
      pan(g.x, g.y, m.x, m.y);
      zoomAt(nv.scene.pan2Dxyzmm[3] * (m.d / g.d), m.x, m.y);
      g = m; this.gestureCount = (this.gestureCount || 0) + 1;
    };
    const end = (e) => { if (!g) return; e.stopImmediatePropagation(); if (e.touches.length < 2) g = null; else g = mid(e.touches); };
    cv.addEventListener('touchstart', start, { capture: true, passive: false });
    cv.addEventListener('touchmove', move, { capture: true, passive: false });
    cv.addEventListener('touchend', end, { capture: true, passive: false });
    cv.addEventListener('touchcancel', end, { capture: true, passive: false });
    cv.addEventListener('wheel', (e) => { if (!e.ctrlKey) return; e.preventDefault(); e.stopImmediatePropagation(); const p = pos(e); zoomAt(nv.scene.pan2Dxyzmm[3] * Math.exp(-e.deltaY * 0.01), p[0], p[1]); }, { capture: true, passive: false });
    cv.style.touchAction = 'none';
  }
  resetZoom() { if (!this.nv) return; this.nv.scene.pan2Dxyzmm = [0, 0, 0, 1]; this.nv.drawScene(); }
}
