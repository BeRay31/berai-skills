/* Offline, Studio-only export from the portable authoring scene to PPTX.
 *
 * The exporter reads rendered slides but never edits the authoring manifest.
 * Portable content is translated into native presentation objects so the PPTX
 * can be imported into Google Slides. Supported effects may use documented
 * approximations; unsupported content fails the whole export before download.
 */
(function () {
  "use strict";

  const SLIDE_WIDTH = 13.333333;
  const SLIDE_HEIGHT = 7.5;
  const MAX_SLIDES = 100;
  const MAX_OBJECTS = 10_000;
  const MAX_IMAGE_BYTES = 8_000_000;
  const MAX_DECK_IMAGE_BYTES = 32_000_000;
  const CAPTURE_EXCLUDE = [
    ".artifact",
    ".ea-shape-layer",
    ".ec-composition-layer",
    ".rv-pin",
    ".st-adjust",
    ".st-swap",
  ].join(",");

  class ExportError extends Error {
    constructor(message, details = []) {
      super(message);
      this.name = "ExportError";
      this.details = details;
    }
  }

  const finite = (value, fallback = 0) =>
    Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, finite(value)));
  const x = (value) => clamp(value) * SLIDE_WIDTH;
  const y = (value) => clamp(value) * SLIDE_HEIGHT;
  const width = (value) => Math.max(0.001, clamp(value) * SLIDE_WIDTH);
  const height = (value) => Math.max(0.001, clamp(value) * SLIDE_HEIGHT);

  function rgba(value) {
    const source = String(value || "").trim();
    if (!source || source === "none" || source === "transparent") {
      return { color: "FFFFFF", alpha: 0 };
    }
    const hex = source.match(/^#([0-9a-f]{3,8})$/i);
    if (hex) {
      let digits = hex[1];
      if (digits.length === 3 || digits.length === 4) {
        digits = [...digits].map((part) => part + part).join("");
      }
      return {
        color: digits.slice(0, 6).toUpperCase(),
        alpha: digits.length === 8 ? Number.parseInt(digits.slice(6), 16) / 255 : 1,
      };
    }
    const rgb = source.match(/^rgba?\(([^)]+)\)$/i);
    if (rgb) {
      const parts = rgb[1].split(/[\s,/]+/).filter(Boolean);
      const channel = (part) =>
        Math.round(
          String(part).endsWith("%")
            ? clamp(Number.parseFloat(part) / 100) * 255
            : clamp(Number.parseFloat(part), 0, 255),
        );
      const alpha =
        parts.length > 3
          ? String(parts[3]).endsWith("%")
            ? clamp(Number.parseFloat(parts[3]) / 100)
            : clamp(Number.parseFloat(parts[3]))
          : 1;
      return {
        color: parts
          .slice(0, 3)
          .map((part) => channel(part).toString(16).padStart(2, "0"))
          .join("")
          .toUpperCase(),
        alpha,
      };
    }
    if (typeof document !== "undefined") {
      const probe = document.createElement("span");
      probe.style.color = source;
      probe.style.display = "none";
      document.body.append(probe);
      const resolved = getComputedStyle(probe).color;
      probe.remove();
      if (resolved && resolved !== source) {
        return rgba(resolved);
      }
    }
    throw new ExportError(`Unsupported local color: ${source || "(empty)"}`);
  }

  function paint(value, opacity = 1) {
    const parsed = rgba(value);
    const alpha = clamp(parsed.alpha * clamp(opacity));
    return {
      color: parsed.color,
      transparency: Math.round((1 - alpha) * 100),
    };
  }

  function fontFace(value) {
    return (
      String(value || "Aptos")
        .split(",")[0]
        .trim()
        .replaceAll(/^["']|["']$/g, "") || "Aptos"
    );
  }

  function lineOptions(style = {}, arrows = {}) {
    const stroke = paint(
      style.stroke,
      style.strokeOpacity == null
        ? style.opacity == null
          ? 1
          : style.opacity
        : style.strokeOpacity,
    );
    return {
      ...stroke,
      width: Math.max(0.1, finite(style.strokeWidth, 1) * 0.75),
      ...(style.dash ? { dashType: "dash" } : {}),
      ...(arrows.start || style.startArrow ? { beginArrowType: "triangle" } : {}),
      ...(arrows.end || style.endArrow ? { endArrowType: "triangle" } : {}),
    };
  }

  function objectName(shape) {
    return `Explainer ${String(shape.id || shape.type || "object").slice(0, 120)}`;
  }

  function addPath(pptx, slide, shape) {
    const points = Array.isArray(shape.points) ? shape.points : [];
    if (points.length < 4 || points.length % 2) {
      throw new ExportError(`Path ${shape.id || ""} has invalid points`);
    }
    const pairs = [];
    for (let index = 0; index < points.length; index += 2) {
      pairs.push([clamp(points[index]), clamp(points[index + 1])]);
    }
    const minX = Math.min(...pairs.map((point) => point[0]));
    const minY = Math.min(...pairs.map((point) => point[1]));
    const maxX = Math.max(...pairs.map((point) => point[0]));
    const maxY = Math.max(...pairs.map((point) => point[1]));
    const pathWidth = Math.max(0.001, (maxX - minX) * SLIDE_WIDTH);
    const pathHeight = Math.max(0.001, (maxY - minY) * SLIDE_HEIGHT);
    const custom = (pptx.ShapeType && pptx.ShapeType.custGeom) || "custGeom";
    const style = shape.style || {};
    const fillOpacity =
      style.fillOpacity == null ? (style.opacity == null ? 1 : style.opacity) : style.fillOpacity;
    const fill = shape.closed ? paint(style.fill, fillOpacity) : paint("transparent");
    const pathPoints = pairs.map(([pointX, pointY], index) => {
      const point = {
        x: (pointX - minX) * SLIDE_WIDTH,
        y: (pointY - minY) * SLIDE_HEIGHT,
      };
      if (index === 0) {
        point.moveTo = true;
      }
      return point;
    });
    if (shape.closed) {
      pathPoints.push({ close: true });
    }
    slide.addShape(custom, {
      x: minX * SLIDE_WIDTH,
      y: minY * SLIDE_HEIGHT,
      w: pathWidth,
      h: pathHeight,
      points: pathPoints,
      fill,
      line: lineOptions(style),
      rotate: finite(shape.rotation, finite(style.rotation)),
      objectName: objectName(shape),
    });
  }

  function addShape(pptx, slide, shape) {
    if (!shape || shape.type === "group") {
      return;
    }
    const style = shape.style || {};
    const opacity = style.opacity == null ? 1 : style.opacity;
    if (shape.type === "image") {
      slide.addImage({
        data: shape.data,
        x: x(shape.x),
        y: y(shape.y),
        w: width(shape.width),
        h: height(shape.height),
        rotate: finite(shape.rotation),
        objectName: objectName(shape),
      });
      return;
    }
    if (shape.type === "path") {
      addPath(pptx, slide, shape);
      return;
    }
    if (shape.type === "text") {
      const color = paint(style.fill, opacity);
      const fontSize = Math.max(4.5, finite(style.fontSize, 24) * 0.75);
      const textX = x(shape.x);
      const textY = y(shape.y);
      const measuredWidth = width(shape.width);
      const measuredHeight = height(shape.height);
      const widthReserve = Math.min(0.22, Math.max(0.04, measuredWidth * 0.08));
      const heightReserve = Math.max(0.03, (fontSize * 0.35) / 72);
      slide.addText(String(shape.text || ""), {
        x: textX,
        y: textY,
        w: Math.min(SLIDE_WIDTH - textX, measuredWidth + widthReserve),
        h: Math.min(SLIDE_HEIGHT - textY, measuredHeight + heightReserve),
        fontFace: fontFace(style.fontFamily),
        fontSize,
        color: color.color,
        transparency: color.transparency,
        bold:
          style.fontWeight === "bold" ||
          style.fontWeight === "bolder" ||
          finite(style.fontWeight) >= 600,
        italic: style.fontStyle === "italic" || style.fontStyle === "oblique",
        align:
          style.textAlign === "center"
            ? "center"
            : style.textAlign === "right" || style.textAlign === "end"
              ? "right"
              : "left",
        valign: "top",
        margin: 0,
        breakLine: false,
        fit: "shrink",
        paraSpaceAfterPt: 0,
        charSpacing: finite(style.letterSpacing) * 0.75,
        rotate: finite(shape.rotation, finite(style.rotation)),
        objectName: objectName(shape),
      });
      return;
    }
    if (shape.type === "line" || shape.type === "arrow") {
      const line = (pptx.ShapeType && pptx.ShapeType.line) || "line";
      const x1 = clamp(shape.x1);
      const y1 = clamp(shape.y1);
      const x2 = clamp(shape.x2);
      const y2 = clamp(shape.y2);
      slide.addShape(line, {
        x: x(Math.min(x1, x2)),
        y: y(Math.min(y1, y2)),
        w: Math.max(0.001, Math.abs(x2 - x1) * SLIDE_WIDTH),
        h: Math.max(0.001, Math.abs(y2 - y1) * SLIDE_HEIGHT),
        flipH: x2 < x1,
        flipV: y2 < y1,
        line: lineOptions(style, { end: shape.type === "arrow" }),
        rotate: finite(shape.rotation, finite(style.rotation)),
        objectName: objectName(shape),
      });
      return;
    }
    const shapeType =
      shape.type === "ellipse"
        ? (pptx.ShapeType && pptx.ShapeType.ellipse) || "ellipse"
        : style.radius
          ? (pptx.ShapeType && pptx.ShapeType.roundRect) || "roundRect"
          : (pptx.ShapeType && pptx.ShapeType.rect) || "rect";
    slide.addShape(shapeType, {
      x: x(shape.x),
      y: y(shape.y),
      w: width(shape.width),
      h: height(shape.height),
      fill: paint(style.fill, style.fillOpacity == null ? opacity : style.fillOpacity),
      line: lineOptions(style),
      rotate: finite(shape.rotation, finite(style.rotation)),
      objectName: objectName(shape),
    });
  }

  function buildPresentation(deck, Constructor = globalThis.PptxGenJS) {
    if (typeof Constructor !== "function") {
      throw new ExportError("The bundled PPTX engine is unavailable");
    }
    if (!deck || !Array.isArray(deck.slides) || !deck.slides.length) {
      throw new ExportError("There are no visible slides to export");
    }
    if (deck.slides.length > MAX_SLIDES) {
      throw new ExportError(`PPTX export supports at most ${MAX_SLIDES} slides`);
    }
    const totalObjects = deck.slides.reduce(
      (total, slide) => total + (Array.isArray(slide.shapes) ? slide.shapes.length : 0),
      0,
    );
    if (totalObjects > MAX_OBJECTS) {
      throw new ExportError(`PPTX export supports at most ${MAX_OBJECTS} objects`);
    }
    const imagePayload = deck.slides.reduce(
      (total, slide) =>
        total +
        (slide.shapes || []).reduce(
          (slideTotal, shape) =>
            slideTotal + (shape && shape.type === "image" ? String(shape.data || "").length : 0),
          0,
        ),
      0,
    );
    if (imagePayload > MAX_DECK_IMAGE_BYTES * 1.4) {
      throw new ExportError(`Embedded images exceed the ${MAX_DECK_IMAGE_BYTES}-byte deck limit`);
    }
    const pptx = new Constructor();
    pptx.layout = "LAYOUT_WIDE";
    pptx.author = "Explainer Studio";
    pptx.company = "";
    pptx.subject = "Editable presentation exported from Explainer Studio";
    pptx.title = String(deck.title || "Explainer");
    pptx.lang = String(deck.lang || "en-US");
    pptx.theme = {
      headFontFace: "Aptos Display",
      bodyFontFace: "Aptos",
      lang: pptx.lang,
    };
    deck.slides.forEach((record) => {
      const slide = pptx.addSlide();
      const background = paint(record.background || "#ffffff");
      slide.background = { color: background.color };
      (record.shapes || [])
        .filter(Boolean)
        .toSorted((left, right) => finite(left.z) - finite(right.z))
        .forEach((shape) => addShape(pptx, slide, shape));
    });
    return pptx;
  }

  function nextFrame() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }

  function withCaptureLayout(section, operation, { display = "block" } = {}) {
    const style = section.getAttribute("style");
    const hidden = section.hidden;
    const hadCaptureClass = section.classList.contains("st-pptx-capture");
    section.hidden = false;
    section.classList.add("st-pptx-capture");
    [
      ["display", display],
      ["position", "fixed"],
      ["left", "-12000px"],
      ["top", "0"],
      ["right", "auto"],
      ["bottom", "auto"],
      ["width", "960px"],
      ["height", "540px"],
      ["min-height", "540px"],
      ["max-width", "none"],
      ["margin", "0"],
      ["transform", "none"],
      ["overflow", "hidden"],
      ["visibility", "visible"],
      ["opacity", "1"],
      ["pointer-events", "none"],
      ["z-index", "-2147483647"],
    ].forEach(([property, value]) => section.style.setProperty(property, value, "important"));
    const restore = () => {
      if (!hadCaptureClass) {
        section.classList.remove("st-pptx-capture");
      }
      section.hidden = hidden;
      if (style == null) {
        section.removeAttribute("style");
      } else {
        section.setAttribute("style", style);
      }
    };
    try {
      return nextFrame()
        .then(() => operation())
        .then(
          (value) => {
            restore();
            return value;
          },
          (error) => {
            restore();
            throw error;
          },
        );
    } catch (error) {
      restore();
      return Promise.reject(error);
    }
  }

  function rebaseScene(scene, prefix) {
    const ids = new Map(
      scene.shapes.map((shape, index) => [
        shape.id,
        `${prefix}-${String(shape.id || index).replaceAll(/[^A-Za-z0-9_-]/g, "-")}`,
      ]),
    );
    return scene.shapes.map((shape, index) => ({
      ...structuredClone(shape),
      id: ids.get(shape.id) || `${prefix}-${index}`,
      ...(shape.parent ? { parent: ids.get(shape.parent) || shape.parent } : {}),
    }));
  }

  function appendScene(target, scene, prefix) {
    rebaseScene(scene, prefix)
      .toSorted((left, right) => finite(left.z) - finite(right.z))
      .forEach((shape) => target.push({ ...shape, z: target.length }));
  }

  function blobData(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(String(reader.result || "")), { once: true });
      reader.addEventListener(
        "error",
        () => reject(new ExportError("An image could not be read")),
        {
          once: true,
        },
      );
      reader.readAsDataURL(blob);
    });
  }

  function imageData(source) {
    const finalize = (data) => {
      if (!/^data:image\/(?:png|jpeg|gif);base64,/i.test(data)) {
        throw new ExportError("Only embedded PNG, JPEG, or GIF images can be exported");
      }
      if (data.length > MAX_IMAGE_BYTES * 1.4) {
        throw new ExportError(`An image exceeds the ${MAX_IMAGE_BYTES}-byte export limit`);
      }
      return data;
    };
    const load = () => {
      if (!source) {
        throw new ExportError("An image has no embedded source");
      }
      if (source.startsWith("data:image/")) {
        return source;
      }
      const url = new URL(source, location.href);
      if (url.origin !== location.origin && url.protocol !== "blob:") {
        throw new ExportError("External images must be embedded before PPTX export");
      }
      return fetch(url, { credentials: "same-origin" })
        .then((response) => {
          if (!response.ok) {
            throw new ExportError(`Image export failed with HTTP ${response.status}`);
          }
          return response.blob();
        })
        .then(blobData);
    };
    return Promise.resolve().then(load).then(finalize);
  }

  function resolveSceneImages(scene) {
    const resolveShape = (shape, data) => {
      shape.data = data;
      delete shape.source;
    };
    return scene.shapes
      .filter((shape) => shape && shape.type === "image" && shape.source)
      .reduce(
        (chain, shape) =>
          chain.then(() => imageData(shape.source)).then((data) => resolveShape(shape, data)),
        Promise.resolve(),
      );
  }

  function slideTitle(section, fallback) {
    const heading = section.querySelector("h1,h2,h3,.ksc-title");
    return (
      (heading && heading.textContent && heading.textContent.replaceAll(/\s+/g, " ").trim()) ||
      fallback ||
      section.id ||
      "Untitled slide"
    );
  }

  function captureSlide(section, manifest, index, options = {}) {
    return withCaptureLayout(
      section,
      () => {
        const errors = [];
        const warnings = [];
        const shapes = [];
        const title = options.title || slideTitle(section, `Slide ${index + 1}`);
        const appendCaptured = (scene, prefix) => {
          appendScene(shapes, scene, prefix);
          warnings.push(...(scene.warnings || []));
        };
        const capturePage = () => {
          let page;
          try {
            page = globalThis.ExplainerDetach.capture({
              host: section,
              section,
              exclude: CAPTURE_EXCLUDE,
              includeImages: true,
            });
          } catch (error) {
            errors.push(`${title}: ${error.message || "slide content is not portable"}`);
            return;
          }
          return resolveSceneImages(page)
            .then(() => appendCaptured(page, `slide-${index}-page`))
            .catch((error) => {
              errors.push(`${title}: ${error.message || "slide content is not portable"}`);
            });
        };
        const captureComponents = (components) =>
          components.reduce(
            (chain, host, componentIndex) =>
              chain.then(() => {
                if (
                  globalThis.ExplainerAuthoring &&
                  globalThis.ExplainerAuthoring.isDetached &&
                  globalThis.ExplainerAuthoring.isDetached(host)
                ) {
                  return;
                }
                let scene;
                try {
                  scene = globalThis.ExplainerDetach.capture({
                    host,
                    section,
                    exclude: CAPTURE_EXCLUDE.replace(".artifact,", ""),
                    includeImages: true,
                  });
                } catch (error) {
                  errors.push(
                    `${title}: ${error.message || "a visual has no editable presentation representation"}`,
                  );
                  return;
                }
                return resolveSceneImages(scene)
                  .then(() => appendCaptured(scene, `slide-${index}-component-${componentIndex}`))
                  .catch((error) => {
                    errors.push(
                      `${title}: ${error.message || "a visual has no editable presentation representation"}`,
                    );
                  });
              }),
            Promise.resolve(),
          );
        return Promise.resolve()
          .then(capturePage)
          .then(() => {
            const components = [...section.querySelectorAll(".artifact")].filter((host) =>
              options.presentation
                ? host.closest(".pr-slide") === section
                : host.closest("section") === section,
            );
            return captureComponents(components);
          })
          .then(() => {
            const sourceSlide = options.sourceSection || section;
            const authored = (manifest.shapes || [])
              .filter((shape) => shape && sourceSlide && shape.slide === sourceSlide.id)
              .map((shape) => structuredClone(shape));
            authored.forEach((shape) => shapes.push({ ...shape, z: shapes.length }));
            return {
              title,
              background:
                options.background || getComputedStyle(section).backgroundColor || "#ffffff",
              shapes,
              warnings,
              errors,
              ...(Number.isInteger(options.stepIndex)
                ? { step: options.stepIndex, steps: options.stepCount }
                : {}),
            };
          });
      },
      { display: options.presentation ? "flex" : "block" },
    );
  }

  function captureDeck({ manifest, title, lang }) {
    if (!globalThis.ExplainerDetach || typeof globalThis.ExplainerDetach.capture !== "function") {
      return Promise.reject(new ExportError("The portable slide capture layer is unavailable"));
    }
    const records = [];
    const present = globalThis.__present;
    if (!present || typeof present.captureStates !== "function") {
      return Promise.reject(
        new ExportError("Presentation mode is unavailable. Reload the explainer before exporting."),
      );
    }
    const stateCount =
      typeof present.exportStateCount === "function" ? present.exportStateCount() : null;
    if (Number.isInteger(stateCount) && stateCount > MAX_SLIDES) {
      return Promise.reject(new ExportError(`PPTX export supports at most ${MAX_SLIDES} slides`));
    }
    const keepRecord = (record) => {
      records.push(record);
    };
    const visitor = (state) => {
      if (records.length >= MAX_SLIDES) {
        throw new ExportError(`PPTX export supports at most ${MAX_SLIDES} slides`);
      }
      return captureSlide(state.section, manifest || { shapes: [] }, records.length, {
        ...state,
        presentation: true,
      }).then(keepRecord);
    };
    const finish = (captured) => {
      if (captured === false || !records.length) {
        throw new ExportError("Presentation mode did not produce any slides to export");
      }
      const errors = records.flatMap((record) => record.errors);
      if (errors.length) {
        throw new ExportError(
          `PPTX export stopped: ${errors[0]}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ""}`,
          errors,
        );
      }
      return {
        title,
        lang,
        slides: records.map(({ errors: _errors, warnings: _warnings, ...record }) => record),
        warnings: [...new Set(records.flatMap((record) => record.warnings))],
      };
    };
    return Promise.resolve()
      .then(() => present.captureStates(visitor))
      .then(finish);
  }

  function safeFilename(value) {
    const name = String(value || "explainer")
      /* oxlint-disable-next-line no-control-regex -- control characters are
         exactly what this strip removes from an unsafe filename */
      .replaceAll(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
      .replaceAll(/\s+/g, " ")
      .trim()
      .replace(/\.pptx$/i, "")
      .slice(0, 120);
    return `${name || "explainer"}.pptx`;
  }

  function exportDeck(options) {
    return captureDeck(options).then((deck) => {
      const pptx = buildPresentation(deck);
      return pptx
        .writeFile({
          fileName: options.filename || safeFilename(deck.title),
          compression: true,
        })
        .then(() => ({ slides: deck.slides.length, warnings: deck.warnings }));
    });
  }

  globalThis.ExplainerPptx = Object.freeze({
    version: 1,
    ExportError,
    buildPresentation,
    captureDeck,
    exportDeck,
    safeFilename,
  });
})();
