import re
import time
import hashlib
import io
import urllib.request
import urllib.parse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
import torch
from PIL import Image
import numpy as np
from tqdm import tqdm

from . import utils


def get_model_list(model_type):
    return utils.get_model_filenames_from_db_cached_only(model_type)


class CivitaiRecipeGallery:
    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return utils.db_manager.get_setting("last_selection_time", time.time())

    @classmethod
    def INPUT_TYPES(cls):
        supported = ["checkpoints", "loras", "vae", "embeddings", "diffusion_models", "text_encoders", "hypernetworks"]
        all_names = []
        for mt in supported:
            names = utils.get_model_filenames_from_db_cached_only(mt)
            if names:
                all_names.extend(names)
        all_names = sorted(set(all_names))
        return {
            "required": {
                "model_type": (supported,),
                "model_name": (all_names,),
                "sort": (["Most Reactions", "Most Comments", "Newest"],),
                "nsfw_level": (["None", "Soft", "Mature", "X"],),
                "image_limit": ("INT", {"default": 32, "min": 1, "max": 100}),
                "filter_type": (["all", "image", "video"], {"default": "image"}),
            },
            "hidden": {"unique_id": "UNIQUE_ID"},
        }

    RETURN_TYPES = ("IMAGE", "STRING", "RECIPE_PARAMS")
    RETURN_NAMES = ("image", "info_md", "recipe_params")
    FUNCTION = "execute"
    CATEGORY = "Civitai/🖼️ Gallery"
    OUTPUT_NODE = True

    def execute(self, model_type, model_name, sort, nsfw_level, image_limit, filter_type, unique_id):
        lora_hash_map, lora_name_map = utils.get_local_model_maps("loras")
        ckpt_hash_map, _ = utils.get_local_model_maps("checkpoints")
        selections = utils.db_manager.get_setting("selections", {})
        node_sel = selections.get(str(unique_id), {})
        item_data = node_sel.get("item", {})
        should_download = node_sel.get("download_image", False)
        meta = item_data.get("meta", {})
        if not isinstance(meta, dict):
            meta = {}

        session_cache = {}
        extracted = utils.extract_resources_from_meta(meta, lora_name_map, session_cache)
        ckpt_hash = extracted.get("ckpt_hash")
        missing_ckpt_hash = None
        main_model_filename = model_name
        fallback_ckpt_name = main_model_filename

        if model_type != "checkpoints":
            ckpts = get_model_list("checkpoints")
            fallback_ckpt_name = ckpts[0] if ckpts else "model_not_found.safetensors"

        if ckpt_hash:
            found = ckpt_hash_map.get(ckpt_hash.lower())
            if found:
                final_ckpt_name = found
            else:
                final_ckpt_name = fallback_ckpt_name
                missing_ckpt_hash = ckpt_hash
        else:
            final_ckpt_name = fallback_ckpt_name

        recipe_loras = extracted.get("loras", [])
        image_url = item_data.get("url")
        image_tensor = torch.zeros(1, 64, 64, 3)
        if should_download and image_url:
            clean_url = re.sub(r"/(width|height|fit|quality|format)=\w+", "", image_url)
            image_tensor = self._download_image(clean_url)

        info_md = utils.format_info_as_markdown(meta, recipe_loras, lora_hash_map, missing_ckpt_hash)
        params = self._pack_recipe_params(meta, final_ckpt_name)
        return (image_tensor, info_md, params)

    def _pack_recipe_params(self, meta, ckpt_name):
        if not meta:
            return ()
        sampler_raw = meta.get("sampler", "Euler a")
        scheduler_raw = meta.get("scheduler", "normal")
        final_sampler, final_scheduler = sampler_raw, scheduler_raw
        for sched in ["Karras", "SGM Uniform"]:
            if sampler_raw.endswith(f" {sched}"):
                final_sampler = sampler_raw[: -len(f" {sched}")]
                final_scheduler = sched
                break
        try:
            w, h = map(int, meta.get("Size", "512x512").split("x"))
        except Exception:
            w, h = 512, 512
        return (
            ckpt_name,
            meta.get("prompt", ""),
            meta.get("negativePrompt", ""),
            int(meta.get("seed", -1)),
            int(meta.get("steps", 25)),
            float(meta.get("cfgScale", 7.0)),
            utils.SAMPLER_SCHEDULER_MAP.get(final_sampler.strip(), "euler_ancestral"),
            utils.SAMPLER_SCHEDULER_MAP.get(final_scheduler.strip(), "normal"),
            w, h,
            float(meta.get("Denoising strength", 1.0)),
        )

    def _download_image(self, url):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = resp.read()
            img = Image.open(io.BytesIO(data)).convert("RGB")
            arr = np.array(img).astype(np.float32) / 255.0
            return torch.from_numpy(arr)[None,]
        except Exception:
            return torch.zeros(1, 64, 64, 3)


class RecipeParamsParser:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"recipe_params": ("RECIPE_PARAMS",)}}

    RETURN_TYPES = (get_model_list("checkpoints"), "STRING", "STRING", "INT", "INT", "FLOAT",
                    "STRING", "STRING", "INT", "INT", "FLOAT")
    RETURN_NAMES = ("ckpt_name", "positive_prompt", "negative_prompt", "seed", "steps",
                    "cfg", "sampler_name", "scheduler", "width", "height", "denoise")
    FUNCTION = "execute"
    CATEGORY = "Civitai/🖼️ Gallery"

    def execute(self, recipe_params):
        if not recipe_params or len(recipe_params) < 11:
            ckpts = get_model_list("checkpoints")
            return (ckpts[0] if ckpts else "none", "", "", -1, 25, 7.0,
                    "euler_ancestral", "normal", 512, 512, 1.0)
        return tuple(recipe_params)


class LoraTriggerWords:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "lora_name": (get_model_list("loras"),),
                "force_refresh": (["no", "yes"], {"default": "no"}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING")
    RETURN_NAMES = ("metadata_triggers", "civitai_triggers", "triggers_md")
    FUNCTION = "execute"
    CATEGORY = "Civitai"

    def execute(self, lora_name, force_refresh):
        meta_triggers = utils.sort_tags_by_frequency(utils.get_metadata(lora_name, "loras"))
        civ_triggers = []
        try:
            _, name_to_hash = utils.get_local_model_maps("loras")
            fh = name_to_hash.get(lora_name)
            if fh:
                civ_triggers = utils.get_civitai_triggers(lora_name, fh, force_refresh)
        except Exception:
            pass

        meta_str = ", \n".join(meta_triggers) if meta_triggers else "[No Data Found]"
        civ_str = ", ".join(civ_triggers) if civ_triggers else "[No Data Found]"

        def _table(items, title):
            if not items:
                return f"| {title} |\n|:---|\n| *[No Data Found]* |"
            lines = [f"| {title} |", "|:---|"]
            lines.extend(f"| `{t}` |" for t in items)
            return "\n".join(lines)

        md = f"{_table(meta_triggers, 'Triggers from Metadata')}\n\n{_table(civ_triggers, 'Triggers from Civitai API')}"
        return (meta_str, civ_str, md)


class CivitaiModelAnalyzer:
    FOLDER_KEY = None

    @classmethod
    def IS_CHANGED(cls, model_name, image_limit, sort, nsfw_level, filter_type, force_refresh, **kwargs):
        if force_refresh == "yes":
            return time.time()
        return hashlib.sha256(
            f"{model_name}-{image_limit}-{sort}-{nsfw_level}-{filter_type}".encode()
        ).hexdigest()

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model_name": (get_model_list(cls.FOLDER_KEY),),
                "image_limit": ("INT", {"default": 100, "min": 1, "max": 1000}),
                "sort": (["Most Reactions", "Most Comments", "Newest"],),
                "nsfw_level": (["None", "Soft", "Mature", "X"],),
                "filter_type": (["all", "image", "video"],),
                "summary_top_n": ("INT", {"default": 10, "min": 1, "max": 100}),
                "force_refresh": (["no", "yes"],),
            }
        }

    RETURN_TYPES = ("STRING", "STRING", "CIVITAI_PARAMS")
    RETURN_NAMES = ("full_report_md", "fetch_summary", "params_pipe")
    FUNCTION = "execute"
    CATEGORY = "Civitai/📊 Analyzer"

    def _get_analysis_data(self, model_name, image_limit, sort, nsfw_level, filter_type, force_refresh):
        fingerprint = self.IS_CHANGED(model_name, image_limit, sort, nsfw_level, filter_type, "no")
        if force_refresh == "no":
            cached = utils.db_manager.get_analysis_cache(fingerprint)
            if cached:
                return cached

        _, name_to_hash = utils.get_local_model_maps(self.FOLDER_KEY)
        fh = name_to_hash.get(model_name)
        if not fh:
            _, name_to_hash = utils.get_local_model_maps(self.FOLDER_KEY, force_sync=True)
            fh = name_to_hash.get(model_name)
            if not fh:
                raise Exception(f"Hash for '{model_name}' not found.")

        items = utils.fetch_civitai_data_by_hash(
            fh, sort, image_limit, nsfw_level,
            filter_type if filter_type != "all" else None,
        )
        all_metas = [item["meta"] for item in items if "meta" in item]
        if not all_metas:
            raise Exception("No images with metadata found on Civitai.")

        _, lora_name_map = utils.get_local_model_maps("loras")
        session_cache = {}
        version_ids = set()
        for meta in all_metas:
            if isinstance(meta.get("civitaiResources"), list):
                for res in meta["civitaiResources"]:
                    if isinstance(res, dict) and (vid := res.get("modelVersionId")):
                        version_ids.add(vid)

        domain = utils._get_active_domain()
        if version_ids:
            with ThreadPoolExecutor(max_workers=10) as ex:
                futures = {
                    ex.submit(utils.CivitaiAPIUtils.get_model_version_info_by_id, vid, domain): vid
                    for vid in version_ids
                }
                for future in tqdm(as_completed(futures), total=len(futures), desc="Pre-caching"):
                    vi = future.result()
                    vid = futures[future]
                    if vi:
                        fhv = (vi.get("files", [{}])[0].get("hashes", {}).get("SHA256") or "").lower()
                        session_cache[str(vid)] = {"info": vi, "hash": fhv}

        assoc_stats = {"lora": {}, "vae": {}}
        for meta in tqdm(all_metas, desc="Analyzing"):
            extracted = utils.extract_resources_from_meta(meta, lora_name_map, session_cache)
            for lora_info in extracted.get("loras", []):
                key = lora_info.get("hash") or lora_info.get("name")
                if not key:
                    continue
                if key not in assoc_stats["lora"]:
                    assoc_stats["lora"][key] = {"count": 0, "weights": [], "name": lora_info.get("name") or key}
                assoc_stats["lora"][key]["count"] += 1
                assoc_stats["lora"][key]["weights"].append(lora_info.get("weight", 1.0))
            for vae_info in extracted.get("vaes", []):
                key = vae_info.get("hash") or vae_info.get("name")
                if not key:
                    continue
                if key not in assoc_stats["vae"]:
                    assoc_stats["vae"][key] = {"count": 0, "name": vae_info.get("name") or key}
                assoc_stats["vae"][key]["count"] += 1

        pos_tokens, neg_tokens = [], []
        for meta in all_metas:
            pos_tokens.extend(utils.CivitaiAPIUtils._parse_prompts(meta.get("prompt", "")))
            neg_tokens.extend(utils.CivitaiAPIUtils._parse_prompts(meta.get("negativePrompt", "")))
        pos_common = Counter(pos_tokens).most_common()
        neg_common = Counter(neg_tokens).most_common()

        param_counters = {k: Counter() for k in ["sampler", "scheduler", "cfgScale", "steps", "Size", "Denoising strength"]}
        for meta in all_metas:
            for k in param_counters:
                if v := meta.get(k):
                    param_counters[k].update([str(v)])

        result = {
            "pos_common": pos_common, "neg_common": neg_common,
            "assoc_stats": assoc_stats,
            "param_counters": {k: dict(v) for k, v in param_counters.items()},
            "total_images": len(all_metas),
        }
        utils.db_manager.set_analysis_cache(fingerprint, result)
        return result

    def execute(self, model_name, image_limit, sort, nsfw_level, filter_type, summary_top_n, force_refresh):
        try:
            data = self._get_analysis_data(model_name, image_limit, sort, nsfw_level, filter_type, force_refresh)
            if not data:
                return ("Analysis failed.", "No data.", ())
            pos_common, neg_common = data["pos_common"], data["neg_common"]
            assoc_stats, total_images = data["assoc_stats"], data["total_images"]
            param_counts = data["param_counters"]

            tag_md = utils.format_tags_as_markdown(pos_common, neg_common, summary_top_n)
            resource_md = utils.format_resources_as_markdown(assoc_stats, total_images, summary_top_n)
            param_md = utils.format_parameters_as_markdown(param_counts, total_images)

            top_sampler = Counter(param_counts.get("sampler", {})).most_common(1)[0][0] if param_counts.get("sampler") else "Euler a"
            top_scheduler = Counter(param_counts.get("scheduler", {})).most_common(1)[0][0] if param_counts.get("scheduler") else "Karras"
            fs, fsch = top_sampler, top_scheduler
            for sched in ["Karras", "SGM Uniform"]:
                if top_sampler.endswith(f" {sched}"):
                    fs = top_sampler[: -len(f" {sched}")]
                    fsch = sched
                    break
            top_steps = int(Counter(param_counts.get("steps", {})).most_common(1)[0][0]) if param_counts.get("steps") else 25
            top_cfg = float(Counter(param_counts.get("cfgScale", {})).most_common(1)[0][0]) if param_counts.get("cfgScale") else 7.0
            sz = Counter(param_counts.get("Size", {})).most_common(1)[0][0] if param_counts.get("Size") else "512x512"
            try:
                tw, th = map(int, sz.split("x"))
            except Exception:
                tw, th = 512, 512
            top_denoise = float(Counter(param_counts.get("Denoising strength", {})).most_common(1)[0][0]) if param_counts.get("Denoising strength") else 1.0

            full_report = (
                f"# Civitai Analysis: {model_name}\n\n{param_md}\n\n{resource_md}\n\n{tag_md}"
            )
            summary = f"Analyzed {total_images} items for '{model_name}'."
            pipe = (model_name, "", "", -1, top_steps, top_cfg,
                    utils.SAMPLER_SCHEDULER_MAP.get(fs.strip(), "euler_ancestral"),
                    utils.SAMPLER_SCHEDULER_MAP.get(fsch.strip(), "karras"),
                    tw, th, top_denoise)
            return (full_report, summary, pipe)
        except Exception as e:
            return (f"Error: {e}", "Execution failed.", ())


class CivitaiModelAnalyzerCKPT(CivitaiModelAnalyzer):
    FOLDER_KEY = "checkpoints"


class CivitaiModelAnalyzerLORA(CivitaiModelAnalyzer):
    FOLDER_KEY = "loras"


class CivitaiParameterUnpacker:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"params_pipe": ("CIVITAI_PARAMS",)}}

    RETURN_TYPES = ("INT", "INT", "FLOAT", "STRING", "STRING", "INT", "INT", "FLOAT")
    RETURN_NAMES = ("seed", "steps", "cfg", "sampler", "scheduler", "width", "height", "denoise")
    FUNCTION = "execute"
    CATEGORY = "Civitai/📊 Analyzer"

    def execute(self, params_pipe):
        if not params_pipe or len(params_pipe) < 11:
            return (-1, 25, 7.0, "euler_ancestral", "karras", 512, 512, 1.0)
        _, _, _, seed, steps, cfg, sampler, scheduler, w, h, denoise = params_pipe
        return (seed, steps, cfg, sampler, scheduler, w, h, denoise)


NODE_CLASS_MAPPINGS = {
    "CivitaiRecipeGallery": CivitaiRecipeGallery,
    "RecipeParamsParser": RecipeParamsParser,
    "LoraTriggerWords": LoraTriggerWords,
    "CivitaiModelAnalyzerCKPT": CivitaiModelAnalyzerCKPT,
    "CivitaiModelAnalyzerLORA": CivitaiModelAnalyzerLORA,
    "CivitaiParameterUnpacker": CivitaiParameterUnpacker,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "CivitaiRecipeGallery": "Recipe Gallery",
    "RecipeParamsParser": "Get Parameters from Recipe",
    "LoraTriggerWords": "Lora Trigger Words",
    "CivitaiModelAnalyzerCKPT": "Model Analyzer (Checkpoint)",
    "CivitaiModelAnalyzerLORA": "Model Analyzer (LoRA)",
    "CivitaiParameterUnpacker": "Get Parameters from Analysis",
}
