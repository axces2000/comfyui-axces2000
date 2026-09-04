"""
comfyui-axces2000
Custom ComfyUI nodes by axces2000.

Nodes:
  - AudioLoader                 (🎵 Audio Loader)
  - AudioPlayerNode             (🎵 Audio Player)
  - ArtifactFrequencyAnalyzer   (🎵 Artifact Frequency Analyzer)
  - ArtifactCleaner             (🎵 Artifact Cleaner)
  - ResolutionMaster            (📐 Resolution Master)
  - StringExtractor             (✂️ String Extractor)
  - StringCombine               (🔗 String Combine)
"""

from .audio_loader.audio_loader import (
    NODE_CLASS_MAPPINGS        as AUDIO_LOADER_MAPPINGS,
    NODE_DISPLAY_NAME_MAPPINGS as AUDIO_LOADER_NAMES,
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
from .audio_player.audio_player_node import (
    NODE_CLASS_MAPPINGS        as AUDIO_PLAYER_MAPPINGS,
    NODE_DISPLAY_NAME_MAPPINGS as AUDIO_PLAYER_NAMES,
)

from .audio_artifact_cleaner.artifact_analyzer import (
    NODE_CLASS_MAPPINGS as _ANALYZER_NODES,
    NODE_DISPLAY_NAME_MAPPINGS as _ANALYZER_NAMES,
)
from .audio_artifact_cleaner.artifact_cleaner import (
    NODE_CLASS_MAPPINGS as _CLEANER_NODES,
    NODE_DISPLAY_NAME_MAPPINGS as _CLEANER_NAMES,
)



NODE_CLASS_MAPPINGS = {
    **AUDIO_LOADER_MAPPINGS,
    **RESOLUTION_MAPPINGS,
    **EXTRACTOR_MAPPINGS,
    **COMBINE_MAPPINGS,
    **AUDIO_PLAYER_MAPPINGS,
    **_ANALYZER_NODES, 
    **_CLEANER_NODES,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    **AUDIO_LOADER_NAMES,
    **RESOLUTION_NAMES,
    **EXTRACTOR_NAMES,
    **COMBINE_NAMES,
    **AUDIO_PLAYER_NAMES,
    **_ANALYZER_NAMES, 
    **_CLEANER_NAMES,
}

WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
