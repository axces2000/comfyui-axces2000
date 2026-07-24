import os
import json
import hashlib
import tempfile
import asyncio
import folder_paths

audio_extensions = ["mp3", "wav", "flac", "ogg", "aac", "m4a", "opus"]

if "audio" not in folder_paths.folder_names_and_paths:
    folder_paths.folder_names_and_paths["audio"] = (
        [os.path.join(folder_paths.base_path, "input")],
        set(audio_extensions)
    )


class AudioLoaderNode:

    @classmethod
    def INPUT_TYPES(cls):
        audio_files = folder_paths.get_filename_list("audio")
        return {
            "required": {
                "audio": (sorted(audio_files),),
            },
            "optional": {
                "normalize": ("BOOLEAN", {"default": False}),
                "pitch_shift_semitones": ("FLOAT", {
                    "default": 0.0,
                    "min": -24.0,
                    "max": 24.0,
                    "step": 0.5,
                    "tooltip": (
                        "Shifts the pitch of the extra 'audio_pitched' output by this "
                        "many semitones (positive = higher, negative = lower) while "
                        "keeping duration/tempo unchanged. Useful for nudging low "
                        "female (contralto) or high male voices into a range that a "
                        "voice-gender classifier (e.g. LTX Sound-to-Video) reads "
                        "correctly. The main 'audio' output is never altered."
                    ),
                }),
            },
            "hidden": {
                # trim_json is written by the JS widget and passed here.
                # Using "hidden" means: no widget created, value always sent.
                "trim_json": ("STRING", {"default": '{"s":0,"e":0}'}),
                "unique_id": "UNIQUE_ID",
            }
        }

    # audio_pitched is appended at the END of the tuple (not inserted
    # between existing outputs) so saved workflows that already wired the
    # sample_rate/duration_seconds/metadata sockets keep pointing at the
    # same output indices after this update.
    RETURN_TYPES = ("AUDIO", "INT", "FLOAT", "STRING", "AUDIO")
    RETURN_NAMES = ("audio", "sample_rate", "duration_seconds", "metadata", "audio_pitched")
    FUNCTION     = "load_audio"
    CATEGORY     = "audio"
    OUTPUT_NODE  = False

    def _load_waveform(self, audio_path):
        # NOTE: torchcodec is intentionally never imported here. On some
        # Windows/embedded-python setups, importing torchcodec triggers a
        # native DLL load (libtorchcodec_core*.dll) that can hard-crash the
        # process with an "Entry Point Not Found" error *before* Python's
        # try/except has a chance to catch anything - so wrapping the import
        # in try/except does not protect against it. soundfile and
        # torchaudio are pure-Python-safe fallbacks and are tried first.
        last_error = None
        try:
            import soundfile as sf, torch
            data, sr = sf.read(audio_path, dtype="float32", always_2d=True)
            return torch.from_numpy(data.T), sr
        except Exception as e: last_error = e
        try:
            import torchaudio
            return torchaudio.load(audio_path, backend="soundfile")
        except Exception as e: last_error = e
        try:
            import torchaudio
            return torchaudio.load(audio_path, backend="ffmpeg")
        except Exception as e: last_error = e
        try:
            import torchaudio
            return torchaudio.load(audio_path)
        except Exception as e: last_error = e
        raise RuntimeError(f"Could not load audio. Last error: {last_error}")

    def _pitch_shift(self, waveform, sample_rate, n_steps):
        """
        Returns a copy of `waveform` shifted by `n_steps` semitones, at the
        same length (duration/tempo unchanged). Uses torchaudio's
        phase-vocoder based PitchShift transform (resample -> time-stretch
        -> resample), which is what keeps tempo constant while pitch moves.
        """
        if abs(n_steps) < 1e-6:
            return waveform.clone()

        # Guard against clips too short for the transform's internal STFT
        # (default n_fft=512); avoids a cryptic crash on tiny trims.
        min_samples = 2048
        if waveform.shape[-1] < min_samples:
            print(
                f"[AudioLoader] Clip too short ({waveform.shape[-1]} samples) to "
                f"pitch-shift reliably — returning an unshifted copy for audio_pitched."
            )
            return waveform.clone()

        try:
            import torch
            import torchaudio
        except Exception as e:
            raise RuntimeError(
                f"torchaudio is required for pitch shifting but could not be imported: {e}"
            )

        shifter = torchaudio.transforms.PitchShift(
            sample_rate=sample_rate,
            n_steps=n_steps,
        )
        shifted = shifter(waveform)

        # The internal resample/time-stretch chain can round to a slightly
        # different sample count — force it back to the source length so
        # audio_pitched always matches audio's duration exactly.
        target_len = waveform.shape[-1]
        cur_len    = shifted.shape[-1]
        if cur_len > target_len:
            shifted = shifted[..., :target_len]
        elif cur_len < target_len:
            shifted = torch.nn.functional.pad(shifted, (0, target_len - cur_len))

        return shifted

    def load_audio(self, audio, normalize=False,
                   trim_json='{"s":0,"e":0}', unique_id="0",
                   pitch_shift_semitones=0.0):
        audio_path = folder_paths.get_annotated_filepath(audio)
        if not os.path.exists(audio_path):
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        waveform, sample_rate = self._load_waveform(audio_path)

        if normalize:
            mx = waveform.abs().max()
            if mx > 0:
                waveform = waveform / mx

        total_dur = waveform.shape[-1] / sample_rate

        try:
            trim    = json.loads(trim_json) if trim_json else {}
            t_start = float(trim.get("s", 0.0))
            t_end   = float(trim.get("e", 0.0))
        except Exception:
            t_start, t_end = 0.0, 0.0

        do_trim = not (t_start == 0.0 and t_end == 0.0)
        if do_trim:
            t_start = max(0.0, t_start)
            t_end   = min(total_dur, t_end) if t_end > 0 else total_dur
            if t_start >= t_end:
                t_start, t_end, do_trim = 0.0, total_dur, False

        if do_trim:
            waveform = waveform[:, int(t_start * sample_rate):int(t_end * sample_rate)]

        dur      = waveform.shape[-1] / sample_rate
        filename = os.path.basename(audio_path)
        trim_info = f" | Trim: {t_start:.3f}s – {t_end:.3f}s" if do_trim else ""

        # Pitch-shifted twin of the (already trimmed/normalized) waveform.
        # Computed from the same source as `audio`, so both outputs stay in
        # sync with the same trim/normalize settings — only pitch differs.
        pitch_shift_semitones = float(pitch_shift_semitones or 0.0)
        pitched_waveform = self._pitch_shift(waveform, sample_rate, pitch_shift_semitones)
        pitch_info = f" | Pitch: {pitch_shift_semitones:+.2f}st" if pitch_shift_semitones != 0.0 else ""

        metadata  = (
            f"File: {filename} | Sample Rate: {sample_rate}Hz | "
            f"Channels: {waveform.shape[0]} | Samples: {waveform.shape[-1]} | "
            f"Duration: {dur:.3f}s | Size: {os.path.getsize(audio_path)/1024:.1f}KB"
            f"{trim_info}{pitch_info}"
        )

        return (
            {"waveform": waveform.unsqueeze(0), "sample_rate": sample_rate},
            sample_rate,
            dur,
            metadata,
            {"waveform": pitched_waveform.unsqueeze(0), "sample_rate": sample_rate},
        )

    @classmethod
    def IS_CHANGED(cls, audio, normalize=False,
                   trim_json='{"s":0,"e":0}', unique_id="0",
                   pitch_shift_semitones=0.0):
        try:
            p = folder_paths.get_annotated_filepath(audio)
            if os.path.exists(p):
                return f"{os.path.getmtime(p)}|{normalize}|{trim_json}|{pitch_shift_semitones}"
        except Exception:
            pass
        return f"{audio}|{normalize}|{trim_json}|{pitch_shift_semitones}"

    @classmethod
    def VALIDATE_INPUTS(cls, audio, normalize=False,
                        trim_json='{"s":0,"e":0}', unique_id="0",
                        pitch_shift_semitones=0.0):
        if not folder_paths.exists_annotated_filepath(audio):
            return f"Audio file does not exist: {audio}"
        return True


from server import PromptServer
from aiohttp import web


def _hash_file(path, chunk_size=1 << 20):
    """MD5 checksum of a file's contents, read in chunks to bound memory."""
    h = hashlib.md5()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def _name_family(input_dir, filename):
    """
    Yields (candidate_name, full_path, exists) for filename, filename_1,
    filename_2, ... — the same numbering scheme upload_audio already used
    to dodge collisions — stopping right after the first name that doesn't
    exist yet (that's the next free slot).
    """
    base, ext = os.path.splitext(filename)
    counter = 0
    while True:
        candidate = filename if counter == 0 else f"{base}_{counter}{ext}"
        path = os.path.join(input_dir, candidate)
        exists = os.path.exists(path)
        yield candidate, path, exists
        if not exists:
            return
        counter += 1


# Guards the "compare against existing files, then finalize" step of an
# upload so two near-simultaneous uploads of identical content can't both
# decide there's no match and race to create two separate numbered copies.
_upload_lock = asyncio.Lock()

@PromptServer.instance.routes.post("/axces2000/audio_trim")
async def set_audio_trim(request):
    """JS posts trim JSON here; we echo it back so the prompt can include it."""
    try:
        data = await request.json()
        return web.json_response({"ok": True, "trim_json": json.dumps({
            "s": float(data.get("s", 0)),
            "e": float(data.get("e", 0)),
        })})
    except Exception as e:
        return web.Response(status=400, text=str(e))


@PromptServer.instance.routes.post("/upload/audio")
async def upload_audio(request):
    reader = await request.multipart()
    field  = await reader.next()
    if not field or field.name != "image":
        return web.Response(status=400, text="No file field found")
    filename = os.path.basename(field.filename or "")
    if not filename:
        return web.Response(status=400, text="No filename")
    ext = os.path.splitext(filename)[1].lower().lstrip(".")
    if ext not in audio_extensions:
        return web.Response(status=400, text=f"Unsupported format: {ext}")

    input_dir = folder_paths.get_input_directory()
    _, ext_with_dot = os.path.splitext(filename)

    # Stream the upload straight to a hidden temp file in the same folder
    # (so the eventual rename below is atomic, same filesystem) while
    # hashing it as the bytes arrive — no extra read pass just to checksum.
    tmp_fd, tmp_path = tempfile.mkstemp(
        prefix=".axces2000_upload_", suffix=ext_with_dot, dir=input_dir
    )
    try:
        hasher = hashlib.md5()
        with os.fdopen(tmp_fd, "wb") as f:
            while chunk := await field.read_chunk(8192):
                f.write(chunk)
                hasher.update(chunk)
        upload_hash = hasher.hexdigest()
        upload_size = os.path.getsize(tmp_path)

        async with _upload_lock:
            # Walk voice.wav, voice_1.wav, voice_2.wav, ... — same chain
            # this endpoint always used to dodge name collisions. If any
            # existing file in that chain is byte-identical to what was
            # just uploaded, reuse its name instead of writing a new
            # numbered duplicate of the same content.
            for candidate, path, exists in _name_family(input_dir, filename):
                if not exists:
                    os.replace(tmp_path, path)
                    return web.json_response({
                        "name": candidate, "subfolder": "", "type": "input",
                        "deduped": False,
                    })
                try:
                    same_content = (
                        os.path.getsize(path) == upload_size
                        and _hash_file(path) == upload_hash
                    )
                except OSError:
                    # File vanished/unreadable mid-check — treat as no
                    # match and keep scanning the rest of the chain.
                    continue
                if same_content:
                    os.remove(tmp_path)
                    return web.json_response({
                        "name": candidate, "subfolder": "", "type": "input",
                        "deduped": True,
                    })

        # Unreachable in practice — _name_family always terminates at a
        # free slot — but fail loudly rather than silently drop the upload.
        raise RuntimeError("Could not find a destination for the uploaded file")
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


NODE_CLASS_MAPPINGS        = {"AudioLoader": AudioLoaderNode}
NODE_DISPLAY_NAME_MAPPINGS = {"AudioLoader": "🎵 Audio Loader"}
