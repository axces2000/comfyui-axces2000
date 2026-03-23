/**
 * String Extractor Widget for ComfyUI  v1.9
 *
 * Fix: Python now returns a `ui` dict which is the only data ComfyUI
 * sends to the frontend in the "executed" websocket event.
 * We read detail.output.index_out[0] and write it into the index widget.
 */

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const NODE_W = 380;

const C = {
  green:   "#4ade80",
  text:    "#94a3b8",
  textDim: "#334155",
  red:     "#f87171",
};

app.registerExtension({
  name: "Axces2000.StringExtractor",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "StringExtractor") return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);

      const node = this;
      node.serialize_widgets = true;

      function getTextWidget()  { return node.widgets?.find(w => w.name === "text"); }
      function getIndexWidget() { return node.widgets?.find(w => w.name === "index"); }
      function getModeWidget()  { return node.widgets?.find(w => w.name === "mode"); }

      function getLines() {
        return String(getTextWidget()?.value ?? "").split("\n").filter(l => l.trim() !== "");
      }
      function getIndexValue() { return Number(getIndexWidget()?.value ?? 0); }
      function getModeValue()  { return getModeWidget()?.value ?? "Keep"; }
      function isTextConnected() { return node.inputs?.find(i => i.name === "text")?.link != null; }

      // ── Write index_out back into the index widget ─────────────────────────
      // Python returns { "ui": { "index_out": [N] }, "result": (...) }
      // ComfyUI sends the `ui` dict to the frontend in the "executed" event.
      // detail.output is the ui dict, so detail.output.index_out[0] is our value.
      function onExecuted(event) {
        const detail = event.detail ?? event;
        if (String(detail.node) !== String(node.id)) return;
        const indexOut = detail.output?.index_out?.[0];
        if (indexOut == null) return;
        const iw = getIndexWidget();
        if (iw) {
          iw.value = indexOut;
          node.setDirtyCanvas(true, false);
        }
      }

      api.addEventListener("executed", onExecuted);

      const origOnRemoved = node.onRemoved?.bind(node);
      node.onRemoved = function () {
        api.removeEventListener("executed", onExecuted);
        origOnRemoved?.();
      };

      // ── Status line widget ────────────────────────────────────────────────
      const statusWidget = node.addWidget("SE_STATUS", "_status", null, () => {}, { serialize: false });
      statusWidget.computeSize = () => [NODE_W, 22];

      statusWidget.draw = function (ctx, node, width, y) {
        const px       = 10;
        const lines    = getLines();
        const count    = lines.length;
        const idx      = getIndexValue();
        const modeVal  = getModeValue();
        const textConn = isTextConnected();

        ctx.font = "9px monospace"; ctx.textAlign = "left";

        if (textConn) {
          ctx.fillStyle = C.textDim;
          ctx.fillText("text connected via input ↑", px + 2, y + 13);
        } else if (count === 0) {
          ctx.fillStyle = C.textDim;
          ctx.fillText("No lines entered", px + 2, y + 13);
        } else if (idx === 0) {
          ctx.fillStyle = C.text;
          ctx.fillText(`${count} line${count !== 1 ? "s" : ""} · index 0 → full text passthrough`, px + 2, y + 13);
        } else if (idx > count) {
          ctx.fillStyle = C.red;
          ctx.fillText(`index ${idx} out of range (max ${count}) → full text, reset to 0`, px + 2, y + 13);
        } else {
          const prev    = lines[idx - 1];
          const preview = prev.slice(0, 34) + (prev.length > 34 ? "…" : "");
          ctx.fillStyle = C.green;
          ctx.fillText(`Line ${idx}/${count} · "${preview}"  [${modeVal}]`, px + 2, y + 13);
        }
        ctx.textAlign = "left";
      };

      node.size = [NODE_W + 20, node.computeSize()[1]];
    };
  },
});
