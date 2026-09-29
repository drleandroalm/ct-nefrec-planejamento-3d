// Painel direito: abas Relações (distâncias + mapa de proximidade), Cortes (plano livre, fatias, janela) e Caso (fatos, verificações).
import { h, clear, fmt, fmtMM } from '../core/util.js';
import { HEAT } from '../stage/structures.js';
import { HEAT_PRESETS } from '../stage/relations.js';
import { WINDOWS } from '../stage/slices.js';

const TUMOR_NAME = { fusao: 'Fusão de modelos (STAPLE) — comparação', leo: 'GT Leo' };

export class RightPanel {
  constructor(el, ctx) {
    this.el = el; this.ctx = ctx; this.tab = ctx.state.rightTab || 'rel'; this.openRow = null;
    this.build();
  }
  build() {
    const tabs = [['rel', 'Relações'], ['cut', 'Cortes'], ['case', 'Caso']];
    this.tabBtns = tabs.map(([id, lab]) => h('button', { role: 'tab', class: this.tab === id ? 'on' : '', onclick: () => this.show(id) }, lab));
    this.body = h('div', { class: 'tab-body' });
    clear(this.el).append(h('div', { class: 'tabs', role: 'tablist' }, this.tabBtns), this.body);
    this.render();
  }
  show(id) { this.tab = id; this.tabBtns.forEach((b, i) => b.classList.toggle('on', ['rel', 'cut', 'case'][i] === id)); this.ctx.setState('rightTab', id); this.render(); }
  render() { clear(this.body); if (this.tab === 'rel') this.renderRel(); else if (this.tab === 'cut') this.renderCut(); else this.renderCase(); }

  // ------------------------------------------------ Relações
  renderRel() {
    const { C, R, state } = this.ctx; const ref = R.ref;
    const tf = C.tumor_facts?.[ref] || {};
    const refSel = h('select', { class: 'sel', 'aria-label': 'Tumor de referência', onchange: (e) => this.ctx.setRef(e.target.value) },
      R.refs().map((k) => h('option', { value: k, selected: k === ref }, `${TUMOR_NAME[k] || k}${k === 'leo' ? ` (${C.leo?.stage || ''})` : ''}`)));
    const head = h('div', { class: 'card' },
      h('h3', {}, 'Tumor de referência'), refSel,
      h('p', {}, `Volume ${fmt(tf.volume_ml, 1)} mL (voxels) · maior eixo ${fmt(tf.feret_mm, 0)} mm (casco convexo da malha) · fonte `, h('span', { class: 'mono' }, tf.mask || '')),
      ref === 'leo' ? h('p', { class: 'note' }, `Referência principal: GT Leo (${C.leo?.stage || ''}). A fusão de modelos fica como comparação (coluna “fusão”).`, C.leo?.info_note ? ' ' + C.leo.info_note : '') : null,
      ref === 'fusao' ? h('p', { class: 'note' }, 'Comparação: tumor da fusão de modelos (valores conferidos com o scene_manifest do COLAB). A referência principal é o GT Leo.') : null);
    this.body.append(head);

    // mapa de proximidade
    const hs = R.shellFor(ref);
    const heatSel = h('select', { class: 'sel', 'aria-label': 'Alvos do mapa', onchange: (e) => this.ctx.setHeat(e.target.value) },
      HEAT_PRESETS.map((p) => h('option', { value: p.id, selected: state.heat === p.id }, p.label)),
      hs ? h('optgroup', { label: 'Estrutura única' }, hs.meta.channels.map((c) => h('option', { value: 'k:' + c.key, selected: state.heat === 'k:' + c.key }, c.label + (c.reliable ? '' : ' (não confiável)')))) : null);
    const info = R.heatInfo;
    const heatCard = h('div', { class: 'card' },
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!state.heat, disabled: !hs, onchange: (e) => this.ctx.setHeat(e.target.checked ? (heatSel.value || 'vasos') : null) }), h('b', {}, 'Mapa de proximidade na superfície do tumor')),
      hs ? heatSel : h('p', {}, 'Sem campo de distância para este tumor.'),
      h('div', { class: 'legend' }, HEAT.bands.map((b) => h('div', {}, h('i', { style: { background: b.color || 'var(--tumor)' } }), b.label))),
      h('p', { class: 'note' }, 'Distância de cada vértice da malha do tumor à máscara-alvo mais próxima (mínimo entre os alvos escolhidos). Fonte: transformada de distância euclidiana das máscaras na grade venosa nativa (',
        h('span', { class: 'mono' }, hs ? 'data/' + hs.meta.file : '—'), '), amostrada numa faixa de ±', hs ? fmt(hs.meta.shell_mm, 1) : '—', ' mm em torno da superfície.'),
      info && info.total ? h('p', { class: 'note' }, `Vértices: ${info.total.toLocaleString('pt-BR')} · sem amostra: ${info.miss.toLocaleString('pt-BR')} (${fmt((100 * info.miss) / info.total, 1)}%, cor do tumor mantida).`) : null,
      h('p', { class: 'note warn' }, 'Faixas < 2 mm junto a cólon, intestino, ilíaca esquerda ou psoas vêm de contato entre segmentações de fontes diferentes (a sobreposição com o desenho do Leo foi removida na fusão), não indicam invasão.'));
    this.body.append(heatCard);

    // tabela de distâncias
    const rows = R.rows(ref);
    const other = R.refs().find((k) => k !== ref);
    const cmp = new Map((other ? R.rows(other) : []).filter((x) => x.available && x.min_mm != null).map((x) => [x.key, x.min_mm]));
    const active = new Set(state.lines || []);
    const tb = h('tbody');
    for (const r of rows) {
      if (!r.available) {
        tb.append(h('tr', { class: 'na' }, h('td', {}), h('td', {}, r.label, r.no_usable_mask && r.reason ? h('span', { class: 'xnote' }, r.reason) : null), h('td', { class: 'num' }, 'n/d'),
          h('td', {}, h('span', { class: 'badge bad', title: r.reason || '' }, r.no_usable_mask ? 'sem máscara utilizável' : 'não segmentado'))));
        continue;
      }
      const contact = r.min_mm != null && (r.min_mm <= 1.5 || (r.overlap_ml || 0) > 0);
      const tgt = r.target_struct_id && this.ctx.S.item(r.target_struct_id);
      const src = r.target_source || tgt?.def.source || '';
      const tr = h('tr', { class: contact ? 'contact' : '' },
        h('td', {}, h('input', { type: 'checkbox', checked: active.has(r.key), 'aria-label': 'Linha no 3D', title: 'Mostrar linha no 3D', onchange: (e) => this.ctx.toggleLine(r.key, e.target.checked) })),
        h('td', {}, h('span', { class: 'sw', style: { background: tgt?.def.color || '#888', display: 'inline-block', marginRight: '6px', verticalAlign: '-1px' } }), r.label,
          r.estimated ? h('span', { class: 'badge prop', style: { marginLeft: '6px' }, title: r.note || '' }, 'estimado') : !r.reliable ? h('span', { class: 'badge bad', style: { marginLeft: '6px' } }, 'não confiável') : null,
          contact && r.contact_note ? h('span', { class: 'xnote' }, r.contact_note) : null),
        h('td', { class: 'num' }, h('b', { class: 'mono' }, fmt(r.min_mm, 1)), cmp.has(r.key) ? h('div', { class: 'mono muted', title: 'mesma distância a partir do outro tumor' }, fmt(cmp.get(r.key), 1)) : null),
        h('td', {}, h('button', { class: 'linkish', onclick: () => { this.openRow = this.openRow === r.key ? null : r.key; this.render(); } }, sourceLabel(src))));
      tb.append(tr);
      if (this.openRow === r.key) {
        const a = r.assets;
        tb.append(h('tr', { class: 'detail' }, h('td', { colspan: '4' },
          h('div', {}, h('b', {}, 'Alvo: '), h('span', { class: 'mono' }, r.target_mask || '—')),
          h('div', {}, h('b', {}, 'Tumor: '), h('span', { class: 'mono' }, r.tumor_mask || '—')),
          h('div', {}, h('b', {}, 'Método: '), r.estimated ? (r.note || '') : r.only_assets ? 'valor do COLAB (scene_manifest.json, centros de voxel de borda)' : 'EDT das máscaras (voxel de superfície do tumor → voxel-alvo mais próximo).'),
          r.colab_qa ? h('div', {}, h('b', {}, 'COLAB (qa_fused_gt): '), fmtMM(r.colab_qa.min_mm, 2), r.colab_delta_mm != null ? ` (Δ ${fmt(r.colab_delta_mm, 2)} mm${r.colab_delta_mm > 1 ? ' — DIVERGE > 1 mm' : ''})` : '', r.colab_qa.closest_k != null ? ` · corte k${r.colab_qa.closest_k}` : '') : null,
          r.overlap_removed_ml ? h('div', {}, h('b', {}, 'Sobreposição removida na fusão: '), `${fmt(r.overlap_removed_ml, 2)} mL (o desenho do Leo prevalece)`) : null,
          r.mesh_min_mm != null ? h('div', {}, h('b', {}, 'Malhas: '), fmtMM(r.mesh_min_mm, 2)) : null,
          (r.overlap_ml || 0) > 0 ? h('div', {}, h('b', {}, 'Sobreposição entre máscaras: '), `${fmt(r.overlap_ml, 2)} mL`) : null,
          a ? h('div', {}, h('b', {}, 'COLAB (scene_manifest): '), `${fmtMM(a.min_mm, 2)}`, r.assets_delta_mm != null ? ` (Δ ${fmt(r.assets_delta_mm, 2)} mm)` : '', a.mesh_lod0_min_mm != null ? ` · malha LOD0 ${fmtMM(a.mesh_lod0_min_mm, 2)}` : '') : null,
          contact ? h('div', { class: 'xnote' }, r.contact_note || '') : null,
          h('div', {}, h('b', {}, 'Linha: '), R.endpoints(r)?.src || '—'))));
      }
    }
    const tbl = h('table', { class: 'dist' }, h('colgroup', {}, h('col', { class: 'c0' }), h('col', { class: 'c1' }), h('col', { class: 'c2' }), h('col', { class: 'c3' })), h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Estrutura'), h('th', { style: { textAlign: 'right' }, title: other ? `em cinza: a partir do tumor ${TUMOR_NAME[other] || other}` : '' }, other ? `mín. mm (${other === 'fusao' ? 'fusão' : 'Leo'})` : 'mín. (mm)'), h('th', {}, 'Fonte'))), tb);
    this.body.append(h('div', { class: 'card' },
      h('h3', {}, 'Distância mínima tumor → estrutura', h('span', { class: 'spacer' }),
        h('button', { class: 'linkish', onclick: () => this.ctx.setLines(['inferior_vena_cava', 'aorta', 'portal_vein_and_splenic_vein']) }, 'vasos'),
        h('button', { class: 'linkish', onclick: () => this.ctx.setLines([]) }, 'limpar')),
      tbl,
      h('p', { class: 'note' }, C.distances?.method || ''),
      h('p', { class: 'note warn' }, 'Veia renal esquerda e artéria renal esquerda: ', C.distances?.no_usable_mask_note || 'sem máscara utilizável — distância não calculada.'),
      h('p', { class: 'note' }, 'Artéria e veia mesentéricas superiores não foram segmentadas: distâncias não calculadas.')));
  }

  // ------------------------------------------------ Cortes
  renderCut() {
    const { state } = this.ctx; const clip = state.clip; const sl = state.sl;
    const noCT = this.ctx.C.ct_publicada === false;
    const ctNote = noCT ? h('div', { class: 'card', id: 'ctNote' }, h('p', { class: 'warn' }, this.ctx.C.ct_nota || 'Imagens de TC não são publicadas; disponíveis só na versão local.'),
      h('p', { class: 'note' }, 'Nesta versão pública não há fatias nem MPR 2D; o plano de corte recorta só os modelos 3D.')) : null;
    const clipCard = h('div', { class: 'card' },
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!clip.on, onchange: (e) => this.ctx.setClip({ on: e.target.checked }) }), h('b', {}, 'Plano de corte livre (C)')),
      h('div', { class: 'btnrow' }, [['coronal', 'Coronal'], ['axial', 'Axial'], ['sagital', 'Sagital'], ['camera', 'Perpendicular à vista']].map(([k, l]) => h('button', { class: 'btn small ghost', onclick: () => this.ctx.clipPreset(k) }, l))),
      h('div', { class: 'btnrow' },
        h('button', { class: 'btn small ghost' + (clip.mode !== 'rotate' ? ' on' : ''), onclick: () => this.ctx.setClip({ mode: 'translate' }) }, 'Mover'),
        h('button', { class: 'btn small ghost' + (clip.mode === 'rotate' ? ' on' : ''), onclick: () => this.ctx.setClip({ mode: 'rotate' }) }, 'Girar (T)'),
        h('button', { class: 'btn small ghost', onclick: () => this.ctx.clipFlip() }, 'Inverter lado'),
        h('button', { class: 'btn small ghost', onclick: () => this.ctx.clipToCursor() }, 'Ao cursor')),
      noCT ? null : h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!clip.ct, onchange: (e) => this.ctx.setClip({ ct: e.target.checked }) }), 'TC no plano de corte'),
      h('p', { class: 'note' }, 'O gizmo move/gira o plano; a face cortada das estruturas opacas aparece como tampa de cor sólida.'));
    const rng = (ax, label) => {
      const b = this.ctx.SL.box; const i = { ax: 1, co: 2, sa: 0 }[ax];
      const lo = b.min.getComponent(i), hi = b.max.getComponent(i); const cur = this.ctx.SL.cursor.getComponent(i);
      const out = h('span', { class: 'mono' }, fmt(cur, 0));
      return h('label', { class: 'range' }, h('span', {}, h('input', { type: 'checkbox', checked: !!sl[ax], onchange: (e) => this.ctx.setSlices({ [ax]: e.target.checked, on: true }) }), ' ', label),
        h('input', { type: 'range', min: String(lo), max: String(hi), step: '1', value: String(cur), oninput: (e) => { const p = this.ctx.SL.cursor.clone(); p.setComponent(i, +e.target.value); out.textContent = fmt(+e.target.value, 0); this.ctx.setCursor(p.toArray(), 'slider'); } }), out);
    };
    const slCard = h('div', { class: 'card' },
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!sl.on, onchange: (e) => this.ctx.setSlices({ on: e.target.checked }) }), h('b', {}, noCT ? 'Fatias de rótulos no 3D (V)' : 'Fatias da TC no 3D (V)')),
      rng('ax', 'Axial'), rng('co', 'Coronal'), rng('sa', 'Sagital'),
      h('label', { class: 'range' }, h('span', {}, 'Rótulos'), h('input', { type: 'range', min: '0', max: '0.9', step: '0.05', value: String(sl.mix ?? 0.35), oninput: (e) => this.ctx.setSlices({ mix: +e.target.value }) }), h('span', {})),
      h('p', { class: 'note' }, this.ctx.C.slices?.note || ''),
      h('p', { class: 'note' }, 'Clique numa estrutura no 3D (ou no MPR) para mover o cursor compartilhado.'));
    const mprBtn = h('button', { class: 'btn small', onclick: () => this.ctx.setLayout(state.layout === 'split' ? '3d' : 'split') }, state.layout === 'split' ? 'Fechar MPR 2D' : (noCT ? 'Abrir MPR 2D de rótulos (M)' : 'Abrir MPR 2D (M)'));
    const win = noCT ? h('div', { class: 'card' }, mprBtn) : h('div', { class: 'card' }, h('h3', {}, 'Janela da TC (3D e MPR)'),
      h('div', { class: 'btnrow' }, Object.entries(WINDOWS).map(([k, w]) => h('button', { class: 'btn small ghost' + (state.win === k ? ' on' : ''), onclick: () => this.ctx.setWindow(k) }, `${w.label} (${w.lo}/${w.hi})`))),
      mprBtn);
    this.body.append(...(noCT ? [ctNote, clipCard] : [clipCard, slCard, win]).filter(Boolean));
  }

  // ------------------------------------------------ Caso
  renderCase() {
    const { C } = this.ctx;
    const lat = C.laterality || {};
    const ok = (b) => h('span', { class: 'badge ' + (b ? 'leo' : 'bad') }, b ? 'ok' : 'falhou');
    const latCard = h('div', { class: 'card' }, h('h3', {}, 'Lateralidade (centroides das máscaras, RAS)'),
      h('p', {}, 'Fígado à direita do paciente ', ok(lat.liver_right)), h('p', {}, 'Baço à esquerda ', ok(lat.spleen_left)),
      h('p', {}, 'Tumor à esquerda ', ok(lat.tumor_left)), h('p', {}, 'Aorta à esquerda da VCI ', ok(lat.aorta_left_of_ivc)),
      h('p', { class: 'note' }, 'Vista anterior: esquerda do paciente à direita da tela. MPR 2D em convenção radiológica.'));
    const ag = (C.agreement || []).map((a) => h('tr', {}, h('td', {}, a.key), h('td', { class: 'num mono' }, fmt(a.leo_ml, 1)), h('td', { class: 'num mono' }, fmt(a.fusao_ml, 1)), h('td', { class: 'num mono' }, fmt(a.dice, 3))));
    const agCard = h('div', { class: 'card' }, h('h3', {}, `GT Leo (${C.leo?.stage || '—'}) × Fusão de modelos`),
      h('table', { class: 'dist' }, h('thead', {}, h('tr', {}, h('th', {}, 'Estrutura'), h('th', { style: { textAlign: 'right' } }, 'Leo mL'), h('th', { style: { textAlign: 'right' } }, 'Fusão mL'), h('th', { style: { textAlign: 'right' } }, 'Dice'))), h('tbody', {}, ag)),
      C.leo?.info_note ? h('p', { class: 'note' }, C.leo.info_note) : null,
      C.leo?.glb_check?.nodes ? h('p', { class: 'note' }, 'leo_gt.glb (conferência da caixa de cada malha com a máscara, limite 3 mm): ',
        Object.entries(C.leo.glb_check.nodes).map(([k, n]) => `${k} ${fmt(Math.min(...Object.values(n.bbox_dev_mm)), 2)} mm ${n.ok ? '→ aprovada' : '→ rejeitada'}`).join(' · '), '. ', C.leo.glb_check.note || '') : null,
      C.leo?.assets_check?.nodes ? h('p', { class: 'note' }, `Malhas do GT Leo em ${C.leo.assets_check.dir} (centroide ≤ 1,5 mm e caixa ≤ 3 mm vs máscara interp): `,
        Object.entries(C.leo.assets_check.nodes).map(([k, n]) => `${k} centroide ${fmt(n.centroid_dev_mm, 2)} / caixa ${fmt(n.bbox_dev_mm, 2)} mm ${n.ok ? '→ usada' : '→ rejeitada (malha própria suavizada)'}`).join(' · ')) : null);
    const FB = C.fused_base || {};
    const fbCard = FB.fused_gt ? h('div', { class: 'card' }, h('h3', {}, 'Base de segmentação'),
      h('p', {}, FB.note || ''), h('p', { class: 'note' }, 'Máscaras: ', h('span', { class: 'mono' }, FB.dir), ' · QA: ', h('span', { class: 'mono' }, FB.qa || '—'), ' · comparação: ', h('span', { class: 'mono' }, FB.previous_for_comparison))) : null;
    const A = C.assets || {};
    const used = (A.checks || []).filter((c) => /^ok|^DESALINHADO/.test(c.status || ''));
    const worstC = Math.max(0, ...used.filter((c) => c.reliable !== false).map((c) => c.centroid_dev_mm || 0));
    const worstB = Math.max(0, ...used.map((c) => c.bbox_dev_mm || 0));
    const asCard = h('div', { class: 'card' }, h('h3', {}, `Malhas do COLAB (${A.dir || 'viewer_assets'})`, A.present ? ok(A.ok) : h('span', { class: 'badge' }, 'ausentes')),
      A.rejected?.length ? h('p', { class: 'note warn' }, 'Rejeitadas no alinhamento (usamos a malha própria gerada da máscara): ', A.rejected.join(', ')) : null,
      A.present ? h('p', {}, `Alinhamento conferido com as máscaras: ${used.length} estruturas; pior desvio de centroide ${fmt(worstC, 2)} mm, de caixa ${fmt(worstB, 2)} mm. Critério: ${A.criterion || ''}.`) : null,
      A.present ? h('p', { class: 'note' }, `Carregado: ${this.ctx.lodLabel()}. Gerado em ${A.generated_at || '—'}.`) : null);
    this.body.append(...[latCard, fbCard, agCard, asCard].filter(Boolean));
  }
}
function sourceLabel(src) {
  return ({ fusao: 'Fusão', fusao_maioria: 'Fusão', fusao_staple: 'Fusão', totalseg: 'TotalSeg', unest: 'UNesT', cect: 'CECT', hu_search: 'Busca HU', leo: 'GT Leo', corrigido: 'Correção' })[src] || src || '—';
}
