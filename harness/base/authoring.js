/* Optional deterministic authoring layer for assembled explainers. */
(function () {
  "use strict";
  if (globalThis.ExplainerAuthoring && globalThis.ExplainerAuthoring.version === 2) {
    return;
  }
  const api = (globalThis.ExplainerAuthoring = globalThis.ExplainerAuthoring || {});
  api.version = 2;
  const clone = (value) => structuredClone(value);
  const SCENE_WIDTH = 960;
  const SCENE_HEIGHT = 540;
  const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
  const number = (value, fallback = 0) =>
    Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, number(value)));
  const query = (selector, root = document) => {
    try {
      return root.querySelector(selector);
    } catch {
      return null;
    }
  };
  const color = (value, fallback) => {
    if (typeof value !== "string" || /[<>;]/.test(value) || value.length > 120) {
      return fallback;
    }
    return value;
  };
  const INSERTED_SLIDE_PREFIX = "ea-slide-";
  const renderers = Object.freeze({
    roadmap: "renderRoadmap",
    architecture: "renderArchitecture",
    "operating-model": "renderArchitecture",
    sequence: "renderSequence",
    erd: "renderErd",
    stack: "renderStack",
    trace: "renderTrace",
    chart: "renderChart",
    flow: "renderFlow",
    table: "renderTable",
    tree: "renderTree",
    loop: "renderLoop",
    stepper: "renderStepper",
    code: "renderCode",
    iceberg: "renderIceberg",
    pyramid: "renderPyramid",
  });
  const insertedSlides = new Map();
  const renderedComponents = new WeakMap();
  const detachedComponents = new WeakMap();
  const detachedHosts = new Set();
  const compactIdentity = (value) => {
    value = String(value || "component");
    if (value.length <= 52) {
      return value;
    }
    let hash = 2_166_136_261;
    for (let index = 0; index < value.length; index++) {
      hash ^= value.codePointAt(index);
      hash = Math.imul(hash, 16_777_619);
    }
    return `${value.slice(0, 40)}~${Math.trunc(hash).toString(36)}`;
  };
  const identity = (host) => {
    if (!host) {
      return "";
    }
    if (host.id) {
      return compactIdentity(`#${host.id}`);
    }
    const section = host.closest ? host.closest("section[id]") : null;
    const scope = section || document;
    const index = [...scope.querySelectorAll(".artifact")].indexOf(host);
    if (index !== -1) {
      return compactIdentity(`${section ? `#${section.id}` : "page"}/artifact:${index + 1}`);
    }
    const path = [];
    let node = host;
    while (node && node !== scope && node.parentElement) {
      path.unshift(
        `${node.tagName.toLowerCase()}:${
          Array.prototype.indexOf.call(node.parentElement.children, node) + 1
        }`,
      );
      node = node.parentElement;
    }
    return compactIdentity(`${section ? `#${section.id}` : "page"}/${path.join("/")}`);
  };
  function applyTokens(tokens) {
    if (!tokens || typeof tokens !== "object") {
      return;
    }
    const docStyle = document.documentElement.style;
    docStyle.setProperty("--rv-font-scale", String((tokens.font_pct || 100) / 100));
    docStyle.setProperty("--content-space-scale", String(tokens.space_scale || 1));
    docStyle.fontSize =
      tokens.font_pct != null && tokens.font_pct !== 100 ? `${tokens.font_pct}%` : "";
    if (tokens.measure) {
      docStyle.setProperty("--measure", tokens.measure);
    } else {
      docStyle.removeProperty("--measure");
    }
    if (tokens.accent_mode === "safe" || tokens.accent_mode === "contrast") {
      document.documentElement.dataset.accentMode = tokens.accent_mode;
      delete document.documentElement.dataset.accentPreset;
      docStyle.removeProperty("--accent");
      docStyle.removeProperty("--accent-dim");
    } else if (tokens.accent_preset === "adyen") {
      delete document.documentElement.dataset.accentMode;
      document.documentElement.dataset.accentPreset = "adyen";
      docStyle.removeProperty("--accent");
      docStyle.removeProperty("--accent-dim");
    } else {
      delete document.documentElement.dataset.accentMode;
      delete document.documentElement.dataset.accentPreset;
      if (tokens.accent) {
        docStyle.setProperty("--accent", tokens.accent);
        docStyle.setProperty("--accent-dim", `${tokens.accent}33`);
      } else {
        docStyle.removeProperty("--accent");
        docStyle.removeProperty("--accent-dim");
      }
    }
  }
  /* Paint one text-override value into its target element. Values may carry
     the passive-inline allowlist (b, code, em, br) the inline editor
     serializes; those render as real elements so saved markup stays styled
     after reload and reassembly. Anything outside the allowlist — a
     hand-edited manifest, a stray tag — stays literal text: the value is
     never trusted as HTML, so no raw innerHTML path exists. */
  function paintTextOverride(target, value) {
    const source = String(value == null ? "" : value);
    const tags = /<\/?(?:b|code|em|br)>/gi;
    const stack = [target];
    let offset = 0;
    target.replaceChildren();
    source.replaceAll(tags, (token, at) => {
      if (at > offset) {
        stack.at(-1).append(document.createTextNode(source.slice(offset, at)));
      }
      const closing = token.startsWith("</");
      const tag = token.match(/^<\/?([a-z]+)/i)[1].toLowerCase();
      if (!closing) {
        const child = document.createElement(tag);
        stack.at(-1).append(child);
        if (tag !== "br") {
          stack.push(child);
        }
      } else if (stack.length > 1 && stack.at(-1).localName === tag) {
        stack.pop();
      } else {
        stack.at(-1).append(document.createTextNode(token));
      }
      offset = at + token.length;
      return token;
    });
    if (offset < source.length) {
      stack.at(-1).append(document.createTextNode(source.slice(offset)));
    }
    return target;
  }
  function applyText(edits) {
    if (!Array.isArray(edits)) {
      return;
    }
    edits.forEach((edit) => {
      if (!edit || typeof edit.target !== "string" || typeof edit.value !== "string") {
        return;
      }
      const target = query(edit.target);
      // The before guard compares flattened text, exactly what a serialized
      // markup value collapses to, so a styled block still matches its
      // original wording before the override paints the new markup in.
      if (target && (edit.before == null || target.textContent === String(edit.before))) {
        paintTextOverride(target, edit.value);
      }
    });
  }
  function releaseComponentHost(host) {
    renderedComponents.delete(host);
    if (typeof host.__kitDispose === "function") {
      host.__kitDispose();
    }
    host.__kitDispose = null;
    ["__kitSwappable", "__kitMotionAdjustable"].forEach((key) => {
      const entries = globalThis[key];
      if (!Array.isArray(entries)) {
        return;
      }
      for (let index = entries.length - 1; index >= 0; index--) {
        if (entries[index].host === host) {
          entries.splice(index, 1);
        }
      }
    });
  }
  function replacePresentationDriver(host, driver) {
    const present = globalThis.__present;
    if (present && typeof present.replaceComponentSteps === "function") {
      present.replaceComponentSteps(host, driver);
    }
  }
  function semanticComponentRecord(record) {
    const semantic = clone(record || {});
    delete semantic.detached;
    return semantic;
  }
  function suppressComponentHost(host, record) {
    if (!host) {
      return;
    }
    const existing = detachedComponents.get(host);
    if (existing) {
      existing.semantic = semanticComponentRecord(record);
      return;
    }
    detachedComponents.set(host, {
      visibility: host.style.visibility,
      ariaHidden: host.getAttribute("aria-hidden"),
      semantic: semanticComponentRecord(record),
    });
    detachedHosts.add(host);
    releaseComponentHost(host);
    replacePresentationDriver(host, null);
    host.style.visibility = "hidden";
    host.setAttribute("aria-hidden", "true");
    host.dataset.authoringDetached = "true";
  }
  function restoreComponentHost(host) {
    const previous = host && detachedComponents.get(host);
    if (!previous) {
      return false;
    }
    host.style.visibility = previous.visibility;
    if (previous.ariaHidden == null) {
      host.removeAttribute("aria-hidden");
    } else {
      host.setAttribute("aria-hidden", previous.ariaHidden);
    }
    delete host.dataset.authoringDetached;
    detachedComponents.delete(host);
    detachedHosts.delete(host);
    return true;
  }
  function renderComponentData(host, component) {
    const rendererName = component && renderers[component.kind];
    const renderer = rendererName && globalThis[rendererName];
    if (!host || typeof renderer !== "function" || !component.data) {
      throw new Error("That component cannot be rendered from editable data.");
    }
    releaseComponentHost(host);
    // Ordinary layout changes retain the authored base. A content edit must
    // instead register the new base and discard closures over the old data.
    delete host.__kitAdjustments;
    delete host.__kitSwapState;
    delete host.__kitBase;
    delete host.__kitCanvas;
    // A canvas-editable component prefers the copies it left on the host over
    // the data it is handed, so an edit to that data would otherwise never
    // reach the page. The record's own canvas edits are restored below.
    delete host.__kitOperatingSource;
    delete host.__kitCanvasEdits;
    const data = clone(component.data);
    if (component.kind === "operating-model" && !data.preset) {
      data.preset = "operating-model";
    }
    if (component.canvas) {
      // Inserted components own a raw record; source overrides use an envelope.
      data.canvasEdits = clone(component.canvas.record || component.canvas);
    }
    const driver = renderer(host, data);
    replacePresentationDriver(host, driver);
    renderedComponents.set(
      host,
      JSON.stringify([component.kind, component.data, component.canvas]),
    );
    return driver;
  }
  function applyComponents(components) {
    if (!components || typeof components !== "object") {
      return;
    }
    const componentRecords = new Map(Object.entries(components));
    detachedHosts.forEach((host) => {
      if (!componentRecords.has(identity(host))) {
        const previous = detachedComponents.get(host);
        restoreComponentHost(host);
        if (previous && previous.semantic.kind && previous.semantic.data) {
          applyComponentRecord(host, previous.semantic);
        }
      }
    });
    const entries = Array.isArray(window.__kitSwappable) ? window.__kitSwappable : [];
    const hosts = [...document.querySelectorAll(".artifact")];
    Object.entries(components).forEach(([key, record]) => {
      const entry = entries.find((candidate) => identity(candidate.host) === key);
      const host = entry ? entry.host : hosts.find((candidate) => identity(candidate) === key);
      if (!host || !record) {
        return;
      }
      applyComponentRecord(host, record, entry);
    });
  }
  function applyComponentRecord(host, record, knownEntry) {
    if (record.frame && host && host.style) {
      applyFrame(host, record.frame);
    }
    if (record.detached && record.detached.root) {
      suppressComponentHost(host, record);
      return;
    }
    restoreComponentHost(host);
    if (record.kind && record.data) {
      const signature = JSON.stringify([record.kind, record.data, record.canvas]);
      if (renderedComponents.get(host) !== signature) {
        renderComponentData(host, record);
      }
      knownEntry = null;
    }
    const entries = Array.isArray(window.__kitSwappable) ? window.__kitSwappable : [];
    const entry = knownEntry || entries.find((candidate) => candidate.host === host);
    Object.entries(record.settings || {}).forEach(([option, value]) => {
      if (entry && typeof entry.set === "function") {
        try {
          entry.set(option, value);
        } catch {
          /* A stale component option must not prevent later edits from applying. */
        }
      }
    });
    const canvas = record.canvas;
    if (
      canvas &&
      canvas.kind &&
      canvas.record &&
      host.__kitCanvas &&
      (host.__kitCanvas.kind || "architecture") === canvas.kind &&
      typeof host.__kitCanvas.apply === "function"
    ) {
      try {
        host.__kitCanvas.apply(clone(canvas.record));
      } catch {
        /* A stale canvas record must not prevent other saved edits from applying. */
      }
    }
  }
  function applyFrame(host, frame) {
    const section = host.closest("section") || host.parentElement;
    if (!section) {
      return;
    }
    section.style.position ||= "relative";
    host.style.position = "absolute";
    const x = clamp(frame.x);
    const y = clamp(frame.y);
    const width = Math.min(clamp(frame.width, 0.01), 1 - x);
    const height = Math.min(clamp(frame.height, 0.01), 1 - y);
    host.style.left = `${x * 100}%`;
    host.style.top = `${y * 100}%`;
    host.style.width = `${width * 100}%`;
    host.style.height = `${height * 100}%`;
    host.style.rotate = frame.rotation ? `${number(frame.rotation)}deg` : "";
  }
  function styleShape(node, style = {}) {
    if (style.fill != null) {
      node.setAttribute("fill", color(style.fill, "transparent"));
    }
    if (style.stroke != null) {
      node.setAttribute("stroke", color(style.stroke, "currentColor"));
    }
    if (style.strokeWidth != null) {
      node.setAttribute("stroke-width", String(number(style.strokeWidth)));
    }
    if (style.opacity != null) {
      node.setAttribute("opacity", String(number(style.opacity, 1)));
    }
    if (style.strokeLinecap != null) {
      node.setAttribute("stroke-linecap", String(style.strokeLinecap));
    }
    if (style.strokeLinejoin != null) {
      node.setAttribute("stroke-linejoin", String(style.strokeLinejoin));
    }
    if (style.fontFamily != null) {
      node.setAttribute("font-family", String(style.fontFamily));
    }
    if (style.fontWeight != null) {
      node.setAttribute("font-weight", String(style.fontWeight));
    }
    if (style.fontStyle != null) {
      node.setAttribute("font-style", String(style.fontStyle));
    }
    if (style.letterSpacing != null) {
      node.setAttribute("letter-spacing", String(number(style.letterSpacing)));
    }
  }
  function sceneViewport(section) {
    const rect = section.getBoundingClientRect();
    const scale = Math.max(0.001, Math.min(rect.width / SCENE_WIDTH, rect.height / SCENE_HEIGHT));
    const width = rect.width > 0 ? rect.width / scale : SCENE_WIDTH;
    const height = rect.height > 0 ? rect.height / scale : SCENE_HEIGHT;
    return {
      width,
      height,
      x: (value) => number(value) * width,
      y: (value) => number(value) * height,
    };
  }
  function shapeCenter(shape, { x: sceneX, y: sceneY }) {
    if (shape.type === "line" || shape.type === "arrow") {
      return [
        sceneX((number(shape.x1) + number(shape.x2)) / 2),
        sceneY((number(shape.y1) + number(shape.y2)) / 2),
      ];
    }
    const points = Array.isArray(shape.points) ? shape.points : [];
    if (shape.type === "path" && points.length >= 2) {
      const xs = points.filter((_, index) => index % 2 === 0).map(sceneX);
      const ys = points.filter((_, index) => index % 2 === 1).map(sceneY);
      return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    }
    return [
      sceneX(number(shape.x) + number(shape.width) / 2),
      sceneY(number(shape.y) + number(shape.height) / 2),
    ];
  }
  function pathData(shape, { x: sceneX, y: sceneY }) {
    const points = Array.isArray(shape.points) ? shape.points : [];
    const pairs = [];
    for (let index = 0; index + 1 < points.length; index += 2) {
      pairs.push(`${sceneX(points[index])} ${sceneY(points[index + 1])}`);
    }
    if (!pairs.length) {
      return "";
    }
    return `M${pairs.join("L")}${shape.closed ? "Z" : ""}`;
  }
  function renderText(node, shape, { x: sceneX, y: sceneY }) {
    const x = sceneX(shape.x);
    const y = sceneY(shape.y);
    const style = shape.style || {};
    const fontSize = number(style.fontSize, 24);
    const alignment = style.textAlign || "left";
    const anchor = alignment === "center" ? "middle" : alignment === "right" ? "end" : "start";
    const anchorX =
      anchor === "middle"
        ? x + sceneX(shape.width) / 2
        : anchor === "end"
          ? x + sceneX(shape.width)
          : x;
    node.setAttribute("x", anchorX);
    node.setAttribute("y", y);
    node.setAttribute("dominant-baseline", "hanging");
    node.setAttribute("font-size", fontSize);
    node.setAttribute("text-anchor", anchor);
    String(shape.text || "")
      .split("\n")
      .forEach((line, index) => {
        const span = document.createElementNS(SVG_NAMESPACE, "tspan");
        span.setAttribute("x", anchorX);
        span.setAttribute("dy", index === 0 ? "0" : `${fontSize * number(style.lineHeight, 1.2)}`);
        span.textContent = line;
        node.append(span);
      });
  }
  function renderShapeNode(shape, markerId, viewport) {
    const { x: sceneX, y: sceneY } = viewport;
    if (shape.type === "group") {
      const group = document.createElementNS(SVG_NAMESPACE, "g");
      group.dataset.authoringId = String(shape.id || "");
      return group;
    }
    const tag = shape.type === "arrow" ? "line" : shape.type;
    const node = document.createElementNS(SVG_NAMESPACE, tag);
    node.dataset.authoringId = String(shape.id || "");
    if (shape.type === "line" || shape.type === "arrow") {
      node.setAttribute("x1", sceneX(shape.x1));
      node.setAttribute("y1", sceneY(shape.y1));
      node.setAttribute("x2", sceneX(shape.x2));
      node.setAttribute("y2", sceneY(shape.y2));
    } else if (shape.type === "path") {
      node.setAttribute("d", pathData(shape, viewport));
      node.setAttribute("fill", "none");
      node.setAttribute("stroke", "currentColor");
    } else if (shape.type === "ellipse") {
      node.setAttribute("cx", sceneX(number(shape.x) + number(shape.width) / 2));
      node.setAttribute("cy", sceneY(number(shape.y) + number(shape.height) / 2));
      node.setAttribute("rx", sceneX(shape.width) / 2);
      node.setAttribute("ry", sceneY(shape.height) / 2);
    } else if (shape.type === "text") {
      renderText(node, shape, viewport);
    } else {
      node.setAttribute("x", sceneX(shape.x));
      node.setAttribute("y", sceneY(shape.y));
      node.setAttribute("width", sceneX(shape.width));
      node.setAttribute("height", sceneY(shape.height));
      if (shape.style && shape.style.radius) {
        node.setAttribute(
          "rx",
          Math.min(sceneX(shape.width), sceneY(shape.height)) * shape.style.radius,
        );
      }
    }
    const rotation = number(shape.rotation, number(shape.style && shape.style.rotation));
    if (rotation) {
      const [centerX, centerY] = shapeCenter(shape, viewport);
      node.setAttribute("transform", `rotate(${rotation} ${centerX} ${centerY})`);
    }
    if (shape.type === "arrow" || (shape.style && shape.style.endArrow)) {
      node.setAttribute("marker-end", `url(#${markerId})`);
    }
    if (shape.style && shape.style.startArrow) {
      node.setAttribute("marker-start", `url(#${markerId})`);
    }
    styleShape(node, shape.style);
    if (shape.type !== "text") {
      node.setAttribute("vector-effect", "non-scaling-stroke");
    }
    return node;
  }
  const shapeObservers = [];
  function renderShapes(shapes = []) {
    shapeObservers.splice(0).forEach((observer) => observer.disconnect());
    document.querySelectorAll(".ea-shape-layer").forEach((layer) => layer.remove());
    if (!Array.isArray(shapes)) {
      return [];
    }
    const layers = new Map();
    const bySection = new Map();
    shapes.forEach((shape) => {
      if (!shape || !shape.slide) {
        return;
      }
      const section = query(`#${CSS.escape(shape.slide)}`);
      if (!section) {
        return;
      }
      const records = bySection.get(section) || [];
      records.push(shape);
      bySection.set(section, records);
    });
    bySection.forEach((records, section) => {
      const layer = document.createElementNS(SVG_NAMESPACE, "svg");
      layer.classList.add("ea-shape-layer");
      layer.style.pointerEvents = "none";
      section.style.position ||= "relative";
      layer.style.position = "absolute";
      layer.style.inset = "0";
      layer.style.width = "100%";
      layer.style.height = "100%";
      layer.style.zIndex = "1";
      layer.setAttribute("aria-hidden", "true");
      layer.setAttribute("preserveAspectRatio", "xMidYMid meet");
      const defs = document.createElementNS(SVG_NAMESPACE, "defs");
      const marker = document.createElementNS(SVG_NAMESPACE, "marker");
      marker.id = `ea-arrowhead-${layers.size}`;
      marker.setAttribute("markerWidth", "8");
      marker.setAttribute("markerHeight", "8");
      marker.setAttribute("refX", "8");
      marker.setAttribute("refY", "4");
      marker.setAttribute("orient", "auto-start-reverse");
      marker.setAttribute("markerUnits", "userSpaceOnUse");
      const tip = document.createElementNS(SVG_NAMESPACE, "path");
      tip.setAttribute("d", "M0 0L8 4L0 8z");
      tip.setAttribute("fill", "context-stroke");
      marker.append(tip);
      defs.append(marker);
      layer.append(defs);
      section.append(layer);
      layers.set(section, layer);
      // Groups own editor selection, not a second stacking context. Match the
      // editor's slide-wide z order so save/reload cannot reorder the visual.
      const ordered = records
        .filter((shape) => shape.type !== "group")
        .toSorted((a, b) => number(a.z) - number(b.z));
      const draw = () => {
        const viewport = sceneViewport(section);
        layer.setAttribute("viewBox", `0 0 ${viewport.width} ${viewport.height}`);
        layer.replaceChildren(
          defs,
          ...ordered.map((shape) => renderShapeNode(shape, marker.id, viewport)),
        );
      };
      draw();
      if (typeof ResizeObserver === "function") {
        const observer = new ResizeObserver(draw);
        observer.observe(section);
        shapeObservers.push(observer);
      }
    });
    return [...layers.values()];
  }
  function insertedSlideId(slide) {
    return `${INSERTED_SLIDE_PREFIX}${slide.id}`;
  }
  function findSlide(slideId) {
    return query(`#${CSS.escape(`${INSERTED_SLIDE_PREFIX}${slideId}`)}`);
  }
  function targetSection(before) {
    const target = query(`#${CSS.escape(before)}`);
    if (!target) {
      return null;
    }
    return target.localName === "section" ? target : undefined;
  }
  function placeInsertedSlide(section, target) {
    if (target === undefined) {
      throw new Error("The requested before target is not a slide section.");
    }
    if (target) {
      target.before(section);
      return target;
    }
    const shell = query(".shell");
    if (!shell) {
      throw new Error("The explainer shell is unavailable for an inserted slide.");
    }
    // A missing `before` target is explicitly safe: append inside the deck,
    // rather than guessing a different authored element.
    shell.append(section);
    return section;
  }
  function presentInsertedSlide(section, target, driver) {
    const present = globalThis.__present;
    if (!present || typeof present.insertPreviewBefore !== "function") {
      return "";
    }
    return present.insertPreviewBefore(
      {
        pick: [`#${section.id}`],
        layout: "diagram",
        steps: driver && typeof driver.go === "function" ? driver : undefined,
      },
      target || section,
    );
  }
  function errorSlide(slide, message, target) {
    const section = document.createElement("section");
    section.className = "ea-authored-slide ea-authored-slide-error";
    section.dataset.authoringSlide = String(slide.id || "");
    const heading = document.createElement("h2");
    heading.textContent = String(slide.title || "Inserted slide");
    const detail = document.createElement("p");
    detail.textContent = `This inserted component could not render: ${message}`;
    section.append(heading, detail);
    try {
      placeInsertedSlide(section, target);
    } catch {
      document.body.append(section);
    }
    return section;
  }
  function renderInsertedSlide(slide, strict = false) {
    const target = targetSection(slide.before);
    const sectionId = insertedSlideId(slide);
    if (query(`#${CSS.escape(sectionId)}`)) {
      if (strict) {
        throw new Error("Its generated slide ID collides with existing content.");
      }
      return errorSlide(slide, "Its generated slide ID collides with existing content.", target);
    }
    const section = document.createElement("section");
    section.id = sectionId;
    section.className = "ea-authored-slide";
    section.dataset.authoringSlide = slide.id;
    const heading = document.createElement("h2");
    heading.className = "ea-authored-slide-title";
    heading.textContent = slide.title;
    const host = document.createElement("div");
    host.className = "artifact ea-authored-slide-artifact";
    host.id = `${sectionId}-host`;
    host.dataset.authoringComponent = slide.id;
    section.append(heading, host);
    let presentTarget;
    try {
      presentTarget = placeInsertedSlide(section, target);
      const component = slide.component || {};
      const rendererName = renderers[component.kind];
      const renderer = globalThis[rendererName];
      if (typeof renderer !== "function") {
        throw new TypeError("Its allowlisted renderer is unavailable in this assembled page.");
      }
      const data = clone(component.data || {});
      if (component.kind === "operating-model" && !data.preset) {
        data.preset = "operating-model";
      }
      if (component.canvas) {
        data.canvasEdits = clone(component.canvas);
      }
      const driver = renderer(host, data);
      applyComponentRecord(host, {
        detached: component.detached,
        settings: component.settings,
        frame: component.frame,
      });
      const token = presentInsertedSlide(
        section,
        presentTarget,
        component.detached ? undefined : driver,
      );
      insertedSlides.set(slide.id, { section, token });
      return section;
    } catch (error) {
      disposeInsertedSlide(section);
      if (strict) {
        throw error;
      }
      return errorSlide(
        slide,
        error instanceof Error ? error.message : "Unknown renderer error.",
        target,
      );
    }
  }
  function clearInsertedSlides() {
    const present = globalThis.__present;
    if (present && typeof present.state === "function" && present.state().presenting) {
      return false;
    }
    insertedSlides.forEach(({ section, token }) => {
      if (token && present && typeof present.removePreview === "function") {
        present.removePreview(token);
      }
      disposeInsertedSlide(section);
    });
    insertedSlides.clear();
    document.querySelectorAll(".ea-authored-slide-error").forEach((section) => section.remove());
    return true;
  }
  function sourceSections() {
    const shell = query(".shell");
    return shell
      ? [...shell.children].filter(
          (node) => node.localName === "section" && !node.dataset.authoringSlide,
        )
      : [];
  }
  function applySourceSlides(records, order) {
    if (!Array.isArray(records)) {
      return;
    }
    const sections = sourceSections();
    const byId = new Map(sections.map((section) => [section.id, section]));
    const hidden = new Map(
      records
        .filter((record) => record && typeof record.id === "string")
        .map((record) => [record.id, record.hidden === true]),
    );
    sections.forEach((section) => {
      if (!hidden.has(section.id)) {
        return;
      }
      const shouldHide = hidden.get(section.id);
      if (shouldHide) {
        section.hidden = true;
        section.dataset.authoringHidden = "true";
      } else if (section.dataset.authoringHidden === "true") {
        section.hidden = false;
        delete section.dataset.authoringHidden;
      }
      const present = globalThis.__present;
      if (present && typeof present.setSectionHidden === "function") {
        present.setSectionHidden(section, shouldHide);
      }
    });
    if (!Array.isArray(order) || !order.length) {
      return;
    }
    const ordered = order
      .map((id) => byId.get(id) || query(`#${CSS.escape(id)}`))
      .filter(
        (section) => section && (section.dataset.authoringSlide || sections.includes(section)),
      );
    const seen = new Set(ordered);
    sections.forEach((section) => {
      if (!seen.has(section)) {
        ordered.push(section);
      }
    });
    const marker = document.createComment("Explainer source slide order");
    const shell = query(".shell");
    if (!shell || !ordered.length) {
      return;
    }
    shell.insertBefore(marker, sections[0]);
    ordered.forEach((section) => marker.before(section));
    marker.remove();
    const present = globalThis.__present;
    if (present && typeof present.reorderSections === "function") {
      present.reorderSections(ordered);
    }
  }
  function disposeInsertedSlide(section) {
    section.querySelectorAll(".artifact").forEach((host) => {
      restoreComponentHost(host);
      releaseComponentHost(host);
    });
    section.remove();
  }
  function renderInsertedSlides(slides, strict = false) {
    if (!Array.isArray(slides) || !clearInsertedSlides()) {
      return [];
    }
    return slides.map((slide) => {
      try {
        return renderInsertedSlide(slide, strict);
      } catch (error) {
        if (strict) {
          throw error;
        }
        return null;
      }
    });
  }
  api.identity = identity;
  api.paintInline = paintTextOverride;
  function emptyManifest() {
    return {
      version: 2,
      text: [],
      tokens: {},
      components: {},
      shapes: [],
      slides: [],
      sourceSlides: [],
      order: [],
    };
  }
  function migrateManifest(manifest) {
    if (manifest == null) {
      return emptyManifest();
    }
    const source = clone(manifest);
    if (source.version === 1) {
      source.version = 2;
    } else if (source.version !== 2) {
      throw new RangeError("This page uses an unsupported Explainer authoring version.");
    }
    const defaults = emptyManifest();
    Object.entries(defaults).forEach(([key, value]) => {
      if (source[key] == null) {
        source[key] = clone(value);
      }
    });
    return source;
  }
  api.read = migrateManifest;
  api.migrate = migrateManifest;
  api.renderShapes = renderShapes;
  api.sceneSize = Object.freeze({ width: SCENE_WIDTH, height: SCENE_HEIGHT });
  api.sceneViewport = sceneViewport;
  api.isDetached = (host) => detachedComponents.has(host);
  api.releaseComponent = releaseComponentHost;
  api.renderComponent = renderComponentData;
  api.applyFrame = applyFrame;
  api.findSlide = findSlide;
  api.refreshSlides = (slides = current.slides) => renderInsertedSlides(slides);
  let current = api.read();
  api.apply = (manifest, { strict = false } = {}) => {
    const source = api.read(manifest);
    current = source;
    renderInsertedSlides(source.slides, strict);
    applySourceSlides(source.sourceSlides, source.order);
    applyTokens(source.tokens);
    applyComponents(source.components);
    applyText(source.text);
    renderShapes(source.shapes);
    return source;
  };
  window.addEventListener("kitcomponentchange", () => applyText(current.text));
  if (globalThis.__explainerAuthoring) {
    try {
      api.apply(globalThis.__explainerAuthoring);
    } catch {
      /* optional authoring state */
    }
  }
})();
