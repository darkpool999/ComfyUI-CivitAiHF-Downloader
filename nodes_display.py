from markdown_it import MarkdownIt


class MarkdownPresenter:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": ("STRING", {"forceInput": True, "multiline": True, "default": ""}),
            },
        }

    RETURN_TYPES = ()
    FUNCTION = "execute"
    OUTPUT_NODE = True
    CATEGORY = "Display"

    def execute(self, text):
        md_text = text or ""
        md = MarkdownIt("commonmark", {"html": True}).enable("table")

        def _link_open(self, tokens, idx, options, env):
            tokens[idx].attrSet("target", "_blank")
            tokens[idx].attrSet("rel", "noopener noreferrer")
            return self.renderToken(tokens, idx, options, env)

        md.renderer.rules["link_open"] = _link_open.__get__(md.renderer)
        html = md.render(md_text)
        return {"ui": {"rendered_html": [html]}}


NODE_CLASS_MAPPINGS = {"MarkdownPresenter": MarkdownPresenter}
NODE_DISPLAY_NAME_MAPPINGS = {"MarkdownPresenter": "Markdown Presenter"}
