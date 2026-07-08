import sqlite3
import threading
import hashlib
import json
import os
import re
import time
import requests
import folder_paths
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed, TimeoutError
from tqdm import tqdm

HASH_CACHE_REFRESH_INTERVAL = 3600
SINGLE_FILE_HASH_TIMEOUT = 90
SUPPORTED_MODEL_TYPES = {
    "checkpoints": "checkpoints",
    "loras": "Lora",
    "vae": "VAE",
    "embeddings": "embeddings",
    "diffusion_models": "diffusion_models",
    "text_encoders": "text_encoders",
    "hypernetworks": "hypernetworks",
}


class DatabaseManager:
    _instance = None
    _lock = threading.Lock()

    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            with cls._lock:
                if not cls._instance:
                    cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        if hasattr(self, "_initialized") and self._initialized:
            return
        project_root = os.path.dirname(os.path.abspath(__file__))
        os.makedirs(os.path.join(project_root, "data"), exist_ok=True)
        self.db_path = os.path.join(project_root, "data", "civitai_helper.db")
        self._create_tables()
        self._initialized = True

    def get_connection(self):
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        return conn

    def _create_tables(self):
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)"
            )
            cursor.execute(
                "CREATE TABLE IF NOT EXISTS models (model_id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT)"
            )
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS versions (
                    hash TEXT PRIMARY KEY, version_id INTEGER UNIQUE, model_id INTEGER,
                    model_type TEXT, name TEXT, local_path TEXT UNIQUE, local_mtime REAL,
                    trained_words TEXT, api_response TEXT, last_api_check INTEGER,
                    FOREIGN KEY (model_id) REFERENCES models (model_id)
                )
            """)
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_versions_model_type ON versions (model_type)"
            )
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_versions_version_id ON versions (version_id)"
            )
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS images (
                    image_id INTEGER PRIMARY KEY, version_id INTEGER, url TEXT UNIQUE NOT NULL,
                    meta TEXT, local_filename TEXT,
                    FOREIGN KEY (version_id) REFERENCES versions (version_id)
                )
            """)
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_images_url ON images (url)")
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS analysis_cache (
                    fingerprint TEXT PRIMARY KEY, analysis_data TEXT, last_updated INTEGER
                )
            """)

    def get_setting(self, key, default=None):
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT value FROM settings WHERE key = ?", (key,))
            row = cursor.fetchone()
        if row and row["value"]:
            try:
                return json.loads(row["value"])
            except Exception:
                return row["value"]
        return default

    def set_setting(self, key, value):
        with self.get_connection() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
                (key, json.dumps(value)),
            )

    def get_analysis_cache(self, fingerprint):
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT analysis_data FROM analysis_cache WHERE fingerprint = ?",
                (fingerprint,),
            )
            row = cursor.fetchone()
        if row and row["analysis_data"]:
            return json.loads(row["analysis_data"])
        return None

    def set_analysis_cache(self, fingerprint, data):
        with self.get_connection() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO analysis_cache (fingerprint, analysis_data, last_updated) VALUES (?, ?, ?)",
                (fingerprint, json.dumps(data), int(time.time())),
            )

    def clear_analysis_cache(self):
        with self.get_connection() as conn:
            conn.execute("DELETE FROM analysis_cache")

    def clear_api_responses(self):
        with self.get_connection() as conn:
            conn.execute("UPDATE versions SET api_response = NULL, last_api_check = 0")

    def clear_all_triggers(self):
        with self.get_connection() as conn:
            conn.execute("UPDATE versions SET trained_words = NULL")

    def get_version_by_hash(self, file_hash):
        if not file_hash:
            return None
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT * FROM versions WHERE hash = ?", (file_hash.lower(),)
            )
            return cursor.fetchone()

    def get_version_by_id(self, version_id):
        if not version_id:
            return None
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM versions WHERE version_id = ?", (version_id,))
            return cursor.fetchone()

    def get_version_by_path(self, local_path):
        if not local_path:
            return None
        norm_path = os.path.normpath(local_path)
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """SELECT v.*, m.name AS model_name
                   FROM versions v LEFT JOIN models m ON v.model_id = m.model_id
                   WHERE v.local_path = ?""",
                (norm_path,),
            )
            return cursor.fetchone()

    def get_model_by_id(self, model_id):
        if not model_id:
            return None
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM models WHERE model_id = ?", (model_id,))
            return cursor.fetchone()

    def get_image_by_url(self, url):
        if not url:
            return None
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM images WHERE url = ?", (url,))
            return cursor.fetchone()

    def add_or_update_version_from_api(self, data, original_hash=None):
        model_id = data.get("modelId") or (data.get("model") or {}).get("id")
        version_id = data.get("id")
        if not version_id or not model_id:
            return

        files = data.get("files", [])
        if not files:
            return

        target_file_info = None
        if original_hash:
            for f in files:
                if f.get("hashes", {}).get("SHA256", "").lower() == original_hash.lower():
                    target_file_info = f
                    break
        if not target_file_info:
            target_file_info = next((f for f in files if f.get("primary")), files[0])

        file_hash = target_file_info.get("hashes", {}).get("SHA256")
        if not file_hash:
            return
        file_hash = file_hash.lower()

        api_response_str = json.dumps(data, ensure_ascii=False)
        trained_words_str = json.dumps(data.get("trainedWords", []), ensure_ascii=False)

        with self.get_connection() as conn:
            conn.execute(
                "DELETE FROM versions WHERE version_id = ? AND hash != ?",
                (version_id, file_hash),
            )
            model_data = data.get("model", {})
            conn.execute(
                """INSERT INTO models (model_id, name, type) VALUES (?, ?, ?)
                   ON CONFLICT(model_id) DO UPDATE SET name = excluded.name, type = excluded.type""",
                (model_id, model_data.get("name"), model_data.get("type")),
            )
            conn.execute(
                """INSERT INTO versions (hash, version_id, model_id, name, trained_words, api_response, last_api_check)
                   VALUES (?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(hash) DO UPDATE SET
                       version_id = excluded.version_id, model_id = excluded.model_id,
                       name = excluded.name, trained_words = excluded.trained_words,
                       api_response = excluded.api_response, last_api_check = excluded.last_api_check""",
                (file_hash, version_id, model_id, data.get("name"),
                 trained_words_str, api_response_str, int(time.time())),
            )

    def add_downloaded_image(self, url, local_filename=None, version_id=None, meta=None):
        with self.get_connection() as conn:
            conn.execute(
                """INSERT INTO images (url, local_filename, version_id, meta) VALUES (?, ?, ?, ?)
                   ON CONFLICT(url) DO UPDATE SET
                       local_filename = COALESCE(excluded.local_filename, local_filename),
                       version_id = COALESCE(excluded.version_id, version_id),
                       meta = COALESCE(excluded.meta, meta)""",
                (url, local_filename, version_id, json.dumps(meta) if meta else None),
            )

    def get_db_stats(self):
        stats = {}
        with self.get_connection() as conn:
            cursor = conn.cursor()
            for mt in ["checkpoints", "loras"]:
                cursor.execute(
                    "SELECT COUNT(*) FROM versions WHERE model_type = ? AND local_path IS NOT NULL",
                    (mt,),
                )
                stats[mt] = cursor.fetchone()[0]
        return stats

    def get_scanned_models(self, model_type):
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT local_path FROM versions WHERE model_type = ? AND local_path IS NOT NULL ORDER BY local_path ASC",
                (model_type,),
            )
            rows = cursor.fetchall()
        known = folder_paths.get_filename_list(model_type)
        full_map = {
            os.path.normpath(folder_paths.get_full_path(model_type, f)): f
            for f in known
        }
        result = []
        for row in rows:
            rp = full_map.get(os.path.normpath(row["local_path"]))
            if rp:
                result.append(rp)
        return sorted(set(result))

    def mark_hash_as_not_found(self, file_hash):
        with self.get_connection() as conn:
            conn.execute(
                "UPDATE versions SET api_response = ?, last_api_check = ? WHERE hash = ?",
                (json.dumps({}), int(time.time()), file_hash.lower()),
            )


db_manager = DatabaseManager()


def _get_active_domain():
    choice = db_manager.get_setting("network_choice", "com")
    return "civitai.work" if choice == "work" else "civitai.com"


SAMPLER_SCHEDULER_MAP = {
    "Euler a": "euler_ancestral", "Euler": "euler", "LMS": "lms", "Heun": "heun",
    "DPM2": "dpm_2", "DPM2 a": "dpm_2_ancestral", "DPM++ 2S a": "dpmpp_2s_ancestral",
    "DPM++ 2M": "dpmpp_2m", "DPM++ SDE": "dpmpp_sde", "DPM++ 2M SDE": "dpmpp_2m_sde",
    "DPM fast": "dpm_fast", "DPM adaptive": "dpm_adaptive", "DDIM": "ddim", "PLMS": "plms",
    "UniPC": "uni_pc", "normal": "normal", "karras": "karras", "Karras": "karras",
    "exponential": "exponential", "sgm_uniform": "sgm_uniform", "simple": "simple",
    "ddim_uniform": "ddim_uniform", "turbo": "turbo",
}


class CivitaiAPIUtils:
    @staticmethod
    def _request_with_retry(url, params=None, timeout=15, retries=3, delay=5):
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36"
        }
        api_key = db_manager.get_setting("civitai_api_key")
        if api_key and isinstance(api_key, str):
            headers["Authorization"] = f"Bearer {api_key}"
        for i in range(retries + 1):
            try:
                resp = requests.get(url, params=params, timeout=timeout, headers=headers)
                resp.raise_for_status()
                return resp
            except requests.exceptions.HTTPError as e:
                if e.response.status_code == 429:
                    time.sleep(delay)
                    delay *= 2
                else:
                    raise
            except requests.exceptions.RequestException as e:
                time.sleep(delay)
        raise Exception(f"Failed to fetch {url} after {retries} retries.")

    @staticmethod
    def calculate_sha256(file_path):
        sha256 = hashlib.sha256()
        try:
            with open(file_path, "rb") as f:
                while chunk := f.read(1 << 20):
                    sha256.update(chunk)
            return sha256.hexdigest()
        except Exception as e:
            return None

    @classmethod
    def get_model_version_info_by_id(cls, version_id, domain, force_refresh=False):
        if not version_id:
            return None
        if not force_refresh:
            v = db_manager.get_version_by_id(version_id)
            if v and v["api_response"]:
                return json.loads(v["api_response"])
        url = f"https://{domain}/api/v1/model-versions/{version_id}"
        try:
            resp = cls._request_with_retry(url)
            data = resp.json()
            if data:
                db_manager.add_or_update_version_from_api(data)
            return data
        except Exception:
            return None

    @classmethod
    def get_model_info_by_id(cls, model_id, domain):
        if not model_id:
            return None
        url = f"https://{domain}/api/v1/models/{model_id}"
        try:
            resp = cls._request_with_retry(url)
            return resp.json()
        except Exception:
            return None

    @classmethod
    def get_model_version_info_by_hash(cls, sha256_hash, force_refresh=False, more_info=False):
        if not sha256_hash:
            return None
        sha256_hash = sha256_hash.lower()
        if not force_refresh:
            entry = db_manager.get_version_by_hash(sha256_hash)
            if entry and entry["api_response"] is not None:
                try:
                    cached = json.loads(entry["api_response"])
                    if cached == {}:
                        return None
                    return cached
                except Exception:
                    pass
        domain = _get_active_domain()
        try:
            url = f"https://{domain}/api/v1/model-versions/by-hash/{sha256_hash}"
            resp = cls._request_with_retry(url)
            version_data = resp.json()
            if not version_data or not version_data.get("id"):
                db_manager.mark_hash_as_not_found(sha256_hash)
                return None
            final_data = version_data
            model_id = version_data.get("modelId")
            if more_info and model_id:
                full = cls.get_model_info_by_id(model_id, domain)
                if full:
                    final_data["version_description"] = final_data.pop("description", "")
                    final_data["model_description"] = full.get("description", "")
                    final_data["model"] = full
            db_manager.add_or_update_version_from_api(final_data, original_hash=sha256_hash)
            return final_data
        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 404:
                db_manager.mark_hash_as_not_found(sha256_hash)
            return None
        except Exception:
            return None


def scan_all_supported_model_types(force=False):
    for model_type in SUPPORTED_MODEL_TYPES:
        try:
            if folder_paths.get_filename_list(model_type) is not None:
                sync_local_files_with_db(model_type, force=force)
        except Exception:
            pass


def update_hash_in_db(file_info):
    if not file_info or not file_info.get("hash"):
        return False
    try:
        with db_manager.get_connection() as conn:
            conn.execute(
                "UPDATE versions SET local_path = NULL, local_mtime = NULL WHERE local_path = ?",
                (file_info["path"],),
            )
            conn.execute(
                """INSERT INTO versions (hash, local_path, local_mtime, name, model_type) VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT(hash) DO UPDATE SET
                       local_path = excluded.local_path, local_mtime = excluded.local_mtime,
                       model_type = excluded.model_type""",
                (file_info["hash"].lower(), file_info["path"], file_info["mtime"],
                 os.path.basename(file_info["path"]), file_info["model_type"]),
            )
        return True
    except Exception:
        return False


def sync_local_files_with_db(model_type, force=False):
    if model_type not in SUPPORTED_MODEL_TYPES:
        return {"new": 0, "modified": 0, "hashed": 0}
    last_sync_key = f"last_sync_{model_type}"
    last_sync_time = db_manager.get_setting(last_sync_key, 0)
    if not force and time.time() - last_sync_time < HASH_CACHE_REFRESH_INTERVAL:
        return {"skipped": True}

    local_files = folder_paths.get_filename_list(model_type)
    with db_manager.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT local_path, local_mtime FROM versions WHERE model_type = ?",
            (model_type,),
        )
        db_files = {}
        for row in cursor.fetchall():
            if row["local_path"]:
                db_files[os.path.normcase(os.path.normpath(row["local_path"]))] = row["local_mtime"]

    files_to_hash = []
    for rel_path in local_files:
        full_path = folder_paths.get_full_path(model_type, rel_path)
        if not full_path or not os.path.exists(full_path) or os.path.isdir(full_path):
            continue
        norm = os.path.normcase(os.path.normpath(full_path))
        try:
            mtime = os.path.getmtime(norm)
            if norm not in db_files or db_files[norm] != mtime:
                files_to_hash.append({"path": full_path, "mtime": mtime})
        except Exception:
            pass

    if not files_to_hash:
        db_manager.set_setting(last_sync_key, time.time())
        return {"found": 0, "hashed": 0}

    def hash_worker(fi):
        return {**fi, "hash": CivitaiAPIUtils.calculate_sha256(fi["path"])}

    hashed_count = 0
    with ThreadPoolExecutor(max_workers=max(1, os.cpu_count() // 2 or 1)) as executor:
        futures = {executor.submit(hash_worker, f): f for f in files_to_hash}
        for future in tqdm(as_completed(futures), total=len(futures), desc=f"Hashing {model_type}"):
            try:
                res = future.result(timeout=SINGLE_FILE_HASH_TIMEOUT)
                if res and res.get("hash"):
                    res["model_type"] = model_type
                    if update_hash_in_db(res):
                        hashed_count += 1
            except TimeoutError:
                pass
            except Exception:
                pass

    db_manager.set_setting(last_sync_key, time.time())
    return {"found": len(files_to_hash), "hashed": hashed_count}


def get_local_model_maps(model_type, force_sync=False):
    sync_local_files_with_db(model_type, force=force_sync)
    with db_manager.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT hash, local_path FROM versions WHERE hash IS NOT NULL AND local_path IS NOT NULL AND model_type = ?",
            (model_type,),
        )
        rows = cursor.fetchall()
    abs_to_hash = {os.path.normpath(r["local_path"]): r["hash"] for r in rows}
    known = folder_paths.get_filename_list(model_type)
    hash_to_name = {}
    name_to_hash = {}
    for rel_path in known:
        full = os.path.normpath(folder_paths.get_full_path(model_type, rel_path))
        fh = abs_to_hash.get(full)
        if fh:
            hash_to_name[fh] = rel_path
            name_to_hash[rel_path] = fh
    return hash_to_name, name_to_hash


def get_model_filenames_from_db(model_type, force_sync=False):
    sync_local_files_with_db(model_type, force=force_sync)
    with db_manager.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT local_path FROM versions WHERE model_type = ? AND local_path IS NOT NULL ORDER BY local_path ASC",
            (model_type,),
        )
        rows = cursor.fetchall()
    known = folder_paths.get_filename_list(model_type)
    full_map = {os.path.normpath(folder_paths.get_full_path(model_type, f)): f for f in known}
    result = []
    for row in rows:
        rp = full_map.get(os.path.normpath(row["local_path"]))
        if rp:
            result.append(rp)
    return sorted(set(result))


def get_model_filenames_from_db_cached_only(model_type):
    with db_manager.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT local_path FROM versions WHERE model_type = ? AND local_path IS NOT NULL ORDER BY local_path ASC",
            (model_type,),
        )
        rows = cursor.fetchall()
    known = folder_paths.get_filename_list(model_type)
    if not known:
        return []
    full_map = {os.path.normpath(folder_paths.get_full_path(model_type, f)): f for f in known}
    result = []
    for row in rows:
        rp = full_map.get(os.path.normpath(row["local_path"]))
        if rp:
            result.append(rp)
    if not result:
        return sorted(known)
    return sorted(set(result))


def fetch_civitai_data_by_hash(model_hash, sort, limit, nsfw_level, filter_type=None):
    version_info = CivitaiAPIUtils.get_model_version_info_by_hash(model_hash)
    if not version_info or "id" not in version_info:
        raise ValueError("Could not find model version ID on Civitai.")
    version_id = version_info["id"]
    domain = _get_active_domain()
    results, page = [], 1
    api_limit = 100
    with tqdm(total=limit, desc="Fetching Recipes") as pbar:
        while len(results) < limit:
            params = {
                "modelVersionId": version_id, "limit": api_limit,
                "sort": sort, "nsfw": nsfw_level, "page": page,
            }
            try:
                resp = CivitaiAPIUtils._request_with_retry(
                    f"https://{domain}/api/v1/images", params=params
                )
                items = resp.json().get("items", [])
            except Exception:
                break
            if not items:
                break
            items_with_meta = [img for img in items if img.get("meta")]
            page_filtered = items_with_meta
            if filter_type == "video":
                page_filtered = [img for img in items_with_meta if img.get("type") == "video"]
            elif filter_type == "image":
                page_filtered = [img for img in items_with_meta if img.get("type") != "video"]
            results.extend(page_filtered)
            pbar.update(min(len(results), limit) - pbar.n)
            page += 1
            if len(results) >= limit:
                break
            time.sleep(0.1)
    final = results[:limit]
    for img in final:
        db_manager.add_downloaded_image(url=img["url"], version_id=version_id, meta=img.get("meta"))
    return final


def extract_resources_from_meta(meta, filename_to_lora_hash_map, session_cache=None):
    if not isinstance(meta, dict):
        return {"ckpt_hash": None, "ckpt_name": "unknown", "loras": [], "vaes": []}
    if session_cache is None:
        session_cache = {}
    ckpt_hash = meta.get("Model hash")
    ck_name = meta.get("Model")
    loras, vaes = [], []
    seen_hashes, seen_names = set(), set()

    def add_lora(info):
        h, n = info.get("hash"), info.get("name")
        if h and h in seen_hashes:
            return
        if not h and n and n in seen_names:
            return
        loras.append(info)
        if h:
            seen_hashes.add(h)
        if n:
            seen_names.add(n)

    if isinstance(meta.get("civitaiResources"), list):
        for res in meta["civitaiResources"]:
            if not isinstance(res, dict) or not (vid := res.get("modelVersionId")):
                continue
            cached = session_cache.get(str(vid))
            if not cached:
                continue
            vinfo, rhash = cached.get("info"), cached.get("hash")
            rtype = res.get("type", "").lower()
            if vinfo and not rtype:
                rtype = vinfo.get("model", {}).get("type", "").lower()
            if rtype == "lora":
                add_lora({
                    "hash": rhash,
                    "name": res.get("modelVersionName") or (vinfo.get("model", {}).get("name") if vinfo else None),
                    "weight": safe_float(res.get("weight")),
                    "modelVersionId": vid,
                })
            elif rtype in ("checkpoint", "model") and not ckpt_hash:
                ckpt_hash = rhash
                if res.get("modelVersionName") and not ck_name:
                    ck_name = res["modelVersionName"]

    if isinstance(meta.get("resources"), list):
        for res in meta["resources"]:
            if isinstance(res, dict):
                if res.get("type", "").lower() == "lora":
                    ln, lh = res.get("name"), res.get("hash")
                    if not lh and ln:
                        lh = filename_to_lora_hash_map.get(ln) or filename_to_lora_hash_map.get(f"{ln}.safetensors")
                    add_lora({"hash": lh, "name": ln, "weight": safe_float(res.get("weight"))})
                elif res.get("type", "").lower() == "model" and not ckpt_hash:
                    ckpt_hash, ck_name = res.get("hash"), res.get("name")

    if isinstance(meta.get("hashes"), dict):
        if any(":" in k for k in meta["hashes"]):
            for key, short_hash in meta["hashes"].items():
                kl = key.lower()
                if kl.startswith("lora:"):
                    lora_fn = key[5:].replace("\\", "/").split("/")[-1]
                    fh = filename_to_lora_hash_map.get(lora_fn)
                    add_lora({"hash": fh or short_hash, "name": lora_fn, "weight": 1.0})
                elif kl.startswith("model:"):
                    ckpt_hash = short_hash
                    ck_name = key[6:]
                elif kl == "model" and not ckpt_hash:
                    ckpt_hash = short_hash
                elif "vae" in kl:
                    vaes.append({"hash": short_hash, "name": key})
        elif isinstance(meta["hashes"].get("lora"), dict):
            for hval, w in meta["hashes"]["lora"].items():
                add_lora({"hash": hval, "name": None, "weight": safe_float(w)})

    for i in range(1, 10):
        if meta.get(f"AddNet Module {i}") == "LoRA" and f"AddNet Model {i}" in meta:
            ms = meta.get(f"AddNet Model {i}", "")
            m = re.search(r"\((\w+)\)", ms)
            if m:
                add_lora({
                    "hash": m.group(1),
                    "name": ms.split("(")[0].strip(),
                    "weight": safe_float(meta.get(f"AddNet Weight A {i}")),
                })
    return {"ckpt_hash": ckpt_hash, "ckpt_name": ck_name, "loras": loras, "vaes": vaes}


def get_metadata(filepath, model_type):
    fp = folder_paths.get_full_path(model_type, filepath)
    if not fp:
        return None
    try:
        with open(fp, "rb") as f:
            header_size = int.from_bytes(f.read(8), "little", signed=False)
            if header_size <= 0:
                return None
            header = f.read(header_size)
            return json.loads(header).get("__metadata__")
    except Exception:
        return None


def sort_tags_by_frequency(meta_tags):
    if not meta_tags or "ss_tag_frequency" not in meta_tags:
        return []
    try:
        tf = json.loads(meta_tags["ss_tag_frequency"])
        counts = Counter()
        for ds in tf.values():
            for tag, count in ds.items():
                counts[str(tag).strip()] += count
        return [t for t, _ in counts.most_common()]
    except Exception:
        return []


def safe_float(value, default=1.0):
    if value is None:
        return default
    if isinstance(value, (float, int)):
        return float(value)
    try:
        return float(value)
    except (ValueError, TypeError):
        return default


def get_civitai_triggers(file_name, file_hash, force_refresh):
    if force_refresh == "no":
        v = db_manager.get_version_by_hash(file_hash)
        if v and v["trained_words"]:
            try:
                return json.loads(v["trained_words"])
            except Exception:
                pass
    info = CivitaiAPIUtils.get_model_version_info_by_hash(file_hash, force_refresh=False)
    return info.get("trainedWords", []) if info and isinstance(info.get("trainedWords"), list) else []


def format_info_as_markdown(meta, recipe_loras, lora_hash_map, missing_ckpt_hash=None):
    if not meta:
        return "_No metadata available._"
    lines = ["## Recipe Details\n"]
    fields = [
        ("prompt", "Prompt"), ("negativePrompt", "Negative Prompt"),
        ("Model", "Model"), ("Model hash", "Model Hash"),
        ("seed", "Seed"), ("steps", "Steps"), ("cfgScale", "CFG Scale"),
        ("sampler", "Sampler"), ("scheduler", "Scheduler"),
        ("Size", "Size"), ("Denoising strength", "Denoising Strength"),
    ]
    for key, title in fields:
        val = meta.get(key)
        if val:
            lines.append(f"**{title}:** `{val}`")
    if recipe_loras:
        lines.append("\n### LoRAs Used\n")
        for l in recipe_loras:
            lhash = l.get("hash", "?")[:12] if l.get("hash") else "?"
            lname = l.get("name", "unknown")
            lw = l.get("weight", 1.0)
            link = ""
            if l.get("hash") and l["hash"] in lora_hash_map:
                link = f" → _{lora_hash_map[l['hash']]}_"
            lines.append(f"- `{lname}` (hash: `{lhash}`, weight: `{lw}`){link}")
    if missing_ckpt_hash:
        domain = _get_active_domain()
        lines.append(f"\n⚠️ **Missing Checkpoint:** [Search on Civitai](https://{domain}/models?query={missing_ckpt_hash[:12]})")
    return "\n".join(lines)


def format_tags_as_markdown(pos_items, neg_items, top_n):
    lines = ["## Prompt Tag Analysis\n"]
    if pos_items:
        lines.extend(["### Positive Tags", "| Rank | Tag | Count |", "|:----:|:----|:-----:|"])
        lines.extend(
            f"| {i + 1} | `{tag}` | **{count}** |" for i, (tag, count) in enumerate(pos_items[:top_n])
        )
    else:
        lines.append("_No positive tags found._")
    lines.append("\n")
    if neg_items:
        lines.extend(["### Negative Tags", "| Rank | Tag | Count |", "|:----:|:----|:-----:|"])
        lines.extend(
            f"| {i + 1} | `{tag}` | **{count}** |" for i, (tag, count) in enumerate(neg_items[:top_n])
        )
    else:
        lines.append("_No negative tags found._")
    return "\n".join(lines)


def format_parameters_as_markdown(param_counts, total_images):
    if total_images == 0:
        return "No parameter data found."
    lines = ["### Generation Parameters Analysis\n"]
    param_map = {
        "sampler": "Sampler", "scheduler": "Scheduler", "cfgScale": "CFG Scale",
        "steps": "Steps", "Size": "Size", "Denoising strength": "Hires Denoising Strength",
    }
    for key, title in param_map.items():
        lines.append(f"#### {title}\n")
        stats = Counter(param_counts.get(key, {})).most_common(5)
        if not stats:
            lines.append("_No data found._\n")
            continue
        lines.extend(["| Value | Count |", "|:------|:-----:|"])
        lines.extend(f"| {k} | **{c}** |" for k, c in stats)
        lines.append("")
    return "\n".join(lines)


def format_resources_as_markdown(assoc_stats, total_images, top_n=10):
    lines = ["### Resource Association Analysis\n"]
    for rtype, title in [("lora", "LoRA"), ("vae", "VAE")]:
        stats = assoc_stats.get(rtype, {})
        if not stats:
            continue
        sorted_stats = sorted(stats.items(), key=lambda x: x[1]["count"], reverse=True)[:top_n]
        lines.append(f"#### Most Used {title}s\n")
        lines.extend(["| Name | Usage Count |", "|:-----|:-----------:|"])
        for key, s in sorted_stats:
            pct = s["count"] / total_images * 100
            name = s.get("name", key)[:60]
            lines.append(f"| {name} | **{s['count']}** ({pct:.1f}%) |")
        lines.append("")
    return "\n".join(lines)


def get_all_local_models_with_details(force_refresh=False):
    result = []
    for model_type in ["checkpoints", "loras", "vae"]:
        try:
            name_to_hash, _ = get_local_model_maps(model_type, force_sync=force_refresh)
        except Exception:
            continue
        for name, fhash in name_to_hash.items():
            full_path = folder_paths.get_full_path(model_type, name)
            size = os.path.getsize(full_path) if full_path and os.path.exists(full_path) else 0
            size_str = f"{size / 1e9:.1f} GB" if size > 1e9 else f"{size / 1e6:.1f} MB"
            civitai_info = None
            if fhash:
                try:
                    ci = CivitaiAPIUtils.get_model_version_info_by_hash(fhash)
                    if ci:
                        civitai_info = {
                            "name": ci.get("model", {}).get("name", ci.get("name", "")),
                            "id": ci.get("modelId"),
                            "url": f"https://{_get_active_domain()}/models/{ci.get('modelId')}",
                        }
                except Exception:
                    pass
            result.append({
                "name": name, "type": model_type, "path": full_path,
                "size": size_str, "hash": fhash,
                "hasCivitai": civitai_info is not None,
                "civitai": civitai_info,
            })
    return result


def initiate_background_scan(main_loop):
    def _scan():
        try:
            for mt in ["checkpoints", "loras"]:
                sync_local_files_with_db(mt, force=False)
        except Exception:
            pass
    threading.Thread(target=_scan, daemon=True).start()
