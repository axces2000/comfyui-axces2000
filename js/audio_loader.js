/**
 * AudioLoader Widget for ComfyUI
 * Provides: drag-and-drop upload, waveform visualization,
 * play/pause/stop controls, position indicator, duration display.
 */

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// ─── Constants ────────────────────────────────────────────────────────────────
const WIDGET_HEIGHT = 160;
const WAVEFORM_COLOR = "#4ade80";
const WAVEFORM_PLAYED_COLOR = "#86efac";
const WAVEFORM_BG = "#0f172a";
const PLAYHEAD_COLOR = "#f8fafc";
const ACCENT = "#22d3ee";
const NODE_WIDTH = 340;

// ─── Utility: format seconds → HH:MM:SS.mmm ──────────────────────────────────
function formatDuration(seconds) {
  if (!isFinite(seconds) || seconds < 0) return "00:00:00.000";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return [
    String(h).padStart(2, "0"),
    String(m).padStart(2, "0"),
    String(s).padStart(2, "0"),
  ].join(":") + "." + String(ms).padStart(3, "0");
}

// ─── Waveform decoder (runs in worker-like async fashion) ─────────────────────
async function decodeWaveformPeaks(arrayBuffer, numBars = 200) {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const decoded = await audioCtx.decodeAudioData(arrayBuffer);
    const channelData = decoded.getChannelData(0); // use first channel
    const blockSize = Math.floor(channelData.length / numBars);
    const peaks = [];
    for (let i = 0; i < numBars; i++) {
      let max = 0;
      const start = i * blockSize;
      for (let j = 0; j < blockSize; j++) {
        const val = Math.abs(channelData[start + j]);
        if (val > max) max = val;
      }
      peaks.push(max);
    }
    // Normalize
    const globalMax = Math.max(...peaks, 0.001);
    return { peaks: peaks.map(p => p / globalMax), duration: decoded.duration };
  } finally {
    audioCtx.close();
  }
}

// ─── Main Widget Factory ──────────────────────────────────────────────────────
function createAudioWidget(node, inputName, inputData) {
  // State
  let audioUrl = null;
  let audioPeaks = [];
  let audioDuration = 0;
  let audioElement = null;
  let playState = "stopped"; // 'stopped' | 'playing' | 'paused'
  let playheadPos = 0; // 0..1
  let animFrame = null;
  let isDraggingPlayhead = false;
  let isDragOver = false;
  let currentFilename = null;

  // ─── Canvas widget ───────────────────────────────────────────────────────
  const widget = node.addWidget("AUDIO_LOADER_WIDGET", inputName, "", () => {}, {
    serialize: true,
  });

  widget.computeSize = () => [NODE_WIDTH, WIDGET_HEIGHT + 60];

  // ─── Audio element setup ─────────────────────────────────────────────────
  function setupAudio(url) {
    if (audioElement) {
      audioElement.pause();
      audioElement.src = "";
    }
    audioElement = new Audio(url);
    audioElement.addEventListener("ended", () => {
      playState = "stopped";
      playheadPos = 0;
      cancelAnimationFrame(animFrame);
      node.setDirtyCanvas(true, false);
    });
    audioElement.addEventListener("error", (e) => {
      console.error("[AudioLoader] Audio playback error", e);
    });
  }

  function updatePlayhead() {
    if (audioElement && audioElement.duration) {
      playheadPos = audioElement.currentTime / audioElement.duration;
    }
    node.setDirtyCanvas(true, false);
    if (playState === "playing") {
      animFrame = requestAnimationFrame(updatePlayhead);
    }
  }

  // ─── Load file from ComfyUI input dir ───────────────────────────────────
  async function loadAudioFile(filename) {
    currentFilename = filename;
    widget.value = filename;

    const url = api.apiURL(`/view?filename=${encodeURIComponent(filename)}&type=input`);
    audioUrl = url;

    // Decode waveform
    try {
      const res = await fetch(url);
      const buf = await res.arrayBuffer();
      const result = await decodeWaveformPeaks(buf.slice(0));
      audioPeaks = result.peaks;
      audioDuration = result.duration;
    } catch (e) {
      console.error("[AudioLoader] Waveform decode error", e);
      audioPeaks = [];
      audioDuration = 0;
    }

    setupAudio(url);
    playState = "stopped";
    playheadPos = 0;
    node.setDirtyCanvas(true, false);
  }

  // ─── Upload handler ──────────────────────────────────────────────────────
  async function uploadFile(file) {
    const formData = new FormData();
    formData.append("image", file, file.name); // ComfyUI uses "image" field
    try {
      const res = await api.fetchApi("/upload/audio", { method: "POST", body: formData });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      await loadAudioFile(data.name);
    } catch (e) {
      console.error("[AudioLoader] Upload error", e);
      alert("Upload failed: " + e.message);
    }
  }

  // ─── Draw ────────────────────────────────────────────────────────────────
  widget.draw = function (ctx, node, width, y, height) {
    const x = 10;
    const w = width - 20;
    const waveH = WIDGET_HEIGHT;
    const controlsY = y + waveH + 4;

    // Background
    ctx.fillStyle = WAVEFORM_BG;
    ctx.beginPath();
    ctx.roundRect(x, y, w, waveH, 8);
    ctx.fill();

    // Border (highlighted when drag over)
    ctx.strokeStyle = isDragOver ? ACCENT : "#1e293b";
    ctx.lineWidth = isDragOver ? 2 : 1;
    ctx.beginPath();
    ctx.roundRect(x, y, w, waveH, 8);
    ctx.stroke();

    // ── Waveform bars ──
    if (audioPeaks.length > 0) {
      const barCount = audioPeaks.length;
      const barW = (w - 20) / barCount;
      const centerY = y + waveH / 2;
      const maxBarH = waveH / 2 - 12;

      for (let i = 0; i < barCount; i++) {
        const bx = x + 10 + i * barW;
        const bh = Math.max(2, audioPeaks[i] * maxBarH);
        const frac = i / barCount;
        const played = frac <= playheadPos;
        ctx.fillStyle = played ? WAVEFORM_COLOR : "#1e3a2f";
        ctx.beginPath();
        ctx.roundRect(bx, centerY - bh, Math.max(1, barW - 1), bh * 2, 1);
        ctx.fill();
      }

      // Playhead line
      const phX = x + 10 + playheadPos * (w - 20);
      ctx.strokeStyle = PLAYHEAD_COLOR;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(phX, y + 6);
      ctx.lineTo(phX, y + waveH - 6);
      ctx.stroke();

      // Playhead triangle
      ctx.fillStyle = PLAYHEAD_COLOR;
      ctx.beginPath();
      ctx.moveTo(phX - 5, y + 6);
      ctx.lineTo(phX + 5, y + 6);
      ctx.lineTo(phX, y + 14);
      ctx.closePath();
      ctx.fill();

    } else {
      // Empty state / drag prompt
      ctx.fillStyle = isDragOver ? ACCENT : "#334155";
      ctx.font = "bold 13px monospace";
      ctx.textAlign = "center";
      ctx.fillText(
        isDragOver ? "Drop audio file here" : "🎵  Drag & drop audio  /  select below",
        x + w / 2,
        y + waveH / 2 - 8
      );
      ctx.font = "11px monospace";
      ctx.fillStyle = "#64748b";
      ctx.fillText("MP3 · WAV · FLAC · OGG · AAC · M4A", x + w / 2, y + waveH / 2 + 12);
      ctx.textAlign = "left";
    }

    // ── Duration display ──
    const currentTime = audioElement ? audioElement.currentTime : 0;
    ctx.fillStyle = "#94a3b8";
    ctx.font = "10px monospace";
    ctx.textAlign = "left";
    ctx.fillText(formatDuration(currentTime), x + 12, y + waveH - 6);
    ctx.textAlign = "right";
    ctx.fillText(formatDuration(audioDuration), x + w - 12, y + waveH - 6);
    ctx.textAlign = "left";

    // ── Filename ──
    if (currentFilename) {
      ctx.fillStyle = "#64748b";
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      const truncated = currentFilename.length > 40
        ? currentFilename.slice(0, 38) + "…"
        : currentFilename;
      ctx.fillText(truncated, x + w / 2, y + waveH + 16);
      ctx.textAlign = "left";
    }

    // ── Controls ──
    const btnY = controlsY + (currentFilename ? 22 : 6);
    const btnSize = 28;
    const btnGap = 8;
    const totalBtns = 3;
    const totalBtnW = totalBtns * btnSize + (totalBtns - 1) * btnGap;
    const btnStartX = x + w / 2 - totalBtnW / 2;

    const buttons = [
      { label: playState === "playing" ? "⏸" : "▶", action: "play", bx: btnStartX },
      { label: "⏹", action: "stop", bx: btnStartX + btnSize + btnGap },
    ];

    // Store button positions for hit testing
    widget._buttons = buttons.map(b => ({ ...b, y: btnY, size: btnSize }));

    buttons.forEach(btn => {
      const active = btn.action === "play" && playState === "playing";
      ctx.fillStyle = active ? ACCENT : "#1e293b";
      ctx.strokeStyle = active ? ACCENT : "#334155";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(btn.bx, btnY, btnSize, btnSize, 6);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = active ? "#0f172a" : "#e2e8f0";
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(btn.label, btn.bx + btnSize / 2, btnY + btnSize / 2 + 5);
      ctx.textAlign = "left";
    });

    // Disable hint if no audio
    if (!currentFilename) {
      ctx.fillStyle = "#334155";
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      ctx.fillText("Load a file to enable playback", x + w / 2, btnY + btnSize + 16);
      ctx.textAlign = "left";
    }
  };

  // ─── Mouse events ────────────────────────────────────────────────────────
  widget.mouse = function (event, pos, node) {
    const [mx, my] = pos;
    const x = 10;
    const w = node.size[0] - 20;
    const waveTop = this.last_y || 0;
    const waveBottom = waveTop + WIDGET_HEIGHT;

    // Playhead drag on waveform
    if (audioPeaks.length > 0 && my >= waveTop && my <= waveBottom) {
      if (event.type === "pointerdown") {
        isDraggingPlayhead = true;
      }
    }

    if (isDraggingPlayhead) {
      const frac = Math.max(0, Math.min(1, (mx - x - 10) / (w - 20)));
      playheadPos = frac;
      if (audioElement && audioElement.duration) {
        audioElement.currentTime = frac * audioElement.duration;
      }
      if (event.type === "pointerup") isDraggingPlayhead = false;
      node.setDirtyCanvas(true, false);
      return true;
    }

    // Button hits
    if (event.type === "pointerdown" && widget._buttons) {
      for (const btn of widget._buttons) {
        if (mx >= btn.bx && mx <= btn.bx + btn.size && my >= btn.y && my <= btn.y + btn.size) {
          handleButtonClick(btn.action);
          return true;
        }
      }
    }

    return false;
  };

  function handleButtonClick(action) {
    if (!audioElement) return;
    if (action === "play") {
      if (playState === "playing") {
        audioElement.pause();
        playState = "paused";
        cancelAnimationFrame(animFrame);
      } else {
        audioElement.play();
        playState = "playing";
        animFrame = requestAnimationFrame(updatePlayhead);
      }
    } else if (action === "stop") {
      audioElement.pause();
      audioElement.currentTime = 0;
      playState = "stopped";
      playheadPos = 0;
      cancelAnimationFrame(animFrame);
    }
    node.setDirtyCanvas(true, false);
  }

  // ─── Serialize / deserialize ─────────────────────────────────────────────
  widget.serializeValue = function () {
    return currentFilename || "";
  };

  // ─── Initial value load ──────────────────────────────────────────────────
  const initialValue = widget.value;
  if (initialValue && initialValue !== "") {
    loadAudioFile(initialValue);
  }

  // ─── Drag and drop on the canvas ─────────────────────────────────────────
  // We hook into the node's canvas drag events via a hidden file input + canvas listeners.
  // ComfyUI's canvas captures drag events globally; we intercept via node event hooks.

  // Expose loadAudioFile so the file selector (added below) can call it
  widget._loadAudioFile = loadAudioFile;
  widget._uploadFile = uploadFile;
  widget._setDragOver = (val) => { isDragOver = val; node.setDirtyCanvas(true, false); };

  return widget;
}


// ─── Register extension ───────────────────────────────────────────────────────
app.registerExtension({
  name: "AudioLoader.Widget",

  async beforeRegisterNodeDef(nodeType, nodeData, app) {
    if (nodeData.name !== "AudioLoader") return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);

      this.serialize_widgets = true;

      // Remove auto-generated combo widget for "audio" input — we replace it
      const existingIdx = this.widgets?.findIndex(w => w.name === "audio");
      if (existingIdx !== undefined && existingIdx >= 0) {
        this.widgets.splice(existingIdx, 1);
      }

      // Create our custom widget
      const audioWidget = createAudioWidget(this, "audio", {});
      this.size = [NODE_WIDTH + 20, WIDGET_HEIGHT + 120];

      // ── File selector button widget ──────────────────────────────────────
      const btnWidget = this.addWidget("button", "📁 Browse file", null, () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "audio/*";
        input.onchange = async (e) => {
          const file = e.target.files[0];
          if (file) await audioWidget._uploadFile(file);
        };
        input.click();
      });

      // ── Drag & drop on the ComfyUI canvas ─────────────────────────────
      // We patch the node's onDragOver / onDrop which LiteGraph calls.
      this.onDragOver = function (e) {
        if (e.dataTransfer?.types?.includes("Files")) {
          audioWidget._setDragOver(true);
          return true;
        }
        return false;
      };

      this.onDragLeave = function () {
        audioWidget._setDragOver(false);
      };

      this.onDrop = async function (e) {
        audioWidget._setDragOver(false);
        const file = e.dataTransfer?.files?.[0];
        if (file && file.type.startsWith("audio/")) {
          await audioWidget._uploadFile(file);
        }
      };
    };

    // Serialize / restore
    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (config) {
      onConfigure?.apply(this, arguments);
      const audioWidget = this.widgets?.find(w => w.name === "audio");
      if (audioWidget && config.widgets_values?.[0]) {
        audioWidget._loadAudioFile(config.widgets_values[0]);
      }
    };
  },
});
