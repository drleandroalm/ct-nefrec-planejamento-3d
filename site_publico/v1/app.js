// Aplicação principal: lê manifest.json e monta as visões 3D, comparação, 2D e arquivos.
import { Viewer3D, CONVENTIONS, VIEWS, DEFAULT_CONVENTION } from "./viewer3d.js";
import { CATEGORIES, describe, modelColor, hexToRgb, DIVERGENCE_COLOR, DIVERGENCE_OPACITY, labelmapEntry } from "./structures.js";

const params = new URLSearchParams(location.search);
const TEST = params.has("teste");
const $ = (s, r = document) => r.querySelector(s);

// Criação segura de elementos (nunca usa innerHTML com conteúdo de arquivos)
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, val] of Object.entries(attrs || {})) {
    if (val == null || val === false) continue;
    if (k === "class") e.className = val;
    else if (k === "style") e.style.cssText = val;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), val);
    else if (k in e && typeof val !== "string") e[k] = val;
    else e.setAttribute(k, val === true ? "" : val);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
const fmt = (x, d) => (x == null || Number.isNaN(x) ? "—" : Number(x).toFixed(d));

let manifest = null;
let manifestSig = "";

function sigOf(m) {
  return JSON.stringify([
    (m.masks || []).map((x) => [x.url, x.mtime, x.size_mb]),
    (m.glb || []).map((x) => [x.url, x.exists, x.mtime, x.size_mb]),
    m.metrics?.found, (m.metrics?.files || []).map((f) => f.mtime),
    (m.ai_text || []).map((x) => [x.url, x.mtime]),
    (m.base_volumes || []).map((x) => [x.url, x.exists]),
  ]);
}

async function fetchManifest() {
  const r = await fetch("manifest.json?t=" + Date.now(), { cache: "no-store" });
  if (!r.ok) throw new Error("manifest.json não encontrado (rode build_manifest.py)");
  return r.json();
}

// ---------------------------------------------------------------- abas
let active = "t3d";
const tabInit = {};
function showTab(id) {
  active = id;
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === id));
  document.querySelectorAll(".tab").forEach((s) => s.classList.toggle("active", s.id === id));
  if (tabInit[id]) { const f = tabInit[id]; tabInit[id] = null; f(); }
  window.dispatchEvent(new Event("resize"));
}
$("#tabs").addEventListener("click", (ev) => { const b = ev.target.closest("button"); if (b) showTab(b.dataset.tab); });

function waitingCard(title, lines, extra) {
  return h("div", { class: "card" }, h("h2", {}, title), ...lines.map((l) => h("p", {}, l)), extra || null);
}
function testLink() {
  return TEST ? null : h("p", { class: "small" }, "Para testar a interface sem dados reais: ",
    h("a", { href: "?teste=1", style: "color:#ff9aa6" }, "abrir modo de teste com geometria SINTÉTICA (não é paciente)"));
}

// ---------------------------------------------------------------- fontes (reais ou, no modo teste, SINTÉTICAS)
function baseVolumes() { return TEST ? (manifest.test?.base_volumes || []) : (manifest.base_volumes || []); }
function masksList() { return TEST ? (manifest.test?.masks || []) : (manifest.masks || []); }
// ---------------------------------------------------------------- GLB sources
function glbSources() {
  if (TEST) return (manifest.test?.glb || []).map((g) => ({ ...g, synthetic: true }));
  // prefere *_axisfixed; arquivos preteridos (eixos trocados) não são carregados
  return (manifest.glb || []).filter((g) => g.exists && !g.deprecated);
}

// ================================================================= 3D
let v3 = null;
let convKey = DEFAULT_CONVENTION;

function buildViewButtons(container, viewer, hud) {
  container.replaceChildren();
  for (const [k, vw] of Object.entries(VIEWS)) {
    container.append(h("button", { type: "button", onclick: () => { viewer.setView(k); hud && updateHud(viewer, hud); } }, vw.label));
  }
}
function updateHud(viewer, hud, extra = "") {
  hud.textContent = `${TEST ? "DADOS SINTÉTICOS · " : ""}Vista: ${VIEWS[viewer.currentView]?.label || ""} · ${CONVENTIONS[viewer.convention].label.split(" (")[0]}${extra ? " · " + extra : ""}`;
}

async function init3D() {
  const srcs = glbSources();
  const wait = $("#wait3d");
  const srcConv = srcs.find((x) => x.convention && CONVENTIONS[x.convention] && !CONVENTIONS[x.convention].perFile)?.convention;
  convKey = params.get("conv") && CONVENTIONS[params.get("conv")] ? params.get("conv") : (srcConv || DEFAULT_CONVENTION);
  v3 = new Viewer3D($("#v3d"), { convention: convKey, materialSpec: manifest.material_spec?.data || null });
  buildViewButtons($("#viewBtns"), v3, $("#hud3d"));
  const cs = $("#convSel");
  for (const [k, c] of Object.entries(CONVENTIONS)) if (!c.perFile) cs.append(h("option", { value: k, selected: k === convKey }, c.label));
  cs.onchange = () => { convKey = cs.value; v3.setConvention(cs.value); if (vc) vc.setConvention(cs.value); updateHud(v3, $("#hud3d")); };
  $("#fitBtn").onclick = () => v3.fit();
  $("#shotBtn").onclick = () => v3.screenshot({ title: srcs.filter((s) => v3.sources.find((x) => x.id === s.id && x.group.visible)).map((s) => s.label).join(" + "), synthetic: TEST });
  buildClipRows(v3);

  if (!srcs.length) {
    const exp = (manifest.glb || []).filter((g) => g.expected).map((g) => g.path);
    wait.hidden = false;
    wait.replaceChildren(waitingCard("Aguardando segmentação", [
      "Nenhum GLB disponível ainda. Arquivos esperados:",
      ...exp.map((p) => "• " + p),
      "Quando os arquivos existirem, rode build_manifest.py (ou aguarde o atualizador automático) e recarregue.",
    ], testLink()));
    $("#srcList").append(h("p", { class: "small pending" }, "Aguardando segmentação — nenhum GLB encontrado."));
    return;
  }
  $("#hud3d").textContent = "Carregando GLB…";
  const fusedAvail = srcs.some((s) => /fused/.test(s.id));
  const loadedIds = new Set(), srcBoxes = new Map();
  for (const s of srcs) {
    try {
      await v3.loadGLB(s);
      loadedIds.add(s.id);
      const on = s.default_on !== undefined ? !!s.default_on : (fusedAvail ? /fused/.test(s.id) : true);
      v3.setSourceVisible(s.id, on);
      const cb = h("input", { type: "checkbox", checked: on, onchange: (ev) => { v3.setSourceVisible(s.id, ev.target.checked); renderStructList(); } });
      srcBoxes.set(s.id, cb);
      $("#srcList").append(h("label", { class: "li", title: s.path || "" }, cb,
        s.label, s.synthetic ? h("span", { class: "badge syn" }, "SINTÉTICO") : null,
        s.fused_gt && !s.unreliable ? h("span", { class: "badge ok" }, "1ª escolha") : null,
        s.fallback_for ? h("span", { class: "badge" }, "reserva") : null,
        h("span", { class: "muted small" }, s.size_mb ? ` ${s.size_mb} MB` : "")));
    } catch (err) {
      console.error(err);
      $("#srcList").append(h("p", { class: "small pending" }, `Falha ao carregar ${s.label}: ${err.message || err}`));
    }
  }
  // reserva: se a fonte principal (viewer_assets_gt) não carregou, liga a fusão anterior (viewer_assets)
  for (const s of srcs) {
    if (s.fallback_for && loadedIds.has(s.id) && !loadedIds.has(s.fallback_for)) {
      v3.setSourceVisible(s.id, true);
      if (srcBoxes.get(s.id)) srcBoxes.get(s.id).checked = true;
      $("#srcList").append(h("p", { class: "small warn-inline" }, `Fonte principal (${s.fallback_for}) indisponível — usando a reserva: ${s.label}.`));
    }
  }
  if (v3.sources.some((s) => s.corrected)) {
    for (const e of v3.entries) if (!e.source.corrected && e.info.baseKey === "kidney_left") v3.setVisible(e, false);
  }
  // prioridade: GT do Leo > fusão. Com o GT do Leo carregado, tumor/rim esq./sistema coletor das outras fontes ficam
  // disponíveis mas desligados; trombo (candidato), artérias renais, divergências e extras confiavel=false: desligados.
  const hasLeo = v3.sources.some((s) => s.leo_gt);
  for (const e of v3.entries) {
    if (e.source.leo_gt || e.source.unreliable) continue;   // fonte "opcional" já começa desligada; ao ligá-la, tudo nela aparece
    const bk = e.info.baseKey || "";
    if (hasLeo && LEO_KEYS.includes(bk)) v3.setVisible(e, false);
    if (e.divergence || e.extras?.confiavel === false || bk === "thrombus" || bk.startsWith("renal_artery")) {
      if (!e.source.unreliable) v3.setVisible(e, false);     // na fonte "opcional" (já desligada) os itens ficam prontos para ver
    }
  }
  // GT do Leo: se a fusão GT (viewer_assets_gt lite) trouxe as malhas fonte=cirurgiao (mesmas máscaras do Leo, malha nova com
  // todas as ilhas do tumor e todos os pedaços da pelve), elas viram a camada padrão e o leo_gt.glb (malha anterior) fica disponível, desligado.
  const gtLite = v3.sources.find((s) => s.fused_gt && !s.unreliable && !s.deprecated && s.group.visible);
  const gtCir = gtLite ? v3.entries.filter((e) => e.source.id === gtLite.id && e.extras?.fonte === "cirurgiao") : [];
  if (gtCir.length) {
    for (const e of gtCir) v3.setVisible(e, true);
    for (const e of v3.entries) if (e.source.leo_gt) v3.setVisible(e, false);
  }
  // viewer_assets_gt: padrões por nó do scene_manifest.json (default_visible=false → desligado; default_opacity), lidos do arquivo.
  // Só desliga/ajusta opacidade — nunca religa o que as regras acima desligaram (ex.: confiavel=false).
  for (const e of v3.entries) {
    const sd = e.source.scene_defaults?.[e.name];
    if (!sd) continue;
    if (sd.default_visible === false) v3.setVisible(e, false);
    if (typeof sd.default_opacity === "number" && sd.default_opacity < 1) { v3.setOpacity(e, sd.default_opacity); e.defaultOpacity = sd.default_opacity; }
  }
  // ureteres/gonadais: padrões e estilo por nó vindos do manifesto (node_info); prevalecem sobre as regras gerais acima
  for (const e of v3.entries) {
    const ni = e.source.node_info?.[e.name];
    if (!ni) continue;
    v3.setVisible(e, !!ni.default_visible);
    if (ni.color && /^#[0-9a-f]{6}$/i.test(ni.color) && !e.extras?.cor) { v3.setColor(e, ni.color); e.anatColor = ni.color; }
    if (ni.style?.opacity != null) { v3.setOpacity(e, ni.style.opacity); e.defaultOpacity = ni.style.opacity; }
  }
  renderStructList();
  renderDistances();
  v3.fit();
  updateHud(v3, $("#hud3d"));
  $("#allOn").onclick = () => { v3.entries.forEach((e) => v3.setVisible(e, true)); renderStructList(); };
  $("#allOff").onclick = () => { v3.entries.forEach((e) => v3.setVisible(e, false)); renderStructList(); };
  $("#resetCol").onclick = () => { v3.entries.forEach((e) => { v3.setColor(e, e.anatColor); v3.setOpacity(e, e.defaultOpacity); }); renderStructList(); };
}

// ---------------------------------------------------------------- distâncias do tumor (lidas do QA; nunca digitadas)
function fmtMm(x) { return x == null ? "—" : Number(x).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 }) + " mm"; }
function renderDistances() {
  const box = $("#distList");
  if (!box) return;
  box.replaceChildren();
  const td = TEST ? null : manifest.tumor_distances;
  if (!td || !td.found) { box.append(h("p", { class: "small pending" }, "Sem arquivo de distâncias (esperado: out/qa/fused_gt/qa_fused_gt.json).")); return; }
  const row = (r) => h("tr", { class: "dist-" + r.kind, title: `${r.target_en}${r.k != null ? " · corte k" + r.k : ""}${r.scene_manifest_mm != null ? " · scene_manifest: " + r.scene_manifest_mm + " mm" : ""}` },
    h("td", {}, r.label), h("td", { class: "num" }, r.kind === "na" ? "n/d" : (r.kind === "landmark" ? "≈ " : "") + fmtMm(r.mm)),
    h("td", { class: "small" }, r.kind === "contact" || r.kind === "overlap_ctx" ? h("span", { class: "badge div" }, "não é invasão") : null, " ", r.note));
  const head = () => h("tr", {}, h("th", {}, "Estrutura"), h("th", {}, "Mín."), h("th", {}, "Observação"));
  const prim = td.rows.filter((r) => r.primary), rest = td.rows.filter((r) => !r.primary);
  box.append(h("p", { class: "small" }, "Tumor = GT do Leo (interp). Distância mínima entre centros de voxels de borda; ~0,93 mm = voxels adjacentes."),
    h("table", { class: "tbl dist" }, head(), ...prim.map(row)),
    h("details", {}, h("summary", { class: "small" }, `Outras estruturas (${rest.length})`), h("table", { class: "tbl dist" }, head(), ...rest.map(row))),
    h("p", { class: "small muted" }, "Fonte: ", h("a", { href: td.md_url || td.url, target: "_blank", style: "color:#8fd3ff" }, td.md_path || td.path),
      ` (valores de ${td.path.split("/").pop()}; conferido com viewer_assets_gt/scene_manifest.json${td.crosscheck_mismatches?.length ? " — DIVERGÊNCIAS: " + td.crosscheck_mismatches.join("; ") : ": sem divergências"}).`));
}

function buildClipRows(viewer) {
  const names = { axial: "Axial", coronal: "Coronal", sagittal: "Sagital" };
  const hints = { axial: ["mantém inferior", "mantém superior"], coronal: ["mantém posterior", "mantém anterior"], sagittal: ["mantém esquerdo", "mantém direito"] };
  const box = $("#clipRows");
  for (const k of Object.keys(names)) {
    const st = viewer.clip[k];
    const flip = h("button", { type: "button", class: "small", title: "Inverter lado mantido" }, "Inverter");
    const hint = h("div", { class: "small muted", style: "grid-column:2 / 4" }, hints[k][0]);
    flip.onclick = () => { st.flip = !st.flip; hint.textContent = hints[k][st.flip ? 1 : 0]; viewer.updateClipping(); };
    box.append(h("div", { class: "clip" },
      h("label", {}, h("input", { type: "checkbox", onchange: (ev) => { st.enabled = ev.target.checked; viewer.updateClipping(); } }), " ", names[k]),
      h("input", { type: "range", min: 0, max: 1000, value: 500, oninput: (ev) => { st.pos = ev.target.value / 1000; viewer.updateClipping(); } }),
      flip), hint);
  }
}

function renderStructList() {
  const list = $("#structList");
  list.replaceChildren();
  const visibleSrc = new Set(v3.sources.filter((s) => s.group.visible).map((s) => s.id));
  const entries = v3.entries.filter((e) => visibleSrc.has(e.source.id));
  $("#structCount").textContent = `(${entries.length})`;
  const present3d = new Set(entries.map((e) => e.info.baseKey));
  for (const cat of CATEGORIES) {
    const es = entries.filter((e) => e.cat === cat.id).sort((a, b) => a.info.label.localeCompare(b.info.label, "pt-BR"));
    if (cat.id === "onco") {
      const pr = pendingRows(present3d);
      if (!es.length && pr.length) { list.append(h("div", { class: "cat onco" }, h("div", { class: "cat-h" }, cat.label), ...pr)); continue; }
      if (pr.length) setTimeout(() => list.querySelector(".cat.onco")?.append(...pr), 0);
    }
    if (!es.length) continue;
    const allOn = es.every((e) => e.visible);
    const sec = h("div", { class: "cat " + cat.id });
    sec.append(h("div", { class: "cat-h" },
      h("input", { type: "checkbox", checked: allOn, title: "Mostrar/ocultar grupo", onchange: (ev) => { es.forEach((e) => v3.setVisible(e, ev.target.checked)); renderStructList(); } }),
      cat.label, h("span", { class: "n" }, `(${es.length})`)));
    for (const e of es) sec.append(structItem(v3, e, renderStructList));
    list.append(sec);
  }
}

// Camadas oncológicas que só existem após a fusão de modelos: nunca desenhadas pelo visualizador.
const PENDING = [
  { key: "tumor", label: "Tumor renal (completo)", note: "aguardando fusão (label 20). A massa renal esquerda está majoritariamente FORA do kidney_left; só a semente corrigida por Leo (voxels removidos do kidney_left) é desenhada." },
  { key: "thrombus", label: "Trombo tumoral (veia renal/VCI)", note: "aguardando fusão (label 21)." },
];
function pendingRows(presentKeys) {
  return PENDING.filter((p) => !presentKeys.has(p.key)).map((p) =>
    h("div", { class: "item off pending-row", title: p.note },
      h("input", { type: "checkbox", disabled: true }),
      h("span", { class: "swatch", style: `background:${describe(p.key).color};opacity:.35` }),
      h("div", { class: "name" }, p.label, h("span", { class: "badge div" }, "aguardando fusão"), h("small", {}, p.note)),
      h("div", {})));
}

function structItem(viewer, e, rerender, opts = {}) {
  const ni = e.source?.node_info?.[e.name];
  if (ni && !opts.label) opts = { ...opts, label: ni.label, sub: [...(ni.info || []), e.name].join(" · "), badge: ni.badge, translucent: ni.style?.translucent };
  const val = h("span", { class: "small muted" }, Math.round(e.opacity * 100) + "%");
  const row = h("div", { class: "item" + (e.visible ? "" : " off"), title: `Nó no GLB: ${e.name}\nFonte: ${e.source.label}\nModelo: ${e.model}` },
    h("input", { type: "checkbox", checked: e.visible, onchange: (ev) => { viewer.setVisible(e, ev.target.checked); row.classList.toggle("off", !ev.target.checked); } }),
    h("input", { type: "color", value: e.color, disabled: e.divergence && !opts.allowColor, title: e.divergence ? "Divergência: sempre amarelo" : "Cor", oninput: (ev) => viewer.setColor(e, ev.target.value) }),
    h("div", { class: "name" }, opts.label || e.info.label,
      e.source.synthetic ? h("span", { class: "badge syn" }, "SINTÉTICO") : null,
      e.divergence ? h("span", { class: "badge div" }, "revisar") : null,
      opts.badge ? h("span", { class: "badge div" }, opts.badge) : null,
      opts.translucent ? h("span", { class: "badge" }, "translúcido") : null,
      h("small", {}, opts.sub || `${e.model} · ${e.name}`)),
    h("div", {}, h("input", { type: "range", min: 0, max: 100, value: Math.round(e.opacity * 100), oninput: (ev) => { viewer.setOpacity(e, ev.target.value / 100); val.textContent = ev.target.value + "%"; } }), val));
  return row;
}

// ================================================================= COMPARAÇÃO
let vc = null;
let cmpKey = null;

function allStructureKeys() {
  const keys = new Map();
  const add = (info, from) => {
    if (info.divergence) return;
    const k = info.baseKey;
    if (!keys.has(k)) keys.set(k, { key: k, label: info.label, cat: info.cat, n3d: 0, n2d: 0 });
    keys.get(k)[from]++;
  };
  if (vc) vc.entries.forEach((e) => add(e.info, "n3d"));
  masksList().filter((m) => m.kind === "structure").forEach((m) => add(describe(m.structure_raw), "n2d"));
  const order = Object.fromEntries(CATEGORIES.map((c, i) => [c.id, i]));
  return [...keys.values()].sort((a, b) => (order[a.cat] - order[b.cat]) || a.label.localeCompare(b.label, "pt-BR"));
}

async function initCompare() {
  const srcs = glbSources();
  vc = new Viewer3D($("#vcmp"), { convention: convKey, materialSpec: manifest.material_spec?.data || null });
  buildViewButtons($("#cmpViewBtns"), vc, $("#hudCmp"));
  $("#cmpFit").onclick = () => vc.fit();
  $("#cmpShot").onclick = () => vc.screenshot({ title: "Comparação: " + (describe(cmpKey || "").label), synthetic: TEST });
  for (const s of srcs) {
    try { await vc.loadGLB(s); } catch (err) { console.error(err); }
  }
  const keys = allStructureKeys();
  const sel = $("#cmpStruct");
  sel.replaceChildren();
  if (!keys.length) {
    const w = $("#waitCmp"); w.hidden = false;
    w.replaceChildren(waitingCard("Aguardando segmentação", [
      "Não há GLBs nem máscaras por modelo para comparar ainda.",
      "Esperado: GLBs em out/glb/, máscaras em out/viewer_masks/ e out/fused/ (e outras pastas por modelo em out/).",
    ], testLink()));
  }
  for (const k of keys) sel.append(h("option", { value: k.key }, `${k.label}  (3D: ${k.n3d} · 2D: ${k.n2d})`));
  const pref = ["tumor", "thrombus", "inferior_vena_cava", "renal_vein_left", "kidney_left"].find((k) => keys.some((x) => x.key === k));
  cmpKey = pref || keys[0]?.key || null;
  if (cmpKey) sel.value = cmpKey;
  sel.onchange = () => { cmpKey = sel.value; applyCompare(true); renderMetrics(); };
  document.querySelectorAll("input[name=cmpColor]").forEach((r) => (r.onchange = () => applyCompare(false)));
  $("#cmpContext").onchange = () => applyCompare(false);
  $("#metricsOnlySel").onchange = renderMetrics;
  $("#cmpTo2d").onclick = () => { openCompareIn2D(cmpKey); };
  applyCompare(true);
  renderMetrics();
}

function applyCompare(refit) {
  if (!vc) return;
  const byModel = $("input[name=cmpColor]:checked").value === "model";
  const ctx = $("#cmpContext").checked;
  const layers = $("#cmpLayers");
  layers.replaceChildren();
  const sel = [];
  for (const e of vc.entries) {
    const match = e.info.baseKey === cmpKey;
    if (match) {
      sel.push(e);
      const col = e.divergence ? DIVERGENCE_COLOR : byModel ? modelColor(e.model) : e.anatColor;
      vc.setColor(e, col);
      vc.setOpacity(e, e.divergence ? DIVERGENCE_OPACITY : byModel ? 0.55 : e.defaultOpacity);
      vc.setVisible(e, true);
    } else if (ctx && !e.divergence) {
      vc.setColor(e, "#8a949a"); vc.setOpacity(e, 0.12); vc.setVisible(e, true);
    } else vc.setVisible(e, false);
  }
  if (!sel.length) layers.append(h("p", { class: "small pending" }, cmpKey ? "Esta estrutura não existe em nenhum GLB carregado (veja as máscaras 2D abaixo)." : "Aguardando segmentação."));
  sel.sort((a, b) => Number(a.divergence) - Number(b.divergence) || a.model.localeCompare(b.model));
  for (const e of sel) {
    layers.append(structItem(vc, e, null, {
      label: e.divergence ? "Divergência (revisar)" : e.model,
      sub: `${e.source.label} · nó ${e.name}`, allowColor: false,
    }));
  }
  updateHud(vc, $("#hudCmp"), describe(cmpKey || "").label);
  // máscaras 2D desta estrutura
  const mbox = $("#cmpMasks");
  mbox.replaceChildren();
  const ms = compareMasks(cmpKey);
  if (!ms.length) mbox.append(h("p", { class: "small pending" }, "Nenhuma máscara NIfTI desta estrutura ainda (aguardando segmentação)."));
  for (const m of ms) mbox.append(h("div", { class: "li" }, h("span", { class: "swatch", style: `background:${m.kind === "disagreement" ? DIVERGENCE_COLOR : modelColor(m.model)}` }), `${m.kind === "disagreement" ? "Divergência" : m.model}`, h("span", { class: "muted small" }, " " + m.file)));
  $("#cmpTo2d").disabled = !ms.length;
  if (refit && sel.length) {
    // enquadra só a estrutura selecionada
    const hidden = vc.entries.filter((e) => !sel.includes(e) && e.visible);
    hidden.forEach((e) => (e.object.visible = false));
    const vis = vc.entries.map((e) => e.visible);
    vc.entries.forEach((e) => { if (!sel.includes(e)) e.visible = false; });
    vc.fit();
    vc.entries.forEach((e, i) => (e.visible = vis[i]));
    hidden.forEach((e) => (e.object.visible = true));
  }
}

function compareMasks(key) {
  if (!key) return [];
  return masksList().filter((m) => describe(m.structure_raw).baseKey === key && (m.kind === "structure" || m.kind === "disagreement"));
}

function metricsRows() {
  if (TEST) return manifest.test?.metrics?.rows || [];
  return manifest.metrics?.rows || [];
}

function renderMetrics() {
  const box = $("#metricsBox");
  box.replaceChildren();
  const found = TEST ? !!manifest.test?.metrics : manifest.metrics?.found;
  if (!found) {
    box.append(h("p", { class: "pending" }, "Aguardando métricas — arquivo ainda não existe: ", h("code", {}, manifest.metrics?.expected_path || "out/monai/metrics.json")));
    return;
  }
  let rows = metricsRows();
  if (TEST) box.append(h("p", { class: "small", style: "color:#ff9aa6;font-weight:700" }, "MÉTRICAS SINTÉTICAS DE TESTE — valores fictícios, não são do paciente."));
  const files = TEST ? [manifest.test.metrics] : manifest.metrics.files;
  box.append(h("p", { class: "small muted" }, "Fonte: ", files.map((f) => f.path).join(", ")));
  if ($("#metricsOnlySel").checked && cmpKey) rows = rows.filter((r) => describe(r.structure || "").baseKey === cmpKey);
  if (!rows.length) {
    box.append(h("p", { class: "small pending" }, "Nenhuma linha de Dice/HD95 reconhecida" + ($("#metricsOnlySel").checked ? " para esta estrutura." : ". Conteúdo bruto abaixo.")));
  } else {
    const extraKeys = [...new Set(rows.flatMap((r) => Object.keys(r.extra || {})))].slice(0, 4);
    const t = h("table", { class: "tbl" }, h("tr", {}, h("th", {}, "Estrutura"), h("th", {}, "Comparação (modelos)"),
      h("th", {}, "Dice"), h("th", {}, "HD95 (unid. do arquivo, em geral mm)"), ...extraKeys.map((k) => h("th", {}, k))));
    for (const r of rows) {
      const d = describe(r.structure || "");
      t.append(h("tr", {}, h("td", {}, d.known ? `${d.label}` : (r.structure || "—"), h("span", { class: "muted small" }, d.known ? ` (${r.structure})` : "")),
        h("td", {}, r.comparison || "—"), h("td", { class: "num" }, fmt(r.dice, 3)), h("td", { class: "num" }, fmt(r.hd95, 2)),
        ...extraKeys.map((k) => h("td", {}, r.extra?.[k] ?? ""))));
    }
    box.append(t);
  }
  for (const f of files) {
    if (f.raw) box.append(h("details", {}, h("summary", { class: "small muted" }, "Conteúdo bruto de " + f.path + (f.raw_truncated ? " (truncado)" : "")), h("pre", { class: "small" }, f.raw)));
    if (f.error) box.append(h("p", { class: "small pending" }, "Erro ao ler " + f.path + ": " + f.error));
  }
}

// ================================================================= 2D (Niivue)
let nv = null;
let baseVol = null;
const overlayState = new Map(); // url -> {mask, on, opacity, color, vol, loading}
let cmpMode = null;
const WINDOWS = {
  soft: { label: "Partes moles (W400/L40)", min: -160, max: 240 },
  vessel: { label: "Vascular/contraste (W600/L150)", min: -150, max: 450 },
  bone: { label: "Osso (W1800/L400)", min: -500, max: 1300 },
  wide: { label: "Ampla (W1000/L0)", min: -500, max: 500 },
};
let curWin = "soft";

function maskColor(m) {
  if (m.kind === "disagreement") return DIVERGENCE_COLOR;
  if (cmpMode) return modelColor(m.model);
  return m.color || describe(m.structure_raw).color || "#cccccc";
}
function cmapFor(hex) {
  const name = "m" + hex.replace("#", "");
  if (!nv.colormaps().includes(name)) {
    const [r, g, b] = hexToRgb(hex);
    nv.addColormap(name, { R: [0, r, r], G: [0, g, g], B: [0, b, b], A: [0, 255, 255], I: [0, 1, 255] });
  }
  return name;
}

const LEO_KEYS = ["tumor", "kidney_left", "collecting_system", "collecting_system_left", "tumor_seed", "kidney_left_corrected", "uncertain_k184"];
function maskGroups() {
  const groups = new Map();
  const add = (gid, label, m) => { if (!groups.has(gid)) groups.set(gid, { id: gid, label, masks: [] }); groups.get(gid).masks.push(m); };
  for (const m of masksList()) {
    if (m.kind === "disagreement") add("diverg", "Revisão: divergência entre modelos", m);
    else if (m.group === "leo_gt") add("leo_gt", "Ground truth do Leo — prioridade máxima", m);
    else if (m.group === "ureter_gonadal") add("ureter_gonadal", "Ureteres e gonadais (semi-automático)", m);
    else if (m.group === "fused_gt") add("fused_gt", "Fusão com GT do Leo — máscaras individuais", m);
    else if (m.group === "fused") add("fused", "Fusão de modelos anterior (STAPLE / maioria) — secundário", m);
    else if (m.group === "corrected") add("corrected", "Correção de Leo — rim corrigido / semente / incerto", m);
    else add("model:" + m.model, m.model, m);
  }
  const order = (g) => (g.id === "leo_gt" ? -4 : g.id === "ureter_gonadal" ? -3.5 : g.id === "fused_gt" ? -3 : g.id === "fused" ? -2 : g.id === "corrected" ? -1 : g.id === "diverg" ? 9 : 1);
  return [...groups.values()].sort((a, b) => order(a) - order(b) || a.label.localeCompare(b.label));
}

const DEFAULT_ON = ["tumor", "thrombus", "inferior_vena_cava", "renal_vein_left", "kidney_left", "aorta", "renal_artery_left"];

async function init2D() {
  const vols = baseVolumes().filter((v) => v.exists);
  const wait = $("#wait2d");
  const ps = $("#phaseSel");
  for (const v of vols) ps.append(h("option", { value: v.url, selected: v.default }, `${v.label}${v.header?.dims ? " — " + v.header.dims.join("×") : ""} (${v.size_mb} MB)`));
  for (const [k, w] of Object.entries(WINDOWS)) $("#winBtns").append(h("button", { type: "button", class: k === curWin ? "active" : "", "data-w": k, onclick: () => setWindow(k) }, w.label));
  if (!vols.length) {
    wait.hidden = false;
    wait.replaceChildren(waitingCard("Aguardando volume de TC", ["Nenhum NIfTI de base encontrado em phases/."]));
    return;
  }
  nv = new niivue.Niivue({
    backColor: [0.05, 0.06, 0.07, 1], show3Dcrosshair: true, isRadiologicalConvention: true,
    dragAndDropEnabled: false, isColorbar: false,
    onLocationChange: (d) => { $("#hud2d").textContent = (TEST ? "FANTOMA SINTÉTICO · " : "") + ((d && d.string) ? d.string : ""); },
  });
  nv.opts.crosshairWidth = 1;
  nv.setCrosshairColor([0.2, 0.9, 0.9, 1]);
  await nv.attachToCanvas($("#nvCanvas"));
  const layouts = [["Multiplanar", nv.sliceTypeMultiplanar], ["Axial", nv.sliceTypeAxial], ["Coronal", nv.sliceTypeCoronal], ["Sagital", nv.sliceTypeSagittal], ["Render 3D", nv.sliceTypeRender]];
  for (const [lab, t] of layouts) $("#layoutBtns").append(h("button", { type: "button", onclick: (ev) => { nv.setSliceType(t); document.querySelectorAll("#layoutBtns button").forEach((b) => b.classList.toggle("active", b === ev.target)); } }, lab));
  $("#layoutBtns button").classList.add("active");
  ps.onchange = () => loadBase(ps.value);
  // estado inicial das máscaras
  const hasFused = masksList().some((m) => m.group === "fused" && m.kind === "structure");
  const hasCorrected = masksList().some((m) => m.group === "corrected" && describe(m.structure_raw).baseKey === "kidney_left_corrected");
  const hasLeo = masksList().some((m) => m.group === "leo_gt");
  const lsets = labelSets2D();
  const lmAvail = lsets.length > 0;
  if (lmAvail) {
    const want = WANT_SET[params.get("rotulos") || ""];
    lm.set = lsets.find((x) => x.id === want) || lsets.find((x) => x.default) || lsets[0];
  }
  for (const m of masksList()) {
    const d = describe(m.structure_raw);
    const primary = hasFused ? m.group === "fused" : m.group === "viewer_masks";
    let on = m.kind === "structure" && primary && DEFAULT_ON.includes(d.baseKey);
    if (m.group === "corrected") on = ["kidney_left_corrected", "tumor_seed", "uncertain_k184"].includes(d.baseKey);
    if (hasCorrected && d.baseKey === "kidney_left" && m.group !== "corrected") on = false;   // original continua disponível, desligado
    if (hasLeo) {
      if (m.group === "leo_gt") on = !!m.default_on;                       // interp ligado; refinado e raw desligados
      else if (m.group === "corrected") on = false;                         // correção anterior: disponível, desligada
      else if (LEO_KEYS.includes(d.baseKey)) on = false;                    // tumor/rim/sist. coletor da fusão e modelos: secundários
    }
    if (d.baseKey === "thrombus" || d.baseKey.startsWith("renal_artery") || m.kind === "disagreement") on = false;   // pouco confiáveis
    if (lmAvail) on = false;     // o mapa de rótulos (padrão) já mostra tudo isto; máscaras individuais ficam disponíveis, desligadas
    if (m.group === "ureter_gonadal") on = !!m.default_on;   // fora do mapa de rótulos: padrões do manifesto (trombo gonadal ligado, com selo de incerteza)
    overlayState.set(m.url, { mask: m, on, opacity: m.kind === "disagreement" ? 0.45 : m.group === "leo_gt" ? 0.6 : m.group === "corrected" ? 0.6 : 0.55, vol: null });
  }
  renderMaskGroups();
  renderLabelMapCtl();
  await loadBase(ps.value);
}

// ---------------------------------------------------------------- 2D: mapa de rótulos ROI (0,8 mm) sobre a TC
// NIfTI com cache-bust (arquivos regenerados no mesmo caminho): ?v=<mtime>; "name" mantém o nome do arquivo p/ o Niivue detectar o formato
function niiUrl(url, ver) {
  const name = url.split("/").pop().split("?")[0];
  return { url: url + (url.includes("?") ? "&" : "?") + "v=" + encodeURIComponent(ver || Date.now()), name };
}
const WANT_SET = { corrigido: "corrected", corrigidos: "corrected", original: "original", originais: "original", leo: "leo", gt: "leo", fusao: "fused", fused: "fused", fusao_gt: "fused_gt", fused_gt: "fused_gt", fusaogt: "fused_gt" };
const lm = { set: null, on: true, opacity: 0.5, vol: null, rows: [], hidden: new Set(), loading: false, error: null };
function labelSets2D() { return TEST ? [] : (manifest.volume?.label_sets || []).filter((x) => x.ok && x.nifti_url); }
async function lmMeta(set) {
  if (set.id === "original" || !set.meta_url) return manifest.volume?.meta || {};
  return (await fetch(set.meta_url + "?t=" + Date.now(), { cache: "no-store" })).json();
}
async function loadLabelMap(set) {
  if (!nv || !set) return;
  lm.loading = true; lm.error = null; renderLabelMapCtl();
  try {
    const meta = await lmMeta(set);
    const rows = [...(meta.labels?.table || [])].sort((a, b) => a.id - b.id);
    lm.rows = rows.map((r) => ({ ...r, ...labelmapEntry(set, r) }));
    lm.hidden = new Set(set.hidden_ids || []);
    if (lm.vol) { nv.removeVolume(lm.vol); lm.vol = null; }
    await nv.addVolumeFromUrl({ ...niiUrl(set.nifti_url, Date.now()), opacity: lm.opacity });
    lm.vol = nv.volumes[nv.volumes.length - 1];
    lm.set = set;
    applyLabelLut();
  } catch (err) { console.error(err); lm.error = String(err.message || err); }
  lm.loading = false;
  renderLabelMapCtl();
}
function applyLabelLut() {
  if (!lm.vol) return;
  const maxId = Math.max(25, ...lm.rows.map((r) => r.id));
  const R = [], G = [], B = [], A = [], I = [], labels = [];
  for (let i = 0; i <= maxId; i++) {
    const r = lm.rows.find((x) => x.id === i);
    const [cr, cg, cb] = i && r ? hexToRgb(r.color) : [0, 0, 0];
    R.push(cr); G.push(cg); B.push(cb); A.push(i && r && !lm.hidden.has(i) ? 255 : 0); I.push(i); labels.push(r ? r.label : "");
  }
  lm.vol.setColormapLabel({ R, G, B, A, I, labels });
  const idx = nv.volumes.indexOf(lm.vol);
  if (idx > 0) nv.setOpacity(idx, lm.on ? lm.opacity : 0);
  nv.updateGLVolume();
}
const NEW_IDS = { fused_gt: [18, 19, 24, 25, 26] };
function renderLabelMapCtl() {
  const box = $("#labelMapCtl");
  if (!box) return;
  box.replaceChildren();
  const sets = labelSets2D();
  if (!sets.length) { $("#lmBox").hidden = true; return; }
  $("#lmBox").hidden = false;
  const sel = h("select", { onchange: (ev) => { const ns = sets.find((x) => x.id === ev.target.value); if (ns) loadLabelMap(ns); } },
    ...sets.map((x) => h("option", { value: x.id, selected: lm.set && x.id === lm.set.id }, x.label)));
  const val = h("span", { class: "small muted" }, Math.round(lm.opacity * 100) + "%");
  box.append(h("label", { class: "small" }, "Conjunto ", sel),
    h("div", { class: "row small" },
      h("label", {}, h("input", { type: "checkbox", checked: lm.on, onchange: (ev) => { lm.on = ev.target.checked; applyLabelLut(); } }), " Mostrar mapa"),
      h("input", { type: "range", min: 0, max: 100, value: Math.round(lm.opacity * 100), oninput: (ev) => { lm.opacity = ev.target.value / 100; val.textContent = ev.target.value + "%"; applyLabelLut(); } }), val));
  const sid = lm.set && lm.set.id;
  box.append(h("p", { class: "small muted" }, sid === "fused_gt"
    ? "Padrão: out/volume/labels_roi_fused_gt_u8.raw (NIfTI equivalente labels_roi_fused_gt.nii.gz; mesma ROI 302×239×347, 0,8 mm). 1, 18 e 20 = GT do Leo; 26 iliopsoas esquerdo (TotalSegmentator) com a sobreposição do tumor do Leo subtraída — contato de máscaras, não invasão; 21 trombo (candidato) e 22/23 vasos renais (não confiáveis) desligados. Fora da ROI (caixa de rins/VCI/aorta + massa) não há rótulos — o corte reto no fígado é a borda da ROI."
    : sid === "leo" ? "Ground truth do Leo (labels_roi_leo_u8.raw): 20 tumor, 1 rim esquerdo, 18 sistema coletor; demais = TotalSegmentator."
    : "Mapa de rótulos anterior (disponível para comparação)."));
  if (lm.loading) box.append(h("p", { class: "small" }, "Carregando mapa de rótulos…"));
  if (lm.error) box.append(h("p", { class: "small pending" }, "Falha ao carregar mapa de rótulos: " + lm.error));
  const nov = NEW_IDS[sid] || [];
  for (const r of lm.rows) {
    const empty = !r.voxels;
    box.append(h("div", { class: "item" + (lm.hidden.has(r.id) || empty ? " off" : ""), title: `id ${r.id} · ${r.name} · ${r.status || ""}` },
      h("input", { type: "checkbox", checked: !lm.hidden.has(r.id), onchange: (ev) => { if (ev.target.checked) lm.hidden.delete(r.id); else lm.hidden.add(r.id); applyLabelLut(); renderLabelMapCtl(); } }),
      h("span", { class: "swatch", style: `background:${r.color}` }),
      h("div", { class: "name" }, `${r.id} · ${r.label}`,
        nov.includes(r.id) ? h("span", { class: "badge ok" }, "novo") : null,
        (lm.set?.hidden_ids || []).includes(r.id) ? h("span", { class: "badge div" }, "não confiável") : null,
        h("small", {}, empty ? `${r.name}: vazio` : `${r.name} · ${Number(r.voxels).toLocaleString("pt-BR")} voxels${r.volume_ml != null ? " · " + Number(r.volume_ml).toLocaleString("pt-BR") + " mL na ROI" : ""}`)),
      h("div", {})));
  }
}

async function loadBase(url) {
  const info = baseVolumes().find((v) => v.url === url);
  $("#hud2d").textContent = `Carregando ${info?.label || url} (${info?.size_mb || "?"} MB)…`;
  const warn = $("#phaseWarn");
  warn.hidden = !(info && !["venous", "synthetic"].includes(info.id));
  warn.textContent = "Máscaras foram geradas na fase venosa. Em outra fase, a sobreposição usa só a geometria do cabeçalho (sem registro) e pode ficar desalinhada.";
  const old = baseVol;
  try {
    if (!old) {
      await nv.loadVolumes([{ url, colormap: "gray", opacity: 1, cal_min: WINDOWS[curWin].min, cal_max: WINDOWS[curWin].max }]);
      baseVol = nv.volumes[0];
      nv.setSliceType(nv.sliceTypeMultiplanar);
    } else {
      await nv.addVolumeFromUrl({ url, colormap: "gray", opacity: 1, cal_min: WINDOWS[curWin].min, cal_max: WINDOWS[curWin].max });
      const nvv = nv.volumes[nv.volumes.length - 1];
      nv.setVolume(nvv, 0);
      nv.removeVolume(old);
      baseVol = nvv;
    }
    setWindow(curWin);
    if (lm.set && !lm.vol && !lm.loading) await loadLabelMap(lm.set);
    $("#hud2d").textContent = `${info?.label || url} carregado. Convenção radiológica: lado direito da imagem = ESQUERDA do paciente (R/L/A/P/S/I = rótulos do Niivue, em inglês).`;
    await syncOverlays();
  } catch (err) {
    console.error(err);
    $("#hud2d").textContent = "Falha ao carregar TC: " + (err.message || err);
  }
}

function setWindow(k) {
  curWin = k;
  document.querySelectorAll("#winBtns button").forEach((b) => b.classList.toggle("active", b.dataset.w === k));
  if (!baseVol) return;
  baseVol.cal_min = WINDOWS[k].min; baseVol.cal_max = WINDOWS[k].max;
  nv.updateGLVolume();
}

async function syncOverlays() {
  if (!nv || !baseVol) return;
  for (const st of overlayState.values()) {
    const visible = st.on && (!cmpMode || cmpMode.urls.includes(st.mask.url));
    const color = maskColor(st.mask);
    if (visible && !st.vol && !st.loading) {
      st.loading = true;
      try {
        await nv.addVolumeFromUrl({ ...niiUrl(st.mask.url, st.mask.mtime), colormap: cmapFor(color), opacity: st.opacity, cal_min: 0.5, cal_max: 1 });
        st.vol = nv.volumes[nv.volumes.length - 1];
        st.color = color;
      } catch (err) { console.error(err); st.error = String(err.message || err); }
      st.loading = false;
    }
    if (st.vol) {
      if (st.color !== color) { st.vol.colormap = cmapFor(color); st.color = color; }
      const idx = nv.volumes.indexOf(st.vol);
      if (idx > 0) nv.setOpacity(idx, visible ? st.opacity : 0);
    }
  }
  nv.updateGLVolume();
  renderMaskGroups();
}

function renderMaskGroups() {
  const box = $("#maskGroups");
  box.replaceChildren();
  const groups = maskGroups();
  if (!groups.length) {
    box.append(h("p", { class: "pending" }, "Aguardando segmentação — nenhuma máscara em out/viewer_masks/ ou out/fused/ ainda."));
    return;
  }
  const present2d = new Set(masksList().filter((m) => m.kind === "structure").map((m) => describe(m.structure_raw).baseKey));
  const pr2 = pendingRows(present2d);
  if (pr2.length) box.append(h("div", { class: "cat onco" }, h("div", { class: "cat-h" }, "Tumor e trombo"), ...pr2));
  const baseDims = baseVolumes().find((v) => v.url === $("#phaseSel").value)?.header?.dims?.join("×");
  for (const g of groups) {
    const sts = g.masks.map((m) => overlayState.get(m.url)).filter(Boolean);
    const sec = h("div", { class: "cat" + (g.id === "diverg" ? " diverg" : "") });
    sec.append(h("div", { class: "cat-h" },
      h("input", { type: "checkbox", checked: sts.length && sts.every((s) => s.on), onchange: (ev) => { sts.forEach((s) => (s.on = ev.target.checked)); syncOverlays(); } }),
      g.label, h("span", { class: "n" }, `(${sts.length})`)));
    if (g.id === "diverg") sec.append(h("p", { class: "small warn-inline" }, "Regiões onde os modelos discordam — revisar manualmente."));
    if (g.id === "leo_gt") sec.append(h("p", { class: "small" }, (labelSets2D().length ? "Já incluído no mapa de rótulos (ids 20, 1 e 18); ligue aqui para ver a máscara na grade original. " : "") + "Desenho do Leo nas grades (VERMELHO tumor · VERDE rim esq. · AMARELO sistema coletor). interp = cortes desenhados + cortes pulados interpolados (padrão); refinado = faixa ≤2 voxels na venosa+tardia; raw = só os cortes desenhados. Rim só desenhado em k240–214."));
    if (g.id === "ureter_gonadal") sec.append(h("p", { class: "small muted" }, "Semi-automático (COLAB TRAINER), grade venosa. Sem artéria gonadal e sem ureter esquerdo confiável: a trajetória estimada do ureter esquerdo fica desligada. O trombo gonadal fica ligado a pedido do Leo, com selo de incerteza."));
    if (g.id === "fused_gt") sec.append(h("p", { class: "small muted" }, "Máscaras da fusão com GT do Leo na grade original (512×512×404). Todas desligadas: o mapa de rótulos acima já as mostra. tumor_left / kidney_left / collecting_system = cópias do GT do Leo (fonte = cirurgião)."));
    if (g.id === "fused") sec.append(h("p", { class: "small muted" }, "Tumor/rim da fusão ficam desligados (o GT do Leo tem prioridade). Trombo (candidato, provável artefato), artérias renais e divergências: pouco confiáveis → desligados."));
    if (g.id === "corrected") sec.append(h("p", { class: "small warn-inline" }, "Semente de tumor = apenas voxels removidos do kidney_left por indicação de Leo (não é o tumor completo). Incerto = não decidido. O kidney_left original segue disponível no grupo TotalSegmentator (desligado por padrão)."));
    const sorted = sts.slice().sort((a, b) => describe(a.mask.structure_raw).label.localeCompare(describe(b.mask.structure_raw).label, "pt-BR"));
    for (const st of sorted) {
      const m = st.mask;
      const d = describe(m.structure_raw);
      const inCmp = !cmpMode || cmpMode.urls.includes(m.url);
      const val = h("span", { class: "small muted" }, Math.round(st.opacity * 100) + "%");
      const dims = m.header?.dims?.slice(0, 3).join("×");
      const note = [m.file, m.kind === "multilabel" ? "multirrótulo (cor única)" : "", dims && baseDims && dims !== baseDims ? `grade ${dims} ≠ base (reamostrado pelo affine)` : "", st.error ? "ERRO: " + st.error : "", st.loading ? "carregando…" : ""].filter(Boolean).join(" · ");
      sec.append(h("div", { class: "item" + (st.on && inCmp ? "" : " off") },
        h("input", { type: "checkbox", checked: st.on, onchange: (ev) => { st.on = ev.target.checked; syncOverlays(); } }),
        h("span", { class: "swatch", style: `background:${maskColor(m)}` }),
        h("div", { class: "name", title: m.path }, m.label || d.label, m.badge ? h("span", { class: "badge div" }, m.badge) : null, h("small", {}, note)),
        h("div", {}, h("input", { type: "range", min: 0, max: 100, value: Math.round(st.opacity * 100), onchange: (ev) => { st.opacity = ev.target.value / 100; val.textContent = ev.target.value + "%"; syncOverlays(); } }), val)));
    }
    box.append(sec);
  }
}

function openCompareIn2D(key) {
  const ms = compareMasks(key);
  if (!ms.length) return;
  cmpMode = { key, urls: ms.map((m) => m.url) };
  for (const m of ms) { const st = overlayState.get(m.url); if (st) st.on = true; }
  $("#cmpModeBox").hidden = false;
  $("#cmpModeLabel").textContent = `${describe(key).label} — cores por modelo`;
  showTab("t2d");
  const after = () => syncOverlays();
  if (nv && baseVol) after(); else setTimeout(function wait() { if (nv && baseVol) after(); else setTimeout(wait, 500); }, 500);
}
if ($("#cmpModeExit")) $("#cmpModeExit").onclick = () => { cmpMode = null; $("#cmpModeBox").hidden = true; syncOverlays(); };

// ================================================================= ARQUIVOS
function renderFiles() {
  $("#manInfo").textContent = `manifest.json (versão pública; datas removidas) · pasta de saída: ${manifest.out_dir} ${manifest.out_exists ? "" : "(ainda não existe)"}`;
  const t = $("#expectedTbl");
  t.replaceChildren(h("tr", {}, h("th", {}, "Item"), h("th", {}, "Caminho"), h("th", {}, "Status")));
  for (const e of manifest.expected || []) t.append(h("tr", {}, h("td", {}, e.label), h("td", {}, h("code", {}, e.path)),
    h("td", { class: e.exists ? "ok" : "pending" }, e.exists ? "✓ disponível" : "⏳ aguardando segmentação")));
  const fl = $("#fileList");
  fl.replaceChildren();
  const tb = h("table", { class: "tbl" }, h("tr", {}, h("th", {}, "Tipo"), h("th", {}, "Arquivo"), h("th", {}, "Modelo / grupo"), h("th", {}, "Estrutura (pt-BR)"), h("th", {}, "Tamanho"), h("th", {}, "Modificado")));
  for (const v of manifest.base_volumes || []) tb.append(h("tr", {}, h("td", {}, "TC base"), h("td", {}, h("code", {}, v.path)), h("td", {}, v.label), h("td", {}, v.header?.dims ? v.header.dims.join("×") + " vox, " + (v.header.pixdim || []).join("×") + " mm" : ""), h("td", {}, v.exists ? v.size_mb + " MB" : "ausente"), h("td", {}, v.mtime || "")));
  for (const g of manifest.glb || []) tb.append(h("tr", { title: g.deprecated_reason || "" }, h("td", {}, "GLB", g.deprecated ? h("span", { class: "badge div" }, "preterido") : null), h("td", {}, h("code", {}, g.path)), h("td", {}, g.model), h("td", {}, g.label), h("td", { class: g.exists ? "" : "pending" }, g.exists ? g.size_mb + " MB" : "aguardando"), h("td", {}, g.mtime || "")));
  for (const m of manifest.masks || []) tb.append(h("tr", {}, h("td", {}, m.kind === "disagreement" ? "Máscara (divergência)" : "Máscara"), h("td", {}, h("code", {}, m.path)), h("td", {}, `${m.model} / ${m.group}`), h("td", {}, describe(m.structure_raw).label), h("td", {}, m.size_mb + " MB"), h("td", {}, m.mtime || "")));
  if (TEST) for (const g of manifest.test?.glb || []) tb.append(h("tr", {}, h("td", {}, h("span", { class: "badge syn" }, "SINTÉTICO")), h("td", {}, h("code", {}, g.path)), h("td", {}, "teste"), h("td", {}, "NÃO é paciente"), h("td", {}, ""), h("td", {}, "")));
  fl.append(tb);
  if ((manifest.skipped_nifti || []).length) fl.append(h("p", { class: "small muted" }, "NIfTI ignorados (parecem imagens, não máscaras): " + manifest.skipped_nifti.join(", ")));
  if ((manifest.pipeline_notes || []).length) {
    fl.append(h("h4", {}, "Notas do pipeline de segmentação (volume_meta.json, texto original)"),
      h("ul", { class: "small" }, ...manifest.pipeline_notes.map((n) => h("li", {}, n))));
  }
  const cor = !TEST && manifest.corrections;
  if (cor && cor.found) {
    const vm = cor.volumes_ml || {};
    fl.append(h("h4", {}, "Correção de kidney_left por Leo (out/corrected/corrections.json)"),
      h("p", { class: "small" }, `kidney_left original ${vm.kidney_left_original} mL → rim corrigido ${vm.kidney_left_corrected} mL · semente de tumor ${vm.tumor_from_kidney_left} mL · incerto ${vm.uncertain_k184} mL`),
      h("table", { class: "tbl" }, h("tr", {}, h("th", {}, "Fragmento"), h("th", {}, "Descrição"), h("th", {}, "Classe"), h("th", {}, "Volume"), h("th", {}, "k (mín–máx)")),
        ...(cor.fragments || []).map((f) => h("tr", {}, h("td", {}, f.id), h("td", {}, f.name), h("td", {}, f.classification), h("td", {}, f.volume_ml + " mL"), h("td", {}, `${f.k_min}–${f.k_max}`)))),
      h("p", { class: "small warn-inline" }, "Decisões em aberto:"), h("ul", { class: "small" }, ...(cor.open_decisions || []).map((x) => h("li", {}, x))),
      h("p", { class: "small" }, "QA: ", ...(cor.qa_files || []).flatMap((q) => [h("a", { href: q.url, target: "_blank", style: "color:#8fd3ff" }, q.path.split("/").pop()), " "])));
  }
  if ((manifest.duplicate_masks_skipped || []).length) fl.append(h("p", { class: "small muted" }, `${manifest.duplicate_masks_skipped.length} máscaras em out/masks idênticas às de out/viewer_masks foram listadas uma só vez.`));
  const ai = $("#aiText");
  ai.replaceChildren();
  const aiList = TEST ? (manifest.test?.ai_text || []) : (manifest.ai_text || []);
  if (TEST) ai.append(h("p", { class: "small", style: "color:#ff9aa6;font-weight:700" }, "MODO TESTE: texto abaixo é SIMULADO para testar a exibição; não é saída real do VILA-M3 nem se refere ao paciente."));
  if (!aiList.length) ai.append(h("p", { class: "pending small" }, "Nenhuma descrição por IA (VILA-M3) encontrada em out/ — aguardando."));
  for (const a of aiList) {
    let content = a.content || "";
    if (a.format === "json") { try { content = JSON.stringify(JSON.parse(content), null, 2); } catch { /* texto bruto */ } }
    ai.append(h("div", { class: "ai-card" },
      h("div", { class: "ai-h" }, `🤖 TEXTO GERADO POR IA (${a.model}) — NÃO DIAGNÓSTICO`),
      h("div", { class: "small", style: "color:#ffcf5a" }, "Gerado automaticamente; pode conter erros ou alucinações. Não é laudo. Validar com radiologista."),
      h("div", { class: "small muted" }, a.path + (a.truncated ? " (truncado)" : "")),
      h("pre", {}, content)));
  }
}

// ================================================================= boot
async function main() {
  if (TEST) { $("#testBanner").hidden = false; document.title = "[TESTE SINTÉTICO] " + document.title; }
  try {
    manifest = await fetchManifest();
  } catch (err) {
    document.querySelector("main").replaceChildren(h("div", { class: "waiting" }, waitingCard("Manifesto ausente", [String(err.message || err), "Rode: python3 build_manifest.py"])));
    return;
  }
  manifestSig = sigOf(manifest);
  renderFiles();
  tabInit.tcmp = () => initCompare().catch(console.error);
  // versão pública: abas de cortes 2D e volume WebGPU desativadas (sem dados de imagem da TC)
  await init3D().catch((e) => { console.error(e); $("#hud3d").textContent = "Erro 3D: " + e; });
  const want0 = params.get("aba"); const want = (want0 === "t2d" || want0 === "tvol") ? "tsemtc" : want0;
  if (want && document.getElementById(want)) showTab(want);
  // aviso automático de novos arquivos
  if (false) setInterval(async () => {  // versão pública: manifesto congelado, sem verificação periódica
    try {
      const m = await fetchManifest();
      if (sigOf(m) !== manifestSig) $("#updateBar").hidden = false;
    } catch { /* ignora */ }
  }, 15000);
  $("#reloadBtn").onclick = () => location.reload();
  window.__viewerReady = true;
}
main();
window.__debug = { get v3() { return v3; }, get vc() { return vc; }, get nv() { return nv; }, get manifest() { return manifest; }, get lm() { return lm; }, showTab, openCompareIn2D };
