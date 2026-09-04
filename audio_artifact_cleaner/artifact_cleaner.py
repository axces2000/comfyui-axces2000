"""
Artifact Cleaner
-----------------
Removes narrowband spectral artifacts (single tones or a harmonic "comb",
as commonly produced by neural vocoder upsampling) from an AUDIO input.

Two modes:
  - static_notch: a bank of IIR notch filters (scipy.signal.iirnotch).
    Cheap and predictable. Best when the artifact frequencies are stable
    for the whole track.
  - dynamic_spectral_gate: STFT-domain magnitude suppression, applied only
    in time frames where energy in the target band clearly exceeds the
    local spectral envelope. Safer when real musical content (cymbals,
    air, harmonics) shares the same frequency range as the artifact —
    a static notch there would dull the mix along with the artifact.
"""

from typing import List

import numpy as np
import torch
from scipy import signal


def _parse_freqs(frequencies: str) -> List[float]:
    return [float(f.strip()) for f in frequencies.split(",") if f.strip()]


class ArtifactCleaner:
    """
    Notches or spectrally gates a list of frequencies out of an AUDIO input.
    Pair with ArtifactFrequencyAnalyzer to auto-populate `frequencies`.
    """

    CATEGORY = "axces2000/audio"
    RETURN_TYPES = ("AUDIO",)
    FUNCTION = "clean"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "audio": ("AUDIO",),
                "frequencies": ("STRING", {
                    "default": "14801", "multiline": False,
                    "tooltip": "Comma-separated Hz values, e.g. from ArtifactFrequencyAnalyzer. "
                               "14801 Hz confirmed by ear (Sep 2026) as an audible high-frequency "
                               "'whistle' in Suno output — stable across tracks, absent from live "
                               "recordings, notches cleanly without touching neighboring content. "
                               "May drift with Suno model/version updates.",
                }),
                "mode": (["dynamic_spectral_gate", "static_notch"], {"default": "dynamic_spectral_gate"}),
                "strength_db": ("FLOAT", {"default": 12.0, "min": 0.0, "max": 40.0, "step": 0.5}),
                "q_factor": ("FLOAT", {
                    "default": 8.0, "min": 0.5, "max": 50.0, "step": 0.5,
                    "tooltip": "Notch sharpness, static_notch mode only.",
                }),
                "relative_bandwidth": ("FLOAT", {
                    "default": 0.02, "min": 0.001, "max": 0.2, "step": 0.001,
                    "tooltip": "Fraction of center frequency treated as the notch width, dynamic mode only.",
                }),
            }
        }

    def clean(self, audio, frequencies, mode, strength_db, q_factor, relative_bandwidth):
        waveform = audio["waveform"]
        sample_rate = audio["sample_rate"]
        freqs = _parse_freqs(frequencies)

        if not freqs:
            return (audio,)

        if mode == "static_notch":
            out = self._static_notch(waveform, sample_rate, freqs, q_factor)
        else:
            out = self._dynamic_spectral_gate(waveform, sample_rate, freqs, strength_db, relative_bandwidth)

        return ({"waveform": out, "sample_rate": sample_rate},)

    @staticmethod
    def _static_notch(waveform, sample_rate, freqs, q_factor):
        out = torch.empty_like(waveform)
        batch, channels, _ = waveform.shape
        for b in range(batch):
            for c in range(channels):
                x = waveform[b, c].cpu().numpy().astype(np.float64)
                for f0 in freqs:
                    if 0 < f0 < sample_rate / 2:
                        b_coef, a_coef = signal.iirnotch(f0, q_factor, sample_rate)
                        x = signal.filtfilt(b_coef, a_coef, x)
                out[b, c] = torch.from_numpy(x.astype(np.float32))
        return out

    @staticmethod
    def _dynamic_spectral_gate(waveform, sample_rate, freqs, strength_db, relative_bandwidth):
        n_fft = 4096
        hop = n_fft // 4
        window = torch.hann_window(n_fft, device=waveform.device)
        gain_floor = 10 ** (-strength_db / 20.0)

        batch, channels, n_samples = waveform.shape
        flat = waveform.reshape(batch * channels, n_samples)

        spec = torch.stft(
            flat, n_fft=n_fft, hop_length=hop, window=window,
            return_complex=True, center=True,
        )  # [B*C, F, T]

        freq_bins = torch.linspace(0, sample_rate / 2, spec.shape[1], device=waveform.device)
        static_gain = torch.ones(spec.shape[1], device=waveform.device)
        for f0 in freqs:
            if not (0 < f0 < sample_rate / 2):
                continue
            bw = max(f0 * relative_bandwidth, sample_rate / n_fft)
            band = (freq_bins > f0 - bw) & (freq_bins < f0 + bw)
            static_gain[band] = gain_floor

        mag = spec.abs()
        # energy that would be removed if we notched everywhere (i.e. only in-band)
        in_band_mag = mag * (1 - static_gain).unsqueeze(0).unsqueeze(-1)
        # smooth ACROSS FREQUENCY (not time) to get the local spectral envelope
        # each bin is compared against its own neighbourhood, not its own history
        local_envelope = torch.nn.functional.avg_pool2d(
            mag.unsqueeze(1), kernel_size=(9, 1), stride=1, padding=(4, 0)
        ).squeeze(1)
        exceeds = in_band_mag > (local_envelope * 1.5)

        broadcast_gain = static_gain.unsqueeze(0).unsqueeze(-1).expand_as(mag)
        dynamic_gain = torch.where(exceeds, broadcast_gain, torch.ones_like(mag))
        spec = spec * dynamic_gain

        out = torch.istft(
            spec, n_fft=n_fft, hop_length=hop, window=window, length=n_samples,
        )
        return out.reshape(batch, channels, n_samples)


NODE_CLASS_MAPPINGS = {
    "ArtifactCleaner": ArtifactCleaner,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ArtifactCleaner": "Artifact Cleaner (Notch / Spectral Gate)",
}
