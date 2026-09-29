// Estado compartilhado + persistência no hash da URL (#s=base64url(JSON)) e localStorage.
import { debounce } from './util.js';

const listeners = new Map();
export const state = {
  layout: '3d',           // '3d' | 'split'
  view: 'anterior',
  cam: null,              // [px,py,pz,tx,ty,tz] quando o usuário move a câmera
  vis: {},                // id -> bool (só diferenças do padrão são gravadas)
  op: {},                 // id -> opacidade
  ghost: {},              // id -> bool
  xray: false,
  isolate: null,
  selected: null,
  relRef: null,           // chave do tumor de referência ('fusao'|'leo')
  heat: null,             // preset do mapa de proximidade ou null
  lines: null,            // lista de chaves com linha ativa
  clip: { on: false, p: null, n: null, ct: false, mode: 'translate' },
  sl: { on: false, ax: true, co: false, sa: false, cur: null, mix: 0.35 },
  win: 'soft',
  phase: 'venous',
  lod: null,
  rightTab: 'rel',
  panels: { left: true, right: true },
};
const PERSIST = ['layout', 'view', 'cam', 'vis', 'op', 'ghost', 'xray', 'isolate', 'relRef', 'heat', 'lines', 'clip', 'sl', 'win', 'phase', 'rightTab'];

export function on(key, fn) { if (!listeners.has(key)) listeners.set(key, new Set()); listeners.get(key).add(fn); return () => listeners.get(key).delete(fn); }
export function emit(key, v) { for (const fn of listeners.get(key) || []) fn(v); for (const fn of listeners.get('*') || []) fn(key, v); }
export function set(key, v) { state[key] = v; emit(key, v); save(); }
export function patch(key, obj) { state[key] = { ...state[key], ...obj }; emit(key, state[key]); save(); }

function b64e(s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function b64d(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return decodeURIComponent(escape(atob(s))); }

const _save = debounce(() => {
  const o = {};
  for (const k of PERSIST) o[k] = state[k];
  if (o.cam) o.cam = o.cam.map((v) => Math.round(v * 10) / 10);
  const hash = '#s=' + b64e(JSON.stringify(o));
  try { history.replaceState(null, '', location.pathname + location.search + hash); } catch {}
  try { localStorage.setItem('nefrec-v2-state', JSON.stringify(o)); } catch {}
}, 350);
let frozen = true;
export function save() { if (!frozen) _save(); }
export function unfreeze() { frozen = false; }

export function load() {
  let o = null;
  const m = location.hash.match(/#s=([A-Za-z0-9_-]+)/);
  if (m) { try { o = JSON.parse(b64d(m[1])); } catch { o = null; } }
  if (o) for (const k of PERSIST) if (k in o && o[k] != null) state[k] = typeof state[k] === 'object' && !Array.isArray(state[k]) && state[k] ? { ...state[k], ...o[k] } : o[k];
  const q = new URLSearchParams(location.search);
  if (q.get('lod')) state.lod = q.get('lod');
  return !!o;
}
export function shareURL() { return location.href; }
