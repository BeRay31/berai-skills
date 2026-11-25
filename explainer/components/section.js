/* Component: section — full-bleed cover and chapter compositions.
   The pattern owns one side of the frame; copy keeps a protected quiet field.
   Use layout:'cover' in the Present manifest so the composition reaches the
   viewport edges instead of sitting inside the ordinary slide measure. */
function renderSection(sel, data) {
  const host = kitMount(sel);
  kitValidateTextCaps(host, "renderSection", data);
  const mode = data.mode || "chapter";
  const allowedModes = ["cover", "chapter"];
  const allowedPatterns = ["ribbons", "dots", "arcs", "iso", "waves", "frames", "rays", "swarm"];
  /* Retired in kit v3.4.0: the flat CSS grid and the blobby contour rings both
     read as filler beside the wireframe fields that replaced them. Old sources
     and saved studio swaps resolve to the closest survivor with a printed note
     rather than dying — see base/compat.js for the same policy on renderers. */
  const retiredPatterns = { contours: "arcs", grid: "iso" };
  function resolvePattern(value) {
    const successor = retiredPatterns[value];
    if (!successor) {
      return value;
    }
    console.warn(
      `[explainer] renderSection: pattern '${value}' was retired in kit v3.4.0 — ` +
        `rendering '${successor}'. Update your source to silence this.`,
    );
    return successor;
  }
  if (!data.__kitAdjusted) {
    const adjustment = globalThis.ExplainerKit.registerAdjustments(host, {
      base: data,
      defaults: {
        layout: data.layout || "split",
        pattern: resolvePattern(data.pattern || "ribbons"),
      },
      label: data.ariaLabel || "Section slide",
      options: [
        {
          key: "layout",
          label: "Layout",
          type: "choice",
          choices: ["split", "centered"],
          choiceLabels: { split: "Split", centered: "Centered" },
          choiceDescriptions: {
            split: "Protected copy field beside the visual",
            centered: "Title-led composition over the visual field",
          },
        },
        {
          key: "pattern",
          label: "Background pattern",
          type: "choice",
          choices: allowedPatterns.slice(),
        },
      ],
      apply(state) {
        return renderSection(host, {
          ...host.__kitAdjustments.base,
          layout: state.layout,
          pattern: resolvePattern(state.pattern),
          __kitAdjusted: true,
          __kitMotionPreset: host.dataset.motionPreset || "normal",
        });
      },
    });
    if (!adjustment.sectionPatternCompat) {
      const setAdjustment = adjustment.entry.set.bind(adjustment.entry);
      adjustment.entry.set = function set(key, value) {
        return setAdjustment(key, key === "pattern" ? resolvePattern(value) : value);
      };
      adjustment.sectionPatternCompat = true;
    }
    data = {
      ...adjustment.base,
      layout: adjustment.state.layout,
      pattern: resolvePattern(adjustment.state.pattern),
      __kitAdjusted: true,
    };
  }
  const pattern = resolvePattern(data.pattern || "ribbons");
  const layout = data.layout || "split";
  if (!allowedModes.includes(mode)) {
    throw new Error('renderSection: mode must be "cover" or "chapter"');
  }
  if (!allowedPatterns.includes(pattern)) {
    throw new Error("renderSection: pattern must be one of " + allowedPatterns.join(", "));
  }
  if (!["split", "centered"].includes(layout)) {
    throw new Error('renderSection: layout must be "split" or "centered"');
  }
  if (!data.title) {
    throw new Error("renderSection: title is required");
  }
  const details = data.details || [];
  if (!Array.isArray(details) || details.length > 4) {
    throw new Error("renderSection: details supports at most 4 lines");
  }

  allowedPatterns.forEach((name) => host.classList.remove("ksc-pattern-" + name));
  host.classList.remove("ksc-cover", "ksc-chapter");
  host.classList.add("ksc", "ksc-" + mode, "ksc-pattern-" + pattern);
  host.dataset.layout = layout;
  host.__kitBase = { ...data, kind: "section", layout, mode, pattern };
  host.setAttribute("role", "img");
  host.setAttribute("aria-label", data.ariaLabel || String(data.title));

  /* ── wireframe fields (arcs, iso, waves, frames, rays, swarm) ────────────
     All six are hairline SVG geometry on the pattern side of the frame, drawn
     in one shared viewBox. 'slice' lets the geometry run off the edges at any
     aspect instead of shrinking to fit, and every stroke reads through theme
     tokens so the field survives a theme flip — which is exactly where the
     blurred-glass candidate this replaced fell apart. Exactly one element per
     field carries --accent; the rest are neutral. Two rules were learned the
     expensive way in the lab: --text 17% (the counter tone) vanishes on a
     light ground, so a field cannot build its bulk from it; and .ksc-plane's
     translucent fill does not survive stacking — six nested planes summed into
     a solid slab, so nested shapes are stroke-only. */
  const SVG_NS = "http://www.w3.org/2000/svg";
  const FIELD_W = 940;
  const FIELD_H = 720;
  function svgNode(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (key) {
      node.setAttribute(key, String(attrs[key]));
    });
    return node;
  }
  function wireField() {
    const holder = kitEl("div", "ksc-wire");
    const svg = svgNode("svg", {
      preserveAspectRatio: "xMidYMid slice",
      viewBox: `0 0 ${FIELD_W} ${FIELD_H}`,
    });
    holder.append(svg);
    return { holder, svg };
  }
  /* Seeded, so a stochastic field is reproducible: an unseeded Math.random()
     would redraw differently on every load, and no screenshot gate — nor a
     studio preview a reviewer looks at twice — could hold still. */
  /* `>>> 0` coerces to uint32 here; Math.trunc keeps the sign and the
     generator stops wrapping. */
  function seededRandom(seed) {
    let state = seed >>> 0;
    return function next() {
      state = (state + 0x6d_2b_79_f5) >>> 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };
  }
  function wireLine(svg, className, attrs, order, length) {
    const line = svgNode("line", { class: className, ...attrs });
    line.style.setProperty("--ksc-order", String(order));
    line.style.setProperty("--ksc-len", length.toFixed(1));
    svg.append(line);
    return line;
  }
  function wirePolyline(svg, className, points, order, closed) {
    let length = 0;
    for (let index = 1; index < points.length; index++) {
      length += Math.hypot(
        points[index][0] - points[index - 1][0],
        points[index][1] - points[index - 1][1],
      );
    }
    if (closed) {
      length += Math.hypot(points[0][0] - points.at(-1)[0], points[0][1] - points.at(-1)[1]);
    }
    const shape = svgNode(closed ? "polygon" : "polyline", {
      class: className,
      points: points.map((point) => point[0].toFixed(1) + "," + point[1].toFixed(1)).join(" "),
    });
    shape.style.setProperty("--ksc-order", String(order));
    shape.style.setProperty("--ksc-len", length.toFixed(1));
    svg.append(shape);
    return shape;
  }
  /* Square, never round: nodes are marks on the geometry, not bullets. */
  function wireNode(svg, x, y, order, dim) {
    const mark = svgNode("rect", {
      class: "ksc-node" + (dim ? " ksc-node-dim" : ""),
      height: 8,
      width: 8,
      x: (x - 4).toFixed(1),
      y: (y - 4).toFixed(1),
    });
    mark.style.setProperty("--ksc-order", String(order));
    svg.append(mark);
  }
  function drawArcs() {
    const field = wireField();
    /* A dense quarter-sweep family off the lower right, crossed by a sparse
       counter family off the upper left so no corner of the field is dead. */
    const families = [
      { centre: [985, 786], from: Math.PI, live: 3, radii: [250, 372, 494, 616, 738, 860, 982] },
      { centre: [-130, -96], counter: true, from: 0, live: -1, radii: [430, 574, 718] },
    ];
    let order = 0;
    families.forEach(function (family) {
      const [cx, cy] = family.centre;
      family.radii.forEach(function (radius, index) {
        const end = family.from + Math.PI / 2;
        const live = index === family.live;
        const arc = svgNode("path", {
          class:
            "ksc-arc" + (live ? " ksc-arc-live" : "") + (family.counter ? " ksc-arc-counter" : ""),
          d:
            `M ${(cx + radius * Math.cos(family.from)).toFixed(1)} ` +
            `${(cy + radius * Math.sin(family.from)).toFixed(1)} ` +
            `A ${radius} ${radius} 0 0 1 ${(cx + radius * Math.cos(end)).toFixed(1)} ` +
            `${(cy + radius * Math.sin(end)).toFixed(1)}`,
        });
        arc.style.setProperty("--ksc-order", String(order++));
        /* The dash pair and offset are the draw-on: CSS animates only the
           offset, so the length has to travel with the geometry. */
        arc.style.setProperty("--ksc-len", ((Math.PI * radius) / 2).toFixed(1));
        field.svg.append(arc);
      });
    });
    function pointOn(family, radius, along) {
      const angle = family.from + (Math.PI / 2) * along;
      return [
        family.centre[0] + radius * Math.cos(angle),
        family.centre[1] + radius * Math.sin(angle),
      ];
    }
    const main = families[0];
    [0.34, 0.72].forEach(function (along, index) {
      const [x, y] = pointOn(main, main.radii[main.live], along);
      wireNode(field.svg, x, y, index, false);
    });
    /* Kept well right of the legibility gradient, which would wash it out. */
    const counter = families[1];
    const [nx, ny] = pointOn(counter, counter.radii[2], 0.2);
    wireNode(field.svg, nx, ny, 2, true);
    return field.holder;
  }
  function drawIso() {
    const field = wireField();
    /* A stack of isometric planes: angular depth from hairlines and a faint
       tint, so there is no blurred surface to wash out on a light ground. */
    const CX = 530;
    const CY = 366;
    const HALF_W = 336;
    const HALF_H = 168;
    const GAP = 80;
    const PLANES = 5;
    const LIVE = 1;
    const centreOf = (index) => CY + (index - (PLANES - 1) / 2) * GAP;
    const cornersOf = (centre) => [
      [CX, centre - HALF_H],
      [CX + HALF_W, centre],
      [CX, centre + HALF_H],
      [CX - HALF_W, centre],
    ];
    /* Struts first so the plane edges sit on top of them. */
    cornersOf(0).forEach(function (corner) {
      field.svg.append(
        svgNode("line", {
          class: "ksc-strut",
          x1: corner[0],
          x2: corner[0],
          y1: (centreOf(0) + corner[1]).toFixed(1),
          y2: (centreOf(PLANES - 1) + corner[1]).toFixed(1),
        }),
      );
    });
    for (let index = 0; index < PLANES; index++) {
      const plane = svgNode("polygon", {
        class: "ksc-plane" + (index === LIVE ? " ksc-plane-live" : ""),
        points: cornersOf(centreOf(index))
          .map((corner) => corner.map((value) => value.toFixed(1)).join(","))
          .join(" "),
      });
      plane.style.setProperty("--ksc-order", String(index));
      plane.style.setProperty("--ksc-len", (4 * Math.hypot(HALF_W, HALF_H)).toFixed(1));
      field.svg.append(plane);
    }
    const live = cornersOf(centreOf(LIVE));
    wireNode(field.svg, live[1][0], live[1][1], 0, false);
    wireNode(field.svg, live[0][0], live[0][1], 1, false);
    const floor = cornersOf(centreOf(PLANES - 1))[3];
    wireNode(field.svg, floor[0], floor[1], 2, true);
    return field.holder;
  }
  function drawWaves() {
    const field = wireField();
    /* Stacked signal traces, each phase-shifted, so the field reads as flow
       rather than as a set of parallel lines. */
    const TRACES = 7;
    const AMPLITUDE = 44;
    const WAVELENGTH = 430;
    const LIVE = 3;
    const centreOf = (index) => 86 + index * 92;
    for (let index = 0; index < TRACES; index++) {
      const points = [];
      for (let x = -60; x <= FIELD_W + 60; x += 10) {
        points.push([
          x,
          centreOf(index) + AMPLITUDE * Math.sin((2 * Math.PI * x) / WAVELENGTH + index * 0.62),
        ]);
      }
      wirePolyline(
        field.svg,
        "ksc-arc" + (index === LIVE ? " ksc-arc-live" : index % 2 ? " ksc-arc-counter" : ""),
        points,
        index,
        false,
      );
    }
    const crestAt = (cycle) => WAVELENGTH * (cycle + 0.25 - (LIVE * 0.62) / (2 * Math.PI));
    [1, 2].forEach(function (cycle, index) {
      wireNode(field.svg, crestAt(cycle), centreOf(LIVE) - AMPLITUDE, index, false);
    });
    wireNode(field.svg, crestAt(1), centreOf(TRACES - 1) - AMPLITUDE, 2, true);
    return field.holder;
  }
  function drawFrames() {
    const field = wireField();
    /* Nested frames receding toward an off-centre vanishing point, corners
       railed so the field reads as one recession rather than as concentric
       rectangles. Stroke-only: see the fill note above. */
    /* The vanishing point sits well off centre, and the outer frames run past
       the viewBox: centred and sized to fit, the recession closed into a
       symmetric box that read as a border round the slide, not as a field. */
    const VANISH_X = 812;
    const VANISH_Y = 158;
    const RINGS = 7;
    const LIVE = 3;
    const OUTER_HW = 900;
    const OUTER_HH = 700;
    const CX = 500;
    const CY = 352;
    const frameOf = function (index) {
      const scale = 0.72 ** index;
      const cx = VANISH_X + (CX - VANISH_X) * scale;
      const cy = VANISH_Y + (CY - VANISH_Y) * scale;
      const hw = OUTER_HW * scale;
      const hh = OUTER_HH * scale;
      return [
        [cx - hw, cy - hh],
        [cx + hw, cy - hh],
        [cx + hw, cy + hh],
        [cx - hw, cy + hh],
      ];
    };
    /* Rails first so the frame edges sit on top of them. */
    for (let corner = 0; corner < 4; corner++) {
      const near = frameOf(0)[corner];
      const far = frameOf(RINGS - 1)[corner];
      field.svg.append(
        svgNode("line", { class: "ksc-strut", x1: near[0], x2: far[0], y1: near[1], y2: far[1] }),
      );
    }
    for (let index = 0; index < RINGS; index++) {
      wirePolyline(
        field.svg,
        "ksc-arc" + (index === LIVE ? " ksc-arc-live" : index % 2 ? " ksc-arc-counter" : ""),
        frameOf(index),
        index,
        true,
      );
    }
    const live = frameOf(LIVE);
    wireNode(field.svg, live[1][0], live[1][1], 0, false);
    wireNode(field.svg, live[3][0], live[3][1], 1, false);
    const inner = frameOf(RINGS - 1)[2];
    wireNode(field.svg, inner[0], inner[1], 2, true);
    return field.holder;
  }
  function drawRays() {
    const field = wireField();
    /* A fan whose vanishing point is parked outside the viewBox: the field
       shows the spread and never the sunburst hub. */
    const ORIGIN_X = 1140;
    const ORIGIN_Y = 940;
    const LENGTH = 1900;
    /* Wide cover aspects crop the fan hard: at 16 rays over 80° a Present
       slide showed four diagonals. More rays over a wider sweep keep the
       spread readable at every aspect. */
    const COUNT = 24;
    const FROM = 176;
    const TO = 272;
    const LIVE = 9;
    const angleAt = (index) => ((FROM + ((TO - FROM) * index) / (COUNT - 1)) * Math.PI) / 180;
    for (let index = 0; index < COUNT; index++) {
      const angle = angleAt(index);
      wireLine(
        field.svg,
        "ksc-arc" + (index === LIVE ? " ksc-arc-live" : index % 3 === 1 ? " ksc-arc-counter" : ""),
        {
          x1: ORIGIN_X,
          x2: (ORIGIN_X + LENGTH * Math.cos(angle)).toFixed(1),
          y1: ORIGIN_Y,
          y2: (ORIGIN_Y + LENGTH * Math.sin(angle)).toFixed(1),
        },
        index,
        LENGTH,
      );
    }
    const along = function (angle, fraction) {
      return [
        ORIGIN_X + LENGTH * fraction * Math.cos(angle),
        ORIGIN_Y + LENGTH * fraction * Math.sin(angle),
      ];
    };
    [0.58, 0.83].forEach(function (fraction, index) {
      const [x, y] = along(angleAt(LIVE), fraction);
      wireNode(field.svg, x, y, index, false);
    });
    const [dimX, dimY] = along(angleAt(13), 0.7);
    wireNode(field.svg, dimX, dimY, 2, true);
    return field.holder;
  }
  function drawSwarm() {
    const field = wireField();
    /* A population large enough to read as volume, swept onto three
       logarithmic arms. The arms are stated once as hairlines and implied
       everywhere by density; jitter runs perpendicular to the arm and grows
       with radius, which is what keeps the core tight and the rim loose. */
    const MOTES = 760;
    const ARMS = 3;
    const CX = 606;
    const CY = 340;
    const CORE = 26;
    const TIGHTNESS = 2.35;
    const SWEEP = 3.9;
    const SPREAD = 150;
    const LIVE_ARM = 1;
    const armPoint = function (arm, t) {
      const angle = (arm / ARMS) * Math.PI * 2 + t * SWEEP;
      const radius = CORE * Math.exp(TIGHTNESS * t);
      return {
        angle,
        radius,
        x: CX + Math.cos(angle) * radius * 1.34,
        y: CY + Math.sin(angle) * radius,
      };
    };
    for (let arm = 0; arm < ARMS; arm++) {
      const points = [];
      for (let step = 0; step <= 40; step++) {
        const guide = armPoint(arm, step / 40);
        points.push([guide.x, guide.y]);
      }
      wirePolyline(
        field.svg,
        "ksc-arc" + (arm === LIVE_ARM ? " ksc-arc-live" : " ksc-arc-counter"),
        points,
        arm,
        false,
      );
    }
    const random = seededRandom(20_260_903);
    for (let index = 0; index < MOTES; index++) {
      const t = random() ** 0.62;
      const guide = armPoint(index % ARMS, t);
      const spread = SPREAD * (0.16 + t);
      const jitter = (random() - 0.5) * spread;
      const along = (random() - 0.5) * spread * 0.55;
      const size = 1.8 + (1 - t) * 4.4 + random() * 1.3;
      const normalX = Math.cos(guide.angle);
      const normalY = Math.sin(guide.angle);
      const mote = svgNode("rect", {
        class: "ksc-mote" + (index % 5 === 0 ? " ksc-mote-neutral" : ""),
        "fill-opacity": Math.min(0.95, 0.2 + (1 - t) * 0.72 + random() * 0.22).toFixed(2),
        height: size.toFixed(1),
        width: size.toFixed(1),
        x: (guide.x - normalY * jitter + normalX * along - size / 2).toFixed(1),
        y: (guide.y + normalX * jitter + normalY * along - size / 2).toFixed(1),
      });
      /* The stagger cycles rather than accumulating: 760 motes at the node
         step would take half a minute to finish arriving. */
      mote.style.setProperty("--ksc-order", ((index % 16) / 2).toFixed(2));
      field.svg.append(mote);
    }
    return field.holder;
  }

  const wireFields = {
    arcs: drawArcs,
    frames: drawFrames,
    iso: drawIso,
    rays: drawRays,
    swarm: drawSwarm,
    waves: drawWaves,
  };
  const backdrop = kitEl("div", "ksc-backdrop");
  backdrop.setAttribute("aria-hidden", "true");
  function drawPattern(nextPattern) {
    backdrop.replaceChildren();
    if (nextPattern === "ribbons") {
      const ribbons = kitEl("div", "ksc-ribbons");
      ["a", "b", "c", "d", "e", "f", "g"].forEach(function (name, index) {
        const ribbon = kitEl("i", "ksc-ribbon ksc-ribbon-" + name);
        ribbon.style.setProperty("--ksc-order", String(index));
        ribbons.append(ribbon);
      });
      backdrop.append(ribbons);
    } else if (wireFields[nextPattern]) {
      backdrop.append(wireFields[nextPattern]());
    } else {
      backdrop.append(kitEl("div", "ksc-field"));
    }
  }
  drawPattern(pattern);
  host.append(backdrop);

  // Presentation importers cannot reproduce the translucent CSS gradient that
  // normally keeps centered copy clear of the pattern. Keep an ordinary DOM
  // shape between the pattern and copy so export can create the same quiet zone
  // without relying on pseudo-element stacking.
  host.append(kitEl("div", "ksc-export-quiet-zone"));

  const content = kitEl("div", "ksc-content");
  if (data.kicker) {
    const kicker = kitEl("div", "ksc-kicker");
    String(data.kicker)
      .split("\n")
      .slice(0, 3)
      .forEach(function (line) {
        kicker.append(kitEl("span", null, null));
        kicker.lastChild.textContent = line;
      });
    content.append(kicker);
  }
  if (data.number) {
    const number = kitEl("div", "ksc-number");
    number.textContent = data.number;
    content.append(number);
  }
  const title = document.createElement(mode === "cover" ? "h1" : "h2");
  title.className = "ksc-title";
  title.textContent = data.title;
  content.append(title);
  if (data.sub) {
    const sub = kitEl("p", "ksc-sub");
    sub.textContent = data.sub;
    content.append(sub);
  }
  if (details.length) {
    const meta = kitEl("div", "ksc-details");
    details.forEach(function (detail) {
      const line = kitEl("span");
      line.textContent = detail;
      meta.append(line);
    });
    content.append(meta);
  }
  host.append(content);

  let motionPreset = data.__kitMotionPreset || "normal";
  host.dataset.motionPreset = motionPreset;
  function replay() {
    host.classList.remove("ksc-live");
    if (motionPreset === "off" || REDUCED_MOTION || window.__kitMeasuring) {
      host.classList.add("ksc-live");
      return;
    }
    host.getBoundingClientRect();
    host.classList.add("ksc-live");
  }
  function setMotionPreset(preset, shouldReplay) {
    if (!["calm", "normal", "off"].includes(preset)) {
      return false;
    }
    motionPreset = preset;
    host.dataset.motionPreset = preset;
    if (shouldReplay !== false && !document.body.classList.contains("presenting")) {
      replay();
    }
    return preset;
  }
  const motionEntries = (window.__kitMotionAdjustable = window.__kitMotionAdjustable || []);
  const motionEntry = {
    host,
    key: host.id || data.ariaLabel || "Section",
    label: data.ariaLabel || "Section",
    kind: "section",
    get() {
      return motionPreset;
    },
    set: setMotionPreset,
  };
  motionEntries.push(motionEntry);

  let observer = null;
  if (!document.body.classList.contains("presenting") && "IntersectionObserver" in window) {
    observer = new IntersectionObserver(
      function (entries) {
        if (entries.some((entry) => entry.isIntersecting)) {
          replay();
          observer.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(host);
  } else {
    host.classList.add("ksc-live");
  }
  host.__kitDispose = function __kitDispose() {
    if (observer) {
      observer.disconnect();
    }
    const index = motionEntries.indexOf(motionEntry);
    if (index !== -1) {
      motionEntries.splice(index, 1);
    }
  };
  return globalThis.ExplainerKit.stableDriver(host, {
    count: 1,
    current() {
      return 0;
    },
    go() {
      replay();
    },
  });
}
