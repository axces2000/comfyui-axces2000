"""
comfyui-axces2000
Custom ComfyUI nodes by axces2000.

Nodes:
  - AudioLoader       (🎵 Audio Loader)
  - ResolutionMaster  (📐 Resolution Master)
"""

from .audio_loader.audio_loader import (
    NODE_CLASS_MAPPINGS as AUDIO_MAPPINGS,
    NODE_DISPLAY_NAME_MAPPINGS as AUDIO_NAMES,
)
from .resolution_master.resolution_master import (
    NODE_CLASS_MAPPINGS as RESOLUTION_MAPPINGS,
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

# ComfyUI scans this directory for .js files to serve to the frontend.
# Both sub-modules place their JS inside their own /js subfolder,
# but ComfyUI only supports a single WEB_DIRECTORY per package.
# We therefore copy/symlink both JS files into a top-level /js folder,
# OR we can serve them from a shared top-level js/ directory (see below).
WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
