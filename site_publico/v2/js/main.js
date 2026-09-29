// Nefrec v2 — inicialização e orquestração.
import * as THREE from 'three';
import { h, $, fmt, isTouch, svg, clear, nowBRT, setCacheKeys, setStaticMap } from './core/util.js';
import * as store from './core/store.js';
import { Stage } from './stage/stage.js';
import { Structures, setMaterialSpec } from './stage/structures.js';
import { Views, VIEWS, AXES } from './stage/views.js';
import { Relations } from './stage/relations.js';
import { Slices, WINDOWS } from './stage/slices.js';
import { MPR } from './mpr.js';
import { LayersPanel, badgesFor } from './ui/layers.js';
import { RightPanel } from './ui/relpanel.js';
import { Palette } from './ui/palette.js';
import { capture } from './ui/capture.js';
import { PathTracer, ptSupported } from './stage/pathtrace.js';

const state = store.state;
const app = $('#app');
const splash = (p, msg) => { $('#splashBar').style.width = Math.round(p * 100) + '%'; if (msg) $('#splashMsg').textContent = msg; };
const toast = (msg, ms = 4200) => { const t = h('div', { class: 'toast' }, msg); $('#toasts').append(t); setTimeout(() => t.remove(), ms); };

async function boot() {
  splash(0.05, 'Carregando dados do caso…');
  const C = await (await fetch('data/case.json', { cache: 'no-cache' })).json();
  setCacheKeys(C.cache_keys); setStaticMap(C.static_files);
  // perfil público: nenhuma imagem de TC publicada → fatias/MPR só com rótulos e aviso visível
  const NOCT = C.ct_publicada === false;
  if (NOCT) {
    document.documentElement.classList.add('no-ct');
    const m = document.querySelector('.brand .muted'); if (m) m.textContent = '· Planejamento cirúrgico · versão pública: modelos 3D e rótulos, sem imagens de TC';
    const lay = document.getElementById('laySplit'); if (lay) lay.hidden = true;   // sem MPR 2D no público
  }
  const restored = store.load();
  const touch = isTouch();
  const lowPower = touch || Math.min(screen.width, screen.height) < 900;
  document.documentElement.classList.toggle('touch', touch);
  const lod = state.lod || (lowPower ? 'lite' : 'full');

  const stage = new Stage($('#stage'), { lowPower });
  setMaterialSpec(C.material_spec);
  const S = new Structures(stage, C);
  stage.loadHDRI('vendor/hdri/studio_small_09_1k.hdr', C.material_spec?.environment_intensity);
  const V = new Views(stage, S, C);
  const R = new Relations(stage, S, C);
  const SL = new Slices(stage, S, C);
  let mpr = null;

  // estado persistido → estruturas
  for (const [id, v] of Object.entries(state.vis || {})) { const it = S.items.get(id); if (it) it.visible = !!v; }
  for (const [id, v] of Object.entries(state.op || {})) { const it = S.items.get(id); if (it) it.opacity = +v; }
  for (const [id, v] of Object.entries(state.ghost || {})) { const it = S.items.get(id); if (it) it.ghost = !!v; }
  S.xray = !!state.xray; S.isolated = S.items.has(state.isolate) ? state.isolate : null;
  R.setRef(state.relRef && R.refs().includes(state.relRef) ? state.relRef : (C.leo?.relations_default && R.refs().includes(C.leo.relations_default) ? C.leo.relations_default : R.refs()[0]));
  if (!state.lines) state.lines = restored ? [] : ['inferior_vena_cava', 'aorta', 'portal_vein_and_splenic_vein'];

  const syncStructState = () => {
    const vis = {}, op = {}, ghost = {};
    for (const it of S.items.values()) {
      if (it.visible !== !!it.def.defaultOn) vis[it.id] = it.visible;
      const op0 = it.def.reliable ? (it.def.opacity ?? 1) : Math.min(it.def.opacity ?? 1, 0.7);
      if (Math.abs(it.opacity - op0) > 0.01) op[it.id] = it.opacity;
      if (it.ghost) ghost[it.id] = true;
    }
    state.vis = vis; state.op = op; state.ghost = ghost; state.xray = S.xray; state.isolate = S.isolated; store.save();
    SL.updateLUT(); if (mpr) { mpr.applyLabels(new Set(S.visibleIds()), new Set(S.items.keys())); mpr.applyLeoLabels([...S.items.values()].some((i) => i.def.source === 'leo' && !i.def.proposal && i.visible)); }
    updateBadges();
  };

  // ---------- carregamento
  const assetsOk = !!(C.assets && C.assets.ok);
  const first = new Set(S.neededFiles(true));
  if (assetsOk) first.add('assets:main');
  const firstList = [...first];
  let done = 0;
  splash(0.15, assetsOk ? 'Carregando malhas (versão leve)…' : 'Carregando malhas…');
  await Promise.all(firstList.map((fk) => S.ensureFile(fk, fk === 'assets:main' ? 'lite' : undefined).then(() => { done++; splash(0.15 + 0.7 * (done / firstList.length)); })));
  S.lod = 'lite';
  S.applyAll();
  const scBox = S.boxOf(S.visibleIds(true)); stage.fitShadow(scBox);

  // ---------- câmera inicial
  if (state.cam && restored) { V.set(state.view || 'anterior', false); stage.controls.setLookAt(...state.cam, false); }
  else V.set(state.view || 'anterior', false);
  let camSaveT = 0;
  stage.controls.addEventListener('rest', () => { const p = stage.camera.position, t = stage.controls.getTarget(new THREE.Vector3()); state.cam = [p.x, p.y, p.z, t.x, t.y, t.z]; clearTimeout(camSaveT); camSaveT = setTimeout(() => store.save(), 200); });
  stage.controls.addEventListener('controlstart', () => { if (V.current) { V.current = null; renderDock(); updateBadges(); } });

  // ---------- API p/ UI
  const ctx = {
    C, S, V, R, SL, stage, state,
    setState: (k, v) => store.set(k, v),
    changed: syncStructState,
    select: (id) => { S.select(id); state.selected = id; },
    focus: (ids) => V.focus(ids),
    isolate: (id) => { S.isolate(id); syncStructState(); },
    toggleXray: () => { S.setXray(!S.xray); syncStructState(); },
    resetLayers: () => { for (const it of S.items.values()) { it.visible = !!it.def.defaultOn; it.opacity = it.def.reliable ? (it.def.opacity ?? 1) : Math.min(it.def.opacity ?? 1, 0.7); it.ghost = S.defaultGhost(it.def); if (it.visible && !it.loaded && it.def.file) S.ensureFile(it.def.file); } S.xray = false; S.isolated = null; S.applyAll(); syncStructState(); },
    setRef: async (ref) => { R.setRef(ref); store.set('relRef', ref); if ((state.lines || []).length || state.heat) await ensureRefVisible(); R.setLines(state.lines); if (state.heat) await ctx.setHeat(state.heat); right.render(); },
    setHeat: async (preset) => {
      store.set('heat', preset || null);
      if (preset) await ensureRefVisible();
      const info = await R.applyHeat(preset || null);
      right.render(); updateBadges();
      return info;
    },
    toggleLine: async (k, on) => { const s = new Set(state.lines || []); on ? s.add(k) : s.delete(k); await ctx.setLines([...s]); },
    setLines: async (keys) => { store.set('lines', keys); if (keys.length) await ensureRefVisible(); R.setLines(keys); right.render(); updateBadges(); },
    setClip: (p) => {
      const was = state.clip.on; store.patch('clip', p);
      if ('on' in p) {
        if (p.on && !was && !state.clip.p) { const c = C.tumor_facts?.[R.ref]?.centroid_world || [0, 0, 0]; SL.setClip(true, { p: c, n: [0, 0, 1] }); }
        else SL.setClip(!!p.on);
      }
      if ('mode' in p) SL.setMode(p.mode);
      if ('ct' in p && !NOCT) { SL.setClipCT(!!p.ct); if (p.ct) SL.load(); }
      if (right.tab === 'cut') right.render(); updateBadges();
    },
    clipPreset: (k) => { if (!state.clip.on) ctx.setClip({ on: true }); SL.preset(k, stage.camera); },
    clipFlip: () => SL.flip(),
    clipToCursor: () => SL.moveTo(SL.cursor.clone()),
    setSlices: (p) => {
      if (NOCT) { if (p.on) toast(C.ct_nota || 'Imagens de TC não são publicadas; disponíveis só na versão local.'); return; }
      store.patch('sl', p);
      const sl = state.sl;
      if ('mix' in p) SL.setMix(p.mix);
      if (sl.on) SL.load().then((ok) => { if (ok) SL.setOrtho({ ax: sl.ax, co: sl.co, sa: sl.sa }); });
      else SL.setOrtho({});
      if (right.tab === 'cut' && ('on' in p || 'ax' in p || 'co' in p || 'sa' in p)) right.render();
      updateBadges();
    },
    setCursor: (w, from) => {
      const v = new THREE.Vector3(...w); SL.setCursor(v); state.sl = { ...state.sl, cur: SL.cursor.toArray().map((x) => +x.toFixed(1)) }; store.save();
      if (mpr && from !== 'mpr') mpr.setCursorWorld(SL.cursor.toArray());
      const ras = mprRAS(SL.cursor.toArray());
      $('#mprPos').textContent = `RAS ${ras.map((x) => fmt(x, 1)).join(' · ')} mm`;
      mprStatus(Math.round((ras[2] - C.grid.affine[2][3]) / C.grid.affine[2][2]));
    },
    setWindow: (k) => { const w = WINDOWS[k] || WINDOWS.soft; store.set('win', k); SL.setWindow(w.lo, w.hi); if (mpr) mpr.setWindow(w.lo, w.hi); if (right.tab === 'cut') right.render(); },
    setLayout: (l) => setLayout(l),
    lodLabel: () => (S.lod === 'full' ? 'malhas completas (LOD0, comprimidas meshopt)' : 'malhas leves (LOD2, comprimidas meshopt)'),
    captureMeta: () => {
      const v = V.current ? VIEWS.find((x) => x.id === V.current) : null;
      const vis = [...S.items.values()].filter((i) => i.visible);
      const tum = vis.filter((i) => i.def.kind === 'tumor').map((i) => `${i.def.label} [${i.def.source === 'leo' ? (i.def.proposal ? 'GT Leo, proposta refinada' : 'GT Leo ' + (C.leo?.stage || '')) : i.def.badge}${S.effGhost(i) ? ', fantasma' : ''}]`);
      const unrel = vis.filter((i) => !i.def.reliable).length;
      const modes = [];
      if (state.heat) modes.push('mapa de proximidade: ' + (R.heatInfo?.channels || []).map((c) => c.label).join(', '));
      if ((state.lines || []).length) modes.push(`${state.lines.length} linha(s) de distância a partir do tumor ${R.ref === 'leo' ? 'GT Leo' : 'da fusão'}`);
      if (state.clip.on) modes.push('plano de corte');
      if (unrel) modes.push(`${unrel} camada(s) NÃO CONFIÁVEL(IS) visível(is)`);
      return { view: v ? v.label + (v.proposal ? ' (proposta, a confirmar com o Leo)' : '') : 'livre', viewId: v ? v.id : 'livre', layers: [`${vis.length} estruturas`, ...tum, ...modes].join(' · ') };
    },
  };
  async function ensureRefVisible() {
    const tid = R.tumorId(); const it = S.items.get(tid); if (!it) return;
    let msg = null;
    if (!it.visible || it.ghost) { it.visible = true; it.ghost = false; }
    if (!it.loaded && it.def.file) await S.ensureFile(it.def.file);
    for (const o of S.items.values()) if (o.def.kind === 'tumor' && o.id !== tid && o.visible && !o.ghost) { o.ghost = true; msg = `Relações medidas a partir de: ${it.def.label} (${o.def.source === 'leo' ? 'Fusão' : 'GT Leo'} em modo fantasma para comparação).`; }
    S.applyAll(); syncStructState();
    if (msg) toast(msg);
  }
  function mprStatus(k) {
    const el = $('#mprLeo'); if (!el) return;
    const st = mpr ? mpr.leoSliceStatus(k) : null;
    el.textContent = st ? `axial k ${k}: ${st}` : ''; el.className = 'mono ' + (st && st.includes('INTERPOLADO') ? 'warn' : 'muted');
  }
  const mprRAS = (w) => { const O = C.frame.centre_offset; return [w[0] + O[0], -(w[2] + O[2]), w[1] + O[1]]; };

  // ---------- UI
  const layers = new LayersPanel($('#left'), S, C, ctx);
  const right = new RightPanel($('#right'), ctx);
  S.on((ev) => { if (ev === 'state' || ev === 'loaded') updateBadges(); });

  function renderDock() {
    const d = clear($('#views'));
    VIEWS.forEach((v, i) => {
      if (v.id === 'flanco') d.append(h('span', { class: 'sepv' }));
      d.append(h('button', { class: V.current === v.id ? 'on' : '', title: `${v.label} (${v.key})${v.note ? ' — ' + v.note : ''}`, onclick: () => setView(v.id) }, v.label, v.proposal ? h('sup', {}, 'proposta') : null));
    });
    d.append(h('span', { class: 'sepv' }), h('button', { title: 'Enquadrar estruturas visíveis (0)', onclick: () => V.focus(S.visibleIds(true)) }, 'Enquadrar'));
  }
  function setView(id, animate = true) { V.set(id, animate); store.set('view', id); state.cam = null; renderDock(); updateBadges(); const v = V.byId(id); if (v?.proposal) toast(v.note, 5200); }
  renderDock();

  function updateBadges() {
    const b = clear($('#badges'));
    const v = V.current && V.byId(V.current);
    if (v?.proposal) b.append(h('span', { class: 'badge prop' }, `${v.label}: proposta, a confirmar com o Leo`));
    if (S.isolated) b.append(h('span', { class: 'badge' }, 'Isolado: ' + (S.items.get(S.isolated)?.def.label || '')));
    if (S.xray) b.append(h('span', { class: 'badge' }, 'Modo raio-X'));
    if (state.clip.on) b.append(h('span', { class: 'badge' }, 'Plano de corte ativo'));
    if (state.heat && R.heatInfo?.channels) b.append(h('span', { class: 'badge' }, 'Mapa: ' + R.heatInfo.channels.map((c) => c.label).join(', ')));
    const unrel = [...S.items.values()].filter((i) => i.visible && !i.def.reliable);
    if (unrel.length) b.append(h('span', { class: 'badge bad' }, `Visível camada não confiável: ${unrel.map((i) => i.def.label).join(', ')}`));
    const leoT = [...S.items.values()].find((i) => i.def.source === 'leo' && i.def.key === 'tumor' && !i.def.proposal && i.visible);
    if (leoT) b.append(h('span', { class: 'badge leo' }, `Tumor: GT Leo (${C.leo?.stage || ''})`));
    if ([...S.items.values()].some((i) => i.def.proposal && i.visible)) b.append(h('span', { class: 'badge prop' }, 'Visível: proposta refinada do GT Leo'));
  }
  updateBadges();

  // ---------- orientação + gizmo
  const giz = $('#gizmo'); const orient = $('#orient');
  const AX = [[1, 0, 0, 'D', 'E', '#ff7a7a'], [0, 1, 0, 'S', 'I', '#7ddc8a'], [0, 0, -1, 'A', 'P', '#6cb6ff']];
  let lastO = '';
  stage.onRender.push(() => {
    const q = stage.camera.quaternion.clone().invert();
    const ends = [];
    for (const [x, y, z, pos, neg, col] of AX) {
      const v = new THREE.Vector3(x, y, z).applyQuaternion(q);
      ends.push({ v, l: pos, col, main: true }, { v: v.clone().negate(), l: neg, col, main: false });
    }
    ends.sort((a, b) => a.v.z - b.v.z);
    clear(giz);
    giz.append(svg('circle', { cx: 0, cy: 0, r: 46, fill: 'rgba(10,12,16,.55)', stroke: 'rgba(255,255,255,.1)' }));
    for (const e of ends) {
      const X = e.v.x * 32, Y = -e.v.y * 32;
      if (e.main) giz.append(svg('line', { x1: 0, y1: 0, x2: X, y2: Y, stroke: e.col, 'stroke-width': 2.2, opacity: 0.9 }));
      giz.append(svg('circle', { cx: X, cy: Y, r: e.main ? 9 : 7.5, fill: e.main ? e.col : 'rgba(10,12,16,.9)', stroke: e.col, 'stroke-width': 1.5 }));
      giz.append(svg('text', { x: X, y: Y + 0.5, fill: e.main ? '#0a0c10' : e.col }, e.l));
    }
    const o = V.orientation(); const s = o.right.name + '|' + o.up.name;
    if (s !== lastO) { lastO = s; clear(orient).append(h('div', {}, 'Tela → direita: ', h('b', {}, o.right.name)), h('div', {}, 'Tela ↑: ', h('b', {}, o.up.name))); }
  });

  // ---------- interação no palco
  const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
  const el = stage.renderer.domElement; const tip = $('#tooltip');
  const pick = (ev) => { const r = el.getBoundingClientRect(); ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, stage.camera); return S.raycast(ray); };
  // gestos: js/stage/rig.js (toque, mouse, trackpad); aqui só as ações de toque/clique
  let hoverRaf = 0, lastHover = null;
  const rig = stage.controls;
  rig.shouldIgnore = () => !!(SL.tc && SL.tcHelper?.visible && (SL.tc.dragging || SL.tc.axis));
  rig.cb.hover = (ev) => { lastHover = ev; if (hoverRaf) return; hoverRaf = requestAnimationFrame(() => { hoverRaf = 0; showTip(lastHover, pick(lastHover)); }); };
  el.addEventListener('pointerleave', () => { tip.hidden = true; });
  el.addEventListener('pointerdown', () => { tip.hidden = true; });
  rig.cb.tap = (ev) => {
    const hit = pick(ev);
    ctx.select(hit ? hit.id : null);
    if (hit) { ctx.setCursor(hit.point.toArray(), '3d'); if (ev.pointerType !== 'mouse') showTip(ev, hit, 2600); }
    if (!hit) hideCard();
  };
  rig.cb.doubleTap = (ev) => {
    const hit = pick(ev);
    if (hit) { ctx.select(hit.id); V.focus([hit.id]); toast('Enquadrado: ' + S.items.get(hit.id).def.label, 1600); }
    else { const id = V.current || V.lastNamed || 'anterior'; setView(id); toast('Vista ' + (V.byId(id)?.label || id), 1400); }
  };
  rig.cb.longPress = (ev) => { const hit = pick(ev); if (hit) { ctx.select(hit.id); showCard(ev, hit); } };
  rig.cb.swipe3 = (dir) => {
    const i = Math.max(0, VIEWS.findIndex((v) => v.id === (V.current || V.lastNamed)));
    const nv = VIEWS[(i + dir + VIEWS.length) % VIEWS.length]; setView(nv.id); toast('Vista ' + nv.label, 1400);
  };
  // cartão de informações (toque longo)
  const card = h('div', { class: 'infocard', hidden: true, role: 'dialog', 'aria-label': 'Informações da estrutura' });
  $('#stageWrap').append(card);
  function hideCard() { card.hidden = true; }
  function showCard(ev, hit) {
    const it = S.items.get(hit.id); const d = it.def; const r = $('#stageWrap').getBoundingClientRect();
    const act = (label, fn) => h('button', { class: 'btn small ghost', onclick: () => { fn(); hideCard(); } }, label);
    clear(card).append(
      h('div', { class: 'ic-h' }, h('span', { class: 'sw', style: { background: d.color } }), h('b', {}, d.label), h('button', { class: 'ic-x', 'aria-label': 'Fechar', onclick: hideCard }, '×')),
      h('div', { class: 'meta' }, badgesFor(d, C)),
      d.volume_ml != null ? h('p', {}, `Volume ${fmt(d.volume_ml, d.volume_ml < 10 ? 2 : 1)} mL `, h('span', { class: 'muted' }, '(voxels da máscara)')) : null,
      d.note ? h('p', { class: 'muted' }, d.note) : null,
      d.metrics?.length ? h('ul', {}, d.metrics.slice(0, 6).map((m) => h('li', {}, m))) : null,
      h('p', { class: 'mono muted small' }, d.mask_file || ''),
      h('div', { class: 'btnrow' }, act('Enquadrar', () => V.focus([it.id])), act(S.isolated === it.id ? 'Sair do isolamento' : 'Isolar', () => ctx.isolate(S.isolated === it.id ? null : it.id)),
        act(it.ghost ? 'Sólido' : 'Fantasma', () => { S.setGhost(it.id, !it.ghost); syncStructState(); }), act('Ocultar', () => { S.setVisible(it.id, false); syncStructState(); })));
    card.hidden = false;
    const cw = Math.min(320, r.width - 24);
    card.style.width = cw + 'px';
    card.style.left = Math.max(12, Math.min(ev.clientX - r.left - cw / 2, r.width - cw - 12)) + 'px';
    const ch = card.offsetHeight; let y = ev.clientY - r.top - ch - 24; if (y < 12) y = Math.min(ev.clientY - r.top + 24, r.height - ch - 12);
    card.style.top = y + 'px';
  }
  let lastTap = null;
  let tipT = 0;
  function showTip(ev, hit, autoHide) {
    if (!hit) { tip.hidden = true; el.style.cursor = ''; return; }
    el.style.cursor = 'pointer';
    const d = S.items.get(hit.id).def; const r = $('#stageWrap').getBoundingClientRect();
    clear(tip).append(h('b', {}, d.label),
      h('div', { class: 'muted' }, d.source === 'leo' ? (d.proposal ? 'GT Leo — proposta refinada' : `GT Leo (${C.leo?.stage})`) : d.badge || ''),
      d.volume_ml != null ? h('div', {}, `Volume ${fmt(d.volume_ml, d.volume_ml < 10 ? 2 : 1)} mL `, h('span', { class: 'muted' }, '(voxels da máscara)')) : null,
      !d.reliable ? h('div', { style: { color: '#ffb0b0' } }, 'Camada não confiável') : null,
      d.proposal ? h('div', { style: { color: '#ffcf85' } }, 'Proposta refinada (opcional)') : null);
    tip.hidden = false;
    const x = Math.min(ev.clientX - r.left + 14, r.width - 290), y = Math.min(ev.clientY - r.top + 14, r.height - 90);
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
    clearTimeout(tipT); if (autoHide) tipT = setTimeout(() => (tip.hidden = true), autoHide);
  }

  // ---------- layout / MPR
  async function setLayout(l) {
    if (NOCT && l === 'split') { toast('MPR 2D indisponível nesta versão. ' + (C.ct_nota || '')); l = '3d'; }
    store.set('layout', l);
    app.classList.toggle('split', l === 'split');
    $('#mprWrap').hidden = l !== 'split';
    $('#lay3d').classList.toggle('on', l !== 'split'); $('#laySplit').classList.toggle('on', l === 'split');
    stage.resize();
    if (l === 'split') {
      if (!mpr) {
        mpr = new MPR($('#mprCanvas'), C, { onCursor: (w, d) => { ctx.setCursor(w, 'mpr'); if (d?.vox) mprStatus(Math.round(d.vox[2])); } });
        const w = WINDOWS[state.win] || WINDOWS.soft;
        toast('Carregando TC nativa para o MPR 2D…', 2500);
        try { await mpr.init(state.phase || 'venous', w); mpr.applyLabels(new Set(S.visibleIds()), new Set(S.items.keys())); mpr.setCursorWorld(SL.cursor.toArray()); phaseUI(); }
        catch (e) { console.warn(e); toast('Falha ao abrir o MPR 2D: ' + e.message); }
      } else mpr.resize();
      requestAnimationFrame(() => mpr?.resize());
    }
    if (right.tab === 'cut') right.render();
  }
  function phaseUI() {
    const sel = clear($('#mprPhase'));
    for (const p of C.phases || []) sel.append(h('option', { value: p.id, selected: (state.phase || 'venous') === p.id }, p.label));
    const warn = () => { const p = (C.phases || []).find((x) => x.id === sel.value); const w = $('#mprWarn');
      if (NOCT || p?.labelsOnly) { w.hidden = false; w.textContent = 'ℹ ' + (C.ct_nota || 'Imagens de TC não são publicadas; disponíveis só na versão local.'); return; }
      w.hidden = !p?.note; w.textContent = p?.note ? `⚠ ${p.note}: cursor e rótulos não correspondem ao 3D` : ''; };
    sel.onchange = async () => { store.set('phase', sel.value); warn(); const w = WINDOWS[state.win] || WINDOWS.soft; await mpr.loadPhase(sel.value, w); mpr.applyLabels(new Set(S.visibleIds()), new Set(S.items.keys())); };
    warn();
  }
  $('#lay3d').onclick = () => setLayout('3d');
  $('#laySplit').onclick = () => setLayout('split');

  // gavetas (iPad/celular)
  const scrim = $('#scrim');
  const closeDrawers = () => { app.classList.remove('left-open', 'right-open'); scrim.hidden = true; };
  $('#btnLeft').onclick = () => { const o = !app.classList.contains('left-open'); closeDrawers(); if (o) { app.classList.add('left-open'); scrim.hidden = false; } };
  $('#btnRight').onclick = () => { const o = !app.classList.contains('right-open'); closeDrawers(); if (o) { app.classList.add('right-open'); scrim.hidden = false; } };
  scrim.onclick = closeDrawers;

  // ---------- paleta, ajuda, atalhos
  const palette = new Palette($('#palette'), () => [
    ...[...S.items.values()].map((it) => ({ kind: 'estrutura', label: it.def.label, swatch: it.def.color, group: it.def.group, kw: it.def.key + ' ' + (it.def.badge || ''), hint: `${it.def.source === 'leo' ? (it.def.proposal ? 'GT Leo · proposta' : 'GT Leo') : it.def.badge || ''}${it.def.reliable ? '' : ' · não confiável'} · ${it.visible ? 'visível' : 'oculta'}`,
      run: () => { if (!it.visible) { S.setVisible(it.id, true); syncStructState(); } ctx.select(it.id); V.focus([it.id]); } })),
    ...VIEWS.map((v) => ({ kind: 'vista', label: 'Vista ' + v.label + (v.proposal ? ' (proposta)' : ''), key: v.key, run: () => setView(v.id) })),
    { kind: 'ação', label: 'Mapa de proximidade (vasos)', key: 'H', run: () => ctx.setHeat(state.heat ? null : 'vasos') },
    { kind: 'ação', label: 'Linhas de distância para vasos', key: 'L', run: () => ctx.setLines((state.lines || []).length ? [] : ['inferior_vena_cava', 'aorta', 'portal_vein_and_splenic_vein']) },
    { kind: 'ação', label: 'Plano de corte livre', key: 'C', run: () => ctx.setClip({ on: !state.clip.on }) },
    ...(NOCT ? [] : [{ kind: 'ação', label: 'Fatias da TC no 3D', key: 'V', run: () => ctx.setSlices({ on: !state.sl.on }) },
      { kind: 'ação', label: 'Abrir/fechar MPR 2D', key: 'M', run: () => setLayout(state.layout === 'split' ? '3d' : 'split') }]),
    { kind: 'ação', label: 'Modo raio-X', key: 'X', run: () => ctx.toggleXray() },
    { kind: 'ação', label: 'Captura com aviso', key: 'P', run: () => doCapture() },
    { kind: 'ação', label: 'Path tracing (liga/desliga)', key: 'R', run: () => ctx.togglePT?.() },
    { kind: 'ação', label: 'Restaurar camadas padrão', run: () => ctx.resetLayers() },
    { kind: 'ação', label: 'Copiar link desta visualização', run: () => { navigator.clipboard?.writeText(location.href).then(() => toast('Link copiado.'), () => toast(location.href)); } },
    ...(NOCT ? [] : Object.entries(WINDOWS)).map(([k, w]) => ({ kind: 'janela', label: 'Janela ' + w.label, run: () => ctx.setWindow(k) })),
    ...['rel', 'cut', 'case'].map((t, i) => ({ kind: 'painel', label: ['Relações', 'Cortes', 'Caso'][i], run: () => { right.show(t); if (innerWidth < 1300) $('#btnRight').click(); } })),
  ]);
  $('#btnPalette').onclick = () => palette.open();
  const SHORT = [
    ['1–9', 'Vistas (Anterior, Posterior, Lat. E, Lat. D, Cranial, Caudal, Flanco E, Laparoscópica, Dorsal)'], ['0', 'Enquadrar visíveis'],
    ['F', 'Enquadrar seleção'], ['I', 'Isolar seleção'], ['G', 'Fantasma na seleção'], ['X', 'Modo raio-X'], ['Esc', 'Limpar seleção / fechar'],
    ['H', 'Mapa de proximidade'], ['L', 'Linhas de distância (vasos)'], ['C', 'Plano de corte'], ['T', 'Mover/girar o plano'], ...(NOCT ? [] : [['V', 'Fatias da TC no 3D']]),
    ...(NOCT ? [] : [['M', 'MPR 2D']]), ['P', 'Captura com aviso'], ['R', 'Path tracing (câmera parada)'], ['U', 'Ocultar interface'], ['⌘/Ctrl K', 'Buscar'], ['?', 'Esta ajuda'],
    ['Mouse', 'arrastar = girar (com inércia) · direito ou Shift = mover · Alt/Ctrl + arrastar = rolar · roda = zoom no cursor · duplo clique = enquadrar'],
    ['Trackpad', 'pinça = zoom no cursor · rotação com 2 dedos (Safari) = rolar'],
  ];
  const GESTOS = [
    ['1 dedo', 'girar, com inércia (solte em movimento para continuar girando)'],
    ['Pinça', 'zoom em direção ao ponto entre os dedos (limites elásticos)'],
    ['2 dedos arrastando', 'mover a cena'], ['2 dedos girando', 'rolar em torno do eixo de visão'],
    ['Toque duplo', 'enquadrar a estrutura tocada · no vazio: voltar à vista atual'],
    ['Toque longo', 'cartão da estrutura (volume, fonte, isolar, fantasma, ocultar)'],
    ['3 dedos ← →', 'vista anterior / seguinte'], ['Novo toque', 'segura a câmera em movimento na hora'],
    ...(NOCT ? [] : [['MPR 2D', 'pinça = zoom · 2 dedos = mover · 1 dedo = cursor']]),
  ];
  const help = $('#help');
  help.append(h('div', { class: 'help-box' }, h('h2', {}, 'Atalhos e gestos'), h('div', { class: 'help-grid' }, SHORT.map(([k, d]) => h('div', {}, h('span', {}, d), h('kbd', {}, k)))),
    h('h3', {}, 'Gestos'), h('div', { class: 'help-grid' }, GESTOS.map(([k, d]) => h('div', {}, h('span', {}, d), h('kbd', {}, k)))),
    h('p', { class: 'note' }, 'Material educacional — não é diagnóstico nem laudo.'), h('button', { class: 'btn', onclick: () => (help.hidden = true) }, 'Fechar')));
  help.addEventListener('pointerdown', (e) => { if (e.target === help) help.hidden = true; });
  $('#btnHelp').onclick = () => (help.hidden = !help.hidden);
  async function doCapture() { toast('Gerando captura…', 1500); try { await capture(ctx, { scale: 2 }); } catch (e) { console.warn(e); toast('Falha na captura: ' + e.message); } }
  $('#btnShot').onclick = doCapture;
  // ---------- path tracing (só com a câmera parada; volta ao raster ao mexer)
  const PT = new PathTracer(stage, S);
  const ptChip = document.createElement('div'); ptChip.className = 'pt-chip'; ptChip.hidden = true; $('#stageWrap').append(ptChip);
  PT.onStatus = (t) => { ptChip.hidden = !t; if (t) ptChip.textContent = t; };
  S.on((ev) => { if (ev === 'state' || ev === 'loaded' || ev === 'opacity') PT.markScene(); });
  const btnPT = $('#btnPT');
  if (!ptSupported(stage.renderer)) { btnPT.disabled = true; btnPT.title = 'Path tracing indisponível neste aparelho (WebGL2 com float render targets necessário)'; }
  async function togglePT(on = !PT.on) {
    if (on) { const ok = await PT.enable(); if (!ok) { toast('Path tracing indisponível neste aparelho'); return; } toast('Path tracing: pare a câmera para refinar; mexer volta ao modo rápido', 3500); }
    else PT.disable();
    btnPT.classList.toggle('on', PT.on); btnPT.setAttribute('aria-pressed', String(PT.on));
  }
  btnPT.onclick = () => togglePT();
  ctx.togglePT = togglePT;

  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); palette.isOpen ? palette.close() : palette.open(); return; }
    if (e.target.closest('input, select, textarea') || palette.isOpen || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key; const sel = S.selected;
    const v = VIEWS.find((x) => x.key === k);
    if (v) return setView(v.id);
    switch (k.toLowerCase()) {
      case '0': V.focus(S.visibleIds(true)); break;
      case 'f': if (sel) V.focus([sel]); break;
      case 'i': ctx.isolate(S.isolated ? null : sel); break;
      case 'g': if (sel) { S.setGhost(sel, !S.items.get(sel).ghost); syncStructState(); } break;
      case 'x': ctx.toggleXray(); break;
      case 'h': ctx.setHeat(state.heat ? null : 'vasos'); break;
      case 'l': ctx.setLines((state.lines || []).length ? [] : ['inferior_vena_cava', 'aorta', 'portal_vein_and_splenic_vein']); break;
      case 'c': ctx.setClip({ on: !state.clip.on }); break;
      case 't': ctx.setClip({ mode: state.clip.mode === 'rotate' ? 'translate' : 'rotate' }); break;
      case 'v': ctx.setSlices({ on: !state.sl.on }); break;
      case 'm': setLayout(state.layout === 'split' ? '3d' : 'split'); break;
      case 'p': doCapture(); break;
      case 'r': togglePT(); break;
      case 'u': app.classList.toggle('hide-ui'); break;
      case '?': help.hidden = !help.hidden; break;
      case 'escape': ctx.select(null); help.hidden = true; closeDrawers(); break;
      default: return;
    }
    e.preventDefault();
  });

  // ---------- aplicar estado restante
  SL.onChange = (c) => { state.clip = { ...state.clip, p: c.p, n: c.n }; store.save(); };
  if (state.sl?.cur) SL.setCursor(new THREE.Vector3(...state.sl.cur));
  else if (C.tumor_facts?.[R.ref]?.centroid_world) SL.setCursor(new THREE.Vector3(...C.tumor_facts[R.ref].centroid_world));
  const w0 = WINDOWS[state.win] || WINDOWS.soft; SL.setWindow(w0.lo, w0.hi); SL.setMix(state.sl.mix ?? 0.35);
  if (state.clip.on) { SL.setClip(true, state.clip.p && state.clip.n ? { p: state.clip.p, n: state.clip.n } : { p: C.tumor_facts?.[R.ref]?.centroid_world || [0, 0, 0], n: [0, 0, 1] }); SL.setMode(state.clip.mode); if (state.clip.ct) { SL.load(); SL.setClipCT(true); } }
  if (state.sl.on) ctx.setSlices({});
  if ((state.lines || []).length) R.setLines(state.lines);
  if (state.heat) await ctx.setHeat(state.heat);
  if (state.layout === 'split') setLayout('split');
  store.unfreeze();
  syncStructState();

  splash(1, 'Pronto');
  $('#splash').classList.add('done'); setTimeout(() => $('#splash').remove(), 500);

  // ---------- LOD completo e camadas opcionais em segundo plano
  const upgrade = async () => {
    if (!assetsOk || lod !== 'full') return;
    const ok = await S.ensureFile('assets:main', 'full');
    if (ok) { S.lod = 'full'; S.applyAll(); if (state.heat) await R.applyHeat(state.heat); if (right.tab === 'case') right.render(); }
  };
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 600));
  idle(() => upgrade().then(() => { window.__v2.lodReady = true; }));

  window.__v2 = { C, S, V, R, SL, stage, state, ctx, setView, capture: (o) => capture(ctx, o), get PT() { return PT; }, get mpr() { return mpr; }, ready: true, lodReady: false,
    fps: () => stage.fps,
    idle: () => new Promise((res) => { const t0 = performance.now(); const f = () => { if ((stage.hqDone || !stage.hqEnabled) && !stage.dirty && performance.now() - stage.lastMove > 300) res(performance.now() - t0); else requestAnimationFrame(f); }; f(); }),
    lateralityScreen: () => {
      // centroides das máscaras (RAS, case.laterality) → mundo → tela; independe de como as malhas foram agrupadas (ex.: árvores vasculares)
      const O = C.frame.centre_offset; const cr = C.laterality?.centroids_ras_mm || {}; const out = {};
      for (const k of ['liver', 'inferior_vena_cava', 'aorta', 'spleen']) {
        const r = cr[k]; if (!r) continue;
        const c = new THREE.Vector3(r[0] - O[0], r[2] - O[1], -r[1] - O[2]).project(stage.camera);
        out[k] = +c.x.toFixed(4);
      }
      return out;
    } };
}

boot().catch((e) => { console.error(e); $('#splashMsg').textContent = 'Erro ao iniciar: ' + e.message; });
