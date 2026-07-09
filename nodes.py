import time


# Shared storage for prompts sent from the UI
_prompt_store = {
    "positive": "",
    "negative": "",
    "updated_at": 0,
}


class PromptFetcher:
    """A simple node that outputs positive and negative prompts.
    
    Prompts are set from the Civitai+HF Downloader UI when you click
    the ⚡ Use in workflow button on any model's preview image.
    """

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return _prompt_store["updated_at"]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("positive_prompt", "negative_prompt")
    FUNCTION = "execute"
    CATEGORY = "Civitai"
    OUTPUT_NODE = True

    def execute(self, unique_id=None):
        pos = _prompt_store.get("positive", "")
        neg = _prompt_store.get("negative", "")
        return (pos, neg)


def set_prompts(positive, negative):
    """Called from the server when the UI sends prompts."""
    _prompt_store["positive"] = positive or ""
    _prompt_store["negative"] = negative or ""
    _prompt_store["updated_at"] = time.time()


def get_prompts():
    """Called from the server to return current prompts."""
    return {
        "positive": _prompt_store.get("positive", ""),
        "negative": _prompt_store.get("negative", ""),
    }


NODE_CLASS_MAPPINGS = {
    "PromptFetcher": PromptFetcher,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PromptFetcher": "Prompt Fetcher",
}
