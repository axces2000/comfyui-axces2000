import os
import json
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
            },
            "hidden": {
                # trim_json is written by the JS widget and passed here.
                # Using "hidden" means: no widget created, value always sent.
                "trim_json": ("STRING", {"default": '{"s":0,"e":0}'}),
                "unique_id": "UNIQUE_ID",
            }
        }

    RETURN_TYPES = ("AUDIO", "INT", "FLOAT", "STRING")
    RETURN_NAMES = ("audio", "sample_rate", "duration_seconds", "metadata")
    FUNCTION     = "load_audio"
    CATEGORY     = "audio"
    OUTPUT_NODE  = False

    def _load_waveform(self, audio_path):
        last_error = None
        try:
            from torchcodec.decoders import AudioDecoder
            dec = AudioDecoder(audio_path); s = dec.get_all_samples()
            return s.data, s.sample_rate
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
        try:
            import soundfile as sf, torch
            data, sr = sf.read(audio_path, dtype="float32", always_2d=True)
            return torch.from_numpy(data.T), sr
        except Exception as e: last_error = e
        raise RuntimeError(f"Could not load audio. Last error: {last_error}")

    def load_audio(self, audio, normalize=False,
                   trim_json='{"s":0,"e":0}', unique_id="0"):
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
        metadata  = (
            f"File: {filename} | Sample Rate: {sample_rate}Hz | "
            f"Channels: {waveform.shape[0]} | Samples: {waveform.shape[-1]} | "
            f"Duration: {dur:.3f}s | Size: {os.path.getsize(audio_path)/1024:.1f}KB"
            f"{trim_info}"
        )

        return (
            {"waveform": waveform.unsqueeze(0), "sample_rate": sample_rate},
            sample_rate,
            dur,
            metadata,
        )

    @classmethod
    def IS_CHANGED(cls, audio, normalize=False,
                   trim_json='{"s":0,"e":0}', unique_id="0"):
        try:
            p = folder_paths.get_annotated_filepath(audio)
            if os.path.exists(p):
                return f"{os.path.getmtime(p)}|{normalize}|{trim_json}"
        except Exception:
            pass
        return f"{audio}|{normalize}|{trim_json}"

    @classmethod
    def VALIDATE_INPUTS(cls, audio, normalize=False,
                        trim_json='{"s":0,"e":0}', unique_id="0"):
        if not folder_paths.exists_annotated_filepath(audio):
            return f"Audio file does not exist: {audio}"
        return True


from server import PromptServer
from aiohttp import web

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
    save_path = os.path.join(input_dir, filename)
    base, extension = os.path.splitext(filename)
    counter = 1
    while os.path.exists(save_path):
        filename  = f"{base}_{counter}{extension}"
        save_path = os.path.join(input_dir, filename)
        counter  += 1
    with open(save_path, "wb") as f:
        while chunk := await field.read_chunk(8192):
            f.write(chunk)
    return web.json_response({"name": filename, "subfolder": "", "type": "input"})


NODE_CLASS_MAPPINGS        = {"AudioLoader": AudioLoaderNode}
NODE_DISPLAY_NAME_MAPPINGS = {"AudioLoader": "🎵 Audio Loader"}
