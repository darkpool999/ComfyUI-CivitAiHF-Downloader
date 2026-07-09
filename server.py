import asyncio
import json
import os
import time
import re
import urllib.request
import urllib.parse
import hashlib
from datetime import datetime
import requests
import folder_paths
from aiohttp import web
from server import PromptServer

from . import utils

routes = PromptServer.instance.routes


# ── Civitai Search / Browse ────────────────────────────────────────────

@routes.get("/civitai/search")
async def search_civitai(request):
    try:
        query = request.query.get("query", "")
        model_type = request.query.get("types", "") or request.query.get("type", "")
        sort = request.query.get("sort", "Highest Rated")
        page = int(request.query.get("page", 1))
        nsfw = request.query.get("nsfw", "false")
        limit = int(request.query.get("limit", 20))
        period = request.query.get("period", "")
        base_models = request.query.get("baseModels", "")
        username = request.query.get("username", "")
        tag = request.query.get("tag", "")
        cursor = request.query.get("cursor", "")
        domain = utils._get_active_domain()

        params = {"limit": min(limit, 100)}

        if query:
            params["query"] = query
        if cursor:
            params["cursor"] = cursor
        elif not query and not cursor:
            params["page"] = page
        if model_type and model_type.lower() != "any":
            params["types"] = model_type
        if nsfw:
            params["nsfw"] = nsfw
        if sort and sort.lower() != "relevancy":
            params["sort"] = sort
        if period:
            params["period"] = period
        if base_models:
            params["baseModels"] = [b.strip() for b in base_models.split(",") if b.strip()]
        if username:
            params["username"] = username
        if tag:
            params["tag"] = tag

        resp = utils.CivitaiAPIUtils._request_with_retry(
            f"https://{domain}/api/v1/models", params=params
        )
        data = resp.json()
        return web.json_response(data)
    except Exception as e:
        return web.json_response({"items": [], "total": 0, "error": str(e)})


@routes.get("/civitai/lookup")
async def lookup_civitai(request):
    try:
        hash_val = request.query.get("hash", "")
        version_id = request.query.get("version_id", "")
        model_id = request.query.get("model_id", "")
        model_input = request.query.get("model", "")
        domain = utils._get_active_domain()

        if hash_val:
            info = utils.CivitaiAPIUtils.get_model_version_info_by_hash(hash_val.strip())
            if not info:
                return web.json_response({"error": "Not found on Civitai"}, status=404)
            return web.json_response({"kind": "version", "data": info})

        if version_id:
            info = utils.CivitaiAPIUtils.get_model_version_info_by_id(int(version_id), domain)
            if not info:
                return web.json_response({"error": "Not found on Civitai"}, status=404)
            return web.json_response({"kind": "version", "data": info})

        if model_id:
            info = utils.CivitaiAPIUtils.get_model_info_by_id(int(model_id), domain)
            if not info:
                return web.json_response({"error": "Not found on Civitai"}, status=404)
            return web.json_response({"kind": "model", "data": info})

        if model_input:
            parsed = utils.parse_civitai_input(model_input.strip())
            if parsed.get("version_id"):
                info = utils.CivitaiAPIUtils.get_model_version_info_by_id(parsed["version_id"], domain)
                if info:
                    return web.json_response({"kind": "version", "data": info})
            if parsed.get("model_id"):
                info = utils.CivitaiAPIUtils.get_model_info_by_id(parsed["model_id"], domain)
                if info:
                    return web.json_response({"kind": "model", "data": info})
            return web.json_response({"error": "Could not parse the input or not found"}, status=400)

        return web.json_response({"error": "Provide one of: hash, version_id, model_id, model"}, status=400)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@routes.get("/civitai/model-detail")
async def model_detail(request):
    try:
        model_id = request.query.get("id")
        if not model_id:
            return web.json_response({"error": "Missing id"}, status=400)
        domain = utils._get_active_domain()
        data = utils.CivitaiAPIUtils.get_model_info_by_id(int(model_id), domain)
        return web.json_response(data or {})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@routes.get("/civitai/model/{model_id}")
async def model_by_id(request):
    try:
        model_id = request.match_info.get("model_id")
        if not model_id:
            return web.json_response({"error": "Missing model_id"}, status=400)
        domain = utils._get_active_domain()
        data = utils.CivitaiAPIUtils.get_model_info_by_id(int(model_id), domain)
        return web.json_response(data or {})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@routes.get("/civitai/local-preview")
async def local_preview(request):
    try:
        path = request.query.get("path", "")
        w = request.query.get("w", "")
        if not path or ".." in path:
            return web.Response(status=400, text="Invalid path")
        if not os.path.isabs(path):
            path = os.path.join(folder_paths.models_dir, path)
        if not os.path.isfile(path):
            return web.Response(status=404, text="Not found")
        ext = os.path.splitext(path)[1].lower()
        ct = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
              ".webp": "image/webp", ".gif": "image/gif"}.get(ext, "image/png")
        # Resize if w param provided and PIL available
        if w and w.isdigit():
            try:
                from PIL import Image
                import io
                max_w = int(w)
                loop = asyncio.get_event_loop()
                img_bytes = await loop.run_in_executor(None, _resize_preview, path, max_w, ext)
                return web.Response(body=img_bytes, content_type=ct,
                                    headers={"Cache-Control": "public, max-age=86400"})
            except Exception:
                pass  # fall through to full file
        # Check file mtime for conditional requests
        mtime = os.path.getmtime(path)
        ims = request.headers.get("If-Modified-Since")
        if ims:
            try:
                dt = datetime.strptime(ims, "%a, %d %b %Y %H:%M:%S %Z")
                if mtime <= dt.timestamp():
                    return web.Response(status=304)
            except Exception:
                pass
        return web.FileResponse(
            path,
            headers={
                "Cache-Control": "public, max-age=86400",
                "Last-Modified": datetime.utcfromtimestamp(mtime).strftime("%a, %d %b %Y %H:%M:%S GMT"),
            }
        )
    except Exception as e:
        return web.Response(status=500, text=str(e))


_preview_cache_dir = os.path.join(os.path.dirname(__file__), ".preview_cache")
os.makedirs(_preview_cache_dir, exist_ok=True)

def _resize_preview(path, max_w, ext):
    from PIL import Image
    import io
    import hashlib as _hl

    # Disk cache: skip resize if cached version exists and is newer
    cache_key = _hl.md5(f"{path}:{max_w}".encode()).hexdigest()
    cache_ext = ".webp" if ext != ".png" else ".png"
    cache_path = os.path.join(_preview_cache_dir, cache_key + cache_ext)
    try:
        src_mtime = os.path.getmtime(path)
        if os.path.isfile(cache_path) and os.path.getmtime(cache_path) >= src_mtime:
            with open(cache_path, "rb") as f:
                return f.read()
    except Exception:
        pass

    img = Image.open(path)
    img.load()
    if img.width > max_w:
        ratio = max_w / img.width
        new_h = int(img.height * ratio)
        img = img.resize((max_w, new_h), Image.LANCZOS)
    out = io.BytesIO()
    if ext == ".png":
        img.save(out, format="PNG")
    else:
        img.save(out, format="WEBP", quality=80)
    data = out.getvalue()

    try:
        with open(cache_path, "wb") as f:
            f.write(data)
    except Exception:
        pass
    return data


@routes.get("/civitai/model-versions")
async def model_versions(request):
    try:
        model_id = request.query.get("id")
        if not model_id:
            return web.json_response({"error": "Missing id"}, status=400)
        domain = utils._get_active_domain()
        resp = utils.CivitaiAPIUtils._request_with_retry(
            f"https://{domain}/api/v1/models/{model_id}"
        )
        data = resp.json()
        versions = data.get("modelVersions", [])
        for v in versions:
            v["modelName"] = data.get("name", "")
            v["modelId"] = data.get("id")
        return web.json_response({"items": versions})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@routes.get("/civitai/model-version-detail")
async def model_version_detail(request):
    try:
        version_id = request.query.get("id")
        if not version_id:
            return web.json_response({"error": "Missing id"}, status=400)
        domain = utils._get_active_domain()
        data = utils.CivitaiAPIUtils.get_model_version_info_by_id(
            int(version_id), domain
        )
        return web.json_response(data or {})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@routes.get("/civitai/images")
async def model_images(request):
    try:
        version_id = request.query.get("versionId")
        page = int(request.query.get("page", 1))
        domain = utils._get_active_domain()
        params = {"modelVersionId": version_id, "limit": 100, "page": page}
        resp = utils.CivitaiAPIUtils._request_with_retry(
            f"https://{domain}/api/v1/images", params=params
        )
        return web.json_response(resp.json())
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


# ── Download ───────────────────────────────────────────────────────────

DOWNLOAD_TASKS = {}

@routes.post("/civitai/download")
async def start_download(request):
    try:
        data = await request.json()
        download_url = data.get("url")
        model_version_id = data.get("model_version_id")
        model_type = data.get("save_as") or data.get("type", "")
        filename = data.get("filename") or "model.safetensors"
        subfolder = data.get("subfolder", "")
        overwrite = data.get("overwrite", False)
        save_metadata = data.get("save_metadata", False)
        save_preview = data.get("save_preview", False)
        metadata_only = data.get("metadata_only", False)

        domain = utils._get_active_domain()

        if model_version_id and not download_url:
            download_url = f"https://{domain}/api/download/models/{model_version_id}"

        if not download_url:
            return web.json_response({"error": "Missing url or model_version_id"}, status=400)

        # Resolve "auto" folder — fetch version info to determine type
        if not model_type or model_type == "auto":
            try:
                vi = utils.CivitaiAPIUtils.get_model_version_info_by_id(
                    int(model_version_id), domain
                ) if model_version_id else None
                if vi:
                    civitai_type = (vi.get("model") or {}).get("type", "")
                    model_type = {
                        "Checkpoint": "checkpoints", "LORA": "loras", "LoCon": "loras",
                        "DoRA": "loras", "VAE": "vae", "Controlnet": "controlnet",
                        "TextualInversion": "embeddings", "Hypernetwork": "hypernetworks",
                        "Upscaler": "upscale_models", "MotionModule": "animatediff_models",
                    }.get(civitai_type, "other")
            except Exception:
                model_type = "loras"

        models_dir = folder_paths.models_dir
        type_dir = model_type
        if subfolder:
            save_dir = os.path.join(models_dir, type_dir, subfolder)
        else:
            save_dir = os.path.join(models_dir, type_dir)
        os.makedirs(save_dir, exist_ok=True)
        save_path = os.path.join(save_dir, filename)
        if os.path.isdir(save_path):
            fallback_name = filename.strip() or "model.safetensors"
            save_path = os.path.join(save_dir, fallback_name)
            filename = fallback_name

        # For metadata-only jobs, just fetch & save metadata then return
        if metadata_only:
            asyncio.ensure_future(_save_metadata_and_preview(
                model_version_id, save_path, save_metadata, save_preview, domain, ""
            ))
            return web.json_response({"task_id": "meta_" + str(model_version_id)})

        task_id = f"dl_{int(time.time())}_{hashlib.md5(download_url.encode()).hexdigest()[:8]}"
        DOWNLOAD_TASKS[task_id] = {
            "id": task_id, "url": download_url, "filename": filename,
            "type": model_type, "progress": 0, "speed": 0,
            "status": "downloading", "path": save_path, "cancelled": False,
            "started_at": time.time(),
        }

        async def _download():
            nonlocal filename, save_path
            try:
                req = urllib.request.Request(
                    download_url,
                    headers={"User-Agent": "Mozilla/5.0"},
                )
                with urllib.request.urlopen(req, timeout=300) as resp:
                    total = int(resp.headers.get("Content-Length", 0))
                    # Try to get real filename from Content-Disposition
                    cd = resp.headers.get("Content-Disposition", "")
                    if cd:
                        m = re.search(r'filename\*?=(?:UTF-8\'\')?["\']?([^"\';\n]+)', cd)
                        if m:
                            real_name = urllib.parse.unquote(m.group(1))
                            if real_name and real_name != filename:
                                filename = real_name
                                save_path = os.path.join(save_dir, filename)
                                if task_id in DOWNLOAD_TASKS:
                                    DOWNLOAD_TASKS[task_id].update({"filename": filename, "path": save_path})
                    downloaded = 0
                    start_t = time.time()
                    with open(save_path, "wb") as f:
                        while True:
                            if DOWNLOAD_TASKS.get(task_id, {}).get("cancelled"):
                                DOWNLOAD_TASKS[task_id]["status"] = "cancelled"
                                if os.path.exists(save_path):
                                    os.remove(save_path)
                                return
                            chunk = resp.read(8192)
                            if not chunk:
                                break
                            f.write(chunk)
                            downloaded += len(chunk)
                            elapsed = time.time() - start_t
                            speed = downloaded / elapsed if elapsed > 0 else 0
                            progress = int(downloaded / total * 100) if total > 0 else 0
                            if task_id in DOWNLOAD_TASKS:
                                DOWNLOAD_TASKS[task_id].update({
                                    "progress": progress, "speed": speed,
                                    "downloaded": downloaded, "total": total,
                                })
                if task_id in DOWNLOAD_TASKS:
                    DOWNLOAD_TASKS[task_id]["status"] = "completed"
                    DOWNLOAD_TASKS[task_id]["progress"] = 100
                # Always compute SHA256 hash after download
                file_hash = ""
                try:
                    file_hash = await loop.run_in_executor(
                        None, utils.CivitaiAPIUtils.calculate_sha256, save_path
                    )
                    if task_id in DOWNLOAD_TASKS:
                        DOWNLOAD_TASKS[task_id]["hash"] = file_hash
                except Exception:
                    pass
                # Fetch and save metadata / preview after download
                await _save_metadata_and_preview(
                    model_version_id, save_path, save_metadata, save_preview, domain, file_hash
                )
            except Exception as e:
                if task_id in DOWNLOAD_TASKS:
                    DOWNLOAD_TASKS[task_id]["status"] = "error"
                    DOWNLOAD_TASKS[task_id]["error"] = str(e)

        asyncio.ensure_future(_download())
        return web.json_response({"task_id": task_id, "filename": filename})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def _save_metadata_and_preview(model_version_id, save_path, save_metadata, save_preview, domain, file_hash=""):
    """Fetch Civitai version info and save .civitai.json + all preview images."""
    try:
        vi = utils.CivitaiAPIUtils.get_model_version_info_by_id(
            int(model_version_id), domain
        )
        if not vi:
            return
    except Exception:
        return

    base = os.path.splitext(save_path)[0]
    loop = asyncio.get_event_loop()

    # Inject computed hash into version info
    if file_hash:
        if "hashes" not in vi:
            vi["hashes"] = {}
        vi["hashes"]["SHA256"] = file_hash
        files = vi.get("files", [])
        if files and isinstance(files[0], dict):
            if "hashes" not in files[0]:
                files[0]["hashes"] = {}
            files[0]["hashes"]["SHA256"] = file_hash

    # Always save .civitai.json with hash
    meta_path = base + ".civitai.json"
    try:
        # Enrich with full model description if save_metadata is on
        model_id = vi.get("modelId") or (vi.get("model") or {}).get("id")
        if model_id and save_metadata:
            try:
                mresp = utils.CivitaiAPIUtils._request_with_retry(
                    f"https://{domain}/api/v1/models/{model_id}"
                )
                model_data = mresp.json()
                if "model" not in vi:
                    vi["model"] = model_data
                else:
                    vi["model"]["description"] = model_data.get("description", "")
                    vi["model"]["name"] = model_data.get("name", "")
            except Exception:
                pass
        await loop.run_in_executor(None, _write_json, meta_path, vi)
    except Exception:
        pass

    # Download all preview images
    if save_preview:
        images = vi.get("images", [])
        dl_tasks = []
        for idx, img in enumerate(images):
            img_url = img.get("url", "") if isinstance(img, dict) else ""
            if not img_url:
                continue
            # Number images starting from 1; first image keeps base name for compatibility
            if idx == 0:
                img_path = base + ".png"
            else:
                img_path = f"{base}_{idx + 1}.png"
            if os.path.isfile(img_path):
                continue
            dl_tasks.append((img_url, img_path))
        if dl_tasks:
            await asyncio.gather(*[
                loop.run_in_executor(None, _download_file, url, p)
                for url, p in dl_tasks
            ])


def _write_json(path, data):
    import json
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def _download_file(url, path):
    import urllib.request
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        with open(path, "wb") as f:
            f.write(resp.read())


@routes.get("/civitai/downloads")
async def list_downloads(request):
    items = list(DOWNLOAD_TASKS.values())
    return web.json_response({"items": items})


@routes.post("/civitai/download-cancel")
async def cancel_download(request):
    try:
        data = await request.json()
        task_id = data.get("task_id")
        if task_id in DOWNLOAD_TASKS:
            DOWNLOAD_TASKS[task_id]["cancelled"] = True
            return web.json_response({"success": True})
        return web.json_response({"error": "Task not found"}, status=404)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


# ── Local Models ──────────────────────────────────────────────────────

_local_models_cache = {"data": None, "time": 0}
_LOCAL_CACHE_TTL = 30  # seconds

@routes.get("/civitai/local-models")
async def local_models(request):
    try:
        force = request.query.get("force_refresh", "false").lower() == "true"
        now = time.time()
        if not force and _local_models_cache["data"] is not None and (now - _local_models_cache["time"]) < _LOCAL_CACHE_TTL:
            models = _local_models_cache["data"]
            return web.json_response({"models": models, "total": len(models)})
        loop = asyncio.get_event_loop()
        models = await loop.run_in_executor(None, utils.scan_local_models_direct)
        _local_models_cache["data"] = models
        _local_models_cache["time"] = now
        # Fire background DB sync if force_refresh so next load has hashes
        if force:
            asyncio.ensure_future(_bg_local_sync())
        return web.json_response({"models": models, "total": len(models)})
    except Exception as e:
        # Return cached data if available on error
        if _local_models_cache["data"] is not None:
            models = _local_models_cache["data"]
            return web.json_response({"models": models, "total": len(models), "cached": True})
        return web.json_response({"models": [], "total": 0, "error": str(e)})


async def _bg_local_sync():
    """Sync local files with DB in background — doesn't block the response."""
    try:
        loop = asyncio.get_event_loop()
        for mt in utils.SUPPORTED_MODEL_TYPES:
            await loop.run_in_executor(None, utils.sync_local_files_with_db, mt, True)
    except Exception:
        pass


@routes.post("/civitai/rescan")
async def rescan_models(request):
    try:
        data = await request.json() if request.can_read_body else {}
        model_type = data.get("model_type", "all")
        force = data.get("force", False)
        if model_type == "all":
            utils.scan_all_supported_model_types(force=True)
        else:
            utils.sync_local_files_with_db(model_type, force=True)
        return web.json_response({"success": True, "message": "Rescan complete"})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@routes.post("/civitai/delete-model")
async def delete_model(request):
    try:
        data = await request.json()
        model_path = data.get("path")
        if not model_path or not os.path.exists(model_path):
            return web.json_response({"error": "File not found"}, status=404)
        base = os.path.splitext(model_path)[0]
        model_dir = os.path.dirname(model_path)

        # Remove model file
        os.remove(model_path)

        # Remove sidecar .civitai.json
        sidecar = base + ".civitai.json"
        if os.path.exists(sidecar):
            os.remove(sidecar)

        # Remove all preview images (numbered variants)
        for fname in os.listdir(model_dir):
            fpath = os.path.join(model_dir, fname)
            if os.path.isfile(fpath) and fname.startswith(os.path.basename(base)):
                ext = os.path.splitext(fname)[1].lower()
                if ext in (".png", ".jpg", ".jpeg", ".webp"):
                    os.remove(fpath)

        # Remove parent folder if empty
        try:
            if not os.listdir(model_dir):
                os.rmdir(model_dir)
        except Exception:
            pass

        return web.json_response({"success": True})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


# ── Auto-Tag ──────────────────────────────────────────────────────────

@routes.post("/civitai/auto-tag")
async def auto_tag(request):
    try:
        data = await request.json() if request.can_read_body else {}
        model_type = data.get("model_type", "all")
        tagged = 0
        types_to_process = (
            ["checkpoints", "loras", "vae"] if model_type == "all" else [model_type]
        )
        for mt in types_to_process:
            name_to_hash, _ = utils.get_local_model_maps(mt)
            for name, fhash in name_to_hash.items():
                full_path = folder_paths.get_full_path(mt, name)
                if not full_path or not os.path.exists(full_path):
                    continue
                json_path = full_path.replace(".safetensors", ".civitai.json")
                if os.path.exists(json_path):
                    continue
                try:
                    info = utils.CivitaiAPIUtils.get_model_version_info_by_hash(fhash)
                    if info:
                        with open(json_path, "w") as f:
                            json.dump(info, f, indent=2)
                        preview_url = None
                        if info.get("images") and len(info["images"]) > 0:
                            preview_url = info["images"][0].get("url")
                        if preview_url:
                            preview_path = full_path.replace(".safetensors", ".preview.png")
                            if not os.path.exists(preview_path):
                                try:
                                    req = urllib.request.Request(
                                        preview_url,
                                        headers={"User-Agent": "Mozilla/5.0"},
                                    )
                                    with urllib.request.urlopen(req, timeout=15) as resp:
                                        with open(preview_path, "wb") as pf:
                                            pf.write(resp.read())
                                except Exception:
                                    pass
                        tagged += 1
                except Exception:
                    continue
        return web.json_response({"success": True, "tagged": tagged})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


# ── Smart Cleanup ─────────────────────────────────────────────────────

@routes.post("/civitai/cleanup-scan")
async def cleanup_scan(request):
    try:
        issues = []
        for mt in ["checkpoints", "loras", "vae"]:
            try:
                names = folder_paths.get_filename_list(mt)
            except Exception:
                continue
            for name in names:
                full = folder_paths.get_full_path(mt, name)
                if not full or not os.path.exists(full):
                    continue
                base = full.rsplit(".", 1)[0]
                if full.endswith(".safetensors"):
                    json_path = base + ".civitai.json"
                    if os.path.exists(json_path):
                        try:
                            with open(json_path) as f:
                                content = json.load(f)
                            if not content or not content.get("id"):
                                issues.append({
                                    "type": "orphan_sidecar",
                                    "path": json_path,
                                    "message": "Empty or invalid .civitai.json",
                                })
                        except Exception:
                            issues.append({
                                "type": "corrupt_json",
                                "path": json_path,
                                "message": "Corrupt .civitai.json",
                            })
                else:
                    orphan_json = base + ".civitai.json"
                    if os.path.exists(orphan_json):
                        issues.append({
                            "type": "orphan_sidecar",
                            "path": orphan_json,
                            "message": "Orphan .civitai.json (no model found)",
                        })
                    orphan_preview = base + ".preview.png"
                    if os.path.exists(orphan_preview):
                        issues.append({
                            "type": "orphan_preview",
                            "path": orphan_preview,
                            "message": "Orphan .preview.png (no model found)",
                        })
        return web.json_response({"success": True, "issues": issues, "total": len(issues)})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@routes.post("/civitai/cleanup-delete")
async def cleanup_delete(request):
    try:
        data = await request.json()
        paths = data.get("paths", [])
        deleted = 0
        for p in paths:
            if os.path.exists(p) and os.path.isfile(p):
                os.remove(p)
                deleted += 1
        return web.json_response({"success": True, "deleted": deleted})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


# ── Auto-Organize ─────────────────────────────────────────────────────

@routes.post("/civitai/auto-organize")
async def auto_organize(request):
    try:
        moved = 0
        for mt in ["loras", "checkpoints", "vae"]:
            names = folder_paths.get_filename_list(mt)
            name_to_hash, _ = utils.get_local_model_maps(mt)
            for name in names:
                fhash = name_to_hash.get(name)
                if not fhash:
                    continue
                try:
                    info = utils.CivitaiAPIUtils.get_model_version_info_by_hash(fhash)
                except Exception:
                    continue
                if not info:
                    continue
                cat = (info.get("model") or {}).get("type", "")
                creator = ""
                if info.get("model") and info["model"].get("creator"):
                    creator = info["model"]["creator"].get("username", "")
                base_model_info = ""
                for tag in (info.get("model") or {}).get("tags", []):
                    if tag.get("name", "").lower() in (
                        "sd 1.5", "sdxl", "sd 2", "flux", "pixart", "playground v2"
                    ):
                        base_model_info = tag["name"].replace(" ", "_").lower()
                        break
                folder_parts = [p for p in [cat, base_model_info, creator] if p]
                if not folder_parts:
                    continue
                target_subdir = "/".join(folder_parts)
                src = folder_paths.get_full_path(mt, name)
                if not src:
                    continue
                models_dir = folder_paths.models_dir
                dest_dir = os.path.join(models_dir, mt, target_subdir)
                os.makedirs(dest_dir, exist_ok=True)
                dest = os.path.join(dest_dir, name)
                if os.path.normpath(src) == os.path.normpath(dest):
                    continue
                if os.path.exists(dest):
                    continue
                try:
                    os.rename(src, dest)
                    for ext in [".civitai.json", ".preview.png"]:
                        s = src.replace(".safetensors", ext)
                        if os.path.exists(s):
                            d = dest.replace(".safetensors", ext)
                            os.rename(s, d)
                    moved += 1
                except Exception:
                    pass
        return web.json_response({"success": True, "moved": moved})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


# ── HF Browse ─────────────────────────────────────────────────────────

@routes.get("/civitai/hf-search")
async def hf_search(request):
    try:
        query = request.query.get("query", "")
        pipeline_tag = request.query.get("pipeline_tag", "")
        library = request.query.get("library", "")
        author = request.query.get("author", "")
        sort = request.query.get("sort", "lastModified")
        direction = request.query.get("direction", "-1")
        limit = int(request.query.get("limit", 30))
        tags = request.query.get("tags", "")
        gated = request.query.get("gated", "")

        hf_url = "https://huggingface.co/api/models"
        params = {"search": query, "sort": sort, "direction": direction, "limit": limit}
        if pipeline_tag:
            params["task"] = pipeline_tag
        if library:
            params["library"] = library
        if author:
            params["author"] = author
        if tags:
            params["filter"] = tags
        if gated.lower() in ("true", "false"):
            params["gated"] = gated.lower()

        headers = {"User-Agent": "Mozilla/5.0"}
        token = utils.db_manager.get_setting("hf_token", "")
        if token:
            headers["Authorization"] = f"Bearer {token}"
        resp = requests.get(hf_url, params=params, timeout=15, headers=headers)
        resp.raise_for_status()
        items = resp.json()
        return web.json_response({"items": items, "total": len(items)})
    except Exception as e:
        return web.json_response({"items": [], "error": str(e)})


@routes.get("/civitai/hf-lookup")
async def hf_lookup(request):
    try:
        repo_id = request.query.get("repo", "")
        if not repo_id:
            return web.json_response({"error": "Missing repo"}, status=400)
        if repo_id.find("/") < 0:
            return web.json_response({"error": "Invalid repo format (use user/repo)"}, status=400)
        headers = {"User-Agent": "Mozilla/5.0"}
        token = utils.db_manager.get_setting("hf_token", "")
        if token:
            headers["Authorization"] = f"Bearer {token}"
        api_url = f"https://huggingface.co/api/models/{repo_id}"
        resp = requests.get(api_url, timeout=15, headers=headers)
        resp.raise_for_status()
        data = resp.json()
        return web.json_response(data)
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 404:
            return web.json_response({"error": "Repo not found"}, status=404)
        return web.json_response({"error": f"HTTP {e.response.status_code}"}, status=e.response.status_code)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@routes.get("/civitai/hf-files")
async def hf_files(request):
    try:
        repo_id = request.query.get("repo_id", "")
        path = request.query.get("path", "")
        if not repo_id:
            return web.json_response({"error": "Missing repo_id"}, status=400)
        api_url = f"https://huggingface.co/api/models/{repo_id}"
        if path:
            api_url += f"/tree/{path}"
        headers = {"User-Agent": "Mozilla/5.0"}
        token = utils.db_manager.get_setting("hf_token", "")
        if token:
            headers["Authorization"] = f"Bearer {token}"
        resp = requests.get(api_url, timeout=15, headers=headers)
        resp.raise_for_status()
        return web.json_response(resp.json())
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


# ── Settings ──────────────────────────────────────────────────────────

@routes.get("/civitai/settings")
async def get_settings(request):
    return web.json_response({
        "baseUrl": f"https://{utils._get_active_domain()}",
        "saveMetadata": utils.db_manager.get_setting("save_metadata", True),
        "savePreview": utils.db_manager.get_setting("save_preview", True),
        "computeSHA": utils.db_manager.get_setting("compute_sha", True),
        "nsfw_default": utils.db_manager.get_setting("nsfw_default", ""),
        "civitaiToken": bool(utils.db_manager.get_setting("civitai_api_key")),
        "hfToken": bool(utils.db_manager.get_setting("hf_token")),
        "network_choice": utils.db_manager.get_setting("network_choice", "com"),
        "nsfw_blur": utils.db_manager.get_setting("nsfw_blur", True),
        "theme": utils.db_manager.get_setting("theme", "dark"),
        "compact_grid": utils.db_manager.get_setting("compact_grid", False),
        "has_api_key": bool(utils.db_manager.get_setting("civitai_api_key")),
        "has_token": bool(utils.db_manager.get_setting("hf_token")),
    })


@routes.post("/civitai/settings")
async def save_settings(request):
    try:
        data = await request.json()
        for key in [
            "save_metadata", "save_preview", "compute_sha", "nsfw_default",
            "network_choice", "nsfw_blur", "theme", "compact_grid",
        ]:
            if key in data:
                utils.db_manager.set_setting(key, data[key])
        if "civitai_api_key" in data:
            utils.db_manager.set_setting("civitai_api_key", data["civitai_api_key"])
        if "api_key" in data:
            utils.db_manager.set_setting("civitai_api_key", data["api_key"])
        if "verify_sha256" in data:
            utils.db_manager.set_setting("compute_sha", data["verify_sha256"])
        if "hf_token" in data:
            utils.db_manager.set_setting("hf_token", data["hf_token"])
        return web.json_response({
            "success": True,
            "has_api_key": bool(utils.db_manager.get_setting("civitai_api_key")),
            "has_token": bool(utils.db_manager.get_setting("hf_token")),
        })
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@routes.get("/civitai/test")
async def test_api(request):
    try:
        domain = utils._get_active_domain()
        t0 = time.time()
        utils.CivitaiAPIUtils._request_with_retry(f"https://{domain}/api/v1/models?limit=1")
        latency = int((time.time() - t0) * 1000)
        return web.json_response({"success": True, "latency": latency})
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)})


@routes.get("/civitai/test-hf")
async def test_hf(request):
    try:
        t0 = time.time()
        headers = {"User-Agent": "Mozilla/5.0"}
        resp = requests.get(
            "https://huggingface.co/api/models?limit=1",
            timeout=10, headers=headers,
        )
        resp.raise_for_status()
        latency = int((time.time() - t0) * 1000)
        return web.json_response({"success": True, "latency": latency})
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)})


@routes.post("/civitai/clear-cache")
async def clear_cache(request):
    try:
        data = await request.json() if request.can_read_body else {}
        cache_type = data.get("cache_type", "all")
        if cache_type in ("analysis", "all"):
            utils.db_manager.clear_analysis_cache()
        if cache_type in ("api", "all"):
            utils.db_manager.clear_api_responses()
        if cache_type in ("triggers", "all"):
            utils.db_manager.clear_all_triggers()
        return web.json_response({"success": True})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@routes.post("/civitai/export-list")
async def export_model_list(request):
    try:
        lines = []
        for mt in ["checkpoints", "loras", "vae", "text_encoders", "unet", "diffusion_models"]:
            try:
                for name in folder_paths.get_filename_list(mt):
                    full = folder_paths.get_full_path(mt, name)
                    if full:
                        lines.append(full)
            except Exception:
                continue
        text = "\n".join(lines)
        return web.json_response({"success": True, "text": text, "count": len(lines)})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@routes.get("/civitai/model-info")
async def model_info(request):
    try:
        filepath = request.query.get("path", "")
        if not filepath or not os.path.exists(filepath):
            return web.json_response({"error": "File not found"}, status=404)
        hash_val = utils.CivitaiAPIUtils.calculate_sha256(filepath)
        info = None
        if hash_val:
            info = utils.CivitaiAPIUtils.get_model_version_info_by_hash(hash_val)
        json_path = filepath.replace(".safetensors", ".civitai.json")
        metadata = None
        if os.path.exists(json_path):
            try:
                with open(json_path) as f:
                    metadata = json.load(f)
            except Exception:
                pass
        return web.json_response({
            "hash": hash_val,
            "civitai": info,
            "metadata": metadata,
            "filename": os.path.basename(filepath),
            "size": os.path.getsize(filepath),
        })
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


print("[ComfyUI-CivitAiHF-Downloader] Server routes registered")


# ── Missing utility endpoints ───────────────────────────────────────────

@routes.get("/civitai/folders")
async def list_folders(request):
    try:
        folders = []
        for sub in ["checkpoints", "loras", "vae", "controlnet", "embeddings",
                     "upscale_models", "clip_vision", "unet", "diffusion_models",
                     "instantid", "ipadapter", "photomaker", "style_models",
                     "text_encoders", "wildcards", "audio_encoders",
                     "background_removal", "clip", "configs", "detection",
                     "diffusers", "frame_interpolation", "geometry_estimation",
                     "gligen", "latent_upscale_models", "model_patches",
                     "optical_flow", "vae_approx"]:
            sub_path = os.path.join(folder_paths.models_dir, sub)
            if os.path.isdir(sub_path):
                folders.append(sub)
        return web.json_response({"folders": folders})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@routes.post("/civitai/hf/download")
async def hf_download(request):
    try:
        body = await request.json()
        repo_id = body.get("repo_id", "")
        revision = body.get("revision", "main")
        path = body.get("path", "")
        save_as = body.get("save_as", "auto")
        subfolder = body.get("subfolder", "")
        overwrite = body.get("overwrite", False)
        save_metadata = body.get("save_metadata", False)
        save_preview = body.get("save_preview", False)
        if not repo_id or not path:
            return web.json_response({"error": "Missing repo_id or path"}, status=400)
        filename = path.split("/")[-1]
        dest_dir = os.path.join(folder_paths.models_dir, save_as if save_as != "auto" else "loras")
        if subfolder:
            dest_dir = os.path.join(dest_dir, subfolder)
        os.makedirs(dest_dir, exist_ok=True)
        dest = os.path.join(dest_dir, filename)
        if os.path.exists(dest) and not overwrite:
            return web.json_response({"error": "File exists", "path": dest}, status=409)
        url = f"https://huggingface.co/{repo_id}/resolve/{revision}/{urllib.parse.quote(path, safe='/')}"
        task_id = f"hf_{int(time.time())}_{hashlib.md5(f'{repo_id}:{path}'.encode()).hexdigest()[:8]}"
        DOWNLOAD_TASKS[task_id] = {
            "id": task_id, "url": url, "filename": filename,
            "source": "hf", "hf_repo_id": repo_id, "hf_path": path,
            "progress": 0, "speed": 0, "status": "downloading",
            "path": dest, "cancelled": False, "started_at": time.time(),
        }

        async def _hf_dl():
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=600) as resp:
                    total = int(resp.headers.get("Content-Length", 0))
                    downloaded = 0
                    start_t = time.time()
                    with open(dest, "wb") as f:
                        while True:
                            if DOWNLOAD_TASKS.get(task_id, {}).get("cancelled"):
                                DOWNLOAD_TASKS[task_id]["status"] = "cancelled"
                                if os.path.exists(dest):
                                    os.remove(dest)
                                return
                            chunk = resp.read(8192)
                            if not chunk:
                                break
                            f.write(chunk)
                            downloaded += len(chunk)
                            elapsed = time.time() - start_t
                            speed = downloaded / elapsed if elapsed > 0 else 0
                            progress = int(downloaded / total * 100) if total > 0 else 0
                            if task_id in DOWNLOAD_TASKS:
                                DOWNLOAD_TASKS[task_id].update({
                                    "progress": progress, "speed": speed,
                                    "downloaded": downloaded, "total": total,
                                })
                if task_id in DOWNLOAD_TASKS:
                    DOWNLOAD_TASKS[task_id]["status"] = "completed"
                    DOWNLOAD_TASKS[task_id]["progress"] = 100
            except Exception as e:
                if task_id in DOWNLOAD_TASKS:
                    DOWNLOAD_TASKS[task_id]["status"] = "error"
                    DOWNLOAD_TASKS[task_id]["error"] = str(e)

        asyncio.ensure_future(_hf_dl())
        return web.json_response({"id": task_id, "filename": filename, "dest": dest})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@routes.post("/civitai/hf/token")
async def set_hf_token(request):
    try:
        body = await request.json()
        token = body.get("token", "")
        utils.db_manager.set_setting("hf_token", token)
        return web.json_response({"ok": True})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@routes.get("/civitai/ping")
async def ping(request):
    domain = utils._get_active_domain()
    try:
        r = requests.get(f"https://{domain}/api/v1/models?limit=1", timeout=10)
        return web.json_response({
            "ok": r.ok, "status": r.status_code, "domain": domain,
            "has_api_key": bool(utils.db_manager.get_setting("civitai_api_key")),
            "has_token": bool(utils.db_manager.get_setting("hf_token")),
        })
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e), "domain": domain})


@routes.post("/civitai/cache/clear")
async def clear_cache_v2(request):
    try:
        utils.db_manager.clear_analysis_cache()
        return web.json_response({"ok": True, "message": "Cache cleared"})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@routes.get("/civitai/local-previews")
async def get_local_previews(request):
    """Return all preview images + per-image prompts for a local model."""
    try:
        path = request.query.get("path", "")
        if not path or ".." in path:
            return web.json_response({"images": []})
        if not os.path.isabs(path):
            path = os.path.join(folder_paths.models_dir, path)
        base = os.path.splitext(path)[0]
        # Load metadata for prompts
        json_path = base + ".civitai.json"
        images_meta = []
        if os.path.isfile(json_path):
            try:
                with open(json_path) as f:
                    meta = json.load(f)
                images_meta = meta.get("images", [])
            except Exception:
                pass
        # Find all numbered preview files matching base + .png/.jpg/.webp
        exts = [".png", ".jpg", ".jpeg", ".webp"]
        previews = []
        for idx in range(20):  # up to 20 previews
            suffix = "" if idx == 0 else f"_{idx + 1}"
            found = None
            for ext in exts:
                candidate = base + suffix + ext
                if os.path.isfile(candidate):
                    found = candidate
                    break
            if not found:
                if idx == 0:
                    continue
                break
            meta = images_meta[idx] if idx < len(images_meta) and isinstance(images_meta[idx], dict) else {}
            m = meta.get("meta") or {}
            m = m if isinstance(m, dict) else {}
            import urllib.parse
            previews.append({
                "url": f"/civitai/local-preview?path={urllib.parse.quote(os.path.abspath(found))}&w=300",
                "prompt": m.get("prompt", ""),
                "negativePrompt": m.get("negativePrompt", ""),
                "seed": m.get("seed", ""),
                "width": m.get("width", ""),
                "height": m.get("height", ""),
            })
        return web.json_response({"images": previews})
    except Exception as e:
        return web.json_response({"images": [], "error": str(e)})


print("[ComfyUI-CivitAiHF-Downloader] Extra routes registered")


# ── Prompt Fetcher (node ↔ UI bridge) ──────────────────────────────────

@routes.post("/civitai/prompt-fetcher")
async def set_prompt_fetcher(request):
    """Receive positive/negative prompts from the UI and store for the Prompt Fetcher node."""
    try:
        body = await request.json()
        positive = body.get("positive", "")
        negative = body.get("negative", "")
        from .nodes import set_prompts
        set_prompts(positive, negative)
        return web.json_response({"ok": True})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@routes.get("/civitai/prompt-fetcher")
async def get_prompt_fetcher(request):
    """Return the current prompts stored in the Prompt Fetcher node."""
    try:
        from .nodes import get_prompts
        prompts = get_prompts()
        return web.json_response(prompts)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)
