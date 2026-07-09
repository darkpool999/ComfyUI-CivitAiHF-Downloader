import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
    else if (k === "class") node.className = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (typeof v === "boolean") { if (v) node.setAttribute(k, ""); else node.removeAttribute(k); }
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    if (typeof c === "string" || typeof c === "number") node.appendChild(document.createTextNode(c));
    else if (c instanceof Node) node.appendChild(c);
    else if (Array.isArray(c)) c.flat().forEach(x => { if (x instanceof Node) node.appendChild(x); });
  }
  return node;
}

const CIVITAI_TYPES = [
  "", "Checkpoint", "LORA", "LoCon", "DoRA", "TextualInversion",
  "Hypernetwork", "AestheticGradient", "Controlnet", "VAE",
  "Upscaler", "MotionModule", "Poses", "Wildcards", "Workflows", "Other",
];
const CIVITAI_SORTS = [
  "Highest Rated", "Most Downloaded", "Most Liked", "Most Discussed",
  "Most Collected", "Most Images", "Newest", "Oldest", "Relevancy",
];
const CIVITAI_PERIODS = ["AllTime", "Year", "Month", "Week", "Day"];
const CIVITAI_BASE_MODELS = [
  "", "SD 1.4", "SD 1.5", "SD 1.5 LCM", "SD 1.5 Hyper",
  "SD 2.0", "SD 2.0 768", "SD 2.1", "SD 2.1 768", "SD 2.1 Unclip",
  "SDXL 0.9", "SDXL 1.0", "SDXL 1.0 LCM", "SDXL Distilled", "SDXL Lightning",
  "Pony", "Illustrious", "NoobAI",
  "Stable Cascade",
  "Flux.1 D", "Flux.1 S", "Flux.1 Kontext", "Flux.1 Krea",
  "Z-Image", "ZImageBase", "ZImageTurbo",
  "Qwen", "Qwen 2",
  "Hunyuan 1", "Hunyuan Video",
  "Wan Video", "Wan Video 1.3B t2v", "Wan Video 14B t2v", "Wan Video 14B i2v 480p",
  "LTXV", "LTXV 2.3", "CogVideoX", "Mochi", "SVD XT",
  "AuraFlow", "Chroma", "HiDream", "Kolors", "Lumina",
  "PixArt a", "PixArt E", "Playground v2", "ODOR", "Other",
];
const HF_PIPELINES = [
  "", "text-to-image", "image-to-image", "image-to-video",
  "text-to-video", "video-to-video", "image-to-3d", "text-to-3d",
  "depth-estimation", "image-segmentation",
  "automatic-speech-recognition", "text-to-speech",
  "text-generation", "feature-extraction", "sentence-similarity",
];
const HF_LIBRARIES = ["", "diffusers", "transformers", "gguf", "onnx",
                      "sentence-transformers", "peft", "safetensors"];
const HF_SORTS = ["downloads", "likes", "trending_score", "createdAt", "lastModified"];
const NSFW_RATINGS = [
  { label: "PG", value: "" },
  { label: "PG13", value: "Soft" },
  { label: "R", value: "Mature" },
  { label: "X", value: "X" },
  { label: "XXX", value: "XXX" },
];

function _buildRatingCheckboxes(selectedStr, onChange) {
  var selected = selectedStr ? selectedStr.split(",").filter(Boolean) : [];
  var cbs = {};
  var row = el("div", { style: { display: "flex", gap: "4px", alignItems: "center", flexWrap: "wrap" } });
  NSFW_RATINGS.forEach(function(r) {
    var cb = el("input", { type: "checkbox", value: r.value });
    var checked = r.value ? selected.indexOf(r.value) >= 0 : selected.length === 0;
    cb.checked = checked;
    cb.onchange = onChange;
    cbs[r.label] = cb;
    row.appendChild(el("label", { style: { display: "inline-flex", alignItems: "center", gap: "2px", cursor: "pointer", fontSize: "11px", whiteSpace: "nowrap", color: "var(--civ-text-dim)" } }, cb, " ", r.label));
  });
  row._cbs = cbs;
  row._getVal = function() {
    var vals = [];
    NSFW_RATINGS.forEach(function(r) {
      if (r.value && cbs[r.label].checked) vals.push(r.value);
    });
    return vals.join(",");
  };
  return row;
}

// ── NSFW level matching (shared by model + gallery filters) ──────
//   item.nsfwLevel: 0/None(PG), 1/Soft(PG13), 2/Mature(R), 3/X, 4/XXX (or 5)
//   item.nsfw: boolean fallback
//   flags: { hasPG13, hasR, hasX, hasXXX, anyNsfw }
function _matchNsfw(item, flags) {
  // Quick boolean check — item has nsfw:true and user wants any NSFW level
  if (item.nsfw) { return flags.hasPG13 || flags.hasR || flags.hasX || flags.hasXXX; }
  // Also check alternate keys
  var lvl = item.nsfwLevel;
  if (lvl == null) { lvl = item.rating; }
  if (lvl == null || lvl === "" || lvl === "null" || lvl === "undefined") {
    // No level info — keep only if no explicit nsfw:false
    return item.nsfw !== false;
  }
  // Try numeric first
  var n = Number(lvl);
  if (!isNaN(n)) {
    // Normalise 0-5 range
    if (n <= 0 || n === 0) { return false; }
    if (n <= 1) { return flags.hasPG13; }
    if (n <= 2) { return flags.hasR; }
    // 3,4,5+ → X / XXX
    return flags.hasX || flags.hasXXX;
  }
  // String matching — normalise to lower case
  var s = String(lvl).toLowerCase().trim();
  // PG / None / 0
  if (s === "none" || s === "pg" || s === "g" || s === "everyone") { return false; }
  // PG13 / Soft
  if (s === "soft" || s === "pg13" || s === "pg-13" || s === "teen") { return flags.hasPG13; }
  // R / Mature
  if (s === "mature" || s === "r" || s === "r15" || s === "adult") { return flags.hasR; }
  // X / XXX / R18 / explicit
  if (s === "x" || s === "xxx" || s === "r18" || s === "r-18" || s === "r18+" || s === "explicit" || s === "nsfw") {
    return flags.hasX || flags.hasXXX;
  }
  // Unknown string — keep it
  return true;
}

// Extract active NSFW flags from the stored nsfw string (e.g. "Soft,Mature")
function _nsfwFlags(val) {
  if (!val) { return { hasPG13: false, hasR: false, hasX: false, hasXXX: false }; }
  return {
    hasPG13: val.indexOf("Soft") >= 0,
    hasR: val.indexOf("Mature") >= 0,
    hasX: val.indexOf("X") >= 0,
    hasXXX: val.indexOf("XXX") >= 0,
  };
}

// ── TTL Cache ─────────────────────────────────────────────────────
var _cache = new (function() {
  this._map = new Map(); this._inflight = new Map(); this._max = 80; this._ttl = 60000;
  this.get = function(k) { var e = this._map.get(k); if (!e) return null; if (e.exp < Date.now()) { this._map.delete(k); return null; } this._map.delete(k); this._map.set(k, e); return e.v; };
  this.set = function(k, v) { this._map.set(k, { v: v, exp: Date.now() + this._ttl }); if (this._map.size > this._max) { var ok = this._map.keys().next().value; this._map.delete(ok); } };
  this.clear = function() { this._map.clear(); this._inflight.clear(); };
})();

var _activeJobs = 0;
var _jobsTimer = null;
var _hintTimer = null;
var _localPromptCache = {};

var S = {
  curTab: "civitai", civitai: { items: [], query: "", type: "", sort: "Highest Rated", nsfw: "", period: "AllTime", baseModel: "", loading: false,
    cursor: "", cursorStack: [], nextCursor: null, limit: 24 },
  hf: { items: [], query: "", sort: "lastModified", pipeline_tag: "", library: "", author: "" },
  downloads: [], local: { models: [], filter: "" },
  settings: { baseUrl: "civitai.com", saveMeta: true, savePrev: true, nsfwBlur: true },
  modal: null, lightbox: null,
  root: null,
};

function _api(path, opts) {
  var method = (opts && opts.method || "GET").toUpperCase();
  var cacheKey = method === "GET" ? path : null;
  if (cacheKey) {
    var cached = _cache.get(cacheKey);
    if (cached) return Promise.resolve(cached);
    var pending = _cache._inflight.get(cacheKey);
    if (pending) return pending;
  }
  var p = api.fetchApi(path, opts || {}).then(function(r) {
    if (!r.ok) {
      var err = new Error("HTTP " + r.status);
      err.status = r.status;
      err.transient = [408, 425, 429, 500, 502, 503, 504].indexOf(r.status) >= 0;
      throw err;
    }
    return r.json().catch(function() { return {}; });
  }).then(function(json) {
    if (cacheKey) { var items = json && json.items; if (!items || items.length > 0) _cache.set(cacheKey, json); }
    return json;
  });
  if (cacheKey) { _cache._inflight.set(cacheKey, p); p.then(function() { _cache._inflight.delete(cacheKey); }, function() { _cache._inflight.delete(cacheKey); }); }
  return p;
}
function _fmtBytes(n) { if (!n) return "\u2014"; const u = ["B","KB","MB","GB","TB"]; let i = 0; let s = n; while (s >= 1024 && i < 4) { s /= 1024; i++; } return s.toFixed(i > 1 ? 1 : 0) + " " + u[i]; }
function _fmtNum(n) { if (n == null) return "?"; if (n < 1e3) return String(n); if (n < 1e6) return (n/1e3).toFixed(n<1e4?1:0)+"K"; if (n < 1e9) return (n/1e6).toFixed(n<1e7?1:0)+"M"; return (n/1e9).toFixed(1)+"B"; }
function _thumbUrl(url, w) {
  if (!url) return url;
  w = w || 450;
  // Civitai CDN uses path-based width: /width=NNN/ or /...,width=NNN/ -> /width=WWW/
  if (url.indexOf("image.civitai.com") >= 0) {
    return url.replace(/(\/|\b)width=\d+(\/|,)/, "$1width=" + w + "$2");
  }
  var sep = url.indexOf("?") >= 0 ? "&" : "?";
  return url + sep + "width=" + w;
}

function _flashHint(sb, text) {
  if (_hintTimer) clearTimeout(_hintTimer);
  var h = sb.querySelector(".cvt-flash");
  if (!h) { h = el("div", { class: "cvt-flash" }); sb.appendChild(h); }
  h.textContent = text;
  _hintTimer = setTimeout(function() { h.textContent = ""; }, 4000);
}

function _renderSkeletons(grid, n) {
  n = n || 12;
  grid.innerHTML = "";
  for (var i = 0; i < n; i++) grid.appendChild(el("div", { class: "cvt-skel" }));
}

function _toast(msg, type) {
  let wrap = document.querySelector(".cvt-toast-wrap");
  if (!wrap) { wrap = el("div", { class: "cvt-toast-wrap" }); document.body.appendChild(wrap); }
  const t = el("div", { class: "cvt-toast " + (type || "ok") }, msg);
  wrap.appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; setTimeout(() => t.remove(), 300); }, 3000);
}

(function injectCSS() {
  if (document.getElementById("cvt-css")) return;
  const link = document.createElement("link");
  link.id = "cvt-css"; link.rel = "stylesheet";
  try { link.href = new URL("civitai.css", import.meta.url).href; }
  catch (e) { link.href = "civitai.css"; }
  document.head.appendChild(link);
})();



const TABS = [
  ["civitai", "Civitai", "\uD83C\uDDE8", "emoji-float"],
  ["hf", "HF", "\uD83E\uDD17", "emoji-bounce"],
  ["downloads", "Downloads", "\u2B07", "emoji-pulse"],
  ["local", "Local", "\uD83D\uDCC1", "emoji-wiggle"],
  ["settings", "Settings", "\u2699\uFE0F", "emoji-spin"],
];

function buildUI() {
  var root = el("div", { class: "cvt-root" });
  S.root = root;

  // Custom tab switching events
  root.addEventListener("civitai:show-tab", function(e) {
    var which = e.detail;
    var tab = tabBar.querySelector('[data-tab="' + which + '"]');
    if (tab) tab.click();
  });

  var tabBar = el("div", { class: "cvt-tabs" });
  var panes = {};
  TABS.forEach(function(t) {
    var id = t[0], label = t[1], icon = t[2], anim = t[3];
    var emojiSpan = el("span", { class: "tab-emoji" }, icon);
    var btn = el("button", { class: "cvt-tab" + (id === "civitai" ? " active" : ""), dataset: { tab: id } },
      emojiSpan, " ", label);
    // Only the active tab animates (UX guideline: avoid excessive motion)
    if (id === "civitai") emojiSpan.classList.add(anim);
    btn._anim = anim; btn._emoji = emojiSpan;
    btn.onclick = function() { _switchTab(id, tabBar, panes); };
    tabBar.appendChild(btn);
    var pane = el("div", { class: "cvt-pane" + (id === "civitai" ? " active" : ""), id: "cvt-pane-" + id });
    panes[id] = pane;
    root.appendChild(pane);
  });
  root.insertBefore(tabBar, root.firstChild);
  renderBrowse(panes.civitai); panes.civitai._rendered = true;
  // Theme toggle button
  var themeBtn = el("button", { class: "cvt-theme-toggle", title: "Toggle light/dark theme" }, "\u2600\uFE0F");
  themeBtn.onclick = function() {
    root.classList.toggle("light");
    var isLight = root.classList.contains("light");
    themeBtn.textContent = isLight ? "\uD83C\uDF19" : "\u2600\uFE0F";
    _api("/civitai/settings", { method:"POST", body:JSON.stringify({ theme: isLight ? "light" : "dark" }) }).catch(function(){});
  };
  root.appendChild(themeBtn);

  // Keyboard shortcuts
  root.setAttribute("tabindex", "0");
  root.addEventListener("keydown", function(e) {
    var tag = (e.target.tagName || "").toLowerCase();
    var isInput = tag === "input" || tag === "textarea" || tag === "select";
    // "/" to focus search (always)
    if (e.key === "/" && !isInput) {
      e.preventDefault();
      var activePane = root.querySelector(".cvt-pane.active");
      if (activePane) { var search = activePane.querySelector("input[type='text']"); if (search) search.focus(); }
      return;
    }
    // "?" to show shortcuts help
    if (e.key === "?" && !isInput) { e.preventDefault(); _showKBHelp(); return; }
    // Number keys 1-5 for tabs
    if (!isInput && e.key >= "1" && e.key <= "5") {
      var idx = parseInt(e.key, 10) - 1;
      var tabs = tabBar.querySelectorAll(".cvt-tab");
      if (tabs[idx]) { e.preventDefault(); tabs[idx].click(); }
      return;
    }
    // "c" for compact toggle
    if (e.key === "c" && !isInput && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      root.classList.toggle("compact");
      var isCompact = root.classList.contains("compact");
      _api("/civitai/settings", { method:"POST", body:JSON.stringify({ compact_grid: isCompact }) }).catch(function(){});
      _toast(isCompact ? "Compact grid on" : "Normal grid", "ok");
      return;
    }
  });

  // Card keyboard navigation (delegate)
  root.addEventListener("keydown", function(e) {
    var card = e.target.closest ? e.target.closest(".cvt-card") : null;
    if (!card) return;
    var grid = card.parentElement;
    if (!grid || !grid.classList.contains("cvt-grid")) return;
    var cards = Array.from(grid.querySelectorAll(".cvt-card"));
    var idx = cards.indexOf(card);
    var cols = Math.round(grid.offsetWidth / (card.offsetWidth + 10));
    var next = -1;
    if (e.key === "ArrowRight") next = idx + 1;
    else if (e.key === "ArrowLeft") next = idx - 1;
    else if (e.key === "ArrowDown") next = idx + cols;
    else if (e.key === "ArrowUp") next = idx - cols;
    else if (e.key === "Enter") { e.preventDefault(); card.click(); return; }
    if (next >= 0 && next < cards.length) {
      e.preventDefault();
      cards[next].focus();
    }
  });

  // Make cards focusable (observe grid for new cards)
  var _cardObserver = new MutationObserver(function(muts) {
    muts.forEach(function(m) {
      m.addedNodes.forEach(function(n) {
        if (n.nodeType === 1 && n.classList && n.classList.contains("cvt-card")) {
          n.setAttribute("tabindex", "0");
        }
      });
    });
  });
  root.addEventListener("DOMNodeInserted", function(e) {
    if (e.target.classList && e.target.classList.contains("cvt-card")) {
      e.target.setAttribute("tabindex", "0");
    }
  }, true);

  // Keyboard shortcuts help overlay
  function _showKBHelp() {
    var overlay = el("div", { class: "cvt-kb-overlay" });
    var panel = el("div", { class: "cvt-kb-panel" });
    panel.appendChild(el("h3", {}, "\u2328\uFE0F Keyboard Shortcuts"));
    var shortcuts = [
      [["/"], "Focus search bar"],
      [["\u2190","\u2191","\u2192","\u2193"], "Navigate cards"],
      [["Enter"], "Open model detail"],
      [["Esc"], "Close modal / lightbox"],
      [["1","2","3","4","5"], "Switch tabs"],
      [["Ctrl","C"], "Toggle compact grid"],
      [["?"], "Show this help"],
    ];
    shortcuts.forEach(function(s) {
      var row = el("div", { class: "cvt-kb-row" });
      var keys = el("div", { class: "cvt-kb-keys" });
      s[0].forEach(function(k) { keys.appendChild(el("span", { class: "cvt-kb-key" }, k)); });
      row.appendChild(keys);
      row.appendChild(el("span", { class: "cvt-kb-desc" }, s[1]));
      panel.appendChild(row);
    });
    panel.appendChild(el("div", { style: { marginTop:"12px", fontSize:"10px", color:"var(--civ-text-mute)", textAlign:"center" } }, "Click anywhere or press Esc to close"));
    overlay.appendChild(panel);
    overlay.onclick = function() { overlay.remove(); };
    document.body.appendChild(overlay);
  }

  // Load saved theme
  _api("/civitai/settings").then(function(cfg) {
    if (cfg.theme === "light") {
      root.classList.add("light");
      themeBtn.textContent = "\uD83C\uDF19";
    }
    if (cfg.compact_grid) root.classList.add("compact");
  }).catch(function(){});

  return root;
}

function _switchTab(id, tabBar, panes) {
  S.curTab = id;
  tabBar.querySelectorAll(".cvt-tab").forEach(function(b) {
    var isActive = b.dataset.tab === id;
    b.classList.toggle("active", isActive);
    var anim = b._anim;
    if (b._emoji && anim) {
      b._emoji.classList.toggle(anim, isActive);
    }
  });
  Object.keys(panes).forEach(function(k) { panes[k].classList.toggle("active", k === id); });
  var pane = panes[id];
  if (!pane) return;
  if (!pane._rendered) {
    pane._rendered = true;
    if (id === "civitai") renderBrowse(pane);
    else if (id === "hf") renderHF(pane);
    else if (id === "downloads") renderDownloads(pane);
    else if (id === "local") renderLocal(pane);
    else if (id === "settings") renderSettings(pane);
  }
}

function closeLightbox() { if (S._closeLB) { S._closeLB(); S._closeLB = null; } else if (S.lightbox) { S.lightbox.remove(); S.lightbox = null; } }
function closeModal() { if (S.modal) { S.modal.remove(); S.modal = null; } }
document.addEventListener("keydown", function(e) { if (e.key === "Escape") { closeModal(); closeLightbox(); } });

// ── 1. BROWSE ────────────────────────────────────────────────────────
function renderBrowse(pane) {
  var sb = el("div", { class: "cvt-searchbar" });

  // ---- Manual entry row (lookup by ID / URL / hash) ----
  var lookupIn = el("input", { type: "text", placeholder: "URL / ID / SHA256 / AIR\u2026", style: { flex:"1", fontFamily:"monospace", fontSize:"11px", background:"#1c1410", borderColor:"#5a3a2a" } });
  var lookupBtn = el("button", { class: "cvt-btn", style: { flex:"0 0 auto" } }, "\uD83C\uDFAF");
  var lookupRow = el("div", { class: "cvt-row", style: { marginBottom:"6px" } });
  lookupRow.appendChild(lookupIn); lookupRow.appendChild(lookupBtn);
  sb.appendChild(lookupRow);

  lookupBtn.onclick = function() { _lookupCivitai(lookupIn.value, lookupIn); };
  lookupIn.onkeydown = function(e) { if (e.key === "Enter") lookupBtn.click(); };

  // ---- Search row 1 ----
  var row1 = el("div", { class: "cvt-row" });
  var qIn = el("input", { type: "text", placeholder: "Search Civitai\u2026", id: "cvt-q", style: { flex:1 } });
  var sortSel = el("select", { id: "cvt-sort", class: "cvt-select-sm", title: "Sort by" });
  CIVITAI_SORTS.forEach(function(s) { sortSel.appendChild(el("option", { value: s }, s)); });
  row1.appendChild(qIn); row1.appendChild(sortSel); sb.appendChild(row1);

  // ---- Search row 2 (free-typeable datalist) ----
  var row2 = el("div", { class: "cvt-row", style: { flexWrap:"wrap", gap:"4px", alignItems:"center" } });
  var typeSel = el("select", { id: "cvt-type", class: "cvt-select-sm", title: "Type" });
  CIVITAI_TYPES.forEach(function(t) { typeSel.appendChild(el("option", { value: t }, t || "All types")); });
  var periodSel = el("select", { id: "cvt-period", class: "cvt-select-sm", title: "Period" });
  CIVITAI_PERIODS.forEach(function(p) { periodSel.appendChild(el("option", { value: p }, p)); });
  var baseListId = "cvt-base-list-" + Math.random().toString(36).slice(2, 8);
  var baseIn = el("input", { type: "text", list: baseListId, placeholder: "Base model\u2026", autocomplete: "off", style: { flex:"0 0 auto", maxWidth:"120px" } });
  var baseDl = el("datalist", { id: baseListId });
  CIVITAI_BASE_MODELS.forEach(function(b) { if (b) baseDl.appendChild(el("option", { value: b })); });
  baseIn.onkeydown = function(e) { if (e.key === "Enter") { _resetAndSearch(); } };
  var goBtn = el("button", { class: "cvt-btn", style: { flex:"0 0 auto" } }, el("span", { class: "emoji-btn emoji-float" }, "\uD83D\uDD0D"), " Search");
  row2.appendChild(typeSel); row2.appendChild(periodSel); row2.appendChild(baseIn); row2.appendChild(goBtn);
  sb.appendChild(row2);
  sb.appendChild(baseDl);
  // ---- NSFW rating row below ----
  var ratingRow = _buildRatingCheckboxes(S.civitai.nsfw || "", function() { S.civitai.nsfw = ratingRow._getVal(); _resetAndSearch(); });
  sb.appendChild(el("div", { class: "cvt-row", style: { marginTop:"4px" } }, ratingRow));
  pane.appendChild(sb);

  var grid = el("div", { class: "cvt-grid", id: "cvt-grid" });
  var empty = el("div", { class: "cvt-empty" }, "\u2728  Type a query and hit Search, or just press Search for the top models.");
  pane.appendChild(grid);
  pane.appendChild(empty);
  var pager = el("div", { class: "cvt-pager" });
  var prevBtn = el("button", { class: "cvt-btn ghost", disabled: true }, "\u2190 Prev");
  var pageInfo = el("span", { class: "page-info" }, "Page 1");
  var nextBtn = el("button", { class: "cvt-btn ghost" }, "Next \u2192");
  pager.appendChild(prevBtn); pager.appendChild(pageInfo); pager.appendChild(nextBtn);
  pane.appendChild(pager);

  function _resetAndSearch() {
    S.civitai.cursor = "";
    S.civitai.cursorStack = [];
    S.civitai.nextCursor = null;
    _cache.clear();
    _runSearch();
  }

  function _lastParams() {
    var params = new URLSearchParams({
      sort: S.civitai.sort, period: S.civitai.period,
      types: S.civitai.type, limit: String(S.civitai.limit),
    });
    if (S.civitai.nsfw) params.set("nsfw", "true");
    if (S.civitai.query) params.set("query", S.civitai.query);
    if (S.civitai.cursor) params.set("cursor", S.civitai.cursor);
    if (S.civitai.baseModel) params.set("baseModels", S.civitai.baseModel);
    return params;
  }

  function _runSearch(attempt) {
    attempt = attempt || 1;
    if (S.civitai.loading) return;
    S.civitai.loading = true;
    _renderSkeletons(grid, S.civitai.limit);
    empty.style.display = "none";
    S.civitai.query = qIn.value;
    S.civitai.sort = sortSel.value;
    S.civitai.nsfw = ratingRow._getVal();
    S.civitai.type = typeSel.value;
    S.civitai.period = periodSel.value;
    S.civitai.baseModel = (baseIn.value || "").trim();
    if (S.civitai.sort === "Relevancy" && !S.civitai.query) {
      S.civitai.sort = "Highest Rated"; sortSel.value = "Highest Rated";
      _flashHint(sb, "\u26A0\uFE0F Relevancy requires a search query \u2014 switched to Highest Rated.");
    }
    var params = _lastParams();
    _api("/civitai/search?" + params.toString()).then(function(d) {
      S.civitai.items = d.items || [];
      // Client-side NSFW rating filter
      var flags = _nsfwFlags(S.civitai.nsfw);
      if (flags.hasPG13 || flags.hasR || flags.hasX || flags.hasXXX) {
        S.civitai.items = S.civitai.items.filter(function(m) { return _matchNsfw(m, flags); });
      }
      grid.innerHTML = "";
      if (!S.civitai.items.length) {
        empty.style.display = "block";
        empty.innerHTML = "\uD83D\uDD0E  No models match. Try a different query.";
        pager.innerHTML = "";
        return;
      }
      var frag = document.createDocumentFragment();
      S.civitai.items.forEach(function(m) { frag.appendChild(_card(m)); });
      grid.appendChild(frag);

      S.civitai.nextCursor = d && d.metadata && d.metadata.nextCursor ? d.metadata.nextCursor : null;
      var pageNum = S.civitai.cursorStack.length + 1;
      pageInfo.textContent = "Page " + pageNum;
      prevBtn.disabled = !S.civitai.cursorStack.length;
      nextBtn.disabled = !S.civitai.nextCursor;
    }).catch(function(e) {
      _showSearchError(e, attempt, sb, grid, empty, pager);
    }).then(function() { S.civitai.loading = false; });
  }

  function _showSearchError(e, attempt, sb, grid, empty, pager) {
    grid.innerHTML = "";
    pager.innerHTML = "";
    var isTransient = !!e.transient;
    var code = e.status || 0;
    var heading = isTransient
      ? (code === 429 ? "You\u2019re being rate-limited" : "Civitai is busy right now")
      : (code === 401 ? "Unauthorized" : code === 404 ? "Not found" : "Search failed");

    var box = el("div", { style: { background:"linear-gradient(135deg,rgba(244,114,182,.08),rgba(96,165,250,.08))", border:"1px solid var(--civ-line-strong)", borderRadius:"var(--civ-radius)", padding:"14px 16px", color:"var(--civ-text)" } });
    box.appendChild(el("div", { style: { fontWeight:700, marginBottom:"6px", background:"var(--civ-grad-primary)", WebkitBackgroundClip:"text", backgroundClip:"text", color:"transparent" } }, heading));
    if (e.message) box.appendChild(el("div", { style: { fontSize:"12px", marginBottom:"10px", color:"var(--civ-text-dim)" } }, e.message));

    var retryBtn = el("button", { class: "cvt-btn" }, "\u21BB Retry now");
    retryBtn.onclick = function() { _runSearch(1); };
    box.appendChild(retryBtn);

    if (isTransient && attempt <= 5) {
      var baseDelay = Math.min(30, 3 * Math.pow(2, attempt - 1));
      var remaining = baseDelay;
      var note = el("span", { style: { marginLeft:"10px", fontSize:"11px", color:"#bba" } }, "Auto-retry in " + remaining + "s");
      box.appendChild(note);
      var retryTimer = setInterval(function() {
        remaining -= 1;
        if (remaining <= 0) {
          clearInterval(retryTimer);
          _runSearch(attempt + 1);
        } else {
          note.textContent = "Auto-retry in " + remaining + "s";
        }
      }, 1000);
    }

    empty.style.display = "block";
    empty.innerHTML = "";
    empty.appendChild(box);
  }

  goBtn.onclick = function() { _resetAndSearch(); };
  qIn.onkeydown = function(e) { if (e.key === "Enter") { _resetAndSearch(); } };
  prevBtn.onclick = function() {
    if (S.civitai.cursorStack.length) {
      S.civitai.cursor = S.civitai.cursorStack.pop() || "";
      _runSearch();
    }
  };
  nextBtn.onclick = function() {
    if (S.civitai.nextCursor) {
      S.civitai.cursorStack.push(S.civitai.cursor);
      S.civitai.cursor = S.civitai.nextCursor;
      _runSearch();
    }
  };
}

function _lookupCivitai(raw, fieldEl) {
  var v = (raw || "").trim();
  if (!v) { _toast("Paste a model URL, ID, version ID, or SHA-256 hash.", "error"); return; }
  var params = new URLSearchParams();
  if (/^[A-Fa-f0-9]{64}$/.test(v)) {
    params.set("hash", v);
  } else if (/^[A-Fa-f0-9]{10,12}$/.test(v) && /[A-Fa-f]/.test(v)) {
    params.set("hash", v);
  } else if (/^\d+$/.test(v)) {
    params.set("version_id", v);
  } else {
    params.set("model", v);
  }
  if (fieldEl) fieldEl.disabled = true;
  _api("/civitai/lookup?" + params.toString()).then(function(r) {
    if (r.kind === "model") {
      openDetail(r.data);
    } else if (r.kind === "version") {
      var d = r.data;
      var m = d.model || {};
      openDetail({
        id: d.modelId || m.id || 0,
        name: m.name || d.name || "(version " + d.id + ")",
        type: m.type || d.type || "?",
        description: m.description || d.description || "",
        creator: m.creator || {},
        stats: m.stats || {},
        modelVersions: [d],
      });
    } else {
      _toast("Lookup returned unexpected result", "error");
    }
  }).catch(function(e) {
    if (params.get("version_id")) {
      var p2 = new URLSearchParams({ model_id: params.get("version_id") });
      _api("/civitai/lookup?" + p2.toString()).then(function(r) {
        if (r.kind === "model") openDetail(r.data);
        else _toast("Lookup failed", "error");
      }).catch(function(e2) { _toast("Not found: " + e2.message, "error"); });
    } else {
      _toast("Not found: " + e.message, "error");
    }
  }).then(function() { if (fieldEl) fieldEl.disabled = false; });
}

function _card(m) {
  var imgs = m.images || (m.modelVersions && m.modelVersions[0] && m.modelVersions[0].images) || [];
  var firstImg = imgs[0];
  var anyFlags = { hasPG13:true, hasR:true, hasX:true, hasXXX:true };
  var isNsfw = _matchNsfw(m, anyFlags) || (firstImg && _matchNsfw(firstImg, anyFlags));
  var imgUrl = firstImg ? (typeof firstImg === "string" ? firstImg : firstImg.url || "") : "";
  var card = el("div", { class: "cvt-card" });
  var thumb = el("div", { class: "thumb", style: { aspectRatio: "3/4", background: "linear-gradient(135deg,#1a1a1a,#0f0f0f)" } });
  if (imgUrl) {
    var img = el("img", { src: _thumbUrl(imgUrl, 400), style: { width:"100%", height:"100%", objectFit:"cover", display:"block" }, onerror: function() { this.outerHTML = '<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:24px;opacity:.3">\uD83D\uDDBC</div>'; } });
    thumb.appendChild(img);
  }
  if (isNsfw && window.__nsfwBlurEnabled !== false) {
    thumb.style.filter = "blur(20px) grayscale(0.5)";
    thumb.style.willChange = "filter";
    thumb.addEventListener("mouseenter", function() { this.style.filter = "none"; });
    thumb.addEventListener("mouseleave", function() { this.style.filter = "blur(20px) grayscale(0.5)"; });
  }
  card.appendChild(thumb);
  card.appendChild(el("div", { class: "body" },
    el("div", { class: "title" }, m.name || "Untitled"),
    el("div", { class: "meta" },
      el("span", {}, (m.creator && m.creator.username) || "?"),
      el("span", {}, m.type || "?"),
      isNsfw ? el("span", { class: "cvt-badge nsfw" }, "NSFW") : null)));
  card.onclick = function() { openDetail(m); };
  return card;
}

// ── Detail Modal ────────────────────────────────────────────────────
var _curDetailId = 0;
function openDetail(model) {
  closeModal();
  var mid = ++_curDetailId;
  var bg = el("div", { class: "cvt-modal-bg" });
  var wrap = el("div", { class: "cvt-modal-wrap" });
  var closeBtn = el("button", { class: "close" }, "\u00D7");
  var modal = el("div", { class: "cvt-modal" });
  wrap.appendChild(closeBtn); wrap.appendChild(modal); bg.appendChild(wrap);
  S.modal = bg; document.body.appendChild(bg);

  var closer = function() { if (_curDetailId === mid) closeModal(); };
  closeBtn.onclick = closer;
  bg.onclick = function(e) { if (e.target === bg) closer(); };

  var left = el("div", { class: "left" });
  var right = el("div", { class: "right" });
  modal.appendChild(left); modal.appendChild(right);

  left.appendChild(el("h2", {}, model.name || ""));
  left.appendChild(el("div", { class: "sub" }, "by " + (model.creator ? model.creator.username || "?" : "?") + " \u00B7 " + (model.type || "")));
  var gallery = el("div", { class: "gallery" });
  gallery.innerHTML = '<div class="cvt-spinner"></div>';
  left.appendChild(gallery);
  right.innerHTML = '<div class="cvt-spinner"></div>';

  // Fetch full model data if incomplete
  var versions = model.modelVersions || [];
  var hasFull = versions.length && versions[0].images && versions[0].files;
  if (!hasFull && model.id) {
    _api("/civitai/model/" + model.id).then(function(data) {
      if (_curDetailId !== mid) return;
      model.description = model.description || data.description;
      model.creator = model.creator || data.creator;
      model.stats = model.stats || data.stats;
      versions = data.modelVersions || [];
      _buildDetailModal(right, gallery, model, versions, mid);
    }).catch(function(e) {
      right.innerHTML = '<div class="cvt-empty">Error: ' + e.message + '</div>';
    });
  } else {
    _buildDetailModal(right, gallery, model, versions, mid);
  }
}

function _buildDetailModal(right, gallery, model, versions, mid) {
  right.innerHTML = "";
  if (!versions.length) { right.innerHTML = '<div class="cvt-empty">No versions</div>'; return; }
  var curVersion = versions[0];

  // ---- Stats (likes + downloads) above version ----
  if (model.stats) {
    var statsRow = el("div", { style: { display:"flex", gap:"10px", fontSize:"11px", color:"var(--civ-text-dim)", marginBottom:"6px" } });
    if (model.stats.thumbsUpCount != null) statsRow.appendChild(el("span", {}, "\u2764 " + _fmtNum(model.stats.thumbsUpCount)));
    if (model.stats.downloadCount != null) statsRow.appendChild(el("span", {}, "\u2B07 " + _fmtNum(model.stats.downloadCount)));
    if (statsRow.children.length) right.appendChild(statsRow);
  }

  // ---- Version selector ----
  var vSel = el("select");
  versions.forEach(function(v) { vSel.appendChild(el("option", { value: v.id }, v.name || "#" + v.id)); });
  right.appendChild(el("label", {}, "Version"));
  right.appendChild(vSel);

  // ---- File selector ----
  right.appendChild(el("label", {}, "File"));
  var fSel = el("select", { size: "1" });
  right.appendChild(fSel);

  // ---- Folder selector ----
  right.appendChild(el("label", {}, "Folder"));
  var folderSel = el("select");
  folderSel.appendChild(el("option", { value: "auto" }, "Auto \u2192 " + _guessFolder(model.type)));
  _api("/civitai/folders").then(function(r) {
    (r.folders || []).forEach(function(f) { folderSel.appendChild(el("option", { value: f }, f)); });
  }).catch(function() {});
  right.appendChild(folderSel);

  // ---- Subfolder + auto checkbox ----
  right.appendChild(el("label", {}, "Subfolder"));
  var subIn = el("input", { type: "text", placeholder: "subfolder\u2026" });
  var autoModelName = _sanitizeModelName(model.name || "", 50);
  var autoCb = el("input", { type: "checkbox", checked: true });
  subIn.value = autoModelName;
  subIn.style.opacity = "0.5";
  autoCb.onchange = function() {
    if (autoCb.checked) { subIn.value = autoModelName; subIn.style.opacity = "0.5"; subIn.readOnly = true; }
    else { subIn.value = ""; subIn.style.opacity = "1"; subIn.readOnly = false; subIn.focus(); }
  };
  var subRow = el("div", { class: "cvt-row", style: { alignItems:"center" } });
  subRow.appendChild(subIn);
  subRow.appendChild(el("label", { style: { display:"inline-flex", alignItems:"center", gap:"2px", fontSize:"9px", color:"var(--civ-text-mute)", flexShrink:0 } }, autoCb, " Auto"));
  right.appendChild(subRow);

  // ---- Checkboxes row ----
  var checksRow = el("div", { style: { display:"flex", gap:"6px", flexWrap:"wrap", marginTop:"4px", fontSize:"9.5px" } });
  var overwriteLbl = el("label", { class: "check", style: { gap:"2px", margin:0 } }, el("input", { type: "checkbox" }), " Re-download");
  var fnameLbl = el("label", { style: { gap:"2px", margin:0, fontSize:"9.5px", display:"flex", alignItems:"center" } }, "Rename:",
    el("input", { type: "text", placeholder: "custom name", style: { width:"90px", marginLeft:"3px", fontSize:"9px", padding:"1px 3px" } }));
  var metaCb = el("input", { type: "checkbox" });
  var prevCb = el("input", { type: "checkbox" });
  var metaLbl = el("label", { class: "check", style: { gap:"2px", margin:0 } }, metaCb, " Metadata");
  var prevLbl = el("label", { class: "check", style: { gap:"2px", margin:0 } }, prevCb, " Preview");
  checksRow.appendChild(overwriteLbl); checksRow.appendChild(fnameLbl); checksRow.appendChild(metaLbl); checksRow.appendChild(prevLbl);
  right.appendChild(checksRow);

  // ---- Buttons row ----
  var btnRow = el("div", { style: { display:"flex", gap:"4px", marginTop:"4px" } });
    var dlBtn = el("button", { class: "cvt-btn cvt-btn-xs", style: { flex:"1" } },
    el("span", { class: "emoji-btn" }, "\u2B07"), " Download");
  var metaOnlyBtn = el("button", { class: "cvt-btn ghost cvt-btn-xs", style: { flex:"1" } },
    el("span", { class: "emoji-btn" }, "\uD83D\uDCC4"), " Metadata");
  btnRow.appendChild(dlBtn); btnRow.appendChild(metaOnlyBtn);
  right.appendChild(btnRow);

  var statusLine = el("div", { style: { fontSize:"9.5px", color:"var(--civ-text-dim)", marginTop:"3px" } });
  right.appendChild(statusLine);

  // ---- Files list ----
  right.appendChild(el("label", { style: { marginTop:"6px" } }, "Files"));
  var filesList = el("div", { class: "cvt-files-list" });
  right.appendChild(filesList);

  // ---- Description pane (collapsible) ----
  var desc = el("div", { class: "cvt-desc" });
  var descText = model.description || "";
  desc.innerHTML = descText || "<i>(no description)</i>";
  right.appendChild(el("label", { style: { marginTop:"6px" } }, "About"));
  right.appendChild(desc);

  function _renderVersion(v) {
    curVersion = v;
    // Gallery
    gallery.innerHTML = "";
    var gFrag = document.createDocumentFragment();
    var gFlags = _nsfwFlags(S.civitai.nsfw);
    var hasAnyFilter = gFlags.hasPG13 || gFlags.hasR || gFlags.hasX || gFlags.hasXXX;
    var imgs = (v.images || []).filter(function(im) {
      if (!hasAnyFilter) return true;
      // Images may not have nsfw/nfsLevel on their own — inherit from model
      if (im.nsfw == null && im.nsfwLevel == null) { return model.nsfw ? (gFlags.hasPG13 || gFlags.hasR || gFlags.hasX || gFlags.hasXXX) : true; }
      return _matchNsfw(im, gFlags);
    });
    imgs.forEach(function(im) {
      var nsfw = _matchNsfw(im, { hasPG13:true, hasR:true, hasX:true, hasXXX:true }) && window.__nsfwBlurEnabled !== false;
      var imgEl = el("img", {
        src: _thumbUrl(im.url, 500), loading: "lazy", decoding: "async",
        class: nsfw ? "nsfw" : "",
        style: { cursor: "pointer" }
      });
      if (nsfw) {
        imgEl.addEventListener("mouseenter", function() { this.style.filter = "none"; });
        imgEl.addEventListener("mouseleave", function() { this.style.filter = ""; });
      }
      imgEl.onclick = function(e) { e.stopPropagation(); openLightbox(im, model); };
      imgEl.title = "Click to view full image + generation params";
      gFrag.appendChild(imgEl);
    });
    gallery.appendChild(gFrag);

    // Files dropdown
    fSel.innerHTML = "";
    var vfiles = v.files || [];
    function _fillFilename() {
      var idx = parseInt(fSel.value || "0", 10);
      var f = vfiles[idx] || {};
      var fnameIn = fnameLbl.querySelector("input");
      if (fnameIn && !fnameIn.value.trim()) {
        fnameIn.value = f.name || "";
      }
    }
    vfiles.forEach(function(f, idx) {
      fSel.appendChild(el("option", { value: idx },
        (f.name || "") + " \u2014 " + (f.metadata && f.metadata.format || "?") + " " + (f.metadata && f.metadata.fp || "") + " " + (f.metadata && f.metadata.size || "") + " (" + _fmtBytes((f.sizeKB||0)*1024) + ")" + (f.primary ? " \u2605" : "")));
      if (f.primary) fSel.value = idx;
    });
    fSel.onchange = _fillFilename;
    _fillFilename();

    // Base model badge
    var baseModel = v.baseModel || model.baseModel || (v.metadata && v.metadata.baseModel) || "";

    // Files list with SHA256 + copy + base model
    filesList.innerHTML = "";
    vfiles.forEach(function(f) {
      var hashStr = (f.hashes && f.hashes.SHA256) || "";
      var hashShort = hashStr.slice(0, 8) || "\u2014";
      var fileRow = el("div", { class: "f" });
      fileRow.appendChild(el("span", {}, (f.name||"") + (f.primary ? " \u2605" : "")));
      var rightSpan = el("span", { style: { display:"inline-flex", alignItems:"center", gap:"4px" } });
      if (baseModel) rightSpan.appendChild(el("span", { class: "cvt-badge", style: { fontSize:"9px", padding:"1px 5px", textTransform:"none" } }, baseModel));
      rightSpan.appendChild(document.createTextNode(_fmtBytes((f.sizeKB||0)*1024)));
      rightSpan.appendChild(el("span", { style: { opacity:".4" } }, "|"));
      var hashEl = el("span", { style: { fontFamily:"monospace", fontSize:"9.5px", cursor:"pointer", borderBottom:"1px dotted rgba(255,255,255,.15)" }, title: "Click to copy SHA256" }, hashShort);
      hashEl.onclick = function(e) {
        e.stopPropagation();
        navigator.clipboard.writeText(hashStr).then(function() {
          _toast("SHA256 copied", "ok");
        }).catch(function() {});
      };
      rightSpan.appendChild(hashEl);
      fileRow.appendChild(rightSpan);
      filesList.appendChild(fileRow);
    });

    // Update subfolder auto-name from the file name (no extension)
    var primaryFile = vfiles.find(function(f) { return f.primary; }) || vfiles[0] || {};
    autoModelName = primaryFile.name ? _sanitizeModelName(primaryFile.name.replace(/\.[^.]+$/, ""), 80) : _sanitizeModelName(v.name || model.name || "", 50);
    if (autoCb.checked) { subIn.value = autoModelName; }
  }

  vSel.onchange = function() {
    var found = null;
    for (var i = 0; i < versions.length; i++) {
      if (String(versions[i].id) === vSel.value) { found = versions[i]; break; }
    }
    if (found) _renderVersion(found);
  };

  // ---- Submit download ----
  function _submitDownload(metadataOnly) {
    var btn = metadataOnly ? metaOnlyBtn : dlBtn;
    btn.disabled = true;
    statusLine.textContent = metadataOnly ? "Fetching metadata\u2026" : "Starting download\u2026";
    var fIdx = parseInt(fSel.value || "0", 10);
    var fls = curVersion.files || [];
    var file = fls[fIdx] || {};
    var body = {
      model_version_id: curVersion.id,
      save_as: folderSel.value === "auto" ? _guessFolder(model.type) : folderSel.value,
      filename: fnameLbl.querySelector("input").value.trim(),
      overwrite: overwriteLbl.querySelector("input").checked,
      format: file.metadata && file.metadata.format || null,
      fp: file.metadata && file.metadata.fp || null,
      size: file.metadata && file.metadata.size || null,
      save_metadata: metaCb.checked,
      save_preview: prevCb.checked,
      metadata_only: metadataOnly,
      subfolder: subIn.value.trim(),
    };
    _api("/civitai/download", { method:"POST", body:JSON.stringify(body) }).then(function(job) {
      statusLine.innerHTML = "";
      statusLine.appendChild(document.createTextNode((metadataOnly ? "Metadata job queued: " : "Queued: ")));
      statusLine.appendChild(el("b", {}, job.id));
      statusLine.appendChild(document.createTextNode(" \u2014 open "));
      var dlLink = el("a", { href: "#", style: { color:"var(--civ-accent-dim)", cursor:"pointer" } }, "Downloads");
      dlLink.onclick = function(e) { e.preventDefault(); if (S.root) S.root.dispatchEvent(new CustomEvent("civitai:show-tab", { detail: "downloads" })); };
      statusLine.appendChild(dlLink);
      statusLine.appendChild(document.createTextNode(" to monitor."));
      // Mini progress bar
      var miniBar = el("div", { style: { width:"100%", height:"3px", background:"rgba(255,255,255,.06)", borderRadius:"2px", marginTop:"4px", overflow:"hidden" } });
      var miniFill = el("div", { style: { width:"30%", height:"100%", background:"linear-gradient(90deg,rgba(255,255,255,.3),rgba(255,255,255,.6),rgba(255,255,255,.3))", backgroundSize:"200% 100%", borderRadius:"2px", animation:"cvt-bar 1.4s linear infinite" } });
      miniBar.appendChild(miniFill);
      statusLine.appendChild(miniBar);
      _toast(metadataOnly ? "Metadata queued" : "Queued: " + (job.filename || job.name || "download"), "ok");
    }).catch(function(e) {
      statusLine.innerHTML = "";
      statusLine.appendChild(el("span", { style: { color:"#fb8e8e" } }, "Error: " + e.message));
      _toast("Download error: " + e.message, "error", 5000);
    }).then(function() { btn.disabled = false; });
  }

  dlBtn.onclick = function() { _submitDownload(false); };
  metaOnlyBtn.onclick = function() {
    if (!metaCb.checked && !prevCb.checked) {
      statusLine.innerHTML = "";
      statusLine.appendChild(el("span", { style: { color:"#e88" } }, "Enable at least one of metadata sidecar / preview image."));
      return;
    }
    _submitDownload(true);
  };

  _renderVersion(curVersion);
}

// ── Local Model Detail Modal ────────────────────────────────────────
function openLocalDetail(m, grid, filterIn) {
  closeModal();
  var mid = ++_curDetailId;
  var bg = el("div", { class: "cvt-modal-bg" });
  var wrap = el("div", { class: "cvt-modal-wrap" });
  var closeBtn = el("button", { class: "close" }, "\u00D7");
  var modal = el("div", { class: "cvt-modal" });
  wrap.appendChild(closeBtn); wrap.appendChild(modal); bg.appendChild(wrap);
  S.modal = bg; document.body.appendChild(bg);

  var closer = function() { if (_curDetailId === mid) closeModal(); };
  closeBtn.onclick = closer;
  bg.onclick = function(e) { if (e.target === bg) closer(); };

  var left = el("div", { class: "left" });
  var right = el("div", { class: "right" });
  modal.appendChild(left); modal.appendChild(right);

  // Left: title + gallery (same layout as Browse modal)
  left.appendChild(el("h2", {}, m.name || ""));
  left.appendChild(el("div", { class: "sub" }, (m.type || "") + (m.base_model ? " \u00B7 " + m.base_model : "") + (m.size ? " \u00B7 " + m.size : "")));
  var gallery = el("div", { class: "gallery" });
  gallery.innerHTML = '<div class="cvt-spinner"></div>';
  left.appendChild(gallery);

  var isNsfw = _matchNsfw(m, { hasPG13:true, hasR:true, hasX:true, hasXXX:true }) && window.__nsfwBlurEnabled !== false;


  // Fetch all previews from server
  if (m.path) {
    _api("/civitai/local-previews?path=" + encodeURIComponent(m.path)).then(function(r) {
      var imgs = r.images || [];
      if (!imgs.length && m.preview) {
        imgs = [{ url: "/civitai/local-preview?path=" + encodeURIComponent(m.preview) + "&w=300", prompt: "", negativePrompt: "" }];
      }
      gallery.innerHTML = "";
      if (!imgs.length) {
        gallery.innerHTML = '<div style="grid-column:1/-1" class="cvt-empty">No preview images</div>';
        return;
      }
      var gFrag = document.createDocumentFragment();
      imgs.forEach(function(im) {
        var imgSrc = (typeof im === "object") ? im.url : im;
        var prompt = (typeof im === "object") ? (im.prompt || "") : "";
        var negPrompt = (typeof im === "object") ? (im.negativePrompt || "") : "";
        var meta = (typeof im === "object") ? im : {};
        var nsfw = isNsfw;
        var imgEl = el("img", {
          src: imgSrc, loading: "lazy", decoding: "async",
          class: nsfw ? "nsfw" : "",
          style: { cursor: "pointer" }
        });
        if (nsfw) {
          imgEl.addEventListener("mouseenter", function() { this.style.filter = "none"; });
          imgEl.addEventListener("mouseleave", function() { this.style.filter = ""; });
        }
        imgEl.onclick = function(e) {
          e.stopPropagation();
          // Adapt local image format to lightbox format (expects img.meta.prompt etc.)
          var lightboxImg = {
            url: imgSrc,
            width: meta.width || 0,
            height: meta.height || 0,
            meta: {
              prompt: prompt || "",
              negativePrompt: negPrompt || "",
              seed: meta.seed,
              sampler: meta.sampler,
              steps: meta.steps,
              cfgScale: meta.cfgScale || meta.cfg_scale,
              Model: meta.model || meta.Model
            }
          };
          openLightbox(lightboxImg, m);
        };
        imgEl.title = "Click to view full image + generation params";
        gFrag.appendChild(imgEl);
      });
      gallery.appendChild(gFrag);
    }).catch(function() {
      gallery.innerHTML = '<div class="cvt-empty">Failed to load previews</div>';
    });
  } else if (m.preview) {
    gallery.innerHTML = "";
    var imgEl = el("img", {
      src: "/civitai/local-preview?path=" + encodeURIComponent(m.preview) + "&w=500",
      loading: "lazy", class: isNsfw ? "nsfw" : ""
    });
    gallery.appendChild(imgEl);
  } else {
    gallery.innerHTML = '<div style="grid-column:1/-1" class="cvt-empty">No preview images</div>';
  }

  // Right: details
  var rightContent = el("div", { style: { display:"flex", flexDirection:"column", gap:"6px" } });
  right.appendChild(rightContent);

  // Basic info
  rightContent.appendChild(el("label", {}, "Details"));
  var infoList = el("div", { style: { fontSize:"11px", color:"var(--civ-text-dim)", lineHeight:"1.6" } });
  infoList.appendChild(el("div", {}, el("strong", { style: { color:"var(--civ-text-mute)" } }, "Type: "), m.type || "?"));
  infoList.appendChild(el("div", {}, el("strong", { style: { color:"var(--civ-text-mute)" } }, "Size: "), m.size || "?"));
  if (m.base_model) infoList.appendChild(el("div", {}, el("strong", { style: { color:"var(--civ-text-mute)" } }, "Base Model: "), m.base_model));
  infoList.appendChild(el("div", {}, el("strong", { style: { color:"var(--civ-text-mute)" } }, "Location: "), (m.folder || m.type || "?") + "/"));
  if (m.creator) infoList.appendChild(el("div", {}, el("strong", { style: { color:"var(--civ-text-mute)" } }, "Creator: "), m.creator));
  rightContent.appendChild(infoList);

  // Hash and Civitai lookup
  var civSection = el("div", { style: { marginTop:"6px" } });
  rightContent.appendChild(civSection);
  civSection.appendChild(el("label", {}, "Civitai Lookup"));
  var civStatus = el("div", { style: { fontSize:"10px", color:"var(--civ-text-dim)", padding:"6px 0" } }, "\u23F3 Looking up hash\u2026");
  civSection.appendChild(civStatus);

  // Direct link from metadata
  if (m.model_id) {
    var directLink = el("a", { href: "https://civitai.com/models/" + m.model_id, target: "_blank", style: { display:"inline-block", fontSize:"10px", color:"var(--civ-accent-dim)", marginBottom:"4px" } }, "\uD83C\uDF10 View on Civitai");
    civSection.insertBefore(directLink, civStatus);
  }

  if (m.hash) {
    _api("/civitai/lookup?hash=" + encodeURIComponent(m.hash)).then(function(r) {
      if (_curDetailId !== mid) return;
      if (r.kind === "version" && r.data) {
        var d = r.data;
        var modelData = d.model || {};
        var creator = modelData.creator || {};
        var creatorName = (typeof creator === "object") ? (creator.username || creator.name || "") : creator;
        civStatus.innerHTML = "";
        civStatus.appendChild(el("div", { style: { fontSize:"11px", lineHeight:"1.5" } },
          el("div", {}, el("strong", { style: { color:"var(--civ-text-mute)" } }, "Model: "), modelData.name || d.name || ""),
          el("div", {}, el("strong", { style: { color:"var(--civ-text-mute)" } }, "Creator: "), creatorName || "?"),
          el("div", {}, el("strong", { style: { color:"var(--civ-text-mute)" } }, "Type: "), modelData.type || d.type || "?"),
          el("div", {}, el("strong", { style: { color:"var(--civ-text-mute)" } }, "Base: "), d.baseModel || modelData.baseModel || "?"),
          el("div", {}, el("strong", { style: { color:"var(--civ-text-mute)" } }, "Version: "), d.name || "?")));
        var civBtn = el("button", { class: "cvt-btn ghost cvt-btn-xs", style: { marginTop:"6px" } }, "\uD83C\uDF10 View on Civitai");
        civBtn.onclick = function() { window.open("https://civitai.com/models/" + (modelData.id || ""), "_blank"); };
        civStatus.appendChild(civBtn);

        // Gallery of all Civitai images with prompts
        if (d.images && d.images.length) {
          var galLabel = el("label", { style: { marginTop:"8px", display:"block" } }, "Civitai Gallery");
          rightContent.appendChild(galLabel);
          var civGal = el("div", { style: { display:"flex", gap:"6px", overflowX:"auto", paddingBottom:"4px", maxWidth:"100%" } });
          d.images.forEach(function(im) {
            var imgSrc = (typeof im === "object") ? im.url : im;
            var cMeta = (typeof im === "object") ? (im.meta || {}) : {};
            var prompt = cMeta.prompt || "";
            var negPrompt = cMeta.negativePrompt || "";
            var cThumb = el("img", {
              src: _thumbUrl(imgSrc, 300), loading:"lazy",
              style: { height:"80px", borderRadius:"var(--civ-radius-sm)", cursor:"pointer", flexShrink:0, objectFit:"cover" },
              title: prompt ? prompt.slice(0, 120) : ""
            });
            cThumb.onclick = function(e) {
              e.stopPropagation();
              var lightboxImg = { url: imgSrc, meta: cMeta, width: im.width || 0, height: im.height || 0 };
              openLightbox(lightboxImg, { name: m.name, creator: { username: creatorName } });
            };
            civGal.appendChild(cThumb);
          });
          rightContent.appendChild(civGal);

          // Show model-level description if available
          var fullDesc = modelData.description || d.description || "";
          if (fullDesc && fullDesc !== m.description) {
            rightContent.appendChild(el("label", { style: { marginTop:"6px" } }, "About"));
            var descEl = el("div", { class: "cvt-desc" });
            descEl.textContent = fullDesc;
            rightContent.appendChild(descEl);
          }
        }
      } else {
        civStatus.textContent = "\u26A0 Not found on Civitai";
      }
    }).catch(function(e) {
      if (_curDetailId !== mid) return;
      civStatus.textContent = "\u26A0 Lookup failed: " + (e.message || "error");
    });
  } else {
    civStatus.textContent = "\u26A0 No hash available \u2014 use Refresh to scan files";
  }

  // Tags
  if (m.tags && m.tags.length) {
    rightContent.appendChild(el("label", { style: { marginTop:"6px" } }, "Tags"));
    var tagsContainer = el("div", { class: "cvt-local-tags" });
    m.tags.slice(0, 8).forEach(function(tag) {
      tagsContainer.appendChild(el("span", { class: "cvt-tag" }, "#" + tag));
    });
    rightContent.appendChild(tagsContainer);
  }

  // Description from metadata
  if (m.description) {
    rightContent.appendChild(el("label", { style: { marginTop:"6px" } }, "About"));
    var desc = el("div", { class: "cvt-desc" });
    desc.textContent = m.description;
    rightContent.appendChild(desc);
  }

  // Actions
  var actions = el("div", { style: { display:"flex", gap:"6px", marginTop:"8px", flexWrap:"wrap" } });
  var cpBtn = el("button", { class: "cvt-btn ghost cvt-btn-xs", style: { flex:"1" } }, "\uD83D\uDCCB Copy path");
  cpBtn.onclick = function() {
    navigator.clipboard.writeText(m.path || "").then(function() { _toast("Copied!"); }).catch(function() {});
  };
  actions.appendChild(cpBtn);

  var delBtn = el("button", { class: "cvt-btn ghost cvt-btn-xs", style: { flex:"1" } }, "\u2715 Delete");
  delBtn.onclick = function() {
    if (!confirm("Delete \"" + (m.name || "") + "\"?")) return;
    _api("/civitai/delete-model", { method:"POST", body:JSON.stringify({path:m.path}) }).then(function() {
      _toast("Deleted: " + m.name, "ok");
      S.local.models = S.local.models.filter(function(x) { return x.path !== m.path; });
      closer();
      if (grid) _renderLocalGrid(grid, filterIn);
    }).catch(function(e) { _toast("Delete failed: " + e.message, "error"); });
  };
  actions.appendChild(delBtn);
  rightContent.appendChild(actions);
}

function _sanitizeModelName(name, maxLen) {
  maxLen = maxLen || 50;
  return (name || "").replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").substring(0, maxLen);
}

function _guessFolder(type) {
  return ({
    Checkpoint: "checkpoints", LORA: "loras", LoCon: "loras", DoRA: "loras",
    VAE: "vae", Controlnet: "controlnet",
    TextualInversion: "embeddings", Hypernetwork: "hypernetworks",
    Upscaler: "upscale_models", MotionModule: "animatediff_models",
  })[type] || "other";
}

// ── Lightbox ────────────────────────────────────────────────────────
function openLightbox(img, model) {
  closeLightbox();
  var bg = el("div", { class: "cvt-lightbox-bg" });
  var content = el("div", { style: { display:"flex", gap:"20px", alignItems:"flex-start", maxWidth:"96vw", maxHeight:"90vh" } });

  // Left: image
  var imgWrap = el("div", { style: { flex:"0 1 auto", maxHeight:"90vh", display:"flex", alignItems:"center" } });
  var mainImg = el("img", {
    src: img.url,
    style: { maxWidth:"70vw", maxHeight:"88vh", objectFit:"contain", borderRadius:"var(--civ-radius)", boxShadow:"0 20px 60px rgba(0,0,0,.70)", transition:"transform .25s var(--civ-spring)" }
  });
  if (img.width && img.height) mainImg.style.aspectRatio = img.width + "/" + img.height;
  imgWrap.appendChild(mainImg);

  // Right: generation parameters panel
  var meta = img.meta || {};
  var panel = el("div", { class: "cvt-gen-panel" });

  // Image info
  panel.appendChild(el("div", { class: "cvt-gen-heading" }, "\uD83D\uDDBC\uFE0F  Info"));
  panel.appendChild(el("div", { class: "cvt-gen-row" },
    el("span", { class: "cvt-gen-label" }, "Dimensions"),
    el("span", {}, img.width && img.height ? img.width + " \u00D7 " + img.height : "\u2014")));

  if (meta && Object.keys(meta).length) {
    // Positive prompt
    if (meta.prompt) {
      var promptBox = el("div", { class: "cvt-prompt-box" });
      promptBox.appendChild(el("div", { class: "cvt-gen-label" }, "\u2728 Prompt"));
      promptBox.appendChild(el("div", { class: "cvt-prompt-text" }, meta.prompt));
      var cpBtn = el("button", { class: "cvt-btn ghost cvt-copy-btn" }, "\uD83D\uDCCB Copy");
      cpBtn.onclick = function(e) { e.stopPropagation(); navigator.clipboard.writeText(meta.prompt).then(function() { _toast("Positive prompt copied!", "ok"); }); };
      promptBox.appendChild(cpBtn);
      panel.appendChild(promptBox);
    }

    // Negative prompt
    if (meta.negativePrompt) {
      var negBox = el("div", { class: "cvt-prompt-box" });
      negBox.appendChild(el("div", { class: "cvt-gen-label" }, "\uD83D\uDEAB Negative"));
      negBox.appendChild(el("div", { class: "cvt-prompt-text" }, meta.negativePrompt));
      var negCp = el("button", { class: "cvt-btn ghost cvt-copy-btn" }, "\uD83D\uDCCB Copy");
      negCp.onclick = function(e) { e.stopPropagation(); navigator.clipboard.writeText(meta.negativePrompt).then(function() { _toast("Negative prompt copied!", "ok"); }); };
      negBox.appendChild(negCp);
      panel.appendChild(negBox);
    }

    // Generation parameters grid
    panel.appendChild(el("div", { class: "cvt-gen-heading", style: { marginTop:"12px" } }, "\u2699\uFE0F  Params"));
    var params = [
      ["Model", meta.Model || meta.model || "\u2014"],
      ["Sampler", meta.sampler || meta.Sampler || "\u2014"],
      ["Seed", meta.seed != null ? String(meta.seed) : "\u2014"],
      ["CFG", meta.cfgScale != null ? String(meta.cfgScale) : "\u2014"],
      ["Steps", meta.steps != null ? String(meta.steps) : "\u2014"],
      ["Batch", meta.batchSize != null ? String(meta.batchSize) : "\u2014"],
      ["Clip Skip", meta.clipSkip != null ? String(meta.clipSkip) : "\u2014"],
      ["Hires", meta.hiresUpscaler || meta["Hires upscaler"] || "\u2014"],
      ["Denoise", meta.denoisingStrength != null ? String(meta.denoisingStrength) : "\u2014"],
      ["VAE", meta.vae || meta.VAE || "\u2014"],
    ];
    var paramGrid = el("div", { class: "cvt-gen-param-grid" });
    params.forEach(function(p) {
      paramGrid.appendChild(el("div", { class: "cvt-gen-param-row" },
        el("span", { class: "cvt-gen-label" }, p[0]),
        el("span", { class: "cvt-gen-value" }, p[1])));
    });
    panel.appendChild(paramGrid);

    // "Use this prompt" button
    if (meta.prompt) {
      var useBtn = el("button", { class: "cvt-btn", style: { marginTop:"14px", width:"100%" } }, "\u26A1 Use in workflow");
      useBtn.onclick = function(e) {
        e.stopPropagation();
        _api("/civitai/prompt-fetcher", {
          method: "POST",
          body: JSON.stringify({ positive: meta.prompt || "", negative: meta.negativePrompt || "" })
        }).then(function() {
          _toast("\u26A1 Prompts sent to Prompt Fetcher node! Run your workflow to use them.", "ok");
        }).catch(function(err) {
          _toast("Failed: " + err.message, "error");
        });
      };
      panel.appendChild(useBtn);
    }
  } else {
    panel.appendChild(el("div", { style: { color:"var(--civ-text-mute)", fontSize:"11px", marginTop:"8px" } }, "No generation parameters available for this image."));
  }

  content.appendChild(imgWrap);
  content.appendChild(panel);
  bg.appendChild(content);
  S.lightbox = bg;
  document.body.appendChild(bg);

  // Close with fade animation
  function _closeLB() {
    bg.style.opacity = "0";
    setTimeout(function() { if (bg.parentNode) bg.remove(); }, 200);
  }
  bg.onclick = function(e) { if (e.target === bg) _closeLB(); };
  // Override closeLightbox to use fade
  S._closeLB = _closeLB;
}

function _startDl(url, name, subfolder) {
  _api("/civitai/download", { method: "POST", body: JSON.stringify({ url: url, filename: name, subfolder: subfolder || "" }) })
    .then(function() { _toast("Queued: " + name); })
    .catch(function(e) { _toast("Download failed: " + e.message, "error"); });
}

// ── 2. HUGGING FACE ─────────────────────────────────────────────────
function renderHF(pane) {
  var sb = el("div", { class: "cvt-searchbar" });

  // ---- Manual entry row (repo URL / ID) ----
  var directIn = el("input", { type: "text", placeholder: "user/repo / URL\u2026", style: { flex:"1", fontFamily:"monospace", fontSize:"11px", background:"#1c1410", borderColor:"#5a3a2a" } });
  var directBtn = el("button", { class: "cvt-btn", style: { flex:"0 0 auto" } }, "\uD83C\uDFAF");
  var directRow = el("div", { class: "cvt-row", style: { marginBottom:"6px" } });
  directRow.appendChild(directIn); directRow.appendChild(directBtn);
  sb.appendChild(directRow);

  directBtn.onclick = function() { _lookupHF(directIn.value, directIn); };
  directIn.onkeydown = function(e) { if (e.key === "Enter") directBtn.click(); };

  // ---- Search ----
  var row1 = el("div", { class: "cvt-row" });
  var qIn = el("input", { type: "text", placeholder: "Search Hugging Face\u2026", id: "cvt-hf-q", style: { flex:1 } });
  var sortSel = el("select", { id: "cvt-hf-sort", class: "cvt-select-sm", title: "Sort by" });
  HF_SORTS.forEach(function(s) { sortSel.appendChild(el("option", { value: s }, s)); });
  row1.appendChild(qIn); row1.appendChild(sortSel); sb.appendChild(row1);

  var row2 = el("div", { class: "cvt-row", style: { flexWrap:"wrap", gap:"4px", alignItems:"center" } });
  var ptSel = el("select", { id: "cvt-hf-pt", class: "cvt-select-sm", title: "Pipeline" });
  HF_PIPELINES.forEach(function(p) { ptSel.appendChild(el("option", { value: p }, p || "Any pipeline")); });
  var libSel = el("select", { id: "cvt-hf-lib", class: "cvt-select-sm", title: "Library" });
  HF_LIBRARIES.forEach(function(l) { libSel.appendChild(el("option", { value: l }, l || "Any library")); });
  var authorIn = el("input", { type: "text", placeholder: "Author", style: { flex:"0 0 auto", width:"100px", fontSize:"11px" } });
  var goBtn = el("button", { class: "cvt-btn", style: { flex:"0 0 auto" } }, "\uD83D\uDD0D");
  row2.appendChild(ptSel); row2.appendChild(libSel); row2.appendChild(authorIn); row2.appendChild(goBtn);
  sb.appendChild(row2);
  pane.appendChild(sb);

  var grid = el("div", { class: "cvt-grid", id: "cvt-hf-grid" });
  pane.appendChild(grid);

  goBtn.onclick = _srch;
  qIn.onkeydown = function(e) { if (e.key === "Enter") _srch(); };

  function _srch() {
    grid.innerHTML = '<div class="cvt-spinner"></div>';
    S.hf.query = qIn.value;
    S.hf.sort = sortSel.value;
    S.hf.pipeline_tag = ptSel.value;
    S.hf.library = libSel.value;
    S.hf.author = authorIn.value;
    var params = new URLSearchParams({
      query: S.hf.query, sort: S.hf.sort,
      limit: "30",
    });
    if (S.hf.pipeline_tag) params.set("pipeline_tag", S.hf.pipeline_tag);
    if (S.hf.library) params.set("library", S.hf.library);
    if (S.hf.author) params.set("author", S.hf.author);
    _api("/civitai/hf-search?" + params.toString()).then(function(d) {
      S.hf.items = d.items || [];
      grid.innerHTML = "";
      if (!S.hf.items.length) { grid.innerHTML = '<div class="cvt-empty" style="grid-column:1/-1">No models found</div>'; return; }
      S.hf.items.forEach(function(m) {
        var rep = m.modelId || m.id || "";
        var ini = rep.split("/").filter(Boolean).map(function(s) { return s[0]; }).join("").toUpperCase().slice(0, 2) || "HF";
        var totalSize = 0;
        if (m.siblings && m.siblings.length) {
          m.siblings.forEach(function(s) {
            if (s.size && /\.(safetensors|ckpt|pt|bin|pth|gguf)$/i.test(s.rfilename || "")) totalSize += s.size;
          });
        }
        var card = el("div", { class: "cvt-card" });
        card.appendChild(el("div", { class: "thumb", style: { display:"flex",alignItems:"center",justifyContent:"center",background:"linear-gradient(135deg,#3a2a5a,#1e3a5a)",color:"#fff",fontSize:"28px",fontWeight:700 } }, ini));
        card.appendChild(el("div", { class: "body" },
          el("div", { class: "title", style: { color:"#ff8c42" } }, rep),
          el("div", { class: "meta" },
            el("span", {}, "\u2B07 " + _fmtNum(m.downloads || 0)),
            el("span", {}, "\u2764 " + _fmtNum(m.likes || 0)),
            totalSize ? el("span", { style: { color:"var(--civ-text-mute)" } }, _fmtBytes(totalSize)) : null)));
        card.onclick = function() { _hfDetail(rep); };
        grid.appendChild(card);
      });
    }).catch(function(e) { grid.innerHTML = '<div class="cvt-empty" style="grid-column:1/-1;color:#f88">Error: ' + e.message + '</div>'; });
  }
}

function _lookupHF(raw, fieldEl) {
  var v = (raw || "").trim();
  if (!v || v.indexOf("/") < 0) { _toast("Enter a repo in format: user/repo", "error"); return; }
  if (fieldEl) fieldEl.disabled = true;
  _api("/civitai/hf-lookup?repo=" + encodeURIComponent(v)).then(function(data) {
    if (data && data.id) {
      _hfDetail(data.id);
    } else {
      _toast("Repo not found", "error");
    }
  }).catch(function(e) { _toast("Lookup failed: " + e.message, "error"); })
  .then(function() { if (fieldEl) fieldEl.disabled = false; });
}

function _hfDetail(repoIdOrData) {
  var repoId = typeof repoIdOrData === "string" ? repoIdOrData : (repoIdOrData.id || "");
  if (!repoId || repoId.indexOf("/") < 0) { _toast("Invalid repo ID", "error"); return; }
  var bg = el("div", { class: "cvt-modal-bg" });
  var wrap = el("div", { class: "cvt-modal-wrap" });
  var closeBtn = el("button", { class: "close" }, "\u00D7");
  var modal = el("div", { class: "cvt-modal" });
  wrap.appendChild(closeBtn); wrap.appendChild(modal); bg.appendChild(wrap);
  document.body.appendChild(bg);
  closeBtn.onclick = function() { bg.remove(); };
  bg.onclick = function(e) { if (e.target === bg) bg.remove(); };

  var left = el("div", { class: "left" });
  var right = el("div", { class: "right" });
  modal.appendChild(left); modal.appendChild(right);
  left.appendChild(el("h2", { style: { color:"#ff8c42" } }, repoId));
  left.appendChild(el("div", { class: "sub" }, "Loading\u2026"));

  _api("/civitai/hf-files?repo_id=" + encodeURIComponent(repoId)).then(function(info) {
    var files = Array.isArray(info) ? info : info.siblings || [];
    var data = info.data || info;
    var pt = data.pipeline_tag || data.library_name || "?";
    left.querySelector(".sub").innerHTML = "";
    left.querySelector(".sub").textContent = "task: " + pt + " \u00B7 \u2B07 " + _fmtNum(data.downloads || 0) + " \u00B7 \u2764 " + _fmtNum(data.likes || 0);

    // Revision input
    right.appendChild(el("label", {}, "Branch / commit"));
    var revIn = el("input", { type: "text", value: "main", style: { marginTop:"4px" } });
    right.appendChild(revIn);

    // Weights filter
    right.appendChild(el("label", {}, "Files"));
    var filterRow = el("div", { class: "cvt-row", style: { marginTop:"4px" } });
    var onlyWeights = el("input", { type: "checkbox", checked: true });
    filterRow.appendChild(el("label", { style: { display:"flex", alignItems:"center", gap:"4px", fontSize:"11px" } }, onlyWeights, " weights only"));
    right.appendChild(filterRow);

    // File list as select
    var fileSel = el("select", { size: "10", style: { width:"100%", marginTop:"4px", padding:"4px" } });
    right.appendChild(fileSel);

    function fillFiles() {
      var sibs = files.slice();
      sibs.sort(function(a, b) { return (a.rfilename || "").localeCompare(b.rfilename || ""); });
      fileSel.innerHTML = "";
      for (var i = 0; i < sibs.length; i++) {
        var fn = sibs[i].rfilename || "";
        if (onlyWeights.checked && !/\.(safetensors|ckpt|pt|bin|pth|gguf|onnx|pkl|npz)$/i.test(fn)) continue;
        var sz = sibs[i].size ? "  (" + _fmtBytes(sibs[i].size) + ")" : "";
        fileSel.appendChild(el("option", { value: fn }, fn + sz));
      }
      // Auto-pick biggest .safetensors
      var best = null, bestSize = 0;
      for (var j = 0; j < fileSel.options.length; j++) {
        var sib = files.find(function(x) { return x.rfilename === fileSel.options[j].value; });
        if (sib && /\.safetensors$/i.test(fileSel.options[j].value) && (sib.size || 0) > bestSize) {
          best = fileSel.options[j].value; bestSize = sib.size || 0;
        }
      }
      if (best) fileSel.value = best;
    }
    onlyWeights.onchange = fillFiles;
    fillFiles();

    // Folder dropdown
    right.appendChild(el("label", { style: { marginTop:"10px" } }, "Folder"));
    var folderSel = el("select");
    folderSel.appendChild(el("option", { value: "auto" }, "Auto"));
    _api("/civitai/folders").then(function(r) {
      (r.folders || []).forEach(function(f) { folderSel.appendChild(el("option", { value: f }, f)); });
    }).catch(function() {});
    right.appendChild(folderSel);

    // Subfolder + overwrite
    right.appendChild(el("label", {}, "Subfolder"));
    var subIn = el("input", { type: "text", placeholder: "subfolder\u2026", style: { marginTop:"4px" } });
    right.appendChild(subIn);

    var overwriteLbl = el("label", { class: "check", style: { display:"flex", alignItems:"center", gap:"6px", marginTop:"8px" } },
      el("input", { type: "checkbox" }), " Overwrite");
    right.appendChild(overwriteLbl);
    var subfolderLbl = el("label", { class: "check", style: { display:"flex", alignItems:"center", gap:"6px", marginTop:"4px" } },
      el("input", { type: "checkbox" }), " Keep subfolders");
    right.appendChild(subfolderLbl);

    // Metadata + preview checkboxes
    var metaCb = el("input", { type: "checkbox" });
    var prevCb = el("input", { type: "checkbox" });
    right.appendChild(el("label", { class: "check", style: { display:"flex", alignItems:"center", gap:"6px", marginTop:"6px" } }, metaCb, " Save .civitai.json"));
    right.appendChild(el("label", { class: "check", style: { display:"flex", alignItems:"center", gap:"6px", marginTop:"4px" } }, prevCb, " Save preview"));

    // Download + Metadata only buttons
    var dlBtn = el("button", { class: "cvt-btn cvt-btn-xs", style: { marginTop:"10px", width:"100%" } },
      el("span", { class: "emoji-btn" }, "\u2B07"), " Download");
    var metaOnlyBtn = el("button", { class: "cvt-btn ghost cvt-btn-xs", style: { marginTop:"6px", width:"100%" } }, "\uD83D\uDCC4 Meta");
    right.appendChild(dlBtn); right.appendChild(metaOnlyBtn);

    var statusLine = el("div", { class: "sub", style: { marginTop:"10px" } });
    right.appendChild(statusLine);

    function _submitHF(metadataOnly) {
      var btn = metadataOnly ? metaOnlyBtn : dlBtn;
      var path = fileSel.value;
      if (!path && !metadataOnly) {         statusLine.innerHTML = "<span style='color:#e88'>Pick a file first.</span>"; return; }
      btn.disabled = true;
      statusLine.textContent = metadataOnly ? "Fetching metadata\u2026" : "Starting download\u2026";
      var body = {
        repo_id: repoId,
        revision: revIn.value.trim() || "main",
        path: path,
        save_as: folderSel.value || "auto",
        subfolder: subIn.value.trim(),
        overwrite: overwriteLbl.querySelector("input").checked,
        preserve_subfolders: subfolderLbl.querySelector("input").checked,
        save_metadata: metaCb.checked,
        save_preview: prevCb.checked,
        metadata_only: metadataOnly,
      };
      _api("/civitai/hf/download", { method:"POST", body:JSON.stringify(body) }).then(function(job) {
        statusLine.innerHTML = "";
        statusLine.appendChild(document.createTextNode("Queued: "));
        statusLine.appendChild(el("b", {}, job.id));
        statusLine.appendChild(document.createTextNode(" \u2014 open "));
        var dlLink = el("a", { href: "#", style: { color:"#ec9", cursor:"pointer" } }, "Downloads");
        dlLink.onclick = function(e) {
          e.preventDefault(); bg.remove();
          if (S.root) S.root.dispatchEvent(new CustomEvent("civitai:show-tab", { detail: "downloads" }));
        };
        statusLine.appendChild(dlLink);
        statusLine.appendChild(document.createTextNode(" to monitor."));
        _toast(metadataOnly ? "HF metadata queued" : "HF queued: " + (job.filename || path), "ok");
      }).catch(function(e) {
        statusLine.innerHTML = "";
        statusLine.appendChild(el("span", { style: { color:"#fb8e8e" } }, "Error: " + e.message));
        _toast("HF error: " + e.message, "error", 5000);
      }).then(function() { btn.disabled = false; });
    }

    dlBtn.onclick = function() { _submitHF(false); };
    metaOnlyBtn.onclick = function() {
      if (!metaCb.checked && !prevCb.checked) {
        statusLine.innerHTML = "<span style='color:#e88'>Enable at least one of metadata sidecar / preview image.</span>";
        return;
      }
      _submitHF(true);
    };

    // File list on left
    left.appendChild(el("label", { style: { marginTop:"8px" } }, "Files"));
    var fl = el("div", { class: "cvt-files-list", style: { flex:"0 0 auto", marginTop:"4px" } });
    files.forEach(function(f) {
      var fn = f.rfilename || f.path || "";
      var isWeight = /\.(safetensors|ckpt|pt|pth|gguf|bin)$/i.test(fn);
      var row = el("div", { class: "f" });
      row.appendChild(el("span", { style: { overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1 } }, fn));
      var rightSpan = el("span", { style: { display:"inline-flex", gap:"4px", alignItems:"center", flexShrink:0 } });
      rightSpan.appendChild(el("span", { style: { color:"var(--civ-text-mute)" } }, f.size ? _fmtBytes(f.size) : ""));
      if (isWeight) {
        var dlBtn2 = el("button", { class: "cvt-btn ghost", style: { padding:"2px 8px", fontSize:"10px" } }, "\u2B07");
        dlBtn2.onclick = function() {
          var name = fn.split("/").pop();
          var sf = subIn.value || "";
          var fldr = folderSel.value || "loras";
          _startDl("https://huggingface.co/" + repoId + "/resolve/main/" + encodeURIComponent(fn), name, fldr + (sf ? "/" + sf : ""));
        };
        rightSpan.appendChild(dlBtn2);
      }
      row.appendChild(rightSpan);
      fl.appendChild(row);
    });
    left.appendChild(fl);
  }).catch(function(e) { left.innerHTML = '<div class="cvt-empty">Error: ' + e.message + '</div>'; });
}

// ── 3. DOWNLOADS ────────────────────────────────────────────────────
var _dlTimer = null;
var _dlListEl = null;
var _dlHeader = null;
var _dlCountEl = null;

function renderDownloads(pane) {
  _dlListEl = null;

  // Header (static)
  _dlHeader = el("div", { class: "cvt-row", style: { marginBottom:"10px", paddingBottom:"8px", borderBottom:"1px solid var(--civ-line)", flexShrink:0 } });
  var refreshBtn = el("button", { class: "cvt-btn ghost" },
    el("span", { class: "emoji-btn emoji-spin-slow" }, "\u21BB"), " Refresh");
  refreshBtn.onclick = _pollDl;
  _dlCountEl = el("div", { style: { textAlign:"right", fontSize:"11px", color:"var(--civ-text-dim)", flex:"2", alignSelf:"center" } });
  _dlHeader.appendChild(refreshBtn);
  _dlHeader.appendChild(_dlCountEl);
  pane.appendChild(_dlHeader);

  _dlListEl = el("div");
  pane.appendChild(_dlListEl);
  _pollDl();
}

function _pollDl() {
  if (!_dlListEl || !document.body.contains(_dlListEl)) {
    if (_dlTimer) { clearInterval(_dlTimer); _dlTimer = null; }
    return;
  }
  _api("/civitai/downloads").then(function(d) {
    if (!_dlListEl || !document.body.contains(_dlListEl)) return;
    S.downloads = d.items || [];

    // Adaptive heartbeat: stop polling if no active jobs or tab hidden
    _activeJobs = S.downloads.filter(function(j) { return j.status === "running" || j.status === "queued" || j.status === "downloading"; }).length;
    _dlCountEl.textContent = S.downloads.length + " job(s)";

    // Diff rendering: only replace list content
    _dlListEl.innerHTML = "";
    if (!S.downloads.length) {
      _dlListEl.appendChild(el("div", { class: "cvt-empty" }, "No downloads yet."));
      return;
    }
    var frag = document.createDocumentFragment();
    S.downloads.forEach(function(j) { frag.appendChild(_jobRow(j)); });
    _dlListEl.appendChild(frag);
  }).catch(function() {});

  // Adaptive heartbeat: only poll when visible and active
  if (_dlTimer) clearInterval(_dlTimer);
  if (_activeJobs > 0 && !document.hidden) {
    _dlTimer = setInterval(_pollDl, 1500);
  } else {
    _dlTimer = null;
  }
}

function _jobRow(j) {
  var pct = j.progress != null ? Math.round(j.progress) : 0;
  var row = el("div", { class: "cvt-job " + (j.status || "") });
  var top = el("div", { class: "top" });

  // Source badge
  var srcBadge = j.source === "hf"
    ? el("span", { class: "cvt-badge", style: { background:"#3a4a6a" } }, "\uD83E\uDD17 HF")
    : el("span", { class: "cvt-badge", style: { background:"#5a2a2a" } }, "Civitai");

  top.appendChild(el("div", { class: "name" },
    el("span", { class: "cvt-status-dot " + (j.status || "") }),
    " ", srcBadge, " ",
    j.filename || j.name || (j.source === "hf"
      ? (j.hf_repo_id || "") + ":" + (j.hf_path || "")
      : "version " + (j.model_version_id || ""))));

  // Cancel button
  if (j.status === "running" || j.status === "queued" || j.status === "downloading") {
    var cnl = el("button", { class: "cvt-btn ghost", style: { padding:"2px 6px", fontSize:"11px" } }, "\u2715");
    cnl.onclick = function() {
      _api("/civitai/download-cancel", { method:"POST", body:JSON.stringify({task_id:j.id}) }).then(function() { _pollDl(); });
    };
    top.appendChild(cnl);
  }
  row.appendChild(top);

  // Sub info
  var subText = pct + "% \u00B7 " + _fmtBytes(j.downloaded || 0) + " / " + _fmtBytes(j.total || 0);
  if (j.speed_bps || j.speed) subText += " \u00B7 " + _fmtBytes(j.speed_bps || j.speed) + "/s";
  if (j.error) subText += " \u00B7 " + j.error;
  row.appendChild(el("div", { class: "sub" }, subText));

  // Progress bar
  var bar = el("div", { class: "bar" });
  bar.appendChild(el("div", { style: { width: pct + "%" } }));
  row.appendChild(bar);

  // Filepath on success
  if (j.filepath && j.status === "done") {
    row.appendChild(el("div", { class: "sub", style: { marginTop:"4px", color:"#9c9" } }, "Saved to " + j.filepath));
  }

  return row;
}

// Adaptive heartbeat: pause when tab hidden
document.addEventListener("visibilitychange", function() {
  if (!document.hidden && _activeJobs > 0 && !_dlTimer) {
    _pollDl();
  }
});

// ── 4. LOCAL MODELS ─────────────────────────────────────────────────
function renderLocal(pane, force) {
  // Loading state
  pane.innerHTML = "";
  pane.appendChild(el("div", { class: "cvt-spinner" }));
  pane.appendChild(el("div", { style: { textAlign:"center", marginTop:"8px", fontSize:"11px", color:"var(--civ-text-dim)" } }, "Scanning models folder\u2026"));

  _api("/civitai/local-models" + (force ? "?force_refresh=true" : "")).then(function(d) {
    S.local.models = d.models || [];
    _buildLocalUI(pane, d);
  }).catch(function(e) {
    pane.innerHTML = "";
    var errBox = el("div", { class: "cvt-empty", style: { padding:"30px 20px", textAlign:"center" } },
      el("div", { style: { fontSize:"16px", marginBottom:"8px" } }, "\u26A0\uFE0F"),
      el("div", { style: { fontWeight:600, marginBottom:"6px" } }, "Could not scan local models"),
      el("div", { style: { fontSize:"11px", color:"var(--civ-text-mute)" } }, e.message || "Unknown error"),
      el("button", { class: "cvt-btn ghost", style: { marginTop:"14px" } },
        el("span", { class: "emoji-btn emoji-spin-slow" }, "\u21BB"), " Retry"));
    errBox.querySelector("button").onclick = function() { renderLocal(pane); };
    pane.appendChild(errBox);
  });
}

function _buildLocalUI(pane, data) {
  pane.innerHTML = "";

  // Header
  var header = el("div", { style: { display:"flex", alignItems:"center", gap:"8px", marginBottom:"10px", paddingBottom:"8px", borderBottom:"1px solid var(--civ-line)", flexShrink:0 } });
  var totalSize = 0;
  S.local.models.forEach(function(m) {
    if (m.size) {
      var match = m.size.match(/([\d.]+)\s*(GB|MB|KB|TB)/i);
      if (match) {
        var val = parseFloat(match[1]);
        var unit = match[2].toUpperCase();
        if (unit === "KB") totalSize += val / 1024 / 1024;
        else if (unit === "MB") totalSize += val / 1024;
        else if (unit === "GB") totalSize += val;
        else if (unit === "TB") totalSize += val * 1024;
      }
    }
  });
  var sizeStr = totalSize >= 1 ? totalSize.toFixed(1) + " GB" : (totalSize * 1024).toFixed(0) + " MB";
  var count = el("span", { class: "cvt-local-count", style: { flex:"1", textAlign:"left" } },
    S.local.models.length + " model(s)" + (totalSize > 0 ? " \u00B7 \uD83D\uDCBE " + sizeStr : ""));
  count.title = "Scanned " + (data.count || S.local.models.length) + " models";
    var browseBtn = el("button", { class: "cvt-btn ghost" },
      el("span", { class: "emoji-btn emoji-float" }, "\uD83D\uDD0D"), " Browse");
  browseBtn.onclick = function() { if (S.root) S.root.dispatchEvent(new CustomEvent("civitai:show-tab", { detail: "civitai" })); };
  var refreshBtn = el("button", { class: "cvt-btn ghost" },
    el("span", { class: "emoji-btn emoji-spin-slow" }, "\u21BB"), " Refresh");
  refreshBtn.onclick = function() { renderLocal(pane, true); };
  header.appendChild(count); header.appendChild(browseBtn); header.appendChild(refreshBtn);
  pane.appendChild(header);

  // Filter row
  var filterRow = el("div", { class: "cvt-row", style: { marginBottom:"8px", flexWrap:"wrap" } });
  var filterIn = el("input", { type: "text", placeholder: "Filter models\u2026", style: { flex:"1", minWidth:"100px" } });
  filterRow.appendChild(filterIn);
  var scanBtn = el("button", { class: "cvt-btn ghost", style: { padding:"3px 8px", fontSize:"10px" } }, "\uD83D\uDD0D Scan");
  var tagBtn = el("button", { class: "cvt-btn ghost", style: { padding:"3px 8px", fontSize:"10px" } }, "\uD83C\uDFF7 Tag");
  var cleanBtn = el("button", { class: "cvt-btn ghost", style: { padding:"3px 8px", fontSize:"10px" } }, "\uD83E\uDDF9 Clean");
  var orgBtn = el("button", { class: "cvt-btn ghost", style: { padding:"3px 8px", fontSize:"10px" } }, "\uD83D\uDCC2 Org");
  filterRow.appendChild(scanBtn); filterRow.appendChild(tagBtn); filterRow.appendChild(cleanBtn); filterRow.appendChild(orgBtn);
  pane.appendChild(filterRow);
  scanBtn.onclick = function() { renderLocal(pane, true); };
  tagBtn.onclick = function() { _api("/civitai/auto-tag", { method:"POST", body:"{}" }).then(function() { _toast("Auto-tag complete"); }).catch(function(e) { _toast("Tag error: " + e.message, "error"); }); };
  cleanBtn.onclick = function() { _api("/civitai/cleanup-scan", { method:"POST" }).then(function(r) { _toast("Found " + (r.issues||[]).length + " issues"); }).catch(function(e) { _toast("Cleanup error: " + e.message, "error"); }); };
  orgBtn.onclick = function() { _api("/civitai/auto-organize", { method:"POST" }).then(function(r) { _toast("Organized " + (r.moved||0) + " files"); renderLocal(pane, true); }).catch(function(e) { _toast("Organize error: " + e.message, "error"); }); };

  // Grid container
  var grid = el("div", { class: "cvt-grid", id: "cvt-local-grid" });
  pane.appendChild(grid);

  // Empty state
  if (!S.local.models.length) {
    grid.style.display = "block";
    grid.appendChild(el("div", { class: "cvt-empty", style: { marginTop:"20px" } },
      el("div", { style: { fontSize:"32px", marginBottom:"12px" } }, "\uD83D\uDCED"),
      el("div", { style: { fontSize:"14px", fontWeight:600, marginBottom:"6px" } }, "No models found"),
      el("div", { style: { fontSize:"11px", color:"var(--civ-text-mute)", marginBottom:"16px" } },
        "Download models from the Browse or HF tabs and they'll appear here."),
      el("div", { style: { display:"flex", gap:"8px", justifyContent:"center" } },
        el("button", { class: "cvt-btn", onclick: function() { if (S.root) S.root.dispatchEvent(new CustomEvent("civitai:show-tab", { detail: "civitai" })); } },
          "\uD83D\uDD0D Browse Civitai"),
        el("button", { class: "cvt-btn ghost", onclick: function() { if (S.root) S.root.dispatchEvent(new CustomEvent("civitai:show-tab", { detail: "hf" })); } },
          "\uD83E\uDD17 Browse HuggingFace"))));
    return;
  }

  _renderLocalGrid(grid, filterIn);
  filterIn.oninput = function() { _renderLocalGrid(grid, filterIn); };
}

function _renderLocalGrid(grid, filterIn) {
  var q = (filterIn.value || "").toLowerCase();
  var filtered = S.local.models.filter(function(m) {
    return (m.name || "").toLowerCase().indexOf(q) >= 0 ||
           (m.type || "").toLowerCase().indexOf(q) >= 0 ||
           (m.base_model || "").toLowerCase().indexOf(q) >= 0;
  });
  grid.innerHTML = "";
  if (!filtered.length) {
    grid.style.display = "block";
    grid.appendChild(el("div", { class: "cvt-empty" }, "No models match your filter."));
    return;
  }
  grid.style.display = "";
  filtered.forEach(function(m) {
    grid.appendChild(_localCard(m, grid, filterIn));
  });
}

function _localCard(m, grid, filterIn) {
  var isNsfw = _matchNsfw(m, { hasPG13:true, hasR:true, hasX:true, hasXXX:true });
  var imgUrl = m.preview ? "/civitai/local-preview?path=" + encodeURIComponent(m.preview) + "&w=450" : "";
  var card = el("div", { class: "cvt-card" });
  var thumb = el("div", { class: "thumb", style: { aspectRatio: "3/4", background: "linear-gradient(135deg,#1a1a1a,#0f0f0f)", position:"relative", overflow:"hidden" } });
  if (imgUrl) {
    thumb.appendChild(el("img", { src: imgUrl, style: { width:"100%", height:"100%", objectFit:"cover", display:"block" }, onerror: function() { this.style.display = "none"; } }));
  }
  if (isNsfw && window.__nsfwBlurEnabled !== false) {
    thumb.style.filter = "blur(20px) grayscale(0.5)";
    thumb.style.willChange = "filter";
    thumb.addEventListener("mouseenter", function() { this.style.filter = "none"; });
    thumb.addEventListener("mouseleave", function() { this.style.filter = "blur(20px) grayscale(0.5)"; });
  }
  // Hover overlay for prompt info (lazy-fetched, cached globally)
  var promptOverlay = el("div", { style: { position:"absolute", bottom:"0", left:"0", right:"0", transform:"translateY(100%)", transition:"transform .2s var(--civ-ease-out)", background:"linear-gradient(transparent,rgba(0,0,0,.9))", padding:"24px 6px 6px", fontSize:"9px", lineHeight:"1.3", color:"#ddd", display:"flex", flexDirection:"column", gap:"2px", pointerEvents:"none" } });
  thumb.appendChild(promptOverlay);
  thumb.addEventListener("mouseenter", function() {
    promptOverlay.style.transform = "translateY(0)";
    var cached = _localPromptCache[m.path];
    if (cached) {
      promptOverlay.innerHTML = "";
      if (cached.prompt) promptOverlay.appendChild(el("div", { style: { overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" } }, "P: " + cached.prompt));
      if (cached.negativePrompt) promptOverlay.appendChild(el("div", { style: { overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", opacity:".7" } }, "N: " + cached.negativePrompt));
      if (!cached.prompt && !cached.negativePrompt) promptOverlay.appendChild(el("div", { style: { opacity:".5" } }, "No prompt data"));
    } else if (m.path) {
      _api("/civitai/local-previews?path=" + encodeURIComponent(m.path)).then(function(r) {
        var first = (r.images || [])[0] || {};
        _localPromptCache[m.path] = first;
        if (promptOverlay.style.transform !== "translateY(0px)") return;
        promptOverlay.innerHTML = "";
        if (first.prompt) promptOverlay.appendChild(el("div", { style: { overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" } }, "P: " + first.prompt));
        if (first.negativePrompt) promptOverlay.appendChild(el("div", { style: { overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", opacity:".7" } }, "N: " + first.negativePrompt));
        if (!first.prompt && !first.negativePrompt) promptOverlay.appendChild(el("div", { style: { opacity:".5" } }, "No prompt data"));
      }).catch(function() {});
    }
  });
  thumb.addEventListener("mouseleave", function() { promptOverlay.style.transform = "translateY(100%)"; });
  card.appendChild(thumb);

  var body = el("div", { class: "body" });
  body.appendChild(el("div", { class: "title" }, m.name || "Unknown"));

  var meta = el("div", { class: "meta" });
  meta.appendChild(el("span", {}, m.type || "?"));
  if (m.base_model) meta.appendChild(el("span", { style: { fontSize:"9px", opacity:".6" } }, m.base_model));
  if (isNsfw) meta.appendChild(el("span", { class: "cvt-badge nsfw" }, "NSFW"));
  body.appendChild(meta);
  card.appendChild(body);

  card.onclick = function() { openLocalDetail(m, grid, filterIn); };
  return card;
}

// ── 5. SETTINGS ────────────────────────────────────────────────
function renderSettings(pane) {
  var s = el("div", { class: "cvt-settings" });

  // API Keys
  s.appendChild(el("div", { class: "cvt-settings-section-title" }, "\uD83D\uDD11 API Keys"));

  var apiGroup = el("div", { class: "group" });
  var apiHeader = el("div", { class: "cvt-settings-row" });
  apiHeader.appendChild(el("span", { class: "cvt-settings-label" }, "\uD83C\uDDE8\uD83C\uDDF3 Civitai API Key"));
  var apiBadge = el("span", { class: "cvt-settings-badge" }, "not set");
  apiHeader.appendChild(apiBadge);
  apiGroup.appendChild(apiHeader);
  apiGroup.appendChild(el("div", { class: "cvt-settings-hint" }, "Required for private/gated models. Get one at civitai.com/user/account \u2192 API Keys."));
  var apiIn = el("input", { type: "password", placeholder: "Paste your Civitai API key\u2026", autocomplete: "off" });
  apiGroup.appendChild(apiIn);
  var apiBtns = el("div", { class: "cvt-settings-btns" });
  var apiSaveBtn = el("button", { class: "cvt-btn cvt-btn-xs" }, "\uD83D\uDCBE Save");
  var apiShowBtn = el("button", { class: "cvt-btn ghost cvt-btn-xs" }, "\uD83D\uDC41");
  var apiClearBtn = el("button", { class: "cvt-btn ghost cvt-btn-xs" }, "\uD83D\uDDD1");
  apiBtns.appendChild(apiSaveBtn); apiBtns.appendChild(apiShowBtn); apiBtns.appendChild(apiClearBtn);
  apiGroup.appendChild(apiBtns);
  var apiStatus = el("div", { class: "cvt-settings-status" });
  apiGroup.appendChild(apiStatus);
  s.appendChild(apiGroup);

  var hfGroup = el("div", { class: "group" });
  var hfHeader = el("div", { class: "cvt-settings-row" });
  hfHeader.appendChild(el("span", { class: "cvt-settings-label" }, "\uD83E\uDD17 Hugging Face Token"));
  var hfBadge = el("span", { class: "cvt-settings-badge" }, "not set");
  hfHeader.appendChild(hfBadge);
  hfGroup.appendChild(hfHeader);
  hfGroup.appendChild(el("div", { class: "cvt-settings-hint" }, "For private/gated repos. Get one at huggingface.co/settings/tokens"));
  var hfIn = el("input", { type: "password", placeholder: "Paste your HF token\u2026", autocomplete: "off" });
  hfGroup.appendChild(hfIn);
  var hfBtns = el("div", { class: "cvt-settings-btns" });
  var hfSaveBtn = el("button", { class: "cvt-btn cvt-btn-xs" }, "\uD83D\uDCBE Save");
  var hfShowBtn = el("button", { class: "cvt-btn ghost cvt-btn-xs" }, "\uD83D\uDC41");
  var hfClearBtn = el("button", { class: "cvt-btn ghost cvt-btn-xs" }, "\uD83D\uDDD1");
  hfBtns.appendChild(hfSaveBtn); hfBtns.appendChild(hfShowBtn); hfBtns.appendChild(hfClearBtn);
  hfGroup.appendChild(hfBtns);
  var hfStatus = el("div", { class: "cvt-settings-status" });
  hfGroup.appendChild(hfStatus);
  s.appendChild(hfGroup);

  // Preferences
  s.appendChild(el("div", { class: "cvt-settings-section-title" }, "\u2699\uFE0F Preferences"));
  var prefsGroup = el("div", { class: "group" });
  var cbMeta = el("input", { type: "checkbox" });
  var cbPrev = el("input", { type: "checkbox" });
  var cbHash = el("input", { type: "checkbox" });
  var cbNsfwBlur = el("input", { type: "checkbox" });
  cbNsfwBlur.onchange = function() { window.__nsfwBlurEnabled = cbNsfwBlur.checked; };
  var cbCompact = el("input", { type: "checkbox" });
  cbCompact.onchange = function() { if (cbCompact.checked) S.root.classList.add("compact"); else S.root.classList.remove("compact"); };
  [[cbMeta,"\uD83D\uDCC4 Save .civitai.json metadata alongside models"],
   [cbPrev,"\uD83D\uDDBC\uFE0F Save preview images alongside models"],
   [cbHash,"\uD83D\uDD10 Verify SHA256 hash after download"],
   [cbNsfwBlur,"\uD83D\uDE48 Blur NSFW content in card grid and previews"],
   [cbCompact,"\uD83D\uDCCA Compact grid mode (smaller cards, more columns)"]].forEach(function(item) {
    prefsGroup.appendChild(el("label", { class: "cvt-settings-toggle" }, item[0], el("span", {}, item[1])));
  });
  s.appendChild(prefsGroup);

  // Network
  s.appendChild(el("div", { class: "cvt-settings-section-title" }, "\uD83C\uDF10 Network"));
  var netGroup = el("div", { class: "group" });
  netGroup.appendChild(el("div", { class: "cvt-settings-row" }, el("span", { class: "cvt-settings-label" }, "Civitai API Domain"), el("span", { class: "cvt-settings-hint", style:{fontSize:"10px"} }, "Switch if main domain is blocked")));
  var baseSel = el("select");
  [{v:"civitai.com",l:"civitai.com (default)"},{v:"civitai.red",l:"civitai.red (mirror)"},{v:"civitai.work",l:"civitai.work (mirror)"}].forEach(function(b) { baseSel.appendChild(el("option", { value: b.v }, b.l)); });
  netGroup.appendChild(baseSel);
  s.appendChild(netGroup);

  // Quick Actions
  s.appendChild(el("div", { class: "cvt-settings-section-title" }, "\u26A1 Quick Actions"));
  var qaGroup = el("div", { class: "group" });
  var qaGrid = el("div", { class: "cvt-settings-actions-grid" });
  [["\uD83C\uDFF7 Auto-Tag","Tag all models with Civitai metadata",function(){_api("/civitai/auto-tag",{method:"POST",body:"{}"}).then(function(){_toast("Auto-tag complete")}).catch(function(e){_toast("Error: "+e.message,"error")})}],
   ["\uD83E\uDDF9 Cleanup","Find orphan files and invalid metadata",function(){_api("/civitai/cleanup-scan",{method:"POST"}).then(function(r){_toast("Found "+(r.issues||[]).length+" issues")}).catch(function(e){_toast("Error: "+e.message,"error")})}],
   ["\uD83D\uDCC2 Organize","Auto-sort models into subfolders",function(){_api("/civitai/auto-organize",{method:"POST"}).then(function(r){_toast("Organized "+(r.moved||0)+" files");renderLocal(pane,true)}).catch(function(e){_toast("Error: "+e.message,"error")})}],
   ["\uD83D\uDD0D Rescan","Force re-scan all model folders",function(){_api("/civitai/rescan",{method:"POST",body:JSON.stringify({force:true})}).then(function(){_toast("Rescanned")}).catch(function(e){_toast("Error: "+e.message,"error")})}]].forEach(function(a){
    var card = el("div",{class:"cvt-settings-action-card",onclick:a[2]});
    card.appendChild(el("div",{class:"cvt-settings-action-title"},a[0]));
    card.appendChild(el("div",{class:"cvt-settings-action-desc"},a[1]));
    qaGrid.appendChild(card);
  });
  qaGroup.appendChild(qaGrid);
  s.appendChild(qaGroup);

  // Bottom buttons
  var actionBar = el("div",{class:"cvt-settings-bottom"});
  var saveBtn = el("button",{class:"cvt-btn"},"\u2714\uFE0F Save All Settings");
  var testBtn = el("button",{class:"cvt-btn ghost"},"\uD83D\uDD0C Test Connection");
  var clearCacheBtn = el("button",{class:"cvt-btn ghost"},"\uD83E\uDDF9 Clear Cache");
  actionBar.appendChild(saveBtn); actionBar.appendChild(testBtn); actionBar.appendChild(clearCacheBtn);
  s.appendChild(actionBar);
  var sStatus = el("div",{class:"cvt-settings-status",style:{textAlign:"center",marginTop:"6px"}});
  s.appendChild(sStatus);
  pane.appendChild(s);

  // Load settings
  _api("/civitai/settings").then(function(cfg){
    baseSel.value = (cfg.network_choice||"com")==="com"?"civitai.com":(cfg.network_choice==="work"?"civitai.work":"civitai.red");
    cbMeta.checked = cfg.save_metadata!==false;
    cbPrev.checked = cfg.save_preview!==false;
    cbHash.checked = cfg.verify_sha256!==false;
    cbNsfwBlur.checked = cfg.nsfw_blur!==false;
    window.__nsfwBlurEnabled = cfg.nsfw_blur!==false;
    cbCompact.checked = cfg.compact_grid===true;
    if(cfg.has_api_key){apiBadge.className="cvt-settings-badge active";apiBadge.textContent="connected";}
    if(cfg.has_token){hfBadge.className="cvt-settings-badge active";hfBadge.textContent="connected";}
  }).catch(function(){});

  apiShowBtn.onclick=function(){if(apiIn.type==="password"){apiIn.type="text";apiShowBtn.textContent="\uD83D\uDE48";}else{apiIn.type="password";apiShowBtn.textContent="\uD83D\uDC41";}};
  hfShowBtn.onclick=function(){if(hfIn.type==="password"){hfIn.type="text";hfShowBtn.textContent="\uD83D\uDE48";}else{hfIn.type="password";hfShowBtn.textContent="\uD83D\uDC41";}};
  apiSaveBtn.onclick=function(){var v=apiIn.value.trim();if(!v){apiStatus.innerHTML="<span style='color:#e88'>Paste a key first.</span>";return;}apiSaveBtn.disabled=true;apiStatus.innerHTML="<span style='color:var(--civ-text-mute)'>Saving\u2026</span>";_api("/civitai/settings",{method:"POST",body:JSON.stringify({api_key:v})}).then(function(r){apiIn.value="";if(r.has_api_key){apiBadge.className="cvt-settings-badge active";apiBadge.textContent="connected";}apiStatus.innerHTML=r.has_api_key?"<span style='color:#6d6'>\u2713 API key saved</span>":"<span style='color:#cc9'>Key cleared</span>";}).catch(function(e){apiStatus.innerHTML="<span style='color:#e88'>Error: "+e.message+"</span>";}).then(function(){apiSaveBtn.disabled=false;});};
  apiClearBtn.onclick=function(){if(!confirm("Remove the saved Civitai API key?"))return;_api("/civitai/settings",{method:"POST",body:JSON.stringify({api_key:""})}).then(function(){apiIn.value="";apiBadge.className="cvt-settings-badge";apiBadge.textContent="not set";apiStatus.innerHTML="<span style='color:#cc9'>Key removed</span>";}).catch(function(e){apiStatus.innerHTML="<span style='color:#e88'>Error: "+e.message+"</span>";});};
  apiIn.onkeydown=function(e){if(e.key==="Enter")apiSaveBtn.click();};
  hfSaveBtn.onclick=function(){var v=hfIn.value.trim();if(!v){hfStatus.innerHTML="<span style='color:#e88'>Paste a token first.</span>";return;}hfSaveBtn.disabled=true;hfStatus.innerHTML="<span style='color:var(--civ-text-mute)'>Saving\u2026</span>";_api("/civitai/hf/token",{method:"POST",body:JSON.stringify({token:v})}).then(function(r){hfIn.value="";if(r.has_token){hfBadge.className="cvt-settings-badge active";hfBadge.textContent="connected";}hfStatus.innerHTML=r.has_token?"<span style='color:#6d6'>\u2713 Token saved</span>":"<span style='color:#cc9'>Token cleared</span>";}).catch(function(e){hfStatus.innerHTML="<span style='color:#e88'>Error: "+e.message+"</span>";}).then(function(){hfSaveBtn.disabled=false;});};
  hfClearBtn.onclick=function(){if(!confirm("Remove the saved HF token?"))return;_api("/civitai/hf/token",{method:"POST",body:JSON.stringify({token:""})}).then(function(){hfIn.value="";hfBadge.className="cvt-settings-badge";hfBadge.textContent="not set";hfStatus.innerHTML="<span style='color:#cc9'>Token removed</span>";}).catch(function(e){hfStatus.innerHTML="<span style='color:#e88'>Error: "+e.message+"</span>";});};
  hfIn.onkeydown=function(e){if(e.key==="Enter")hfSaveBtn.click();};
  saveBtn.onclick=function(){saveBtn.disabled=true;sStatus.innerHTML="<span style='color:var(--civ-text-mute)'>Saving\u2026</span>";var body={network_choice:baseSel.value==="civitai.red"?"red":baseSel.value==="civitai.work"?"work":"com",save_metadata:cbMeta.checked,save_preview:cbPrev.checked,verify_sha256:cbHash.checked,nsfw_blur:cbNsfwBlur.checked,compact_grid:cbCompact.checked,theme:S.root.classList.contains("light")?"light":"dark"};_api("/civitai/settings",{method:"POST",body:JSON.stringify(body)}).then(function(){sStatus.innerHTML="<span style='color:#6d6'>\u2713 All settings saved</span>";_toast("Settings saved","ok");}).catch(function(e){sStatus.innerHTML="<span style='color:#e88'>Error: "+e.message+"</span>";}).then(function(){saveBtn.disabled=false;});};
  testBtn.onclick=function(){testBtn.disabled=true;sStatus.innerHTML="<span style='color:var(--civ-text-mute)'>Testing\u2026</span>";_api("/civitai/ping").then(function(r){sStatus.innerHTML=r.has_api_key?"<span style='color:#6d6'>\u2713 Connected \u2014 API key recognised</span>":"<span style='color:#cc9'>Connected \u2014 no API key (public only)</span>";}).catch(function(e){sStatus.innerHTML="<span style='color:#e88'>\u2717 Failed: "+e.message+"</span>";}).then(function(){testBtn.disabled=false;});};
  clearCacheBtn.onclick=function(){clearCacheBtn.disabled=true;_api("/civitai/cache/clear",{method:"POST"}).then(function(r){_cache.clear();_toast("Cache cleared");sStatus.innerHTML="<span style='color:#6d6'>\u2713 Cache cleared</span>";}).catch(function(e){_toast("Clear failed: "+e.message,"error");}).then(function(){clearCacheBtn.disabled=false;});};
}

// ── 6. MOUNT ─────────────────────────────────────────────────────────
app.registerExtension({
  name: "CivitaiHF.Browser",
  setup: function() {
    (function tryMount() {
      if (app.extensionManager && app.extensionManager.registerSidebarTab) {
        app.extensionManager.registerSidebarTab({
          id: "civitai-hf",
          icon: "pi pi-globe",
          title: "Civitai+HF",
          tooltip: "Civitai & Hugging Face Downloader",
          type: "custom",
          render: function(root) {
            root.innerHTML = "";
            root.appendChild(buildUI());
          },
        });
        return true;
      }
      return false;
    })() || setTimeout(function() {
      (function tryMount() {
        if (app.extensionManager && app.extensionManager.registerSidebarTab) {
          app.extensionManager.registerSidebarTab({
            id: "civitai-hf",
            icon: "pi pi-globe",
            title: "Civitai+HF",
            tooltip: "Civitai & Hugging Face Downloader",
            type: "custom",
            render: function(root) {
              root.innerHTML = "";
              root.appendChild(buildUI());
            },
          });
          return true;
        }
        return false;
      })();
    }, 2000);
  },
});
