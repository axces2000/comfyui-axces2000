"""
String Extractor Node for ComfyUI
"""

import random

MODES = ["Keep", "Increment", "Randomise"]

# Server-side state store keyed by node unique_id.
# This persists between executions within a ComfyUI session, allowing
# Increment/Randomise to advance correctly across batched/scheduled runs
# without depending on the frontend widget value being updated first.
_node_state: dict = {}


class StringExtractorNode:

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text":  ("STRING", {"multiline": True, "default": ""}),
                "index": ("INT",    {"default": 0, "min": 0, "max": 9999}),
                "mode":  (MODES,    {"default": "Keep"}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            }
        }

    RETURN_TYPES  = ("STRING", "INT")
    RETURN_NAMES  = ("text_out", "index_out")
    FUNCTION      = "extract"
    CATEGORY      = "text"
    OUTPUT_NODE   = True

    def extract(self, text: str, index: int, mode: str, unique_id: str = "0"):
        lines = [ln for ln in text.splitlines() if ln.strip() != ""]
        count = len(lines)

        # ── Resolve the working index ─────────────────────────────────────────
        # For Keep mode (or out-of-range), use the widget value directly.
        # For Increment/Randomise, use server-side state so batched runs each
        # get a different value regardless of what the frontend widget shows.
        state = _node_state.get(unique_id, {})

        if mode == "Keep" or index == 0 or count == 0:
            # Keep or passthrough — use widget value, clear stored state
            working_index = index
            _node_state.pop(unique_id, None)
        else:
            # Increment / Randomise — use stored state if available,
            # otherwise seed from widget value on first run
            working_index = state.get("index", index)

            # Clamp in case the text changed and count shrunk
            if working_index > count:
                working_index = 1

        # ── Compute output ────────────────────────────────────────────────────
        if working_index == 0 or working_index > count:
            text_out  = text
            index_out = 0
            _node_state.pop(unique_id, None)
        else:
            line = lines[working_index - 1]
            if not line.endswith(" "):
                line = line + " "
            text_out = line

            if mode == "Increment":
                index_out = (working_index % count) + 1
            elif mode == "Randomise":
                index_out = random.randint(1, count)
            else:
                index_out = working_index

            # Store the next index for the following execution
            _node_state[unique_id] = {"index": index_out}

        return {
            "ui":     {"index_out": [index_out]},
            "result": (text_out, index_out),
        }

    @classmethod
    def IS_CHANGED(cls, text, index, mode, unique_id="0"):
        if mode in ("Increment", "Randomise") and index > 0:
            return float("nan")
        return f"{text}|{index}|{mode}"


NODE_CLASS_MAPPINGS        = {"StringExtractor": StringExtractorNode}
NODE_DISPLAY_NAME_MAPPINGS = {"StringExtractor": "✂️ String Extractor"}
