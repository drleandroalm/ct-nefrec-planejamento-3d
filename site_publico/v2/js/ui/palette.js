// Paleta de comandos (Ctrl/⌘ K): estruturas, vistas e ações, busca sem acentos.
import { h, clear, norm } from '../core/util.js';

export class Palette {
  constructor(root, getItems) { this.root = root; this.getItems = getItems; this.input = root.querySelector('#palInput'); this.list = root.querySelector('#palList'); this.sel = 0; this.items = [];
    this.input.addEventListener('input', () => { this.sel = 0; this.render(); });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { this.sel = Math.min(this.items.length - 1, this.sel + 1); this.render(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { this.sel = Math.max(0, this.sel - 1); this.render(); e.preventDefault(); }
      else if (e.key === 'Enter') { this.run(this.items[this.sel]); e.preventDefault(); }
      else if (e.key === 'Escape') { this.close(); e.preventDefault(); }
    });
    root.addEventListener('pointerdown', (e) => { if (e.target === root) this.close(); });
  }
  get isOpen() { return !this.root.hidden; }
  open() { this.root.hidden = false; this.input.value = ''; this.sel = 0; this.render(); setTimeout(() => this.input.focus(), 0); }
  close() { this.root.hidden = true; this.input.blur(); }
  run(it) { if (!it) return; this.close(); it.run(); }
  render() {
    const q = norm(this.input.value).split(/\s+/).filter(Boolean);
    const all = this.getItems();
    const scored = [];
    for (const it of all) {
      const t = norm(it.label + ' ' + (it.kw || '') + ' ' + (it.group || ''));
      if (!q.every((w) => t.includes(w))) continue;
      const s = q.length ? q.reduce((a, w) => a + t.indexOf(w), 0) + (it.kind === 'estrutura' ? 0 : 3) : 0;
      scored.push([s, it]);
    }
    scored.sort((a, b) => a[0] - b[0]);
    this.items = scored.slice(0, 40).map((x) => x[1]);
    clear(this.list);
    this.items.forEach((it, i) => this.list.append(h('li', { class: i === this.sel ? 'on' : '', role: 'option', onpointerdown: (e) => { e.preventDefault(); this.run(it); } },
      it.swatch ? h('span', { class: 'sw', style: { background: it.swatch } }) : h('span', { class: 'badge' }, it.kind), h('span', {}, it.label), it.key ? h('kbd', { class: 'k' }, it.key) : h('span', { class: 'k' }, it.hint || ''))));
    this.list.children[this.sel]?.scrollIntoView({ block: 'nearest' });
  }
}
