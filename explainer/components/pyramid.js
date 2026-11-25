/* Component: pyramid — see references/CONTRACTS.md#pyramid.
   A layered test/maturity pyramid drawn as stacked trapezoids with
   leader-lined labels and per-layer flag dots. Geometry is generated for any
   number of layers. Reveals base → apex. Returns {count, go} for Present. */
function renderPyramid(sel, data) {
  const host = kitMount(sel);
  if (!data.__kitAdjusted) {
    const adjustment = globalThis.ExplainerKit.registerAdjustments(host, {
      base: data,
      defaults: { layout: data.layout || "pyramid" },
      label: data.ariaLabel || "Pyramid",
      options: [
        {
          key: "layout",
          label: "Layout",
          type: "choice",
          choices: ["pyramid", "ladder"],
          choiceLabels: { pyramid: "Pyramid", ladder: "Layer ladder" },
          choiceDescriptions: {
            pyramid: "Shape-first hierarchy from apex to base",
            ladder: "Readable layer-by-layer briefing",
          },
        },
      ],
      apply(state) {
        const current = host.__kitPresentDriver ? host.__kitPresentDriver.current() : 0;
        const driver = renderPyramid(host, {
          ...host.__kitAdjustments.base,
          layout: state.layout,
          __kitAdjusted: true,
        });
        driver.go(current);
        return driver;
      },
    });
    data = { ...adjustment.base, layout: adjustment.state.layout, __kitAdjusted: true };
  }
  kitValidateTextCaps(host, "renderPyramid", data);
  host.classList.add("kpy");
  host.dataset.layout = data.layout || "pyramid";
  host.dataset.zoom = "";
  if (host.dataset.layout !== "ladder") {
    host.removeAttribute("role");
    host.removeAttribute("aria-label");
  }
  const layers = data.layers || []; // Apex-first
  const n = layers.length;
  if (!n) {
    throw new Error("renderPyramid: data.layers is required");
  }
  if (n > 6) {
    throw new Error("renderPyramid: data.layers supports at most 6 layers, got " + n);
  }
  layers.forEach((layer, index) => {
    if (!String(layer.name == null ? "" : layer.name).trim()) {
      throw new Error("renderPyramid: layer " + (index + 1) + " name is required");
    }
  });
  const TONE = {
    success: "var(--success)",
    accent: "var(--accent)",
    warning: "var(--warning)",
    error: "var(--error)",
    violet: "var(--violet)",
  };
  if (data.layout === "ladder") {
    const driver = kpyRenderLadder(host, data, layers, TONE);
    const stable = globalThis.ExplainerKit.stableDriver(host, driver);
    globalThis.ExplainerKit.observeContentSpacing(host, () => {
      const step = stable.current();
      renderPyramid(host, { ...data, __kitAdjusted: true });
      stable.go(step);
    });
    return stable;
  }
  const ns = "http://www.w3.org/2000/svg";
  const contentSpacing = globalThis.ExplainerKit.contentSpacing();
  const W = 700,
    H = 380,
    cx = 330;
  const topY = 26,
    botY = 346,
    gap = 8 * contentSpacing;
  const minHalf = 12,
    maxHalf = 158;
  const labelX = 145,
    rightX = 530,
    dotX = 542;
  const bandH = n ? (botY - topY - gap * (n - 1)) / n : 0;
  function halfAt(y) {
    return minHalf + ((maxHalf - minHalf) * (y - topY)) / (botY - topY);
  }

  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "img");
  if (data.ariaLabel) {
    svg.setAttribute("aria-label", data.ariaLabel);
  }
  function add(parent, tag, attrs, text) {
    const e = document.createElementNS(ns, tag);
    Object.keys(attrs || {}).forEach((k) => {
      e.setAttribute(k, attrs[k]);
    });
    if (text != null) {
      e.textContent = text;
    }
    parent.append(e);
    return e;
  }

  const groups = [];
  layers.forEach((L, i) => {
    var yTop = topY + i * (bandH + gap);
    var yBot = yTop + bandH;
    var yMid = (yTop + yBot) / 2;
    var hT = halfAt(yTop),
      hB = halfAt(yBot);
    var g = add(svg, "g", { class: "kpy-row pr-frag" + (i === n - 1 ? " base" : "") });
    add(g, "polygon", {
      class: "kpy-shape",
      points:
        cx -
        hT +
        "," +
        yTop +
        " " +
        (cx + hT) +
        "," +
        yTop +
        " " +
        (cx + hB) +
        "," +
        yBot +
        " " +
        (cx - hB) +
        "," +
        yBot,
    });
    add(g, "text", { class: "kpy-name", x: labelX, y: yMid - 2, "text-anchor": "end" }, L.name);
    if (L.count) {
      add(
        g,
        "text",
        { class: "kpy-count", x: labelX, y: yMid + 14, "text-anchor": "end" },
        L.count,
      );
    }
    add(g, "line", { class: "kpy-leader", x1: labelX + 8, y1: yMid, x2: cx - hB + 4, y2: yMid });
    if (L.flag) {
      add(g, "line", { class: "kpy-leader", x1: cx + hB - 4, y1: yMid, x2: rightX, y2: yMid });
      var col = TONE[L.flag.tone] || "var(--text-dim)";
      add(g, "circle", { cx: dotX, cy: yMid, r: 2.6, fill: col });
      add(g, "text", { class: "kpy-flag", x: dotX + 10, y: yMid + 3, fill: col }, L.flag.label);
    }
    groups.push(g);
  });
  host.append(svg);

  // Reveal base → apex; outside Present the .pr-frag stays visible regardless
  const order = [...groups].toReversed();
  let current = 0;
  function go(i) {
    current = Math.max(0, Math.min(i, count - 1));
    order.forEach((g, k) => {
      g.classList.add("pr-on");
      g.classList.toggle("kpy-muted", current > 0 && k >= current);
    });
  }
  const count = groups.length + 1;
  go(count);
  const driver = { count, current: () => current, go };
  const stable = globalThis.ExplainerKit.stableDriver(host, driver);
  globalThis.ExplainerKit.observeContentSpacing(host, () => {
    const step = stable.current();
    renderPyramid(host, { ...data, __kitAdjusted: true });
    stable.go(step);
  });
  return stable;
}

function kpyRenderLadder(host, data, layers, tones) {
  host.setAttribute("role", "img");
  host.setAttribute("aria-label", data.ariaLabel || "Layer hierarchy from apex to base");
  const ladder = kitEl("div", "kpy-ladder");
  const groups = [];
  layers.forEach(function (layer, index) {
    const row = kitEl(
      "div",
      "kpy-ladder-row pr-frag" + (index === layers.length - 1 ? " base" : ""),
    );
    row.append(kitEl("span", "kpy-ladder-level", String(index + 1).padStart(2, "0")));
    const copy = kitEl("div", "kpy-ladder-copy");
    const name = kitEl("strong");
    name.textContent = layer.name;
    copy.append(name);
    if (layer.count) {
      const count = kitEl("span");
      count.textContent = layer.count;
      copy.append(count);
    }
    row.append(copy);
    if (layer.flag) {
      const flag = kitEl("span", "kpy-ladder-flag");
      flag.style.setProperty("--kpy-flag-tone", tones[layer.flag.tone] || "var(--text-dim)");
      flag.append(kitEl("i"));
      const label = document.createTextNode(
        String(layer.flag.label == null ? "" : layer.flag.label),
      );
      flag.append(label);
      row.append(flag);
    }
    ladder.append(row);
    groups.push(row);
  });
  host.append(ladder);

  const order = [...groups].toReversed();
  let current = 0;
  const count = groups.length + 1;
  function go(index) {
    current = Math.max(0, Math.min(index, count - 1));
    order.forEach((row, rowIndex) => {
      row.classList.add("pr-on");
      row.classList.toggle("kpy-muted", current > 0 && rowIndex >= current);
    });
  }
  go(count);
  return { count, current: () => current, go };
}
