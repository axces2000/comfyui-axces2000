"""
Audio Metadata
--------------
Takes an AUDIO input plus ID3 field values and a cover image, and gives you
a waveform preview with an on-demand "Save As" export — the node itself
does NOT write anything to disk permanently on every run. Format (WAV/MP3)
and bitrate are chosen at export time, exactly like Audio Player's download
menu: click "Save As", pick a format, the browser downloads it.

Design notes:

  - Execution ("stage") only renders a temp WAV + peaks + a resized cover
    JPEG + a tags sidecar. No ffmpeg call happens here — that's deferred to
    the /audio_metadata/export route, which only runs when the user clicks
    an export option in the widget. This mirrors Audio Player exactly:
    that node's Python side only ever writes a temp WAV; all format
    conversion happens on-demand in its /audio_player/audio/{filename}
    route, triggered by a click in showDownloadMenu().

  - Tags are written with mutagen, via two different tagging schemes:
      * MP3 (mutagen.mp3.MP3) and WAV (mutagen.wave.WAVE) both use ID3
        frames — verified locally that the same TIT2/TPE1/APIC classes and
        save(v2_version=3) work identically for both.
      * FLAC (mutagen.flac.FLAC) and OGG Vorbis (mutagen.oggvorbis.OggVorbis)
        use Vorbis comments instead — plain key/value fields ("title",
        "artist", "date", "tracknumber", ...). Cover art differs between
        the two: FLAC has a native PICTURE metadata block
        (FLAC.add_picture()), while Ogg Vorbis has no native picture block
        at all — cover art there is a base64-encoded FLAC Picture block
        stashed under the "metadata_block_picture" comment field, which is
        the de facto standard foobar2000/VLC/Picard/etc. all read. Verified
        both round-trip correctly, including the picture, before wiring
        this in.

  - Cover art is resized once at execution time (center-cropped to a
    square, then scaled) rather than at export time, since the export route
    may run long after the original IMAGE tensor is gone. 1000x1000 is the
    default: it's the de facto floor for Apple Music/iTunes-quality
    artwork, while 500x500 is the older minimum most car head units and
    dedicated players expect. Anything larger just bloats every exported
    copy of the file for no visible benefit at typical album-art display
    sizes.
"""

import io
import json
import os
import shutil
import struct
import subprocess
import tempfile
import uuid

import numpy as np
import folder_paths

# In-memory peaks cache, keyed by the temp filename. Mirrors AudioPlayerNode's
# _peaks_cache.
_am_peaks_cache = {}

COVER_SIZES        = ["500", "1000", "1500", "2000", "Original"]
DEFAULT_COVER_SIZE = "1000"


# ── Reused from audio_player_node.py (kept local/self-contained — this repo
#    keeps each node folder independent rather than cross-importing; see
#    audio_artifact_cleaner/*.py for the same convention) ────────────────────

def _save_wav(waveform, sample_rate: int, filepath: str):
    if waveform.dim() == 3:
        waveform = waveform[0]
    n_ch    = min(waveform.shape[0], 2)
    samples = np.clip(waveform[:n_ch].cpu().float().numpy(), -1.0, 1.0)
    interleaved = samples[0] if n_ch == 1 else samples.T.flatten()
    pcm       = (interleaved * 32767).astype(np.int16)
    n_frames  = waveform.shape[-1]
    data_size = n_frames * n_ch * 2
    with open(filepath, 'wb') as f:
        f.write(b"RIFF"); f.write(struct.pack("<I", 36 + data_size))
        f.write(b"WAVE"); f.write(b"fmt ")
        f.write(struct.pack("<IHHIIHH", 16, 1, n_ch, sample_rate,
                            sample_rate*n_ch*2, n_ch*2, 16))
        f.write(b"data"); f.write(struct.pack("<I", data_size))
        f.write(pcm.tobytes())


def _build_peaks(waveform, num_bars: int = 120) -> dict:
    if waveform.dim() == 3:
        waveform = waveform[0]
    result = {}
    for c in range(min(waveform.shape[0], 2)):
        samples = waveform[c].cpu().float().numpy()
        n       = len(samples)
        chunk   = max(1, n // num_bars)
        peaks   = []
        for i in range(num_bars):
            seg = samples[i * chunk:(i + 1) * chunk]
            peaks.append(float(np.sqrt((seg ** 2).mean())) if len(seg) else 0.0)
        mx = max(peaks) if max(peaks) > 0 else 1.0
        result[f"ch{c}"] = [round(p / mx, 4) for p in peaks]
    return result


# ── Cover art ────────────────────────────────────────────────────────────────

def _resize_cover_to_square(pil_img, target_px: int):
    """Center-crops to a square, then scales to target_px × target_px."""
    w, h = pil_img.size
    side = min(w, h)
    left = (w - side) // 2
    top  = (h - side) // 2
    pil_img = pil_img.crop((left, top, left + side, top + side))
    if side != target_px:
        from PIL import Image
        pil_img = pil_img.resize((target_px, target_px), Image.LANCZOS)
    return pil_img


def _tensor_to_cover_bytes(image_tensor, cover_size: str = DEFAULT_COVER_SIZE) -> bytes:
    """
    Converts a ComfyUI IMAGE tensor (batch, H, W, C float32 0..1) into JPEG
    bytes for an embedded cover. Only the first image in the batch is used.
    """
    from PIL import Image

    img = image_tensor
    if img.dim() == 4:
        img = img[0]
    arr = (img.clamp(0, 1).cpu().numpy() * 255.0 + 0.5).astype(np.uint8)
    if arr.shape[-1] == 4:
        arr = arr[..., :3]  # drop alpha — cover art is opaque
    pil_img = Image.fromarray(arr, mode="RGB")

    if cover_size != "Original":
        pil_img = _resize_cover_to_square(pil_img, int(cover_size))

    buf = io.BytesIO()
    pil_img.save(buf, format="JPEG", quality=92)
    return buf.getvalue()


# ── ID3 tags — works for both MP3 and WAV via mutagen ────────────────────────

def _write_id3_tags(path: str, fmt: str, tags: dict, cover_bytes):
    """
    Writes ID3v2.3 frames into `path`. fmt selects the mutagen wrapper:
    'mp3' -> mutagen.mp3.MP3, 'wav' -> mutagen.wave.WAVE (embeds the same
    ID3 frames into the WAV's RIFF 'id3 ' chunk). Raises ImportError if
    mutagen isn't installed — caller decides how fatal that should be.
    """
    from mutagen.id3 import TIT2, TPE1, TALB, TYER, TCON, COMM, TRCK, APIC

    if fmt == "mp3":
        from mutagen.mp3 import MP3
        audio = MP3(path)
    elif fmt == "wav":
        from mutagen.wave import WAVE
        audio = WAVE(path)
    else:
        raise ValueError(f"Unsupported tag format: {fmt}")

    if audio.tags is None:
        audio.add_tags()
    id3 = audio.tags

    # Defensive: clear anything already present (e.g. an encoder tag ffmpeg
    # added) before writing our own values.
    for frame_id in ("TIT2", "TPE1", "TALB", "TYER", "TCON", "COMM", "TRCK", "APIC"):
        id3.delall(frame_id)

    if tags.get("title"):
        id3.add(TIT2(encoding=3, text=tags["title"]))
    if tags.get("artist"):
        id3.add(TPE1(encoding=3, text=tags["artist"]))
    if tags.get("album"):
        id3.add(TALB(encoding=3, text=tags["album"]))
    if tags.get("year"):
        id3.add(TYER(encoding=3, text=str(tags["year"])))
    if tags.get("genre"):
        id3.add(TCON(encoding=3, text=tags["genre"]))
    if tags.get("comment"):
        id3.add(COMM(encoding=3, lang="eng", desc="", text=tags["comment"]))
    if tags.get("track"):
        id3.add(TRCK(encoding=3, text=str(tags["track"])))
    if cover_bytes:
        id3.add(APIC(encoding=3, mime="image/jpeg", type=3, desc="Cover", data=cover_bytes))

    audio.save(v2_version=3)  # ID3v2.3 — widest player compatibility


def _write_vorbis_tags(path: str, fmt: str, tags: dict, cover_bytes):
    """
    Writes Vorbis comments (FLAC/OGG's native tag format) into `path`, plus
    a cover picture. fmt selects the mutagen wrapper: 'flac' ->
    mutagen.flac.FLAC, 'ogg' -> mutagen.oggvorbis.OggVorbis.

    Field names follow the informal Vorbis comment convention (lowercase:
    title/artist/album/date/genre/tracknumber/comment) rather than ID3
    frame IDs — different tagging scheme, same intent.

    Cover art: FLAC gets a real PICTURE metadata block via add_picture().
    Ogg Vorbis has no native picture block, so the cover goes into a
    base64-encoded FLAC Picture block under the "metadata_block_picture"
    field instead — see the module docstring for why that's the right
    convention rather than something bespoke.
    """
    from mutagen.flac import Picture

    if fmt == "flac":
        from mutagen.flac import FLAC
        audio = FLAC(path)
    elif fmt == "ogg":
        from mutagen.oggvorbis import OggVorbis
        audio = OggVorbis(path)
    else:
        raise ValueError(f"Unsupported tag format: {fmt}")

    if tags.get("title"):
        audio["title"] = tags["title"]
    if tags.get("artist"):
        audio["artist"] = tags["artist"]
    if tags.get("album"):
        audio["album"] = tags["album"]
    if tags.get("year"):
        audio["date"] = str(tags["year"])
    if tags.get("genre"):
        audio["genre"] = tags["genre"]
    if tags.get("comment"):
        audio["comment"] = tags["comment"]
    if tags.get("track"):
        audio["tracknumber"] = str(tags["track"])

    if cover_bytes:
        from PIL import Image
        w, h = Image.open(io.BytesIO(cover_bytes)).size
        pic = Picture()
        pic.data = cover_bytes
        pic.type = 3
        pic.mime = "image/jpeg"
        pic.width, pic.height, pic.depth = w, h, 24

        if fmt == "flac":
            audio.clear_pictures()
            audio.add_picture(pic)
        else:  # ogg
            import base64
            audio["metadata_block_picture"] = [base64.b64encode(pic.write()).decode("ascii")]

    audio.save()


def _write_tags(path: str, fmt: str, tags: dict, cover_bytes):
    """Dispatches to the right tagging scheme for fmt. Raises ImportError
    if mutagen isn't installed, ValueError for an unrecognized fmt."""
    if fmt in ("mp3", "wav"):
        _write_id3_tags(path, fmt, tags, cover_bytes)
    elif fmt in ("flac", "ogg"):
        _write_vorbis_tags(path, fmt, tags, cover_bytes)
    else:
        raise ValueError(f"Unsupported tag format: {fmt}")


# ── Node ─────────────────────────────────────────────────────────────────────

class AudioMetadataNode:
    CATEGORY     = "axces2000/audio"
    FUNCTION     = "stage"
    RETURN_TYPES = ()
    RETURN_NAMES = ()
    OUTPUT_NODE  = True

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "audio": ("AUDIO",),
            },
            "optional": {
                "cover_image": ("IMAGE",),
                "cover_size": (COVER_SIZES, {"default": DEFAULT_COVER_SIZE}),
                "title":  ("STRING", {"default": ""}),
                "artist": ("STRING", {"default": ""}),
                "album":  ("STRING", {"default": ""}),
                "year":   ("STRING", {"default": ""}),
                "genre":  ("STRING", {"default": ""}),
                "track_number": ("INT", {"default": 0, "min": 0, "max": 9999}),
                "comment": ("STRING", {"default": "", "multiline": True}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    def stage(self, audio, cover_image=None, cover_size=DEFAULT_COVER_SIZE,
              title="", artist="", album="", year="", genre="",
              track_number=0, comment="", unique_id="0"):

        waveform    = audio["waveform"]
        sample_rate = int(audio["sample_rate"])

        # Render once to a temp WAV. Left in place (not deleted after this
        # function returns) — same convention as Audio Player, since export
        # is a later, user-initiated action, not part of this run.
        filename = f"audio_metadata_{uuid.uuid4().hex[:8]}.wav"
        wav_path = os.path.join(folder_paths.get_temp_directory(), filename)
        _save_wav(waveform, sample_rate, wav_path)

        # Peaks for the JS waveform preview — cached + sidecar, same trick
        # as Audio Player, so a tab switch or server restart doesn't lose it.
        peaks = _build_peaks(waveform, num_bars=120)
        _am_peaks_cache[filename] = peaks
        try:
            with open(wav_path + ".peaks.json", "w") as f:
                json.dump(peaks, f)
        except Exception as e:
            print(f"[AudioMetadata] Could not write peaks sidecar: {e}")

        # Cover art — resized now, cached to disk. By the time export runs
        # (a later button click) this node's Python instance and the
        # original IMAGE tensor are long gone, so this can't be redone then.
        has_cover = False
        if cover_image is not None:
            try:
                cover_bytes = _tensor_to_cover_bytes(cover_image, cover_size)
                with open(wav_path + ".cover.jpg", "wb") as f:
                    f.write(cover_bytes)
                has_cover = True
            except Exception as e:
                print(f"[AudioMetadata] Could not process cover image: {e}")

        # Tag values — sidecar JSON, so export has a server-side source of
        # truth without depending on the client resending everything.
        tags = {
            "title": title, "artist": artist, "album": album, "year": year,
            "genre": genre, "comment": comment,
            "track": track_number if track_number else None,
        }
        try:
            with open(wav_path + ".tags.json", "w") as f:
                json.dump(tags, f)
        except Exception as e:
            print(f"[AudioMetadata] Could not write tags sidecar: {e}")

        duration = round(waveform.shape[-1] / sample_rate, 3)
        print(f"[AudioMetadata] Staged {filename} ({duration:.3f}s) — "
              f"use Save As in the widget to export.")

        return {
            "ui": {"audio_metadata": [{
                "filename":  filename,
                "duration":  duration,
                "has_cover": has_cover,
                "title":     title,
                "artist":    artist,
                "album":     album,
            }]},
            "result": (),
        }


# ── HTTP routes ───────────────────────────────────────────────────────────────
try:
    from server import PromptServer
    from aiohttp import web

    @PromptServer.instance.routes.get("/audio_metadata/peaks/{filename}")
    async def am_serve_peaks(request):
        filename = os.path.basename(request.match_info["filename"])
        peaks = _am_peaks_cache.get(filename)
        if peaks is None:
            sidecar = os.path.join(folder_paths.get_temp_directory(), filename + ".peaks.json")
            if os.path.exists(sidecar):
                try:
                    with open(sidecar) as f:
                        peaks = json.load(f)
                    _am_peaks_cache[filename] = peaks
                except Exception:
                    pass
        if peaks is None:
            return web.Response(status=404, text="Peaks not found")
        return web.json_response(peaks)

    @PromptServer.instance.routes.get("/audio_metadata/cover/{filename}")
    async def am_serve_cover(request):
        filename   = os.path.basename(request.match_info["filename"])
        cover_path = os.path.join(folder_paths.get_temp_directory(), filename + ".cover.jpg")
        if not os.path.exists(cover_path):
            return web.Response(status=404)
        with open(cover_path, "rb") as f:
            data = f.read()
        return web.Response(body=data, content_type="image/jpeg")

    # The raw preview WAV itself is served by ComfyUI's own built-in
    # /view?filename=...&type=temp route — same as Audio Player — so no
    # dedicated route is needed just for playback.

    @PromptServer.instance.routes.get("/audio_metadata/export/{filename}")
    async def am_export(request):
        """
        Called only when the user clicks a Save As option in the widget.
        fmt=wav|mp3|flac|ogg, bitrate=128|192|256|320 (mp3 only — flac is
        lossless and ogg uses a fixed quality level, same as Audio Player's
        own download menu). Encodes on-demand from the staged temp WAV,
        embeds tags + cover from the sidecars written by stage(), and
        streams the result back for the browser to save — nothing is
        written to ComfyUI's permanent output/ folder.
        """
        filename = os.path.basename(request.match_info["filename"])
        fmt      = request.rel_url.query.get("fmt", "mp3").lower()
        bitrate  = request.rel_url.query.get("bitrate", "320")

        if fmt not in ("mp3", "wav", "flac", "ogg"):
            return web.Response(status=400, text=f"Unsupported format: {fmt}")

        src_path = os.path.join(folder_paths.get_temp_directory(), filename)
        if not os.path.exists(src_path):
            return web.Response(status=404, text="Audio not found — re-run the node")

        tags = {}
        tags_path = src_path + ".tags.json"
        if os.path.exists(tags_path):
            try:
                with open(tags_path) as f:
                    tags = json.load(f)
            except Exception:
                pass

        cover_bytes = None
        cover_path = src_path + ".cover.jpg"
        if os.path.exists(cover_path):
            try:
                with open(cover_path, "rb") as f:
                    cover_bytes = f.read()
            except Exception:
                pass

        out_path = os.path.join(
            tempfile.gettempdir(), f"axces2000_am_export_{uuid.uuid4().hex[:8]}.{fmt}"
        )
        FFMPEG_ARGS = {
            "mp3":  ["-c:a", "libmp3lame", "-b:a", f"{bitrate}k"],
            "flac": ["-c:a", "flac"],
            "ogg":  ["-c:a", "libvorbis", "-q:a", "6"],
        }

        try:
            if fmt == "wav":
                shutil.copyfile(src_path, out_path)
            else:
                try:
                    subprocess.run(
                        ["ffmpeg", "-y", "-i", src_path] + FFMPEG_ARGS[fmt] + [out_path],
                        capture_output=True, check=True,
                    )
                except FileNotFoundError:
                    return web.Response(status=500, text="ffmpeg was not found on the server's PATH")
                except subprocess.CalledProcessError as e:
                    stderr = e.stderr.decode(errors="ignore") if e.stderr else str(e)
                    return web.Response(status=500, text=f"ffmpeg failed to encode {fmt.upper()}: {stderr}")

            try:
                _write_tags(out_path, fmt, tags, cover_bytes)
            except ImportError:
                print("[AudioMetadata] mutagen is not installed — exporting without tags. "
                      "Run: pip install mutagen --break-system-packages")
            except Exception as e:
                print(f"[AudioMetadata] Could not write tags on export: {e}")

            with open(out_path, "rb") as f:
                data = f.read()

            MIME = {"wav": "audio/wav", "mp3": "audio/mpeg", "flac": "audio/flac", "ogg": "audio/ogg"}
            base_name = tags.get("title") or os.path.splitext(filename)[0]
            base_name = "".join(c for c in base_name if c.isalnum() or c in ("_", "-", " ")).strip() or "audio_output"
            dl_name   = f"{base_name}_{bitrate}k.mp3" if fmt == "mp3" else f"{base_name}.{fmt}"

            return web.Response(
                body=data, content_type=MIME[fmt],
                headers={"Content-Disposition": f'attachment; filename="{dl_name}"'},
            )
        finally:
            try:
                os.remove(out_path)
            except OSError:
                pass

except Exception as e:
    print(f"[AudioMetadata] Could not register routes: {e}")


NODE_CLASS_MAPPINGS        = {"AudioMetadataNode": AudioMetadataNode}
NODE_DISPLAY_NAME_MAPPINGS = {"AudioMetadataNode": "🎵 Audio Metadata"}
