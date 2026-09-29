// Mapeamento de nomes de estruturas -> rótulo pt-BR, cor cirúrgica e categoria.
// Fonte única usada pelas visões 3D, 2D e de comparação.
// Convenção de cores: artérias vermelho, veias azul, VCI azul-escuro, trombo roxo,
// tumor LARANJA (amarelo é reservado para "Divergência (revisar)"), rim marrom.

export const CATEGORIES = [
  { id: "leo", label: "Ground truth do Leo" },
  { id: "onco", label: "Tumor e trombo" },
  { id: "vein", label: "Veias" },
  { id: "artery", label: "Artérias" },
  { id: "kidney", label: "Rins e vias urinárias" },
  { id: "ug", label: "Ureteres e gonadais" },
  { id: "adrenal", label: "Adrenais" },
  { id: "organ", label: "Outros órgãos" },
  { id: "bone", label: "Ossos e músculos" },
  { id: "other", label: "Outras estruturas" },
  { id: "review", label: "Correção de Leo" },
  { id: "diverg", label: "Divergência (revisar)" },
];

// Saídas da correção manual-assistida (out/corrected/): nomes exatos, avaliados antes das regras gerais.
export const OVERRIDES = {
  kidney_left_corrected: { key: "kidney_left_corrected", baseKey: "kidney_left_corrected", label: "Rim esquerdo (corrigido por Leo)", color: "#c07a3a", cat: "kidney", op: 0.6 },
  tumor_from_kidney_left: { key: "tumor_seed", baseKey: "tumor_seed", label: "Semente de tumor (corrigido por Leo)", color: "#ff7a00", cat: "onco", op: 1 },
  uncertain_k184: { key: "uncertain_k184", baseKey: "uncertain_k184", label: "Incerto — revisar", color: "#ffe000", cat: "review", op: 0.9 },
  leo_flagged_nonkidney_fragments: { key: "leo_flagged_fragments", baseKey: "leo_flagged_fragments", label: "Fragmentos não-renais apontados por Leo (baço/ilíaca) — revisar", color: "#39d353", cat: "review", op: 0.8 },
};

// GT do Leo (out/leo_gt/): cores da legenda que o Leo usou nas grades (vermelho / verde / amarelo-ouro).
const LEO_STRUCT = {
  tumor: { label: "Tumor", color: "#e53935", op: 1 },
  kidney_left: { label: "Rim esquerdo", color: "#43a047", op: 0.55 },
  collecting_system: { label: "Sistema coletor (pelve + cálices)", color: "#e6b800", op: 0.95 },
};
const LEO_VER = { "": "", interp: " (interp)", refined: " (refinado)", raw_resolved: " (raw, só cortes desenhados)" };
for (const [ver, vlab] of Object.entries(LEO_VER)) {
  for (const [k, d] of Object.entries(LEO_STRUCT)) {
    const key = "leo_" + (ver ? ver + "_" : "") + k;
    OVERRIDES[key] = { key, baseKey: key, label: d.label + " — GT do Leo" + vlab, color: d.color, cat: "leo", op: d.op, leo: true };
  }
}

// Ureteres + veia gonadal esquerda (out/ureter_gonadal/, semi-automático). Rótulos/cores exibidos vêm do manifesto
// (manifest.json → node_info); estes são só o fallback e garantem categoria própria e chaves distintas de "thrombus".
const UG_STRUCT = {
  semiauto_tardia_ureter_right: { baseKey: "ureter_right_semiauto", label: "Ureter direito (semi-automático)", color: "#f2b705", op: 1 },
  estimado_caminho_minimo_ureter_left_trajetoria_estimada: { baseKey: "ureter_left_trajetoria_estimada", label: "Ureter esquerdo — trajetória estimada — incerto", color: "#f2b705", op: 0.35 },
  semiauto_venosa_gonadal_vein_left: { baseKey: "gonadal_vein_left", label: "Veia gonadal esquerda (luz patente)", color: "#3f6fd8", op: 1 },
  semiauto_venosa_gonadal_vein_left_thrombus: { baseKey: "gonadal_vein_left_thrombus", label: "Trombo na veia gonadal esquerda (incerto)", color: "#5b2a86", op: 1 },
  semiauto_venosa_gonadal_vein_left_total: { baseKey: "gonadal_vein_left_total", label: "Veia gonadal esquerda — luz + trombo (total)", color: "#7f9be6", op: 0.8 },
};
for (const [k, d] of Object.entries(UG_STRUCT)) OVERRIDES[k] = { key: d.baseKey, cat: "ug", ...d };

export const DIVERGENCE_COLOR = "#ffd400";
export const DIVERGENCE_OPACITY = 0.4;

// g: gênero gramatical para o lado ("m" -> esquerdo/direito, "f" -> esquerda/direita)
// sided: se o nome deve receber lado. Ordem importa (primeira regra que casar vence).
const RULES = [
  { re: /thromb|trombo/, key: "thrombus", label: "Trombo tumoral (veia renal/VCI)", g: "m", color: "#8e44ad", cat: "onco", op: 1 },
  { re: /cyst|cisto/, key: "kidney_cyst", label: "Cisto renal", g: "m", color: "#d8c3a0", cat: "kidney", op: 0.8, sided: true },
  { re: /tumou?r|mass(a)?($|_)|neoplas|lesion|lesao|cancer|carcinoma|rcc/, key: "tumor", label: "Tumor renal", g: "m", color: "#ff7a00", cat: "onco", op: 1 },
  { re: /superior_vena_cava|(^|_)svc($|_)/, key: "superior_vena_cava", label: "Veia cava superior", g: "f", color: "#1c3fa8", cat: "vein", op: 0.8 },
  { re: /atrial_appendage/, key: "atrial_appendage", label: "Apêndice atrial", g: "m", color: "#a83248", cat: "organ", op: 0.5, sided: true },
  { re: /pulmonary_vein/, key: "pulmonary_vein", label: "Veias pulmonares", g: "f", color: "#5b6fd6", cat: "vein", op: 0.6 },
  { re: /pulmonary_arter|pulmonary_trunk/, key: "pulmonary_artery", label: "Artéria pulmonar", g: "f", color: "#d0405a", cat: "artery", op: 0.6 },
  { re: /inferior_vena_cava|(^|_)ivc($|_)|(^|_)vci($|_)|vena_cava_inf|cava_inf|(^|_)vena_cava($|_)|veia_cava/, key: "inferior_vena_cava", label: "Veia cava inferior (VCI)", g: "f", color: "#0d2a8a", cat: "vein", op: 0.9 },
  { re: /adrenal_vein|suprarenal_vein/, key: "adrenal_vein", label: "Veia adrenal", g: "f", color: "#5b8def", cat: "vein", op: 0.85, sided: true },
  { re: /renal_vein|vein_renal|veia_renal|renal_vena|(^|_)rv($|_)/, key: "renal_vein", label: "Veia renal", g: "f", color: "#2f6fe0", cat: "vein", op: 0.9, sided: true },
  { re: /gonad|testicular_vein|ovarian_vein/, key: "gonadal_vein", label: "Veia gonadal", g: "f", color: "#5b8def", cat: "vein", op: 0.85, sided: true },
  { re: /lumbar_vein/, key: "lumbar_vein", label: "Veia lombar", g: "f", color: "#5b8def", cat: "vein", op: 0.85, sided: true },
  { re: /portal_vein_and_splenic|portal.*splenic/, key: "portal_splenic_vein", label: "Veias porta e esplênica", g: "f", color: "#4f7fd0", cat: "vein", op: 0.8 },
  { re: /portal_vein|veia_porta/, key: "portal_vein", label: "Veia porta", g: "f", color: "#4f7fd0", cat: "vein", op: 0.8 },
  { re: /splenic_vein/, key: "splenic_vein", label: "Veia esplênica", g: "f", color: "#4f7fd0", cat: "vein", op: 0.8 },
  { re: /superior_mesenteric_vein|(^|_)smv($|_)/, key: "smv", label: "Veia mesentérica superior", g: "f", color: "#4f7fd0", cat: "vein", op: 0.8 },
  { re: /hepatic_vein/, key: "hepatic_vein", label: "Veias hepáticas", g: "f", color: "#4f7fd0", cat: "vein", op: 0.8 },
  { re: /iliac_ven|iliac_vein|veia_iliaca/, key: "iliac_vein", label: "Veia ilíaca", g: "f", color: "#3f73d6", cat: "vein", op: 0.85, sided: true },
  { re: /brachiocephalic_vein/, key: "brachiocephalic_vein", label: "Veia braquiocefálica", g: "f", color: "#4f7fd0", cat: "vein", op: 0.8, sided: true },
  { re: /(^|_)veins?($|_)|vena|venous_system|veia/, key: "vein_other", label: "Veias (outras)", g: "f", color: "#4a7ee0", cat: "vein", op: 0.8, sided: true },
  { re: /renal_arter|artery_renal|arteria_renal|(^|_)ra($|_)/, key: "renal_artery", label: "Artéria renal", g: "f", color: "#ff3b3b", cat: "artery", op: 0.95, sided: true },
  { re: /aorta/, key: "aorta", label: "Aorta", g: "f", color: "#c81e1e", cat: "artery", op: 0.9 },
  { re: /iliac_arter|arteria_iliaca/, key: "iliac_artery", label: "Artéria ilíaca", g: "f", color: "#e03232", cat: "artery", op: 0.9, sided: true },
  { re: /celiac/, key: "celiac_trunk", label: "Tronco celíaco", g: "m", color: "#e64545", cat: "artery", op: 0.9 },
  { re: /superior_mesenteric_arter|(^|_)sma($|_)/, key: "sma", label: "Artéria mesentérica superior", g: "f", color: "#e64545", cat: "artery", op: 0.9 },
  { re: /gonadal_arter|adrenal_arter|lumbar_arter/, key: "small_artery", label: "Artéria (ramo)", g: "f", color: "#e64545", cat: "artery", op: 0.9, sided: true },
  { re: /heart|myocard|ventricle|atrium/, key: "heart", label: "Coração", g: "m", color: "#b03040", cat: "organ", op: 0.35 },
  { re: /subclavian|common_carotid|brachiocephalic_trunk/, key: "supra_aortic", label: "Artérias supra-aórticas", g: "f", color: "#e64545", cat: "artery", op: 0.85, sided: true },
  { re: /(^|_)arter(y|ies)($|_)|arteria/, key: "artery_other", label: "Artérias (outras)", g: "f", color: "#e04848", cat: "artery", op: 0.9, sided: true },
  { re: /adrenal|suprarenal/, key: "adrenal_gland", label: "Adrenal", g: "f", color: "#e39ac1", cat: "adrenal", op: 0.85, sided: true },
  { re: /cortex/, key: "renal_cortex", label: "Córtex renal", g: "m", color: "#8b5a2b", cat: "kidney", op: 0.6, sided: true },
  { re: /medulla/, key: "renal_medulla", label: "Medula renal", g: "f", color: "#6e4420", cat: "kidney", op: 0.7, sided: true },
  { re: /pelvi|calyc|collecting|pielocal/, key: "collecting_system", label: "Sistema pielocalicial", g: "m", color: "#63c5da", cat: "kidney", op: 0.85, sided: true },
  { re: /kidney|(^|_)rim($|_)|renal($|_)/, key: "kidney", label: "Rim", g: "m", color: "#8b5a2b", cat: "kidney", op: 0.55, sided: true },
  { re: /ureter/, key: "ureter", label: "Ureter", g: "m", color: "#63c5da", cat: "kidney", op: 0.9, sided: true },
  { re: /gallbladder|vesicula/, key: "gallbladder", label: "Vesícula biliar", g: "f", color: "#3a9d4a", cat: "organ", op: 0.6 },
  { re: /(^|_)(urinary_)?bladder|bexiga/, key: "urinary_bladder", label: "Bexiga", g: "f", color: "#9ad9e6", cat: "kidney", op: 0.5 },
  { re: /liver|figado|hepat/, key: "liver", label: "Fígado", g: "m", color: "#7b3f2e", cat: "organ", op: 0.3 },
  { re: /spleen|baco/, key: "spleen", label: "Baço", g: "m", color: "#7d3c6b", cat: "organ", op: 0.5 },
  { re: /pancrea/, key: "pancreas", label: "Pâncreas", g: "m", color: "#e8b98a", cat: "organ", op: 0.6 },
  { re: /stomach|estomago/, key: "stomach", label: "Estômago", g: "m", color: "#d99a8a", cat: "organ", op: 0.35 },
  { re: /duoden/, key: "duodenum", label: "Duodeno", g: "m", color: "#e0a890", cat: "organ", op: 0.5 },
  { re: /small_bowel|intestin|jejun|ileum/, key: "small_bowel", label: "Intestino delgado", g: "m", color: "#e6b0a0", cat: "organ", op: 0.3 },
  { re: /colon/, key: "colon", label: "Cólon", g: "m", color: "#c9907a", cat: "organ", op: 0.3 },
  { re: /esophag/, key: "esophagus", label: "Esôfago", g: "m", color: "#d99a8a", cat: "organ", op: 0.5 },
  { re: /lung|pulmao/, key: "lung", label: "Pulmão", g: "m", color: "#f2c9c9", cat: "organ", op: 0.2, sided: true },
  { re: /vertebra/, key: "vertebra", label: "Vértebra", g: "f", color: "#e8e2cf", cat: "bone", op: 0.6 },
  { re: /rib|costela/, key: "rib", label: "Costela", g: "f", color: "#e8e2cf", cat: "bone", op: 0.5, sided: true },
  { re: /sacrum|sacro/, key: "sacrum", label: "Sacro", g: "m", color: "#e8e2cf", cat: "bone", op: 0.55 },
  { re: /hip|pelvis_bone|os_coxae/, key: "hip", label: "Osso do quadril", g: "m", color: "#e8e2cf", cat: "bone", op: 0.5, sided: true },
  { re: /femur/, key: "femur", label: "Fêmur", g: "m", color: "#e8e2cf", cat: "bone", op: 0.5, sided: true },
  { re: /bone|osso/, key: "bone", label: "Osso", g: "m", color: "#e8e2cf", cat: "bone", op: 0.5, sided: true },
  { re: /iliopsoas/, key: "iliopsoas", label: "Músculo iliopsoas", g: "m", color: "#b5655e", cat: "bone", op: 0.4, sided: true },
  { re: /psoas/, key: "psoas", label: "Músculo psoas", g: "m", color: "#b5655e", cat: "bone", op: 0.4, sided: true },
  { re: /muscle|gluteus|autochthon/, key: "muscle", label: "Músculo", g: "m", color: "#b5655e", cat: "bone", op: 0.35, sided: true },
];

const MODEL_TOKENS = /^(teste|test|sintetico|synthetic|ts|totalseg(mentator)?|vista3d|vista|monai|cect|unest|renalstructures|staple|fused|consensus|consenso|mesh|node|geometry|model|glb|seg|mask)_+/;
const LEFT = /(^|_)(left|lt|l|esq|esquerd[oa]|sinistr[oa])(_|$)/;
const RIGHT = /(^|_)(right|rt|r|dir|direit[oa]|dextr[oa])(_|$)/;
const DIVERG = /disagree|diverg|discord|uncertain/;

export function normalizeName(raw) {
  let s = String(raw || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\.nii(\.gz)?$|\.glb$|\.stl$|\.obj$/, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  for (let i = 0; i < 4; i++) s = s.replace(MODEL_TOKENS, "");
  return s;
}

export function isDivergenceName(raw) {
  return DIVERG.test(normalizeName(raw)) || DIVERG.test(String(raw || "").toLowerCase());
}

function sideOf(n) {
  if (LEFT.test(n)) return "left";
  if (RIGHT.test(n)) return "right";
  return null;
}

function sideLabel(side, g) {
  if (!side) return "";
  if (side === "left") return g === "f" ? " esquerda" : " esquerdo";
  return g === "f" ? " direita" : " direito";
}

// Retorna { key, label, color, cat, op, divergence, known }
export function describe(raw) {
  const n0 = normalizeName(raw);
  const ov = OVERRIDES[n0] || OVERRIDES[String(raw || "").toLowerCase()];
  if (ov) return { ...ov, known: true, override: true };
  const divergence = DIVERG.test(n0);
  const n = n0.replace(/(^|_)(disagreement|disagree|divergencia|divergence|diverg|discordancia|discord|uncertainty|uncertain)(_|$)/g, "_").replace(/^_+|_+$/g, "");
  let base = null;
  for (const r of RULES) {
    if (r.re.test(n)) { base = r; break; }
  }
  const side = sideOf(n);
  let out;
  if (base) {
    let label = base.label;
    // vértebras: preservar nível (ex.: vertebrae_L1 -> Vértebra L1)
    if (base.key === "vertebra") {
      const m = n.match(/vertebra[e]?_([a-z]\d+)/);
      if (m) label += " " + m[1].toUpperCase();
    }
    if (base.key === "lung") {
      const lobe = n.match(/(upper|middle|lower)_lobe/);
      if (lobe) label += ", lobo " + { upper: "superior", middle: "médio", lower: "inferior" }[lobe[1]];
    }
    if (base.key === "rib") {
      const m = n.match(/rib_(?:left|right)_(\d+)|rib_(\d+)/);
      if (m) label += " " + (m[1] || m[2]);
    }
    const s = base.sided ? side : null;
    out = {
      key: base.key + (s ? "_" + s : "") + (base.key === "vertebra" || base.key === "rib" || base.key === "lung" ? "_" + n : ""),
      label: base.key === "lung" && s ? label.replace("Pulmão", "Pulmão" + sideLabel(s, base.g)) : label + sideLabel(s, base.g),
      color: base.color, cat: base.cat, op: base.op, known: true,
    };
  } else {
    out = { key: n || "desconhecido", label: String(raw || "sem nome"), color: null, cat: "other", op: 0.8, known: false };
  }
  if (divergence) {
    return {
      ...out,
      key: "diverg_" + out.key,
      baseKey: out.key,
      label: "Divergência — " + (out.known ? out.label : String(raw)),
      color: DIVERGENCE_COLOR, cat: "diverg", op: DIVERGENCE_OPACITY, divergence: true,
    };
  }
  return { ...out, baseKey: out.key, divergence: false };
}

// Cores por modelo (modo comparação). Amarelo e laranja evitados.
export const MODEL_COLORS = {
  "TotalSegmentator": "#00c8ff",
  "MONAI VISTA3D": "#ff4fd8",
  "renalStructures_CECT": "#4be34b",
  "renalStructures_UNEST": "#b388ff",
  "Consenso (STAPLE)": "#f2f2f2",
  "Divergência entre modelos": DIVERGENCE_COLOR,
};
const EXTRA_MODEL_COLORS = ["#7fffd4", "#ff8fa3", "#9fd3ff", "#c0ff7f", "#d6a4ff"];
export function modelColor(model) {
  if (MODEL_COLORS[model]) return MODEL_COLORS[model];
  let h = 0;
  for (const c of String(model)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return EXTRA_MODEL_COLORS[h % EXTRA_MODEL_COLORS.length];
}

export function modelFromName(raw, fallback) {
  const s = String(raw || "").toLowerCase();
  if (/^leo_|leo_gt/.test(s)) return "GT do Leo";
  if (/^cirurgiao/.test(s)) return "Cirurgião (GT do Leo, via fusão GT)";
  if (/^semiauto_|^estimado_caminho/.test(s)) return "Ureteres e gonadais (semi-automático)";
  if (/staple|consens|fused|fusao/.test(s)) return "Consenso (STAPLE)";
  if (/vista/.test(s)) return "MONAI VISTA3D";
  if (/unest/.test(s)) return "renalStructures_UNEST";
  if (/cect/.test(s)) return "renalStructures_CECT";
  if (/totalseg|(^|[_\W])ts[_\W]/.test(s)) return "TotalSegmentator";
  return fallback;
}

export function hexToRgb(hex) {
  const h = String(hex).replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// ---------------------------------------------------------------- mapas de rótulos ROI (2D e Volume 3D)
// Nomes/cores por conjunto. Em "leo" e "fused_gt", os ids do GT do Leo (1 rim, 20 tumor, 18 sistema coletor)
// usam a legenda do Leo (mesmas cores das camadas leo__* do 3D). Novos ids da fusão GT: 19, 24, 25.
export const LABELMAP_EXTRA = {
  fused_gt: {
    18: { label: "Sistema coletor esquerdo (pelve + cálices) — GT do Leo" },
    19: { label: "Sistema coletor direito (modelo UNesT; não desenhado pelo Leo)", color: "#63c5da" },
    24: { label: "Cólon", color: "#c49a5c" },
    25: { label: "Intestino delgado (TotalSegmentator; falso intestino dentro da massa removido)", color: "#d6aa78" },
    // 26: cor lida da tabela do arquivo (volume_meta_fused_gt.json → rgba), não digitada aqui
    26: { label: "Músculo iliopsoas esquerdo (TotalSegmentator; sobreposição com o tumor do Leo subtraída)", tableColor: true },
  },
};
export function labelmapEntry(set, r) {
  const sid = set && set.id;
  const leoIds = Object.fromEntries(Object.entries((set && set.leo_ids) || { kidney_left: 1, tumor: 20 }).map(([k, v]) => [v, k]));
  const nm = sid === "corrected" && r.id === 20 ? "tumor_from_kidney_left" : sid === "corrected" && r.name === "kidney_left" ? "kidney_left_corrected"
    : (sid === "leo" || sid === "fused_gt") && leoIds[r.id] ? "leo__" + leoIds[r.id] : r.name;
  const di = describe(nm);
  const ex = (LABELMAP_EXTRA[sid] || {})[r.id] || {};
  const rgbHex = r.rgba ? "#" + r.rgba.slice(0, 3).map((x) => Number(x).toString(16).padStart(2, "0")).join("") : null;
  const color = ex.color || (ex.tableColor && rgbHex) || (sid === "fused" && r.id === 20 ? "#c2185b" : di.known ? di.color : (rgbHex || "#cccccc"));
  return { nm, di, label: ex.label || (di.known ? di.label : r.name), color, known: di.known || !!ex.label };
}
