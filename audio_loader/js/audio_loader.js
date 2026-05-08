/**
 * AudioLoader Widget for ComfyUI  v2.6
 *
 * trim_json is declared as a hidden input in Python's INPUT_TYPES.
 * ComfyUI passes hidden inputs automatically in the prompt — but only if
 * they appear in node.properties or are injected into the graph prompt.
 *
 * We use the cleanest available hook: override the node's getExtraInfo()
 * which ComfyUI calls when building the prompt, injecting trim_json there.
 * Fallback: also set it via a beforeQueued hook on the audio combo widget.
 */

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const WAVE_H   = 150;
const INFO_H   = 32;
const BTN_H    = 36;
const LABEL_H  = 18;
const NODE_W   = 360;
const WIDGET_H = WAVE_H + INFO_H + BTN_H + LABEL_H + 12;

const C = {
  bg:          "#0f172a",
  barPlayed:   "#4ade80",
  barUnplayed: "#1e3a2f",
  barTrimmed:  "#0f1f17",
  playhead:    "#f8fafc",
  accent:      "#22d3ee",
  trimHandle:  "#f59e0b",
  trimFill:    "rgba(245,158,11,0.08)",
  text:        "#94a3b8",
  textBright:  "#e2e8f0",
  border:      "#1e293b",
  btnBg:       "#1e293b",
};

const AUDIO_EXTS = new Set(["mp3","wav","wave","flac","ogg","aac","m4a","opus","weba"]);
const HANDLE_HIT = 10;

function isAudioFile(f) {
  if (!f) return false;
  if (f.type?.startsWith("audio/")) return true;
  return AUDIO_EXTS.has(f.name?.split(".").pop()?.toLowerCase());
}

function fmt(s) {
  if (!isFinite(s)||s<0) s=0;
  const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sc=Math.floor(s%60),ms=Math.floor((s%1)*1000);
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(sc).padStart(2,"0")}.${String(ms).padStart(3,"0")}`;
}
function fmtShort(s) {
  if (!isFinite(s)||s<0) s=0;
  return `${Math.floor(s/60)}:${(s%60).toFixed(1).padStart(4,"0")}`;
}
function parseTime(str) {
  if (!str) return null;
  const p=str.trim().split(":");
  let sec=0;
  if (p.length===3)      sec=+p[0]*3600 + +p[1]*60 + +p[2];
  else if (p.length===2) sec=+p[0]*60   + +p[1];
  else                   sec=+p[0];
  return isFinite(sec)?sec:null;
}
function safeStr(v) {
  if (!v) return "";
  if (typeof v==="string") return v;
  if (Array.isArray(v)) return String(v[0]||"");
  return String(v);
}

async function decodeWaveformPeaks(buf, numBars=220) {
  const ctx=new (window.AudioContext||window.webkitAudioContext)();
  try {
    const dec=await ctx.decodeAudioData(buf);
    const ch=dec.getChannelData(0), block=Math.floor(ch.length/numBars);
    const peaks=[];
    for (let i=0;i<numBars;i++) {
      let max=0,base=i*block;
      for (let j=0;j<block;j++){const v=Math.abs(ch[base+j]);if(v>max)max=v;}
      peaks.push(max);
    }
    const gm=Math.max(...peaks,0.001);
    return {peaks:peaks.map(p=>p/gm), duration:dec.duration};
  } finally { ctx.close(); }
}

// ─── Widget Factory ───────────────────────────────────────────────────────────
function createAudioWidget(node, nativeComboWidget) {
  let peaks=[], duration=0, audioEl=null;
  let playState="stopped", playheadFrac=0, animFrame=null;
  let isDragOver=false, trimStart=0, trimEnd=0;
  let dragTarget=null, hoveredZone=null;

  // Hide the native combo widget — keep it for filename serialisation
  const ZERO=()=>[0,0];
  nativeComboWidget.computeSize=ZERO;
  nativeComboWidget.draw=()=>{};
  nativeComboWidget.mouse=()=>false;

  function trimJson() {
    const trimmed = duration>0 && (trimStart>0 || trimEnd<duration);
    return trimmed ? JSON.stringify({s:trimStart,e:trimEnd}) : '{"s":0,"e":0}';
  }

  function isTrimmed() { return duration>0 && (trimStart>0||trimEnd<duration); }

  // ── Audio ─────────────────────────────────────────────────────────────────
  function setupAudio(url) {
    if (audioEl){audioEl.pause();audioEl.src="";}
    audioEl=new Audio(url);
    audioEl.addEventListener("ended",()=>{
      playState="stopped"; playheadFrac=duration>0?trimStart/duration:0;
      cancelAnimationFrame(animFrame); node.setDirtyCanvas(true,false);
    });
    audioEl.addEventListener("timeupdate",()=>{
      if (duration>0&&trimEnd>0&&audioEl.currentTime>=trimEnd){
        audioEl.pause(); audioEl.currentTime=trimStart;
        playState="stopped"; playheadFrac=trimStart/duration;
        cancelAnimationFrame(animFrame); node.setDirtyCanvas(true,false);
      }
    });
  }

  function clampPlayhead() {
    if (!duration) return;
    const lo=trimStart/duration, hi=trimEnd/duration;
    if (playheadFrac<lo) playheadFrac=lo;
    if (playheadFrac>hi) playheadFrac=hi;
    if (audioEl) audioEl.currentTime=playheadFrac*duration;
  }

  function tick() {
    if (audioEl?.duration) playheadFrac=audioEl.currentTime/audioEl.duration;
    node.setDirtyCanvas(true,false);
    if (playState==="playing") animFrame=requestAnimationFrame(tick);
  }

  async function loadAudioFile(fname, restoredStart, restoredEnd) {
    if (!fname?.trim()) return;
    nativeComboWidget.value=fname;
    const url=api.apiURL(`/view?filename=${encodeURIComponent(fname)}&type=input`);
    try {
      const res=await fetch(url), buf=await res.arrayBuffer();
      const result=await decodeWaveformPeaks(buf.slice(0));
      peaks=result.peaks; duration=result.duration;
    } catch(e) { console.error("[AudioLoader] decode error",e); peaks=[];duration=0; }

    if (restoredStart!==undefined && (restoredStart>0||(restoredEnd>0&&restoredEnd<duration))) {
      trimStart=restoredStart; trimEnd=restoredEnd>0?restoredEnd:duration;
    } else { trimStart=0; trimEnd=duration; }

    // Update node's hidden trim_json property so it gets included in the prompt
    node._alTrimJson = trimJson();

    setupAudio(url);
    playState="stopped"; playheadFrac=duration>0?trimStart/duration:0;
    node.setDirtyCanvas(true,false);
  }

  async function uploadFile(file) {
    const fd=new FormData(); fd.append("image",file,file.name);
    try {
      const res=await api.fetchApi("/upload/audio",{method:"POST",body:fd});
      if (!res.ok) throw new Error(await res.text());
      const data=await res.json();
      await loadAudioFile(data.name);
    } catch(e) { console.error("[AudioLoader] upload error",e); alert("Upload failed: "+e.message); }
  }

  function promptTrim(which) {
    const cur=which==="start"?fmt(trimStart):fmt(trimEnd);
    const label=which==="start"?"Trim Start (HH:MM:SS.mmm)":"Trim End (HH:MM:SS.mmm)";
    const result=window.prompt(label,cur);
    if (result===null) return;
    const t=parseTime(result.trim());
    if (t===null) return;
    if (which==="start") trimStart=Math.max(0,Math.min(t,trimEnd-0.001));
    else                 trimEnd=Math.min(duration,Math.max(t,trimStart+0.001));
    clampPlayhead();
    node._alTrimJson=trimJson();
    node.setDirtyCanvas(true,false);
  }

  // ── Master draw ───────────────────────────────────────────────────────────
  const master=node.addWidget("AL_MASTER","_al_master",null,()=>{},{serialize:false});
  master.computeSize=()=>[NODE_W,WIDGET_H+20];

  master.draw=function(ctx,node,width,y) {
    const px=10,pw=width-20,waveX=px+10,waveW=pw-20;
    const fname=nativeComboWidget.value||"";
    const tsF=duration>0?trimStart/duration:0, teF=duration>0?trimEnd/duration:1;
    const tsX=waveX+tsF*waveW, teX=waveX+teF*waveW;

    ctx.fillStyle=C.bg; ctx.strokeStyle=isDragOver?C.accent:C.border; ctx.lineWidth=isDragOver?2:1;
    ctx.beginPath(); ctx.roundRect(px,y,pw,WAVE_H,8); ctx.fill();
    ctx.beginPath(); ctx.roundRect(px,y,pw,WAVE_H,8); ctx.stroke();

    if (peaks.length>0) {
      ctx.fillStyle=C.trimFill; ctx.fillRect(tsX,y+4,teX-tsX,WAVE_H-8);
      const barW=waveW/peaks.length,cy=y+WAVE_H/2,maxH=WAVE_H/2-14;
      for (let i=0;i<peaks.length;i++) {
        const frac=i/peaks.length, inTrim=frac>=tsF&&frac<teF, played=frac<=playheadFrac&&inTrim;
        const bx=waveX+i*barW, bh=Math.max(2,peaks[i]*maxH);
        ctx.fillStyle=inTrim?(played?C.barPlayed:C.barUnplayed):C.barTrimmed;
        ctx.beginPath(); ctx.roundRect(bx,cy-bh,Math.max(1,barW-1),bh*2,1); ctx.fill();
      }
      const dh=(hx,side)=>{
        const hov=hoveredZone===(side==="left"?"trimL":"trimR");
        ctx.strokeStyle=hov?"#fbbf24":C.trimHandle; ctx.lineWidth=hov?3:2;
        ctx.beginPath(); ctx.moveTo(hx,y+4); ctx.lineTo(hx,y+WAVE_H-4); ctx.stroke();
        const tw=12,th=16,tx=side==="left"?hx:hx-tw;
        ctx.fillStyle=hov?"#fbbf24":C.trimHandle;
        ctx.beginPath(); ctx.roundRect(tx,y+4,tw,th,3); ctx.fill();
        ctx.fillStyle="#0f172a"; ctx.font="bold 9px monospace"; ctx.textAlign="center";
        ctx.fillText(side==="left"?"◀":"▶",hx+(side==="left"?tw/2:-tw/2),y+15); ctx.textAlign="left";
      };
      dh(tsX,"left"); dh(teX,"right");
      const phX=waveX+playheadFrac*waveW;
      ctx.strokeStyle=C.playhead; ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(phX,y+6); ctx.lineTo(phX,y+WAVE_H-6); ctx.stroke();
      ctx.fillStyle=C.playhead;
      ctx.beginPath(); ctx.moveTo(phX-5,y+6); ctx.lineTo(phX+5,y+6); ctx.lineTo(phX,y+15); ctx.closePath(); ctx.fill();
    } else {
      ctx.fillStyle=isDragOver?C.accent:"#334155"; ctx.font="bold 13px monospace"; ctx.textAlign="center";
      ctx.fillText(isDragOver?"Drop audio file here":"🎵  Drag & drop audio  /  select below",px+pw/2,y+WAVE_H/2-8);
      ctx.font="11px monospace"; ctx.fillStyle="#64748b";
      ctx.fillText("MP3 · WAV · FLAC · OGG · AAC · M4A",px+pw/2,y+WAVE_H/2+12); ctx.textAlign="left";
    }

    const infoY=y+WAVE_H+4;
    if (duration>0) {
      ctx.fillStyle=C.text; ctx.font="10px monospace"; ctx.textAlign="left";
      ctx.fillText(`total: ${fmtShort(duration)}`,px+2,infoY+12);
      if (isTrimmed()) {
        ctx.fillStyle=C.trimHandle; ctx.font="bold 10px monospace"; ctx.textAlign="center";
        ctx.fillText(`▶ ${fmtShort(trimEnd-trimStart)}`,px+pw/2,infoY+12);
      }
    }
    const tsHov=hoveredZone==="trimLLabel",teHov=hoveredZone==="trimRLabel";
    ctx.font=(tsHov?"bold ":"")+"10px monospace"; ctx.fillStyle=tsHov?C.accent:C.trimHandle;
    ctx.textAlign="left"; ctx.fillText(`✎ ${fmtShort(trimStart)}`,px+2,infoY+26);
    ctx.font=(teHov?"bold ":"")+"10px monospace"; ctx.fillStyle=teHov?C.accent:C.trimHandle;
    ctx.textAlign="right"; ctx.fillText(`${fmtShort(trimEnd)} ✎`,px+pw-2,infoY+26); ctx.textAlign="left";

    const labelY=infoY+INFO_H+2;
    if (fname) {
      ctx.fillStyle="#64748b"; ctx.font="10px monospace"; ctx.textAlign="center";
      ctx.fillText(fname.length>44?fname.slice(0,42)+"…":fname,px+pw/2,labelY+12); ctx.textAlign="left";
    }

    const btnY=labelY+LABEL_H+2,btnSz=28,btnGap=8;
    const playBx=px+pw/2-btnSz-btnGap/2, stopBx=px+pw/2+btnGap/2;
    const db=(bx,label,active,hov)=>{
      ctx.fillStyle=active?C.accent:(hov?"#253550":C.btnBg);
      ctx.strokeStyle=active?C.accent:(hov?C.accent:"#334155"); ctx.lineWidth=1;
      ctx.beginPath(); ctx.roundRect(bx,btnY,btnSz,btnSz,6); ctx.fill(); ctx.stroke();
      ctx.fillStyle=active?"#0f172a":C.textBright; ctx.font="14px sans-serif"; ctx.textAlign="center";
      ctx.fillText(label,bx+btnSz/2,btnY+btnSz/2+5); ctx.textAlign="left";
    };
    db(playBx,playState==="playing"?"⏸":"▶",playState==="playing",hoveredZone==="play");
    db(stopBx,"⏹",false,hoveredZone==="stop");

    master._z={waveX,waveW,waveY:y,waveBot:y+WAVE_H,infoY,infoBot:infoY+INFO_H,tsX,teX,playBx,stopBx,btnY,btnSz,px,pw};
  };

  master.mouse=function(event,pos,node) {
    if (!master._z) return false;
    const [mx,my]=pos, z=master._z;
    const inWave=my>=z.waveY&&my<=z.waveBot, inInfo=my>=z.infoY&&my<=z.infoBot;
    const inBtn=bx=>mx>=bx&&mx<=bx+z.btnSz&&my>=z.btnY&&my<=z.btnY+z.btnSz;

    if (event.type==="pointermove") {
      let h=null;
      if (inWave&&peaks.length>0) {
        if (Math.abs(mx-z.tsX)<=HANDLE_HIT) h="trimL";
        else if (Math.abs(mx-z.teX)<=HANDLE_HIT) h="trimR";
      }
      if (inInfo&&my>z.infoY+14) h=mx<z.px+z.pw/2?"trimLLabel":"trimRLabel";
      if (inBtn(z.playBx)) h="play";
      if (inBtn(z.stopBx)) h="stop";
      if (h!==hoveredZone){hoveredZone=h;node.setDirtyCanvas(true,false);}
    }

    if (dragTarget) {
      if (event.type==="pointermove") {
        const frac=Math.max(0,Math.min(1,(mx-z.waveX)/z.waveW)),t=frac*duration;
        if (dragTarget==="trimL")      trimStart=Math.max(0,Math.min(t,trimEnd-0.001));
        else if (dragTarget==="trimR") trimEnd=Math.min(duration,Math.max(t,trimStart+0.001));
        else { playheadFrac=Math.max(trimStart/duration,Math.min(trimEnd/duration,frac)); if(audioEl)audioEl.currentTime=playheadFrac*duration; }
        clampPlayhead(); node._alTrimJson=trimJson(); node.setDirtyCanvas(true,false); return true;
      }
      if (event.type==="pointerup"){dragTarget=null;return true;}
      return true;
    }

    if (event.type==="pointerdown") {
      if (inWave&&peaks.length>0) {
        if (Math.abs(mx-z.tsX)<=HANDLE_HIT){dragTarget="trimL";return true;}
        if (Math.abs(mx-z.teX)<=HANDLE_HIT){dragTarget="trimR";return true;}
        dragTarget="playhead"; return true;
      }
      if (inInfo&&my>z.infoY+14){mx<z.px+z.pw/2?promptTrim("start"):promptTrim("end");return true;}
      if (inBtn(z.playBx)){handlePlayPause();return true;}
      if (inBtn(z.stopBx)){handleStop();return true;}
    }
    return false;
  };

  function handlePlayPause() {
    if (!audioEl) return;
    if (playState==="playing"){audioEl.pause();playState="paused";cancelAnimationFrame(animFrame);}
    else {
      if (duration>0&&audioEl.currentTime>=trimEnd-0.01){audioEl.currentTime=trimStart;playheadFrac=trimStart/duration;}
      audioEl.play(); playState="playing"; animFrame=requestAnimationFrame(tick);
    }
    node.setDirtyCanvas(true,false);
  }
  function handleStop() {
    if (!audioEl) return;
    audioEl.pause(); audioEl.currentTime=trimStart;
    playheadFrac=duration>0?trimStart/duration:0; playState="stopped";
    cancelAnimationFrame(animFrame); node.setDirtyCanvas(true,false);
  }

  master._setDragOver=v=>{isDragOver=v;node.setDirtyCanvas(true,false);};
  node.onDragOver=function(e){const has=[...(e.dataTransfer?.items??[])].some(i=>i.kind==="file");master._setDragOver(has);return has;};
  node.onDragDrop=async function(e){master._setDragOver(false);const file=e.dataTransfer?.files?.[0];if(file&&isAudioFile(file)){await uploadFile(file);return true;}return false;};
  const origRemoved=node.onRemoved?.bind(node);
  node.onRemoved=function(){if(audioEl){audioEl.pause();audioEl.src="";}cancelAnimationFrame(animFrame);origRemoved?.();};

  return {loadAudioFile, uploadFile};
}

// ─── Register ─────────────────────────────────────────────────────────────────
app.registerExtension({
  name: "Axces2000.AudioLoader",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "AudioLoader") return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function() {
      onNodeCreated?.apply(this, arguments);
      this.serialize_widgets = true;

      const comboW = this.widgets?.find(w => w.name === "audio");
      if (!comboW) { console.error("[AudioLoader] combo widget not found"); return; }

      const w = createAudioWidget(this, comboW);
      this._alWidgets = w;

      // A zero-size STRING widget that ComfyUI will serialise into the prompt
      // automatically — this is how trim_json reliably reaches Python.
      const trimWidget = this.addWidget("STRING", "trim_json", '{"s":0,"e":0}', ()=>{}, {serialize: true});
      trimWidget.computeSize = () => [0, -4]; // invisible but present
      trimWidget.draw = () => {};
      this._alTrimWidget = trimWidget;

      // Keep _alTrimJson in sync: any write also updates the widget value.
      Object.defineProperty(this, "_alTrimJson", {
        get: () => trimWidget.value,
        set: (v) => { trimWidget.value = v; },
        configurable: true,
      });

      this.addWidget("button","📁 Browse file",null,()=>{
        const inp=document.createElement("input"); inp.type="file"; inp.accept="audio/*";
        inp.onchange=async e=>{const file=e.target.files[0];if(file)await this._alWidgets?.uploadFile(file);};
        inp.click();
      });

      // Only set default size on fresh creation; onConfigure will run
      // afterward for saved workflows and must not have its size overwritten.
      if (!this._alSizeSet) {
        this.size=[NODE_W+20, WIDGET_H+80];
        this._alSizeSet = true;
      }

      const initialFile = safeStr(comboW.value);
      if (initialFile.trim()) {
        setTimeout(()=>w.loadAudioFile(initialFile),100);
      }
    };

    // No graphToPrompt patch needed — trim_json is serialised via the
    // hidden STRING widget added in onNodeCreated below.

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function(config) {
      onConfigure?.apply(this, arguments);
      if (!this._alWidgets) return;

      const vals  = config.widgets_values ?? [];
      const fname = safeStr(vals[0]);

      // Restore trim: prefer the serialised trim_json widget (vals[3]),
      // fall back to the legacy axces2000_trim property for old workflows.
      let ts=0, te=0;
      try {
        const savedTrim = vals[3] ?? null;
        if (savedTrim && savedTrim !== '{"s":0,"e":0}') {
          const p = JSON.parse(savedTrim);
          ts = p.s ?? 0; te = p.e ?? 0;
        } else if (config.axces2000_trim) {
          ts = config.axces2000_trim.s ?? 0;
          te = config.axces2000_trim.e ?? 0;
        }
      } catch(e) {}

      if (fname) {
        setTimeout(()=>this._alWidgets.loadAudioFile(fname,ts,te),150);
      }
    };

    const origSerializeNode = nodeType.prototype.serialize;
    nodeType.prototype.serialize = function() {
      const data = origSerializeNode ? origSerializeNode.call(this) : {};
      if (this._alTrimJson && this._alTrimJson !== '{"s":0,"e":0}') {
        try {
          data.axces2000_trim = JSON.parse(this._alTrimJson);
        } catch(e) {}
      }
      return data;
    };
  },
});
