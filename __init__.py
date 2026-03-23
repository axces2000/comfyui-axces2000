"""
comfyui-axces2000
Custom ComfyUI nodes by axces2000.

Nodes:
  - AudioLoader       (🎵 Audio Loader)
  - ResolutionMaster  (📐 Resolution Master)
  - StringExtractor   (✂️ String Extractor)
  - StringCombine     (🔗 String Combine)
"""

from .audio_loader.audio_loader import (
    NODE_CLASS_MAPPINGS        as AUDIO_MAPPINGS,
    NODE_DISPLAY_NAME_MAPPINGS as AUDIO_NAMES,
)
from .resolution_master.resolution_master import (
    NODE_CLASS_MAPPINGS        as RESOLUTION_MAPPINGS,
    NODE_DISPLAY_NAME_MAPPINGS as RESOLUTION_NAMES,
)
from .string_extractor.string_extractor import (
    NODE_CLASS_MAPPINGS        as EXTRACTOR_MAPPINGS,
    NODE_DISPLAY_NAME_MAPPINGS as EXTRACTOR_NAMES,
)
from .string_combine.string_combine import (
    NODE_CLASS_MAPPINGS        as COMBINE_MAPPINGS,
    NODE_DISPLAY_NAME_MAPPINGS as COMBINE_NAMES,
)

NODE_CLASS_MAPPINGS = {
    **AUDIO_MAPPINGS,
    **RESOLUTION_MAPPINGS,
    **EXTRACTOR_MAPPINGS,
    **COMBINE_MAPPINGS,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    **AUDIO_NAMES,
    **RESOLUTION_NAMES,
    **EXTRACTOR_NAMES,
    **COMBINE_NAMES,
}

WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]