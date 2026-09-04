"""
Artifact Frequency Analyzer
----------------------------
Diagnostic node: finds narrow, statistically anomalous spectral peaks in an
AUDIO input by comparing the long-term averaged spectrum against a smoothed
baseline (median filter). Designed to spot neural-vocoder upsampling
artifacts ("comb" patterns) and other narrowband AI-generation artifacts
that sit below conscious perception but read as a subtle metallic/synthetic
texture.

Outputs a comma-separated frequency list (feed directly into
ArtifactCleaner.frequencies) plus a spectrum plot image for visual
confirmation. Pair the plot with the Audio Player node's Spectrogram mode
for a before/after check.
"""

import io

import numpy as np
import torch
from scipy import signal

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    _HAS_MPL = True
except ImportError:
    _HAS_MPL = False


_A4_HZ = 440.0


def _distance_to_nearest_note(freq_hz: float) -> float:
    """Absolute distance in Hz from freq_hz to the nearest 12-TET
    equal-temperament pitch (A4 = 440 Hz). Musical content — notes and
    their harmonics — clusters tightly around these frequencies; real
    generator artifacts generally don't."""
    if freq_hz <= 0:
        return float("inf")
    n = round(12 * np.log2(freq_hz / _A4_HZ))
    nearest = _A4_HZ * (2 ** (n / 12))
    return abs(freq_hz - nearest)


class ArtifactFrequencyAnalyzer:
    """
    Scans an AUDIO input for narrowband spectral anomalies and reports
    candidate frequencies for notching / spectral gating.
    """

    CATEGORY = "axces2000/audio"
    RETURN_TYPES = ("STRING", "IMAGE")
    RETURN_NAMES = ("candidate_freqs", "spectrum_plot")
    FUNCTION = "analyze"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "audio": ("AUDIO",),
                "prominence_db": ("FLOAT", {
                    "default": 6.0, "min": 1.0, "max": 30.0, "step": 0.5,
                    "tooltip": "How far a peak must rise above the smoothed baseline to count as a candidate.",
                }),
                "min_freq": ("FLOAT", {"default": 2000.0, "min": 20.0, "max": 24000.0, "step": 10.0}),
                "max_freq": ("FLOAT", {"default": 18000.0, "min": 20.0, "max": 24000.0, "step": 10.0}),
                "fft_size": (["2048", "4096", "8192", "16384"], {"default": "4096"}),
                "reject_musical_notes": ("BOOLEAN", {
                    "default": True,
                    "tooltip": "Drop candidates that land within note_tolerance_hz of a standard "
                               "12-TET pitch — filters out vocal/instrument notes and harmonics, "
                               "which is most of what shows up in a dense mix otherwise.",
                }),
                "note_tolerance_hz": ("FLOAT", {"default": 15.0, "min": 1.0, "max": 50.0, "step": 1.0}),
            }
        }

    def analyze(self, audio, prominence_db, min_freq, max_freq, fft_size,
                reject_musical_notes, note_tolerance_hz):
        waveform = audio["waveform"]
        sample_rate = audio["sample_rate"]

        # mono-sum the first item in the batch for analysis
        mono = waveform[0].mean(dim=0).cpu().numpy().astype(np.float64)

        n_fft = int(fft_size)
        hop = n_fft // 4

        freqs, _, stft = signal.stft(
            mono, fs=sample_rate, nperseg=n_fft, noverlap=n_fft - hop
        )
        mag_db = 20 * np.log10(np.abs(stft).mean(axis=1) + 1e-9)

        # odd kernel size, scaled to roughly 150 Hz of smoothing
        bin_hz = sample_rate / n_fft
        kernel = max(3, int(150 / bin_hz) | 1)
        baseline = signal.medfilt(mag_db, kernel_size=kernel)
        residual = mag_db - baseline

        band_mask = (freqs >= min_freq) & (freqs <= max_freq)
        band_freqs = freqs[band_mask]
        band_residual = residual[band_mask]

        peak_idx, props = signal.find_peaks(band_residual, prominence=prominence_db)
        candidate_freqs = band_freqs[peak_idx]

        if len(peak_idx):
            order = np.argsort(-props["prominences"])
            candidate_freqs = candidate_freqs[order][:24]  # cap the list, keep the strongest

        candidate_freqs = candidate_freqs.tolist()

        if reject_musical_notes:
            kept = [f for f in candidate_freqs if _distance_to_nearest_note(f) > note_tolerance_hz]
            rejected = [f for f in candidate_freqs if _distance_to_nearest_note(f) <= note_tolerance_hz]
        else:
            kept, rejected = candidate_freqs, []

        freqs_str = ", ".join(f"{int(round(f))}" for f in sorted(kept))

        plot_image = self._render_plot(freqs, mag_db, baseline, kept, rejected, sample_rate)
        return (freqs_str, plot_image)

    def _render_plot(self, freqs, mag_db, baseline, kept, rejected, sample_rate):
        if not _HAS_MPL:
            # still return a valid IMAGE tensor even without matplotlib
            return torch.zeros((1, 64, 64, 3), dtype=torch.float32)

        fig, ax = plt.subplots(figsize=(10, 4), dpi=110)
        ax.plot(freqs, mag_db, linewidth=0.8, label="spectrum")
        ax.plot(freqs, baseline, linewidth=1.0, linestyle="--", label="baseline")
        for f in rejected:
            ax.axvline(f, color="gray", alpha=0.3, linewidth=1.0, linestyle=":")
        for f in kept:
            ax.axvline(f, color="red", alpha=0.4, linewidth=1.2)
        ax.set_xlim(0, sample_rate / 2)
        ax.set_xlabel("Hz")
        ax.set_ylabel("dB")
        title = f"{len(kept)} candidate(s)"
        if rejected:
            title += f"  ·  {len(rejected)} rejected as musical notes (gray, dotted)"
        ax.set_title(title)
        ax.legend(loc="upper right", fontsize=8)
        fig.tight_layout()

        buf = io.BytesIO()
        fig.savefig(buf, format="png")
        plt.close(fig)
        buf.seek(0)

        from PIL import Image
        img = Image.open(buf).convert("RGB")
        arr = np.array(img).astype(np.float32) / 255.0
        return torch.from_numpy(arr)[None, ...]


NODE_CLASS_MAPPINGS = {
    "ArtifactFrequencyAnalyzer": ArtifactFrequencyAnalyzer,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ArtifactFrequencyAnalyzer": "Artifact Frequency Analyzer",
}
