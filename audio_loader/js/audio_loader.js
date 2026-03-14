/**
 * AudioLoader Widget for ComfyUI
 * Provides: drag-and-drop upload, waveform visualization,
 * play/pause/stop controls, position indicator, duration display.
 *
 * v1.4.0 — Fixed workflow save/restore:
 *           - Python input changed to STRING so saved filenames are never
 *             rejected by the "not in list" validator on reload.
 *           - onConfigure now restores by matching widget name in the node's
 *             input definitions rather than assuming a fixed array index.
 *           - serializeValue always returns the filename string (never null/undefined).
 */

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

// ─── Constants ────────────────────────────────────────────────────────────────
const WIDGET_HEIGHT  = 160;
const WAVEFORM_COLOR = "#4ade80";
const WAVEFORM_BG    = "#0f172a";
const PLAYHEAD_COLOR = "#f8fafc";
const ACCENT         = "#22d3ee";
const NODE_WIDTH     = 340;

const AUDIO_EXTENSIONS = new Set([
  "mp3", "wav", "wave", "flac", "ogg", "aac", "m4a", "opus", "weba"
]);

function isAudioFile(file) {
  if (!file) return false;
  if (file.type && file.type.startsWith("audio/")) return true;
  const ext = file.name?.split(".").pop()?.toLowerCase();
  return AUDIO_EXTENSIONS.has(ext);
}

// ─── Utility: format seconds → HH:MM:SS.mmm ──────────────────────────────────
function formatDuration(seconds) {
  if (!isFinite(seconds) || seconds < 0) return "00:00:00.000";
  const h  = Math.floor(seconds / 3600);
  const m  = Math.floor((seconds % 3600) / 60);
  const s  = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return (
    String(h).padStart(2, "0") + ":" +
    String(m).padStart(2, "0") + ":" +
    String(s).padStart(2, "0") + "." +
    String(ms).padStart(3, "0")
  );
}

// ─── Waveform decoder ─────────────────────────────────────────────────────────
async function decodeWaveformPeaks(arrayBuffer, numBars = 200) {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const decoded = await audioCtx.decodeAudioData(arrayBuffer);
    const channel = decoded.getChannelData(0);
    const block   = Math.floor(channel.length / numBars);
    const peaks   = [];
    for (let i = 0; i < numBars; i++) {
      let max = 0;
      const start = i * block;
      for (let j = 0; j < block; j++) {
        const v = Math.abs(channel[start + j]);
        if (v > max) max = v;
      }
      peaks.push(max);
    }
    const globalMax = Math.max(...peaks, 0.001);
    return { peaks: peaks.map(p => p / globalMax), duration: decoded.duration };
  } finally {
    audioCtx.close();
  }
}

// ─── Main Widget Factory ──────────────────────────────────────────────────────
function createAudioWidget(node, inputName) {
  let audioPeaks         = [];
  let audioDuration      = 0;
  let audioElement       = null;
  let playState          = "stopped";
  let playheadPos        = 0;
  let animFrame          = null;
  let isDraggingPlayhead = false;
  let isDragOver         = false;
  let currentFilename    = null;

  const widget = node.addWidget(
    "AUDIO_LOADER_WIDGET", inputName, "", () => {}, { serialize: true }
  );
  widget.computeSize = () => [NODE_WIDTH, WIDGET_HEIGHT + 60];

  // ── Audio element setup ───────────────────────────────────────────────────
  function setupAudio(url) {
    if (audioElement) { audioElement.pause(); audioElement.src = ""; }
    audioElement = new Audio(url);
    audioElement.addEventListener("ended", () => {
      playState = "stopped"; playheadPos = 0;
      cancelAnimationFrame(animFrame);
      node.setDirtyCanvas(true, false);
    });
  }

  function tickPlayhead() {
    if (audioElement?.duration) {
      playheadPos = audioElement.currentTime / audioElement.duration;
    }
    node.setDirtyCanvas(true, false);
    if (playState === "playing") animFrame = requestAnimationFrame(tickPlayhead);
  }

  // ── File loading ──────────────────────────────────────────────────────────
  async function loadAudioFile(filename) {
    if (!filename || filename.trim() === "") return;
    currentFilename  = filename;
    widget.value     = filename;   // keep widget value in sync at all times
    const url = api.apiURL(
      `/view?filename=${encodeURIComponent(filename)}&type=input`
    );
    try {
      const res    = await fetch(url);
      const buf    = await res.arrayBuffer();
      const result = await decodeWaveformPeaks(buf.slice(0));
      audioPeaks    = result.peaks;
      audioDuration = result.duration;
    } catch (e) {
      console.error("[AudioLoader] Waveform decode error", e);
      audioPeaks = []; audioDuration = 0;
    }
    setupAudio(url);
    playState = "stopped"; playheadPos = 0;
    node.setDirtyCanvas(true, false);
  }

  async function uploadFile(file) {
    const formData = new FormData();
    formData.append("image", file, file.name);
    try {
      const res = await api.fetchApi("/upload/audio", { method: "POST", body: formData });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      await loadAudioFile(data.name);
    } catch (e) {
      console.error("[AudioLoader] Upload error", e);
      alert("Audio upload failed: " + e.message);
    }
  }

  // ── Draw ──────────────────────────────────────────────────────────────────
  widget.draw = function (ctx, node, width, y) {
    const px = 10, pw = width - 20;

    ctx.fillStyle = WAVEFORM_BG;
    ctx.beginPath(); ctx.roundRect(px, y, pw, WIDGET_HEIGHT, 8); ctx.fill();

    ctx.strokeStyle = isDragOver ? ACCENT : "#1e293b";
    ctx.lineWidth   = isDragOver ? 2 : 1;
    ctx.beginPath(); ctx.roundRect(px, y, pw, WIDGET_HEIGHT, 8); ctx.stroke();

    if (audioPeaks.length > 0) {
      const barCount = audioPeaks.length;
      const barW     = (pw - 20) / barCount;
      const centerY  = y + WIDGET_HEIGHT / 2;
      const maxBarH  = WIDGET_HEIGHT / 2 - 12;
      for (let i = 0; i < barCount; i++) {
        const bx     = px + 10 + i * barW;
        const bh     = Math.max(2, audioPeaks[i] * maxBarH);
        const played = (i / barCount) <= playheadPos;
        ctx.fillStyle = played ? WAVEFORM_COLOR : "#1e3a2f";
        ctx.beginPath();
        ctx.roundRect(bx, centerY - bh, Math.max(1, barW - 1), bh * 2, 1);
        ctx.fill();
      }
      const phX = px + 10 + playheadPos * (pw - 20);
      ctx.strokeStyle = PLAYHEAD_COLOR; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(phX, y + 6); ctx.lineTo(phX, y + WIDGET_HEIGHT - 6); ctx.stroke();
      ctx.fillStyle = PLAYHEAD_COLOR;
      ctx.beginPath();
      ctx.moveTo(phX - 5, y + 6); ctx.lineTo(phX + 5, y + 6); ctx.lineTo(phX, y + 14);
      ctx.closePath(); ctx.fill();
    } else {
      ctx.fillStyle = isDragOver ? ACCENT : "#334155";
      ctx.font = "bold 13px monospace"; ctx.textAlign = "center";
      ctx.fillText(
        isDragOver ? "Drop audio file here" : "🎵  Drag & drop audio  /  select below",
        px + pw / 2, y + WIDGET_HEIGHT / 2 - 8
      );
      ctx.font = "11px monospace"; ctx.fillStyle = "#64748b";
      ctx.fillText("MP3 · WAV · FLAC · OGG · AAC · M4A", px + pw / 2, y + WIDGET_HEIGHT / 2 + 12);
      ctx.textAlign = "left";
    }

    const currentTime = audioElement?.currentTime ?? 0;
    ctx.fillStyle = "#94a3b8"; ctx.font = "10px monospace";
    ctx.textAlign = "left";  ctx.fillText(formatDuration(currentTime),  px + 12,      y + WIDGET_HEIGHT - 6);
    ctx.textAlign = "right"; ctx.fillText(formatDuration(audioDuration), px + pw - 12, y + WIDGET_HEIGHT - 6);
    ctx.textAlign = "left";

    if (currentFilename) {
      ctx.fillStyle = "#64748b"; ctx.font = "10px monospace"; ctx.textAlign = "center";
      const t = currentFilename.length > 40 ? currentFilename.slice(0, 38) + "…" : currentFilename;
      ctx.fillText(t, px + pw / 2, y + WIDGET_HEIGHT + 16);
      ctx.textAlign = "left";
    }

    const btnY      = y + WIDGET_HEIGHT + (currentFilename ? 22 : 6);
    const btnSize   = 28, btnGap = 8;
    const btnStartX = px + pw / 2 - (2 * btnSize + btnGap) / 2;
    const buttons   = [
      { label: playState === "playing" ? "⏸" : "▶", action: "play", bx: btnStartX },
      { label: "⏹", action: "stop", bx: btnStartX + btnSize + btnGap },
    ];
    widget._buttons = buttons.map(b => ({ ...b, y: btnY, size: btnSize }));
    buttons.forEach(btn => {
      const active = btn.action === "play" && playState === "playing";
      ctx.fillStyle   = active ? ACCENT : "#1e293b";
      ctx.strokeStyle = active ? ACCENT : "#334155";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(btn.bx, btnY, btnSize, btnSize, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = active ? "#0f172a" : "#e2e8f0";
      ctx.font = "14px sans-serif"; ctx.textAlign = "center";
      ctx.fillText(btn.label, btn.bx + btnSize / 2, btnY + btnSize / 2 + 5);
      ctx.textAlign = "left";
    });

    widget._lastY = y;
  };

  // ── Mouse ─────────────────────────────────────────────────────────────────
  widget.mouse = function (event, pos, node) {
    const [mx, my] = pos;
    const px = 10, pw = node.size[0] - 20;
    const waveTop = widget._lastY ?? 0, waveBottom = waveTop + WIDGET_HEIGHT;

    if (audioPeaks.length > 0 && my >= waveTop && my <= waveBottom) {
      if (event.type === "pointerdown") isDraggingPlayhead = true;
    }
    if (isDraggingPlayhead) {
      const frac = Math.max(0, Math.min(1, (mx - px - 10) / (pw - 20)));
      playheadPos = frac;
      if (audioElement?.duration) audioElement.currentTime = frac * audioElement.duration;
      if (event.type === "pointerup") isDraggingPlayhead = false;
      node.setDirtyCanvas(true, false);
      return true;
    }
    if (event.type === "pointerdown" && widget._buttons) {
      for (const btn of widget._buttons) {
        if (mx >= btn.bx && mx <= btn.bx + btn.size && my >= btn.y && my <= btn.y + btn.size) {
          handleButton(btn.action); return true;
        }
      }
    }
    return false;
  };

  function handleButton(action) {
    if (!audioElement) return;
    if (action === "play") {
      if (playState === "playing") {
        audioElement.pause(); playState = "paused"; cancelAnimationFrame(animFrame);
      } else {
        audioElement.play(); playState = "playing"; animFrame = requestAnimationFrame(tickPlayhead);
      }
    } else if (action === "stop") {
      audioElement.pause(); audioElement.currentTime = 0;
      playState = "stopped"; playheadPos = 0; cancelAnimationFrame(animFrame);
    }
    node.setDirtyCanvas(true, false);
  }

  // ── Serialization ─────────────────────────────────────────────────────────
  // Always return the filename string. ComfyUI saves this into widgets_values
  // in the workflow JSON and passes it back as the "audio" STRING input on load.
  widget.serializeValue = () => currentFilename || "";

  // ── Expose helpers ────────────────────────────────────────────────────────
  widget._loadAudioFile = loadAudioFile;
  widget._uploadFile    = uploadFile;
  widget._setDragOver   = (v) => { isDragOver = v; node.setDirtyCanvas(true, false); };

  // ── Drag & Drop ───────────────────────────────────────────────────────────
  node.onDragOver = function (e) {
    if (e.dataTransfer?.items) {
      const hasFile = [...e.dataTransfer.items].some(i => i.kind === "file");
      if (hasFile) { widget._setDragOver(true); return true; }
    }
    widget._setDragOver(false);
    return false;
  };

  node.onDragDrop = async function (e) {
    widget._setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file && isAudioFile(file)) {
      await uploadFile(file);
      return true;
    }
    return false;
  };

  // Cleanup on node removal
  const origOnRemoved = node.onRemoved?.bind(node);
  node.onRemoved = function () {
    if (audioElement) { audioElement.pause(); audioElement.src = ""; }
    cancelAnimationFrame(animFrame);
    origOnRemoved?.();
  };

  return widget;
}

// ─── Register extension ───────────────────────────────────────────────────────
app.registerExtension({
  name: "Axces2000.AudioLoader",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "AudioLoader") return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);
      this.serialize_widgets = true;

      // The Python input is now STRING type, so ComfyUI generates a text widget
      // named "audio". Remove it and replace with our custom canvas widget.
      const idx = this.widgets?.findIndex(w => w.name === "audio");
      if (idx !== undefined && idx >= 0) this.widgets.splice(idx, 1);

      createAudioWidget(this, "audio");
      this.size = [NODE_WIDTH + 20, WIDGET_HEIGHT + 120];

      this.addWidget("button", "📁 Browse file", null, () => {
        const input = document.createElement("input");
        input.type = "file"; input.accept = "audio/*";
        input.onchange = async (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const aw = this.widgets?.find(w => w.name === "audio" && w._uploadFile);
          if (aw) await aw._uploadFile(file);
        };
        input.click();
      });
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (config) {
      onConfigure?.apply(this, arguments);

      // Find the saved filename from widgets_values by matching the widget
      // position in the node's input definition order — same method ComfyUI
      // itself uses internally, which is robust regardless of array index.
      //
      // widgets_values is an array parallel to the node's widget list at save
      // time. Our "audio" widget is always first (index 0) since it replaces
      // the only required input. But we search by name to be safe.
      const aw = this.widgets?.find(w => w.name === "audio" && w._loadAudioFile);
      if (!aw) return;

      // First try: read from widgets_values by index of our widget in the list
      const widgetIndex = this.widgets.indexOf(aw);
      const savedValue  = config.widgets_values?.[widgetIndex]
                       ?? config.widgets_values?.[0];   // fallback to first slot

      if (savedValue && savedValue.trim() !== "") {
        aw._loadAudioFile(savedValue);
      }
    };
  },
});
