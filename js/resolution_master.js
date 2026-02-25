/**
 * Resolution Master Widget for ComfyUI
 * Visual orientation picker (landscape / square / portrait icons) +
 * resolution dropdown + live preview of output dimensions.
 *
 * v1.3.0 — Fixed: widget now serializes as a single "RES_orient" value
 *           matching the single `resolution` input in Python. Removed the
 *           broken attempt to sync to two separate hidden combo widgets.
 */

import { app } from "../../../scripts/app.js";

// ─── Data (mirrors Python) ────────────────────────────────────────────────────
const RESOLUTIONS = {
  "SD (480p)":    { landscape: [720,  480],  square: [512,  512],  portrait: [480,  720]  },
  "1K (720p)":    { landscape: [1280, 720],  square: [1024, 1024], portrait: [720,  1280] },
  "1.3K (768p)":  { landscape: [1344, 768],  square: [1024, 1024], portrait: [768,  1344] },
  "2K (1080p)":   { landscape: [1920, 1080], square: [1536, 1536], portrait: [1080, 1920] },
  "2.5K (1440p)": { landscape: [2560, 1440], square: [1920, 1920], portrait: [1440, 2560] },
  "4K (2160p)":   { landscape: [3840, 2160], square: [2048, 2048], portrait: [2160, 3840] },
  "8K (4320p)":   { landscape: [7680, 4320], square: [5760, 5760], portrait: [4320, 7680] },
};

const RES_NAMES    = Object.keys(RESOLUTIONS);
const ORIENTATIONS = ["landscape", "square", "portrait"];

const SHAPE = {
  landscape: { w: 48, h: 30 },
  square:    { w: 36, h: 36 },
  portrait:  { w: 30, h: 48 },
};

const C = {
  bg:          "#0b1622",
  surface:     "#101e30",
  border:      "#1a2e4a",
  borderHover: "#22d3ee",
  accent:      "#22d3ee",
  accentDim:   "#0e3344",
  green:       "#4ade80",
  text:        "#94a3b8",
  textBright:  "#e2e8f0",
  textDim:     "#334155",
  shapeFill:   "#1a3a4a",
  shapeActive: "#22d3ee",
  shapeStroke: "#1e3a5a",
};

const WIDGET_H = 148;
const NODE_W   = 310;

// ─── Widget factory ───────────────────────────────────────────────────────────
function createResolutionWidget(node) {
  let selectedRes    = "2K (1080p)";
  let selectedOrient = "landscape";
  let hoveredOrient  = null;

  // The widget name MUST match the Python input name exactly: "resolution"
  // Its value is the combined string "RES_orient" that Python parses.
  const widget = node.addWidget(
    "RESOLUTION_MASTER_WIDGET", "resolution", "2K (1080p)_landscape", () => {}, { serialize: true }
  );

  widget.computeSize = () => [NODE_W, WIDGET_H];

  function combined() {
    return `${selectedRes}_${selectedOrient}`;
  }

  function sync() {
    widget.value = combined();
    node.setDirtyCanvas(true, false);
  }

  function getSize() {
    const [w, h] = RESOLUTIONS[selectedRes][selectedOrient];
    return { w, h };
  }

  // ── Draw ─────────────────────────────────────────────────────────────────
  widget.draw = function (ctx, node, width, y) {
    const px  = 10;
    const pw  = width - px * 2;
    const { w: outW, h: outH } = getSize();

    // Background card
    ctx.fillStyle = C.surface;
    ctx.beginPath();
    ctx.roundRect(px, y, pw, WIDGET_H - 4, 8);
    ctx.fill();
    ctx.strokeStyle = C.border;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Resolution label
    ctx.fillStyle = C.textDim;
    ctx.font = "9px monospace";
    ctx.textAlign = "left";
    ctx.fillText("RESOLUTION", px + 10, y + 16);

    // Dropdown pill
    const ddX = px + 10, ddY = y + 20, ddW = pw - 20, ddH = 22;
    ctx.fillStyle = C.bg;
    ctx.strokeStyle = C.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(ddX, ddY, ddW, ddH, 5);
    ctx.fill(); ctx.stroke();

    ctx.fillStyle = C.textBright;
    ctx.font = "bold 11px monospace";
    ctx.textAlign = "left";
    ctx.fillText(selectedRes, ddX + 10, ddY + 15);

    ctx.fillStyle = C.text;
    ctx.font = "9px monospace";
    ctx.textAlign = "right";
    ctx.fillText("▾", ddX + ddW - 8, ddY + 15);

    // Orientation label
    ctx.fillStyle = C.textDim;
    ctx.font = "9px monospace";
    ctx.textAlign = "left";
    ctx.fillText("ORIENTATION", px + 10, y + 56);

    // Orientation shape buttons
    const btnAreaY  = y + 60;
    const btnW = 56, btnH = 50, btnGap = 8;
    const totalW    = ORIENTATIONS.length * btnW + (ORIENTATIONS.length - 1) * btnGap;
    const btnStartX = px + pw / 2 - totalW / 2;

    widget._orientBtns = [];

    ORIENTATIONS.forEach((orient, i) => {
      const bx        = btnStartX + i * (btnW + btnGap);
      const by        = btnAreaY;
      const isActive  = orient === selectedOrient;
      const isHovered = orient === hoveredOrient;

      ctx.fillStyle   = isActive ? C.accentDim : C.bg;
      ctx.strokeStyle = isActive ? C.accent : (isHovered ? C.borderHover : C.border);
      ctx.lineWidth   = isActive ? 1.5 : 1;
      ctx.beginPath();
      ctx.roundRect(bx, by, btnW, btnH, 6);
      ctx.fill(); ctx.stroke();

      const sh    = SHAPE[orient];
      const scale = Math.min((btnW - 18) / sh.w, (btnH - 22) / sh.h);
      const sw    = sh.w * scale;
      const shr   = sh.h * scale;
      const sx    = bx + btnW / 2 - sw / 2;
      const sy    = by + 8;

      ctx.fillStyle   = isActive ? C.shapeActive : C.shapeFill;
      ctx.strokeStyle = isActive ? C.accent : C.shapeStroke;
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.roundRect(sx, sy, sw, shr, 2);
      ctx.fill(); ctx.stroke();

      ctx.fillStyle = isActive ? C.accent : C.text;
      ctx.font = `${isActive ? "bold " : ""}8px monospace`;
      ctx.textAlign = "center";
      ctx.fillText(orient.toUpperCase().slice(0, 4), bx + btnW / 2, by + btnH - 6);

      widget._orientBtns.push({ orient, bx, by, bw: btnW, bh: btnH });
    });

    // Output preview
    const previewY = btnAreaY + btnH + 10;
    const halfW    = pw / 2 - 6;

    // Width box
    ctx.fillStyle = C.bg; ctx.strokeStyle = C.border; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(px + 10, previewY, halfW - 4, 22, 5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = C.textDim; ctx.font = "8px monospace"; ctx.textAlign = "left";
    ctx.fillText("W", px + 16, previewY + 9);
    ctx.fillStyle = C.green; ctx.font = "bold 13px monospace"; ctx.textAlign = "right";
    ctx.fillText(outW, px + 10 + halfW - 10, previewY + 16);

    // Height box
    const hbX = px + pw / 2 + 2;
    ctx.fillStyle = C.bg; ctx.strokeStyle = C.border; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(hbX, previewY, halfW - 4, 22, 5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = C.textDim; ctx.font = "8px monospace"; ctx.textAlign = "left";
    ctx.fillText("H", hbX + 6, previewY + 9);
    ctx.fillStyle = C.green; ctx.font = "bold 13px monospace"; ctx.textAlign = "right";
    ctx.fillText(outH, hbX + halfW - 10, previewY + 16);

    ctx.textAlign = "left";

    widget._ddRect = { x: ddX, y: ddY, w: ddW, h: ddH };
    widget._lastY  = y;
  };

  // ── Mouse ─────────────────────────────────────────────────────────────────
  widget.mouse = function (event, pos, node) {
    const [mx, my] = pos;

    if (event.type === "pointermove") {
      hoveredOrient = null;
      if (widget._orientBtns) {
        for (const b of widget._orientBtns) {
          if (mx >= b.bx && mx <= b.bx + b.bw && my >= b.by && my <= b.by + b.bh) {
            hoveredOrient = b.orient;
            break;
          }
        }
      }
      node.setDirtyCanvas(true, false);
      return false;
    }

    if (event.type !== "pointerdown") return false;

    // Orientation button click
    if (widget._orientBtns) {
      for (const b of widget._orientBtns) {
        if (mx >= b.bx && mx <= b.bx + b.bw && my >= b.by && my <= b.by + b.bh) {
          selectedOrient = b.orient;
          sync();
          return true;
        }
      }
    }

    // Dropdown click
    if (widget._ddRect) {
      const d = widget._ddRect;
      if (mx >= d.x && mx <= d.x + d.w && my >= d.y && my <= d.y + d.h) {
        const items = RES_NAMES.map(name => ({
          content: name,
          callback: () => { selectedRes = name; sync(); }
        }));
        new LiteGraph.ContextMenu(items, {
          event, callback: null, parentMenu: null, node,
        });
        return true;
      }
    }

    return false;
  };

  // ── Serialize ─────────────────────────────────────────────────────────────
  widget.serializeValue = function () {
    return combined();
  };

  // ── Restore from saved graph ──────────────────────────────────────────────
  widget._restore = function (val) {
    if (!val) return;
    const last   = val.rfind ? val.rfind("_") : val.lastIndexOf("_");
    const lastIdx = val.lastIndexOf("_");
    if (lastIdx === -1) return;
    const res    = val.slice(0, lastIdx);
    const orient = val.slice(lastIdx + 1);
    if (RESOLUTIONS[res] && ORIENTATIONS.includes(orient)) {
      selectedRes    = res;
      selectedOrient = orient;
    }
    sync();
  };

  return widget;
}

// ─── Register extension ───────────────────────────────────────────────────────
app.registerExtension({
  name: "Axces2000.ResolutionMaster",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "ResolutionMaster") return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);

      this.serialize_widgets = true;

      // Remove the single auto-generated combo widget for "resolution"
      const idx = this.widgets?.findIndex(w => w.name === "resolution");
      if (idx !== undefined && idx >= 0) this.widgets.splice(idx, 1);

      const rw = createResolutionWidget(this);
      this._resWidget = rw;
      this.size = [NODE_W + 20, WIDGET_H + 60];
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (config) {
      onConfigure?.apply(this, arguments);
      if (this._resWidget && config.widgets_values?.[0]) {
        this._resWidget._restore(config.widgets_values[0]);
      }
    };
  },
});
