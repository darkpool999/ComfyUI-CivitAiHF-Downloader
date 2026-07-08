import asyncio
import json
import os
import time
import re
import urllib.request
import urllib.parse
import hashlib
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
        model_type = request.query.get("type", "")
        sort = request.query.get("sort", "Newest")
        page = int(request.query.get("page", 1))
        nsfw = request.query.get("nsfw", "false")
        limit = 20
        domain = utils._get_active_domain()
        params = {"limit": limit, "page": page, "sort": sort}
        if query:
            params["query"] = query
        if model_type:
            params["types"] = model_type
        if nsfw == "true":
            params["nsfw"] = "true"
        resp = utils.CivitaiAPIUtils._request_with_retry(
            f"https://{domain}/api/v1/models", params=params
        )
        data = resp.json()
        return web.json_response(data)
    except Exception as e:
        return web.json_response({"items": [], "total": 0, "error": str(e)})


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
        model_type = data.get("type", "loras")
        filename = data.get("filename", "model.safetensors")
        subfolder = data.get("subfolder", "")

        if not download_url:
            return web.json_response({"error": "Missing url"}, status=400)

        models_dir = folder_paths.models_dir
        type_dir = model_type
        if subfolder:
            save_dir = os.path.join(models_dir, type_dir, subfolder)
        else:
            save_dir = os.path.join(models_dir, type_dir)
        os.makedirs(save_dir, exist_ok=True)
        save_path = os.path.join(save_dir, filename)

        task_id = f"dl_{int(time.time())}_{hashlib.md5(download_url.encode()).hexdigest()[:8]}"
        DOWNLOAD_TASKS[task_id] = {
            "id": task_id, "url": download_url, "filename": filename,
            "type": model_type, "progress": 0, "speed": 0,
            "status": "downloading", "path": save_path, "cancelled": False,
            "started_at": time.time(),
        }

        async def _download():
            try:
                req = urllib.request.Request(
                    download_url,
                    headers={"User-Agent": "Mozilla/5.0"},
                )
                with urllib.request.urlopen(req, timeout=300) as resp:
                    total = int(resp.headers.get("Content-Length", 0))
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
            except Exception as e:
                if task_id in DOWNLOAD_TASKS:
                    DOWNLOAD_TASKS[task_id]["status"] = "error"
                    DOWNLOAD_TASKS[task_id]["error"] = str(e)

        asyncio.ensure_future(_download())
        return web.json_response({"task_id": task_id})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


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

@routes.get("/civitai/local-models")
async def local_models(request):
    try:
        force = request.query.get("force_refresh", "false").lower() == "true"
        loop = asyncio.get_event_loop()
        models = await loop.run_in_executor(
            None, utils.get_all_local_models_with_details, force
        )
        return web.json_response({"models": models, "total": len(models)})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


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
        os.remove(model_path)
        sidecar = model_path.replace(".safetensors", ".civitai.json")
        if os.path.exists(sidecar):
            os.remove(sidecar)
        preview = model_path.replace(".safetensors", ".preview.png")
        if os.path.exists(preview):
            os.remove(preview)
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
        task = request.query.get("task", "text-to-image")
        sort = request.query.get("sort", "lastModified")
        limit = int(request.query.get("limit", 20))
        hf_url = "https://huggingface.co/api/models"
        params = {"search": query, "task": task, "sort": sort, "limit": limit}
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


try:
    import requests
except ImportError:
    pass


# ── Settings ──────────────────────────────────────────────────────────

@routes.get("/civitai/settings")
async def get_settings(request):
    return web.json_response({
        "baseUrl": f"https://{utils._get_active_domain()}",
        "saveMetadata": utils.db_manager.get_setting("save_metadata", True),
        "savePreview": utils.db_manager.get_setting("save_preview", True),
        "computeSHA": utils.db_manager.get_setting("compute_sha", True),
        "bypassNSFW": utils.db_manager.get_setting("bypass_nsfw", False),
        "civitaiToken": bool(utils.db_manager.get_setting("civitai_api_key")),
        "hfToken": bool(utils.db_manager.get_setting("hf_token")),
        "network_choice": utils.db_manager.get_setting("network_choice", "com"),
    })


@routes.post("/civitai/settings")
async def save_settings(request):
    try:
        data = await request.json()
        for key in [
            "save_metadata", "save_preview", "compute_sha", "bypass_nsfw",
            "network_choice",
        ]:
            if key in data:
                utils.db_manager.set_setting(key, data[key])
        if "civitai_api_key" in data:
            utils.db_manager.set_setting("civitai_api_key", data["civitai_api_key"])
        if "hf_token" in data:
            utils.db_manager.set_setting("hf_token", data["hf_token"])
        return web.json_response({"success": True})
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
