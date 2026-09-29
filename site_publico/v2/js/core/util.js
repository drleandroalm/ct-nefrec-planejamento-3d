// Utilidades de DOM (sem innerHTML) e formatação pt-BR.
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

const nf = {};
export function fmt(v, d = 1) {
  if (v == null || Number.isNaN(v)) return '—';
  const f = nf[d] || (nf[d] = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }));
  return f.format(v);
}
export const fmtMM = (v, d = 1) => (v == null ? '—' : `${fmt(v, d)} mm`);
export const fmtML = (v, d = 1) => (v == null ? '—' : `${fmt(v, d)} mL`);
export function nowBRT() {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date()) + ' (BRT)';
}
export function norm(s) { return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export function hexToRgb(hex) { const n = parseInt(hex.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export function isTouch() { return matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1; }
export function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of kids.flat()) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

// chaves de cache por arquivo (mtime-tamanho, geradas no build): arquivo regenerado → URL nova; sem “bust” aleatório
let CACHE_KEYS = {};
export function setCacheKeys(m) { CACHE_KEYS = m || {}; }
export function vurl(u) { const k = CACHE_KEYS[u]; return k ? `${u}${u.includes('?') ? '&' : '?'}v=${k}` : u; }

// Site estático (dist/, GitHub Pages): case.static_files mapeia caminho de desenvolvimento → arquivo publicado
// { url, gz: gzip a descomprimir no navegador (Pages não serve .gz com Content-Encoding), nifti: cabeçalho mínimo }
let STATIC = null;
export function setStaticMap(m) { STATIC = m || null; }
export const staticEntry = (u) => (STATIC && STATIC[u]) || null;
export async function gunzip(buf) {
  const b = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
  if (!(b[0] === 0x1f && b[1] === 0x8b)) return buf;   // servidor já descomprimiu (Content-Encoding) → usa como veio
  return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
export async function fetchBuf(u) {
  const e = staticEntry(u), url = e ? e.url : u;
  const r = await fetch(vurl(url)); if (!r.ok) throw new Error(url + ' ' + r.status);
  // descompressão em fluxo (sem manter comprimido + cópia na memória); se o servidor já mandou Content-Encoding, o navegador descomprimiu
  if (e && e.gz && !r.headers.get('content-encoding') && r.body && typeof DecompressionStream !== 'undefined') {
    return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  const buf = await r.arrayBuffer();
  return e && e.gz ? gunzip(buf) : buf;
}
// NIfTI-1 mínimo montado no navegador a partir de raw + JSON (só dims/espaçamento/afim): o site não publica cabeçalhos originais
export function niftiFromRaw(raw, m) {
  const H = new ArrayBuffer(352), dv = new DataView(H), le = true;
  dv.setInt32(0, 348, le);
  const dim = [3, ...m.dims, 1, 1, 1, 1]; dim.forEach((v, i) => dv.setInt16(40 + 2 * i, v, le));
  const DT = { uint8: [2, 8], int16: [4, 16], uint16: [512, 16], int32: [8, 32], float32: [16, 32] }[m.dtype];
  dv.setInt16(70, DT[0], le); dv.setInt16(72, DT[1], le);
  const pix = [1, ...m.spacing, 1, 1, 1, 1]; pix.forEach((v, i) => dv.setFloat32(76 + 4 * i, v, le));
  dv.setFloat32(108, 352, le); dv.setFloat32(112, m.slope ?? 1, le); dv.setFloat32(116, m.inter ?? 0, le);
  dv.setUint8(123, 10);
  dv.setInt16(252, 0, le); dv.setInt16(254, 1, le);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) dv.setFloat32(280 + 16 * r + 4 * c, m.affine[r][c], le);
  [0x6e, 0x2b, 0x31, 0].forEach((v, i) => dv.setUint8(344 + i, v));
  return new Blob([H, raw], { type: 'application/octet-stream' });
}
