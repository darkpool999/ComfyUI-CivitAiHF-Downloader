import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const C = {
  tabId: "civitai-hf",
  tabTitle: "Civitai+HF",
  tabIcon: "pi pi-globe",
};

let state = {
  currentTab: "civitai",
  civitai: { models: [], page: 1, query: "", type: "", sort: "Newest", nsfw: false },
  hf: { models: [], query: "", sort: "lastModified" },
  downloads: [],
  local: { models: [], filter: "" },
  settings: { baseUrl: "https://civitai.com", saveMetadata: true, savePreview: true, computeSHA: true, bypassNSFW: false, civitaiToken: "", hfToken: "" },
  modal: null,
  lightbox: null,
};

function $id(id) { return document.getElementById(id); }

function toast(msg, type) {
  if (app.ui?.toast) app.ui.toast(msg, { type: type || "info" });
  else console.log(`[CivitAI] ${type || "info"}: ${msg}`);
}

function style() {
  const s = document.createElement("style");
  s.textContent = `
    .cvt-btn { background:#3a3a3a; color:#ddd; border:1px solid #555; padding:6px 14px; border-radius:4px; cursor:pointer; font-size:13px; }
    .cvt-btn:hover { background:#4a4a4a; }
    .cvt-btn:disabled { opacity:0.5; cursor:default; }
    .cvt-tab-btn { flex:1; padding:10px 8px; background:transparent; border:none; color:#aaa; font-size:12px; cursor:pointer; border-bottom:2px solid transparent; }
    .cvt-tab-btn.active { color:#fff; border-bottom-color:#6af; background:#2a2a2a; }
    .cvt-card { background:#2a2a2a; border-radius:8px; overflow:hidden; border:1px solid #444; cursor:pointer; transition:border-color .15s; }
    .cvt-card:hover { border-color:#6af; }
    .cvt-modal-overlay { position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.85); display:flex; align-items:center; justify-content:center; z-index:10000; }
    .cvt-modal { background:#1e1e1e; width:95%; max-width:1200px; max-height:95vh; border-radius:12px; overflow:hidden; display:flex; flex-direction:column; box-shadow:0 20px 60px rgba(0,0,0,0.6); }
    .cvt-lightbox { position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.95); z-index:10001; display:flex; align-items:center; justify-content:center; }
    .cvt-lightbox-img { max-width:90vw; max-height:90vh; object-fit:contain; border-radius:4px; }
    .cvt-lightbox-side { width:360px; background:#1e1e1e; padding:16px; overflow-y:auto; border-left:1px solid #333; height:100%; }
    .cvt-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:10px; }
    .cvt-input { padding:7px 10px; border-radius:4px; border:1px solid #555; background:#2a2a2a; color:#ddd; }
    .cvt-select { padding:7px 10px; border-radius:4px; border:1px solid #555; background:#2a2a2a; color:#ddd; }
    .cvt-progress { height:4px; background:#444; border-radius:2px; overflow:hidden; }
    .cvt-progress-bar { height:100%; background:#6af; transition:width .3s; border-radius:2px; }
    .cvt-nsfw-blur img { filter:blur(20px); transition:filter .2s; }
    .cvt-nsfw-blur img:hover { filter:none; }
    .cvt-nsfw-blur.ctrl-hover img:hover { filter:blur(20px); }
    .cvt-nsfw-blur.ctrl-hover img { filter:none; }
    .cvt-nsfw-badge { position:absolute; top:6px; right:6px; background:#c33; color:white; font-size:10px; padding:1px 6px; border-radius:3px; z-index:2; }
  `;
  document.head.appendChild(s);
}

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) Object.entries(attrs).forEach(([k, v]) => {
    if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else el.setAttribute(k, v);
  });
  children.forEach(c => { if (c != null) el.append(c); });
  return el;
}

function tabBtn(id, label, icon) {
  const btn = h("button", { class: `cvt-tab-btn ${id === "civitai" ? "active" : ""}`, "data-tab": id });
  btn.innerHTML = `${icon} ${label}`;
  return btn;
}

function buildUI() {
  const root = h("div", { style: "display:flex;flex-direction:column;height:100%;background:#1e1e1e;color:#ddd;font-family:system-ui,sans-serif;overflow:hidden;" });

  const header = h("div", { style: "padding:10px 14px;background:#2a2a2a;border-bottom:1px solid #444;display:flex;justify-content:space-between;align-items:center" });
  header.innerHTML = `<div><span style="font-size:16px;font-weight:600;">Civitai + HF</span></div>`;

  const tabs = h("div", { style: "display:flex;background:#252525;border-bottom:1px solid #444;" });
  const tabDefs = [
    ["civitai", "Civitai", "🌐"], ["huggingface", "HF", "🤗"],
    ["downloads", "Downloads", "⬇️"], ["local", "Local", "📁"],
    ["settings", "Settings", "⚙️"],
  ];
  tabDefs.forEach(([id, label, icon]) => {
    const btn = tabBtn(id, label, icon);
    btn.onclick = () => switchTab(id);
    tabs.appendChild(btn);
  });

  const content = h("div", { id: "cvt-content", style: "flex:1;overflow:auto;padding:10px;" });
  const status = h("div", { style: "padding:4px 10px;background:#252525;border-top:1px solid #444;font-size:11px;color:#888;display:flex;justify-content:space-between" });
  status.innerHTML = `<span id="cvt-status-text">Ready</span><span id="cvt-stats"></span>`;

  root.append(header, tabs, content, status);
  return root;
}

function switchTab(tabId) {
  state.currentTab = tabId;
  document.querySelectorAll(".cvt-tab-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === tabId);
  });
  const area = $id("cvt-content");
  if (!area) return;
  area.innerHTML = "";
  if (tabId === "civitai") renderCivitai(area);
  else if (tabId === "huggingface") renderHF(area);
  else if (tabId === "downloads") renderDownloads(area);
  else if (tabId === "local") renderLocal(area);
  else if (tabId === "settings") renderSettings(area);
}

// ── Civitai Browser ────────────────────────────────────────────────

function renderCivitai(area) {
  area.innerHTML = `
    <div style="margin-bottom:10px">
      <div style="display:flex;gap:6px;margin-bottom:6px">
        <input id="cvt-c-search" class="cvt-input" style="flex:1" placeholder="Search models..." value="${state.civitai.query}">
        <select id="cvt-c-sort" class="cvt-select">
          <option value="Newest" ${state.civitai.sort=="Newest"?"selected":""}>Newest</option>
          <option value="Most Downloaded" ${state.civitai.sort=="Most Downloaded"?"selected":""}>Most Downloaded</option>
          <option value="Highest Rated" ${state.civitai.sort=="Highest Rated"?"selected":""}>Highest Rated</option>
        </select>
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <label style="font-size:12px;display:flex;align-items:center;gap:4px"><input type="checkbox" id="cvt-c-nsfw" ${state.civitai.nsfw?"checked":""}> NSFW</label>
        <select id="cvt-c-type" class="cvt-select" style="width:120px">
          <option value="">All</option>
          <option value="Checkpoint">Checkpoint</option>
          <option value="LORA">LoRA</option>
          <option value="TextualInversion">Embedding</option>
          <option value="VAE">VAE</option>
        </select>
        <button id="cvt-c-srch-btn" class="cvt-btn">Search</button>
      </div>
    </div>
    <div id="cvt-c-results" class="cvt-grid"></div>
    <div style="margin-top:12px;text-align:center;display:flex;justify-content:center;align-items:center;gap:10px">
      <button id="cvt-c-prev" class="cvt-btn" ${state.civitai.page<=1?"disabled":""}>← Prev</button>
      <span style="font-size:12px;color:#888">Page ${state.civitai.page}</span>
      <button id="cvt-c-next" class="cvt-btn">Next →</button>
    </div>
  `;
  setTimeout(() => {
    $id("cvt-c-srch-btn").onclick = () => doCivitaiSearch();
    $id("cvt-c-prev").onclick = () => { if (state.civitai.page > 1) { state.civitai.page--; doCivitaiSearch(); }};
    $id("cvt-c-next").onclick = () => { state.civitai.page++; doCivitaiSearch(); };
    $id("cvt-c-search").onkeydown = e => { if (e.key === "Enter") doCivitaiSearch(); };
    if (state.civitai.models.length === 0) doCivitaiSearch();
    else renderCivitaiCards($id("cvt-c-results"));
  }, 50);
}

async function doCivitaiSearch() {
  const area = $id("cvt-c-results");
  if (!area) return;
  area.innerHTML = '<div style="padding:20px;text-align:center;color:#666">Loading...</div>';
  state.civitai.query = $id("cvt-c-search")?.value || state.civitai.query;
  state.civitai.sort = $id("cvt-c-sort")?.value || state.civitai.sort;
  state.civitai.nsfw = $id("cvt-c-nsfw")?.checked || false;
  state.civitai.type = $id("cvt-c-type")?.value || "";
  try {
    const params = new URLSearchParams({
      query: state.civitai.query, sort: state.civitai.sort,
      page: state.civitai.page, nsfw: state.civitai.nsfw,
      type: state.civitai.type,
    });
    const res = await api.fetchApi(`/civitai/search?${params}`);
    const data = await res.json();
    state.civitai.models = data.items || [];
    renderCivitaiCards(area);
    updatePagination();
  } catch (e) {
    area.innerHTML = `<div style="color:#f66;padding:20px">Error: ${e.message}</div>`;
  }
}

function renderCivitaiCards(container) {
  container.innerHTML = "";
  if (!state.civitai.models.length) {
    container.innerHTML = '<div style="padding:20px;color:#888;text-align:center">No models found</div>';
    return;
  }
  state.civitai.models.forEach(m => {
    const imgUrl = m.images?.[0]?.url || m.images?.[0]?.url || "https://via.placeholder.com/160x180";
    const card = h("div", { class: "cvt-card" });
    card.innerHTML = `
      <div style="height:160px;position:relative;overflow:hidden;background:#222">
        <img src="${imgUrl}" style="width:100%;height:100%;object-fit:cover;" loading="lazy"
             onerror="this.src='https://via.placeholder.com/160x180'">
        ${m.nsfw ? '<div class="cvt-nsfw-badge">NSFW</div>' : ""}
      </div>
      <div style="padding:8px 10px;font-size:12px">
        <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.name || "Untitled"}</div>
        <div style="color:#888;margin-top:2px">${m.type || "?"} · ${(m.downloadCount || 0).toLocaleString()} downloads</div>
      </div>
    `;
    card.onclick = () => showModelDetail(m);
    container.appendChild(card);
  });
}

function updatePagination() {
  const prev = $id("cvt-c-prev");
  const next = $id("cvt-c-next");
  if (prev) prev.disabled = state.civitai.page <= 1;
  const info = document.querySelector("#cvt-content > div:last-child span");
  if (info) info.textContent = `Page ${state.civitai.page}`;
}

// ── Model Detail Modal ──────────────────────────────────────────────

async function showModelDetail(model) {
  closeModal();
  const ov = h("div", { class: "cvt-modal-overlay" });
  const modal = h("div", { class: "cvt-modal", style: "height:90vh" });

  const header = h("div", { style: "padding:14px 20px;background:#2a2a2a;display:flex;justify-content:space-between;align-items:center;flex-shrink:0" });
  header.innerHTML = `
    <div><div style="font-size:18px;font-weight:600">${model.name || ""}</div>
    <div style="font-size:13px;color:#888">by ${model.creator?.username || "Anonymous"} · ${model.type || ""}</div></div>
    <button class="cvt-btn" id="cvt-modal-close">✕</button>
  `;

  const body = h("div", { style: "flex:1;display:flex;overflow:hidden" });

  // Gallery
  const gallery = h("div", { style: "flex:1.5;padding:14px;overflow-y:auto" });
  const imgGrid = h("div", { class: "cvt-grid", id: "cvt-mdl-imgs" });
  imgGrid.innerHTML = '<div style="padding:40px;text-align:center;color:#666">Loading images...</div>';
  gallery.appendChild(imgGrid);

  // Info panel
  const infoPanel = h("div", { style: "width:380px;padding:14px;overflow-y:auto;background:#252525;flex-shrink:0" });
  infoPanel.id = "cvt-mdl-info";
  infoPanel.innerHTML = '<div style="padding:20px;color:#888">Loading...</div>';

  body.append(gallery, infoPanel);
  modal.append(header, body);
  ov.appendChild(modal);
  state.modal = ov;
  document.body.appendChild(ov);

  $id("cvt-modal-close").onclick = closeModal;
  ov.onclick = e => { if (e.target === ov) closeModal(); };
  document.addEventListener("keydown", _modalKey);

  // Load version info
  try {
    const res = await api.fetchApi(`/civitai/model-versions?id=${model.id}`);
    const vdata = await res.json();
    const versions = vdata.items || [];
    if (versions.length > 0) {
      const v = versions[0];
      infoPanel.innerHTML = buildVersionInfo(v);
      loadVersionImages(v.id, imgGrid, model);
    } else {
      infoPanel.innerHTML = '<div style="color:#888">No versions found</div>';
    }
  } catch (e) {
    infoPanel.innerHTML = `<div style="color:#f66">Error: ${e.message}</div>`;
  }
}

function buildVersionInfo(v) {
  const files = (v.files || []).map((f, i) => `
    <div style="display:flex;justify-content:space-between;align-items:center;background:#2a2a2a;padding:6px 10px;border-radius:4px;margin-bottom:4px;font-size:12px">
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.name || `file_${i}.safetensors`}</span>
      <button class="cvt-btn dl-btn" data-url="${f.downloadUrl || ""}" data-name="${f.name || ""}" style="font-size:11px;padding:2px 8px">DL</button>
    </div>
  `).join("");

  const trainedWords = v.trainedWords?.length ? `<div style="margin:8px 0"><div style="font-size:12px;color:#aaa;margin-bottom:4px">Trigger Words:</div><div style="font-size:13px">${v.trainedWords.map(t=>`<code style="background:#333;padding:2px 6px;border-radius:3px;margin:2px">${t}</code>`).join(" ")}</div></div>` : "";

  let baseModel = "";
  if (v.model && v.model.type) baseModel = `<div style="font-size:12px;color:#888">Base: ${v.model.type}</div>`;

  return `
    <div style="font-size:14px;font-weight:600;margin-bottom:6px">${v.name || "Version"}</div>
    ${baseModel}
    ${v.description ? `<div style="font-size:12px;color:#aaa;margin:8px 0;max-height:80px;overflow-y:auto">${v.description}</div>` : ""}
    ${trainedWords}
    <div style="margin:10px 0 6px;font-size:13px;font-weight:600">Files</div>
    <div id="cvt-files">${files || "<div style='font-size:12px;color:#888'>No files</div>"}</div>
    <div style="margin-top:12px">
      <label style="font-size:12px;color:#aaa">Subfolder</label>
      <div style="display:flex;gap:6px;margin-top:4px">
        <input id="cvt-subfolder" class="cvt-input" style="flex:1" placeholder="optional">
        <label style="display:flex;align-items:center;gap:4px;font-size:12px;white-space:nowrap"><input type="checkbox" id="cvt-autofill"> Use name</label>
      </div>
      <button id="cvt-dl-all" class="cvt-btn" style="width:100%;margin-top:8px;padding:10px 0">Download All</button>
    </div>
  `;
}

async function loadVersionImages(versionId, container, model) {
  try {
    const res = await api.fetchApi(`/civitai/images?versionId=${versionId}&page=1`);
    const data = await res.json();
    const items = data.items || [];
    container.innerHTML = "";
    if (!items.length) {
      container.innerHTML = '<div style="color:#888;grid-column:1/-1;text-align:center;padding:40px">No images</div>';
      return;
    }
    items.forEach(img => {
      const wrapper = h("div", { style: "position:relative;cursor:pointer" });
      const url = img.url || img.url;
      const nsfw = img.nsfw !== false;
      wrapper.innerHTML = `<div class="${nsfw ? "cvt-nsfw-blur" : ""}"><img src="${url}" style="width:100%;height:150px;object-fit:cover;border-radius:6px" loading="lazy" onerror="this.parentElement.innerHTML='<div style=height:150px;display:flex;align-items:center;justify-content:center;color:#666>No img</div>'"></div>`;
      wrapper.onclick = () => showLightbox(img, model);
      container.appendChild(wrapper);
    });
  } catch (e) {
    container.innerHTML = `<div style="color:#f66;grid-column:1/-1;text-align:center;padding:20px">Error: ${e.message}</div>`;
  }
}

// ── Lightbox ────────────────────────────────────────────────────────

function showLightbox(img, model) {
  closeLightbox();
  const ov = h("div", { class: "cvt-lightbox" });
  const inner = h("div", { style: "display:flex;max-width:95vw;max-height:95vh;gap:0;align-items:stretch" });
  const imgEl = h("img", { class: "cvt-lightbox-img", src: img.url || img.url });
  const side = h("div", { class: "cvt-lightbox-side" });
  const meta = img.meta || {};
  let md = "<div style='font-size:14px;font-weight:600;margin-bottom:10px'>Generation Parameters</div>";
  const fields = [
    ["prompt", "Prompt"], ["negativePrompt", "Negative"],
    ["Model", "Model"], ["seed", "Seed"], ["steps", "Steps"],
    ["cfgScale", "CFG"], ["sampler", "Sampler"], ["scheduler", "Scheduler"],
    ["Size", "Size"], ["Denoising strength", "Denoising"],
  ];
  fields.forEach(([k, t]) => {
    if (meta[k]) md += `<div style="margin-bottom:6px"><span style="font-size:11px;color:#888">${t}:</span><div style="font-size:12px;word-break:break-all">${meta[k]}</div></div>`;
  });
  if (meta.civitaiResources) {
    md += "<div style='margin-top:10px;font-size:12px;color:#888'>Resources:</div>";
    meta.civitaiResources.forEach(r => {
      md += `<div style="font-size:11px;padding:2px 0">${r.modelVersionName || r.type || "?"}</div>`;
    });
  }
  side.innerHTML = md;
  inner.append(imgEl, side);
  ov.appendChild(inner);
  state.lightbox = ov;
  document.body.appendChild(ov);
  ov.onclick = e => { if (e.target === ov) closeLightbox(); };
  document.addEventListener("keydown", _lbKey);
}

function closeLightbox() {
  if (state.lightbox) { state.lightbox.remove(); state.lightbox = null; }
  document.removeEventListener("keydown", _lbKey);
}
function _lbKey(e) { if (e.key === "Escape") closeLightbox(); }
function closeModal() {
  if (state.modal) { state.modal.remove(); state.modal = null; }
  document.removeEventListener("keydown", _modalKey);
}
function _modalKey(e) { if (e.key === "Escape") closeModal(); }

// ── HF Browser ─────────────────────────────────────────────────────

function renderHF(area) {
  area.innerHTML = `
    <div style="margin-bottom:10px;display:flex;gap:6px">
      <input id="cvt-hf-search" class="cvt-input" style="flex:1" placeholder="Search Hugging Face..." value="${state.hf.query}">
      <select id="cvt-hf-sort" class="cvt-select">
        <option value="lastModified" ${state.hf.sort=="lastModified"?"selected":""}>Recent</option>
        <option value="downloads" ${state.hf.sort=="downloads"?"selected":""}>Downloads</option>
        <option value="likes" ${state.hf.sort=="likes"?"selected":""}>Likes</option>
      </select>
      <button id="cvt-hf-btn" class="cvt-btn">Search</button>
    </div>
    <div id="cvt-hf-results" class="cvt-grid"></div>
  `;
  setTimeout(() => {
    $id("cvt-hf-btn").onclick = () => doHFSearch();
    $id("cvt-hf-search").onkeydown = e => { if (e.key === "Enter") doHFSearch(); };
  }, 50);
}

async function doHFSearch() {
  const container = $id("cvt-hf-results");
  if (!container) return;
  container.innerHTML = '<div style="padding:20px;text-align:center;color:#666">Loading...</div>';
  state.hf.query = $id("cvt-hf-search")?.value || state.hf.query;
  state.hf.sort = $id("cvt-hf-sort")?.value || state.hf.sort;
  try {
    const params = new URLSearchParams({ query: state.hf.query, sort: state.hf.sort });
    const res = await api.fetchApi(`/civitai/hf-search?${params}`);
    const data = await res.json();
    state.hf.models = data.items || [];
    container.innerHTML = "";
    if (!state.hf.models.length) {
      container.innerHTML = '<div style="padding:20px;color:#888;text-align:center">No models found</div>';
      return;
    }
    state.hf.models.forEach(m => {
      const card = h("div", { class: "cvt-card" });
      card.innerHTML = `
        <div style="padding:12px">
          <div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.modelId || m.id || ""}</div>
          <div style="font-size:11px;color:#888;margin-top:4px">${(m.downloads || 0).toLocaleString()} downloads</div>
          <div style="margin-top:8px">
            <button class="cvt-btn hf-files-btn" style="font-size:11px;width:100%" data-repo="${m.modelId || m.id || ""}">Browse Files</button>
          </div>
        </div>
      `;
      card.querySelector(".hf-files-btn").onclick = e => {
        e.stopPropagation();
        showHFFiles(m.modelId || m.id || "");
      };
      container.appendChild(card);
    });
  } catch (e) {
    container.innerHTML = `<div style="color:#f66;padding:20px">Error: ${e.message}</div>`;
  }
}

async function showHFFiles(repoId) {
  const ov = h("div", { class: "cvt-modal-overlay" });
  const modal = h("div", { class: "cvt-modal", style: "height:70vh;width:70vw" });
  modal.innerHTML = `
    <div style="padding:12px 16px;background:#2a2a2a;display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
      <span style="font-weight:600;font-size:14px">${repoId}</span>
      <button class="cvt-btn" id="cvt-hf-close">✕</button>
    </div>
    <div id="cvt-hf-files" style="flex:1;overflow:auto;padding:12px;font-size:13px"></div>
  `;
  ov.appendChild(modal);
  document.body.appendChild(ov);
  $id("cvt-hf-close").onclick = () => ov.remove();
  ov.onclick = e => { if (e.target === ov) ov.remove(); };

  const list = $id("cvt-hf-files");
  list.innerHTML = '<div style="padding:20px;color:#888">Loading...</div>';
  try {
    const res = await api.fetchApi(`/civitai/hf-files?repo_id=${encodeURIComponent(repoId)}`);
    const files = await res.json();
    list.innerHTML = "";
    if (!Array.isArray(files) || !files.length) {
      list.innerHTML = '<div style="color:#888">No files found</div>';
      return;
    }
    const table = h("table", { style: "width:100%;border-collapse:collapse" });
    files.forEach(f => {
      if (f.type === "directory") {
        table.innerHTML += `<tr><td style="padding:6px 8px;border-bottom:1px solid #333">📁 ${f.path}</td><td style="padding:6px 8px;border-bottom:1px solid #333;color:#888">dir</td><td></td></tr>`;
      } else {
        const size = f.size ? (f.size / 1e6).toFixed(1) + " MB" : "";
        table.innerHTML += `<tr><td style="padding:6px 8px;border-bottom:1px solid #333">📄 ${f.path}</td><td style="padding:6px 8px;border-bottom:1px solid #333;color:#888">${size}</td><td style="padding:6px 8px"><button class="cvt-btn" style="font-size:11px" onclick="alert('HF download not yet implemented')">DL</button></td></tr>`;
      }
    });
    list.appendChild(table);
  } catch (e) {
    list.innerHTML = `<div style="color:#f66">Error: ${e.message}</div>`;
  }
}

// ── Downloads Queue ─────────────────────────────────────────────────

let dlPollInterval = null;

function renderDownloads(area) {
  area.innerHTML = `
    <div style="margin-bottom:10px;font-weight:600;font-size:14px">Downloads Queue</div>
    <div id="cvt-dl-list"></div>
  `;
  pollDownloads();
}

async function pollDownloads() {
  const list = $id("cvt-dl-list");
  if (!list) { if (dlPollInterval) clearInterval(dlPollInterval); return; }
  try {
    const res = await api.fetchApi("/civitai/downloads");
    const data = await res.json();
    state.downloads = data.items || [];
    list.innerHTML = "";
    if (!state.downloads.length) {
      list.innerHTML = '<div style="color:#888;padding:20px;text-align:center">No downloads</div>';
      return;
    }
    state.downloads.forEach(dl => {
      const div = h("div", { style: "background:#2a2a2a;border-radius:6px;padding:10px;margin-bottom:8px;font-size:12px" });
      const speed = dl.speed ? `${(dl.speed / 1e6).toFixed(1)} MB/s` : "";
      const progress = dl.progress || 0;
      const statusColor = dl.status === "completed" ? "#4a4" : dl.status === "error" ? "#f44" : "#6af";
      div.innerHTML = `
        <div style="display:flex;justify-content:space-between;margin-bottom:6px">
          <span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${dl.filename}</span>
          <span style="color:${statusColor}">${dl.status}</span>
        </div>
        <div class="cvt-progress"><div class="cvt-progress-bar" style="width:${progress}%"></div></div>
        <div style="display:flex;justify-content:space-between;margin-top:4px;color:#888;font-size:11px">
          <span>${progress}% ${speed ? "· " + speed : ""}</span>
          ${dl.status === "downloading" ? `<button class="cvt-btn cancel-dl" data-task="${dl.id}" style="font-size:10px;padding:2px 8px">Cancel</button>` : ""}
        </div>
      `;
      const cancelBtn = div.querySelector(".cancel-dl");
      if (cancelBtn) {
        cancelBtn.onclick = async () => {
          await api.fetchApi("/civitai/download-cancel", { method: "POST", body: JSON.stringify({ task_id: dl.id }) });
        };
      }
      list.appendChild(div);
    });
  } catch (e) {
    // silent
  }
  if (!dlPollInterval) dlPollInterval = setInterval(pollDownloads, 1500);
}

// ── Local Models Manager ────────────────────────────────────────────

function renderLocal(area) {
  area.innerHTML = `
    <div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">
      <input id="cvt-local-filter" class="cvt-input" style="flex:1;min-width:120px" placeholder="Filter...">
      <button id="cvt-local-scan" class="cvt-btn">🔍 Scan All</button>
      <button id="cvt-local-tag" class="cvt-btn">🏷 Auto-Tag</button>
      <button id="cvt-local-clean" class="cvt-btn">🧹 Cleanup</button>
      <button id="cvt-local-org" class="cvt-btn">📂 Organize</button>
      <button id="cvt-local-export" class="cvt-btn">📋 Export</button>
    </div>
    <div id="cvt-local-list" style="font-size:12px"><div style="padding:20px;color:#888;text-align:center">Click "Scan All" to list models</div></div>
  `;
  setTimeout(() => {
    $id("cvt-local-scan").onclick = () => scanLocal();
    $id("cvt-local-tag").onclick = () => doAutoTag();
    $id("cvt-local-clean").onclick = () => doCleanup();
    $id("cvt-local-org").onclick = () => doOrganize();
    $id("cvt-local-export").onclick = () => doExport();
    $id("cvt-local-filter").oninput = () => renderLocalList();
    if (state.local.models.length) renderLocalList();
  }, 50);
}

async function scanLocal() {
  const btn = $id("cvt-local-scan");
  if (btn) btn.textContent = "Scanning...";
  try {
    const res = await api.fetchApi("/civitai/local-models?force_refresh=true");
    const data = await res.json();
    state.local.models = data.models || [];
    renderLocalList();
    toast(`Found ${state.local.models.length} models`);
  } catch (e) {
    toast("Scan failed: " + e.message, "error");
  }
  if (btn) btn.textContent = "🔍 Scan All";
}

function renderLocalList() {
  const list = $id("cvt-local-list");
  if (!list) return;
  const filter = ($id("cvt-local-filter")?.value || "").toLowerCase();
  const filtered = state.local.models.filter(m =>
    m.name?.toLowerCase().includes(filter) || m.type?.includes(filter)
  );
  list.innerHTML = "";
  if (!filtered.length) {
    list.innerHTML = '<div style="padding:20px;color:#888;text-align:center">No models found</div>';
    return;
  }
  const table = h("table", { style: "width:100%;border-collapse:collapse;font-size:12px" });
  table.innerHTML = `<thead><tr style="background:#333;color:#aaa">
    <th style="padding:6px 8px;text-align:left">Name</th>
    <th style="padding:6px 8px;text-align:left">Type</th>
    <th style="padding:6px 8px;text-align:right">Size</th>
    <th style="padding:6px 8px">Civitai</th>
    <th style="padding:6px 8px"></th>
  </tr></thead><tbody></tbody>`;
  const tbody = table.querySelector("tbody");
  filtered.slice(0, 200).forEach(m => {
    const tr = h("tr", { style: "border-bottom:1px solid #333" });
    tr.innerHTML = `
      <td style="padding:6px 8px">${m.name || ""}</td>
      <td style="padding:6px 8px;color:#888">${m.type || ""}</td>
      <td style="padding:6px 8px;color:#888;text-align:right">${m.size || ""}</td>
      <td style="padding:6px 8px;text-align:center">${m.hasCivitai ? "✓" : "—"}</td>
      <td style="padding:6px 8px"><button class="cvt-btn del-model" style="font-size:10px;padding:2px 8px;color:#f66" data-path="${m.path || ""}">🗑</button></td>
    `;
    tr.querySelector(".del-model").onclick = async e => {
      e.stopPropagation();
      if (!confirm(`Delete ${m.name}?`)) return;
      try {
        await api.fetchApi("/civitai/delete-model", {
          method: "POST",
          body: JSON.stringify({ path: m.path }),
        });
        state.local.models = state.local.models.filter(x => x.path !== m.path);
        renderLocalList();
        toast("Deleted");
      } catch (e) {
        toast("Delete failed", "error");
      }
    };
    tbody.appendChild(tr);
  });
  list.appendChild(table);
}

async function doAutoTag() {
  const btn = $id("cvt-local-tag");
  if (btn) btn.textContent = "Tagging...";
  try {
    const res = await api.fetchApi("/civitai/auto-tag", {
      method: "POST", body: JSON.stringify({}),
    });
    const data = await res.json();
    toast(`Tagged ${data.tagged} models`);
  } catch (e) {
    toast("Auto-Tag failed", "error");
  }
  if (btn) btn.textContent = "🏷 Auto-Tag";
}

async function doCleanup() {
  try {
    const res = await api.fetchApi("/civitai/cleanup-scan", { method: "POST" });
    const data = await res.json();
    if (data.issues?.length) {
      toast(`Found ${data.issues.length} issues`);
      const paths = data.issues.map(i => i.path);
      if (confirm(`Delete ${paths.length} orphan/corrupt files?`)) {
        await api.fetchApi("/civitai/cleanup-delete", {
          method: "POST", body: JSON.stringify({ paths }),
        });
        toast(`Cleaned ${paths.length} files`);
      }
    } else {
      toast("No issues found");
    }
  } catch (e) {
    toast("Cleanup failed", "error");
  }
}

async function doOrganize() {
  try {
    const res = await api.fetchApi("/civitai/auto-organize", { method: "POST" });
    const data = await res.json();
    toast(`Organized ${data.moved} files`);
    if (data.moved > 0) scanLocal();
  } catch (e) {
    toast("Organize failed", "error");
  }
}

async function doExport() {
  try {
    const res = await api.fetchApi("/civitai/export-list");
    const data = await res.json();
    if (data.text) {
      await navigator.clipboard.writeText(data.text);
      toast(`Copied ${data.count} paths to clipboard`);
    }
  } catch (e) {
    toast("Export failed", "error");
  }
}

// ── Settings ────────────────────────────────────────────────────────

async function renderSettings(area) {
  area.innerHTML = `
    <div style="padding:4px 0 16px">
      <h3 style="margin:0 0 16px 4px;font-size:16px">Advanced Settings</h3>

      <div style="margin-bottom:18px">
        <div style="font-weight:600;margin-bottom:8px;color:#aaa">Status Dashboard</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button id="cvt-test-civ" class="cvt-btn">Test Civitai</button>
          <button id="cvt-test-hf" class="cvt-btn">Test HF</button>
          <button id="cvt-clr-cache" class="cvt-btn">Clear Cache</button>
        </div>
        <div id="cvt-st-result" style="margin-top:8px;font-size:13px;color:#888"></div>
      </div>

      <div style="margin-bottom:18px">
        <div style="font-weight:600;margin-bottom:8px;color:#aaa">API Keys</div>
        <div style="margin-bottom:10px">
          <label style="font-size:12px;color:#999;display:block;margin-bottom:3px">Civitai Token</label>
          <div style="display:flex;gap:6px">
            <input id="cvt-civ-key" class="cvt-input" type="password" style="flex:1" placeholder="civitai_..." value="${state.settings.civitaiToken ? "••••••" : ""}">
            <button id="cvt-save-civ-key" class="cvt-btn">Save</button>
          </div>
        </div>
        <div>
          <label style="font-size:12px;color:#999;display:block;margin-bottom:3px">Hugging Face Token</label>
          <div style="display:flex;gap:6px">
            <input id="cvt-hf-key" class="cvt-input" type="password" style="flex:1" placeholder="hf_..." value="${state.settings.hfToken ? "••••••" : ""}">
            <button id="cvt-save-hf-key" class="cvt-btn">Save</button>
          </div>
        </div>
      </div>

      <div style="margin-bottom:18px">
        <div style="font-weight:600;margin-bottom:8px;color:#aaa">Defaults</div>
        <div style="margin-bottom:8px">
          <label style="font-size:12px;color:#999;display:block;margin-bottom:3px">Base URL</label>
          <select id="cvt-base-url" class="cvt-select" style="width:100%">
            <option value="com" ${state.settings.baseUrl.includes("civitai.com") ? "selected" : ""}>civitai.com</option>
            <option value="work" ${state.settings.baseUrl.includes("civitai.work") ? "selected" : ""}>civitai.work</option>
          </select>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:10px;font-size:12px">
          <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="cvt-savemetadata"> Save .civitai.json</label>
          <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="cvt-savepreview"> Save preview</label>
          <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="cvt-computesha"> Compute SHA</label>
        </div>
      </div>

      <div>
        <div style="font-weight:600;margin-bottom:8px;color:#aaa">Quick Actions</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          <button id="cvt-qa-tag" class="cvt-btn">🏷 Auto-Tag All</button>
          <button id="cvt-qa-clean" class="cvt-btn">🧹 Smart Cleanup</button>
          <button id="cvt-qa-org" class="cvt-btn">📂 Auto-Organize</button>
          <button id="cvt-qa-export" class="cvt-btn">📋 Export List</button>
          <button id="cvt-qa-rescan" class="cvt-btn">🔍 Rescan</button>
        </div>
      </div>
    </div>
  `;

  const sr = () => $id("cvt-st-result");
  $id("cvt-test-civ").onclick = async () => {
    sr().innerHTML = "Testing...";
    try {
      const r = await api.fetchApi("/civitai/test");
      const d = await r.json();
      sr().innerHTML = d.success ? `<span style="color:#4a4">✓ Civitai API OK (${d.latency}ms)</span>` : `<span style="color:#f44">✗ Failed</span>`;
    } catch (e) { sr().innerHTML = `<span style="color:#f44">✗ ${e.message}</span>`; }
  };
  $id("cvt-test-hf").onclick = async () => {
    sr().innerHTML = "Testing...";
    try {
      const r = await api.fetchApi("/civitai/test-hf");
      const d = await r.json();
      sr().innerHTML = d.success ? `<span style="color:#4a4">✓ HF API OK (${d.latency}ms)</span>` : `<span style="color:#f44">✗ Failed</span>`;
    } catch (e) { sr().innerHTML = `<span style="color:#f44">✗ ${e.message}</span>`; }
  };
  $id("cvt-clr-cache").onclick = async () => {
    await api.fetchApi("/civitai/clear-cache", { method: "POST", body: "{}" });
    sr().innerHTML = "Cache cleared";
  };

  $id("cvt-save-civ-key").onclick = async () => {
    const val = $id("cvt-civ-key").value;
    await api.fetchApi("/civitai/settings", { method: "POST", body: JSON.stringify({ civitai_api_key: val }) });
    toast("Civitai token saved");
  };
  $id("cvt-save-hf-key").onclick = async () => {
    const val = $id("cvt-hf-key").value;
    await api.fetchApi("/civitai/settings", { method: "POST", body: JSON.stringify({ hf_token: val }) });
    toast("HF token saved");
  };

  $id("cvt-base-url").onchange = async () => {
    await api.fetchApi("/civitai/settings", { method: "POST", body: JSON.stringify({ network_choice: $id("cvt-base-url").value }) });
    toast("Base URL updated");
  };

  ["cvt-savemetadata", "cvt-savepreview", "cvt-computesha"].forEach(id => {
    const el = $id(id);
    if (el) el.onchange = () => saveSettingsCheckbox();
  });

  $id("cvt-qa-tag").onclick = doAutoTag;
  $id("cvt-qa-clean").onclick = doCleanup;
  $id("cvt-qa-org").onclick = doOrganize;
  $id("cvt-qa-export").onclick = doExport;
  $id("cvt-qa-rescan").onclick = scanLocal;
}

async function saveSettingsCheckbox() {
  try {
    await api.fetchApi("/civitai/settings", {
      method: "POST",
      body: JSON.stringify({
        save_metadata: $id("cvt-savemetadata")?.checked || false,
        save_preview: $id("cvt-savepreview")?.checked || false,
        compute_sha: $id("cvt-computesha")?.checked || false,
      }),
    });
  } catch (e) { /* silent */ }
}

async function loadSettings() {
  try {
    const res = await api.fetchApi("/civitai/settings");
    const data = await res.json();
    state.settings.baseUrl = data.baseUrl || state.settings.baseUrl;
    state.settings.saveMetadata = data.saveMetadata ?? true;
    state.settings.savePreview = data.savePreview ?? true;
    state.settings.computeSHA = data.computeSHA ?? true;
    state.settings.civitaiToken = data.civitaiToken || false;
    state.settings.hfToken = data.hfToken || false;
  } catch (e) { /* silent */ }
}

// ── Floating Button ─────────────────────────────────────────────────

function mountFloatingButton() {
  if (document.getElementById("cvt-floating-btn")) return;
  const btn = h("div", { id: "cvt-floating-btn" });
  btn.style.cssText = "position:fixed;bottom:20px;right:20px;background:#3a3a3a;color:#fff;padding:10px 16px;border-radius:50px;box-shadow:0 4px 20px rgba(0,0,0,0.4);cursor:pointer;z-index:9999;display:flex;align-items:center;gap:8px;font-size:13px;";
  btn.innerHTML = "🌐 Civitai+HF";
  btn.onclick = () => {
    if (app.extensionManager?.openSidebarTab) app.extensionManager.openSidebarTab(C.tabId);
  };
  document.body.appendChild(btn);
}

// ── Init ────────────────────────────────────────────────────────────

function init() {
  style();
  loadSettings();

  const register = () => {
    if (!app.extensionManager?.registerSidebarTab) return false;
    app.extensionManager.registerSidebarTab({
      id: C.tabId, icon: C.tabIcon, title: C.tabTitle,
      tooltip: "Civitai & Hugging Face Downloader",
      type: "custom",
      render: (root) => {
        root.innerHTML = "";
        root.appendChild(buildUI());
      },
    });
    return true;
  };

  if (register()) mountFloatingButton();
  else setTimeout(() => { if (register()) mountFloatingButton(); }, 2000);
  setTimeout(mountFloatingButton, 3000);
}

init();

// Allow download buttons to work via delegation
document.addEventListener("click", async e => {
  const btn = e.target.closest(".dl-btn");
  if (!btn) return;
  const url = btn.dataset.url;
  const name = btn.dataset.name;
  const subfolder = $id("cvt-subfolder")?.value || "";
  const autofill = $id("cvt-autofill")?.checked;
  if (autofill && !subfolder) {
    const sf = $id("cvt-subfolder");
    if (sf) sf.value = name.replace(/\.\w+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_");
  }
  if (!url) { toast("No download URL", "error"); return; }
  toast(`Starting download: ${name}`);
  try {
    await api.fetchApi("/civitai/download", {
      method: "POST",
      body: JSON.stringify({ url, filename: name, subfolder: $id("cvt-subfolder")?.value || "" }),
    });
  } catch (e) {
    toast("Download failed", "error");
  }
});

document.addEventListener("click", e => {
  const close = e.target.closest("#cvt-dl-all");
  if (!close) return;
  const files = document.querySelectorAll(".dl-btn");
  files.forEach(f => f.click());
});
