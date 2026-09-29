// Captura em alta resolução: quadro HQ, rótulos de distância desenhados no canvas, faixa com aviso, vista, orientação, camadas e data/hora (BRT).
import * as THREE from 'three';
import { nowBRT } from '../core/util.js';

export const DISCLAIMER = 'MATERIAL EDUCACIONAL — NÃO É DIAGNÓSTICO NEM LAUDO. Segmentações por IA e desenho manual preliminar; decisões clínicas exigem revisão por especialista.';

export async function capture(ctx, { scale = 2, download = true } = {}) {
  const { stage } = ctx;
  const r = stage.renderer; const pr0 = r.getPixelRatio();
  const w = stage.host.clientWidth, h = stage.host.clientHeight;
  const pr = Math.min(pr0 * scale, 4096 / Math.max(w, h));
  r.setPixelRatio(pr); stage.composer.setPixelRatio(pr); stage.composer.setSize(w, h);
  stage.renderHQ();
  const W = Math.round(w * pr), H = Math.round(h * pr);
  const k0 = W / 1600;
  const fs = Math.max(13, Math.round(17 * k0 * 1.15)), fs2 = Math.round(fs * 0.86);
  const meas = document.createElement('canvas').getContext('2d');
  const vis = ctx.captureMeta();
  meas.font = `700 ${fs}px Inter, sans-serif`; const l1 = wrap(meas, DISCLAIMER, W - 32 * k0);
  meas.font = `500 ${fs2}px Inter, sans-serif`; const l2 = wrap(meas, `Vista: ${vis.view} · ${vis.layers} · ${nowBRT()}`, W - 32 * k0);
  const lh = fs * 1.35, lh2 = fs2 * 1.35;
  const strip = Math.round(16 * k0 + l1.length * lh + 6 * k0 + l2.length * lh2 + 14 * k0);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H + strip;
  const g = cv.getContext('2d');
  g.drawImage(r.domElement, 0, 0, W, H);
  r.setPixelRatio(pr0); stage.composer.setPixelRatio(pr0); stage.resize(); stage.renderFast();
  const k = W / 1600;
  // rótulos de distância
  const cam = stage.camera;
  for (const L of ctx.R.labelsForCapture()) {
    const p = L.world.clone().project(cam); if (p.z > 1) continue;
    const x = (p.x * 0.5 + 0.5) * W, y = (-p.y * 0.5 + 0.5) * H;
    g.font = `600 ${Math.round(15 * k * 1.2)}px Inter, sans-serif`;
    const tw = g.measureText(L.text).width; const sub = L.sub; let sw = 0;
    if (sub) { g.font = `500 ${Math.round(12 * k * 1.2)}px Inter, sans-serif`; sw = g.measureText(sub).width; }
    const bw = Math.max(tw, sw) + 34 * k, bh = (sub ? 44 : 26) * k * 1.2;
    g.fillStyle = 'rgba(10,12,16,.85)'; roundRect(g, x + 10 * k, y - bh / 2, bw, bh, 6 * k); g.fill();
    g.fillStyle = L.color; g.beginPath(); g.arc(x + 22 * k, y - (sub ? 8 : 0) * k, 5 * k, 0, 7); g.fill();
    g.fillStyle = '#eef2f7'; g.font = `600 ${Math.round(15 * k * 1.2)}px Inter, sans-serif`; g.textBaseline = 'middle';
    g.fillText(L.text, x + 32 * k, y - (sub ? 9 : 0) * k * 1.2);
    if (sub) { g.fillStyle = '#ffe27a'; g.font = `500 ${Math.round(12 * k * 1.2)}px Inter, sans-serif`; g.fillText(sub, x + 32 * k, y + 11 * k * 1.2); }
  }
  // orientação no canto
  const o = ctx.V.orientation();
  g.font = `500 ${Math.round(14 * k * 1.2)}px Inter, sans-serif`; g.textBaseline = 'top';
  const ot = [`Tela → direita: ${o.right.name}`, `Tela ↑: ${o.up.name}`];
  g.fillStyle = 'rgba(10,12,16,.7)'; roundRect(g, 14 * k, 14 * k, 330 * k * 1.2, 50 * k * 1.2, 8 * k); g.fill();
  g.fillStyle = '#dfe6ee'; ot.forEach((t, i) => g.fillText(t, 26 * k, (22 + i * 20) * k * 1.2));
  // faixa inferior
  g.fillStyle = '#2a1a05'; g.fillRect(0, H, W, strip);
  g.fillStyle = 'rgba(255,181,71,.55)'; g.fillRect(0, H, W, Math.max(2, 2 * k));
  g.textBaseline = 'top'; g.fillStyle = '#ffe2b8'; g.font = `700 ${fs}px Inter, sans-serif`;
  let y = H + 14 * k0; for (const t of l1) { g.fillText(t, 16 * k0, y); y += lh; }
  y += 6 * k0; g.fillStyle = '#e8d3b3'; g.font = `500 ${fs2}px Inter, sans-serif`;
  for (const t of l2) { g.fillText(t, 16 * k0, y); y += lh2; }
  const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
  if (download) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    const ts = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    a.download = `nefrec-${vis.viewId}-${ts}.png`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  return { blob, width: W, height: H + strip, disclaimer: DISCLAIMER };
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function wrap(g, text, maxW) {
  const out = []; let cur = '';
  for (const w of text.split(' ')) { const t = cur ? cur + ' ' + w : w; if (g.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t; }
  if (cur) out.push(cur); return out;
}
function fitText(g, t, x, y, maxW) {
  let s = t; while (g.measureText(s).width > maxW && s.length > 10) s = s.slice(0, -2);
  if (s !== t) s = s.slice(0, -1) + '…';
  g.fillText(s, x, y);
}
