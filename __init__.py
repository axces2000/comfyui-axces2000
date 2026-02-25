"""
comfyui-axces2000
Custom ComfyUI nodes by axces2000.

Nodes:
  - AudioLoader       (🎵 Audio Loader)
  - ResolutionMaster  (📐 Resolution Master)
"""

from .audio_loader.audio_loader import (
    NODE_CLASS_MAPPINGS        as AUDIO_MAPPINGS,
    NODE_DISPLAY_NAME_MAPPINGS as AUDIO_NAMES,
)
from .resolution_master.resolution_master import (
    NODE_CLASS_MAPPINGS        as RESOLUTION_MAPPINGS,
    NODE_DISPLAY_NAME_MAPPINGS as RESOLUTION_NAMES,
)

NODE_CLASS_MAPPINGS = {
    **AUDIO_MAPPINGS,
    **RESOLUTION_MAPPINGS,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    **AUDIO_NAMES,
    **RESOLUTION_NAMES,
}

# ComfyUI serves JS from a single WEB_DIRECTORY.
# The canonical sources live in each node's own js/ subfolder.
# Run `make js` to sync them here before committing.
WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
