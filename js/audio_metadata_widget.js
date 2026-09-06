/**
 * AudioMetadata Widget for ComfyUI  v2.0
 *
 * Preview + on-demand export widget for the "🎵 Audio Metadata" node
 * (OUTPUT_NODE=True). Running the node only stages a temp WAV + peaks +
 * resized cover + tag sidecars — nothing is auto-saved anywhere. Clicking
 * "💾 Save As…" opens a small menu (WAV / FLAC / MP3 at a chosen bitrate /
 * OGG Vorbis); picking one fetches
 * /audio_metadata/export/{filename}?fmt=...&bitrate=... and triggers a
 * normal browser download. This mirrors Audio Player's
 * showDownloadMenu()/triggerDownload() flow exactly — all four formats
 * come back fully tagged (ID3 for WAV/MP3, Vorbis comments for FLAC/OGG,
 * cover art included either way — see the Python side for the two
 * different tagging schemes involved).
 *
 * Two lessons carried over verbatim from Audio Player debugging:
 *
 *  1. Tab switches call onConfigure(), NOT onExecuted(). We stash the last
 *     UI payload on `node.properties.lastAudioData` inside onExecuted, and
 *     onConfigure() re-fetches peaks + rebuilds the widget from that saved
 *     payload — otherwise the preview vanishes on a tab switch.
 *
 *  2. A module-level `_audioRegistry` Map (keyed by filename) survives
 *     across widget reconstructions, because the JS module itself is never
 *     unloaded on a tab switch — only widget instances come and go. Without
 *     it, onConfigure would spin up a second <audio> element for a file
 *     that's still playing, causing overlapping/duplicate playback.
 */

import { app } from "../../../scripts/app.js";

const WIDGET_NAME = "am_preview";
const WAVE_H = 90, COVER_SZ = 72, INFO_H = 30, BTN_ROW_H = 30, GAP = 6, PAD = 10;
const MIN_NODE_W = 340;

const C = {
    bg:         "#0f172a",
    bar:        "#38bdf8",
    barPlayed:  "#fbbf24",
    playhead:   "#f8fafc",
    text:       "#94a3b8",
    textBright: "#e2e8f0",
    border:     "#1e293b",
    btnBg:      "#1e293b",
    btnHover:   "#28374d",
    saveBg:     "#164e63",
    saveHover:  "#1b6480",
};

function fmtTime(s) {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60), sc = Math.floor(s % 60);
    return `${m}:${String(sc).padStart(2, "0")}`;
}

// Same route ComfyUI's core /view endpoint already serves temp files from —
// reused as-is by Audio Player for its own playback, so no dedicated
// "serve raw audio" route is needed on our side either.
function previewUrl(filename) {
    return `/view?filename=${encodeURIComponent(filename)}&type=temp`;
}

// ── Module-level audio element registry ──────────────────────────────────────
// See file header — survives tab switches because the module itself is
// never unloaded, only widget instances come and go.
const _audioRegistry = new Map();

// ── Download helpers (mirrors audio_player_widget.js's triggerDownload) ──────
function triggerDownload(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const EXPORT_MIME = { wav: "audio/wav", mp3: "audio/mpeg", flac: "audio/flac", ogg: "audio/ogg" };

async function exportAndDownload(filename, fmt, bitrate, onStatus) {
    const isMp3 = fmt === "mp3";
    onStatus(isMp3 ? `Encoding MP3 (${bitrate}kbps)…`
                   : fmt === "wav" ? "Preparing WAV…" : `Encoding ${fmt.toUpperCase()}…`);
    const qs = isMp3 ? `?fmt=mp3&bitrate=${bitrate}` : `?fmt=${fmt}`;
    const resp = await fetch(`/audio_metadata/export/${encodeURIComponent(filename)}${qs}`);
    if (!resp.ok) throw new Error(await resp.text());
    const buf = await resp.arrayBuffer();
    const cd = resp.headers.get("Content-Disposition") || "";
    const match = cd.match(/filename="([^"]+)"/);
    const dlName = match ? match[1] : (isMp3 ? `audio_output_${bitrate}k.mp3` : `audio_output.${fmt}`);
    triggerDownload(new Blob([buf], { type: EXPORT_MIME[fmt] }), dlName);
    onStatus(null);
}

function showSaveAsMenu(filename, clientX, clientY) {
    document.getElementById("am-save-menu")?.remove();
    const menu = document.createElement("div");
    menu.id = "am-save-menu";
    Object.assign(menu.style, {
        position: "fixed", left: "-9999px", top: "-9999px",
        background: "#1e1e2e", border: "1px solid #3a3a5c", borderRadius: "8px",
        padding: "4px 0", zIndex: "9999", minWidth: "190px",
        boxShadow: "0 4px 16px rgba(0,0,0,.5)", fontFamily: "sans-serif", fontSize: "13px",
    });

    const statusEl = document.createElement("div");
    Object.assign(statusEl.style, { padding: "4px 14px", color: "#6b6b9a", fontSize: "11px", display: "none" });
    menu.appendChild(statusEl);

    function addSeparator(label) {
        const sep = document.createElement("div");
        sep.textContent = label;
        Object.assign(sep.style, {
            padding: "4px 14px 2px", color: "#4a4880", fontSize: "10px",
            textTransform: "uppercase", letterSpacing: "0.08em",
            borderTop: "1px solid #2d2b55", marginTop: "2px",
        });
        menu.appendChild(sep);
    }

    function addItem(label, fmt, bitrate) {
        const item = document.createElement("div");
        item.textContent = "🏷️  " + label;
        Object.assign(item.style, { padding: "8px 14px", color: "#c8c8e8", cursor: "pointer", whiteSpace: "nowrap" });
        item.onmouseenter = () => item.style.background = "#2d2b55";
        item.onmouseleave = () => item.style.background = "";
        item.onclick = () => {
            statusEl.style.display = "block";
            exportAndDownload(filename, fmt, bitrate, msg => {
                if (msg) statusEl.textContent = msg;
                else menu.remove();
            }).catch(e => {
                statusEl.textContent = "Error: " + e.message;
                setTimeout(() => menu.remove(), 3000);
            });
        };
        menu.appendChild(item);
    }

    addSeparator("Lossless (tagged)");
    addItem("WAV — with tags & cover", "wav", null);
    addItem("FLAC — with tags & cover", "flac", null);

    addSeparator("Lossy (tagged)");
    for (const kbps of [128, 192, 256, 320]) {
        addItem(`MP3 (${kbps}kbps)`, "mp3", kbps);
    }
    addItem("OGG (Vorbis) — with tags & cover", "ogg", null);

    document.body.appendChild(menu);
    requestAnimationFrame(() => {
        const mw = menu.offsetWidth, mh = menu.offsetHeight;
        let left = clientX, top = clientY;
        if (left + mw > window.innerWidth)  left = window.innerWidth - mw - 4;
        if (top + mh > window.innerHeight)  top = window.innerHeight - mh - 4;
        menu.style.left = `${Math.max(4, left)}px`;
        menu.style.top  = `${Math.max(4, top)}px`;
    });

    const closeOnOutsideClick = (e) => {
        if (!menu.contains(e.target)) {
            menu.remove();
            document.removeEventListener("pointerdown", closeOnOutsideClick, true);
        }
    };
    setTimeout(() => document.addEventListener("pointerdown", closeOnOutsideClick, true), 0);
}

// ── Widget factory ────────────────────────────────────────────────────────────
function makeAudioMetadataWidget(node, data) {
    const { filename, peaks, duration, has_cover, title, artist, album } = data;

    const _existing = _audioRegistry.get(filename);
    const audioEl = _existing ?? new Audio(previewUrl(filename));
    if (!_existing) {
        audioEl.preload = "auto";
        audioEl.addEventListener("error", e =>
            console.error("[AudioMetadata] audio error:", e, audioEl.error));
    }
    _audioRegistry.set(filename, audioEl);

    let playState = audioEl.paused ? "stopped" : "playing";
    let playheadFrac = 0;
    let animFrame = null;
    let coverImg = null;
    let hoveredBtn = null;

    if (has_cover) {
        const img = new Image();
        img.onload = () => { coverImg = img; node.setDirtyCanvas(true, false); };
        img.src = `/audio_metadata/cover/${filename}`;
    }

    function tick() {
        if (audioEl.duration) playheadFrac = audioEl.currentTime / audioEl.duration;
        node.setDirtyCanvas(true, false);
        if (playState === "playing") animFrame = requestAnimationFrame(tick);
    }

    audioEl.addEventListener("ended", () => {
        playState = "stopped"; playheadFrac = 0;
        cancelAnimationFrame(animFrame);
        node.setDirtyCanvas(true, false);
    });

    function handlePlayPause() {
        if (playState === "playing") {
            audioEl.pause(); playState = "paused";
            cancelAnimationFrame(animFrame);
        } else {
            audioEl.play().catch(e => console.error("[AudioMetadata] play() failed:", e));
            playState = "playing";
            animFrame = requestAnimationFrame(tick);
        }
        node.setDirtyCanvas(true, false);
    }

    function handleStop() {
        audioEl.pause(); audioEl.currentTime = 0;
        playState = "stopped"; playheadFrac = 0;
        cancelAnimationFrame(animFrame);
        node.setDirtyCanvas(true, false);
    }

    const widget = {
        type: "custom_audio_metadata",
        name: WIDGET_NAME,
        options: {},
        value: null,
        y: 0,

        computeSize(width) {
            return [width, WAVE_H + INFO_H + BTN_ROW_H * 2 + GAP + 14];
        },

        draw(ctx, node2, widget_width, y) {
            this.y = y;
            const x = PAD, w = widget_width - PAD * 2;

            ctx.save();

            // Waveform panel
            ctx.fillStyle = C.bg;
            ctx.fillRect(x, y, w, WAVE_H);
            ctx.strokeStyle = C.border;
            ctx.strokeRect(x, y, w, WAVE_H);

            const waveX = coverImg ? x + COVER_SZ + 8 : x + 6;
            const waveW = coverImg ? w - COVER_SZ - 8 - 6 : w - 12;

            if (coverImg) {
                ctx.drawImage(coverImg, x + 6, y + (WAVE_H - COVER_SZ) / 2, COVER_SZ, COVER_SZ);
            }

            if (peaks && peaks.length) {
                const barGap = 1;
                const barW = Math.max(1, waveW / peaks.length - barGap);
                const midY = y + WAVE_H / 2;
                for (let i = 0; i < peaks.length; i++) {
                    const p  = peaks[i];
                    const bh = Math.max(2, p * (WAVE_H - 16));
                    const bx = waveX + i * (barW + barGap);
                    ctx.fillStyle = (i / peaks.length) <= playheadFrac ? C.barPlayed : C.bar;
                    ctx.fillRect(bx, midY - bh / 2, barW, bh);
                }
                ctx.strokeStyle = C.playhead;
                ctx.lineWidth = 1;
                ctx.beginPath();
                const phX = waveX + playheadFrac * waveW;
                ctx.moveTo(phX, y + 4); ctx.lineTo(phX, y + WAVE_H - 4);
                ctx.stroke();
            } else {
                ctx.fillStyle = C.text;
                ctx.font = "11px sans-serif";
                ctx.fillText("Loading waveform…", waveX + 4, y + WAVE_H / 2 + 4);
            }

            // Info row
            const infoY = y + WAVE_H + 6;
            ctx.fillStyle = C.textBright;
            ctx.font = "12px sans-serif";
            const label = title || filename;
            ctx.fillText(label.length > 40 ? label.slice(0, 37) + "…" : label, x + 2, infoY + 10);

            ctx.fillStyle = C.text;
            ctx.font = "10px sans-serif";
            const subLabel = [artist, album].filter(Boolean).join(" — ") || "Not exported yet";
            ctx.fillText(subLabel.length > 48 ? subLabel.slice(0, 45) + "…" : subLabel, x + 2, infoY + 22);

            ctx.textAlign = "right";
            ctx.fillText(fmtTime(duration), x + w - 2, infoY + 10);
            ctx.textAlign = "left";

            // Row 1: Play / Stop
            const row1Y = infoY + INFO_H;
            const gap = 8;
            const btnW = (w - gap) / 2;
            const bh = BTN_ROW_H - 6;

            const drawBtn = (bx, by, bw, label2, bg, hovered) => {
                ctx.fillStyle = hovered ? bg.hover : bg.base;
                ctx.beginPath();
                if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 6); else ctx.rect(bx, by, bw, bh);
                ctx.fill();
                ctx.fillStyle = C.textBright;
                ctx.font = "12px sans-serif";
                ctx.textAlign = "center";
                ctx.fillText(label2, bx + bw / 2, by + bh / 2 + 4);
                ctx.textAlign = "left";
            };

            const playX = x, stopX = x + btnW + gap;
            const stdBg = { base: C.btnBg, hover: C.btnHover };
            drawBtn(playX, row1Y, btnW, playState === "playing" ? "⏸ Pause" : "▶ Play", stdBg, hoveredBtn === "play");
            drawBtn(stopX, row1Y, btnW, "⏹ Stop", stdBg, hoveredBtn === "stop");

            // Row 2: Save As (full width)
            const row2Y = row1Y + BTN_ROW_H + GAP;
            const saveBg = { base: C.saveBg, hover: C.saveHover };
            drawBtn(x, row2Y, w, "💾 Save As…", saveBg, hoveredBtn === "save");

            this._z = { playX, stopX, row1Y, btnW, bh, saveX: x, saveW: w, row2Y };

            ctx.restore();
        },

        mouse(event, pos, node2) {
            if (!this._z) return false;
            const [mx, my] = pos, z = this._z;
            const inRow1 = my >= z.row1Y && my <= z.row1Y + z.bh;
            const inRow2 = my >= z.row2Y && my <= z.row2Y + z.bh;

            if (event.type === "pointermove") {
                let h = null;
                if (inRow1 && mx >= z.playX && mx <= z.playX + z.btnW) h = "play";
                else if (inRow1 && mx >= z.stopX && mx <= z.stopX + z.btnW) h = "stop";
                else if (inRow2 && mx >= z.saveX && mx <= z.saveX + z.saveW) h = "save";
                if (h !== hoveredBtn) { hoveredBtn = h; node2.setDirtyCanvas(true, false); }
            }

            if (event.type === "pointerdown") {
                if (inRow1 && mx >= z.playX && mx <= z.playX + z.btnW) { handlePlayPause(); return true; }
                if (inRow1 && mx >= z.stopX && mx <= z.stopX + z.btnW) { handleStop(); return true; }
                if (inRow2 && mx >= z.saveX && mx <= z.saveX + z.saveW) {
                    if (document.getElementById("am-save-menu")) {
                        document.getElementById("am-save-menu").remove();
                        return true;
                    }
                    const cx = event.clientX ?? mx;
                    const cy = event.clientY ?? my;
                    showSaveAsMenu(filename, cx, cy);
                    return true;
                }
            }
            return false;
        },

        onRemoved() {
            // Deliberately do NOT pause/clear audioEl here — a tab switch
            // removes and recreates this widget, and audio should keep
            // playing across that. Real cleanup is in node.onRemoved below.
        },
    };

    return widget;
}

// ── Register ─────────────────────────────────────────────────────────────────
app.registerExtension({
    name: "Axces2000.AudioMetadata",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "AudioMetadataNode") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            this.serialize_widgets = true;
        };

        const onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            const filename = this.properties?.lastAudioData?.filename;
            if (filename) {
                const el = _audioRegistry.get(filename);
                if (el) { el.pause(); el.src = ""; _audioRegistry.delete(filename); }
            }
            document.getElementById("am-save-menu")?.remove();
            onRemoved?.apply(this, arguments);
        };

        // Tab-switch / workflow-reload restore. onExecuted is NOT re-fired
        // when LiteGraph reconstructs the node from saved JSON — only
        // onConfigure runs. Re-fetch peaks (from the .peaks.json sidecar,
        // so this also survives a server restart) and rebuild the widget
        // exactly as onExecuted does below.
        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (info) {
            onConfigure?.apply(this, arguments);

            const saved = this.properties?.lastAudioData;
            if (!saved?.filename) return;

            const self = this;
            fetch(`/audio_metadata/peaks/${saved.filename}`)
                .then(r => { if (!r.ok) throw new Error("peaks not found"); return r.json(); })
                .then(peaksData => {
                    const data = { ...saved, peaks: peaksData.ch0 || [] };
                    if (!self.widgets) self.widgets = [];
                    const idx = self.widgets.findIndex(w => w.name === WIDGET_NAME);
                    if (idx >= 0) self.widgets.splice(idx, 1);
                    self.widgets.push(makeAudioMetadataWidget(self, data));
                    self.setDirtyCanvas(true, true);
                })
                .catch(e => console.warn("[AudioMetadata] onConfigure restore skipped:", e.message));
        };

        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            onExecuted?.apply(this, arguments);

            const payloads = message?.audio_metadata;
            if (!payloads?.length) return;

            const raw = payloads[0];
            const self = this;

            if (!self.properties) self.properties = {};
            self.properties.lastAudioData = { ...raw };

            fetch(`/audio_metadata/peaks/${raw.filename}`)
                .then(r => r.json())
                .then(peaksData => {
                    const data = { ...raw, peaks: peaksData.ch0 || [] };
                    if (!self.widgets) self.widgets = [];
                    const idx = self.widgets.findIndex(w => w.name === WIDGET_NAME);
                    if (idx >= 0) self.widgets.splice(idx, 1);
                    self.widgets.push(makeAudioMetadataWidget(self, data));

                    const MIN_H = WAVE_H + INFO_H + BTN_ROW_H * 2 + GAP + 90;
                    if (self.size[1] < MIN_H) {
                        self.setSize([Math.max(self.size[0], MIN_NODE_W), MIN_H]);
                    }
                    self.setDirtyCanvas(true, true);
                })
                .catch(e => console.error("[AudioMetadata] failed to fetch peaks:", e));
        };
    },
});
