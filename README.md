# ComfyUI CivitAI + Hugging Face Downloader

<p align="center">
  <strong>Browse, search, preview, and download models from Civitai and Hugging Face — directly inside ComfyUI.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/ComfyUI-Extension-blue?logo=data:image/svg+xml;base64,..." alt="ComfyUI">
  <img src="https://img.shields.io/badge/Python-3.8+-green?logo=python" alt="Python">
  <img src="https://img.shields.io/badge/License-GPL--3.0-yellow" alt="GPL-3.0">
</p>

---

## ✨ Features

### 🔍 Browse & Search
- **Civitai** — Search by query, model type, sort order, time period, base model, and NSFW rating
- **Hugging Face** — Search by pipeline tag, library, author, and sort order
- **Lookup** — Resolve any Civitai URL, model ID, version ID, or SHA256 hash
- **Cursor pagination** — Browse through results with next/previous navigation

### 📥 Downloads
- **One-click download** with configurable folder, subfolder, and filename
- **Real-time progress** — speed, percentage, downloaded/total size
- **SHA256 hash always saved** — every downloaded model gets its hash stored in `.civitai.json`
- **Metadata & preview images** — optionally save alongside models
- **Batch downloads** from both Civitai and Hugging Face

### 📂 Local Model Manager
- **Auto-scan** all 29 ComfyUI model folder types
- **Card grid** with preview images, model type, base model, and size
- **Detail modal** — gallery, Civitai lookup, tags, description, copy path, delete
- **Disk usage display** — total model count and storage size in header
- **Filter** by name, type, or base model

### ⚡ Prompt Fetcher Node
- **Single ComfyUI graph node** with two outputs: `positive_prompt` and `negative_prompt`
- **⚡ Use in workflow** button in the lightbox sends prompts directly to the node
- Add the node to your workflow → click Use in workflow → run

### 🎨 UI/UX
- **Dark & Light themes** — toggle via ☀️/🌙 button in the top-right corner
- **Keyboard navigation** — `/` search, `←→↑↓` navigate cards, `Enter` opens, `Esc` closes, `1-5` switch tabs, `?` shows all shortcuts
- **Compact grid mode** — toggle via Settings or `Ctrl+C` for denser card layout
- **Comprehensive animations** — staggered card entrances, shimmer hover effects, spring physics, smooth transitions throughout
- **NSFW blur** — blurred previews with hover-to-reveal
- **Responsive** — adapts to narrow sidebar widths

### ⚙️ Settings
- **API Keys** — Civitai API key and Hugging Face token with status badges (● connected / ● not set)
- **Preferences** — save metadata, save previews, verify SHA256, NSFW blur, compact grid
- **Network** — switch between `civitai.com`, `civitai.red`, `civitai.work` domains
- **Quick Actions** — Auto-Tag, Cleanup, Organize, Rescan with one-click cards

---

## 📦 Installation

1. Navigate to your ComfyUI `custom_nodes` directory:
   ```bash
   cd ComfyUI/custom_nodes
   ```

2. Clone this repository:
   ```bash
   git clone https://github.com/darkpool999/ComfyUI-CivitAiHF-Downloader.git
   ```

3. Install Python dependencies:
   ```bash
   pip install -r ComfyUI-CivitAiHF-Downloader/requirements.txt
   ```

4. Restart ComfyUI

> **Note:** The extension registers a **CivitAI+HF** tab in the ComfyUI sidebar. No additional configuration is needed — it works out of the box for public models.

---

## 🚀 Quick Start

1. Open the **CivitAI** tab in the ComfyUI sidebar
2. Type a search query (or leave empty for top models)
3. Select filters: model type, sort order, time period, base model, NSFW rating
4. Click **Search** (or press `Enter`)
5. Click any model card → select version → click **Download**
6. Switch to the **Local** tab to see your downloaded models

### Using the Prompt Fetcher

1. Add the **Prompt Fetcher** node to your ComfyUI workflow
2. Connect `positive_prompt` → your positive CLIP text encoder
3. Connect `negative_prompt` → your negative CLIP text encoder
4. Browse models → open a preview image → click **⚡ Use in workflow**
5. Run your workflow — the node outputs the stored prompts

---

## ⌨️ Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `/` | Focus search bar |
| `←` `→` `↑` `↓` | Navigate between cards |
| `Enter` | Open model detail |
| `Esc` | Close modal / lightbox |
| `1` `2` `3` `4` `5` | Switch tabs |
| `Ctrl+C` | Toggle compact grid |
| `?` | Show shortcuts help |

---

## 🗂 Supported Model Folders

All 29 ComfyUI model folder types are supported:

```
audio_encoders    clip_vision       diffusers           geometry_estimation    loras            style_models     vae
background_removal configs          diffusion_models    gligen                 model_patches    text_encoders    vae_approx
checkpoints       controlnet        embeddings          hypernetworks          optical_flow     unet
clip              detection         frame_interpolation latent_upscale_models  photomaker       upscale_models
```

---

## 📁 Project Structure

| File | Purpose |
|------|---------|
| `__init__.py` | Extension entry point, registers sidebar tab |
| `nodes.py` | **Prompt Fetcher** graph node |
| `nodes_display.py` | Markdown Presenter node |
| `server.py` | All API endpoints (search, download, local management, settings, prompt fetcher) |
| `utils.py` | Database manager, Civitai/HF API utilities, hash computation, model scanning |
| `js/civitai.js` | Full sidebar UI (tabs, modals, lightbox, downloads, settings, keyboard nav, animations) |
| `js/civitai.css` | Dark/Light theme with animations, glassmorphism, responsive layout |

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/civitai/search` | Search Civitai models |
| `GET` | `/civitai/lookup` | Lookup by hash, URL, or ID |
| `GET` | `/civitai/model/{id}` | Fetch full model data |
| `POST` | `/civitai/download` | Start a download |
| `GET` | `/civitai/downloads` | List active/completed downloads |
| `POST` | `/civitai/download-cancel` | Cancel a download |
| `GET` | `/civitai/local-models` | List locally downloaded models |
| `GET` | `/civitai/local-previews` | Get preview images for a model |
| `GET` | `/civitai/local-preview` | Serve a resized preview image |
| `POST` | `/civitai/delete-model` | Delete a local model |
| `GET` | `/civitai/hf-search` | Search Hugging Face models |
| `GET` | `/civitai/hf-files` | List files in a HF repo |
| `POST` | `/civitai/hf/download` | Download from Hugging Face |
| `POST` | `/civitai/prompt-fetcher` | Send prompts to Prompt Fetcher node |
| `GET` | `/civitai/prompt-fetcher` | Get current stored prompts |
| `GET` | `/civitai/settings` | Load settings |
| `POST` | `/civitai/settings` | Save settings |
| `POST` | `/civitai/auto-tag` | Tag models with Civitai metadata |
| `POST` | `/civitai/cleanup-scan` | Find orphan files |
| `POST` | `/civitai/auto-organize` | Sort models into subfolders |
| `POST` | `/civitai/rescan` | Force re-scan model folders |
| `GET` | `/civitai/ping` | Test API connection |

---

## 📄 License

GPL-3.0 — see [LICENSE](LICENSE) for details.
