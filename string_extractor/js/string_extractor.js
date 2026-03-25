/**
 * String Extractor Widget for ComfyUI  v4.4
 *
 * Debug confirms: beforeQueued and serializeValue interleave per batch item.
 * Queue works correctly for sending values to Python.
 *
 * Problem 4 root cause: ComfyUI embeds workflow JSON in each image using
 * app.graph.serialize() called once per prompt BEFORE serializeValue runs.
 * So iw.value at serialize time is always the original value (1), not the
 * per-item value.
 *
 * Fix: hook app.graph.serialize to temporarily set iw.value to the front
 * of the queue (without shifting) so the serialized workflow captures the
 * correct index for that batch item.
 */

import { app } from "../../../scripts/app.js";

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
      function isTextConnected() {
        return node.inputs?.find(i => i.name === "text")?.link != null;
      }

      const iw = node.widgets?.find(w => w.name === "index");
      if (iw) {
        iw._sendQueue = [];
        iw.serializeValue = async function () {
          if (this._sendQueue && this._sendQueue.length > 0) {
            const v = this._sendQueue.shift();
            this.value = v;
            node.setDirtyCanvas(true, false);
            return v;
          }
          return this.value;
        };
      }

      const controlWidget = node.addWidget(
        "SE_CONTROL", "_se_control", null, () => {}, { serialize: false }
      );
      controlWidget.computeSize = () => [NODE_W, 22];

      controlWidget.beforeQueued = function () {
        const iw    = getIndexWidget();
        const mode  = getModeValue();
        const lines = getLines();
        const count = lines.length;

        if (!iw || count === 0 || mode === "Keep") return;

        if (iw._nextSend == null) {
          iw._nextSend = Number(iw.value);
        }

        const idx = iw._nextSend;
        if (idx === 0) return;

        // Peek: set iw.value to what this item will send, so that
        // graph.serialize() (called right after beforeQueued) captures
        // the correct index in the workflow JSON embedded in the image.
        iw.value = idx;

        iw._sendQueue.push(idx);

        if (mode === "Increment") {
          iw._nextSend = (idx % count) + 1;
        } else {
          iw._nextSend = Math.floor(Math.random() * count) + 1;
        }

        node.setDirtyCanvas(true, false);
      };

      controlWidget.draw = function (ctx, node, width, y) {
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
          ctx.fillText(
            `${count} line${count !== 1 ? "s" : ""} · index 0 → full text passthrough`,
            px + 2, y + 13
          );
        } else if (idx > count) {
          ctx.fillStyle = C.red;
          ctx.fillText(
            `index ${idx} out of range (max ${count}) → full text, reset to 0`,
            px + 2, y + 13
          );
        } else {
          const prev    = lines[idx - 1];
          const preview = prev.slice(0, 34) + (prev.length > 34 ? "…" : "");
          ctx.fillStyle = C.green;
          ctx.fillText(
            `Line ${idx}/${count} · "${preview}"  [${modeVal}]`,
            px + 2, y + 13
          );
        }
        ctx.textAlign = "left";
      };

      node.size = [NODE_W + 20, node.computeSize()[1]];
    };
  },

  setup() {
    const origQueuePrompt = app.queuePrompt.bind(app);
    app.queuePrompt = async function (number, batchCount) {
      const result = await origQueuePrompt(number, batchCount);

      for (const node of app.graph._nodes) {
        if (node.type !== "StringExtractor") continue;
        const iw = node.widgets?.find(w => w.name === "index");
        if (!iw || iw._nextSend == null) continue;
        iw.value = iw._nextSend;
        iw._nextSend = null;
        iw._sendQueue = [];
        node.setDirtyCanvas(true, false);
      }

      return result;
    };
  },
});
