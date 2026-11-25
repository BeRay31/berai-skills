/* Convert one rendered component into portable, editable scene primitives.
 *
 * This file is loaded by Studio only. Capture is deliberately read-only and
 * synchronous: it snapshots computed presentation state without cloning DOM,
 * executing page data, or changing animation/playback state. A caller either
 * receives a complete bounded scene or an exception; partial output is never
 * returned or persisted.
 */
(function () {
  "use strict";

  const MAX_SHAPES = 500;
  // Recursive hierarchy components legitimately exceed eight wrapper levels.
  // Keep this aligned with the persisted authoring contract so a scene that
  // can be exported can also be saved for later editing.
  const MAX_DEPTH = 16;
  const MAX_PATH_POINTS = 128;
  const MAX_TEXT = 10_000;
  const MAX_TOTAL_TEXT = 100_000;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const SKIP_SVG = new Set([
    "defs",
    "desc",
    "filter",
    "linearGradient",
    "marker",
    "metadata",
    "radialGradient",
    "stop",
    "style",
    "symbol",
    "title",
  ]);
  const UNSUPPORTED_HTML = new Set(["canvas", "embed", "iframe", "img", "object", "video"]);
  const UNSUPPORTED_SVG = new Set(["foreignObject", "image", "pattern", "use"]);

  class CaptureError extends Error {
    constructor(message) {
      super(message);
      this.name = "CaptureError";
    }
  }

  function finite(value) {
    return Number.isFinite(value) ? value : 0;
  }

  function number(value, fallback = 0) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function bounded(value, low = 0, high = 1) {
    return Math.min(high, Math.max(low, finite(value)));
  }

  function alpha(paint) {
    if (!paint || paint === "none" || paint === "transparent") {
      return 0;
    }
    const rgba = paint.match(/^rgba?\(([^)]+)\)$/i);
    if (!rgba) {
      return 1;
    }
    const parts = rgba[1].split(/[ ,/]+/).filter(Boolean);
    return parts.length > 3 ? bounded(number(parts[3], 1)) : 1;
  }

  function visible(element, style) {
    if (!element.isConnected || style.display === "none") {
      return false;
    }
    if (style.visibility === "hidden" || style.visibility === "collapse") {
      return false;
    }
    return number(style.opacity, 1) > 0;
  }

  function intersect(left, right) {
    const x1 = Math.max(left.left, right.left);
    const y1 = Math.max(left.top, right.top);
    const x2 = Math.min(left.right, right.right);
    const y2 = Math.min(left.bottom, right.bottom);
    return x2 > x1 && y2 > y1
      ? { left: x1, top: y1, right: x2, bottom: y2, width: x2 - x1, height: y2 - y1 }
      : null;
  }

  function rectOf(value) {
    return {
      left: value.left,
      top: value.top,
      right: value.right,
      bottom: value.bottom,
      width: value.width,
      height: value.height,
    };
  }

  function capture({ host, section, exclude = "", includeImages = false }) {
    if (
      !(host instanceof Element) ||
      !(section instanceof HTMLElement) ||
      !section.contains(host)
    ) {
      throw new CaptureError("Detach needs a component host inside its slide");
    }
    const sectionRect = rectOf(section.getBoundingClientRect());
    if (sectionRect.width <= 0 || sectionRect.height <= 0) {
      throw new CaptureError("The slide must be visible before detaching a component");
    }
    const sceneScale = Math.max(0.001, Math.min(sectionRect.width / 960, sectionRect.height / 540));

    const shapes = [];
    const warnings = [];
    const warned = new Set();
    const paints = new Map();
    let paintContext = null;
    let serial = 0;
    let z = 0;
    let totalText = 0;
    let visitedNodes = 0;

    function visit() {
      visitedNodes += 1;
      if (visitedNodes > 5000) {
        throw new CaptureError("This component contains too many DOM nodes to detach safely");
      }
    }

    function portablePaint(value) {
      if (!value || value === "none" || value === "transparent") {
        return "transparent";
      }
      if (paints.has(value)) {
        return paints.get(value);
      }
      if (/^(?:#[0-9a-f]{3,8}|rgba?\([\d.,%\s]+\))$/i.test(value)) {
        paints.set(value, value);
        return value;
      }
      // Computed color-mix values can be color(srgb ...), not rgb(...).
      // Resolve one pixel solely for its RGBA channels; no image is saved.
      if (!CSS.supports("color", value)) {
        throw new CaptureError("A paint could not be converted to a portable color");
      }
      if (!paintContext) {
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        paintContext = canvas.getContext("2d", { willReadFrequently: true });
      }
      if (!paintContext) {
        throw new CaptureError("The browser could not resolve a portable color");
      }
      paintContext.clearRect(0, 0, 1, 1);
      paintContext.fillStyle = value;
      paintContext.fillRect(0, 0, 1, 1);
      const [red, green, blue, opacity] = paintContext.getImageData(0, 0, 1, 1).data;
      const paint = `rgba(${red}, ${green}, ${blue}, ${opacity / 255})`;
      paints.set(value, paint);
      return paint;
    }

    function warn(key, message) {
      if (!warned.has(key)) {
        warned.add(key);
        warnings.push(message);
      }
    }

    function id() {
      serial += 1;
      return `detached-${serial}`;
    }

    function normalizedRect(raw, clip = sectionRect) {
      const clipped = intersect(rectOf(raw), clip);
      if (!clipped) {
        return null;
      }
      return {
        x: bounded((clipped.left - sectionRect.left) / sectionRect.width),
        y: bounded((clipped.top - sectionRect.top) / sectionRect.height),
        width: bounded(clipped.width / sectionRect.width),
        height: bounded(clipped.height / sectionRect.height),
      };
    }

    function normalizedPoint(point) {
      if (
        point.x < sectionRect.left ||
        point.x > sectionRect.right ||
        point.y < sectionRect.top ||
        point.y > sectionRect.bottom
      ) {
        warn("clipped-geometry", "Geometry outside the slide was clipped to its visible bounds");
      }
      return [
        bounded((point.x - sectionRect.left) / sectionRect.width),
        bounded((point.y - sectionRect.top) / sectionRect.height),
      ];
    }

    function push(shape) {
      if (shapes.length >= MAX_SHAPES) {
        throw new CaptureError(`This component exceeds the ${MAX_SHAPES}-object detach limit`);
      }
      const record = { ...shape, id: id(), z };
      z += 1;
      shapes.push(record);
      return record.id;
    }

    function addText(text, frame, parent, style) {
      if (text.length > MAX_TEXT) {
        throw new CaptureError(`A text object exceeds the ${MAX_TEXT}-character detach limit`);
      }
      totalText += text.length;
      if (totalText > MAX_TOTAL_TEXT) {
        throw new CaptureError("This component contains too much text to detach safely");
      }
      return push({ type: "text", parent, ...frame, text, style });
    }

    function htmlScreenScale(element) {
      let scaleX = 1;
      let scaleY = 1;
      for (let current = element; current && current !== section; current = current.parentElement) {
        const transform = getComputedStyle(current).transform;
        if (!transform || transform === "none") {
          continue;
        }
        let matrix;
        try {
          matrix = new DOMMatrix(transform);
        } catch {
          throw new CaptureError("A CSS transform cannot be represented as editable geometry");
        }
        if (!matrix.is2D || Math.abs(matrix.b) > 0.001 || Math.abs(matrix.c) > 0.001) {
          throw new CaptureError("Rotated or skewed HTML cannot be detached safely");
        }
        scaleX *= Math.abs(matrix.a);
        scaleY *= Math.abs(matrix.d);
      }
      return { x: scaleX, y: scaleY, average: (scaleX + scaleY) / 2 };
    }

    function textLayoutFrame(node, computed, clip, frame) {
      const element = node.parentElement;
      if (!element || element.childElementCount || computed.display === "inline") {
        return frame;
      }
      const bounds = element.getBoundingClientRect();
      const scale = htmlScreenScale(element);
      const left =
        bounds.left + (number(computed.borderLeftWidth) + number(computed.paddingLeft)) * scale.x;
      const right =
        bounds.right -
        (number(computed.borderRightWidth) + number(computed.paddingRight)) * scale.x;
      const content = normalizedRect(
        {
          left,
          right,
          top: frame.y * sectionRect.height + sectionRect.top,
          bottom: (frame.y + frame.height) * sectionRect.height + sectionRect.top,
          width: Math.max(0, right - left),
          height: frame.height * sectionRect.height,
        },
        clip,
      );
      if (!content) {
        return frame;
      }
      const lineHeight =
        computed.lineHeight === "normal"
          ? number(computed.fontSize, 16) * 1.2
          : number(computed.lineHeight, number(computed.fontSize, 16) * 1.2);
      const lineBox = bounded((lineHeight * scale.y) / sectionRect.height);
      const align = computed.textAlign;
      if (align === "center" || align === "right" || align === "end") {
        return { ...content, height: Math.max(content.height, lineBox) };
      }
      // Wrapped text is detached one rendered line at a time, so a left-aligned
      // line does not need the full width of its CSS parent. Keeping that width
      // produced huge, overlapping edit handles in PowerPoint and Google
      // Slides. The PPTX writer adds a small importer reserve to this measured
      // glyph frame, which preserves the line without making editing hazardous.
      return {
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: Math.max(frame.height, lineBox),
      };
    }

    function concreteCssPaint(value, fallback, key) {
      if (!value || value === "none" || value === "transparent") {
        return "transparent";
      }
      if (/^(?:repeating-)?(?:linear|radial|conic)-gradient\(/i.test(value)) {
        const match = value.match(/(?:rgba?|hsla?)\([^)]+\)|#[0-9a-f]{3,8}/i);
        warn(key, "A gradient was flattened to one solid color");
        return match ? match[0] : fallback;
      }
      if (/url\(/i.test(value)) {
        throw new CaptureError("Image-backed CSS cannot be detached into editable shapes");
      }
      return value;
    }

    function htmlStyle(element, computed, box) {
      const background = concreteCssPaint(
        computed.backgroundImage !== "none" ? computed.backgroundImage : computed.backgroundColor,
        computed.backgroundColor || computed.color,
        "css-gradient",
      );
      const widths = ["Top", "Right", "Bottom", "Left"].map((side) =>
        number(computed[`border${side}Width`]),
      );
      const colors = ["Top", "Right", "Bottom", "Left"].map(
        (side) => computed[`border${side}Color`],
      );
      const borderStyles = ["Top", "Right", "Bottom", "Left"].map(
        (side) => computed[`border${side}Style`],
      );
      const scale = htmlScreenScale(element);
      const activeBorders = ["top", "right", "bottom", "left"].flatMap((side, index) =>
        widths[index] > 0 && borderStyles[index] !== "none" && alpha(colors[index]) > 0
          ? [
              {
                side,
                stroke: colors[index],
                strokeWidth: (widths[index] * scale.average) / sceneScale,
                dash: ["dashed", "dotted"].includes(borderStyles[index]),
              },
            ]
          : [],
      );
      const uniformBorder =
        activeBorders.length === 4 &&
        new Set(widths).size === 1 &&
        new Set(colors).size === 1 &&
        new Set(borderStyles).size === 1;
      const strokeWidth = uniformBorder ? activeBorders[0].strokeWidth : 0;
      if (computed.boxShadow && computed.boxShadow !== "none") {
        warn("box-shadow", "A box shadow was removed during detach");
      }
      if (borderStyles.some((style) => !["none", "solid", "dashed", "dotted"].includes(style))) {
        warn("border-style", "A patterned border was flattened to a solid outline");
      }
      if (computed.filter && computed.filter !== "none") {
        warn("css-filter", "A CSS filter effect was removed during detach");
      }
      if (computed.clipPath && computed.clipPath !== "none") {
        warn("css-clip", "CSS clipping was flattened to visible object bounds");
      }
      return {
        fill: background,
        stroke: uniformBorder ? activeBorders[0].stroke : "transparent",
        strokeWidth,
        dash: uniformBorder && activeBorders[0].dash,
        borderSides: uniformBorder ? [] : activeBorders,
        opacity: bounded(number(computed.opacity, 1)),
        radius: bounded(
          (Math.max(
            number(computed.borderTopLeftRadius),
            number(computed.borderTopRightRadius),
            number(computed.borderBottomRightRadius),
            number(computed.borderBottomLeftRadius),
          ) *
            scale.average) /
            Math.max(1, Math.min(box.width, box.height)),
          0,
          0.5,
        ),
      };
    }

    function textStyle(computed, opacity = number(computed.opacity, 1), element = null) {
      if (computed.textDecorationLine && computed.textDecorationLine !== "none") {
        warn("text-decoration", "A text decoration was removed during detach");
      }
      const scale = element ? htmlScreenScale(element).average : 1;
      return {
        fill: computed.color,
        opacity: bounded(opacity),
        fontFamily: computed.fontFamily,
        fontSize: (number(computed.fontSize, 16) * scale) / sceneScale,
        fontWeight: computed.fontWeight,
        fontStyle: computed.fontStyle,
        lineHeight:
          computed.lineHeight === "normal"
            ? "normal"
            : number(computed.lineHeight, 0) / Math.max(1, number(computed.fontSize, 16)),
        letterSpacing:
          computed.letterSpacing === "normal"
            ? 0
            : (number(computed.letterSpacing, 0) * scale) / sceneScale,
        textAlign: computed.textAlign,
      };
    }

    function hasBox(style) {
      return (
        alpha(style.fill) > 0 ||
        (style.strokeWidth > 0 && alpha(style.stroke) > 0) ||
        (style.borderSides && style.borderSides.length > 0) ||
        style.radius > 0
      );
    }

    function pushBox(frame, parent, style) {
      const borderSides = style.borderSides || [];
      const boxStyle = { ...style };
      delete boxStyle.borderSides;
      if (
        alpha(boxStyle.fill) > 0 ||
        (boxStyle.strokeWidth > 0 && alpha(boxStyle.stroke) > 0) ||
        boxStyle.radius > 0
      ) {
        push({ type: "rect", parent, ...frame, style: boxStyle });
      }
      borderSides.forEach((border) => {
        const horizontal = border.side === "top" || border.side === "bottom";
        const far = border.side === "right" || border.side === "bottom";
        const x1 = far && !horizontal ? frame.x + frame.width : frame.x;
        const y1 = far && horizontal ? frame.y + frame.height : frame.y;
        const x2 = horizontal ? frame.x + frame.width : x1;
        const y2 = horizontal ? y1 : frame.y + frame.height;
        push({
          type: "line",
          parent,
          x1,
          y1,
          x2,
          y2,
          style: {
            fill: "transparent",
            stroke: border.stroke,
            strokeWidth: border.strokeWidth,
            dash: border.dash,
            opacity: boxStyle.opacity,
          },
        });
      });
    }

    function meaningfulGroup(element, boxStyle) {
      if (
        element === host ||
        hasBox(boxStyle) ||
        boxStyle.opacity !== 1 ||
        element.namespaceURI === SVG_NS
      ) {
        return true;
      }
      return Boolean(
        element.id ||
        element.getAttribute("aria-label") ||
        element.getAttribute("role") ||
        [...element.attributes].some((attribute) => attribute.name.startsWith("data-")),
      );
    }

    function clipFor(element, currentClip, computed) {
      const clippedValues = new Set(["hidden", "clip", "scroll", "auto"]);
      const clips = [computed.overflow, computed.overflowX, computed.overflowY].some((value) =>
        clippedValues.has(value),
      );
      return clips ? intersect(currentClip, rectOf(element.getBoundingClientRect())) : currentClip;
    }

    function pseudoFrame(element, computed, clip) {
      const owner = element.getBoundingClientRect();
      const scale = htmlScreenScale(element);
      let width =
        computed.width === "auto" ? owner.width : number(computed.width, owner.width) * scale.x;
      let height =
        computed.height === "auto" ? owner.height : number(computed.height, owner.height) * scale.y;
      let left = owner.left;
      let top = owner.top;
      if (computed.position === "absolute" || computed.position === "fixed") {
        if (computed.left !== "auto") {
          left += number(computed.left) * scale.x;
        } else if (computed.right !== "auto") {
          left = owner.right - number(computed.right) * scale.x - width;
        }
        if (computed.top !== "auto") {
          top += number(computed.top) * scale.y;
        } else if (computed.bottom !== "auto") {
          top = owner.bottom - number(computed.bottom) * scale.y - height;
        }
      }
      let rotation = 0;
      if (computed.transform !== "none") {
        const transform = new DOMMatrix(computed.transform);
        if (!transform.is2D) {
          throw new CaptureError(`A 3D pseudo-element transform cannot be detached safely`);
        }
        width *= Math.hypot(transform.a, transform.b);
        height *= Math.hypot(transform.c, transform.d);
        left += transform.e;
        top += transform.f;
        rotation = (Math.atan2(transform.b, transform.a) * 180) / Math.PI;
      }
      const frame = normalizedRect(
        { left, top, right: left + width, bottom: top + height, width, height },
        clip,
      );
      return frame ? { ...frame, ...(rotation ? { rotation } : {}) } : null;
    }

    function pseudoElement(element, pseudo, parent, clip, opacity) {
      const computed = getComputedStyle(element, pseudo);
      if (!visible(element, computed)) {
        return;
      }
      const raw = computed.content;
      const absent = !raw || raw === "none" || raw === "normal";
      const frame = pseudoFrame(element, computed, clip);
      const boxStyle = htmlStyle(element, computed, element.getBoundingClientRect());
      if (frame && hasBox(boxStyle)) {
        warn("pseudo-box", "Generated decoration was flattened into an ordinary shape");
        pushBox(frame, parent, { ...boxStyle, opacity });
      }
      if (absent || raw === "open-quote" || raw === "close-quote") {
        return;
      }
      if (/^(?:url|image|attr)\(/i.test(raw)) {
        throw new CaptureError(`Meaningful ${pseudo} content cannot be detached safely`);
      }
      const text = raw.replaceAll(/^(?:"|')|(?:"|')$/g, "").replaceAll(/\\A/gi, "\n");
      if (!text.trim()) {
        return;
      }
      if (frame) {
        warn("pseudo-text", "Generated text was flattened into an ordinary text object");
        addText(text, frame, parent, textStyle(computed, opacity, element));
      }
    }

    function textValue(raw, computed) {
      if (/^(?:pre|pre-wrap|break-spaces)$/.test(computed.whiteSpace)) {
        return raw.replaceAll(/\r\n?/g, "\n").trim();
      }
      return raw.replaceAll(/\s+/g, " ").trim();
    }

    function transformedText(raw, computed) {
      let value = textValue(raw, computed);
      if (computed.textTransform === "uppercase") {
        value = value.toLocaleUpperCase();
      } else if (computed.textTransform === "lowercase") {
        value = value.toLocaleLowerCase();
      } else if (computed.textTransform === "capitalize") {
        value = value.replaceAll(/(?:^|\s)\S/g, (part) => part.toLocaleUpperCase());
      }
      return value;
    }

    function htmlText(node, parent, clip, computed, opacity) {
      const raw = node.nodeValue || "";
      // Check before measuring individual characters: a huge wrapped text
      // node must not monopolize the UI thread before the shape limit runs.
      if (raw.length > MAX_TEXT) {
        throw new CaptureError(`A text object exceeds the ${MAX_TEXT}-character detach limit`);
      }
      const value = transformedText(raw, computed);
      if (!value) {
        return;
      }
      const range = document.createRange();
      range.selectNodeContents(node);
      const fragments = [...range.getClientRects()].filter(
        (rect) => rect.width > 0 && rect.height > 0,
      );
      const frame = normalizedRect(range.getBoundingClientRect(), clip);
      if (fragments.length <= 1) {
        range.detach();
        if (!frame) {
          throw new CaptureError("Visible text falls outside the detachable slide area");
        }
        addText(
          value,
          textLayoutFrame(node, computed, clip, frame),
          parent,
          textStyle(computed, opacity, node.parentElement),
        );
        return;
      }

      const lines = [];
      let lineStart = 0;
      let lineTop = null;
      for (let index = 0; index < raw.length; index += 1) {
        if (/\s/.test(raw[index])) {
          continue;
        }
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        const character = range.getBoundingClientRect();
        if (character.width <= 0 || character.height <= 0) {
          continue;
        }
        if (lineTop == null) {
          lineTop = character.top;
        } else if (Math.abs(character.top - lineTop) > 2) {
          lines.push([lineStart, index]);
          lineStart = index;
          lineTop = character.top;
        }
      }
      lines.push([lineStart, raw.length]);
      lines.forEach(([start, end]) => {
        const line = transformedText(raw.slice(start, end), computed);
        if (!line) {
          return;
        }
        range.setStart(node, start);
        range.setEnd(node, end);
        const lineFrame = normalizedRect(range.getBoundingClientRect(), clip);
        if (!lineFrame) {
          throw new CaptureError("Visible text falls outside the detachable slide area");
        }
        addText(
          line,
          textLayoutFrame(node, computed, clip, lineFrame),
          parent,
          textStyle(computed, opacity, node.parentElement),
        );
      });
      range.detach();
    }

    function formValue(element, parent, clip, computed, opacity) {
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
        return;
      }
      const value = element.value || element.getAttribute("placeholder") || "";
      const frame = value && normalizedRect(element.getBoundingClientRect(), clip);
      if (frame) {
        addText(value, frame, parent, textStyle(computed, opacity, element));
      }
    }

    function svgPoint(element, x, y) {
      const matrix = element.getScreenCTM();
      if (!matrix) {
        throw new CaptureError("SVG geometry is not available while the component is hidden");
      }
      const point = new DOMPoint(x, y).matrixTransform(matrix);
      return { x: point.x, y: point.y };
    }

    function svgPaint(element, value, fallback, key) {
      if (!value || value === "none" || value === "transparent") {
        return "transparent";
      }
      const reference = value.match(/^url\(["']?#([^"')]+)["']?\)/i);
      if (!reference) {
        return value === "currentColor" ? fallback : value;
      }
      const target = element.ownerSVGElement
        ? element.ownerSVGElement.querySelector(`#${CSS.escape(reference[1])}`)
        : null;
      if (!target) {
        throw new CaptureError("An SVG paint server cannot be converted to an editable solid fill");
      }
      if (target.localName === "pattern") {
        const painted = [...target.querySelectorAll("rect,circle,ellipse,path")]
          .map((child) => getComputedStyle(child).fill)
          .find((paint) => paint && paint !== "none" && !paint.startsWith("url("));
        warn(key, "An SVG pattern was flattened to one solid color");
        return painted || fallback;
      }
      if (!/^(?:linearGradient|radialGradient)$/i.test(target.localName)) {
        throw new CaptureError("An SVG paint server cannot be converted to an editable solid fill");
      }
      const stops = [...target.querySelectorAll("stop")];
      const middle = stops[Math.floor(stops.length / 2)];
      const color = middle && getComputedStyle(middle).stopColor;
      warn(key, "An SVG gradient was flattened to one solid color");
      return color || fallback;
    }

    function svgPaintServerOpacity(element, value) {
      const reference = String(value || "").match(/^url\(["']?#([^"')]+)["']?\)/i);
      if (!reference) {
        return 1;
      }
      const target = element.ownerSVGElement
        ? element.ownerSVGElement.querySelector(`#${CSS.escape(reference[1])}`)
        : null;
      if (!target || !/^(?:linearGradient|radialGradient)$/i.test(target.localName)) {
        return 1;
      }
      const stops = [...target.querySelectorAll("stop")];
      if (!stops.length) {
        return 1;
      }
      return bounded(
        stops.reduce((total, stop) => total + number(getComputedStyle(stop).stopOpacity, 1), 0) /
          stops.length,
      );
    }

    function svgStyle(element, computed, opacity) {
      if (computed.filter && computed.filter !== "none") {
        warn("svg-filter", "An SVG filter effect was removed during detach");
      }
      if (computed.clipPath && computed.clipPath !== "none") {
        warn("svg-clip", "SVG clipping was flattened to visible object bounds");
      }
      if (computed.mask && computed.mask !== "none") {
        warn("svg-mask", "An SVG mask was removed during detach");
      }
      const matrix = element.getScreenCTM();
      const strokeScale =
        computed.vectorEffect === "non-scaling-stroke" || !matrix
          ? 1
          : (Math.hypot(matrix.a, matrix.b) + Math.hypot(matrix.c, matrix.d)) / 2;
      const style = {
        fill: svgPaint(element, computed.fill, computed.color, "svg-gradient"),
        stroke: svgPaint(element, computed.stroke, computed.color, "svg-gradient"),
        strokeWidth: (number(computed.strokeWidth) * strokeScale) / sceneScale,
        dash:
          computed.strokeDasharray !== "none" &&
          (String(computed.strokeDasharray).match(/[-+]?(?:\d*\.)?\d+/g) || []).some(
            (part) => number(part) > 0,
          ),
        opacity: bounded(opacity),
        fillOpacity: bounded(
          opacity * number(computed.fillOpacity, 1) * svgPaintServerOpacity(element, computed.fill),
        ),
        strokeOpacity: bounded(opacity * number(computed.strokeOpacity, 1)),
        strokeLinecap: computed.strokeLinecap,
        strokeLinejoin: computed.strokeLinejoin,
      };
      if (computed.markerStart && computed.markerStart !== "none") {
        style.startArrow = true;
      }
      if (computed.markerEnd && computed.markerEnd !== "none") {
        style.endArrow = true;
      }
      return style;
    }

    function pathShape(points, closed, parent, style) {
      if (points.length < 2) {
        throw new CaptureError("An SVG path has no visible geometry to detach");
      }
      const flat = points.flatMap(normalizedPoint);
      return push({ type: "path", parent, points: flat, closed, style });
    }

    function pathParts(value) {
      const starts = [...value.matchAll(/[Mm](?=[\s,]*[-+.0-9])/g)];
      if (starts.length <= 1) {
        return [value];
      }
      if (starts.some((match) => match[0] === "m")) {
        throw new CaptureError("A relative multi-part SVG path cannot be detached safely");
      }
      return starts.map((match, index) => {
        const next = starts[index + 1];
        return value.slice(match.index, next ? next.index : undefined);
      });
    }

    function svgPath(element, parent, computed, opacity) {
      const source = element.getAttribute("d") || "";
      pathParts(source).forEach((part) => {
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", part);
        let length;
        try {
          length = path.getTotalLength();
        } catch {
          throw new CaptureError("An SVG path could not be measured for detach");
        }
        if (!Number.isFinite(length) || length <= 0) {
          warn("empty-svg-path", "A zero-length SVG path was omitted");
          return;
        }
        const count = Math.min(MAX_PATH_POINTS, Math.max(8, Math.ceil(length / 8) + 1));
        const points = Array.from({ length: count }, (_unused, index) => {
          const point = path.getPointAtLength((length * index) / (count - 1));
          return svgPoint(element, point.x, point.y);
        });
        pathShape(points, /[zZ]\s*$/.test(part), parent, svgStyle(element, computed, opacity));
      });
    }

    function svgRect(element, parent, computed, opacity) {
      const x = number(element.getAttribute("x"));
      const y = number(element.getAttribute("y"));
      const width = number(element.getAttribute("width"));
      const height = number(element.getAttribute("height"));
      const corners = [
        svgPoint(element, x, y),
        svgPoint(element, x + width, y),
        svgPoint(element, x + width, y + height),
        svgPoint(element, x, y + height),
      ];
      const axisAligned =
        Math.abs(corners[0].y - corners[1].y) < 0.01 &&
        Math.abs(corners[1].x - corners[2].x) < 0.01;
      if (!axisAligned) {
        pathShape(corners, true, parent, svgStyle(element, computed, opacity));
        return;
      }
      const frame = normalizedRect(element.getBoundingClientRect());
      if (frame) {
        const style = svgStyle(element, computed, opacity);
        const matrix = element.getScreenCTM();
        const radiusScale = matrix
          ? (Math.hypot(matrix.a, matrix.b) + Math.hypot(matrix.c, matrix.d)) / 2
          : 1;
        const bounds = element.getBoundingClientRect();
        style.radius = bounded(
          (Math.max(number(element.getAttribute("rx")), number(element.getAttribute("ry"))) *
            radiusScale) /
            Math.max(1, Math.min(bounds.width, bounds.height)),
          0,
          0.5,
        );
        push({ type: "rect", parent, ...frame, style });
      }
    }

    function svgEllipse(element, parent, computed, opacity) {
      const matrix = element.getScreenCTM();
      if (matrix && (Math.abs(matrix.b) > 0.001 || Math.abs(matrix.c) > 0.001)) {
        const circle = element.localName === "circle";
        const centerX = number(element.getAttribute("cx"));
        const centerY = number(element.getAttribute("cy"));
        const radiusX = number(element.getAttribute(circle ? "r" : "rx"));
        const radiusY = number(element.getAttribute(circle ? "r" : "ry"));
        const points = Array.from({ length: 32 }, (_unused, index) => {
          const angle = (Math.PI * 2 * index) / 32;
          return svgPoint(
            element,
            centerX + radiusX * Math.cos(angle),
            centerY + radiusY * Math.sin(angle),
          );
        });
        pathShape(points, true, parent, svgStyle(element, computed, opacity));
        return;
      }
      const frame = normalizedRect(element.getBoundingClientRect());
      if (frame) {
        push({ type: "ellipse", parent, ...frame, style: svgStyle(element, computed, opacity) });
      }
    }

    function svgLine(element, parent, computed, opacity) {
      const one = svgPoint(
        element,
        number(element.getAttribute("x1")),
        number(element.getAttribute("y1")),
      );
      const two = svgPoint(
        element,
        number(element.getAttribute("x2")),
        number(element.getAttribute("y2")),
      );
      const [x1, y1] = normalizedPoint(one);
      const [x2, y2] = normalizedPoint(two);
      const marker = computed.markerEnd !== "none" || element.hasAttribute("marker-end");
      push({
        type: marker ? "arrow" : "line",
        parent,
        x1,
        y1,
        x2,
        y2,
        style: svgStyle(element, computed, opacity),
      });
    }

    function svgPoly(element, parent, computed, opacity) {
      const points = [...element.points].map((point) => svgPoint(element, point.x, point.y));
      if (points.length > MAX_PATH_POINTS) {
        throw new CaptureError(`An SVG path exceeds the ${MAX_PATH_POINTS}-point detach limit`);
      }
      pathShape(
        points,
        element.localName === "polygon",
        parent,
        svgStyle(element, computed, opacity),
      );
    }

    function svgText(element, parent, computed, opacity) {
      const value = (element.textContent || "").replaceAll(/\s+/g, " ").trim();
      if (!value) {
        return;
      }
      const frame = normalizedRect(element.getBoundingClientRect());
      if (!frame) {
        throw new CaptureError("Visible SVG text falls outside the detachable slide area");
      }
      const matrix = element.getScreenCTM();
      const style = textStyle(computed, opacity);
      const nextFrame = { ...frame };
      if (matrix) {
        const textScale = (Math.hypot(matrix.a, matrix.b) + Math.hypot(matrix.c, matrix.d)) / 2;
        style.fontSize *= textScale;
        style.letterSpacing *= textScale;
        nextFrame.rotation = (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI;
      }
      addText(value, nextFrame, parent, style);
    }

    function svgNode(element, parent, depth, ancestorOpacity) {
      visit();
      if (depth > MAX_DEPTH) {
        throw new CaptureError(`This component exceeds the ${MAX_DEPTH}-level detach limit`);
      }
      const computed = getComputedStyle(element);
      if (!visible(element, computed) || SKIP_SVG.has(element.localName)) {
        return;
      }
      const opacity = ancestorOpacity * bounded(number(computed.opacity, 1));
      if (UNSUPPORTED_SVG.has(element.localName)) {
        throw new CaptureError(
          `SVG <${element.localName}> cannot be detached into editable shapes`,
        );
      }
      const local = element.localName;
      if (local === "svg" || local === "g" || local === "a" || local === "switch") {
        const frame = normalizedRect(element.getBoundingClientRect());
        const group = frame ? push({ type: "group", parent }) : parent;
        [...element.children].forEach((child) => svgNode(child, group, depth + 1, opacity));
        return;
      }
      if (local === "rect") {
        svgRect(element, parent, computed, opacity);
      } else if (local === "circle" || local === "ellipse") {
        svgEllipse(element, parent, computed, opacity);
      } else if (local === "line") {
        svgLine(element, parent, computed, opacity);
      } else if (local === "polyline" || local === "polygon") {
        svgPoly(element, parent, computed, opacity);
      } else if (local === "path") {
        svgPath(element, parent, computed, opacity);
      } else if (local === "text") {
        svgText(element, parent, computed, opacity);
      } else {
        throw new CaptureError(`SVG <${local}> cannot be detached into editable shapes`);
      }
    }

    function htmlNode(element, parent, clip, depth, ancestorOpacity) {
      if (exclude && element.matches(exclude)) {
        return;
      }
      visit();
      if (depth > MAX_DEPTH) {
        throw new CaptureError(`This component exceeds the ${MAX_DEPTH}-level detach limit`);
      }
      const computed = getComputedStyle(element);
      if (!visible(element, computed)) {
        return;
      }
      if (element.shadowRoot) {
        throw new CaptureError("Shadow DOM content cannot be detached safely");
      }
      if (element.localName === "img" && includeImages) {
        const frame = normalizedRect(element.getBoundingClientRect(), clip);
        const source = element.currentSrc || element.src || "";
        if (!source) {
          throw new CaptureError("An image has no embedded source");
        }
        if (frame) {
          push({ type: "image", parent, ...frame, source });
        }
        return;
      }
      if (UNSUPPORTED_HTML.has(element.localName)) {
        throw new CaptureError(
          `<${element.localName}> content cannot be detached into editable shapes`,
        );
      }
      if (element.namespaceURI === SVG_NS) {
        svgNode(element, parent, depth, ancestorOpacity);
        return;
      }
      if (computed.transform !== "none") {
        let transform;
        try {
          transform = new DOMMatrix(computed.transform);
        } catch {
          throw new CaptureError("A CSS transform cannot be represented as editable geometry");
        }
        if (!transform.is2D || Math.abs(transform.b) > 0.001 || Math.abs(transform.c) > 0.001) {
          throw new CaptureError("Rotated or skewed HTML cannot be detached safely");
        }
      }
      const opacity = ancestorOpacity * bounded(number(computed.opacity, 1));
      const bounds = element.getBoundingClientRect();
      const elementRect = normalizedRect(bounds, clip);
      if (!elementRect) {
        [...element.childNodes].forEach((child) => {
          if (child.nodeType === Node.TEXT_NODE) {
            htmlText(child, parent, clip, computed, opacity);
          } else if (child.nodeType === Node.ELEMENT_NODE) {
            htmlNode(child, parent, clip, depth + 1, opacity);
          }
        });
        return;
      }
      const boxStyle = htmlStyle(element, computed, bounds);
      const group = meaningfulGroup(element, boxStyle) ? push({ type: "group", parent }) : parent;
      if (hasBox(boxStyle)) {
        pushBox(elementRect, group, { ...boxStyle, opacity });
      }
      pseudoElement(element, "::before", group, clip, opacity);
      const childClip = clipFor(element, clip, computed);
      if (!childClip) {
        return;
      }
      formValue(element, group, childClip, computed, opacity);
      [...element.childNodes].forEach((child) => {
        if (child.nodeType === Node.TEXT_NODE) {
          htmlText(child, group, childClip, computed, opacity);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          htmlNode(child, group, childClip, depth + 1, opacity);
        }
      });
      pseudoElement(element, "::after", group, clip, opacity);
    }

    const hostRect = normalizedRect(host.getBoundingClientRect());
    if (!hostRect) {
      throw new CaptureError("The component is outside the visible slide area");
    }
    const animationCount =
      typeof host.getAnimations === "function"
        ? host
            .getAnimations({ subtree: true })
            .filter((animation) => animation.playState !== "finished").length
        : 0;
    if (animationCount) {
      warn("motion", "Motion was frozen at the currently visible frame");
    }
    const computed = getComputedStyle(host);
    if (!visible(host, computed)) {
      throw new CaptureError("The component must be visible before detaching it");
    }
    const root = push({ type: "group" });
    // The root record already represents the host; visit its presentation and
    // children without adding a second structural group for the same element.
    const hostBox = htmlStyle(host, computed, host.getBoundingClientRect());
    const hostOpacity = hostBox.opacity;
    if (hasBox(hostBox)) {
      pushBox(hostRect, root, hostBox);
    }
    pseudoElement(host, "::before", root, sectionRect, hostOpacity);
    const hostClip = clipFor(host, sectionRect, computed);
    if (!hostClip) {
      throw new CaptureError("The component has no visible detachable area");
    }
    formValue(host, root, hostClip, computed, hostOpacity);
    [...host.childNodes].forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        htmlText(child, root, hostClip, computed, hostOpacity);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        htmlNode(child, root, hostClip, 1, hostOpacity);
      }
    });
    pseudoElement(host, "::after", root, sectionRect, hostOpacity);

    if (shapes.length === 1) {
      throw new CaptureError("The component has no visible editable content to detach");
    }
    shapes.forEach((shape) => {
      if (shape.style) {
        ["fill", "stroke"].forEach((key) => {
          if (shape.style[key] != null) {
            shape.style[key] = portablePaint(shape.style[key]);
          }
        });
      }
    });
    return { root, shapes, warnings };
  }

  globalThis.ExplainerDetach = Object.freeze({ capture, CaptureError });
})();
