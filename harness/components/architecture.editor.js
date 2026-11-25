(function () {
  "use strict";
  const kit = globalThis.ExplainerKit;
  kit.registerCanvasEditor("architecture", (host) => {
    if (
      !host.__kitCanvas ||
      host.__kitCanvas.kind === "operating-model" ||
      !host.querySelector(".kdf-canvas .kdf-node")
    ) {
      return null;
    }
    function snapshot() {
      return structuredClone(host.__kitCanvasEdits || { version: 1, layouts: {} });
    }
    function validate(record) {
      if (
        !record ||
        record.version !== 1 ||
        !record.layouts ||
        typeof record.layouts !== "object"
      ) {
        throw new Error("Architecture edits need a versioned layout record");
      }
      Object.entries(record.layouts).forEach(([name, layout]) => {
        if (!["free", "stages", "main-flow", "groups"].includes(name) || !layout || !layout.nodes) {
          throw new Error("Unknown architecture layout in canvas edits");
        }
        Object.values(layout.nodes).forEach((node) => {
          if (
            !node ||
            typeof node.identity !== "string" ||
            !["x", "y", "w", "h"].every(
              (key) => Number.isFinite(node[key]) && node[key] >= 0 && node[key] <= 1,
            ) ||
            node.w <= 0 ||
            node.h <= 0
          ) {
            throw new Error("Canvas coordinates must be normalized and box sizes positive");
          }
        });
      });
    }
    return {
      version: 1,
      availability: () => null,
      snapshot,
      authoredSnapshot: () => structuredClone(host.__kitCanvasAuthored),
      historyKey: () => host.__kitCanvas.layout,
      validate,
      apply(record, options = {}) {
        validate(record);
        let next = record;
        if (options.history) {
          next = snapshot();
          const layout = host.__kitCanvas.layout;
          if (record.layouts[layout]) {
            next.layouts[layout] = structuredClone(record.layouts[layout]);
          } else {
            delete next.layouts[layout];
          }
        }
        Object.keys(next.layouts).forEach((key) => {
          if (!Object.keys(next.layouts[key].nodes).length) {
            delete next.layouts[key];
          }
        });
        host.__kitCanvas.apply(next);
      },
      describeChanges: (record) =>
        Object.values(record.layouts || {}).reduce(
          (sum, layout) => sum + Object.keys(layout.nodes || {}).length,
          0,
        ) + " box adjustments across saved layouts",
      resetLabel: "Reset layout",
      help: "Drag boxes to move them. Drag a selected corner to resize. Arrow keys move; Shift + arrows resize. Esc exits.",
      createSession(context) {
        let drag = null;
        let disposed = false;
        const listeners = new AbortController();
        const attributes = new Map();
        function remember(node, names) {
          attributes.set(
            node,
            Object.fromEntries(names.map((name) => [name, node.getAttribute(name)])),
          );
        }
        function clearDecoration() {
          attributes.forEach((values, node) => {
            Object.entries(values).forEach(([name, value]) => {
              if (value === null) {
                node.removeAttribute(name);
              } else {
                node.setAttribute(name, value);
              }
            });
            node.classList.remove("st-node-selected");
            node.querySelectorAll(".st-node-resize").forEach((handle) => handle.remove());
          });
          attributes.clear();
        }
        function refresh() {
          if (disposed) {
            return;
          }
          clearDecoration();
          host.classList.add("st-canvas-editing");
          const canvas = host.querySelector(".kdf-canvas");
          if (canvas) {
            remember(canvas, ["role"]);
            canvas.setAttribute("role", "group");
          }
          host.querySelectorAll(".kdf-node").forEach((node) => {
            remember(node, ["tabindex", "role", "aria-label"]);
            node.tabIndex = 0;
            node.setAttribute("role", "button");
            node.setAttribute(
              "aria-label",
              "Move " +
                node.querySelector("strong").textContent +
                ". Arrow keys move; Shift and arrow keys resize.",
            );
            if (node.dataset.node === context.selection()) {
              node.classList.add("st-node-selected");
              const handle = context.element("span", "st-node-resize");
              handle.setAttribute("aria-hidden", "true");
              node.append(handle);
            }
          });
        }
        function changedBox(id, dimensions, base = snapshot()) {
          const api = host.__kitCanvas;
          const node = api.nodes.find((item) => item.id === id);
          const layout = base.layouts[api.layout] || (base.layouts[api.layout] = { nodes: {} });
          const w = Math.max(100 / api.width, Math.min(0.9, dimensions.w));
          const h = Math.max(48 / api.height, Math.min(0.9, dimensions.h));
          layout.nodes[id] = {
            x: Math.max(8 / api.width, Math.min(1 - w - 8 / api.width, dimensions.x)),
            y: Math.max(8 / api.height, Math.min(1 - h - 8 / api.height, dimensions.y)),
            w,
            h,
            identity: api.identity(node),
          };
          return base;
        }
        function focus(id) {
          const node = Array.from(host.querySelectorAll(".kdf-node")).find(
            (item) => item.dataset.node === id,
          );
          if (node) {
            node.focus({ preventScroll: true });
          }
        }
        function finish(cancel) {
          if (!drag) {
            return;
          }
          const previous = drag;
          drag = null;
          if (previous.frame) {
            cancelAnimationFrame(previous.frame);
          }
          if (host.hasPointerCapture(previous.pointerId)) {
            host.releasePointerCapture(previous.pointerId);
          }
          const next = previous.pending
            ? changedBox(previous.id, previous.pending, structuredClone(previous.before))
            : snapshot();
          context.preview(previous.before);
          if (!cancel) {
            context.commit(next);
            context.select(previous.id);
            refresh();
            focus(previous.id);
          }
        }
        host.addEventListener(
          "pointerdown",
          (event) => {
            const nodeEl = event.target.closest(".kdf-node");
            if (
              event.button !== 0 ||
              !nodeEl ||
              !host.contains(nodeEl) ||
              document.body.classList.contains("presenting")
            ) {
              return;
            }
            const api = host.__kitCanvas;
            const node = api.nodes.find((item) => item.id === nodeEl.dataset.node);
            if (!node) {
              return;
            }
            event.preventDefault();
            event.stopImmediatePropagation();
            context.select(node.id);
            drag = {
              id: node.id,
              pointerId: event.pointerId,
              before: snapshot(),
              resize: Boolean(event.target.closest(".st-node-resize")),
              startX: event.clientX,
              startY: event.clientY,
              rect: host.querySelector(".kdf-canvas").getBoundingClientRect(),
              box: {
                x: node.x / api.width,
                y: node.y / api.height,
                w: node.w / api.width,
                h: node.h / api.height,
              },
            };
            host.setPointerCapture(event.pointerId);
            refresh();
            focus(node.id);
          },
          { capture: true, signal: listeners.signal },
        );
        host.addEventListener(
          "pointermove",
          (event) => {
            if (!drag || event.pointerId !== drag.pointerId) {
              return;
            }
            event.preventDefault();
            const dx = (event.clientX - drag.startX) / drag.rect.width;
            const dy = (event.clientY - drag.startY) / drag.rect.height;
            // A small model-space grid keeps repeated edits predictable at every zoom.
            const snap = (value) => Math.round(value * 400) / 400;
            drag.pending = drag.resize
              ? { ...drag.box, w: snap(drag.box.w + dx), h: snap(drag.box.h + dy) }
              : { ...drag.box, x: snap(drag.box.x + dx), y: snap(drag.box.y + dy) };
            if (!drag.frame) {
              drag.frame = requestAnimationFrame(() => {
                drag.frame = null;
                context.preview(changedBox(drag.id, drag.pending, structuredClone(drag.before)));
              });
            }
          },
          { passive: false, signal: listeners.signal },
        );
        host.addEventListener("pointerup", () => finish(false), { signal: listeners.signal });
        host.addEventListener("pointercancel", () => finish(true), { signal: listeners.signal });
        host.addEventListener(
          "keydown",
          (event) => {
            if (
              event.target.closest("input,textarea,select,[contenteditable]") ||
              !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
            ) {
              return;
            }
            const nodeEl = event.target.closest(".kdf-node");
            if (!nodeEl) {
              return;
            }
            const api = host.__kitCanvas;
            const node = api.nodes.find((item) => item.id === nodeEl.dataset.node);
            if (!node) {
              return;
            }
            event.preventDefault();
            event.stopImmediatePropagation();
            const box = {
              x: node.x / api.width,
              y: node.y / api.height,
              w: node.w / api.width,
              h: node.h / api.height,
            };
            const horizontal = ["ArrowLeft", "ArrowRight"].includes(event.key);
            const key = event.shiftKey ? (horizontal ? "w" : "h") : horizontal ? "x" : "y";
            box[key] +=
              (["ArrowLeft", "ArrowUp"].includes(event.key) ? -4 : 4) /
              (horizontal ? api.width : api.height);
            context.commit(changedBox(node.id, box));
            context.select(node.id);
            refresh();
            focus(node.id);
          },
          { capture: true, signal: listeners.signal },
        );
        return {
          refresh,
          renderInspector() {
            const id = context.selection();
            if (!id) {
              return null;
            }
            return context.button("Reset selected box", () => {
              const next = snapshot();
              const layout = host.__kitCanvas.layout;
              const authored = host.__kitCanvasAuthored.layouts[layout];
              if (authored && authored.nodes[id]) {
                next.layouts[layout] = next.layouts[layout] || { nodes: {} };
                next.layouts[layout].nodes[id] = structuredClone(authored.nodes[id]);
              } else if (next.layouts[layout]) {
                delete next.layouts[layout].nodes[id];
              }
              context.commit(next);
            });
          },
          dispose() {
            if (disposed) {
              return;
            }
            disposed = true;
            listeners.abort();
            finish(true);
            clearDecoration();
            host.classList.remove("st-canvas-editing");
          },
        };
      },
    };
  });
})();
