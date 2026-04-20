import io, struct, os, uuid
import numpy as np
import folder_paths

# In-memory store for peaks (avoids websocket size limits)
_peaks_cache = {}


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


def _compute_lufs(waveform) -> float:
    if waveform.dim() == 3:
        waveform = waveform[0]
    mono = waveform.float().mean(dim=0).cpu().numpy()
    try:
        from scipy.signal import lfilter
        b1 = [1.53512485958697, -2.69169618940638, 1.19839281085285]
        a1 = [1.0, -1.69065929318241, 0.73248077421585]
        b2 = [1.0, -2.0, 1.0]
        a2 = [1.0, -1.99004745483398, 0.99007225036298]
        stage2 = lfilter(b2, a2, lfilter(b1, a1, mono))
        ms = float(np.mean(stage2 ** 2))
        return round(-0.691 + 10.0 * np.log10(ms + 1e-10), 1)
    except Exception:
        rms = float(np.sqrt(np.mean(mono ** 2) + 1e-10))
        return round(20.0 * np.log10(rms) - 0.691, 1)


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


class AudioPlayerNode:
    CATEGORY      = "audio"
    FUNCTION      = "run"
    RETURN_TYPES  = ()
    RETURN_NAMES  = ()
    OUTPUT_NODE   = True

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"audio": ("AUDIO",)}}

    def run(self, audio):
        waveform    = audio["waveform"]
        sample_rate = int(audio["sample_rate"])

        if waveform.dim() == 3:
            n_ch, n_samples = waveform.shape[1], waveform.shape[2]
        else:
            n_ch, n_samples = waveform.shape[0], waveform.shape[1]

        duration = round(n_samples / sample_rate, 3)
        stereo   = n_ch >= 2
        lufs     = _compute_lufs(waveform)

        # Save WAV to temp folder
        filename = f"audio_player_{uuid.uuid4().hex[:8]}.wav"
        filepath = os.path.join(folder_paths.get_temp_directory(), filename)
        _save_wav(waveform, sample_rate, filepath)

        # Store peaks separately — NOT in the websocket payload
        peaks = _build_peaks(waveform, num_bars=120)
        _peaks_cache[filename] = peaks

        print(f"[AudioPlayerNode] {n_ch}ch {sample_rate}Hz {duration}s → {filename}")

        # Keep payload small — no peaks, no base64
        return {
            "ui": {"audio_player": [{
                "filename":    filename,
                "duration":    duration,
                "sample_rate": sample_rate,
                "stereo":      stereo,
                "lufs":        lufs,
            }]},
            "result": (),
        }


# ── HTTP routes ───────────────────────────────────────────────────────────────
try:
    from server import PromptServer
    from aiohttp import web

    @PromptServer.instance.routes.get("/audio_player/peaks/{filename}")
    async def serve_peaks(request):
        filename = request.match_info["filename"]
        peaks    = _peaks_cache.get(filename)
        if peaks is None:
            return web.Response(status=404, text="Peaks not found")
        return web.json_response(peaks)

    @PromptServer.instance.routes.get("/audio_player/flac/{filename}")
    async def serve_flac(request):
        filename = request.match_info["filename"]
        filepath = os.path.join(folder_paths.get_temp_directory(), filename)
        if not os.path.exists(filepath):
            return web.Response(status=404, text="Audio file not found — re-run the node")

        # Encode to FLAC using soundfile (proper LPC compression)
        try:
            import soundfile as sf
            import io as _io
            data, sr = sf.read(filepath, dtype="int16", always_2d=True)
            buf = _io.BytesIO()
            sf.write(buf, data, sr, format="FLAC", subtype="PCM_16")
            flac_bytes = buf.getvalue()
        except ImportError:
            # Fallback: ffmpeg via subprocess
            import subprocess, tempfile as _tf
            with _tf.NamedTemporaryFile(suffix=".flac", delete=False) as tmp:
                tmp_path = tmp.name
            subprocess.run(
                ["ffmpeg", "-y", "-i", filepath, "-c:a", "flac", tmp_path],
                capture_output=True, check=True
            )
            with open(tmp_path, "rb") as f:
                flac_bytes = f.read()
            os.unlink(tmp_path)

        return web.Response(
            body=flac_bytes,
            content_type="audio/flac",
            headers={"Content-Disposition": 'attachment; filename="audio_output.flac"'},
        )

except Exception as e:
    print(f"[AudioPlayerNode] Could not register routes: {e}")


NODE_CLASS_MAPPINGS        = {"AudioPlayerNode": AudioPlayerNode}
NODE_DISPLAY_NAME_MAPPINGS = {"AudioPlayerNode": "Audio Player 🎵"}
