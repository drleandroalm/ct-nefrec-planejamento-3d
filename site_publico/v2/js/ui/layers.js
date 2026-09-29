// Painel "Estruturas": grupos, visibilidade, isolar, fantasma, opacidade, fonte e proveniência.
import { h, clear, fmt, norm, svg } from '../core/util.js';

const EYE = () => svg('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }, svg('path', { d: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z' }), svg('circle', { cx: '12', cy: '12', r: '3' }));
const EYE_OFF = () => svg('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }, svg('path', { d: 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.1 6.1A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 4.2-1' }));

export function badgesFor(def, C) {
  const b = [];
  if (def.source === 'leo') {
    if (def.proposal) b.push(h('span', { class: 'badge prop', title: def.method || '' }, 'proposta refinada'));
    else b.push(h('span', { class: 'badge leo', title: 'Ground truth — desenho manual do cirurgião' }, `GT Leo (${C.leo?.stage || ''})`));
    if (C.leo?.stage === 'bruto') b.push(h('span', { class: 'badge warn' }, 'bruto'));
  } else if (def.badge) b.push(h('span', { class: 'badge src', title: (C.sources?.[def.source]?.long || def.badge) + (def.method ? ` — ${def.method}` : '') }, def.badge));
  if (def.estimated) b.push(h('span', { class: 'badge warn', title: def.note || '' }, 'trajetória estimada'));
  if (def.uncertain) b.push(h('span', { class: 'badge warn', title: def.note || '' }, 'incerto'));
  else if (!def.reliable) b.push(h('span', { class: 'badge bad', title: def.note || 'Camada não confiável' }, 'não confiável'));
  if (def.supersededBy) b.push(h('span', { class: 'badge', title: 'Substituída pelo GT Leo por padrão' }, 'substituída'));
  return b;
}

export class LayersPanel {
  constructor(el, S, C, api) {
    this.el = el; this.S = S; this.C = C; this.api = api; this.q = ''; this.open = null; this.collapsed = new Set(['Não confiável']);
    S.on((ev, id) => { if (ev === 'state' || ev === 'select' || ev === 'loaded') this.refresh(); });
    this.build();
  }
  build() {
    clear(this.el);
    this.count = h('span', { class: 'count' });
    this.searchIn = h('input', { class: 'search', type: 'search', placeholder: 'Filtrar estruturas…', autocomplete: 'off', 'aria-label': 'Filtrar estruturas', oninput: (e) => { this.q = norm(e.target.value); this.refresh(); } });
    this.xray = h('button', { class: 'chip', title: 'Modo raio-X: órgãos e ossos em fantasma; tumor e vasos sólidos (X)', onclick: () => this.api.toggleXray() }, 'Raio-X');
    this.iso = h('button', { class: 'chip', title: 'Sair do isolamento (I)', onclick: () => this.api.isolate(null) }, 'Sair do isolamento');
    const reset = h('button', { class: 'chip', title: 'Restaurar camadas padrão', onclick: () => this.api.resetLayers() }, 'Padrão');
    this.el.append(h('div', { class: 'p-head' }, h('h2', {}, 'Estruturas', this.count), this.searchIn, h('div', { class: 'p-tools' }, this.xray, reset, this.iso)));
    this.list = h('div', { class: 'layers', role: 'list' });
    this.el.append(this.list);
    this.refresh();
  }
  refresh() {
    const S = this.S, C = this.C;
    this.xray.classList.toggle('on', S.xray);
    this.iso.hidden = !S.isolated;
    const items = [...S.items.values()];
    this.count.textContent = `${items.filter((i) => i.visible).length}/${items.length}`;
    clear(this.list);
    for (const g of C.groups) {
      const its = items.filter((it) => it.def.group === g && (!this.q || norm(it.def.label + ' ' + (it.def.badge || '') + ' ' + it.def.key).includes(this.q)));
      if (!its.length) continue;
      // Leo primeiro dentro do grupo
      const rank = (it) => (it.def.source === 'leo' && !it.def.proposal ? 0 : it.def.proposal ? 1.5 : it.def.supersededBy ? 2 : 1);
      its.sort((a, b) => rank(a) - rank(b));
      const collapsed = this.collapsed.has(g) && !this.q;
      const anyOn = its.some((i) => i.visible);
      const grp = h('div', { class: 'grp' + (collapsed ? ' collapsed' : '') },
        h('div', { class: 'grp-h' },
          h('button', { class: 'tw', 'aria-label': collapsed ? 'Expandir' : 'Recolher', onclick: () => { collapsed ? this.collapsed.delete(g) : this.collapsed.add(g); this.refresh(); } }, collapsed ? '▸' : '▾'),
          h('b', {}, g + (g === 'Não confiável' ? ' · desligado por padrão' : '')),
          h('button', { class: 'eye', title: anyOn ? 'Ocultar grupo' : 'Mostrar grupo', 'aria-label': anyOn ? 'Ocultar grupo' : 'Mostrar grupo', onclick: () => { for (const i of its) S.setVisible(i.id, !anyOn); this.api.changed(); } }, anyOn ? EYE() : EYE_OFF())),
        h('div', { class: 'rows' }, its.map((it) => this.row(it))));
      this.list.append(grp);
    }
  }
  row(it) {
    const d = it.def, S = this.S;
    const sel = S.selected === it.id;
    const r = h('div', { class: 'row' + (it.visible ? '' : ' off') + (sel ? ' sel' : ''), role: 'listitem', dataset: { id: it.id } },
      h('button', { class: 'eye', 'aria-label': it.visible ? 'Ocultar' : 'Mostrar', title: it.visible ? 'Ocultar' : 'Mostrar', onclick: (e) => { e.stopPropagation(); S.setVisible(it.id, !it.visible); this.api.changed(); } }, it.visible ? EYE() : EYE_OFF()),
      h('span', { class: 'sw', style: { background: d.color } }),
      h('div', { class: 'name', onclick: () => { this.api.select(sel ? null : it.id); }, ondblclick: () => this.api.focus([it.id]) },
        h('span', {}, d.label), h('span', { class: 'meta' }, badgesFor(d, this.C))),
      h('span', { class: 'vol mono', title: d.volume_provenance || '' }, d.volume_ml != null ? `${fmt(d.volume_ml, d.volume_ml < 10 ? 2 : 1)} mL` : ''));
    if (!sel) return r;
    const op = h('input', { type: 'range', min: '0.05', max: '1', step: '0.05', value: String(it.opacity), 'aria-label': 'Opacidade', oninput: (e) => { S.setOpacity(it.id, +e.target.value); opv.textContent = Math.round(+e.target.value * 100) + '%'; this.api.changed(); } });
    const opv = h('span', { class: 'mono' }, Math.round(it.opacity * 100) + '%');
    const x = h('div', { class: 'row-x' },
      h('div', { class: 'acts' },
        h('button', { class: 'btn small ghost', onclick: () => this.api.focus([it.id]) }, 'Enquadrar (F)'),
        h('button', { class: 'btn small ghost' + (S.isolated === it.id ? ' on' : ''), onclick: () => this.api.isolate(S.isolated === it.id ? null : it.id) }, S.isolated === it.id ? 'Sair do isolamento' : 'Isolar (I)'),
        h('button', { class: 'btn small ghost', onclick: () => { S.setGhost(it.id, !it.ghost); this.api.changed(); } }, it.ghost ? 'Sólido' : 'Fantasma (G)')),
      h('label', { class: 'op' }, 'Opacidade', op, opv),
      d.volume_provenance ? h('p', {}, h('b', {}, 'Volume: '), d.volume_provenance) : null,
      d.method ? h('p', {}, h('b', {}, 'Método: '), d.method) : null,
      d.mask_file ? h('p', { class: 'mono' }, d.mask_file) : null,
      d.note ? h('p', {}, d.note) : null,
      d.metrics?.length ? h('div', { class: 'metrics' }, h('b', {}, 'Métricas (COLAB, ', d.extra_source || '', '):'), h('ul', {}, d.metrics.map((m) => h('li', {}, m)))) : null,
      d.align ? h('p', { class: 'note' }, `Malha conferida com a máscara: centroide ${fmt(d.align.centroid_dev_mm, 2)} mm, caixa ${fmt(d.align.bbox_dev_mm, 2)} mm.`) : null,
      d.supersededBy ? h('p', {}, 'Oculta por padrão: o GT Leo (', this.C.leo?.stage, ') é a camada principal.') : null,
      d.source === 'leo' && d.key === 'tumor' && !d.proposal && this.C.leo?.info_note ? h('p', { class: 'note' }, this.C.leo.info_note) : null,
      d.source === 'leo' && !d.proposal && this.C.leo?.interp_slices_k ? h('p', { class: 'note' }, `Cortes interpolados (não desenhados): ${this.C.leo.interp_slices_k.length} (k ≡ 1 mod 4). ${this.C.ct_publicada === false ? '' : 'Veja no MPR 2D se o corte atual foi desenhado ou interpolado.'}`) : null);
    return h('div', {}, r, x);
  }
}
