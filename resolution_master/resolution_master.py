"""
Resolution Master Node for ComfyUI
Outputs width and height for standard resolutions across square/landscape/portrait orientations.
"""

# ─── Resolution table ─────────────────────────────────────────────────────────
RESOLUTIONS = {
    "SD (480p)":    {"landscape": (720,  480),  "square": (512,  512),  "portrait": (480,  720)},
    "LTX (704p)":   {"landscape": (1280, 704),  "square": (1024, 1024),  "portrait": (704, 1280)},
    "1K (720p)":    {"landscape": (1280, 720),  "square": (1024, 1024), "portrait": (720,  1280)},
    "1.3K (768p)":  {"landscape": (1344, 768),  "square": (1024, 1024), "portrait": (768,  1344)},
    "2K (1080p)":   {"landscape": (1920, 1080), "square": (1536, 1536), "portrait": (1080, 1920)},
    "2.5K (1440p)": {"landscape": (2560, 1440), "square": (1920, 1920), "portrait": (1440, 2560)},
    "4K (2160p)":   {"landscape": (3840, 2160), "square": (2048, 2048), "portrait": (2160, 3840)},
    "8K (4320p)":   {"landscape": (7680, 4320), "square": (5760, 5760), "portrait": (4320, 7680)},
}

ORIENTATIONS     = ["landscape", "square", "portrait"]
RESOLUTION_NAMES = list(RESOLUTIONS.keys())

# All valid combined values — this is what the JS widget serializes
# e.g. "2K (1080p)_landscape", "4K (2160p)_square", etc.
COMBINED_VALUES = [
    f"{res}_{orient}"
    for res in RESOLUTION_NAMES
    for orient in ORIENTATIONS
]


def parse_combined(value: str):
    """Split 'RES_NAME_orientation' into (res_name, orientation).
    The separator is the last underscore since res names never end with one."""
    last = value.rfind("_")
    if last == -1:
        return "1.3K (768p)", "landscape"
    res    = value[:last]
    orient = value[last + 1:]
    if res not in RESOLUTIONS or orient not in ORIENTATIONS:
        return "1.3K (768p)", "landscape"
    return res, orient


class ResolutionMasterNode:
    """
    Outputs width and height integers for a chosen resolution and orientation.
    The single 'resolution' input carries both values as 'RES_landscape' etc.,
    matched exactly to what the custom JS widget serializes.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                # One combined string input — the JS widget owns this entirely.
                # We list all valid values so ComfyUI's validator is satisfied.
                "resolution": (COMBINED_VALUES, {"default": "1.3K (768p)_landscape"}),
            }
        }

    RETURN_TYPES  = ("INT", "INT", "STRING")
    RETURN_NAMES  = ("width", "height", "resolution_string")
    FUNCTION      = "get_resolution"
    CATEGORY      = "image/dimensions"
    OUTPUT_NODE   = False

    def get_resolution(self, resolution):
        res, orient = parse_combined(resolution)
        w, h = RESOLUTIONS[res][orient]
        return (w, h, f"{w}x{h}")

    @classmethod
    def IS_CHANGED(cls, resolution):
        return resolution


NODE_CLASS_MAPPINGS = {
    "ResolutionMaster": ResolutionMasterNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ResolutionMaster": "📐 Resolution Master",
}
