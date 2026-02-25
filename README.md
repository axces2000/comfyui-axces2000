# comfyui-axces2000

Custom ComfyUI nodes by **axces2000** — quality utility nodes for audio handling and image dimension management.

---

## Nodes

### 🎵 Audio Loader
Load audio files directly into your ComfyUI workflow with a full-featured waveform interface.

**Features**
- Drag & drop audio files onto the node canvas
- Waveform visualisation with played/unplayed colouring
- Click or drag on the waveform to seek
- Play / Pause / Stop transport controls
- Current position and total duration displayed as `HH:MM:SS.mmm`
- Supports MP3, WAV, FLAC, OGG, AAC, M4A, OPUS

**Outputs**

| Name | Type | Description |
|------|------|-------------|
| `audio` | AUDIO | Waveform tensor + sample rate dict, compatible with native ComfyUI audio nodes |
| `sample_rate` | INT | Sample rate in Hz |
| `duration_seconds` | FLOAT | Duration in seconds |
| `metadata` | STRING | File info: name, sample rate, channels, samples, size |

---

### 📐 Resolution Master
Pick a standard resolution and orientation, get clean width/height integers out — no more mental arithmetic.

**Features**
- Visual orientation selector — landscape, square, portrait icons
- Live preview of output pixel values inside the node
- Covers SD through 8K

**Resolution table**

|             | SD (480p) | 1K (720p)  | 1.3K (768p) | 2K (1080p) | 2.5K (1440p) | 4K (2160p) | 8K (4320p) |
|-------------|-----------|------------|-------------|------------|--------------|------------|------------|
| Landscape   | 720×480   | 1280×720   | 1344×768    | 1920×1080  | 2560×1440    | 3840×2160  | 7680×4320  |
| Square      | 512×512   | 1024×1024  | 1024×1024   | 1536×1536  | 1920×1920    | 2048×2048  | 5760×5760  |
| Portrait    | 480×720   | 720×1280   | 768×1344    | 1080×1920  | 1440×2560    | 2160×3840  | 4320×7680  |

**Outputs**

| Name | Type | Description |
|------|------|-------------|
| `width` | INT | Output width in pixels |
| `height` | INT | Output height in pixels |
| `resolution_string` | STRING | e.g. `1920x1080` |

---

## Installation

### Via ComfyUI Manager (recommended)
Search for **axces2000** or **Audio Loader** / **Resolution Master** in the Custom Nodes section.

### Manual
```bash
cd ComfyUI/custom_nodes
git clone https://github.com/axces2000/comfyui-axces2000.git
pip install -r comfyui-axces2000/requirements.txt
```
Then restart ComfyUI.

---

## Requirements

- ComfyUI (any recent version)
- `torchaudio` — installed automatically via ComfyUI Manager, or manually with `pip install torchaudio`

---

## File structure

```
comfyui-axces2000/
├── __init__.py                          # Package entry point
├── requirements.txt
├── pyproject.toml                       # Comfy Registry metadata
├── LICENSE.txt
│
├── audio_loader/
│   ├── __init__.py
│   ├── audio_loader.py                  # Python node
│   └── js/
│       └── audio_loader.js              # Frontend widget (source)
│
├── resolution_master/
│   ├── __init__.py
│   ├── resolution_master.py             # Python node
│   └── js/
│       └── resolution_master.js         # Frontend widget (source)
│
└── js/                                  # Served by ComfyUI (WEB_DIRECTORY)
    ├── audio_loader.js                  # Synced from audio_loader/js/
    └── resolution_master.js             # Synced from resolution_master/js/
```

> **Note for contributors:** JS source files live in each node's subfolder. Run `make js` to sync them into the top-level `js/` directory that ComfyUI serves. This is handled automatically by the pre-commit hook if you set it up — see `Makefile` for details.

---

## Contributing

Issues and PRs are welcome. Please open an issue first for large changes.

---

## License

MIT © axces2000
