"""
String Extractor Node for ComfyUI

Fully stateless. JS widget.beforeQueued() advances the index before each
queued prompt is serialised — Python receives the correct value each run.
"""

import random

MODES = ["Keep", "Increment", "Randomise"]


class StringExtractorNode:

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text":  ("STRING", {"multiline": True, "default": ""}),
                "index": ("INT",    {"default": 0, "min": 0, "max": 9999}),
                "mode":  (MODES,    {"default": "Keep"}),
            }
        }

    RETURN_TYPES  = ("STRING", "INT")
    RETURN_NAMES  = ("text_out", "index_out")
    FUNCTION      = "extract"
    CATEGORY      = "text"
    OUTPUT_NODE   = True

    def extract(self, text: str, index: int, mode: str):
        lines = [ln for ln in text.splitlines() if ln.strip() != ""]
        count = len(lines)

        if index == 0 or index > count:
            return (text, 0)

        line = lines[index - 1]
        if not line.endswith(" "):
            line = line + " "

        if mode == "Increment":
            index_out = (index % count) + 1
        elif mode == "Randomise":
            index_out = random.randint(1, count)
        else:
            index_out = index

        return (line, index_out)

    @classmethod
    def IS_CHANGED(cls, text, index, mode):
        if mode == "Randomise" and index > 0:
            return float("nan")
        return f"{text}|{index}|{mode}"


NODE_CLASS_MAPPINGS        = {"StringExtractor": StringExtractorNode}
NODE_DISPLAY_NAME_MAPPINGS = {"StringExtractor": "✂️ String Extractor"}
