/* ── Diagram zoom ──────────────────────────────────────────────────────
   Every [data-zoom] element gets an expand button (also keyboard- and
   touch-reachable) that opens the diagram in a full-viewport overlay
   with wheel zoom, drag pan, pinch, and arrow-key panning. */
(function () {
  const targets = Array.prototype.slice.call(document.querySelectorAll("[data-zoom]"));
  if (targets.length === 0) {
    return;
  }
  let overlay,
    canvas,
    content,
    levelEl,
    opener = null;
  let scale = 1,
    tx = 0,
    ty = 0,
    baseW = 0,
    baseH = 0;
  const MIN_Z = 0.4,
    MAX_Z = 8;

  function elementName(element) {
    return String(element.localName || element.tagName || "").toLowerCase();
  }

  function sourceFor(target) {
    let src = null;
    for (let i = 0; i < target.children.length; i++) {
      const child = target.children[i];
      if (elementName(child) === "svg" || elementName(child) === "img") {
        src = child;
        break;
      }
      if (child.querySelector && child.querySelector("svg")) {
        src = child;
        break;
      }
    }
    return src || target.querySelector("svg, img") || target;
  }

  targets.forEach((t) => {
    var b = document.createElement("button");
    const openLabel = elementName(sourceFor(t)) === "img" ? "Expand image" : "Expand diagram";
    b.type = "button";
    b.className = "zoom-open";
    b.setAttribute("aria-label", openLabel);
    b.title = openLabel;
    b.textContent = "⤢";
    b.addEventListener("click", function (e) {
      e.stopPropagation();
      open(t, b);
    });
    t.appendChild(b);
  });

  function build() {
    overlay = document.createElement("div");
    overlay.className = "zoom-overlay";
    overlay.tabIndex = -1;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Diagram, zoomed");
    canvas = document.createElement("div");
    canvas.className = "zoom-canvas";
    overlay.append(canvas);
    const hud = document.createElement("div");
    hud.className = "zoom-hud";
    hud.append(
      hudBtn("−", "Zoom out", () => {
        zoomBy(1 / 1.4);
      }),
    );
    levelEl = document.createElement("span");
    levelEl.className = "zoom-level";
    hud.append(levelEl);
    hud.append(
      hudBtn("+", "Zoom in", () => {
        zoomBy(1.4);
      }),
    );
    hud.append(hudBtn("⟲", "Reset zoom", reset));
    hud.append(hudBtn("✕", "Close (Esc)", close));
    overlay.append(hud);
    const hint = document.createElement("div");
    hint.className = "zoom-hint";
    hint.textContent = "scroll to zoom · drag to pan · press 0 to reset · esc closes";
    overlay.append(hint);
    document.body.append(overlay);
    bindGestures();
  }
  function hudBtn(label, name, fn) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.setAttribute("aria-label", name);
    b.title = name;
    b.addEventListener("click", fn);
    return b;
  }

  function open(target, btn) {
    if (!overlay) {
      build();
    }
    opener = btn || null;
    // For mixed HTML+SVG diagrams (e.g. data-flow: HTML nodes + two SVG
    // Layers), cloning just the first <svg> loses the nodes and markers.
    // Prefer the first direct child that contains an SVG — that's the visual
    // Canvas container — and fall back to the first svg/img for pure-SVG or
    // Image diagrams.
    const src = sourceFor(target);
    const imageSource = elementName(src) === "img";
    content = src.cloneNode(true);
    overlay.setAttribute("aria-label", imageSource ? "Image, zoomed" : "Diagram, zoomed");
    const zb = content.querySelector && content.querySelector(".zoom-open");
    if (zb) {
      zb.remove();
    }
    // Fit-to-viewport base size from the source's aspect ratio, so 100%
    // Zoom already fills the room — the wheel goes further.
    const r = src.getBoundingClientRect();
    const sourceW = imageSource && src.naturalWidth ? src.naturalWidth : r.width;
    const sourceH = imageSource && src.naturalHeight ? src.naturalHeight : r.height;
    const aspect = sourceW && sourceH ? sourceW / sourceH : 16 / 9;
    baseW = Math.min(
      window.innerWidth * 0.88,
      window.innerHeight * 0.82 * aspect,
      imageSource ? sourceW : Number.POSITIVE_INFINITY,
    );
    baseH = baseW / aspect;
    if (imageSource) {
      content.style.objectFit = "contain";
      content.style.objectPosition = "50% 50%";
    }
    content.style.width = `${baseW}px`;
    content.style.height = `${baseH}px`;
    canvas.innerHTML = "";
    canvas.append(content);
    scale = 1;
    tx = 0;
    ty = 0;
    apply();
    overlay.classList.add("open");
    overlay.focus();
    if (typeof MOTION !== "undefined" && MOTION) {
      MOTION.animate(
        content,
        { opacity: [0, 1], transform: ["scale(0.94)", "scale(1)"] },
        { duration: 0.35, ease: [0.16, 1, 0.3, 1] },
      );
      setTimeout(apply, 360); // Hand transform back to the pan/zoom state
    }
  }
  function close() {
    overlay.classList.remove("open");
    canvas.innerHTML = "";
    content = null;
    if (opener) {
      opener.focus();
      opener = null;
    }
  }
  function apply() {
    if (!content) {
      return;
    }
    content.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`;
    levelEl.textContent = `${Math.round(scale * 100)}%`;
  }
  function reset() {
    scale = 1;
    tx = 0;
    ty = 0;
    apply();
  }
  function zoomBy(f, cx, cy) {
    const ns = Math.min(MAX_Z, Math.max(MIN_Z, scale * f));
    f = ns / scale;
    if (typeof cx === "number") {
      // Keep the point under the cursor fixed while zooming
      const vx = cx - window.innerWidth / 2,
        vy = cy - window.innerHeight / 2;
      tx = vx - (vx - tx) * f;
      ty = vy - (vy - ty) * f;
    }
    scale = ns;
    apply();
  }

  // Aria-modal="true" means focus must not escape to the page behind the
  // Overlay while it's open — the only focusable elements inside are the
  // HUD buttons, so Tab/Shift+Tab just cycles among them.
  function trapTab(e) {
    const focusables = Array.prototype.slice.call(overlay.querySelectorAll("button"));
    if (focusables.length === 0) {
      return;
    }
    const idx = focusables.indexOf(document.activeElement);
    const next = e.shiftKey
      ? focusables[idx <= 0 ? focusables.length - 1 : idx - 1]
      : focusables[idx === -1 || idx === focusables.length - 1 ? 0 : idx + 1];
    e.preventDefault();
    next.focus();
  }

  function bindGestures() {
    overlay.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        zoomBy(e.deltaY < 0 ? 1.13 : 1 / 1.13, e.clientX, e.clientY);
      },
      { passive: false },
    );
    overlay.addEventListener("dblclick", (e) => {
      zoomBy(1.6, e.clientX, e.clientY);
    });

    const pointers = new Map();
    let lastPinch = 0;
    overlay.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".zoom-hud")) {
        return;
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      overlay.setPointerCapture(e.pointerId);
      overlay.classList.add("dragging");
    });
    overlay.addEventListener("pointermove", (e) => {
      var p = pointers.get(e.pointerId);
      if (!p) {
        return;
      }
      if (pointers.size === 2) {
        var pts = [...pointers.values()];
        var d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (lastPinch) {
          zoomBy(d / lastPinch, (pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
        }
        lastPinch = d;
      } else {
        tx += e.clientX - p.x;
        ty += e.clientY - p.y;
        apply();
      }
      p.x = e.clientX;
      p.y = e.clientY;
    });
    function up(e) {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) {
        lastPinch = 0;
      }
      if (pointers.size === 0) {
        overlay.classList.remove("dragging");
      }
    }
    overlay.addEventListener("pointerup", up);
    overlay.addEventListener("pointercancel", up);

    overlay.addEventListener("keydown", (e) => {
      var PAN = 60;
      switch (e.key) {
        case "Escape": {
          close();
          break;
        }
        case "+":
        case "=": {
          zoomBy(1.3);
          break;
        }
        case "-":
        case "_": {
          zoomBy(1 / 1.3);
          break;
        }
        case "0": {
          reset();
          break;
        }
        case "ArrowLeft": {
          tx += PAN;
          apply();
          break;
        }
        case "ArrowRight": {
          tx -= PAN;
          apply();
          break;
        }
        case "ArrowUp": {
          ty += PAN;
          apply();
          break;
        }
        case "ArrowDown": {
          ty -= PAN;
          apply();
          break;
        }
        case "Tab": {
          trapTab(e);
          return;
        } // trapTab calls preventDefault itself when it acts
        default: {
          return;
        }
      }
      e.preventDefault();
      e.stopPropagation();
    });
  }

  window.__zoom = {
    close,
    count: targets.length,
    open(i) {
      var t = targets[i || 0];
      if (t) {
        open(t, t.querySelector(".zoom-open"));
      }
    },
    state() {
      return {
        open: Boolean(overlay && overlay.classList.contains("open")),
        scale,
        tx,
        ty,
      };
    },
  };
})();
