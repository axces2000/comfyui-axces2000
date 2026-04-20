import { app } from "/scripts/app.js";
console.log("[AudioPlayer] script loaded v2");

const NODE_TYPE = "AudioPlayerNode";
const WIDGET_NAME = "audio_player_display";
const WIDGET_H = 252;
const BAR_GAP = 2;
const PAD_X = 14;

const METER_GAP = 6;
const TIME_OFFSET = 24; // moves time text DOWN
const TIME_TO_SCRUB_GAP = 8; // space between time and scrub

let smoothedCorr = 0;

const C = {
    bg: "#1a1a2e",
    barIdle: "#3a3a5c",
    barPlayedLeft: "#6c63ff",
    barPulseRight: "#fff0d6",
    barPlayedRight: "#ff9500",
    barPulseLeft: "#d9d6ff",
    playhead: "#ffffff",
    text: "#c8c8e8",
    textDim: "#6b6b9a",
    btnBg: "#2d2b55",
    btnActive: "#6c63ff",
    scrubBg: "#2d2b55",
    scrubFill: "#6c63ff",
    volTrack: "#2d2b55",
    volFill: "#4a4880",
    volKnob: "#6c63ff",
};

const PEAK_HOLD_MS = 300;
const VIEW_MODES = ["waveform", "eq", "analyzer", "spectrogram"]; // button cycles through these

// ── Spectrogram: psychoacoustic heatmap color LUT (black→purple→red→orange→yellow→white) ──
// Precomputed once at module load — 256 entries as [r,g,b] triples.
const SPEC_LUT = (() => {
    // Gradient stops: [position 0–255, r, g, b]
    const stops = [
        [0, 0, 0, 0], // black
        [40, 20, 0, 60], // deep purple
        [80, 80, 0, 120], // purple
        [120, 180, 0, 40], // red-purple
        [160, 220, 40, 0], // red
        [200, 255, 140, 0], // orange
        [230, 255, 220, 0], // yellow
        [255, 255, 255, 255], // white
    ];
    const lut = new Uint8ClampedArray(256 * 3);
    for (let v = 0; v < 256; v++) {
        let lo = stops[0],
        hi = stops[stops.length - 1];
        for (let s = 0; s < stops.length - 1; s++) {
            if (v >= stops[s][0] && v <= stops[s + 1][0]) {
                lo = stops[s];
                hi = stops[s + 1];
                break;
            }
        }
        const t = lo[0] === hi[0] ? 1 : (v - lo[0]) / (hi[0] - lo[0]);
        lut[v * 3] = Math.round(lo[1] + (hi[1] - lo[1]) * t);
        lut[v * 3 + 1] = Math.round(lo[2] + (hi[2] - lo[2]) * t);
        lut[v * 3 + 2] = Math.round(lo[3] + (hi[3] - lo[3]) * t);
    }
    return lut;
})();

function fmtTime(seconds, showMs = false) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);

    if (showMs) {
        // Gets the first decimal digit
        const ms = Math.floor((seconds % 1) * 10);
        return `${mins}:${secs.toString().padStart(2, '0')}.${ms}`;
    }

    // This part does exactly what your "old" function did
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function lerpColor(a, b, t) {
    const h = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
    const [r1, g1, b1] = h(a),
    [r2, g2, b2] = h(b);
    return `rgb(${Math.round(r1 + (r2 - r1) * t)},${Math.round(g1 + (g2 - g1) * t)},${Math.round(b1 + (b2 - b1) * t)})`;
}

// Precomputed color ramp — after lerpColor so it can call it safely


//const PULSE_L = Array.from({ length: 101 }, (_, i) =>
//    lerpColor(C.barPulseLeft, C.barPlayedLeft, i / 100));

//const PULSE_R = Array.from({ length: 101 }, (_, i) =>
//    lerpColor(C.barPulseRight, C.barPlayedRight, i / 100));

const PULSE_L = Array.from({
    length: 101
}, (_, i) =>
    lerpColor(C.barPlayedLeft, C.barPulseLeft, i / 100)); // Base -> Glow

const PULSE_R = Array.from({
    length: 101
}, (_, i) =>
    lerpColor(C.barPlayedRight, C.barPulseRight, i / 100)); // Base -> Glow

function rr(ctx, x, y, w, h, r) {
    if (h <= 0)
        return;
    r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
}

function drawSpeaker(ctx, cx, cy, sz, muted) {
    ctx.save();
    ctx.fillStyle = C.textDim;
    ctx.strokeStyle = C.textDim;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx - sz * .5, cy - sz * .28);
    ctx.lineTo(cx - sz * .1, cy - sz * .28);
    ctx.lineTo(cx + sz * .3, cy - sz * .65);
    ctx.lineTo(cx + sz * .3, cy + sz * .65);
    ctx.lineTo(cx - sz * .1, cy + sz * .28);
    ctx.lineTo(cx - sz * .5, cy + sz * .28);
    ctx.closePath();
    ctx.fill();
    if (!muted) {
        ctx.beginPath();
        ctx.arc(cx + sz * .3, cy, sz * .42, -Math.PI * .42, Math.PI * .42);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx + sz * .3, cy, sz * .7, -Math.PI * .38, Math.PI * .38);
        ctx.stroke();
    } else {
        ctx.strokeStyle = "#e05555";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx + sz * .4, cy - sz * .4);
        ctx.lineTo(cx + sz * .9, cy + sz * .4);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx + sz * .9, cy - sz * .4);
        ctx.lineTo(cx + sz * .4, cy + sz * .4);
        ctx.stroke();
    }
    ctx.restore();
}

// ── Download helpers ──────────────────────────────────────────────────────────

function triggerDownload(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), {
        href: url,
        download: name
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function audioUrl(filename) {
    return `/view?filename=${encodeURIComponent(filename)}&type=temp`;
}

async function fetchWavBuffer(filename) {
    const resp = await fetch(audioUrl(filename));
    if (!resp.ok)
        throw new Error("Audio not found — re-run the node");
    return await resp.arrayBuffer();
}

async function downloadWav(filename) {
    const buf = await fetchWavBuffer(filename);
    triggerDownload(new Blob([buf], {
            type: "audio/wav"
        }), "audio_output.wav");
}

async function downloadMp3(filename, stereo, bitrate, onStatus) {
    onStatus("Fetching full quality audio…");
    const wavBuf = await fetchWavBuffer(filename);
    onStatus("Encoding MP3…");

    const audioCtx = new(window.AudioContext || window.webkitAudioContext)();
    const buf = await audioCtx.decodeAudioData(wavBuf);
    const nCh = (stereo && buf.numberOfChannels >= 2) ? 2 : 1;

    function toPcm(ch) {
        const f = buf.getChannelData(ch);
        const p = new Int16Array(f.length);
        for (let i = 0; i < f.length; i++)
            p[i] = Math.max(-32768, Math.min(32767, f[i] * 32767));
        return p;
    }

    const pcmL = toPcm(0);
    const pcmR = nCh === 2 ? toPcm(1) : null;

    // ── Web Worker encoding ──
    // The lamejs encoding loop can block the main thread for many seconds on
    // long files. We spin up an inline Worker (no extra file needed) that runs
    // the encode loop off-thread, keeping ComfyUI fully responsive.
    const workerSrc = `
        self.onmessage = async function(e) {
            const { lameUrl, nCh, sampleRate, bitrate, pcmL, pcmR } = e.data;

            // Load lamejs inside the worker
            importScripts(lameUrl);

            const enc   = new lamejs.Mp3Encoder(nCh, sampleRate, bitrate);
            const data  = [];
            const block = 1152;

            for (let i = 0; i < pcmL.length; i += block) {
                const l   = pcmL.subarray(i, i + block);
                const out = nCh === 2
                    ? enc.encodeBuffer(l, pcmR.subarray(i, i + block))
                    : enc.encodeBuffer(l);
                if (out.length) data.push(new Uint8Array(out));
                // Report progress every ~100 chunks
                if (i % (block * 100) === 0)
                    self.postMessage({ type: 'progress', pct: Math.round(i / pcmL.length * 100) });
            }
            const tail = enc.flush();
            if (tail.length) data.push(new Uint8Array(tail));
            self.postMessage({ type: 'done', data }, data.map(d => d.buffer));
        };
    `;

    const blob = new Blob([workerSrc], {
        type: "text/javascript"
    });
    const wUrl = URL.createObjectURL(blob);
    const worker = new Worker(wUrl);

    await new Promise((resolve, reject) => {
        worker.onmessage = (e) => {
            if (e.data.type === "progress") {
                onStatus(`Encoding MP3… ${e.data.pct}%`);
            } else if (e.data.type === "done") {
                triggerDownload(new Blob(e.data.data, {
                        type: "audio/mp3"
                    }), "audio_output.mp3");
                worker.terminate();
                URL.revokeObjectURL(wUrl);
                resolve();
            }
        };
        worker.onerror = (err) => {
            worker.terminate();
            URL.revokeObjectURL(wUrl);
            reject(new Error("MP3 worker error: " + err.message));
        };
        worker.postMessage({
            lameUrl: location.origin + "/extensions/comfyui-axces2000/lib/lame.min.js",
            nCh,
            sampleRate: buf.sampleRate,
            bitrate,
            pcmL,
            pcmR
        },
            pcmR ? [pcmL.buffer, pcmR.buffer] : [pcmL.buffer]);
    });

    onStatus(null);
}

async function downloadFlac(filename, stereo, onStatus) {
    // Server-side encoding — Python uses soundfile/scipy for proper compressed FLAC
    onStatus("Encoding FLAC…");
    const resp = await fetch(`/audio_player/flac/${filename}`);
    if (!resp.ok)
        throw new Error(await resp.text());
    const buf = await resp.arrayBuffer();
    triggerDownload(new Blob([buf], {
            type: "audio/flac"
        }), "audio_output.flac");
    onStatus(null);
}

function showDownloadMenu(filename, stereo, clientX, clientY) {
    document.getElementById("ap-dl-menu")?.remove();
    const menu = document.createElement("div");
    menu.id = "ap-dl-menu";
    Object.assign(menu.style, {
        position: "fixed",
        left: "-9999px",
        top: "-9999px",
        background: "#1e1e2e",
        border: "1px solid #3a3a5c",
        borderRadius: "8px",
        padding: "4px 0",
        zIndex: "9999",
        minWidth: "160px",
        boxShadow: "0 4px 16px rgba(0,0,0,.5)",
        fontFamily: "sans-serif",
        fontSize: "13px",
    });
    const statusEl = document.createElement("div");
    Object.assign(statusEl.style, {
        padding: "4px 14px",
        color: "#6b6b9a",
        fontSize: "11px",
        display: "none"
    });
    menu.appendChild(statusEl);
    function addItem(label, cb) {
        const item = document.createElement("div");
        item.textContent = "♪  " + label;
        Object.assign(item.style, {
            padding: "8px 14px",
            color: "#c8c8e8",
            cursor: "pointer",
            whiteSpace: "nowrap"
        });
        item.onmouseenter = () => item.style.background = "#2d2b55";
        item.onmouseleave = () => item.style.background = "";
        item.onclick = cb;
        menu.appendChild(item);
    }
    addItem("Download WAV", () => {
        downloadWav(filename).catch(e => alert(e.message));
        menu.remove();
    });
    for (const kbps of[128, 192, 320]) {
        addItem(`Download MP3 (${kbps}kbps)`, () => {
            statusEl.style.display = "block";
            downloadMp3(filename, stereo, kbps, msg => {
                if (msg)
                    statusEl.textContent = msg;
                else
                    menu.remove();
            }).catch(e => {
                statusEl.textContent = "Error: " + e.message;
                setTimeout(() => menu.remove(), 3000);
            });
        });
    }
    addItem("Download FLAC", () => {
        statusEl.style.display = "block";
        downloadFlac(filename, stereo, msg => {
            if (msg)
                statusEl.textContent = msg;
            else
                menu.remove();
        })
        .catch(e => {
            statusEl.textContent = "Error: " + e.message;
            setTimeout(() => menu.remove(), 3000);
        });
    });
    document.body.appendChild(menu);
    requestAnimationFrame(() => {
        const mw = menu.offsetWidth,
        mh = menu.offsetHeight;
        let left = clientX - mw,
        top = clientY - mh;
        if (left < 4)
            left = clientX;
        if (top < 4)
            top = clientY + 4;
        menu.style.left = left + "px";
        menu.style.top = top + "px";
    });
    const close = (e) => {
        // Ignore clicks inside the menu
        if (menu.contains(e.target))
            return;

        // Remove menu
        menu.remove();

        // Cleanup listener
        document.removeEventListener("pointerdown", close, true);
    };

    // Use capture phase so it fires BEFORE other handlers
    document.addEventListener("pointerdown", close, true);

}

// ── Widget factory ────────────────────────────────────────────────────────────

function makeAudioPlayerWidget(node, data) {

    let ripple = {
        x: 0,
        y: 0,
        alpha: 0,
        color: "#fff"
    };
    const { filename, peaks, duration, sample_rate, lufs } = data;

    console.log("[AudioPlayer] creating widget, filename=", data.filename, "url=", audioUrl(data.filename));
    const audioEl = new Audio(audioUrl(data.filename));
    audioEl.preload = "auto";
    audioEl.addEventListener("error", e => console.error("[AudioPlayer] audio error:", e, audioEl.error));

    // Web Audio analyser for realtime meter — created lazily on first play
    let audioCtx = null,
    analyserNode = null,
    meterSource = null;
    const METER_BARS = 20; // number of segments in the level meter

    let analyserL = null,
    analyserR = null;

    let analyserConnected = false;
    let analyserSplitter = null;
    let analyserMerger = null;

    // Volume GainNode — sits between meterSource and destination
    // Analysers tap BEFORE this so meters always show true signal
    let gainNode = null;

    function ensureAnalyser() {
        if (analyserNode)
            return;
        try {
            audioCtx = new(window.AudioContext || window.webkitAudioContext)();
            meterSource = audioCtx.createMediaElementSource(audioEl);

            analyserL = audioCtx.createAnalyser();
            analyserL.fftSize = 4096;
            analyserL.smoothingTimeConstant = 0.88;

            analyserR = audioCtx.createAnalyser();
            analyserR.fftSize = 4096;
            analyserR.smoothingTimeConstant = 0.88;

            analyserNode = {
                left: analyserL,
                right: analyserR
            };

            // GainNode controls volume — AFTER analyser tap
            gainNode = audioCtx.createGain();
            gainNode.gain.value = muted ? 0 : volume;

            if (data.stereo) {
                // Stereo: split → tap analysers (pre-volume, true signal)
                //         source → gain → destination (preserves full stereo path)
                const splitter = audioCtx.createChannelSplitter(2);
                analyserSplitter = splitter;
                meterSource.connect(splitter);
                // Analyser tap (pre-volume — true signal, read-only)
                splitter.connect(analyserL, 0);
                splitter.connect(analyserR, 1);
                // Volume path: source → gain → destination directly (no split/merge)
                // GainNode is channel-count-agnostic and passes stereo through cleanly
                meterSource.connect(gainNode);
                gainNode.connect(audioCtx.destination);
            } else {
                // Mono: tap both analysers pre-volume, then gain → destination
                meterSource.connect(analyserL);
                meterSource.connect(analyserR);
                meterSource.connect(gainNode);
                gainNode.connect(audioCtx.destination);
            }
        } catch (e) {
            console.warn("[AudioPlayer] Analyser unavailable:", e);
            analyserNode = null;
        }
    }

    // connectAnalyser/disconnectAnalyser removed — EQ uses the same analyserL,
    // no extra connections needed, no volume difference between modes.
    function connectAnalyser() {
        ensureAnalyser();
    }
    function disconnectAnalyser() { /* no-op — single graph, no mode switching */
    }

    let playing = false,
    currentTime = 0,
    volume = 1,
    muted = false;
    let lastAnalyserUpdate = 0;
    const ANALYSER_INTERVAL = 1000 / 30;

    let viewMode = "waveform"; // will be overwritten by saved value below
    let peakHold = 0;
    let peakHoldTime = 0; // per-instance: timestamp when peak was last hit
    let _lastPeakTime = performance.now(); // per-instance: used by peak decay logic
    let looping = false;

    // Cached EQ gradient — rebuilt only when layout dimensions change
    let _eqGradCache = null; // { grad, wfBottom, wfTop }

    // Phase correlation meter — smoothed value, range [-1, +1]
    let _phaseCorrSmoothed = 0;

    // Per-instance reusable time-domain buffers — avoids a new Uint8Array every 30 ms
    let _timeDomainL = null;
    let _timeDomainR = null;

    // Offscreen canvas cache for idle waveform bars (redrawn only on resize/seek/load)
    let _waveformCache = null; // { canvas, w, nBars, barW, progress, stereo }

    // Spectrogram rolling buffer — persistent offscreen canvas + reusable typed arrays
    let _specCanvas = null; // OffscreenCanvas or regular canvas used as rolling buffer
    let _specCtx = null;
    let _specFreqBuf = null; // reusable Uint8Array for getByteFrequencyData
    let _specImgBuf = null; // reusable ImageData for the new right-edge slice
    let _specW = 0; // last known spectrogram width (invalidate on resize)
    let _specH = 0; // last known spectrogram height

    let draggingVol = false,
    draggingScrub = false;
    let dragSession = null;

    let phase = 0,
    rafId = null,
    _dragRafPending = false;

    function tick() {
        currentTime = audioEl.currentTime;
        phase += 0.07;
        //node.setDirtyCanvas(true, false);
        node.setDirtyCanvas(false, true);

        if (!audioEl.paused) {
            rafId = requestAnimationFrame(tick);
        } else {
            rafId = null;
        }
    }

    function startRAF() {
        if (!rafId)
            rafId = requestAnimationFrame(tick);
    }

    function stopRAF() {
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        node.setDirtyCanvas(true, false); // one final repaint to show paused state
    }

    audioEl.addEventListener("play", () => {
        playing = true;
        ensureAnalyser();
        startRAF();
    });

    audioEl.addEventListener("pause", () => {
        playing = false;
        stopRAF();
    });
    audioEl.addEventListener("ended", () => {
        playing = false;
        currentTime = 0;
        stopRAF();
    });

    let _layoutCache = null;

    // ── Hover state ──────────────────────────────────────────────────────────
    // Tracks which interactive element the pointer is currently over.
    // Used by draw() to apply neon glow effects and by onPointerMove to set
    // the cursor style.  Values: null | "play" | "skipF" | "skipB" | "loop"
    //                           | "dl" | "view" | "vol" | "scrub" | "speaker"
    let _hovered = null;

    function getLayout(w, y, nodeH) {
        if (_layoutCache && _layoutCache._w === w && _layoutCache._y === y && _layoutCache._h === nodeH)
            return _layoutCache;
        const stereo = !!peaks.ch1;
        const chGap = stereo ? 6 : 0;
        // Controls area is always fixed at bottom: meter(39) + scrub(30) + buttons(58) = 127px
        const CTRL_H = 95;
        const wfTop = y + 28;
        // Waveform fills everything between badge and controls
        const wfAvail = Math.max(stereo ? 40 : 40, (nodeH - y) - CTRL_H - 28);
        const chH = stereo ? Math.floor((wfAvail - chGap) / 2) : wfAvail;
        const wfH = stereo ? chH * 2 + chGap : chH;
        const wfBottom = wfTop + wfH;
        const ch0MidY = wfTop + chH / 2;
        const ch1MidY = stereo ? wfTop + chH + chGap + chH / 2 : null;
        const midY = ch0MidY;
        // Controls positioned from wfBottom downward — always consistent

        const timeY = wfBottom + METER_GAP + TIME_OFFSET;

        const scrubTop = timeY + TIME_TO_SCRUB_GAP;

        const scrubH = 4;
        const btnCY = scrubTop + scrubH + 20;
        const btnCX = w / 2;
        // Fit bars to available width — reduce bar count if needed so nothing overflows
        const peakCount = peaks.ch0.length;
        const avail = w - 16;
        const nBars = Math.min(peakCount, Math.max(10, Math.floor(avail / (2 + BAR_GAP))));
        const barW = Math.max(2, (avail - BAR_GAP * (nBars - 1)) / nBars);
        const totalW = nBars * (barW + BAR_GAP) - BAR_GAP;
        const wfX = 8; // always flush left, never negative


        const spkX = 14,
        spkY = btnCY,
        volX = spkX + 16,
        volW = 70,
        volY = btnCY,
        volH = 3,
        knobR = 4;
        const skipR = 12,
        skipGap = 10;
        const skipFCX = btnCX - 16 - skipGap - skipR;
        const skipBCX = btnCX + 16 + skipGap + skipR;
        const loopCX = btnCX + 16 + skipGap + skipR + skipR + skipGap + skipR;
        const loopCY = btnCY;
        const dlBtnCX = w - 24,
        dlBtnCY = btnCY,
        dlBtnR = 10;
        // Place the view button midway between loop and download buttons
        const eqBtnX = Math.round((loopCX + dlBtnCX) / 2);
        _layoutCache = {
            wfTop,
            wfH,
            chH,
            chGap,
            wfBottom,
            midY,
            ch0MidY,
            ch1MidY,
            stereo,
            nBars,
            barW,
            totalW,
            wfX,
            scrubTop,
            scrubH,
            btnCX,
            btnCY,
            spkX,
            spkY,
            volX,
            volW,
            volY,
            volH,
            knobR,
            skipR,
            skipFCX,
            skipBCX,
            loopCX,
            loopCY,
            eqBtnX,
            dlBtnCX,
            dlBtnCY,
            dlBtnR,
            timeY,
            _w: w,
            _y: y,
            _h: nodeH
        };
        return _layoutCache;
    }

    // ── Spectrogram renderer ──────────────────────────────────────────────────
    // Renders a rolling psychoacoustic heatmap: X=time (scrolling left), Y=frequency
    // (log-scaled, bass at bottom). Uses an offscreen rolling buffer — only one
    // new vertical pixel slice is appended per frame; no full redraws.
    function drawSpectrogram(ctx, L) {
        const sgX = Math.round(L.wfX);
        const sgY = Math.round(L.wfTop);
        const sgW = Math.round(L.totalW);
        const sgH = Math.round(L.wfH);

        if (sgW < 4 || sgH < 4)
            return;

        // ── Fallback: not playing or analyser unavailable ──
        if (!analyserNode?.left || !playing) {
            ctx.save();
            ctx.fillStyle = C.textDim;
            ctx.font = "italic 10px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("SPECTROGRAM ACTIVE DURING PLAYBACK", sgX + sgW / 2, sgY + sgH / 2);
            ctx.restore();
            return;
        }

        // ── Init / reinit offscreen buffer on size change ──
        if (!_specCanvas || _specW !== sgW || _specH !== sgH) {
            _specCanvas = document.createElement("canvas");
            _specCanvas.width = sgW;
            _specCanvas.height = sgH;
            _specCtx = _specCanvas.getContext("2d", {
                willReadFrequently: true
            });
            _specCtx.fillStyle = "#000";
            _specCtx.fillRect(0, 0, sgW, sgH);
            _specW = sgW;
            _specH = sgH;
            // Allocate reusable ImageData for the single right-edge column
            _specImgBuf = _specCtx.createImageData(1, sgH);
        }

        // ── Reuse or allocate frequency buffer ──
        const binCount = analyserL.frequencyBinCount;
        if (!_specFreqBuf || _specFreqBuf.length !== binCount) {
            _specFreqBuf = new Uint8Array(binCount);
        }
        analyserL.getByteFrequencyData(_specFreqBuf);

        // ── Logarithmic frequency mapping ──
        // We ignore the top ~25% of bins (ultrasonic noise) and map
        // the remaining bins logarithmically onto the canvas height.
        // y=0 is the top (high freq), y=sgH-1 is the bottom (low freq).
        const usableBins = Math.floor(binCount * 0.75);
        const nyquist = (analyserL.context?.sampleRate ?? 44100) / 2;
        const hzPerBin = nyquist / binCount;
        const fMin = Math.max(20, 1 * hzPerBin); // ~20 Hz floor
        const fMax = usableBins * hzPerBin; // usable ceiling
        const logFMin = Math.log2(fMin);
        const logFMax = Math.log2(fMax);
        const logRange = logFMax - logFMin;

        // Build the new right-edge column into _specImgBuf (1 × sgH pixels)
        const px = _specImgBuf.data;

        for (let row = 0; row < sgH; row++) {
            // row 0 = top = high frequency; row sgH-1 = bottom = low frequency
            const logFrac = 1 - (row / (sgH - 1)); // 0→low, 1→high
            const hz = Math.pow(2, logFMin + logFrac * logRange);
            const binF = hz / hzPerBin;
            const b0 = Math.floor(binF);
            const b1 = b0 + 1;
            const t = binF - b0;

            let amp = b0 >= usableBins - 1
                 ? _specFreqBuf[usableBins - 1]
                 : _specFreqBuf[b0] * (1 - t) + _specFreqBuf[b1] * t;

            // Mild noise floor suppression
            amp = Math.max(0, amp - 4);

            // Map through LUT
            const vi = Math.min(255, Math.round(amp)) * 3;
            const base = row * 4;
            px[base] = SPEC_LUT[vi];
            px[base + 1] = SPEC_LUT[vi + 1];
            px[base + 2] = SPEC_LUT[vi + 2];
            px[base + 3] = 255;
        }

        // ── Shift the rolling buffer left by 1px, append new column ──
        _specCtx.drawImage(_specCanvas, -1, 0);
        _specCtx.putImageData(_specImgBuf, sgW - 1, 0);

        // ── Blit the rolling buffer into the main canvas ──
        ctx.save();
        ctx.beginPath();
        ctx.rect(sgX, sgY, sgW, sgH);
        ctx.clip();
        ctx.drawImage(_specCanvas, sgX, sgY);

        // Subtle frequency axis tick marks (overlay)
        const freqTicks = [100, 500, 1000, 5000, 10000, 20000];

        ctx.font = "bold 8px sans-serif";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        for (const fTick of freqTicks) {
            if (fTick < fMin || fTick > fMax)
                continue;
            const logFrac = (Math.log2(fTick) - logFMin) / logRange;
            const ty = sgY + sgH - logFrac * sgH; // y in canvas coords
            ctx.fillStyle = "rgba(255,255,255,0.18)";
            ctx.fillRect(sgX, Math.round(ty) - 0.5, sgW, 1);
            const label = fTick >= 1000 ? `${fTick / 1000}k` : `${fTick}`;
            ctx.fillStyle = "rgba(255,255,255,0.5)";
            ctx.fillText(label, sgX + sgW - 3, ty);
        }

        ctx.restore();
    }

    // ── Hit-test helper — returns the hover key for a given pointer position ──
    function _hitTest(mx, my, L, w) {
        // Play/Pause (circle r=20)
        if (Math.hypot(mx - L.btnCX, my - L.btnCY) < 20)
            return "play";
        // Skip back
        if (Math.hypot(mx - L.skipFCX, my - L.btnCY) < L.skipR + 4)
            return "skipF";
        // Skip forward
        if (Math.hypot(mx - L.skipBCX, my - L.btnCY) < L.skipR + 4)
            return "skipB";
        // Loop button
        if (Math.hypot(mx - L.loopCX, my - L.loopCY) < L.skipR + 4)
            return "loop";
        // Download button
        if (Math.hypot(mx - L.dlBtnCX, my - L.dlBtnCY) < L.dlBtnR + 4)
            return "dl";
        // View mode button
        if (mx >= L.eqBtnX - 40 && mx <= L.eqBtnX + 40 && my >= L.btnCY - 10 && my <= L.btnCY + 10)
            return "view";
        // Volume slider (speaker + track)
        if (Math.hypot(mx - L.spkX, my - L.spkY) < 12)
            return "speaker";
        if (my >= L.volY - 10 && my <= L.volY + 10 && mx >= L.volX - L.knobR && mx <= L.volX + L.volW + L.knobR)
            return "vol";
        // Scrubber
        if (my >= L.scrubTop - 8 && my <= L.scrubTop + L.scrubH + 8 && mx >= PAD_X && mx <= w - PAD_X)
            return "scrub";
        return null;
    }

    const widget = {
        type: "custom_audio_player",
        name: WIDGET_NAME,
        options: {},
        // widget.value is the single serialised state bag for this widget.
        // ComfyUI persists it automatically when the graph is saved and passes
        // it back via newWidget.value = prevValue on every rerun (see onExecuted).
        // Shape: { viewMode: string, volume: number (0–1), muted: boolean }
        // Older saves may contain a bare string (just viewMode) — draw() and the
        // state-restore block both handle that legacy format gracefully.
        value: { viewMode: "waveform", volume: 1, muted: false },
        y: 0, // updated by draw() each frame

        // ── draw() ────────────────────────────────────────────────────────────────
        // Called by LiteGraph every animation frame while the node is visible.
        // Responsible for painting the entire widget: background, visualisation
        // area (waveform / spectrum / analyzer / spectrogram), level meter, scrub
        // bar, transport controls, hover glows, and click ripples.
        //
        // Parameters:
        //   ctx          – the shared LiteGraph 2D canvas context
        //   node         – the owning LiteGraph node (used for node.size)
        //   widget_width – LiteGraph's suggested width (ignored; we use node.size[0]
        //                  directly so the widget fills the full node even after resize)
        //   y            – vertical offset in canvas-space at which this widget starts
        draw(ctx, node, widget_width, y) {

            // Lazy-initialise the clip-hold timestamp to 0 on the very first frame
            // (avoids a NaN comparison in the clip-LED logic below).
            if (this._clipHold === undefined)
                this._clipHold = 0;

            // Record our top-edge Y so other methods (onHoverMove, mouse) can
            // reference layout geometry without re-computing it from scratch.
            this.y = y;

            // ── Restore persisted state from widget.value ─────────────────────
            // widget.value is written by the mouse handler and serialised by
            // ComfyUI. It is restored here on every frame (cheap string/object
            // compare) so the closure variables stay in sync after a graph reload
            // or node rerun.
            //
            // Backward-compatibility: older saves store a bare string (just the
            // viewMode name). We detect that case and migrate gracefully without
            // crashing. The object shape is:
            //   { viewMode: string, volume: number, muted: boolean }
            if (this.value) {
                if (typeof this.value === "string") {
                    // Legacy format — promote to object and sync viewMode only
                    const legacyMode = this.value;
                    this.value = { viewMode: legacyMode, volume: volume, muted: muted };
                    viewMode = legacyMode;
                } else {
                    // Current object format — sync all three closure variables
                    if (this.value.viewMode && this.value.viewMode !== viewMode)
                        viewMode = this.value.viewMode;
                    if (typeof this.value.volume === "number" && this.value.volume !== volume) {
                        volume = this.value.volume;
                        if (gainNode)
                            gainNode.gain.value = muted ? 0 : volume;
                    }
                    if (typeof this.value.muted === "boolean" && this.value.muted !== muted) {
                        muted = this.value.muted;
                        if (gainNode)
                            gainNode.gain.value = muted ? 0 : volume;
                    }
                }
            }

            // Always derive width from the live node size, not widget_width.
            // widget_width can lag behind during a drag resize and would cause
            // the content to paint narrower than the actual node boundary.
            const w = node.size[0];

            // Invalidate the layout cache whenever the node is resized so that
            // all geometry is recalculated for the new dimensions next time
            // getLayout() is called.
            if (_layoutCache && (_layoutCache._w !== w || _layoutCache._h !== node.size[1]))
                _layoutCache = null;

            // Invalidate the spectrogram offscreen canvas if the visualisation
            // area has changed size — drawSpectrogram() will reallocate it.
            if (_specCanvas && (_specW !== Math.round(getLayout(w, y, node.size[1]).totalW) ||
                    _specH !== Math.round(getLayout(w, y, node.size[1]).wfH))) {
                _specCanvas = null; // force reinit in drawSpectrogram
            }

            // Compute (or retrieve cached) layout geometry for this frame.
            const L = getLayout(w, y, node.size[1]);

            // Playback progress as a 0–1 fraction, clamped so scrub/playhead
            // never exceed the right edge if currentTime slightly overshoots.
            const progress = duration > 0 ? Math.min(currentTime / duration, 1) : 0;

            // Effective volume sent to the gain node: 0 when muted, otherwise
            // the raw 0–1 volume slider value.
            const vol = muted ? 0 : volume;

            // Timestamp used for rate-limiting the analyser read (see level-meter
            // section below).
            const now = performance.now();

            // Push the canvas state so the entire draw() can be unwound with a
            // single ctx.restore() at the end, preventing state leaks into
            // whatever LiteGraph renders after us.
            ctx.save();

            // ── Background ────────────────────────────────────────────────────
            // Fills the full node height below the title bar with a dark
            // rounded rectangle. Using (y+4) / (bgH-8) with a corner radius of
            // 10 gives a small inset so the bg doesn't touch the node border.
            ctx.fillStyle = C.bg;
            const bgH = node.size[1] - y;
            rr(ctx, 4, y + 4, w - 8, bgH - 8, 10);
            ctx.fill();

            // ── Info badge ────────────────────────────────────────────────────
            // Tiny dim text line at the top of the widget showing sample rate,
            // channel count, and (when available) integrated LUFS loudness from
            // the server-side peak analysis.
            ctx.fillStyle = C.textDim;
            ctx.font = "10px sans-serif";
            ctx.textAlign = "left";
            ctx.textBaseline = "alphabetic";
            const lufsStr = lufs !== undefined ? `  ·  ${lufs} LUFS` : "";
            ctx.fillText(`${sample_rate} Hz · ${data.stereo ? "Stereo" : "Mono"}${lufsStr}`, 10, y + 22);

            // ── Channel descriptors ───────────────────────────────────────────
            // Build a small array of per-channel drawing parameters so the
            // waveform renderer can iterate both channels with the same code.
            // Mono files only have ch0; stereo files add ch1.
            // Each entry carries: the peak array (p), the vertical midpoint
            // (midY), the played/idle/pulse colours, and the PULSE_* ramp used
            // for the proximity glow near the playhead.
            const channels = [{
                    p: peaks.ch0,
                    midY: L.ch0MidY,
                    played: C.barPlayedLeft,
                    idle: C.barIdle,
                    pulse: PULSE_L
                },
                ...(L.stereo && peaks.ch1
                     ? [{
                            p: peaks.ch1,
                            midY: L.ch1MidY,
                            played: C.barPlayedRight,
                            idle: "#4d3221",
                            pulse: PULSE_R
                        }
                    ]
                     : [])
            ];

            // ── Main visualisation area ───────────────────────────────────────
            // Dispatches to one of four renderers based on the current viewMode.
            // All renderers paint into the rect defined by L.wfTop/wfBottom/wfX/totalW.
            if (viewMode === "waveform") {
                // ── WAVEFORM VIEW ─────────────────────────────────────────────
                // Draws the pre-computed peak data as a column of rounded bars.
                // Bars to the left of the playhead are painted in the "played"
                // colour; bars to the right are dimmed. The handful of bars
                // closest to the playhead get a pulse glow that fades outward.
                //
                // Performance note: rendering hundreds of rounded-rect fills
                // every frame is expensive. The entire bar layout is therefore
                // drawn once to an offscreen canvas (_waveformCache) and blitted
                // each frame with a single drawImage call. The cache is keyed on
                // a string encoding width, height, quantised progress, playing
                // state, and animation phase — any change triggers a rebuild.
                const snapProgress = Math.round(progress * L.nBars); // quantise to bar steps
                const cacheKey = `${L._w}|${L._h}|${snapProgress}|${playing ? 1 : 0}|${phase.toFixed(1)}`;

                if (!_waveformCache || _waveformCache.key !== cacheKey) {
                    // Cache miss — rebuild the offscreen canvas.
                    // Re-use the existing canvas element if one already exists
                    // to avoid unnecessary DOM allocation on every seek tick.
                    const osc = _waveformCache?.canvas || document.createElement("canvas");
                    osc.width = w;
                    osc.height = node.size[1];
                    const oc = osc.getContext("2d");

                    // Clear to transparent so the bg painted above shows through
                    // between bars and around the edges.
                    oc.clearRect(0, 0, osc.width, osc.height);

                    for (const ch of channels) {
                        for (let i = 0; i < L.nBars; i++) {
                            const bx = L.wfX + i * (L.barW + BAR_GAP);
                            const frac = i / L.nBars;          // 0–1 position of this bar
                            const done = frac < progress;       // true = left of playhead
                            // Map bar index to the nearest peak sample
                            const pi = Math.min(ch.p.length - 1, Math.floor(frac * ch.p.length));
                            // Scale peak to channel height, with a slight headroom margin
                            let h = Math.max(2, ch.p[pi] * L.chH * 0.88);
                            // Normalised distance from this bar to the playhead (0=at head)
                            const nearHead = Math.abs(frac - progress);

                            if (playing && done && nearHead < 0.05) {
                                // Proximity glow: bars within 5% of the playhead
                                // sample into the pre-computed PULSE colour ramp.
                                // The closer to the head, the higher the ramp index
                                // (index 100 = full glow, index 0 = base colour).
                                oc.globalAlpha = 1.0;
                                h = Math.min(h * 1.08, L.chH * 0.95); // slight height boost at the head
                                oc.fillStyle = ch.pulse[Math.round(Math.max(0, 100 - (nearHead / 0.05 * 100)))];
                            } else {
                                // Standard bar: full opacity if played, dimmed if unplayed
                                oc.globalAlpha = done ? 1.0 : 0.35;
                                oc.fillStyle = done ? ch.played : ch.idle;
                            }

                            rr(oc, bx, ch.midY - h / 2, L.barW, h, Math.min(2, L.barW / 2));
                            oc.fill();
                        }

                        // Channel label drawn AFTER bars so it always sits on top.
                        // A semi-transparent dark pill behind the letter keeps it
                        // legible regardless of the bar colour underneath.
                        oc.globalAlpha = 1.0;
                        const label = L.stereo ? (ch === channels[0] ? "L" : "R") : "M";
                        const lblX = L.wfX + 3;
                        const lblY = ch.midY;
                        const lblPadX = 3, lblPadY = 2;
                        oc.font = "bold 9px sans-serif";
                        const lblW = oc.measureText(label).width;
                        // Dark backing pill
                        oc.fillStyle = "rgba(0,0,0,0.55)";
                        rr(oc, lblX - lblPadX, lblY - 5 - lblPadY, lblW + lblPadX * 2, 10 + lblPadY * 2, 3);
                        oc.fill();
                        // Label text
                        oc.fillStyle = C.btnActive;
                        oc.textAlign = "left";
                        oc.textBaseline = "middle";
                        oc.fillText(label, lblX, lblY);
                    }
                    oc.globalAlpha = 1.0;
                    _waveformCache = {
                        canvas: osc,
                        key: cacheKey
                    };
                }

                // Blit the cached offscreen canvas — one drawImage call instead
                // of potentially hundreds of rounded-rect fills per frame.
                ctx.drawImage(_waveformCache.canvas, 0, 0);
                ctx.globalAlpha = 1.0;
            } else if (viewMode === "eq" || viewMode === "analyzer") {

                // ── SPECTRUM ("eq") and ANALYZER views ───────────────────────
                // Both views share the same Mel-scale spectrum curve drawn by
                // the inline drawEQ helper below.  The difference is layout:
                //   • "eq"       — full-width spectrum with frequency labels
                //   • "analyzer" — goniometer on the left (~38% width) +
                //                  phase-correlation gauge + condensed spectrum
                //                  on the right (no frequency labels)
                //
                // drawEQ is defined here as a closure so it can access ctx, L,
                // analyserL, and the gradient cache (_eqGradCache) directly.
                // It is called once for "eq" mode and once for the right panel
                // in "analyzer" mode.
                //
                // Parameters:
                //   eqX/eqW      – left edge and width of the drawing rect
                //   eqTop/Bottom – top and bottom Y coordinates
                //   eqH          – height shorthand (eqBottom - eqTop)
                //   showLabels   – whether to overlay the frequency tick labels

                // ── Shared helper: draws a Mel-scale spectrum fill ────────────
                const drawEQ = (eqX, eqW, eqTop, eqBottom, eqH, showLabels) => {
                    ctx.save(); // ← isolate ALL state changes inside drawEQ

                    // Guard: analyser is created lazily on first play. Show a
                    // placeholder message when the graph isn't live yet.
                    if (!analyserNode?.left || !playing) {
                        ctx.fillStyle = C.textDim;
                        ctx.font = "italic 10px sans-serif";
                        ctx.textAlign = "center";
                        ctx.fillText("SPECTRUM ACTIVE DURING PLAYBACK",
                            eqX + eqW / 2, (eqTop + eqBottom) / 2);
                        ctx.restore();
                        return;
                    }

                    // Allocate (or reuse) the frequency data buffer.
                    if (!this._freqData || this._freqData.length !== analyserL.frequencyBinCount)
                        this._freqData = new Uint8Array(analyserL.frequencyBinCount);
                    analyserL.getByteFrequencyData(this._freqData);
                    const freqData = this._freqData;

                    // ── Mel-scale frequency mapping ───────────────────────────
                    // We cap usable bins at 75% of the FFT output to discard
                    // ultrasonic noise above ~16 kHz.  The remaining bins are
                    // mapped onto the canvas width using the Mel scale, which
                    // perceptually spaces low frequencies (where human hearing
                    // has the most resolution) more widely than high frequencies.
                    const binCount = Math.floor(analyserL.frequencyBinCount * 0.75);
                    const nyquist = (analyserL.context?.sampleRate ?? 44100) / 2;
                    const hzPerBin = nyquist / analyserL.frequencyBinCount;
                    const melOf = (hz) => 2595 * Math.log10(1 + hz / 700);
                    const melMin = melOf(20);       // ~20 Hz floor
                    const melMax = melOf(binCount * hzPerBin);
                    const melRange = melMax - melMin;

                    // Convert a horizontal fraction (0–1) to a fractional FFT bin
                    // index using the inverse Mel formula.
                    const fracToBinFloat = (frac) => {
                        const hz = 700 * (Math.pow(10, (melMin + frac * melRange) / 2595) - 1);
                        return hz / hzPerBin;
                    };

                    // ── Build the spectrum path ───────────────────────────────
                    // One plotPoint per canvas pixel wide. For low-frequency
                    // bins that map to many pixels (widthInBins ≤ 1.2) we
                    // interpolate between adjacent bins. For high-frequency
                    // regions where multiple bins map to one pixel we average
                    // them to avoid aliasing.
                    const plotPoints = Math.ceil(eqW);
                    ctx.beginPath();
                    ctx.moveTo(eqX, eqBottom); // start at bottom-left so the path closes correctly

                    for (let p = 0; p < plotPoints; p++) {
                        const binStart = fracToBinFloat(p / plotPoints);
                        const binEnd = fracToBinFloat((p + 1) / plotPoints);
                        const widthInBins = binEnd - binStart;
                        let val = 0;

                        if (widthInBins <= 1.2) {
                            // Narrow region: linearly interpolate between the two
                            // flanking bins for a smooth sub-bin curve.
                            const index = Math.floor(binStart);
                            const weight = binStart - index;
                            val = index >= binCount - 1
                                 ? freqData[binCount - 1]
                                 : freqData[index] * (1 - weight) + freqData[index + 1] * weight;
                        } else {
                            // Wide region (low-frequency area where many bins
                            // compress into one pixel): average all covered bins
                            // to represent the band energy honestly.
                            let sum = 0,
                            count = 0;
                            for (let b = Math.floor(binStart); b <= Math.ceil(binEnd); b++) {
                                if (b < binCount) {
                                    sum += freqData[b];
                                    count++;
                                }
                            }
                            val = count > 0 ? sum / count : 0;
                        }

                        // Subtract a small noise floor (2/255) to suppress
                        // the faint DC hum that appears even in silence.
                        val = Math.max(0, val - 2);
                        const px = eqX + (p / Math.max(1, plotPoints - 1)) * eqW;
                        // Map 0–255 FFT magnitude to the available vertical height
                        const py = eqBottom - (val / 255) * eqH;
                        ctx.lineTo(px, py);
                    }

                    // Close the path back along the bottom edge to form a filled shape.
                    ctx.lineTo(eqX + eqW, eqBottom);
                    ctx.closePath();

                    // ── Gradient fill ─────────────────────────────────────────
                    // Purple at the bottom → orange at the top. Cached by the
                    // eqBottom/eqTop coordinates; invalidated whenever the
                    // visualisation area is resized.
                    if (!_eqGradCache ||
                        _eqGradCache.eqBottom !== eqBottom ||
                        _eqGradCache.eqTop !== eqTop) {
                        const g = ctx.createLinearGradient(0, eqBottom, 0, eqTop);
                        g.addColorStop(0, C.barPlayedLeft + "aa");
                        g.addColorStop(1, C.barPlayedRight);
                        _eqGradCache = {
                            grad: g,
                            eqBottom,
                            eqTop
                        };
                    }
                    ctx.fillStyle = _eqGradCache.grad;
                    ctx.globalAlpha = 1.0;
                    ctx.fill();

                    // ── Glowing white rim stroke ──────────────────────────────
                    // A thin white line drawn on top of the fill with a soft
                    // shadow gives the curve a neon phosphor look.
                    ctx.lineJoin = "round";
                    ctx.lineCap = "round";
                    ctx.shadowBlur = 4;
                    ctx.shadowColor = "rgba(255,255,255,0.4)";
                    ctx.strokeStyle = "#fff";
                    ctx.lineWidth = 2;
                    ctx.stroke();
                    ctx.shadowBlur = 0;

                    // ── Frequency labels (eq mode only) ──────────────────────
                    // A semi-transparent dark bar at the bottom of the spectrum
                    // carrying four reference frequency markers. Hidden in
                    // analyzer mode where space is tight.
                    if (showLabels) {
                        ctx.save();
                        ctx.globalAlpha = 1.0;
                        // Dark background strip behind the labels
                        ctx.fillStyle = "rgba(0,0,0,0.5)";
                        ctx.fillRect(eqX, eqBottom - 18, eqW, 18);
                        // Thin separator line above the strip
                        ctx.strokeStyle = "rgba(255,255,255,0.1)";
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        ctx.moveTo(eqX, eqBottom - 18);
                        ctx.lineTo(eqX + eqW, eqBottom - 18);
                        ctx.stroke();
                        // Label positions are expressed as fractions of eqW,
                        // manually tuned to land near the corresponding Mel-scale
                        // positions for each frequency.
                        const labels = [{
                                text: "60Hz",
                                pos: 0.04
                            }, {
                                text: "1kHz",
                                pos: 0.33
                            }, {
                                text: "5kHz",
                                pos: 0.65
                            }, {
                                text: "15kHz",
                                pos: 0.92
                            },
                        ];
                        ctx.font = "bold 10px sans-serif";
                        ctx.textAlign = "center";
                        ctx.textBaseline = "middle";
                        labels.forEach(lbl => {
                            ctx.fillStyle = "#fff";
                            ctx.fillText(lbl.text, eqX + lbl.pos * eqW, eqBottom - 9);
                        });
                        ctx.restore(); // inner labels save
                    }
                    ctx.restore(); // outer drawEQ save — restores shadow, lineJoin, etc.
                };

                if (viewMode === "eq") {
                    // ── Full-width spectrum (eq mode) ─────────────────────────
                    // Spectrum fills the entire visualisation rect with labels.
                    drawEQ(L.wfX, L.totalW, L.wfTop, L.wfBottom, L.wfH, true);

                } else {
                    // ── ANALYZER VIEW ─────────────────────────────────────────
                    // Left panel: circular goniometer (stereo phase / M-S scope).
                    // Right panel: phase-correlation semicircle gauge above a
                    //              condensed spectrum strip (no labels).
                    //
                    // Goniometer geometry:
                    //   gonSize  – square size of the scope region (≤38% of width
                    //              so right panel always has some room)
                    //   gonCX/CY – centre of the circle in canvas coordinates
                    //   gonR     – radius (slightly inset so the border is visible)
                    const gonSize = Math.min(L.wfH, Math.floor(L.totalW * 0.38));
                    const gonX = L.wfX;
                    const gonCX = gonX + gonSize / 2;
                    const gonCY = L.wfTop + L.wfH / 2;
                    const gonR = gonSize / 2 - 4; // radius of the circular scope
                    const EQ_PAD = 14; // gap between goniometer and right panel
                    const eqStartX = gonX + gonSize + EQ_PAD;
                    const eqW = (L.wfX + L.totalW) - eqStartX; // right panel width

                    // ── Goniometer background ─────────────────────────────────
                    // Dark fill + three concentric amplitude rings + outer border
                    // give the scope a radar / oscilloscope aesthetic.
                    ctx.save();

                    // Outer circle fill
                    ctx.beginPath();
                    ctx.arc(gonCX, gonCY, gonR, 0, Math.PI * 2);
                    ctx.fillStyle = "rgba(0, 18, 28, 0.92)";
                    ctx.fill();

                    // Concentric ring grid (3 rings at 33%, 66%, 100% radius)
                    // The outermost ring is slightly brighter to mark the clipping boundary.
                    for (let ri = 1; ri <= 3; ri++) {
                        ctx.beginPath();
                        ctx.arc(gonCX, gonCY, gonR * (ri / 3), 0, Math.PI * 2);
                        ctx.strokeStyle = `rgba(0, 200, 255, ${ri === 3 ? 0.25 : 0.12})`;
                        ctx.lineWidth = ri === 3 ? 1.2 : 0.75;
                        ctx.stroke();
                    }

                    // Outer border glow ring
                    ctx.beginPath();
                    ctx.arc(gonCX, gonCY, gonR, 0, Math.PI * 2);
                    ctx.strokeStyle = C.barIdle;
                    ctx.lineWidth = 1.5;
                    ctx.stroke();

                    // Clip subsequent drawing to the circle interior so the
                    // trace dots can't escape outside the scope boundary.
                    ctx.beginPath();
                    ctx.arc(gonCX, gonCY, gonR - 1, 0, Math.PI * 2);
                    ctx.clip();

                    // ── Crosshair + diagonal reference lines ──────────────────
                    // The vertical axis is Mid (L+R) and the horizontal axis is
                    // Side (L−R). The 45° diagonals mark the mono-left and
                    // mono-right quadrants.
                    ctx.strokeStyle = "rgba(0, 200, 255, 0.2)";
                    ctx.lineWidth = 0.75;
                    ctx.setLineDash([3, 4]);
                    ctx.beginPath();
                    ctx.moveTo(gonCX, gonCY - gonR);
                    ctx.lineTo(gonCX, gonCY + gonR);
                    ctx.moveTo(gonCX - gonR, gonCY);
                    ctx.lineTo(gonCX + gonR, gonCY);
                    // 45° diagonals — cos(45°) ≈ 0.707
                    const dg = gonR * 0.707;
                    ctx.moveTo(gonCX - dg, gonCY - dg);
                    ctx.lineTo(gonCX + dg, gonCY + dg);
                    ctx.moveTo(gonCX + dg, gonCY - dg);
                    ctx.lineTo(gonCX - dg, gonCY + dg);
                    ctx.stroke();
                    ctx.setLineDash([]);

                    // ── Axis labels ───────────────────────────────────────────
                    // Drawn outside the clip region so they're never masked.
                    // M = Mid (top), L/R at the sides, +S/−S at lower diagonals
                    // (Side signal with polarity).
                    ctx.restore();
                    ctx.save();
                    ctx.fillStyle = C.textDim;
                    ctx.font = "bold 8px sans-serif";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText("M", gonCX, L.wfTop + (L.wfH - gonSize) / 2 + 10);
                    ctx.fillText("L", gonX + 8, gonCY);
                    ctx.fillText("R", gonX + gonSize - 9, gonCY);
                    ctx.fillText("+S", gonCX - gonR * 0.65, gonCY + gonR * 0.67);
                    ctx.fillText("-S", gonCX + gonR * 0.65, gonCY + gonR * 0.67);
                    ctx.restore();

                    // ── Goniometer trace ──────────────────────────────────────
                    // Plots the L/R stereo field as a Lissajous-style scatter on
                    // the M-S (Mid-Side) axes:
                    //   X = (L − R) * scale   → Side component (left/right spread)
                    //   Y = (L + R) * scale   → Mid component  (up = in-phase)
                    //
                    // A dynamic auto-gain system is applied so that quiet material
                    // still fills the scope visibly. It tracks peak amplitude,
                    // targets ~70% of the radius at 0 dBFS, and smooths the gain
                    // with a slow attack / fast release to avoid jarring jumps.
                    if (analyserNode?.left && analyserNode?.right && playing) {
                        if (!_timeDomainL || _timeDomainL.length !== analyserL.fftSize) {
                            _timeDomainL = new Uint8Array(analyserL.fftSize);
                            _timeDomainR = new Uint8Array(analyserR.fftSize);
                        }
                        analyserL.getByteTimeDomainData(_timeDomainL);
                        analyserR.getByteTimeDomainData(_timeDomainR);

                        // ── Dynamic auto-gain ─────────────────────────────────
                        // Compute peak amplitude this frame to scale the trace
                        // so quiet audio fills the scope and loud audio is clamped.
                        // We target ~70% of the scope radius at 0 dBFS peaks.
                        let peakAmp = 0;
                        // Stride through the buffer at `step` intervals to keep
                        // CPU cost fixed regardless of FFT size.
                        const step = Math.max(1, Math.floor(_timeDomainL.length / 512));
                        for (let i = 0; i < _timeDomainL.length; i += step) {
                            // getByteTimeDomainData returns 0–255; 128 = silence.
                            // Normalise to −1…+1 then take absolute value for peak.
                            const Ls = Math.abs((_timeDomainL[i] / 128) - 1);
                            const Rs = Math.abs((_timeDomainR[i] / 128) - 1);
                            if (Ls > peakAmp)
                                peakAmp = Ls;
                            if (Rs > peakAmp)
                                peakAmp = Rs;
                        }
                        // Smooth gain so it doesn't jump — use instance cache
                        if (!this._gonGain)
                            this._gonGain = 1.0;
                        const targetGain = peakAmp > 0.001
                             ? Math.min(3.0, 0.7 / peakAmp) // boost quiet, cap at 3×
                             : this._gonGain;
                        // Slow attack (0.05) = gradual boost for quiet signals.
                        // Fast release (0.30) = quick pull-back when peaks arrive.
                        this._gonGain += (targetGain - this._gonGain) * (targetGain < this._gonGain ? 0.3 : 0.05);
                        const scale = gonR * 0.88 * this._gonGain;

                        // Draw trace clipped to circle so it can't overflow the scope border
                        ctx.save();
                        ctx.beginPath();
                        ctx.arc(gonCX, gonCY, gonR - 1, 0, Math.PI * 2);
                        ctx.clip();

                        ctx.beginPath();
                        for (let i = 0; i < _timeDomainL.length; i += step) {
                            const Ls = (_timeDomainL[i] / 128) - 1; // normalised L sample
                            const Rs = (_timeDomainR[i] / 128) - 1; // normalised R sample
                            // M-S projection: X = Side (L−R), Y = −Mid (L+R) flipped
                            // so that positive Mid points upward.
                            const gx = gonCX + (Ls - Rs) * scale;
                            const gy = gonCY - (Ls + Rs) * scale;
                            i === 0 ? ctx.moveTo(gx, gy) : ctx.lineTo(gx, gy);
                        }

                        // Cyan phosphor glow matching the radar palette
                        ctx.shadowColor = "rgba(0, 230, 255, 0.7)";
                        ctx.shadowBlur = 6;
                        ctx.strokeStyle = "rgba(0, 220, 255, 0.85)";
                        ctx.lineWidth = 1.5;
                        ctx.globalAlpha = 0.75;
                        ctx.lineJoin = "round";
                        ctx.stroke();
                        ctx.shadowBlur = 0;
                        ctx.globalAlpha = 1.0;
                        ctx.restore();
                    } else {
                        // Analyser not yet initialised or not playing — show hint
                        ctx.fillStyle = C.textDim;
                        ctx.font = "italic 9px sans-serif";
                        ctx.textAlign = "center";
                        ctx.textBaseline = "middle";
                        ctx.fillText("PLAY TO ACTIVATE", gonCX, gonCY);
                    }

                    // ── Phase correlation gauge (right panel) ────────────────
                    // Draws a semicircular arc gauge showing the Pearson
                    // correlation coefficient between the L and R channels:
                    //   +1 = fully in-phase (pure mono)
                    //    0 = uncorrelated (stereo with no common content)
                    //   −1 = fully out-of-phase (sum to silence when folded to mono)
                    //
                    // The gauge is only drawn when the right panel is wide enough
                    // to be legible (> 30 px).
                    if (eqW > 30) {
                        // ── Compute Pearson correlation ───────────────────────
                        // Uses the same strided time-domain buffers fetched for
                        // the goniometer above. Falls back to 0 when not playing.
                        let rawCorr = 0;
                        if (analyserNode?.left && analyserNode?.right && playing &&
                            _timeDomainL && _timeDomainR) {
                            let sumLR = 0,
                            sumL2 = 0,
                            sumR2 = 0;
                            const step = Math.max(1, Math.floor(_timeDomainL.length / 512));
                            for (let i = 0; i < _timeDomainL.length; i += step) {
                                const lv = (_timeDomainL[i] / 128) - 1; // −1…+1
                                const rv = (_timeDomainR[i] / 128) - 1;
                                sumLR += lv * rv;   // cross product
                                sumL2 += lv * lv;   // L energy
                                sumR2 += rv * rv;   // R energy
                            }
                            // Pearson: sumLR / sqrt(sumL2 * sumR2), clamped to [−1, +1]
                            const denom = Math.sqrt(sumL2 * sumR2);
                            rawCorr = denom > 0.0001 ? Math.max(-1, Math.min(1, sumLR / denom)) : 0;
                        }
                        // Smooth with an exponential moving average (α = 0.2) to
                        // stop the needle from jittering on transients.
                        _phaseCorrSmoothed += (rawCorr - _phaseCorrSmoothed) * 0.2;
                        const corr = _phaseCorrSmoothed;

                        ctx.save();

                        // ── Gauge geometry ────────────────────────────────────
                        // The semicircle (180° arc) is centred in the right panel
                        // with the flat edge at the bottom.
                        // gCX is nudged slightly left of centre (÷2.1 vs ÷2) to
                        // give the numeric readout below the arc a bit of breathing
                        // room on the right edge.
                        // gCX — horizontal centre of the gauge.
                        // eqStartX is the left edge of the right panel; adding eqW / 2
                        // places the gauge exactly in the middle of that panel.
                        // To fine-tune: increase the divisor (e.g. 1.9) to shift left,
                        // decrease it (e.g. 2.1) to shift right.
                        const gCX = eqStartX + eqW / 2;
                        const gCY = L.wfTop + L.wfH * 0.75;
                        const gR = Math.min(eqW * 0.40, L.wfH * 0.60);
                        const arcThick = Math.max(6, gR * 0.22); // arc stroke width

                        // Map correlation value [−1…+1] to canvas angle [π…2π].
                        // −1 maps to π (left / 180°), +1 maps to 2π (right / 0°),
                        // 0 maps to 3π/2 (top / 90°).
                        const corrToAngle = (v) => Math.PI + (Math.PI * (1 - (v + 1) / 2));

                        // ── Decorative container box ──────────────────────────
                        // Drawn first (behind everything) and sized directly from
                        // the gauge geometry so it always contains the arc, outer
                        // labels, and numeric readout at every node size.
                        //
                        // outerR mirrors the labelOuterR formula used for the degree
                        // labels (gR + arcThick*0.5 + 8) plus a font-height allowance
                        // (~10 px for the 7px text) and the box padding.
                        {
                            const boxPad = 10;
                            const outerR = gR + arcThick * 0.5 + 8 + 10; // arc outer edge + label + font
                            const boxTop    = gCY - outerR - boxPad;
                            const boxBottom = gCY + 8 + 16 + boxPad; // pivot + readout + pad
                            const boxLeft   = Math.max(eqStartX + 2, gCX - outerR - boxPad);
                            const boxRight  = Math.min(eqStartX + eqW - 2, gCX + outerR + boxPad);
                            ctx.save();
                            ctx.beginPath();
                            ctx.roundRect(boxLeft, boxTop, boxRight - boxLeft, boxBottom - boxTop, 10);
                            ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
                            ctx.fill();
                            ctx.strokeStyle = C.barIdle;
                            ctx.lineWidth = 1;
                            ctx.stroke();
                            ctx.restore();
                        }

                        // ── Segmented colour arc (background track) ──────────
                        // The full 180° arc is divided into colour zones that
                        // give an at-a-glance health reading:
                        //   Green  [−1 → −0.6]  great mono compatibility
                        //   Lime   [−0.6 → −0.2] good
                        //   Yellow [−0.2 → +0.2] caution / neutral
                        //   Orange [+0.2 → +0.6] poor mono compatibility
                        //   Red    [+0.6 → +1.0] phase issues / near anti-phase
                        // Note: the correlation axis is intentionally reversed so
                        // the "good" zone reads on the left (like a VU meter).
                        const arcSegs = [{
                                from: -1.0,
                                to: -0.6,
                                color: "#22aa22"
                            }, // GREEN
                            {
                                from: -0.6,
                                to: -0.2,
                                color: "#88cc00"
                            }, // LIME
                            {
                                from: -0.2,
                                to: 0.2,
                                color: "#cccc00"
                            }, // YELLOW
                            {
                                from: 0.2,
                                to: 0.6,
                                color: "#cc6600"
                            }, // ORANGE
                            {
                                from: 0.6,
                                to: 1.0,
                                color: "#cc2222"
                            }, // RED
                        ];

                        ctx.lineWidth = arcThick;
                        ctx.lineCap = "butt";
                        // Draw each segment as a dim arc (the lit portion will be
                        // overlaid by the needle, which inherits the segment colour).
                        for (const seg of arcSegs) {
                            const aStart = corrToAngle(seg.to); // angles are reversed (higher corr = lower angle)
                            const aEnd = corrToAngle(seg.from);
                            ctx.beginPath();
                            ctx.arc(gCX, gCY, gR, aStart, aEnd);
                            ctx.strokeStyle = seg.color + "90"; // dim background segments
                            ctx.stroke();
                        }

                        // ── Filled arc from 0 to corr (lit portion) ──────────
                        const zeroAngle = corrToAngle(0);
                        const corrAngle = corrToAngle(corr);

                        // ── Needle ────────────────────────────────────────────
                        // An inertia-smoothed needle overlaid on the arc.
                        // smoothedCorr is a module-level variable that persists
                        // across frames and decays toward the current value.

                        // 1. Apply inertia smoothing (sensitivity = snappiness)
                        const targetCorr = corr;
                        // 0.1 = very smooth/slow, 0.3 = snappy, 0.25 = analog feel
                        const sensitivity = 0.25;
                        smoothedCorr += (targetCorr - smoothedCorr) * sensitivity;

                        // 2. Map smoothed value to canvas angle
                        const needleAngle = corrToAngle(smoothedCorr);
                        // Add π to rotate from the arc's reference frame to canvas angles
                        const finalAngle = Math.PI * 3 - needleAngle;
                        const needleOuter = gR + arcThick * 0.5; // tip extends just beyond arc

                        // 3. Clear any inherited shadow/cap state for a sharp needle
                        ctx.save();
                        ctx.shadowBlur = 0;
                        ctx.shadowColor = "transparent";
                        ctx.lineCap = "round";

                        // 4. Needle body — slightly dimmed grey for depth
                        ctx.beginPath();
                        ctx.strokeStyle = "#bbbbbb";
                        ctx.lineWidth = 2;
                        ctx.moveTo(gCX, gCY);
                        ctx.lineTo(
                            gCX + Math.cos(finalAngle) * needleOuter,
                            gCY + Math.sin(finalAngle) * needleOuter);
                        ctx.stroke();

                        // 5. Bright glowing tip — the last segment of the needle
                        //    draws brighter to simulate a physical meter pointer
                        ctx.beginPath();
                        ctx.strokeStyle = "#ffffff";
                        ctx.lineWidth = 2.5;
                        ctx.shadowColor = "#ffffff";
                        ctx.shadowBlur = 6;

                        const tipStart = gR - arcThick * 0.5;
                        ctx.moveTo(
                            gCX + Math.cos(finalAngle) * tipStart,
                            gCY + Math.sin(finalAngle) * tipStart);
                        ctx.lineTo(
                            gCX + Math.cos(finalAngle) * needleOuter,
                            gCY + Math.sin(finalAngle) * needleOuter);
                        ctx.stroke();

                        // 6. Pivot hub — small white circle at the needle's origin
                        ctx.beginPath();
                        ctx.arc(gCX, gCY, 3.5, 0, Math.PI * 2);
                        ctx.fillStyle = "#ffffff";
                        ctx.fill();

                        ctx.restore(); // needle state

                        // ── Arc tick labels ───────────────────────────────────
                        // Five reference marks: −1, −0.5, 0, +0.5, +1.
                        // Numeric labels sit inside the arc; degree equivalents
                        // sit outside. Both are drawn at the angle corresponding
                        // to each correlation value via corrToAngle().
                        const arcLabels = [{
                                v: -1,
                                txt: "+1",
                                deg: "0°"
                            }, {
                                v: -0.5,
                                txt: "+.5",
                                deg: "45°"
                            }, {
                                v: 0,
                                txt: "0",
                                deg: "90°"
                            }, {
                                v: 0.5,
                                txt: "-.5",
                                deg: "135°"
                            }, {
                                v: 1,
                                txt: "-1",
                                deg: "180°"
                            },
                        ];
                        const labelR = gR + arcThick * 0.9 + 9;
                        ctx.shadowBlur = 0;
                        ctx.shadowColor = "transparent";
                        ctx.font = "bold 7px sans-serif";
                        ctx.textBaseline = "middle";
                        ctx.shadowBlur = 0;

                        for (const lbl of arcLabels) {
                            const angle = corrToAngle(lbl.v);

                            ctx.textAlign = "center";
                            ctx.textBaseline = "middle";

                            // Inner numeric labels sit just inside the arc centre-line.
                            // Use arcThick * 0.5 to reach the inner edge, then add a
                            // small fixed gap (6 px) for breathing room.
                            const labelInnerR = gR - arcThick * 0.5 - 6;
                            const lx = gCX + Math.cos(angle) * labelInnerR;
                            const ly = gCY + Math.sin(angle) * labelInnerR;

                            ctx.font = "bold 8px sans-serif";
                            ctx.fillStyle = C.textDim;
                            ctx.fillText(lbl.txt, lx, ly);

                            // Outer degree labels sit just outside the arc edge.
                            // arcThick * 0.5 reaches the outer edge; +8 px for the
                            // text ascender so it doesn't overlap the stroke.
                            const labelOuterR = gR + arcThick * 0.5 + 8;
                            const dx = gCX + Math.cos(angle) * labelOuterR;
                            const dy = gCY + Math.sin(angle) * labelOuterR;

                            ctx.font = "7px sans-serif";
                            ctx.fillText(lbl.deg, dx, dy);
                        }

                        // ── Title and numeric readout ─────────────────────────
                        // "Correlation" label in the hollow of the arc, and a
                        // live numeric readout below the pivot. Red when negative
                        // (phase issues), pale green when positive.
                        ctx.fillStyle = "rgba(200,200,220,0.4)";
                        ctx.font = "bold 12px sans-serif";
                        ctx.textAlign = "center";
                        ctx.textBaseline = "middle";
                        ctx.fillText("Correlation", gCX, gCY - gR * 0.28);

                        ctx.fillStyle = corr < 0 ? "#ff5555" : "#aaddaa";
                        ctx.font = "bold 12px ui-monospace, monospace";
                        ctx.textBaseline = "top";
                        ctx.fillText(smoothedCorr.toFixed(2), gCX, gCY + 8);

                        ctx.restore(); // correlation gauge ctx.save()

                    }
                }
            } else if (viewMode === "spectrogram") {
                // ── SPECTROGRAM VIEW ──────────────────────────────────────────
                // Delegates entirely to drawSpectrogram(), which maintains its
                // own offscreen rolling-buffer canvas (_specCanvas). See that
                // function for full implementation details.
                drawSpectrogram(ctx, L);
            }

            // ── Playhead (waveform mode only) ────────────────────────────────
            // A vertical white line spanning the waveform area marks the current
            // playback position. Only shown in waveform mode (the other views are
            // real-time and don't have a spatial time axis to mark).
            // The glow colour shifts from purple (left half) to orange (right half)
            // to echo the played/unplayed colour split of the waveform bars.
            // Small filled circles at the top and bottom of the line ("anchor dots")
            // give it a polished physical marker appearance.
            if (viewMode === "waveform" && progress > 0) {
                const px = L.wfX + progress * L.totalW;
                ctx.save();

                // Glow colour matches the channel colour at that half of the file
                const color = progress < 0.5 ? C.barPlayedLeft : C.barPlayedRight;

                // 5 px inset from wfTop/wfBottom keeps the line clear of the
                // channel-label text and the border of the waveform region.
                const padding = 5;

                ctx.shadowBlur = 12;
                ctx.shadowColor = color;
                ctx.strokeStyle = "#ffffff";
                ctx.lineWidth = 1.5;
                ctx.globalAlpha = 1.0;

                ctx.beginPath();
                const topLimit = L.wfTop + padding;
                const bottomLimit = L.wfBottom - padding;
                ctx.moveTo(px, topLimit);
                ctx.lineTo(px, bottomLimit);
                ctx.stroke();

                // Anchor dots at top and bottom of the playhead line
                ctx.fillStyle = "#ffffff";
                ctx.shadowBlur = 5;
                ctx.beginPath();
                ctx.arc(px, topLimit, 2, 0, Math.PI * 2);
                ctx.arc(px, bottomLimit, 2, 0, Math.PI * 2);
                ctx.fill();

                ctx.restore();
            }

            // ── Clip LED ──────────────────────────────────────────────────────
            // A small red LED indicator that lights up whenever a sample in the
            // time-domain buffer hits the digital ceiling (byte value ≤ 1 or
            // ≥ 254 out of 0–255). It stays lit for 1 second after the last
            // detected clip so momentary peaks are visible even if the user
            // looks away. Drawn in the right margin, vertically centred between
            // the two channels (or at the single-channel midpoint for mono).
            if (this._showClip) {
                const ledSize = 8;
                const ledX = w - PAD_X - ledSize;
                const ledY = L.stereo
                     ? (L.ch0MidY + L.ch1MidY) / 2 - ledSize / 2
                     : L.midY - ledSize / 2;

                ctx.save();
                ctx.shadowColor = "#ff3b3b";
                ctx.shadowBlur = 8;
                ctx.fillStyle = "#ff3b3b";
                rr(ctx, ledX, ledY, ledSize, ledSize, 2);
                ctx.fill();
                // Specular highlight dot to simulate a physical LED lens
                ctx.shadowBlur = 0;
                ctx.fillStyle = "rgba(255,180,180,0.7)";
                ctx.beginPath();
                ctx.arc(ledX + ledSize * 0.35, ledY + ledSize * 0.35, ledSize * 0.18, 0, Math.PI * 2);
                ctx.fill();
                // "CLIP" micro-label directly beneath the LED
                ctx.shadowBlur = 0;
                ctx.fillStyle = "#ff3b3b";
                ctx.font = "bold 8px sans-serif";
                ctx.textAlign = "center";
                ctx.textBaseline = "top";
                ctx.fillText("CLIP", ledX + ledSize / 2, ledY + ledSize + 2);
                ctx.restore();
            }

            // ── Level meter ───────────────────────────────────────────────────
            // A pair of horizontal segmented bars (L above, R below) showing
            // real-time RMS level for each channel. Sits between the waveform
            // area and the time/scrub controls.
            //
            // Colour zones (same thresholds in all view modes):
            //   0–65%   green  — safe headroom
            //   65–85%  yellow — moderate level
            //   85–100% red    — near clipping
            //
            // Each segment is 3 px tall with a 1 px corner radius; the L and R
            // bars are stacked 4 px apart (3 px bar + 1 px gap).
            const meterY = L.wfBottom + 6;        // top of the L bar
            const segW = Math.floor((w - 16) / METER_BARS); // segment width including gap
            const segGap = 2;                      // transparent gap between segments

            let levelL = 0,
            levelR = 0;

            if (analyserL && analyserR) {

                const now = performance.now();

                if (!this._lastAnalyserUpdate) {
                    this._lastAnalyserUpdate = 0;
                }

                // ── Rate-limit analyser reads to 30 fps ───────────────────────
                // LiteGraph can call draw() at 60 fps or more. Reading and
                // processing the full FFT buffer every frame wastes CPU budget,
                // especially for large FFT sizes (fftSize = 4096 = 2048 bins).
                // We throttle to ~33 ms intervals and reuse the cached level
                // values for intermediate frames — the visual difference is
                // imperceptible at 30 fps.
                if (now - this._lastAnalyserUpdate > 1000 / 30) {
                    this._lastAnalyserUpdate = now;

                    // Allocate (or reuse) Uint8Array buffers sized to the analyser's
                    // fftSize. Reallocated only if the fftSize ever changes.
                    if (!_timeDomainL || _timeDomainL.length !== analyserL.fftSize) {
                        _timeDomainL = new Uint8Array(analyserL.fftSize);
                        _timeDomainR = new Uint8Array(analyserR.fftSize);
                    }

                    // Time-domain data is always needed for the level meter and clip
                    // detection. The goniometer also uses it in analyzer mode.
                    // Always fetch so all view modes show consistent meter readings.
                    analyserL.getByteTimeDomainData(_timeDomainL);
                    analyserR.getByteTimeDomainData(_timeDomainR);
                    const bufferL = _timeDomainL;
                    const bufferR = _timeDomainR;

                    // ── Clip detection ────────────────────────────────────────
                    // A sample is considered clipped if its unsigned byte value
                    // reaches the ceiling (254–255) or floor (0–1), which
                    // corresponds to ±1.0 in normalised float terms.
                    // The analyser taps the signal BEFORE the gainNode, so it
                    // always sees the raw unscaled audio regardless of volume.
                    // No compensation factor is needed or correct here — applying
                    // one would amplify samples at low volume and cause false clips.
                    let isClippingNow = false;
                    if (bufferL && bufferR) {
                        for (let i = 0; i < bufferL.length; i++) {
                            if (bufferL[i] <= 1 || bufferL[i] >= 254) {
                                isClippingNow = true;
                                break;
                            }
                        }
                        for (let i = 0; i < bufferR.length && !isClippingNow; i++) {
                            if (bufferR[i] <= 1 || bufferR[i] >= 254) {
                                isClippingNow = true;
                                break;
                            }
                        }
                    }

                    // Record the timestamp of the most recent clip event.
                    // _clipHold persists on `this` between frames; the clip LED
                    // section above reads it to decide whether to stay lit.
                    if (!this._clipHold)
                        this._clipHold = 0;
                    if (isClippingNow) {
                        this._clipHold = performance.now();
                    }
                    // LED stays lit for 1 s after the last clipping sample
                    this._showClip = (performance.now() - this._clipHold) < 1000;

                    // ── RMS helper ────────────────────────────────────────────
                    // Computes root-mean-square amplitude from a time-domain
                    // Uint8Array. Each byte is normalised from [0, 255] to [−1, +1]
                    // by the transform v = (byte / 128) − 1, then squared and averaged.
                    const getRMS = (buf) => {
                        if (!buf)
                            return 0;
                        let sum = 0;
                        for (let i = 0; i < buf.length; i++) {
                            const v = (buf[i] / 128) - 1; // centre on 0 and normalise
                            sum += v * v;
                        }
                        return Math.sqrt(sum / buf.length);
                    };

                    // ── Unused frequency-domain RMS (kept for reference) ──────
                    // Previously used as a fallback when time-domain buffers were
                    // not fetched in spectrum/spectrogram modes. Now that all modes
                    // always fetch time-domain data this function is never called,
                    // but is retained here to document the alternative approach.
                    // NOTE: getByteFrequencyData values are already in a perceptual
                    // dB-mapped scale, so feeding them into rmsToLevel() below
                    // produces incorrectly high readings — do not re-enable without
                    // recalibrating the mapping.
                    const getFreqRMS = (analyser) => {
                        const fd = new Uint8Array(analyser.frequencyBinCount);
                        analyser.getByteFrequencyData(fd);
                        let sum = 0;
                        for (let i = 0; i < fd.length; i++) {
                            const v = fd[i] / 255;
                            sum += v * v;
                        }
                        return Math.sqrt(sum / fd.length);
                    };

                    // ── RMS → normalised level (0–1) ──────────────────────────
                    // Converts a raw RMS amplitude into a 0–1 meter position using
                    // a −60 dB to 0 dB window. Signals below −60 dBFS map to 0
                    // (meter off); 0 dBFS maps to 1.0 (meter full scale).
                    // Formula: level = (dB + 60) / 60  where dB = 20·log10(rms)
                    const rmsToLevel = (rms) => {
                        if (rms < 0.0001)
                            return 0;
                        const db = 20 * Math.log10(rms);
                        return Math.max(0, Math.min(1, (db + 60) / 60));
                    };

                    levelL = rmsToLevel(getRMS(bufferL));
                    levelR = rmsToLevel(getRMS(bufferR));

                    // Cache levels so intermediate (throttled) frames can reuse them
                    this._cachedLevelL = levelL;
                    this._cachedLevelR = levelR;
                } else {
                    // Not time to update yet — reuse the last computed levels so
                    // the meter doesn't flicker to zero between analyser reads.
                    levelL = this._cachedLevelL || 0;
                    levelR = this._cachedLevelR || 0;
                }
            }

            // ── Peak hold with hold + decay ───────────────────────────────────
            // Tracks the highest level seen recently and holds it visible for
            // PEAK_HOLD_MS milliseconds before allowing it to decay.
            // This mirrors the behaviour of a hardware peak-hold meter: the
            // indicator briefly "sticks" at the highest reading so the user can
            // read the peak even after a transient has passed.
            //
            // Decay rate differs between playing (slow: ×0.99/frame) and paused
            // (fast: ×0.92/frame) so the indicator clears quickly after stopping.
            const now2 = performance.now();

            // inputLevel is the max of both channels — the peak hold tracks the
            // loudest signal regardless of which channel it came from.
            const inputLevel = Math.max(levelL || 0, levelR || 0);

            if (!this._lastPeakTime) {
                this._lastPeakTime = now2;
            }

            if (inputLevel > peakHold) {
                // New peak — update the hold value and reset the hold timer
                peakHold = inputLevel;
                peakHoldTime = now2;
            } else {
                const isInHoldPhase = (now2 - peakHoldTime) < PEAK_HOLD_MS;

                if (!isInHoldPhase) {
                    // Hold phase expired — apply per-frame multiplicative decay
                    const decay = playing ? 0.99 : 0.92;
                    peakHold *= decay;

                    // Snap to zero to prevent the indicator drifting forever
                    if (peakHold < 0.001)
                        peakHold = 0;
                }
            }

            // ── Draw meter segments ───────────────────────────────────────────
            // Each of the METER_BARS segments is drawn twice: once for L (top row)
            // and once for R (bottom row, offset 4 px). A segment is "lit" when
            // its start fraction falls below the current level for that channel.
            // colorFor() returns the lit or dim colour based on the segment's
            // position in the green / yellow / red zone.
            for (let i = 0; i < METER_BARS; i++) {
                const sx = 8 + i * segW;              // left edge of this segment
                const frac = (i + 1) / METER_BARS;    // right-edge fraction (for zone test)

                const barFrac = i / METER_BARS;        // left-edge fraction (for lit test)
                const litL = levelL > barFrac;
                const litR = levelR > barFrac;

                // Zone colours: lit = bright, unlit = very dark matching background
                const colorFor = (lit) =>
                frac < 0.65 ? (lit ? "#3ecf5c" : "#1a2e1e")   // green zone
                 : frac < 0.85 ? (lit ? "#d4c94a" : "#2a2a1a") // yellow zone
                 : (lit ? "#e05555" : "#2e1a1a");               // red zone

                // L channel (top bar)
                ctx.fillStyle = colorFor(litL);
                rr(ctx, sx, meterY, segW - segGap, 3, 1);
                ctx.fill();

                // R channel (bottom bar, 4 px below)
                ctx.fillStyle = colorFor(litR);
                rr(ctx, sx, meterY + 4, segW - segGap, 3, 1);
                ctx.fill();
            }

            // ── Peak hold indicator ───────────────────────────────────────────
            // A bright white tick drawn at the segment corresponding to peakHold.
            // Right-aligned within its segment block (6 px wide) to give it a
            // distinct visual from the filled bars — mimics a physical meter needle.
            // Drawn on both L and R rows since peakHold tracks combined max level.
            if (peakHold > 0) {
                const peakIndex = Math.ceil(peakHold * METER_BARS) - 1;
                const px = 8 + peakIndex * segW;

                ctx.save();
                ctx.shadowColor = "#ffffff";
                ctx.shadowBlur = 6;
                ctx.fillStyle = "#ffffff";

                const peakWidth = 6;                        // wider than a hairline for legibility
                const barWidth = segW - segGap;
                const rightAlignedX = px + barWidth - peakWidth; // flush to right edge of segment

                ctx.fillRect(rightAlignedX, meterY, peakWidth, 3);      // L row
                ctx.fillRect(rightAlignedX, meterY + 4, peakWidth, 3);  // R row

                ctx.restore();
            }

            // ── Time labels ───────────────────────────────────────────────────
            // Current position (left-aligned) and total duration (right-aligned)
            // sit between the meter and the scrub bar. While the scrub handle is
            // being dragged, fmtTime shows milliseconds (e.g. "1:23.4") for finer
            // seek resolution; otherwise it shows only seconds ("1:23").
            ctx.fillStyle = C.text;
            ctx.font = "11px monospace";
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText(fmtTime(currentTime, draggingScrub), 13, L.timeY);

            ctx.textAlign = "right";
            ctx.fillText(fmtTime(duration), w - 15, L.timeY);

            // ── Scrub bar ─────────────────────────────────────────────────────
            // A thin horizontal pill spanning the full widget width (inset by
            // PAD_X on each side). Three layers are drawn:
            //   1. Full-width dark background track (scrubBg)
            //   2. Filled portion from left edge to progress position (scrubFill)
            //   3. A circular handle at the current progress position
            // The handle is always drawn (even at progress = 0) so the user can
            // see and grab it from the very start of the file.
            ctx.fillStyle = C.scrubBg;
            rr(ctx, PAD_X, L.scrubTop, w - PAD_X * 2, L.scrubH, L.scrubH / 2);
            ctx.fill();

            if (progress > 0) {
                // Filled portion — same pill shape clipped naturally by the rr path
                ctx.fillStyle = C.scrubFill;
                rr(ctx, PAD_X, L.scrubTop, w - PAD_X * 2, L.scrubH, L.scrubH / 2);
                ctx.fill();
            }

            // Circular handle at current position (radius 5)
            ctx.fillStyle = C.scrubFill;
            ctx.beginPath();
            ctx.arc(PAD_X + (w - PAD_X * 2) * progress, L.scrubTop + L.scrubH / 2, 5, 0, Math.PI * 2);
            ctx.fill();

            // ── Volume control ────────────────────────────────────────────────
            // Composed of three elements placed in the bottom-left corner:
            //   1. Speaker icon (drawSpeaker) — shows mute state; click to toggle
            //   2. Dark background track pill (volTrack)
            //   3. Filled track up to the knob position (volFill, scaled by vol)
            //   4. Circular knob at vol position (volKnob)
            // `vol` is already 0 when muted, so the fill and knob snap to the
            // left edge, providing a clear visual mute indicator.
            drawSpeaker(ctx, L.spkX, L.spkY, 7, muted);

            // Background track
            ctx.fillStyle = C.volTrack;
            rr(ctx, L.volX, L.volY - L.volH / 2, L.volW, L.volH, L.volH / 2);
            ctx.fill();

            // Filled portion (proportional to current volume)
            ctx.fillStyle = C.volFill;
            rr(ctx, L.volX, L.volY - L.volH / 2, L.volW * vol, L.volH, L.volH / 2);
            ctx.fill();

            // Draggable knob
            ctx.fillStyle = C.volKnob;
            ctx.beginPath();
            ctx.arc(L.volX + L.volW * vol, L.volY, L.knobR, 0, Math.PI * 2);
            ctx.fill();

            // ── Play / Pause button ───────────────────────────────────────────
            // Centred circle (radius 16) filled with btnActive when playing or
            // btnBg when paused. The icon inside switches between:
            //   Playing — two white rectangles (pause symbol)
            //   Paused  — right-pointing triangle (play symbol)
            ctx.fillStyle = playing ? C.btnActive : C.btnBg;
            ctx.beginPath();
            ctx.arc(L.btnCX, L.btnCY, 16, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = "#fff";
            if (playing) {
                // Pause icon: two vertical bars, each 4 px wide × 14 px tall
                ctx.fillRect(L.btnCX - 6, L.btnCY - 7, 4, 14);
                ctx.fillRect(L.btnCX + 2, L.btnCY - 7, 4, 14);
            } else {
                // Play icon: triangle pointing right, offset slightly left so it
                // looks visually centred inside the circle
                ctx.beginPath();
                ctx.moveTo(L.btnCX - 5, L.btnCY - 8);
                ctx.lineTo(L.btnCX + 9, L.btnCY);
                ctx.lineTo(L.btnCX - 5, L.btnCY + 8);
                ctx.closePath();
                ctx.fill();
            }

            // ── Skip back button ──────────────────────────────────────────────
            // Circle button to the left of play. Icon is a vertical bar followed
            // by two left-facing triangles (|◀◀), indicating skip-to-start or
            // previous cue point. Both triangles share the same height (8 px) and
            // point left by reversing the tip vertex direction.
            ctx.fillStyle = C.btnBg;
            ctx.beginPath();
            ctx.arc(L.skipFCX, L.btnCY, L.skipR, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = "#fff";
            ctx.fillRect(L.skipFCX - 5, L.btnCY - 4, 2, 8); // vertical bar

            // First left-facing triangle
            ctx.beginPath();
            ctx.moveTo(L.skipFCX + 2, L.btnCY - 4);
            ctx.lineTo(L.skipFCX + 2, L.btnCY + 4);
            ctx.lineTo(L.skipFCX - 2, L.btnCY);
            ctx.closePath();
            ctx.fill();

            // Second left-facing triangle (shifted 4 px right of the first)
            ctx.beginPath();
            ctx.moveTo(L.skipFCX + 6, L.btnCY - 4);
            ctx.lineTo(L.skipFCX + 6, L.btnCY + 4);
            ctx.lineTo(L.skipFCX + 2, L.btnCY);
            ctx.closePath();
            ctx.fill();

            // ── Skip forward button ───────────────────────────────────────────
            // Mirror of skip back: two right-facing triangles (▶▶|) then a
            // vertical bar. Positioned to the right of play at L.skipBCX.
            ctx.fillStyle = C.btnBg;
            ctx.beginPath();
            ctx.arc(L.skipBCX, L.btnCY, L.skipR, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = "#fff";
            // First right-facing triangle
            ctx.beginPath();
            ctx.moveTo(L.skipBCX - 6, L.btnCY - 4);
            ctx.lineTo(L.skipBCX - 6, L.btnCY + 4);
            ctx.lineTo(L.skipBCX - 2, L.btnCY);
            ctx.closePath();
            ctx.fill();
            // Second right-facing triangle
            ctx.beginPath();
            ctx.moveTo(L.skipBCX - 2, L.btnCY - 4);
            ctx.lineTo(L.skipBCX - 2, L.btnCY + 4);
            ctx.lineTo(L.skipBCX + 2, L.btnCY);
            ctx.closePath();
            ctx.fill();
            ctx.fillRect(L.skipBCX + 3, L.btnCY - 4, 2, 8); // vertical bar

            // ── Loop button ───────────────────────────────────────────────────
            // Small circle button showing two circular arrows. Filled with
            // btnActive (purple) when looping is enabled, btnBg otherwise.
            // The icon is drawn in the local coordinate system by translating to
            // the button centre so all coordinates are relative offsets, keeping
            // the icon geometry readable regardless of layout position.
            ctx.fillStyle = looping ? C.btnActive : C.btnBg;
            ctx.beginPath();
            ctx.arc(L.loopCX, L.loopCY, L.skipR, 0, Math.PI * 2);
            ctx.fill();

            ctx.save();
            ctx.translate(L.loopCX, L.loopCY); // work in local coordinates
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = 1.5;
            ctx.fillStyle = "#fff";

            // Top arc: ~270° sweep from upper-right, clockwise
            ctx.beginPath();
            ctx.arc(0, 0, 5, -Math.PI * 0.2, Math.PI * 0.5);
            ctx.stroke();
            // Arrowhead at top of the arc, pointing upward-left
            ctx.beginPath();
            ctx.moveTo(0, -8);
            ctx.lineTo(3, -5);
            ctx.lineTo(0, -2);
            ctx.closePath();
            ctx.fill();

            // Bottom arc: ~270° sweep from lower-left, clockwise
            ctx.beginPath();
            ctx.arc(0, 0, 5, Math.PI * 0.8, Math.PI * 1.5);
            ctx.stroke();
            // Arrowhead at bottom of the arc, pointing downward-right
            ctx.beginPath();
            ctx.moveTo(0, 8);
            ctx.lineTo(-3, 5);
            ctx.lineTo(0, 2);
            ctx.closePath();
            ctx.fill();

            ctx.restore(); // pop local translate

            // ── Download button ───────────────────────────────────────────────
            // Small circle in the far right of the controls bar. Clicking it opens
            // the download format menu (WAV / MP3 / FLAC) via showDownloadMenu().
            // The icon is a Unicode downward-arrow character rendered at 12 px.
            ctx.fillStyle = C.btnBg;
            ctx.beginPath();
            ctx.arc(L.dlBtnCX, L.dlBtnCY, L.dlBtnR, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#ffffff";
            ctx.font = "12px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("⬇", L.dlBtnCX, L.dlBtnCY + 1); // +1 for optical vertical centering

            // ── Click ripple ──────────────────────────────────────────────────
            // An expanding, fading circle emitted from the last pointer-down
            // position. Provides tactile-style feedback for scrub seeks and
            // volume drags. The ripple object lives in the widget closure:
            //   { x, y, alpha, color }
            // alpha decays by 0.05 each frame (≈ 20 frames / ~333 ms to fade).
            // The circle radius grows from 20 px at full opacity to 60 px at
            // zero, making the expansion feel physically tied to the fade.
            if (ripple.alpha > 0) {
                ctx.save();
                ctx.beginPath();
                const size = 20 + (1 - ripple.alpha) * 40; // grows as it fades
                ctx.arc(ripple.x, ripple.y, size, 0, Math.PI * 2);
                ctx.strokeStyle = ripple.color;
                ctx.lineWidth = 2;
                ctx.globalAlpha = ripple.alpha;
                ctx.stroke();
                ctx.restore();

                ripple.alpha -= 0.05;
                if (ripple.alpha < 0)
                    ripple.alpha = 0;

                // Request another frame so the ripple continues fading even if
                // no other state change would trigger a redraw.
                node.setDirtyCanvas(true, false);
            }

            // ── View mode button ──────────────────────────────────────────────
            // A pill-shaped label button between the loop and download buttons.
            // Clicking it cycles viewMode through: waveform → eq → analyzer →
            // spectrogram → waveform. Each mode gets a distinct background colour
            // so the current mode is immediately recognisable at a glance:
            //   waveform    — burnt orange
            //   eq          — dark green
            //   analyzer    — teal/blue
            //   spectrogram — deep purple
            // The "SPECTROGRAM" label is longer than the others, so vBtnW is
            // widened to 90 px in that mode to avoid clipping the text.
            const viewLabel = viewMode === "waveform" ? "WAVEFORM"
                 : viewMode === "eq" ? "SPECTRUM"
                 : viewMode === "analyzer" ? "ANALYZER"
                 : "SPECTROGRAM";
            const vBtnW = viewMode === "spectrogram" ? 90 : 74,
            vBtnH = 16;

            // Mode-specific background colour
            switch (viewMode) {
            case "waveform":
                ctx.fillStyle = "#BE5504"; // burnt orange
                break;
            case "eq":
                ctx.fillStyle = "#3A5311"; // dark green
                break;
            case "spectrogram":
                ctx.fillStyle = "#4B0082"; // deep purple
                break;
            default: // analyzer
                ctx.fillStyle = "#017DA2"; // teal
                break;
            }

            // Draw pill background with white border, then white label text
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = 1;
            rr(ctx, L.eqBtnX - vBtnW / 2, L.btnCY - vBtnH / 2, vBtnW, vBtnH, 4);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = "#fff";
            ctx.font = "bold 8px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(`${viewLabel}`, L.eqBtnX, L.btnCY);

            // ── Hover glow pass ───────────────────────────────────────────────
            // Drawn last (on top of every control) so the neon ring always appears
            // above the button fill and icon. Only active when _hovered is non-null
            // — _hovered is updated by onHoverMove() which is called on every
            // pointer-move event from the node's onMouseMove override.
            //
            // The glow is rendered as a stroke-only ring (never a fill) so the
            // button icons beneath remain legible. shadowBlur on the context
            // creates the neon spread effect without needing extra canvas layers.
            //
            // glowCircle / glowRect are tiny inline helpers that set the shared
            // neon stroke style then draw the appropriate shape for each button.
            if (_hovered) {
                ctx.save();
                const NEON = "#a89fff"; // soft purple-white neon colour
                ctx.shadowColor = NEON;
                ctx.shadowBlur = 18;

                // Stroke-only ring — preserves button internals
                const glowCircle = (cx, cy, r) => {
                    ctx.beginPath();
                    ctx.arc(cx, cy, r, 0, Math.PI * 2);
                    ctx.strokeStyle = "rgba(168,159,255,0.55)";
                    ctx.lineWidth = 2.5;
                    ctx.stroke();
                };
                // Stroke-only rounded rect — used for the pill-shaped view button
                const glowRect = (x, y, w2, h2, r2) => {
                    rr(ctx, x, y, w2, h2, r2);
                    ctx.strokeStyle = "rgba(168,159,255,0.55)";
                    ctx.lineWidth = 2;
                    ctx.stroke();
                };

                switch (_hovered) {
                case "play":
                    glowCircle(L.btnCX, L.btnCY, 18);
                    break;
                case "skipF":
                    glowCircle(L.skipFCX, L.btnCY, L.skipR + 1);
                    break;
                case "skipB":
                    glowCircle(L.skipBCX, L.btnCY, L.skipR + 1);
                    break;
                case "loop":
                    glowCircle(L.loopCX, L.loopCY, L.skipR + 1);
                    break;
                case "dl":
                    glowCircle(L.dlBtnCX, L.dlBtnCY, L.dlBtnR + 1);
                    break;
                case "view": {
                        // vBtnWh must match the width used when drawing the button above
                        const vBtnWh = viewMode === "spectrogram" ? 90 : 74;
                        glowRect(L.eqBtnX - vBtnWh / 2, L.btnCY - vBtnH / 2, vBtnWh, vBtnH, 4);
                        break;
                    }
                case "vol":
                    // Two-part glow: a ring around the knob + a dimmer glow along
                    // the full track to hint at the draggable region.
                    ctx.beginPath();
                    ctx.arc(L.volX + L.volW * vol, L.volY, L.knobR + 3, 0, Math.PI * 2);
                    ctx.strokeStyle = "rgba(168,159,255,0.55)";
                    ctx.lineWidth = 2;
                    ctx.stroke();
                    ctx.shadowBlur = 10; // softer glow for the track
                    rr(ctx, L.volX, L.volY - L.volH / 2 - 1, L.volW, L.volH + 2, L.volH / 2 + 1);
                    ctx.strokeStyle = "rgba(168,159,255,0.28)";
                    ctx.lineWidth = 1.5;
                    ctx.stroke();
                    break;
                case "speaker":
                    // Soft ring around the speaker icon area
                    ctx.beginPath();
                    ctx.arc(L.spkX, L.spkY, 10, 0, Math.PI * 2);
                    ctx.strokeStyle = "rgba(168,159,255,0.4)";
                    ctx.lineWidth = 1.5;
                    ctx.stroke();
                    break;
                case "scrub": {
                        // Enlarged ring around the scrub handle knob
                        const scrubKnobX = PAD_X + (w - PAD_X * 2) * progress;
                        ctx.beginPath();
                        ctx.arc(scrubKnobX, L.scrubTop + L.scrubH / 2, 7, 0, Math.PI * 2);
                        ctx.strokeStyle = "rgba(168,159,255,0.55)";
                        ctx.lineWidth = 2;
                        ctx.stroke();
                        break;
                    }
                }
                ctx.restore(); // pop neon glow state
            }

            // Unwind all canvas state changes made during this draw() call.
            // This single restore matches the ctx.save() at the very top of draw().
            ctx.restore();
        },

        // ── Hover tracking — called by node.onPointerMove override below ──
        onHoverMove(mx, my) {
            const w = node.size[0];
            const L = getLayout(w, this.y, node.size[1]);
            const hit = _hitTest(mx, my, L, w);
            if (hit !== _hovered) {
                _hovered = hit;
                node.setDirtyCanvas(true, true);
                // Cursor style
                const canvas = document.querySelector("canvas.litegraph");
                if (canvas)
                    canvas.style.cursor = hit ? "pointer" : "";
            }
        },

        mouse(event, pos, _node) {
            if (event.type === "pointerup" || event.type === "pointercancel") {
                draggingVol = false;
                draggingScrub = false;
                dragSession = null;
                return false;
            }

            const [mx, my] = pos;
            const w = node.size[0];
            // Invalidate cache if node was resized
            if (_layoutCache && (_layoutCache._w !== w || _layoutCache._y !== this.y || _layoutCache._h !== node.size[1]))
                _layoutCache = null;
            const L = getLayout(w, this.y, node.size[1]);

            if (event.type === "pointermove") {
                if (draggingVol) {
                    ripple = {
                        x: L.volX + L.volW * volume,
                        y: L.volY,
                        alpha: 0.5,
                        color: C.volKnob
                    }

                    volume = Math.max(0, Math.min(1, (mx - L.volX) / L.volW));
                    audioEl.volume = 1; // keep HTML element at full — gain controlled by gainNode
                    if (gainNode)
                        gainNode.gain.value = muted ? 0 : volume;
                    // Persist on every drag move so the final resting value is
                    // always captured — even if pointerup fires off-widget.
                    widget.value = { viewMode, volume, muted };
                    if (!_dragRafPending) {
                        _dragRafPending = true;
                        requestAnimationFrame(() => {
                            _dragRafPending = false;
                            node.setDirtyCanvas(true, false);
                        });
                    }
                    return true;
                }
                if (draggingScrub && dragSession !== null) {
                    if (event.buttons === 0) {
                        draggingScrub = false;
                        dragSession = null;
                        return false;
                    }

                    const frac = Math.max(0, Math.min(1, (mx - PAD_X) / (w - PAD_X * 2)));
                    audioEl.currentTime = frac * duration;
                    currentTime = audioEl.currentTime;

                    // ── ADD THIS: Update ripple position as you drag ──
                    ripple = {
                        x: mx,
                        y: L.scrubTop + L.scrubH / 2,
                        alpha: 0.6, // Keep it slightly dimmer than a click
                        color: C.scrubFill
                    };

                    if (!_dragRafPending) {
                        _dragRafPending = true;
                        requestAnimationFrame(() => {
                            _dragRafPending = false;
                            node.setDirtyCanvas(true, false);
                        });
                    }
                    return true;
                }
                return false;
            }

            if (event.type !== "pointerdown")
                return false;

            console.log("[AudioPlayer] pointerdown mx=", mx, "my=", my,
                "btnCX=", L.btnCX, "btnCY=", L.btnCY,
                "dist=", Math.hypot(mx - L.btnCX, my - L.btnCY),
                "wfTop=", L.wfTop, "wfBottom=", L.wfBottom,
                "scrubTop=", L.scrubTop, "nodeH=", node.size[1], "y=", this.y);

            // View mode cycle button
            // if (Math.hypot(mx - L.eqBtnX, my - L.btnCY) < 40) {
            if (mx >= L.eqBtnX - 40 && mx <= L.eqBtnX + 40 && my >= L.btnCY - 10 && my <= L.btnCY + 10) {

                const idx = VIEW_MODES.indexOf(viewMode);
                viewMode = VIEW_MODES[(idx + 1) % VIEW_MODES.length];
                // Persist full state — keep current volume/muted alongside new viewMode
                widget.value = { viewMode, volume, muted };

                if (viewMode === "eq" || viewMode === "analyzer") {
                    ensureAnalyser();
                    connectAnalyser();
                } else {
                    disconnectAnalyser();
                }

                // Ripple effect for feedback
                ripple.x = L.eqBtnX;
                ripple.y = L.btnCY;
                ripple.alpha = 1.0;

                startRAF();
                node.setDirtyCanvas(true, false);
                return true;
            }

            // Speaker mute
            if (Math.hypot(mx - L.spkX, my - L.spkY) < 12) {
                muted = !muted;
                audioEl.muted = false; // use gainNode for mute, not HTML element
                if (gainNode)
                    gainNode.gain.value = muted ? 0 : volume;
                // Persist so state survives a node rerun
                widget.value = { viewMode, volume, muted };
                node.setDirtyCanvas(true, false);
                return true;
            }
            // Volume drag
            if (my >= L.volY - 10 && my <= L.volY + 10 && mx >= L.volX - L.knobR && mx <= L.volX + L.volW + L.knobR) {
                draggingVol = true;
                ripple.x = mx;
                ripple.y = my;
                ripple.alpha = 1.0;
                volume = Math.max(0, Math.min(1, (mx - L.volX) / L.volW));
                audioEl.volume = 1;
                if (gainNode)
                    gainNode.gain.value = muted ? 0 : volume;
                // Persist immediately so a rerun mid-drag doesn't lose the new value
                widget.value = { viewMode, volume, muted };
                node.setDirtyCanvas(true, false);
                return true;
            }
            // ── Buttons first — before any zone checks ──
            // Skip back
            if (Math.hypot(mx - L.skipFCX, my - L.btnCY) < L.skipR + 4) {
                audioEl.currentTime = Math.max(0, audioEl.currentTime - 10);
                currentTime = audioEl.currentTime;
                node.setDirtyCanvas(true, false);
                return true;
            }
            // Skip forward
            if (Math.hypot(mx - L.skipBCX, my - L.btnCY) < L.skipR + 4) {
                audioEl.currentTime = Math.min(duration, audioEl.currentTime + 10);
                currentTime = audioEl.currentTime;
                node.setDirtyCanvas(true, false);
                return true;
            }
            // Play/Pause
            if (Math.hypot(mx - L.btnCX, my - L.btnCY) < 20) {
                if (audioEl.paused) {
                    audioEl.play().catch(e => console.error("[AudioPlayer] play() failed:", e));
                } else {
                    audioEl.pause();
                }
                return true;
            }
            // Loop toggle
            if (Math.hypot(mx - L.loopCX, my - L.loopCY) < L.skipR + 4) {
                looping = !looping;
                audioEl.loop = looping;
                node.setDirtyCanvas(true, false);
                return true;
            }
            // Download
            if (Math.hypot(mx - L.dlBtnCX, my - L.dlBtnCY) < L.dlBtnR + 4) {
                if (document.getElementById("ap-dl-menu")) {
                    document.getElementById("ap-dl-menu").remove();
                    return true;
                }
                //showDownloadMenu(data.filename, data.stereo, event.clientX, event.clientY);
                const cx = event.clientX ?? mx;
                const cy = event.clientY ?? my;

                showDownloadMenu(data.filename, data.stereo, cx, cy);

                return true;
            }

            // ── Scrubber ──
            if (
                my >= L.scrubTop - 8 &&
                my <= L.scrubTop + L.scrubH + 8 &&
                mx >= PAD_X &&
                mx <= w - PAD_X) {
                draggingScrub = true;
                dragSession = Date.now();

                const frac = Math.max(0, Math.min(1, (mx - PAD_X) / (w - PAD_X * 2)));
                audioEl.currentTime = frac * duration;
                currentTime = audioEl.currentTime;
                ripple = {
                    x: mx,
                    y: L.scrubTop + L.scrubH / 2,
                    alpha: 1.0,
                    color: C.scrubFill
                };
                startRAF();
                node.setDirtyCanvas(true, false);
                return true;
            }

            // ── Waveform seek (last — largest zone) ──
            if (my >= L.wfTop && my <= L.wfBottom && mx >= L.wfX && mx <= L.wfX + L.totalW) {
                const frac = (mx - L.wfX) / L.totalW;
                audioEl.currentTime = frac * duration;
                currentTime = audioEl.currentTime;
                ripple = {
                    x: mx,
                    y: my,
                    alpha: 1.0,
                    color: frac < 0.5 ? C.barPlayedLeft : C.barPlayedRight
                };
                startRAF();
                node.setDirtyCanvas(true, false);
                return true;
            }
            return false;
        },

        computeSize() {
            // ── Minimum node dimensions ───────────────────────────────────────
            // These values prevent the transport controls and level meter from
            // overlapping when the user drags the node smaller than its content.
            //
            // HEIGHT breakdown (pixels, measured from widget top):
            //   28  px  — info badge row (sample rate / channel / LUFS text)
            //   80  px  — minimum waveform / visualisation area
            //            (stereo needs ~86 px for two 40 px channels + 6 px gap,
            //             but 80 still renders usably for mono)
            //   95  px  — fixed controls area (meter 39 + scrub 30 + buttons 26)
            //   ───────
            //   203 px  — minimum widget height
            // The LiteGraph title bar adds ~30 px on top of the widget, so the
            // full node minimum height is approximately 233 px.
            // Change MIN_WIDGET_H to adjust the minimum resizable height.
            const MIN_WIDGET_H = 203;

            // WIDTH breakdown:
            //   The transport row must fit (left-to-right):
            //     speaker+vol  ~100 px
            //     skip-back     ~34 px
            //     play          ~32 px (r=16, gaps)
            //     skip-fwd      ~34 px
            //     loop          ~34 px
            //     view button   ~90 px (widest label = "SPECTROGRAM")
            //     download      ~34 px
            //     total        ~358 px with gaps — round up to 380 for comfort
            // Change MIN_NODE_W to adjust the minimum resizable width.
            const MIN_NODE_W = 460;

            const stereo = !!peaks.ch1;
            const minChH = stereo ? 40 : 40;
            const wfH    = stereo ? minChH * 2 + 6 : minChH;
            const naturalH = wfH + 90 + 20;

            return [
                Math.max(node.size[0], MIN_NODE_W),
                Math.max(naturalH, MIN_WIDGET_H),
            ];
        },

        onRemoved() {
            audioEl.pause();
            audioEl.src = ""; // release the audio element
            document.getElementById("ap-dl-menu")?.remove();
            // Free offscreen canvas memory
            _waveformCache = null;
            _specCanvas = null;
            _specCtx = null;
            _specFreqBuf = null;
            _specImgBuf = null;
            if (rafId) {
                cancelAnimationFrame(rafId);
                rafId = null;
            }
            // Disconnect our nodes but do NOT close the shared AudioContext
            try {
                if (meterSource)
                    meterSource.disconnect();
            } catch (e) {}
            try {
                if (analyserL)
                    analyserL.disconnect();
            } catch (e) {}
            try {
                if (analyserR)
                    analyserR.disconnect();
            } catch (e) {}
            try {
                if (analyserSplitter)
                    analyserSplitter.disconnect();
            } catch (e) {}
            try {
                if (analyserMerger)
                    analyserMerger.disconnect();
            } catch (e) {}
            meterSource = null;
            gainNode = null;
            analyserL = analyserR = analyserNode = null;
            analyserSplitter = analyserMerger = null;
            analyserConnected = false;
            // Close this widget's own AudioContext
            if (audioCtx) {
                try {
                    audioCtx.close();
                } catch (e) {}
                audioCtx = null;
            }
        },
    };

    // Initial paint
    node.setDirtyCanvas(true, false);

    return widget;
}

app.registerExtension({
    name: "Comfy.AudioPlayerNode",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_TYPE)
            return;

        // Override mouse events on the node directly — most reliable approach
        const _onMouseDown = nodeType.prototype.onMouseDown;
        nodeType.prototype.onMouseDown = function (e, pos, canvas) {
            const widget = this.widgets?.find(w => w.name === WIDGET_NAME);
            if (widget?.mouse) {
                const result = widget.mouse(e, pos, this);
                if (result)
                    return result;
            }
            return _onMouseDown?.call(this, e, pos, canvas);
        };

        const _onMouseMove = nodeType.prototype.onMouseMove;
        nodeType.prototype.onMouseMove = function (e, pos, canvas) {
            const widget = this.widgets?.find(w => w.name === WIDGET_NAME);
            // Always update hover state for instant glow response
            if (widget?.onHoverMove) {
                widget.onHoverMove(pos[0], pos[1]);
            }
            if (widget?.mouse) {
                const result = widget.mouse(e, pos, this);
                if (result)
                    return result;
            }
            return _onMouseMove?.call(this, e, pos, canvas);
        };

        // Clear hover state and cursor when the pointer leaves the node
        const _onMouseLeave = nodeType.prototype.onMouseLeave;
        nodeType.prototype.onMouseLeave = function (e, pos, canvas) {
            const widget = this.widgets?.find(w => w.name === WIDGET_NAME);
            if (widget) {
                // Reset internal hover state via a sentinel position off-canvas
                if (widget.onHoverMove)
                    widget.onHoverMove(-9999, -9999);
                const cvs = document.querySelector("canvas.litegraph");
                if (cvs)
                    cvs.style.cursor = "";
            }
            return _onMouseLeave?.call(this, e, pos, canvas);
        };

        const _onMouseUp = nodeType.prototype.onMouseUp;
        nodeType.prototype.onMouseUp = function (e, pos, canvas) {
            const widget = this.widgets?.find(w => w.name === WIDGET_NAME);
            if (widget?.mouse) {
                widget.mouse(e, pos, this);
            }
            return _onMouseUp?.call(this, e, pos, canvas);
        };

        // ── Enforce minimum node size on resize ──────────────────────────────
        // LiteGraph calls onResize whenever the user drags a node edge. We clamp
        // the incoming size to the same minimums declared in computeSize() above
        // so the transport controls and level meter can never overlap.
        //
        // MIN_NODE_W  — minimum width  (default 380 px — fits all transport controls)
        // MIN_NODE_H  — minimum height (default 263 px — widget 203 + title bar ~60)
        //
        // To change the minimums, update both this block AND the matching constants
        // in the computeSize() method above so they stay in sync.
        const MIN_NODE_W = 460;
        const MIN_NODE_H = 280; // widget MIN_WIDGET_H (203) + LiteGraph title bar (~60)

        const _onResize = nodeType.prototype.onResize;
        nodeType.prototype.onResize = function (size) {
            if (!this.properties)
                this.properties = {};

            // Clamp to minimums before anything else so the layout never breaks
            size[0] = Math.max(size[0], MIN_NODE_W);
            size[1] = Math.max(size[1], MIN_NODE_H);

            this.properties.audioPlayerSize = [...size];
            return _onResize?.apply(this, arguments);
        };

        const _onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            _onExecuted?.apply(this, arguments);

            const payloads = message?.audio_player;
            if (!payloads?.length)
                return;

            const data = payloads[0];
            const self = this;

            fetch(`/audio_player/peaks/${data.filename}`)
            .then(r => r.json())
            .then(peaks => {
                data.peaks = peaks;

                if (!self.widgets)
                    self.widgets = [];

                const idx = self.widgets.findIndex(w => w.name === WIDGET_NAME);

                // Preserve widget state (EQ toggle etc.)
                const prevValue = idx >= 0 ? self.widgets[idx].value : null;

                if (idx >= 0) {
                    self.widgets[idx].onRemoved?.();
                    self.widgets.splice(idx, 1);
                }

                const newWidget = makeAudioPlayerWidget(self, data);

                // Restore saved widget state from the previous instance.
                // prevValue may be:
                //   - null          : first ever run — leave defaults
                //   - a string      : legacy save with only viewMode
                //   - an object     : current format { viewMode, volume, muted }
                // Assigning to newWidget.value is enough: draw() reads it on
                // the very first frame and syncs all three closure variables
                // (viewMode, volume, muted) plus the gainNode gain.
                if (prevValue)
                    newWidget.value = prevValue;

                self.widgets.push(newWidget);

                // ── Size persistence ─────────────────────────────
                if (!self.properties)
                    self.properties = {};

                const DEFAULT_H = 100;

                if (self.properties.audioPlayerSize) {
                    // Restore saved size (rerun / reload)
                    self.setSize(self.properties.audioPlayerSize);

                } else if (self.size[1] <= DEFAULT_H) {
                    // First-time default sizing only
                    self.setSize([
                            Math.max(self.size[0], 300),
                            Math.max(self.size[1], WIDGET_H + 80)
                        ]);

                    // Save initial size
                    self.properties.audioPlayerSize = [...self.size];
                }

                self.setDirtyCanvas(true, true);
            })
            .catch(e => console.error("[AudioPlayer] failed to fetch peaks:", e));
        };

    },
});