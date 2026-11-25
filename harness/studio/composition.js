/* Deterministic slide-element editor. Shapes use normalized slide geometry;
   a 960×540 reference scale keeps text stable without letterboxing sections. */
(function () {
  "use strict";

  const api = (globalThis.ExplainerComposition = globalThis.ExplainerComposition || {});
  const SVG = "http://www.w3.org/2000/svg";
  const WIDTH = 960;
  const HEIGHT = 540;
  const TYPES = new Set(["group", "rect", "ellipse", "line", "arrow", "path", "text"]);
  const DRAW_TOOLS = new Set(["rect", "ellipse", "line", "arrow", "text"]);
  const DRAW_DEFAULTS = { rect: [0.2, 0.12], ellipse: [0.2, 0.12], text: [0.24, 0.1] };
  const MIN_DRAW_EXTENT = 0.004;
  const clone = (value) => structuredClone(value);
  const number = (value, fallback = 0) =>
    Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, number(value)));

  function create(options = {}) {
    const root = options.root || document.querySelector("section[id]");
    if (!root) {
      return null;
    }

    const state = clone(options.manifest || { version: 2, shapes: [] });
    state.shapes = Array.isArray(state.shapes) ? state.shapes : [];
    state.components =
      state.components && typeof state.components === "object" ? state.components : {};
    const history = [];
    const future = [];
    let selected = [];
    let selectedComponent = null;
    let drag = null;
    let viewport = { width: WIDTH, height: HEIGHT };
    const px = (value) => number(value) * viewport.width;
    const py = (value) => number(value) * viewport.height;
    let armedTool = null;
    let drawing = null;
    let textPrompt = null;
    let editingTextId = null;
    let toolbar = null;
    let lastTextTap = null;
    let swallowClick = false;

    const layer = document.createElementNS(SVG, "svg");
    layer.classList.add("ec-composition-layer");
    layer.setAttribute("viewBox", `0 0 ${WIDTH} ${HEIGHT}`);
    layer.setAttribute("preserveAspectRatio", "xMidYMid meet");
    layer.setAttribute("role", "application");
    layer.setAttribute("aria-label", "Editable slide elements");
    root.style.position ||= "relative";
    root.classList.add("ec-editing");
    root.append(layer);

    const slideShapes = () =>
      state.shapes.filter((shape) => shape && shape.slide === root.id && TYPES.has(shape.type));
    const item = (id = selected[0]) => state.shapes.find((shape) => shape && shape.id === id);
    const children = (id) => slideShapes().filter((shape) => shape.parent === id);
    function descendants(id, result = []) {
      children(id).forEach((child) => {
        result.push(child);
        descendants(child.id, result);
      });
      return result;
    }
    const leaves = (shape) =>
      shape && shape.type === "group"
        ? descendants(shape.id).filter((child) => child.type !== "group")
        : shape
          ? [shape]
          : [];
    const componentIdentity = (host) =>
      globalThis.ExplainerAuthoring && globalThis.ExplainerAuthoring.identity
        ? globalThis.ExplainerAuthoring.identity(host)
        : host.id
          ? `#${host.id}`
          : "";
    const authoredSlide = () => {
      const id = root.dataset && root.dataset.authoringSlide;
      return id && Array.isArray(state.slides)
        ? state.slides.find((slide) => slide && slide.id === id)
        : null;
    };
    function detachedRoot(host) {
      const slide = authoredSlide();
      if (slide && slide.component && slide.component.detached) {
        return slide.component.detached.root || "";
      }
      const component = state.components[componentIdentity(host)];
      return component && component.detached ? component.detached.root || "" : "";
    }
    const isDetached = (host) => Boolean(detachedRoot(host));

    function selectionValue() {
      if (selectedComponent) {
        return { kind: "component", id: selectedComponent };
      }
      if (selected.length > 1) {
        return {
          kind: "multiple",
          ids: selected.slice(),
          canGroup: hasSingleOwner(selected.map(item).filter(Boolean)),
        };
      }
      return item() ? clone(item()) : null;
    }

    function emit(selectionChanged = false) {
      if (typeof options.onChange === "function") {
        options.onChange(clone(state));
      }
      if (selectionChanged && typeof options.onSelect === "function") {
        options.onSelect(selectionValue());
      }
      if (typeof options.onHistory === "function") {
        options.onHistory({ canUndo: history.length > 0, canRedo: future.length > 0 });
      }
    }

    function emitSelection() {
      if (typeof options.onSelect === "function") {
        options.onSelect(selectionValue());
      }
      if (typeof options.onHistory === "function") {
        options.onHistory({ canUndo: history.length > 0, canRedo: future.length > 0 });
      }
    }

    function snapshot() {
      const hosts = [...root.querySelectorAll(".artifact")].filter(
        (host) => host.closest("section") === root,
      );
      const componentIds = hosts.map(componentIdentity).filter(Boolean);
      const components = Object.fromEntries(
        componentIds.flatMap((id) =>
          state.components[id] ? [[id, clone(state.components[id])]] : [],
        ),
      );
      const componentStyles = Object.fromEntries(
        hosts.flatMap((host) => {
          const id = componentIdentity(host);
          return id
            ? [
                [
                  id,
                  Object.fromEntries(
                    ["position", "left", "top", "width", "height", "rotate"].map((key) => [
                      key,
                      host.style[key],
                    ]),
                  ),
                ],
              ]
            : [];
        }),
      );
      const slide = authoredSlide();
      return {
        shapes: clone(state.shapes.filter((shape) => shape && shape.slide === root.id)),
        componentIds,
        components,
        componentStyles,
        slideComponent: slide ? clone(slide.component) : null,
      };
    }

    function checkpoint() {
      history.push(snapshot());
      if (history.length > 60) {
        history.shift();
      }
      future.length = 0;
    }

    function restoreSnapshot(snap) {
      // Undo and redo both land here; neither may leave a nudge burst open,
      // or the next nudge would mutate without its own checkpoint.
      endNudgeBurst();
      state.shapes = [
        ...state.shapes.filter((shape) => !shape || shape.slide !== root.id),
        ...clone(snap.shapes),
      ];
      snap.componentIds.forEach((id) => {
        if (snap.components[id]) {
          state.components[id] = clone(snap.components[id]);
        } else {
          delete state.components[id];
        }
        const host = [...root.querySelectorAll(".artifact")].find(
          (candidate) => componentIdentity(candidate) === id,
        );
        if (host && snap.componentStyles[id]) {
          Object.assign(host.style, snap.componentStyles[id]);
        }
      });
      const slide = authoredSlide();
      if (slide && snap.slideComponent) {
        slide.component = clone(snap.slideComponent);
      }
      selected = selected.filter((id) => item(id));
      syncDetachedHosts();
      render();
      emit(true);
    }

    function undo() {
      const previous = history.pop();
      if (!previous) {
        return false;
      }
      future.push(snapshot());
      restoreSnapshot(previous);
      return true;
    }

    function redo() {
      const next = future.pop();
      if (!next) {
        return false;
      }
      history.push(snapshot());
      restoreSnapshot(next);
      return true;
    }

    const makeId = (prefix = "shape") =>
      `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

    function normalize(shape) {
      if (!shape || shape.type === "group") {
        return shape;
      }
      shape.x = clamp(shape.x);
      shape.y = clamp(shape.y);
      shape.width = Math.min(clamp(shape.width, 0.001), 1 - shape.x);
      shape.height = Math.min(clamp(shape.height, 0.001), 1 - shape.y);
      shape.z = number(shape.z);
      shape.style = {
        fill: shape.type === "text" ? "#111827" : "transparent",
        stroke: shape.type === "text" ? "none" : "#111827",
        strokeWidth: 2,
        opacity: 1,
        ...(shape.type === "text" ? { fontSize: 24 } : {}),
        ...shape.style,
      };
      if (shape.type === "line" || shape.type === "arrow") {
        shape.x1 = clamp(shape.x1);
        shape.y1 = clamp(shape.y1);
        shape.x2 = clamp(shape.x2);
        shape.y2 = clamp(shape.y2);
      }
      return shape;
    }

    function bounds(shape) {
      if (!shape) {
        return null;
      }
      if (shape.type === "group") {
        const boxes = leaves(shape).map(bounds).filter(Boolean);
        if (!boxes.length) {
          return null;
        }
        const left = Math.min(...boxes.map((box) => box.x));
        const top = Math.min(...boxes.map((box) => box.y));
        const right = Math.max(...boxes.map((box) => box.x + box.width));
        const bottom = Math.max(...boxes.map((box) => box.y + box.height));
        return { x: left, y: top, width: right - left, height: bottom - top };
      }
      if (shape.type === "line" || shape.type === "arrow") {
        return {
          x: Math.min(shape.x1, shape.x2),
          y: Math.min(shape.y1, shape.y2),
          width: Math.max(0.001, Math.abs(shape.x2 - shape.x1)),
          height: Math.max(0.001, Math.abs(shape.y2 - shape.y1)),
        };
      }
      if (shape.type === "path" && Array.isArray(shape.points) && shape.points.length >= 2) {
        const xs = shape.points.filter((_, index) => index % 2 === 0).map((value) => number(value));
        const ys = shape.points.filter((_, index) => index % 2 === 1).map((value) => number(value));
        const left = Math.min(...xs);
        const top = Math.min(...ys);
        return {
          x: left,
          y: top,
          width: Math.max(0.001, Math.max(...xs) - left),
          height: Math.max(0.001, Math.max(...ys) - top),
        };
      }
      return {
        x: number(shape.x),
        y: number(shape.y),
        width: Math.max(0.001, number(shape.width, 0.001)),
        height: Math.max(0.001, number(shape.height, 0.001)),
      };
    }

    function combinedBounds(ids) {
      const boxes = ids.map((id) => bounds(item(id))).filter(Boolean);
      if (!boxes.length) {
        return null;
      }
      const left = Math.min(...boxes.map((box) => box.x));
      const top = Math.min(...boxes.map((box) => box.y));
      const right = Math.max(...boxes.map((box) => box.x + box.width));
      const bottom = Math.max(...boxes.map((box) => box.y + box.height));
      return { x: left, y: top, width: right - left, height: bottom - top };
    }

    function paint(node, shape) {
      const style = shape.style || {};
      node.setAttribute("fill", style.fill == null ? "transparent" : style.fill);
      node.setAttribute("stroke", style.stroke == null ? "#111827" : style.stroke);
      node.setAttribute("stroke-width", number(style.strokeWidth, 2));
      node.setAttribute("opacity", number(style.opacity, 1));
      node.setAttribute("vector-effect", "non-scaling-stroke");
      if (style.fontFamily) {
        node.setAttribute("font-family", style.fontFamily);
      }
      if (style.fontWeight) {
        node.setAttribute("font-weight", style.fontWeight);
      }
      if (style.fontStyle) {
        node.setAttribute("font-style", style.fontStyle);
      }
      if (style.textAlign) {
        node.setAttribute(
          "text-anchor",
          { center: "middle", right: "end" }[style.textAlign] || "start",
        );
      }
      if (style.letterSpacing != null) {
        node.setAttribute("letter-spacing", number(style.letterSpacing));
      }
      if (style.strokeLinecap) {
        node.setAttribute("stroke-linecap", style.strokeLinecap);
      }
      if (style.strokeLinejoin) {
        node.setAttribute("stroke-linejoin", style.strokeLinejoin);
      }
    }

    function meaningfulSelection(shape) {
      const roots = new Set(
        [...root.querySelectorAll(".artifact")].map((host) => detachedRoot(host)).filter(Boolean),
      );
      if (!roots.size || !shape.parent) {
        return shape.id;
      }
      // The closest group is the element users perceive around the clicked
      // leaf (for example, one Stack frame or Architecture node). Climbing to
      // the detached root would make nested components selectable only as one
      // large object. Double-click still drills into the leaf itself.
      return roots.has(shape.parent) ? shape.id : shape.parent;
    }

    function draw(shape) {
      if (shape.type === "group") {
        return null;
      }
      const tag = shape.type === "arrow" ? "line" : shape.type;
      const node = document.createElementNS(SVG, tag);
      const selectedGroup = meaningfulSelection(shape);
      node.dataset.shapeId = shape.id;
      node.classList.add("ec-shape");
      node.classList.toggle(
        "ec-selected",
        selected.includes(shape.id) || selected.includes(selectedGroup),
      );
      node.tabIndex = 0;
      if (shape.type === "line" || shape.type === "arrow") {
        node.setAttribute("x1", px(shape.x1));
        node.setAttribute("y1", py(shape.y1));
        node.setAttribute("x2", px(shape.x2));
        node.setAttribute("y2", py(shape.y2));
      } else if (shape.type === "ellipse") {
        node.setAttribute("cx", px(shape.x + shape.width / 2));
        node.setAttribute("cy", py(shape.y + shape.height / 2));
        node.setAttribute("rx", px(shape.width / 2));
        node.setAttribute("ry", py(shape.height / 2));
      } else if (shape.type === "path") {
        const points = (shape.points || []).reduce((pairs, value, index) => {
          if (index % 2 === 0) {
            pairs.push([value, shape.points[index + 1]]);
          }
          return pairs;
        }, []);
        node.setAttribute(
          "d",
          points.map(([x, y], index) => `${index ? "L" : "M"}${px(x)} ${py(y)}`).join(" ") +
            (shape.closed ? " Z" : ""),
        );
      } else {
        node.setAttribute("x", px(shape.x));
        node.setAttribute("y", py(shape.y));
        node.setAttribute("width", px(shape.width));
        node.setAttribute("height", py(shape.height));
        if (shape.type === "rect" && shape.style && shape.style.radius) {
          node.setAttribute("rx", Math.min(px(shape.width), py(shape.height)) * shape.style.radius);
        }
      }
      const box = bounds(shape);
      const rotation = number(shape.rotation, number(shape.style && shape.style.rotation));
      if (rotation && box) {
        node.setAttribute(
          "transform",
          `rotate(${rotation} ${px(box.x + box.width / 2)} ${py(box.y + box.height / 2)})`,
        );
      }
      if (shape.type === "text") {
        const style = shape.style || {};
        const size = number(style.fontSize, 24);
        const lineHeight = style.lineHeight === "normal" ? 1.2 : number(style.lineHeight, 1.2);
        const lines = String(shape.text || "").split("\n");
        const anchorX =
          style.textAlign === "center"
            ? shape.x + shape.width / 2
            : style.textAlign === "right"
              ? shape.x + shape.width
              : shape.x;
        node.removeAttribute("x");
        node.removeAttribute("y");
        lines.forEach((line, index) => {
          const row = document.createElementNS(SVG, "tspan");
          row.textContent = line;
          row.setAttribute("x", px(anchorX));
          row.setAttribute("y", py(shape.y) + index * size * lineHeight);
          node.append(row);
        });
        node.setAttribute("dominant-baseline", "hanging");
        node.setAttribute("font-size", size);
      }
      if (shape.type === "arrow" || (shape.style && shape.style.endArrow)) {
        node.setAttribute("marker-end", `url(#ec-arrowhead-${root.id || "section"})`);
      }
      if (shape.style && shape.style.startArrow) {
        node.setAttribute("marker-start", `url(#ec-arrowhead-${root.id || "section"})`);
      }
      paint(node, shape);
      if (shape.type === "text") {
        if (shape.id === editingTextId) {
          node.style.display = "none";
        }
        // render() rebuilds shape nodes on every selection change, so the
        // second press of a double-click lands on a fresh node and the
        // browser retargets dblclick at the layer. Detect the double press
        // here; the detail count is kept as a belt-and-suspenders signal
        // (some input paths report it as 0).
        node.addEventListener("pointerdown", (event) => {
          const now = performance.now();
          const recent =
            lastTextTap &&
            lastTextTap.id === shape.id &&
            now - lastTextTap.time < 450 &&
            Math.hypot(event.clientX - lastTextTap.x, event.clientY - lastTextTap.y) < 24;
          lastTextTap = { id: shape.id, time: now, x: event.clientX, y: event.clientY };
          if (recent || event.detail > 1) {
            event.preventDefault();
            event.stopImmediatePropagation();
            beginTextShapeEdit(shape);
          }
        });
      }
      node.addEventListener("pointerdown", (event) =>
        startDrag(event, event.detail > 1 ? shape.id : selectedGroup),
      );
      node.addEventListener("focus", () => select(selectedGroup));
      return node;
    }

    function drawComponent(host) {
      if (isDetached(host)) {
        return null;
      }
      const sectionBounds = root.getBoundingClientRect();
      const hostBounds = host.getBoundingClientRect();
      const id = componentIdentity(host);
      if (!id || !sectionBounds.width || !sectionBounds.height) {
        return null;
      }
      const saved = state.components[id] && state.components[id].frame;
      const frame = saved || {
        x: (hostBounds.left - sectionBounds.left) / sectionBounds.width,
        y: (hostBounds.top - sectionBounds.top) / sectionBounds.height,
        width: hostBounds.width / sectionBounds.width,
        height: hostBounds.height / sectionBounds.height,
      };
      const node = document.createElementNS(SVG, "rect");
      node.classList.add("ec-component-frame");
      node.classList.toggle("ec-selected", id === selectedComponent);
      node.setAttribute("x", px(frame.x));
      node.setAttribute("y", py(frame.y));
      node.setAttribute("width", px(frame.width));
      node.setAttribute("height", py(frame.height));
      node.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) {
          return;
        }
        if (
          event.detail > 1 &&
          typeof options.onActivateComponent === "function" &&
          options.onActivateComponent(host)
        ) {
          event.stopPropagation();
          return;
        }
        event.stopPropagation();
        selectedComponent = id;
        selected = [];
        swallowClick = true;
        const point = pointerPoint(event);
        drag = {
          component: id,
          pointerId: event.pointerId,
          x: point.x,
          y: point.y,
          frame: clone(saved || frame),
          committed: false,
        };
        root.setPointerCapture(event.pointerId);
        render();
        emitSelection();
      });
      return node;
    }

    function handle(kind, id, x, y, component = false) {
      const node = document.createElementNS(SVG, "circle");
      node.classList.add("ec-handle");
      node.classList.toggle("ec-component-handle", component);
      node.dataset.handle = kind;
      node.setAttribute("cx", px(x));
      node.setAttribute("cy", py(y));
      node.setAttribute("r", "7");
      node.addEventListener("pointerdown", (event) => startHandle(event, id, kind, component));
      return node;
    }

    function render() {
      const rect = root.getBoundingClientRect();
      const scale = Math.max(0.001, Math.min(rect.width / WIDTH, rect.height / HEIGHT));
      viewport = {
        width: rect.width > 0 ? rect.width / scale : WIDTH,
        height: rect.height > 0 ? rect.height / scale : HEIGHT,
      };
      layer.setAttribute("viewBox", `0 0 ${viewport.width} ${viewport.height}`);
      layer.replaceChildren();
      const marker = document.createElementNS(SVG, "marker");
      marker.id = `ec-arrowhead-${root.id || "section"}`;
      marker.setAttribute("markerWidth", "8");
      marker.setAttribute("markerHeight", "8");
      marker.setAttribute("refX", "8");
      marker.setAttribute("refY", "4");
      marker.setAttribute("orient", "auto-start-reverse");
      marker.setAttribute("markerUnits", "userSpaceOnUse");
      const tip = document.createElementNS(SVG, "path");
      tip.setAttribute("d", "M0 0L8 4L0 8z");
      tip.setAttribute("fill", "context-stroke");
      marker.append(tip);
      const defs = document.createElementNS(SVG, "defs");
      defs.append(marker);
      layer.append(defs);

      slideShapes()
        .filter((shape) => shape.type !== "group")
        .toSorted((a, b) => number(a.z) - number(b.z))
        .forEach((shape) => layer.append(draw(shape)));
      [...root.querySelectorAll(".artifact")]
        .filter((host) => host.closest("section") === root)
        .forEach((host) => {
          const frame = drawComponent(host);
          if (frame) {
            layer.append(frame);
          }
        });

      if (selected.length === 1) {
        const current = item();
        const box = bounds(current);
        if (current && box) {
          const outline = document.createElementNS(SVG, "rect");
          outline.classList.add("ec-selection-box");
          outline.setAttribute("x", px(box.x));
          outline.setAttribute("y", py(box.y));
          outline.setAttribute("width", px(box.width));
          outline.setAttribute("height", py(box.height));
          layer.append(outline);
          if (current.type === "line" || current.type === "arrow") {
            layer.append(handle("start", current.id, current.x1, current.y1));
            layer.append(handle("end", current.id, current.x2, current.y2));
          } else {
            layer.append(handle("resize", current.id, box.x + box.width, box.y + box.height));
          }
        }
      }
      if (selectedComponent) {
        const frame =
          state.components[selectedComponent] && state.components[selectedComponent].frame;
        if (frame) {
          layer.append(
            handle(
              "resize",
              selectedComponent,
              frame.x + frame.width,
              frame.y + frame.height,
              true,
            ),
          );
        }
      }
      if (drawing) {
        updateDrawPreview();
      }
      syncToolbar();
    }

    function select(id, additive = false) {
      if (!item(id)) {
        selected = [];
      } else if (additive) {
        selected = selected.includes(id)
          ? selected.filter((candidate) => candidate !== id)
          : [...selected, id];
      } else {
        selected = [id];
      }
      selectedComponent = null;
      render();
      emitSelection();
    }

    function startDrag(event, id) {
      if (event.button !== 0) {
        return;
      }
      event.stopPropagation();
      swallowClick = true;
      select(id, event.shiftKey || event.metaKey);
      if (!selected.length) {
        return;
      }
      const point = pointerPoint(event);
      drag = {
        ids: selected.slice(),
        box: combinedBounds(selected),
        pointerId: event.pointerId,
        x: point.x,
        y: point.y,
        before: { shapes: clone(slideShapes()) },
        committed: false,
      };
      root.setPointerCapture(event.pointerId);
    }

    function startHandle(event, id, kind, component) {
      if (event.button !== 0) {
        return;
      }
      event.stopPropagation();
      swallowClick = true;
      const point = pointerPoint(event);
      drag = {
        ...(component ? { component: id } : { ids: [id], box: bounds(item(id)) }),
        kind,
        pointerId: event.pointerId,
        x: point.x,
        y: point.y,
        before: { shapes: clone(slideShapes()) },
        frame: component ? clone(state.components[id].frame) : null,
        committed: false,
      };
      root.setPointerCapture(event.pointerId);
    }

    function transform(shape, before, dx, dy, sx = 1, sy = 1, origin = null) {
      const ox = origin ? origin.x : 0;
      const oy = origin ? origin.y : 0;
      const x = (value) => ox + (number(value) - ox) * sx + dx;
      const y = (value) => oy + (number(value) - oy) * sy + dy;
      if (before.type === "line" || before.type === "arrow") {
        shape.x1 = x(before.x1);
        shape.y1 = y(before.y1);
        shape.x2 = x(before.x2);
        shape.y2 = y(before.y2);
      } else if (before.type === "path") {
        shape.points = before.points.map((value, index) => (index % 2 === 0 ? x(value) : y(value)));
      } else {
        shape.x = x(before.x);
        shape.y = y(before.y);
        shape.width = before.width * sx;
        shape.height = before.height * sy;
        if (shape.type === "text" && shape.style && before.style) {
          shape.style.fontSize = clamp(
            number(before.style.fontSize, 24) * Math.min(sx, sy),
            6,
            192,
          );
        }
      }
    }

    function transformIds(ids, beforeState, dx, dy, sx = 1, sy = 1, origin = null) {
      const expanded = new Set();
      ids.forEach((id) => {
        expanded.add(id);
        descendants(id).forEach((shape) => expanded.add(shape.id));
      });
      expanded.forEach((id) => {
        const current = item(id);
        const before = beforeState.shapes.find((shape) => shape && shape.id === id);
        if (current && before && current.type !== "group") {
          transform(current, before, dx, dy, sx, sy, origin);
        }
      });
    }

    function pointerPoint(event) {
      const matrix = layer.getScreenCTM && layer.getScreenCTM();
      if (matrix && matrix.a && matrix.d) {
        return {
          x: (event.clientX - matrix.e) / matrix.a / viewport.width,
          y: (event.clientY - matrix.f) / matrix.d / viewport.height,
        };
      }
      const rect = root.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left) / rect.width,
        y: (event.clientY - rect.top) / rect.height,
      };
    }

    /* ── armed tools: draw shapes on the slide instead of teleporting ── */
    const locked = () => typeof options.isLocked === "function" && Boolean(options.isLocked());
    const clampPoint = (point) => ({
      x: clamp(point && point.x),
      y: clamp(point && point.y),
    });

    function setArmedTool(tool) {
      const next = DRAW_TOOLS.has(tool) ? tool : null;
      if (next === armedTool) {
        return;
      }
      armedTool = next;
      root.classList.toggle("ec-tool-armed", Boolean(next));
      if (next) {
        root.dataset.ecTool = next;
      } else {
        delete root.dataset.ecTool;
      }
      if (typeof options.onToolChange === "function") {
        options.onToolChange(next);
      }
    }

    function armTool(tool) {
      if (locked()) {
        return false;
      }
      setArmedTool(tool);
      return armedTool === tool;
    }

    function disarmTool() {
      setArmedTool(null);
    }

    function makeDrawPreview(tool) {
      let preview;
      if (tool === "line" || tool === "arrow") {
        preview = document.createElementNS(SVG, "line");
        if (tool === "arrow") {
          preview.setAttribute("marker-end", `url(#ec-arrowhead-${root.id || "section"})`);
        }
      } else if (tool === "ellipse") {
        preview = document.createElementNS(SVG, "ellipse");
      } else {
        preview = document.createElementNS(SVG, "rect");
      }
      preview.classList.add("ec-draw-preview");
      preview.setAttribute("aria-hidden", "true");
      return preview;
    }

    function updateDrawPreview() {
      if (!drawing) {
        return;
      }
      if (drawing.preview.parentElement !== layer) {
        layer.append(drawing.preview);
      }
      const start = clampPoint(drawing.start);
      const current = clampPoint(drawing.current);
      if (drawing.type === "line" || drawing.type === "arrow") {
        drawing.preview.setAttribute("x1", px(start.x));
        drawing.preview.setAttribute("y1", py(start.y));
        drawing.preview.setAttribute("x2", px(current.x));
        drawing.preview.setAttribute("y2", py(current.y));
        return;
      }
      const x = Math.min(start.x, current.x);
      const y = Math.min(start.y, current.y);
      const width = Math.abs(current.x - start.x);
      const height = Math.abs(current.y - start.y);
      if (drawing.type === "ellipse") {
        drawing.preview.setAttribute("cx", px(x + width / 2));
        drawing.preview.setAttribute("cy", py(y + height / 2));
        drawing.preview.setAttribute("rx", px(width / 2));
        drawing.preview.setAttribute("ry", py(height / 2));
        return;
      }
      drawing.preview.setAttribute("x", px(x));
      drawing.preview.setAttribute("y", py(y));
      drawing.preview.setAttribute("width", px(width));
      drawing.preview.setAttribute("height", py(height));
    }

    function startDrawing(event) {
      const preview = makeDrawPreview(armedTool);
      layer.append(preview);
      drawing = {
        type: armedTool,
        start: pointerPoint(event),
        current: null,
        pointerId: event.pointerId,
        preview,
      };
      drawing.current = drawing.start;
      try {
        root.setPointerCapture(event.pointerId);
      } catch {
        /* capture is best effort; the root listeners still track the drag */
      }
      updateDrawPreview();
    }

    function moveDrawing(event) {
      if (!drawing || event.pointerId !== drawing.pointerId) {
        return;
      }
      drawing.current = pointerPoint(event);
      updateDrawPreview();
    }

    function commitDrawing(commit) {
      const gesture = drawing;
      drawing = null;
      if (!gesture) {
        return null;
      }
      gesture.preview.remove();
      if (root.hasPointerCapture(gesture.pointerId)) {
        root.releasePointerCapture(gesture.pointerId);
      }
      if (!commit) {
        return null;
      }
      const start = clampPoint(gesture.start);
      const end = clampPoint(gesture.current);
      const rect = root.getBoundingClientRect();
      const dragged =
        Math.hypot((end.x - start.x) * rect.width, (end.y - start.y) * rect.height) >= 4;
      let geometry;
      if (gesture.type === "line" || gesture.type === "arrow") {
        geometry = dragged
          ? { x1: start.x, y1: start.y, x2: end.x, y2: end.y }
          : { x1: start.x, y1: start.y, x2: clamp(start.x + 0.15), y2: start.y };
      } else if (gesture.type === "text") {
        geometry = {
          x: start.x,
          y: start.y,
          width: dragged ? Math.abs(end.x - start.x) : DRAW_DEFAULTS.text[0],
          height: dragged ? Math.abs(end.y - start.y) : DRAW_DEFAULTS.text[1],
        };
      } else {
        const [defaultWidth, defaultHeight] = DRAW_DEFAULTS[gesture.type] || [0.2, 0.12];
        geometry = dragged
          ? {
              x: Math.min(start.x, end.x),
              y: Math.min(start.y, end.y),
              width: Math.max(MIN_DRAW_EXTENT, Math.abs(end.x - start.x)),
              height: Math.max(MIN_DRAW_EXTENT, Math.abs(end.y - start.y)),
            }
          : {
              x: clamp(start.x - defaultWidth / 2),
              y: clamp(start.y - defaultHeight / 2),
              width: defaultWidth,
              height: defaultHeight,
            };
      }
      const tool = gesture.type;
      if (tool === "text") {
        setArmedTool(null);
        openTextPrompt(geometry);
        return null;
      }
      const shape = add(tool, geometry);
      if (shape && tool !== "line" && tool !== "arrow") {
        setArmedTool(null);
      }
      return shape;
    }

    function endDrawing(event) {
      if (!drawing || event.pointerId !== drawing.pointerId) {
        return;
      }
      drawing.current = pointerPoint(event);
      commitDrawing(true);
    }

    function cancelDrawing() {
      commitDrawing(false);
    }

    /* ── inline text prompt for new and re-edited text shapes ─────────── */
    function openTextPrompt(geometry, shape = null) {
      cancelTextPrompt();
      const rect = root.getBoundingClientRect();
      const scale = viewport.width > 0 ? rect.width / viewport.width : 1;
      const fontSize = number(shape && shape.style ? shape.style.fontSize : undefined, 24);
      const el = document.createElement("div");
      el.className = "ec-text-prompt";
      // The gesture-claiming exemptions match this attribute, not the class.
      el.dataset.ecTextPrompt = "";
      el.contentEditable = "true";
      el.spellcheck = false;
      el.dataset.placeholder = "Type a label…";
      el.style.left = Math.max(4, Math.min(geometry.x * rect.width, rect.width - 140)) + "px";
      el.style.top = Math.max(4, Math.min(geometry.y * rect.height, rect.height - 40)) + "px";
      el.style.fontSize = Math.max(10, Math.round(fontSize * scale)) + "px";
      if (shape) {
        el.textContent = shape.text || "";
      }
      root.append(el);
      textPrompt = { el, geometry, shapeId: shape ? shape.id : null };
      if (shape) {
        editingTextId = shape.id;
        render();
      }
      el.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          commitTextPrompt();
        }
      });
      el.addEventListener("blur", () => {
        if (textPrompt) {
          commitTextPrompt();
        }
      });
      el.focus();
      if (shape) {
        // Re-edits keep the existing words; put the caret after them.
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }

    function commitTextPrompt() {
      const prompt = textPrompt;
      if (!prompt) {
        return;
      }
      /* oxlint-disable-next-line unicorn/prefer-dom-node-text-content -- the
         prompt keeps Shift+Enter line breaks, and only innerText reports the
         rendered lines a text shape's tspans must reproduce. */
      const value = (prompt.el.innerText || "").replaceAll("\u00A0", " ").trim();
      // Clear the prompt state before detaching the focused node: detaching
      // fires blur synchronously, which re-enters this function and would
      // otherwise remove the node twice (the prototype's NotFoundError).
      textPrompt = null;
      editingTextId = null;
      prompt.el.remove();
      const shape = prompt.shapeId ? item(prompt.shapeId) : null;
      if (shape) {
        if (value && value !== shape.text) {
          patch(shape.id, { text: value });
        } else {
          render();
        }
        return;
      }
      if (!value) {
        return; // empty prompt → no shape
      }
      add("text", { ...prompt.geometry, text: value });
    }

    function cancelTextPrompt() {
      const prompt = textPrompt;
      if (!prompt) {
        return;
      }
      textPrompt = null;
      editingTextId = null;
      prompt.el.remove();
      render();
    }

    function beginTextShapeEdit(shape) {
      if (locked()) {
        return;
      }
      openTextPrompt({ x: shape.x, y: shape.y, width: shape.width }, shape);
    }

    /* ── floating toolbar for the single selected shape ───────────────── */
    function shapeColorInput(shape, key, label) {
      const input = document.createElement("input");
      input.type = "color";
      input.title = label;
      input.setAttribute("aria-label", label);
      input.value = /^#[0-9a-f]{6}$/i.test(shape.style && shape.style[key])
        ? shape.style[key]
        : "#30d158";
      let inChoice = false;
      input.addEventListener("input", () => {
        const live = item(shape.id);
        if (live) {
          // One undo step per color choice, not one per drag step: a
          // picker fires input for every drag tick, and each checkpoint
          // would evict the undo history one tick at a time.
          patch(shape.id, { style: { ...live.style, [key]: input.value } }, !inChoice);
        }
        inChoice = true;
      });
      input.addEventListener("change", () => {
        // The picker closed: the next choice gets its own undo step.
        inChoice = false;
      });
      return input;
    }

    function buildToolbar(shape) {
      const bar = document.createElement("div");
      bar.className = "ec-shape-toolbar";
      bar.dataset.ecToolbar = "true";
      bar.setAttribute("role", "toolbar");
      bar.setAttribute("aria-label", "Shape actions");
      let fill = null;
      if (!["line", "arrow"].includes(shape.type)) {
        fill = shapeColorInput(shape, "fill", shape.type === "text" ? "Text color" : "Fill color");
        bar.append(fill);
      }
      const stroke = shapeColorInput(shape, "stroke", "Stroke color");
      const copy = document.createElement("button");
      copy.type = "button";
      copy.textContent = "Duplicate";
      copy.addEventListener("click", () => duplicate());
      const del = document.createElement("button");
      del.type = "button";
      del.textContent = "Delete";
      del.addEventListener("click", () => remove());
      bar.append(stroke, copy, del);
      return { el: bar, fill, stroke, shapeId: shape.id };
    }

    function removeToolbar() {
      if (toolbar) {
        toolbar.el.remove();
      }
      toolbar = null;
    }

    function positionToolbar(shape) {
      if (!toolbar) {
        return;
      }
      const rect = root.getBoundingClientRect();
      const node = layer.querySelector(`.ec-shape[data-shape-id="${CSS.escape(shape.id)}"]`);
      const box = (node || layer).getBoundingClientRect();
      const width = toolbar.el.offsetWidth || 220;
      const height = toolbar.el.offsetHeight || 40;
      let left = box.left - rect.left + box.width - width + 4;
      let top = box.top - rect.top - height - 8;
      if (top < 2) {
        top = box.top - rect.top + box.height + 8;
      }
      left = Math.max(4, Math.min(left, rect.width - width - 4));
      top = Math.max(2, Math.min(top, rect.height - height - 4));
      toolbar.el.style.left = left + "px";
      toolbar.el.style.top = top + "px";
    }

    function syncToolbar() {
      const shape =
        selected.length === 1 && !selectedComponent && !textPrompt && !locked() ? item() : null;
      const current = shape && shape.type !== "group" ? shape : null;
      if (!current) {
        removeToolbar();
        return;
      }
      if (!toolbar || toolbar.shapeId !== current.id) {
        removeToolbar();
        toolbar = buildToolbar(current);
        root.append(toolbar.el);
      }
      if (toolbar.fill && /^#[0-9a-f]{6}$/i.test(current.style && current.style.fill)) {
        toolbar.fill.value = current.style.fill;
      }
      if (/^#[0-9a-f]{6}$/i.test(current.style && current.style.stroke)) {
        toolbar.stroke.value = current.style.stroke;
      }
      positionToolbar(current);
    }

    function update(event) {
      if (!drag) {
        return;
      }
      if (!drag.committed) {
        checkpoint();
        drag.committed = true;
      }
      const point = pointerPoint(event);
      const dx = point.x - drag.x;
      const dy = point.y - drag.y;
      if (drag.component) {
        const frame = drag.frame;
        state.components[drag.component] ||= {};
        state.components[drag.component].frame =
          drag.kind === "resize"
            ? {
                ...frame,
                width: clamp(frame.width + dx, 0.01, 1 - frame.x),
                height: clamp(frame.height + dy, 0.01, 1 - frame.y),
              }
            : {
                ...frame,
                x: clamp(frame.x + dx, 0, 1 - frame.width),
                y: clamp(frame.y + dy, 0, 1 - frame.height),
              };
        const host = [...root.querySelectorAll(".artifact")].find(
          (candidate) => componentIdentity(candidate) === drag.component,
        );
        if (host && globalThis.ExplainerAuthoring && globalThis.ExplainerAuthoring.applyFrame) {
          globalThis.ExplainerAuthoring.applyFrame(host, state.components[drag.component].frame);
        }
      } else if (drag.kind === "start" || drag.kind === "end") {
        const current = item(drag.ids[0]);
        const before = drag.before.shapes.find((shape) => shape.id === current.id);
        const suffix = drag.kind === "start" ? "1" : "2";
        current[`x${suffix}`] = clamp(before[`x${suffix}`] + dx);
        current[`y${suffix}`] = clamp(before[`y${suffix}`] + dy);
      } else if (drag.kind === "resize" && drag.box) {
        const width = clamp(drag.box.width + dx, 0.001, 1 - drag.box.x);
        const height = clamp(drag.box.height + dy, 0.001, 1 - drag.box.y);
        transformIds(
          drag.ids,
          drag.before,
          0,
          0,
          width / drag.box.width,
          height / drag.box.height,
          drag.box,
        );
      } else {
        const moveX = drag.box ? clamp(dx, -drag.box.x, 1 - drag.box.x - drag.box.width) : dx;
        const moveY = drag.box ? clamp(dy, -drag.box.y, 1 - drag.box.y - drag.box.height) : dy;
        transformIds(drag.ids, drag.before, moveX, moveY);
      }
      render();
    }

    function add(type, initial = {}) {
      if (!TYPES.has(type) || type === "group") {
        return null;
      }
      checkpoint();
      const shape = normalize({
        id: makeId(),
        slide: root.id,
        type,
        x: 0.35,
        y: 0.35,
        width: 0.2,
        height: 0.12,
        ...(type === "line" || type === "arrow" ? { x1: 0.35, y1: 0.41, x2: 0.55, y2: 0.41 } : {}),
        ...(type === "text" ? { text: "Text" } : {}),
        ...initial,
      });
      state.shapes.push(shape);
      selected = [shape.id];
      selectedComponent = null;
      render();
      emit(true);
      return clone(shape);
    }

    function selectComponent(id) {
      selectedComponent = id;
      selected = [];
      render();
      emitSelection();
    }

    function relatedIds(ids) {
      const result = new Set(ids);
      ids.forEach((id) => descendants(id).forEach((shape) => result.add(shape.id)));
      // Detached connectors are independent shapes. Inferring ownership from
      // overlapping bounds can silently remove an unrelated arrow or path.
      return result;
    }

    function detachedRoots() {
      return new Set(
        [
          ...Object.values(state.components),
          ...(state.slides || []).map((slide) => slide.component),
        ]
          .map((component) => component && component.detached && component.detached.root)
          .filter(Boolean),
      );
    }

    function ownershipRoot(shape, roots = detachedRoots()) {
      let current = shape;
      while (current) {
        if (roots.has(current.id)) {
          return current.id;
        }
        current = current.parent ? item(current.parent) : null;
      }
      return "";
    }

    function hasSingleOwner(shapes) {
      const roots = detachedRoots();
      return new Set(shapes.map((shape) => ownershipRoot(shape, roots))).size <= 1;
    }

    function remove(id = null) {
      const requested = id ? [id] : selected;
      if (!requested.length) {
        return false;
      }
      const doomed = relatedIds(requested);
      if (!state.shapes.some((shape) => shape && doomed.has(shape.id))) {
        return false;
      }
      checkpoint();
      const roots = detachedRoots();
      // Keep the invisible ownership root even when its last visual is
      // deleted. It keeps the source suppressed and Reset visual valid.
      state.shapes = state.shapes.filter(
        (shape) => !shape || !doomed.has(shape.id) || roots.has(shape.id),
      );
      selected = [];
      render();
      emit(true);
      return true;
    }

    function patch(id, changes, checkpointEdit = true) {
      const current = item(id);
      if (!current) {
        return false;
      }
      if (checkpointEdit) {
        checkpoint();
      }
      if (current.type === "group" && (changes.style || changes.groupStyle)) {
        leaves(current).forEach((shape) => {
          const groupStyle = changes.groupStyle || {};
          const scoped = {
            ...(shape.type === "text" && groupStyle.text ? { fill: groupStyle.text } : {}),
            ...(shape.type !== "text" && groupStyle.fill ? { fill: groupStyle.fill } : {}),
            ...(groupStyle.stroke ? { stroke: groupStyle.stroke } : {}),
          };
          shape.style = { ...shape.style, ...changes.style, ...scoped };
        });
      } else {
        Object.assign(current, clone(changes));
        normalize(current);
      }
      render();
      // Keep the active inspector input mounted while typing or dragging a
      // slider. Rebuilding selection here drops focus after the first input.
      emit();
      return true;
    }

    function order(delta) {
      if (!selected.length) {
        return false;
      }
      const targets = new Set(selected.flatMap((id) => leaves(item(id))).map((shape) => shape.id));
      const chosen = slideShapes().filter((shape) => targets.has(shape.id));
      if (!chosen.length) {
        return false;
      }
      checkpoint();
      const others = slideShapes().filter(
        (shape) => shape.type !== "group" && !targets.has(shape.id),
      );
      const low = Math.min(...chosen.map((shape) => number(shape.z)));
      const high = Math.max(...chosen.map((shape) => number(shape.z)));
      const candidates = others
        .map((shape) => number(shape.z))
        .filter((z) => (delta > 0 ? z > high : z < low));
      const neighbor = candidates.length
        ? delta > 0
          ? Math.min(...candidates)
          : Math.max(...candidates)
        : delta > 0
          ? high + 1
          : low - 1;
      const offset = delta > 0 ? neighbor - high + 1 : neighbor - low - 1;
      chosen.forEach((shape) => {
        shape.z = number(shape.z) + offset;
      });
      render();
      emit();
      return true;
    }

    function duplicate() {
      if (!selected.length) {
        return false;
      }
      checkpoint();
      const copiedIds = relatedIds(selected);
      const originals = slideShapes().filter((shape) => copiedIds.has(shape.id));
      const unique = [...new Map(originals.map((shape) => [shape.id, shape])).values()];
      const ids = new Map(unique.map((shape) => [shape.id, makeId(shape.type)]));
      const originalBox = combinedBounds(selected);
      const offsetX = originalBox
        ? clamp(0.015, -originalBox.x, 1 - originalBox.x - originalBox.width)
        : 0;
      const offsetY = originalBox
        ? clamp(0.025, -originalBox.y, 1 - originalBox.y - originalBox.height)
        : 0;
      unique.forEach((shape) => {
        const copy = clone(shape);
        copy.id = ids.get(shape.id);
        if (ids.has(copy.parent)) {
          copy.parent = ids.get(copy.parent);
        }
        if (copy.type !== "group") {
          transform(copy, copy, offsetX, offsetY);
        }
        state.shapes.push(copy);
      });
      selected = selected.map((id) => ids.get(id)).filter(Boolean);
      render();
      emit(true);
      return true;
    }

    function group(ids = selected) {
      const members = ids
        .map(item)
        .filter(
          (shape) =>
            shape &&
            !ids.some(
              (id) => id !== shape.id && descendants(id).some((child) => child.id === shape.id),
            ),
        );
      if (members.length < 2) {
        return false;
      }
      // A group has one parent. Reparenting elements from different detached
      // roots would sever one component's Restore ownership, so keep
      // cross-component selection editable but do not offer an invalid group.
      if (!hasSingleOwner(members)) {
        return false;
      }
      const ancestors = (shape) => {
        const result = [];
        let parent = shape.parent;
        while (parent) {
          result.push(parent);
          parent = item(parent).parent;
        }
        return result;
      };
      const lineages = members.map(ancestors);
      const parent = lineages[0].find((id) => lineages.every((lineage) => lineage.includes(id)));
      checkpoint();
      const next = {
        id: makeId("group"),
        slide: root.id,
        type: "group",
        ...(parent ? { parent } : {}),
        z: Math.min(...members.map((shape) => number(shape.z))),
        style: {},
      };
      state.shapes.push(next);
      members.forEach((shape) => {
        shape.parent = next.id;
      });
      selected = [next.id];
      render();
      emit(true);
      return true;
    }

    function ungroup() {
      const current = selected.length === 1 && item();
      if (!current || current.type !== "group" || detachedRoots().has(current.id)) {
        return false;
      }
      checkpoint();
      children(current.id).forEach((shape) => {
        if (current.parent) {
          shape.parent = current.parent;
        } else {
          delete shape.parent;
        }
      });
      state.shapes = state.shapes.filter((shape) => shape.id !== current.id);
      selected = [];
      render();
      emit(true);
      return true;
    }

    /* One scene unit on the 960×540 reference scale is the plain arrow-key
       step; Shift multiplies it by ten. */
    const NUDGE_STEP = { x: 1 / WIDTH, y: 1 / HEIGHT };
    const NUDGE_BURST_MS = 600;
    let nudgeBurstTimer = null;

    function endNudgeBurst() {
      if (nudgeBurstTimer) {
        clearTimeout(nudgeBurstTimer);
      }
      nudgeBurstTimer = null;
    }

    function nudge(id, key, step = 1) {
      const ids = id ? [id] : selected;
      if (!ids.length) {
        return false;
      }
      /* One undo step per gesture burst: the first press of a burst
         checkpoints the pre-burst geometry, every press inside the 600ms
         tail mutates without a new checkpoint, and the tail closing on its
         own starts a fresh burst — so Undo restores a whole nudge burst as
         one step. */
      if (!nudgeBurstTimer) {
        checkpoint();
      }
      clearTimeout(nudgeBurstTimer);
      nudgeBurstTimer = setTimeout(endNudgeBurst, NUDGE_BURST_MS);
      const dx = (key === "ArrowLeft" ? -1 : key === "ArrowRight" ? 1 : 0) * NUDGE_STEP.x * step;
      const dy = (key === "ArrowUp" ? -1 : key === "ArrowDown" ? 1 : 0) * NUDGE_STEP.y * step;
      const box = combinedBounds(ids);
      transformIds(
        ids,
        { shapes: clone(slideShapes()) },
        box ? clamp(dx, -box.x, 1 - box.x - box.width) : dx,
        box ? clamp(dy, -box.y, 1 - box.y - box.height) : dy,
      );
      render();
      emit();
      return true;
    }

    function syncDetachedHosts() {
      [...root.querySelectorAll(".artifact")]
        .filter((host) => host.closest("section") === root)
        .forEach((host) => {
          host.classList.toggle("ec-detached-source", isDetached(host));
        });
    }

    function finish() {
      const changed = Boolean(drag && drag.committed);
      if (drag && root.hasPointerCapture(drag.pointerId)) {
        root.releasePointerCapture(drag.pointerId);
      }
      drag = null;
      if (changed) {
        emit();
      }
    }

    function shortcuts(event) {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== "z" ||
        event.target.closest("input,textarea,select,[contenteditable]")
      ) {
        return;
      }
      const handled = event.shiftKey ? redo() : undo();
      if (handled) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }

    /* ── gesture claiming: armed drawing owns the slide surface ──────────
       The composition layer already covers the section, but kit hosts can
       bleed past it and component chrome listens for click, which
       preventDefault on pointerdown does not suppress. Every draw or select
       gesture therefore swallows the click that trails it. */
    function claimPointerdown(event) {
      if (!armedTool || drawing || locked() || event.button !== 0) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element) || !root.contains(target)) {
        return;
      }
      if (
        target.closest(".ec-shape-toolbar") ||
        target.closest("[data-ec-text-prompt]") ||
        target.closest(".ec-shape, .ec-component-frame, .ec-handle")
      ) {
        return;
      }
      if (textPrompt) {
        // Clicking away commits the open prompt; this click draws nothing.
        swallowClick = true;
        commitTextPrompt();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      swallowClick = true;
      if (selected.length || selectedComponent) {
        selected = [];
        selectedComponent = null;
        render();
        emitSelection();
      }
      startDrawing(event);
    }

    function swallowTrailingClick(event) {
      if (!swallowClick) {
        return;
      }
      swallowClick = false;
      if (
        event.target instanceof Element &&
        (event.target.closest(".ec-shape-toolbar") || event.target.closest("[data-ec-text-prompt]"))
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    }

    function resetSwallow() {
      // The trailing click belongs to the gesture whose pointerdown just
      // ran (this reset is registered first, so the claim handlers still
      // set the flag after it). Captured or cancelled gestures may never
      // fire that click; a fresh pointerdown retires the stale flag so it
      // cannot swallow an unrelated later click.
      swallowClick = false;
    }

    /* Click-away clears the selection: anything that is not the selection,
       its handles or its toolbar — the bare canvas, another slide, page
       chrome — deselects. Studio and Review chrome keeps its own actions
       (the panel's Duplicate and Delete act on the selection), and a
       deselect that lands on the editing section swallows its trailing
       click so kit chrome under the gesture never fires either. */
    function clearAwayFromSelection(event) {
      if (event.button !== 0 || armedTool || drawing || textPrompt || drag || locked()) {
        return;
      }
      if (!selected.length && !selectedComponent) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (
        target.closest(
          "#st-root, #rv-root, .ec-shape, .ec-component-frame, .ec-handle, .ec-shape-toolbar, .ec-text-prompt, [data-ec-text-prompt]",
        )
      ) {
        return;
      }
      if (root.contains(target)) {
        swallowClick = true; // the deselect gesture owns the canvas click.
      }
      selected = [];
      selectedComponent = null;
      render();
      emitSelection();
    }

    /* Delete and the arrow keys follow the live selection, not the focused
       node: a click-selected shape is deletable and nudgeable without a
       second click to focus it, exactly like a slide tool. A focused typing
       surface — an inline edit, the text prompt, any input — always keeps
       its own keys, and arrow keys that land on interactive chrome stay
       with that chrome (the inspector's tab list and segmented controls
       drive them). A selected component frame has no canvas delete: its
       host is the slide's content, deleted (with Undo) as a slide. */
    function selectionKeys(event) {
      if (event.metaKey || event.ctrlKey || event.altKey || textPrompt || drawing || drag) {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      if (target && target.closest("input,textarea,select,[contenteditable]")) {
        return;
      }
      if (locked() || !selected.length) {
        return;
      }
      if (["Delete", "Backspace"].includes(event.key)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        remove();
      } else if (
        event.key.startsWith("Arrow") &&
        // Only surfaces that navigate or adjust with arrows keep them: the
        // inspector's tab list and its segmented controls. A plain button
        // (the shape tool that was just clicked to draw) does not, and the
        // nudge must not fall through the focus it left behind.
        !(
          target &&
          target.closest(
            "[role='tab'],[role='tablist'],[role='radio'],[role='radiogroup']," +
              "[role='listbox'],[role='menu'],[role='menubar'],[role='slider'],[role='spinbutton']",
          )
        )
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        nudge(null, event.key, event.shiftKey ? 10 : 1);
      }
    }

    /* Escape is layered and total, one layer per press, so a composition
       lifecycle is never cut down mid-flight by a page-level handler:
       an open text prompt cancels first; then an in-progress drawing
       gesture cancels (the tool stays armed to retry); then an armed tool
       disarms; then an open selection with its toolbar clears. Only when
       no layer is live does Escape pass through untouched. Every handled
       layer stops the event at this capture listener so no window-level
       Studio handler can act on the same press. */
    function escapeLayers(event) {
      if (event.key !== "Escape") {
        return;
      }
      if (
        event.target instanceof Element &&
        event.target.closest("input,textarea,select,[contenteditable]") &&
        (!textPrompt || event.target !== textPrompt.el)
      ) {
        return; // another surface's own edit keeps its Escape handling.
      }
      if (textPrompt) {
        event.preventDefault();
        event.stopPropagation();
        cancelTextPrompt();
        return;
      }
      if (drawing) {
        event.preventDefault();
        event.stopPropagation();
        cancelDrawing();
        return;
      }
      if (armedTool) {
        event.preventDefault();
        event.stopPropagation();
        setArmedTool(null);
        return;
      }
      if (selected.length || selectedComponent || toolbar) {
        event.preventDefault();
        event.stopPropagation();
        selected = [];
        selectedComponent = null;
        render();
        emitSelection();
      }
    }

    root.addEventListener("pointermove", update);
    root.addEventListener("pointerup", finish);
    root.addEventListener("pointercancel", finish);
    root.addEventListener("pointermove", moveDrawing);
    root.addEventListener("pointerup", endDrawing);
    root.addEventListener("pointercancel", cancelDrawing);
    document.addEventListener("keydown", shortcuts, true);
    document.addEventListener("pointerdown", resetSwallow, true);
    document.addEventListener("pointerdown", claimPointerdown, true);
    document.addEventListener("pointerdown", clearAwayFromSelection, true);
    document.addEventListener("click", swallowTrailingClick, true);
    document.addEventListener("keydown", escapeLayers, true);
    document.addEventListener("keydown", selectionKeys, true);
    syncDetachedHosts();
    render();
    const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(render) : null;
    if (resizeObserver) {
      resizeObserver.observe(root);
    }

    return {
      manifest: () => clone(state),
      add,
      select,
      selectComponent,
      remove,
      patch,
      nudge,
      duplicate,
      group,
      ungroup,
      undo,
      redo,
      armTool,
      disarmTool,
      armedTool: () => armedTool,
      canUndo: () => history.length > 0,
      canRedo: () => future.length > 0,
      bringForward: () => order(1),
      sendBackward: () => order(-1),
      render,
      destroy() {
        cancelTextPrompt();
        commitDrawing(false);
        removeToolbar();
        swallowClick = false;
        setArmedTool(null);
        endNudgeBurst();
        finish();
        if (resizeObserver) {
          resizeObserver.disconnect();
        }
        root.querySelectorAll(".ec-detached-source").forEach((host) => {
          host.classList.remove("ec-detached-source");
        });
        root.classList.remove("ec-editing");
        layer.remove();
        root.removeEventListener("pointermove", update);
        root.removeEventListener("pointerup", finish);
        root.removeEventListener("pointercancel", finish);
        root.removeEventListener("pointermove", moveDrawing);
        root.removeEventListener("pointerup", endDrawing);
        root.removeEventListener("pointercancel", cancelDrawing);
        document.removeEventListener("keydown", shortcuts, true);
        document.removeEventListener("pointerdown", resetSwallow, true);
        document.removeEventListener("pointerdown", claimPointerdown, true);
        document.removeEventListener("pointerdown", clearAwayFromSelection, true);
        document.removeEventListener("click", swallowTrailingClick, true);
        document.removeEventListener("keydown", escapeLayers, true);
        document.removeEventListener("keydown", selectionKeys, true);
      },
    };
  }

  api.create = create;
})();
