import os
import folder_paths

# Register audio file types with ComfyUI's path system
audio_extensions = ["mp3", "wav", "flac", "ogg", "aac", "m4a", "opus"]

# Add audio input directory to folder_paths
if "audio" not in folder_paths.folder_names_and_paths:
    folder_paths.folder_names_and_paths["audio"] = (
        [os.path.join(folder_paths.base_path, "input")],
        set(audio_extensions)
    )


class AudioLoaderNode:
    """
    A ComfyUI node for loading audio files with a rich waveform UI.
    Outputs audio tensor, sample rate, duration, and metadata.
    """

    @classmethod
    def INPUT_TYPES(cls):
        audio_files = folder_paths.get_filename_list("audio")
        return {
            "required": {
                "audio": (sorted(audio_files),),
            },
            "optional": {
                "normalize": ("BOOLEAN", {"default": False}),
            }
        }

    RETURN_TYPES = ("AUDIO", "INT", "FLOAT", "STRING")
    RETURN_NAMES = ("audio", "sample_rate", "duration_seconds", "metadata")
    FUNCTION = "load_audio"
    CATEGORY = "audio"
    OUTPUT_NODE = False

    def _load_waveform(self, audio_path: str):
        """
        Load audio with a robust multi-backend fallback.
        Handles torchaudio >= 2.9 (torchcodec-based) and older versions.
        Also works on Windows where torchcodec is unavailable.
        """
        last_error = None

        # Strategy 1: torchcodec directly (torchaudio >= 2.9, Linux/Mac)
        try:
            from torchcodec.decoders import AudioDecoder
            decoder = AudioDecoder(audio_path)
            samples = decoder.get_all_samples()
            waveform = samples.data
            sample_rate = samples.sample_rate
            return waveform, sample_rate
        except Exception as e:
            last_error = e

        # Strategy 2: torchaudio with explicit soundfile backend
        try:
            import torchaudio
            waveform, sample_rate = torchaudio.load(audio_path, backend="soundfile")
            return waveform, sample_rate
        except Exception as e:
            last_error = e

        # Strategy 3: torchaudio with ffmpeg backend
        try:
            import torchaudio
            waveform, sample_rate = torchaudio.load(audio_path, backend="ffmpeg")
            return waveform, sample_rate
        except Exception as e:
            last_error = e

        # Strategy 4: plain torchaudio.load() — any version, any backend
        try:
            import torchaudio
            waveform, sample_rate = torchaudio.load(audio_path)
            return waveform, sample_rate
        except Exception as e:
            last_error = e

        # Strategy 5: soundfile directly — tiny pure-Python fallback
        try:
            import soundfile as sf
            import torch
            data, sample_rate = sf.read(audio_path, dtype="float32", always_2d=True)
            waveform = torch.from_numpy(data.T)  # [channels, time]
            return waveform, sample_rate
        except Exception as e:
            last_error = e

        raise RuntimeError(
            f"Could not load audio '{audio_path}' with any available backend. "
            f"Last error: {last_error}\n"
            f"Try: pip install torchcodec  OR  pip install soundfile"
        )

    def load_audio(self, audio, normalize=False):
        audio_path = folder_paths.get_annotated_filepath(audio)

        if not os.path.exists(audio_path):
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        waveform, sample_rate = self._load_waveform(audio_path)

        if normalize:
            max_val = waveform.abs().max()
            if max_val > 0:
                waveform = waveform / max_val

        duration_seconds = waveform.shape[-1] / sample_rate
        num_channels = waveform.shape[0]
        num_samples = waveform.shape[-1]

        filename = os.path.basename(audio_path)
        file_size = os.path.getsize(audio_path)
        metadata = (
            f"File: {filename} | "
            f"Sample Rate: {sample_rate}Hz | "
            f"Channels: {num_channels} | "
            f"Samples: {num_samples} | "
            f"Duration: {duration_seconds:.3f}s | "
            f"Size: {file_size / 1024:.1f}KB"
        )

        audio_data = {
            "waveform": waveform.unsqueeze(0),  # Add batch dim: [B, C, T]
            "sample_rate": sample_rate,
        }

        return (audio_data, sample_rate, duration_seconds, metadata)

    @classmethod
    def IS_CHANGED(cls, audio, normalize=False):
        audio_path = folder_paths.get_annotated_filepath(audio)
        if os.path.exists(audio_path):
            return os.path.getmtime(audio_path)
        return float("nan")

    @classmethod
    def VALIDATE_INPUTS(cls, audio, normalize=False):
        if not folder_paths.exists_annotated_filepath(audio):
            return f"Audio file does not exist: {audio}"
        return True


# Register upload endpoint for the drag-and-drop widget
from server import PromptServer
from aiohttp import web


@PromptServer.instance.routes.post("/upload/audio")
async def upload_audio(request):
    """Handle audio file uploads from the frontend drag-and-drop widget."""
    reader = await request.multipart()
    field = await reader.next()

    if not field or field.name != "image":
        return web.Response(status=400, text="No file field found")

    filename = field.filename
    if not filename:
        return web.Response(status=400, text="No filename")

    filename = os.path.basename(filename)
    ext = os.path.splitext(filename)[1].lower().lstrip(".")
    if ext not in audio_extensions:
        return web.Response(status=400, text=f"Unsupported audio format: {ext}")

    input_dir = folder_paths.get_input_directory()
    save_path = os.path.join(input_dir, filename)

    base, extension = os.path.splitext(filename)
    counter = 1
    while os.path.exists(save_path):
        new_filename = f"{base}_{counter}{extension}"
        save_path = os.path.join(input_dir, new_filename)
        filename = new_filename
        counter += 1

    with open(save_path, "wb") as f:
        while chunk := await field.read_chunk(8192):
            f.write(chunk)

    return web.json_response({
        "name": filename,
        "subfolder": "",
        "type": "input"
    })


NODE_CLASS_MAPPINGS = {
    "AudioLoader": AudioLoaderNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "AudioLoader": "🎵 Audio Loader",
}
