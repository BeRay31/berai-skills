/* Component: chart — see references/CONTRACTS.md#chart.
   Lavish light on honest geometry, for the numbers an explainer carries:
   lines draw in, dots pop, numerals count up, accent marks glow — while the
   encoding stays thin and truthful (and the minimal style stays quiet).
   Kinds:
     line      — trend over time (2px line, end-dot, optional single-series wash)
     area      — same data shape as line, every series washed
     bars      — horizontal magnitude comparison (≤24px bars, 4px rounded data-end)
     dumbbell  — before → after per item (two dots on a hairline)
     split     — part-to-whole as one gapped horizontal bar
     histogram — a distribution over contiguous bins
     scatter   — two measured axes, emphasis via per-point tone
     heatmap   — a grid of magnitudes, one hue, more-is-stronger
     dots      — exact quantities as a finite field of countable units
     map       — where things happen in the world (needs the geo-world component)
     stat      — 1–4 big numerals that count up (the retired stat component, folded in)
     trace     — a request's time made visible: work/wait spans on a shared
                 time axis, with an optional before/after "race" replay
   Color grammar is EMPHASIS, not categorical: the subject series wears the
   accent, context series wear a recessive gray, and identity is carried by
   direct labels + a legend — never by a second hue. Status tones are allowed
   only when the color means status. Hover tooltips + keyboard focus ship by
   default; every chart renders a "view data" table twin. */
function kchAdjustableItems(data, kind) {
  if (kind === "line" || kind === "area") {
    return data.series || [];
  }
  if (kind === "scatter") {
    return data.points || [];
  }
  if (kind === "map") {
    return [...(data.regions || []), ...(data.pins || [])];
  }
  if (["bars", "dumbbell", "stat"].includes(kind)) {
    return data.items || [];
  }
  return [];
}

function kchItemAliases(item, kind) {
  const aliases = [item.label, item.id].filter((value) => value != null);
  if (kind === "map" && item.id != null) {
    const geo = globalThis.__kitGeo;
    const country = geo && geo.find(item.id);
    if (country) {
      aliases.push(country.name);
    }
  }
  return aliases;
}

function kchAdjustedData(data, state) {
  const kind = state.kind || data.kind || "line";
  const patch = {
    ...data,
    itemMode: state.items,
    kind,
    labels: state.labels,
    view: state.view,
    layout: state.layout,
  };
  if (state.items !== "key") {
    return patch;
  }
  const referenced = JSON.stringify(data.walkthrough || []);
  function keep(item) {
    return (
      item.key === true ||
      kchItemAliases(item, kind).some(function (alias) {
        return referenced.includes(JSON.stringify(alias));
      })
    );
  }
  if (kind === "line" || kind === "area") {
    patch.series = (data.series || []).filter(keep);
  }
  if (kind === "scatter") {
    patch.points = (data.points || []).filter(keep);
  }
  if (kind === "map") {
    patch.regions = (data.regions || []).filter(keep);
    patch.pins = (data.pins || []).filter(keep);
  }
  if (["bars", "dumbbell", "stat"].includes(kind)) {
    patch.items = (data.items || []).filter(keep);
  }
  return patch;
}

function kchLayoutOption(kind) {
  const layoutLabels = {
    bars: ["Shared axis", "Magnitude rail"],
    line: ["Shared plot", "Series briefing"],
    area: ["Shared plot", "Series briefing"],
    split: ["Part-to-whole bar", "Component ledger"],
    dumbbell: ["Shared axis", "Paired briefing"],
    histogram: ["Distribution plot", "Bin ledger"],
    heatmap: ["Matrix", "Row strips"],
    dots: ["Unit field", "Unit rows"],
    scatter: ["Relationship plot", "Point briefing"],
    map: ["Geographic view", "Location briefing"],
    stat: ["Metric lineup", "Lead metric"],
  };
  return {
    choices: ["chart", "briefing"],
    choiceLabels: {
      chart: (layoutLabels[kind] || ["Chart", "Briefing"])[0],
      briefing: (layoutLabels[kind] || ["Chart", "Briefing"])[1],
    },
    choiceDescriptions: {
      chart: "Overview · Compare the complete chart on one shared surface.",
      briefing: ["line", "area", "scatter", "map"].includes(kind)
        ? "Detailed briefing · Keep the plot in view while reading each authored series or location."
        : kind === "stat"
          ? "Opening statement · Lead with the first authored metric, with supporting readings beside it."
          : "Item briefing · Give each labeled group its own reading space without changing the measurements.",
    },
    key: "layout",
    label: "Layout",
    type: "choice",
  };
}

function renderChart(sel, data) {
  const host = kitMount(sel);
  if (!data.__skipTextCaps) {
    kitValidateTextCaps(host, "renderChart", data);
  }
  host.classList.add("kch");
  if (data.zoom !== false) {
    host.dataset.zoom = "";
  }
  let kind = data.kind || "line";
  const contentSpacing = globalThis.ExplainerKit.contentSpacing();
  if (!data.__kitAdjusted && !data.__architectureTrace && kind !== "trace") {
    const sourceItems = kchAdjustableItems(data, kind);
    const hasKeyItems = sourceItems.some((item) => item.key === true);
    const hasNumericFocus = (data.walkthrough || []).some(
      (step) => step.focus && typeof step.focus.item === "number",
    );
    const options = [kchLayoutOption(kind)];
    if (kind === "line" || kind === "area") {
      options.push({
        choices: ["line", "area"],
        choiceLabels: { line: "Line", area: "Area" },
        key: "kind",
        label: "Chart type",
        type: "choice",
      });
    }
    if (hasKeyItems && !hasNumericFocus) {
      options.push(
        {
          choices: ["key", "all"],
          choiceLabels: { key: "Key items", all: "All items" },
          key: "items",
          label: "Items",
          type: "choice",
        },
        {
          choices: ["key", "all"],
          choiceLabels: { key: "Key labels", all: "All labels" },
          key: "labels",
          label: "Labels",
          type: "choice",
        },
      );
    }
    if ((data.walkthrough || []).length) {
      options.push({
        choices: ["full", "follow"],
        choiceLabels: { full: "Full", follow: "Follow" },
        key: "view",
        label: "View",
        type: "choice",
      });
    }
    if (options.length) {
      const adjustment = globalThis.ExplainerKit.registerAdjustments(host, {
        base: data,
        defaults: {
          items: data.itemMode || "all",
          kind,
          layout: data.layout || "chart",
          labels: data.labels || "all",
          view: data.view || "follow",
        },
        label: data.ariaLabel || `${kind} chart`,
        options,
        apply(state) {
          const step = host.__kitChartStep;
          renderChart(host, {
            ...kchAdjustedData(host.__kitAdjustments.base, state),
            __kitAdjusted: true,
          });
          if (Number.isInteger(step)) {
            host.__kitChartHolder.go(step);
          }
        },
      });
      data = kchAdjustedData(adjustment.base, adjustment.state);
      kind = data.kind || "line";
    } else {
      host.__kitBase = data;
    }
  }
  host.dataset.labels = data.labels || "all";
  host.dataset.view = data.view || "follow";
  host.dataset.layout = data.layout || "chart";
  host.dataset.chartKind = kind;
  let unit = data.unit || "";
  let focusBriefing = null;

  const NS = "http://www.w3.org/2000/svg";
  function add(parent, tag, attrs, text) {
    const e = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach((k) => {
      e.setAttribute(k, attrs[k]);
    });
    if (text != null) {
      e.textContent = text;
    }
    parent.append(e);
    return e;
  }
  function toneClass(t, fallback) {
    return `kch-tone-${t || fallback || "accent"}`;
  }
  function fmt(v, display) {
    if (display != null) {
      return display;
    }
    const n = Number(v);
    if (!Number.isFinite(n)) {
      return String(v);
    }
    const abs = Math.abs(n);
    let s;
    function trim1(x) {
      return String(Math.round(x * 10) / 10);
    }
    if (abs >= 1e9) {
      s = trim1(n / 1e9) + "B";
    } else if (abs >= 1e6) {
      s = trim1(n / 1e6) + "M";
    } else if (abs >= 1e4) {
      s = trim1(n / 1e3) + "K";
    } else if (Number.isInteger(n)) {
      s = n.toLocaleString("en-US");
    } else {
      s = trim1(n);
    }
    return unit ? `${s} ${unit}` : s;
  }
  // Axis ticks carry clean numbers; a long unit ("fetches") would overflow
  // The margin, so it only rides ticks when it is short ("s", "GB")
  function fmtNum(v) {
    const keep = unit;
    unit = "";
    const s = fmt(v);
    unit = keep;
    return s;
  }
  function fmtTick(v) {
    const n = Number(v);
    let s;
    if (Math.abs(n) >= 1000) {
      s = String(Math.round(n / 100) / 10).replace(/\.0$/, "") + "K";
    } else {
      s = fmtNum(n);
    }
    return unit && unit.length <= 3 ? `${s} ${unit}` : s;
  }

  // Headline numerals count up when their mark arrives — the same move the
  // Stat component is loved for. Entries: {el, v, d(isplay), f(ormatter)}.
  function countUp(c) {
    const f =
      c.f ||
      function (x) {
        return fmt(x, null);
      };
    if (c.d != null) {
      c.el.textContent = fmt(c.v, c.d);
      return;
    }
    const n = Number(c.v);
    if (REDUCED_MOTION || !Number.isFinite(n)) {
      c.el.textContent = f(n);
      return;
    }
    const intg = Number.isInteger(n),
      dur = 900;
    let t0 = null;
    (function tick(ts) {
      if (!t0) {
        t0 = ts;
      }
      const p = Math.min(1, (ts - t0) / dur),
        eased = 1 - (1 - p) ** 3;
      const v = n * eased;
      c.el.textContent = f(intg ? Math.round(v) : v);
      if (p < 1) {
        requestAnimationFrame(tick);
      } else {
        c.el.textContent = f(n);
      }
    })(performance.now());
  }

  // Compatibility for pages authored before Studio shipped: safely recover
  // Legacy glossary buttons instead of exposing their source as visible text.
  // New assembly rejects interactive markup in page-js component data.
  function statText(parent, value) {
    const source = value == null ? "" : String(value);
    const term = /<button class="term" data-term="([^"]*)">([^<]*)<\/button>/g;
    let at = 0,
      match;
    while ((match = term.exec(source))) {
      if (match.index > at) {
        parent.appendChild(document.createTextNode(source.slice(at, match.index)));
      }
      const button = document.createElement("button");
      button.className = "term";
      button.type = "button";
      button.dataset.term = match[1];
      button.textContent = match[2];
      parent.append(button);
      at = match.index + match[0].length;
    }
    if (at < source.length) {
      parent.appendChild(document.createTextNode(source.slice(at)));
    }
  }

  // The motion API is a capability, not a dependency/file-name check. Chart
  // Only installs it when a mounted stat can actually respond to the presets.
  function statMotionPreset() {
    if (typeof window.__kitSetMotionPreset !== "function") {
      window.__kitMotionPreset = "normal";
      window.__kitSetMotionPreset = function __kitSetMotionPreset(name) {
        if (!["calm", "normal", "off"].includes(name)) {
          return false;
        }
        window.__kitMotionPreset = name;
        if (typeof window.dispatchEvent === "function" && typeof CustomEvent === "function") {
          window.dispatchEvent(
            new CustomEvent("kitmotionpresetchange", { detail: { preset: name } }),
          );
        }
        return name;
      };
    }
    return !["calm", "normal", "off"].includes(window.__kitMotionPreset)
      ? "normal"
      : window.__kitMotionPreset;
  }

  // Clean ticks: 1/2/2.5/5 × 10^n steps, ~4 divisions
  function niceScale(max) {
    if (!(max > 0)) {
      max = 1;
    }
    const raw = max / 4,
      mag = 10 ** Math.floor(Math.log10(raw));
    const norm = raw / mag;
    let step;
    if (norm <= 1) {
      step = 1;
    } else if (norm <= 2) {
      step = 2;
    } else if (norm <= 2.5) {
      step = 2.5;
    } else if (norm <= 5) {
      step = 5;
    } else {
      step = 10;
    }
    step *= mag;
    const top = Math.ceil(max / step - 1e-9) * step;
    const ticks = [];
    for (let v = 0; v <= top + step / 2; v += step) {
      ticks.push(v);
    }
    return { top, ticks };
  }

  /* Shared tooltip — one per host, textContent only (labels are data) */
  const tip = kitEl("div", "kch-tip");
  function tipShow(clientX, clientY, title, rows) {
    tip.innerHTML = "";
    if (title) {
      const t = kitEl("div", "kch-tip-title");
      t.textContent = title;
      tip.append(t);
    }
    rows.forEach((r) => {
      var row = kitEl("div", "kch-tip-row");
      if (r.tone) {
        row.appendChild(kitEl("i", "kch-key " + toneClass(r.tone)));
      }
      var val = kitEl("b");
      val.textContent = r.value;
      row.appendChild(val);
      if (r.label) {
        var lb = kitEl("span");
        lb.textContent = r.label;
        row.appendChild(lb);
      }
      tip.appendChild(row);
    });
    tip.classList.add("on");
    const hr = host.getBoundingClientRect();
    let x = clientX - hr.left + 14,
      y = clientY - hr.top + 14;
    x = Math.max(4, Math.min(x, hr.width - tip.offsetWidth - 8));
    y = Math.max(4, Math.min(y, hr.height - tip.offsetHeight - 8));
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }
  function tipHide() {
    tip.classList.remove("on");
  }

  /* Legend — required at ≥2 series, skipped for one (the title names it) */
  function legend(entries) {
    if (entries.length < 2) {
      return;
    }
    const lg = kitEl("div", "kch-legend");
    entries.forEach((en) => {
      var item = kitEl("span", "kch-legend-item");
      item.appendChild(
        kitEl("i", "kch-key " + (en.line ? "kch-key-line " : "") + toneClass(en.tone)),
      );
      var lb = kitEl("span");
      lb.textContent = en.label;
      item.appendChild(lb);
      lg.appendChild(item);
    });
    host.append(lg);
  }

  /* Walkthrough — the architecture-component move, applied to charts: each
     step focuses part of the chart and shows a caption. Read view gets
     clickable dots; in Present the steps are the slide's keypresses. */
  function buildWalk(applyFocus, defaults) {
    defaults = defaults || {};
    const steps = data.walkthrough || [];
    if (steps.length === 0) {
      return null;
    }
    const overview = data.overview || {};
    const completion = data.completion || null;
    function body(entry, fallback) {
      if (entry.note != null) {
        return String(entry.note);
      }
      if (entry.body != null) {
        return String(entry.body);
      }
      return fallback;
    }
    const states = [
      {
        focus: null,
        kind: "overview",
        note: body(overview, defaults.overviewNote || "Use Next to follow the chart's key points."),
        title: String(overview.title || defaults.overviewTitle || "Explore the chart →"),
      },
    ];
    steps.forEach(function (step, index) {
      states.push({
        focus: step.focus || null,
        kind: "step",
        note: body(step, ""),
        title: String(step.title || step.label || "Step " + (index + 1)),
      });
    });
    if (completion) {
      states.push({
        focus: null,
        kind: "completion",
        note: body(completion, ""),
        title: String(completion.title || "Complete"),
      });
    }
    const panel = kitEl("div", "kch-walk kch-walk-guided");
    const dotsEl = kitEl("div", "kch-walk-dots");
    const annotation = kitEl("div", "kch-walk-annotation");
    const titleEl = document.createElement("strong");
    const noteEl = document.createElement("p");
    annotation.setAttribute("aria-live", "polite");
    annotation.append(titleEl);
    annotation.append(noteEl);
    const controls = kitEl("div", "kch-walk-controls");
    const previous = kitEl("button", "kch-walk-previous");
    const next = kitEl("button", "kch-walk-next");
    previous.type = "button";
    previous.textContent = "Previous";
    next.type = "button";
    next.textContent = "Next";
    controls.append(previous);
    controls.append(next);
    panel.append(dotsEl);
    panel.append(annotation);
    panel.append(controls);
    const dotButtons = states.map(function (state, index) {
      var dot = kitEl("button", "kch-walk-dot");
      dot.type = "button";
      dot.setAttribute(
        "aria-label",
        state.kind === "overview"
          ? "Show chart overview"
          : state.kind === "completion"
            ? "Show chart completion"
            : "Show chart step " + index + ": " + state.title,
      );
      dot.addEventListener("click", function (e) {
        e.stopPropagation();
        set(index);
      });
      dotsEl.append(dot);
      return dot;
    });
    let current = 0;
    function set(i) {
      current = Math.max(0, Math.min(states.length - 1, i));
      host.__kitChartStep = current;
      const state = states[current];
      dotButtons.forEach((dot, index) => {
        const isCurrent = index === current;
        dot.classList.toggle("current", isCurrent);
        dot.classList.toggle("done", index < current);
        if (isCurrent) {
          dot.setAttribute("aria-current", "step");
        } else {
          dot.removeAttribute("aria-current");
        }
      });
      titleEl.textContent = state.title;
      noteEl.textContent = state.note;
      panel.classList.toggle("kch-walk-complete", state.kind === "completion");
      previous.disabled = current === 0;
      next.disabled = current === states.length - 1;
      applyFocus(data.view === "full" ? null : state.kind === "step" ? state.focus : null, state);
      if (focusBriefing) {
        focusBriefing(state.focus);
      }
    }
    function back() {
      set(current - 1);
    }
    function advance() {
      set(current + 1);
    }
    previous.addEventListener("click", back);
    next.addEventListener("click", advance);
    set(0);
    host.append(panel);
    return { count: states.length, el: panel, go: set };
  }
  function buildTraceWalk(applyFocus) {
    const steps = data.walkthrough || [];
    if (steps.length === 0) {
      return null;
    }
    const strip = kitEl("div", "kch-walk");
    const caption = kitEl("span", "kch-walk-cap");
    const dotButtons = [];
    function makeDot(text, idx, title) {
      const b = kitEl("button", "kch-walk-dot", text);
      b.type = "button";
      b.setAttribute("aria-label", title);
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        set(idx);
      });
      strip.append(b);
      dotButtons.push(b);
    }
    makeDot("·", 0, "overview");
    steps.forEach((s, k) => {
      makeDot(String(k + 1), k + 1, s.label);
    });
    strip.append(caption);
    function set(i) {
      i = Math.max(0, Math.min(steps.length, i));
      host.__kitChartStep = i;
      dotButtons.forEach((d, k) => {
        d.classList.toggle("on", k === i);
      });
      if (i === 0) {
        caption.classList.remove("on");
        applyFocus(null);
      } else {
        caption.textContent = steps[i - 1].label;
        caption.classList.add("on");
        applyFocus(steps[i - 1].focus || null);
      }
    }
    set(0);
    host.append(strip);
    return { count: steps.length + 1, go: set };
  }
  // Focus helper for row-shaped kinds: dim everything but the matched label/index
  function rowFocus(groups, labels) {
    return function (f) {
      groups.forEach((g) => {
        g.classList.remove("kch-dim", "kch-focus");
      });
      if (!f) {
        return;
      }
      const key = f.item != null ? f.item : f.part;
      if (key == null) {
        return;
      }
      groups.forEach((g, i) => {
        var match = typeof key === "number" ? i === key : labels[i] === key;
        g.classList.toggle("kch-dim", !match);
        g.classList.toggle("kch-focus", match);
      });
    };
  }
  function chartNumber(value, where, floor) {
    const blank = typeof value === "string" && !value.trim();
    const n = Number(value);
    if (value == null || typeof value === "boolean" || blank || !Number.isFinite(n)) {
      throw new Error(where + " must be a finite number");
    }
    if (floor === "zero" && n < 0) {
      throw new Error(where + " must be non-negative");
    }
    if (floor === "positive" && n <= 0) {
      throw new Error(where + " must be > 0");
    }
    return n;
  }
  function validateRowWalkthrough(kindName, labels) {
    (data.walkthrough || []).forEach((step, stepIndex) => {
      var focus = step.focus;
      if (!focus) {
        return;
      }
      var key = focus.item != null ? focus.item : focus.part;
      if (key == null) {
        return;
      }
      var known =
        typeof key === "number"
          ? Number.isInteger(key) && key >= 0 && key < labels.length
          : labels.includes(key);
      if (!known) {
        throw new Error(
          "renderChart(" +
            kindName +
            "): walkthrough step " +
            (stepIndex + 1) +
            ' references unknown item "' +
            key +
            '"',
        );
      }
    });
  }

  /* Table twin — the WCAG-clean equivalent; tooltips enhance, never gate */
  function dataTable(head, rows) {
    const details = kitEl("details", "kch-data");
    details.append(kitEl("summary", null, "view data"));
    const table = document.createElement("table");
    const tr = document.createElement("tr");
    head.forEach((h) => {
      var th = document.createElement("th");
      th.textContent = h;
      tr.appendChild(th);
    });
    table.append(tr);
    rows.forEach((r) => {
      var row = document.createElement("tr");
      r.forEach(function (c) {
        var td = document.createElement("td");
        td.textContent = c;
        row.appendChild(td);
      });
      table.appendChild(row);
    });
    details.append(table);
    host.append(details);
  }

  function readingElement(tag, className, text) {
    const element = kitEl(tag, className);
    if (text != null) {
      element.textContent = String(text);
    }
    return element;
  }

  // Four scalar charts share the same briefing composition: readable item
  // headings above magnitude rails, all measured against one common maximum.
  function magnitudeBriefing() {
    const items = kind === "split" ? data.parts : kind === "histogram" ? data.bins : data.items;
    if (!items || !items.length) {
      throw new Error("renderChart(" + kind + "): chart data is required");
    }
    const paired = kind === "dumbbell";
    const values = items.map((item, index) =>
      (paired ? [item.before, item.after] : [item.value]).map((value) =>
        chartNumber(value, "renderChart(" + kind + "): item " + (index + 1), "zero"),
      ),
    );
    const total = values.reduce((sum, row) => sum + row[0], 0);
    if (kind === "split" && total <= 0) {
      throw new Error("renderChart(split): parts must have a positive total");
    }
    const maximum = kind === "split" ? total : niceScale(Math.max(...values.flat())).top;
    const labels = items.map((item) => item.label);
    validateRowWalkthrough(kind, labels);
    const fig = readingElement("figure", "kch-magnitudes");
    fig.setAttribute("aria-label", data.ariaLabel || "Magnitude comparison");
    const scale = readingElement("figcaption", "kch-magnitude-scale");
    scale.textContent =
      kind === "split"
        ? "Total · " + fmt(total)
        : "Shared scale · " + fmt(0) + " — " + fmt(maximum);
    fig.append(scale);
    const grid = readingElement("div", "kch-magnitude-grid");
    const groups = items.map(function (item, index) {
      const group = readingElement(
        "div",
        "kch-item kch-magnitude " + toneClass(item.tone, index === 0 ? "accent" : "context"),
      );
      group.append(readingElement("strong", "kch-magnitude-label", item.label));
      values[index].forEach(function (value, endpoint) {
        const reading = readingElement("div", "kch-magnitude-reading");
        if (paired) {
          reading.append(
            readingElement(
              "span",
              null,
              endpoint ? data.afterLabel || "After" : data.beforeLabel || "Before",
            ),
          );
        }
        reading.append(readingElement("b", null, fmt(value, paired ? null : item.display)));
        group.append(reading);
        const track = readingElement("div", "kch-magnitude-track");
        const mark = readingElement("i", paired && endpoint === 0 ? "kch-magnitude-before" : "");
        mark.style.width = (maximum > 0 ? (value / maximum) * 100 : 0) + "%";
        track.setAttribute("aria-hidden", "true");
        track.append(mark);
        group.append(track);
      });
      if (item.note) {
        group.append(readingElement("p", "kch-magnitude-note", item.note));
      }
      grid.append(group);
      return group;
    });
    fig.append(grid);
    host.append(fig);
    const walk = buildWalk(rowFocus(groups, labels));
    dataTable(
      paired
        ? ["Item", data.beforeLabel || "Before", data.afterLabel || "After"]
        : ["Item", "Value"],
      items.map((item, index) => [item.label].concat(values[index].map((value) => fmt(value)))),
    );
    return present(groups, fig, null, walk, kind === "histogram");
  }

  // A persistent plot beside one authored series/location/point keeps context
  // while making exact readings available without a tooltip or a crowded legend.
  function inspectBriefing() {
    const seriesMode = kind === "line" || kind === "area";
    const entries = seriesMode
      ? data.series
      : kind === "scatter"
        ? data.points
        : [...(data.regions || []), ...(data.pins || [])];
    if (!entries || !entries.length) {
      return;
    }
    const figure = host.querySelector("figure");
    if (!figure) {
      return;
    }
    const frame = readingElement("div", "kch-inspect");
    figure.before(frame);
    frame.append(figure);
    const panel = readingElement("aside", "kch-inspect-panel");
    const navigation = readingElement("div", "kch-inspect-nav");
    const previous = readingElement("button", null, "←");
    const next = readingElement("button", null, "→");
    previous.type = "button";
    next.type = "button";
    previous.setAttribute("aria-label", "Previous " + (seriesMode ? "series" : "point"));
    next.setAttribute("aria-label", "Next " + (seriesMode ? "series" : "point"));
    const position = readingElement("span");
    navigation.append(previous, position, next);
    const title = readingElement("h3");
    const readings = readingElement("dl", "kch-inspect-readings");
    if (entries.length > 1) {
      panel.append(navigation);
    }
    panel.append(title, readings);
    frame.append(panel);
    let selected = 0;
    function show(index) {
      selected = Math.max(0, Math.min(entries.length - 1, index));
      const item = entries[selected];
      position.textContent = selected + 1 + " / " + entries.length;
      previous.disabled = selected === 0;
      next.disabled = selected === entries.length - 1;
      title.textContent = item.label || item.id || "Point " + (selected + 1);
      readings.replaceChildren();
      const rows = seriesMode
        ? item.values.map((value, i) => [data.x[i], fmt(value)])
        : kind === "scatter"
          ? [
              [data.xLabel || "X", fmtNum(item.x) + (data.xUnit ? " " + data.xUnit : "")],
              [data.yLabel || "Y", fmt(item.y)],
            ]
          : [
              ...(item.value != null ? [["Value", fmt(item.value, item.display)]] : []),
              ...(item.id != null ? [["Region", String(item.id)]] : []),
              ...(item.lat != null
                ? [
                    ["Latitude", String(item.lat)],
                    ["Longitude", String(item.lon)],
                  ]
                : []),
            ];
      rows.forEach(([label, value]) => {
        const row = readingElement("div");
        row.append(readingElement("dt", null, String(label)), readingElement("dd", null, value));
        readings.append(row);
      });
      if (item.note) {
        const note = readingElement("div");
        note.append(readingElement("dt", null, "Note"), readingElement("dd", null, item.note));
        readings.append(note);
      }
      figure.querySelectorAll(seriesMode ? ".kch-series" : ".kch-item").forEach((group, i) => {
        group.classList.toggle("kch-inspect-selected", i === selected);
      });
    }
    previous.addEventListener("click", () => show(selected - 1));
    next.addEventListener("click", () => show(selected + 1));
    focusBriefing = function (focus) {
      if (!focus) {
        show(0);
        return;
      }
      const key = focus.series ?? focus.point ?? focus.pin ?? focus.item;
      const index =
        typeof key === "number"
          ? key
          : entries.findIndex((item) => item.label === key || item.id === key);
      if (index >= 0) {
        show(index);
      }
    };
    show(0);
  }

  let driver;
  if (data.layout === "briefing" && ["bars", "dumbbell", "split", "histogram"].includes(kind)) {
    driver = magnitudeBriefing();
  } else if (kind === "line") {
    driver = line(false);
  } else if (kind === "area") {
    driver = line(true);
  } else if (kind === "bars") {
    driver = bars();
  } else if (kind === "dumbbell") {
    driver = dumbbell();
  } else if (kind === "split") {
    driver = split();
  } else if (kind === "histogram") {
    driver = histogram();
  } else if (kind === "scatter") {
    driver = scatter();
  } else if (kind === "heatmap") {
    driver = heatmap();
  } else if (kind === "dots") {
    driver = dots();
  } else if (kind === "map") {
    driver = geomap();
  } else if (kind === "stat") {
    driver = stat();
  } else if (kind === "trace") {
    driver = trace();
  } else {
    throw new Error(
      'renderChart: unknown kind "' +
        kind +
        '" — line | area | bars | dumbbell | split | histogram | scatter | heatmap | dots | map | stat | trace',
    );
  }
  if (data.layout === "briefing" && ["line", "area", "scatter", "map"].includes(kind)) {
    inspectBriefing();
  }
  host.append(tip);

  if (data.labels === "key") {
    const labelItems = kchAdjustableItems(data, kind);
    const referencedLabels = JSON.stringify(data.walkthrough || []);
    const selector =
      kind === "line" || kind === "area"
        ? ".kch-series"
        : kind === "stat"
          ? ".kch-stat-item"
          : ".kch-item";
    host.querySelectorAll(selector).forEach(function (group, index) {
      const item = labelItems[index];
      const keep =
        item &&
        (item.key === true ||
          kchItemAliases(item, kind).some(function (alias) {
            return referencedLabels.includes(JSON.stringify(alias));
          }));
      group.classList.toggle("kch-label-muted", Boolean(item && !keep));
    });
  }

  /* ── dots — finite units for votes, people, accounts, or any honest count ──
     One visible dot always represents exactly unitSize. Parts are laid into
     one uninterrupted reading order, so a viewer can count the whole and
     still see the emphasized share without decoding an axis. */
  function dots() {
    const total = chartNumber(data.total, "renderChart(dots): total", "positive");
    const unitSize =
      data.unitSize == null
        ? 1
        : chartNumber(data.unitSize, "renderChart(dots): unitSize", "positive");
    if (!Number.isInteger(total / unitSize)) {
      throw new TypeError("renderChart(dots): total must be divisible by unitSize");
    }
    const dotCount = total / unitSize;
    if (dotCount < 4 || dotCount > 200) {
      throw new Error("renderChart(dots): rendered unit count must be between 4 and 200");
    }
    const parts = data.parts || [{ label: data.label || "Total", value: total, tone: "accent" }];
    if (parts.length < 1 || parts.length > 5) {
      throw new Error("renderChart(dots): supports 1-5 parts");
    }
    let partTotal = 0;
    const units = [];
    parts.forEach(function (part, index) {
      const value = chartNumber(
        part.value,
        'renderChart(dots): part "' + (part.label || index + 1) + '" value',
        "zero",
      );
      if (!Number.isInteger(value / unitSize)) {
        throw new TypeError(
          'renderChart(dots): part "' +
            (part.label || index + 1) +
            '" must be divisible by unitSize',
        );
      }
      partTotal += value;
      for (let i = 0; i < value / unitSize; i++) {
        units.push({ part, partIndex: index });
      }
    });
    if (Math.abs(partTotal - total) > 1e-9) {
      throw new Error("renderChart(dots): part values must sum exactly to total");
    }
    const labels = parts.map(function (part) {
      return String(part.label || "");
    });
    validateRowWalkthrough("dots", labels);
    const columns =
      data.columns == null
        ? Math.min(20, Math.max(4, Math.ceil(Math.sqrt(dotCount * 1.65))))
        : Number(data.columns);
    if (!Number.isInteger(columns) || columns < 4 || columns > 24) {
      throw new Error("renderChart(dots): columns must be an integer from 4-24");
    }
    const grouped = data.layout === "briefing";
    const partRows = [];
    let rowCount = 0;
    let unitOffset = 0;
    parts.forEach((part) => {
      partRows.push({ row: rowCount, unit: unitOffset });
      rowCount += Math.max(1, Math.ceil(Number(part.value) / unitSize / columns)) + 1;
      unitOffset += Number(part.value) / unitSize;
    });
    const rows = grouped ? rowCount : Math.ceil(dotCount / columns);
    const W = data.width || 1000;
    const M = { t: 34, r: 28, b: 34, l: grouped ? 260 : 28 };
    const pitch = Math.min(42 * contentSpacing, (W - M.l - M.r) / Math.max(columns, 1));
    const radius = Math.max(5, Math.min(10.5, pitch * 0.25));
    const gridW = (columns - 1) * pitch;
    const gridX = grouped ? M.l : (W - gridW) / 2;
    const H = M.t + Math.max(1, rows - 1) * pitch + M.b;

    const fig = kitEl("figure", "kch-dots");
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", data.ariaLabel || total + " units shown as dots");
    fig.append(svg);
    host.append(fig);

    const groups = parts.map(function (part, index) {
      const fallback = index === 0 ? "accent" : "context";
      const group = add(svg, "g", {
        class: "kch-item kch-dot-part " + toneClass(part.tone, fallback),
        "data-part": String(index),
      });
      if (grouped) {
        const y = M.t + partRows[index].row * pitch;
        add(group, "text", { class: "kch-cat", x: 16, y: y + 4 }, part.label);
        add(group, "text", { class: "kch-val", x: 16, y: y + 30 }, fmt(part.value, part.display));
      }
      return group;
    });
    const labelled = new Set();
    units.forEach(function (slot, index) {
      const localIndex = grouped ? index - partRows[slot.partIndex].unit : index;
      const col = localIndex % columns;
      const row = Math.floor(localIndex / columns) + (grouped ? partRows[slot.partIndex].row : 0);
      const group = groups[slot.partIndex];
      const mark = add(group, "circle", {
        class: "kch-dot-mark",
        cx: gridX + col * pitch,
        cy: M.t + row * pitch,
        r: radius,
      });
      // One tab stop per part, like every other kind here: a 200-unit figure
      // must not cost 200 Tab presses and 200 near-identical announcements.
      // The remaining dots keep their pointer tooltip but leave the tab order
      // and the accessibility tree alone; the data table carries the detail.
      if (labelled.has(slot.partIndex)) {
        mark.setAttribute("aria-hidden", "true");
      } else {
        labelled.add(slot.partIndex);
        mark.setAttribute("tabindex", "0");
        mark.setAttribute(
          "aria-label",
          (slot.part.label || "Part " + (slot.partIndex + 1)) +
            ": " +
            fmt(slot.part.value, slot.part.display) +
            " of " +
            fmt(total),
        );
      }
      wireHit(mark, group, function (clientX, clientY) {
        tipShow(clientX, clientY, slot.part.label || "", [
          {
            tone: slot.part.tone || (slot.partIndex === 0 ? "accent" : "context"),
            value: fmt(slot.part.value, slot.part.display),
            label: unitSize === 1 ? "of " + fmt(total) : "1 dot = " + fmt(unitSize),
          },
        ]);
      });
    });

    const directLegend = kitEl("div", "kch-dot-legend");
    (grouped ? [] : parts).forEach(function (part, index) {
      const item = kitEl(
        "span",
        "kch-dot-legend-item " + toneClass(part.tone, index === 0 ? "accent" : "context"),
      );
      item.append(kitEl("i", "kch-dot-key"));
      const label = kitEl("span");
      label.textContent = part.label;
      const value = kitEl("b");
      value.textContent = fmt(part.value, part.display);
      item.append(label, value);
      directLegend.append(item);
    });
    if (grouped) {
      const summary = readingElement(
        "small",
        "kch-dot-unit",
        "Total " + fmt(total) + " · 1 dot = " + fmt(unitSize),
      );
      directLegend.append(summary);
    } else if (unitSize !== 1) {
      directLegend.append(kitEl("small", "kch-dot-unit", "1 dot = " + fmt(unitSize)));
    }
    host.append(directLegend);

    const walk = buildWalk(rowFocus(groups, labels), {
      overviewNote: "Each dot is one exact unit; color marks the represented parts.",
      overviewTitle: "Count the whole →",
    });
    dataTable(
      ["Part", "Value", "Dots"],
      parts.map(function (part) {
        return [
          part.label || "",
          fmt(part.value, part.display),
          String(Number(part.value) / unitSize),
        ];
      }),
    );
    return present(groups, fig, null, walk, true);
  }

  /* ── line / area (same data shape; area washes every series) ── */
  function line(isArea) {
    const series = data.series || [];
    const xs = data.x || [];
    const lineKind = isArea ? "area" : "line";
    if (series.length === 0 || xs.length === 0) {
      throw new Error("renderChart(" + lineKind + "): data.x and data.series are required");
    }
    if (series.length > 3) {
      throw new Error(
        "renderChart(" +
          lineKind +
          "): data.series supports at most 3 series, got " +
          series.length,
      );
    }
    const zeroBased = data.baseline !== "data";
    const allVals = [];
    series.forEach((s, seriesIndex) => {
      var values = s.values || [];
      if (values.length !== xs.length) {
        throw new Error(
          "renderChart(" +
            lineKind +
            '): series "' +
            (s.label || seriesIndex + 1) +
            '" has ' +
            values.length +
            " value(s) but data.x has " +
            xs.length,
        );
      }
      values.forEach(function (v, valueIndex) {
        allVals.push(
          chartNumber(
            v,
            "renderChart(" +
              lineKind +
              '): series "' +
              (s.label || seriesIndex + 1) +
              '" value ' +
              (valueIndex + 1),
            zeroBased ? "zero" : null,
          ),
        );
      });
    });
    (data.walkthrough || []).forEach((step, stepIndex) => {
      var focus = step.focus;
      if (!focus) {
        return;
      }
      if (
        focus.series != null &&
        !series.some(function (s) {
          return s.label === focus.series;
        })
      ) {
        throw new Error(
          "renderChart(" +
            lineKind +
            "): walkthrough step " +
            (stepIndex + 1) +
            ' references unknown series "' +
            focus.series +
            '"',
        );
      }
      if (focus.x != null) {
        var range = Array.isArray(focus.x) ? focus.x : [focus.x, focus.x];
        var validRange =
          range.length === 2 &&
          range.every(function (index) {
            return (
              typeof index === "number" &&
              Number.isInteger(index) &&
              index >= 0 &&
              index < xs.length
            );
          }) &&
          range[0] <= range[1];
        if (!validRange) {
          throw new Error(
            "renderChart(" +
              lineKind +
              "): walkthrough step " +
              (stepIndex + 1) +
              " focus.x must reference an index or ascending index pair within data.x",
          );
        }
      }
    });
    const W = data.width || 1000,
      M = { t: 34, r: 176, b: 56, l: 84 };
    const pw = W - M.l - M.r;
    const maxV = Math.max.apply(null, allVals);
    const minV = data.baseline === "data" ? Math.min.apply(null, allVals) : 0;
    const sc = niceScale(maxV - (data.baseline === "data" ? minV : 0));
    const top = sc.top + (data.baseline === "data" ? minV : 0);
    const H = data.height || 360,
      ph = H - M.t - M.b;
    const X = function (i) {
      return xs.length === 1 ? M.l + pw / 2 : M.l + (i / (xs.length - 1)) * pw;
    };
    const Y = function (v) {
      return M.t + ph - ((v - minV) / (top - minV || 1)) * ph;
    };

    legend(
      series.map((s, i) => ({
        label: s.label,
        tone: s.tone || (i === 0 ? "accent" : "context"),
        line: true,
      })),
    );
    const fig = kitEl("figure");
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", data.ariaLabel || "line chart");
    fig.append(svg);
    host.append(fig);

    sc.ticks.forEach((tv) => {
      var v = tv + (data.baseline === "data" ? minV : 0);
      if (v > top + 1e-9) {
        return;
      }
      add(svg, "line", { class: "kch-grid", x1: M.l, y1: Y(v), x2: W - M.r + 30, y2: Y(v) });
      add(
        svg,
        "text",
        { class: "kch-tick", x: M.l - 12, y: Y(v) + 5, "text-anchor": "end" },
        fmtTick(v),
      );
    });
    const every = Math.max(1, Math.ceil(xs.length / 8));
    xs.forEach((xl, i) => {
      if (i % every && i !== xs.length - 1) {
        return;
      }
      add(
        svg,
        "text",
        { class: "kch-tick", x: X(i), y: H - M.b + 30, "text-anchor": "middle" },
        String(xl),
      );
    });
    // Walkthrough focus band — sits under the series, lights an x-range
    const bandEl = add(svg, "rect", { class: "kch-band", x: M.l, y: M.t, width: 0, height: ph });

    const groups = [],
      endSpots = [];
    series.forEach((s, si) => {
      var vals = s.values || [];
      var tone = toneClass(s.tone, si === 0 ? "accent" : "context");
      var g = add(svg, "g", { class: "kch-series " + tone });
      var d = vals
        .map(function (v, i) {
          return (i ? "L" : "M") + X(i) + " " + Y(Number(v));
        })
        .join(" ");
      if (isArea || series.length === 1) {
        // gradient wash under a single series — the stops sit inside the tone
        // group so stop-color can read the tone's custom property
        window.__kchGradN = (window.__kchGradN || 0) + 1;
        var gid = "kchg" + window.__kchGradN;
        var defs = add(g, "defs", {});
        var grad = add(defs, "linearGradient", { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
        add(grad, "stop", { offset: "0%", "stop-color": "var(--kch-c)", "stop-opacity": 0.3 });
        add(grad, "stop", { offset: "100%", "stop-color": "var(--kch-c)", "stop-opacity": 0 });
        add(g, "path", {
          class: "kch-area-g",
          fill: "url(#" + gid + ")",
          d: d + " L" + X(vals.length - 1) + " " + Y(minV) + " L" + X(0) + " " + Y(minV) + " Z",
        });
      }
      var path = add(g, "path", { class: "kch-line", d });
      var lastI = vals.length - 1,
        ex = X(lastI),
        ey = Y(Number(vals[lastI]));
      add(g, "circle", { class: "kch-dot", cx: ex, cy: ey, r: 5 });
      endSpots.push({ g, x: ex, y: ey, si, value: vals[lastI], label: s.label, path });
      groups.push(g);
    });
    // Direct end labels — value leads, name follows; nudged apart on collision
    // With a hairline leader back to the dot (never stacked onto the line)
    const placed = [...endSpots].toSorted(function (a, b) {
      return a.y - b.y;
    });
    let prev = -1e9;
    placed.forEach((sp) => {
      var ly = Math.max(sp.y, prev + Math.max(36, 36 * contentSpacing));
      prev = ly;
      if (Math.abs(ly - sp.y) > 8) {
        add(sp.g, "line", {
          class: "kch-leader",
          x1: sp.x + 8,
          y1: sp.y,
          x2: sp.x + 22,
          y2: ly - 5,
        });
      }
      var endVal = add(
        sp.g,
        "text",
        { class: "kch-val", x: sp.x + 26, y: ly, "text-anchor": "start" },
        fmt(sp.value),
      );
      sp.g.__kchCount = [{ el: endVal, v: sp.value }];
      add(
        sp.g,
        "text",
        {
          class: "kch-name",
          x: sp.x + 26,
          y: ly + Math.max(22, 22 * contentSpacing),
          "text-anchor": "start",
        },
        sp.label,
      );
    });

    /* Crosshair + tooltip: aim at an x, read every series there */
    const cross = add(svg, "line", { class: "kch-cross", x1: 0, y1: M.t, x2: 0, y2: M.t + ph });
    const hoverDots = series.map(function (s, si) {
      return add(svg, "circle", {
        class: "kch-dot kch-hoverdot " + toneClass(s.tone, si === 0 ? "accent" : "context"),
        r: 5,
      });
    });
    function showAt(i, clientX, clientY) {
      cross.setAttribute("x1", X(i));
      cross.setAttribute("x2", X(i));
      cross.classList.add("on");
      series.forEach((s, si) => {
        hoverDots[si].setAttribute("cx", X(i));
        hoverDots[si].setAttribute("cy", Y(Number(s.values[i])));
        hoverDots[si].classList.add("on");
      });
      tipShow(
        clientX,
        clientY,
        String(xs[i]),
        series.map((s, si) => ({
          tone: s.tone || (si === 0 ? "accent" : "context"),
          value: fmt(s.values[i]),
          label: s.label,
        })),
      );
    }
    function hideHover() {
      cross.classList.remove("on");
      hoverDots.forEach((d) => {
        d.classList.remove("on");
      });
      tipHide();
    }
    const zone = add(svg, "rect", {
      class: "kch-zone",
      x: M.l - 10,
      y: M.t,
      width: pw + 20,
      height: ph,
    });
    zone.addEventListener("pointermove", (e) => {
      var r = svg.getBoundingClientRect();
      var px = ((e.clientX - r.left) / r.width) * W;
      var i = Math.round((px - M.l) / (pw / Math.max(1, xs.length - 1)));
      i = Math.max(0, Math.min(xs.length - 1, i));
      showAt(i, e.clientX, e.clientY);
    });
    zone.addEventListener("pointerleave", hideHover);
    // Keyboard: same readout as hover (focus the chart, arrow through the x)
    let focusIdx = -1;
    fig.tabIndex = 0;
    fig.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        focusIdx =
          focusIdx < 0
            ? xs.length - 1
            : Math.max(0, Math.min(xs.length - 1, focusIdx + (e.key === "ArrowRight" ? 1 : -1)));
        var r = svg.getBoundingClientRect();
        showAt(focusIdx, r.left + (X(focusIdx) / W) * r.width, r.top + r.height * 0.4);
        e.preventDefault();
        e.stopPropagation();
      } else if (e.key === "Escape" && focusIdx >= 0) {
        focusIdx = -1;
        hideHover();
      }
    });
    fig.addEventListener("blur", () => {
      focusIdx = -1;
      hideHover();
    });

    const walk = buildWalk(function (f) {
      bandEl.classList.remove("on");
      groups.forEach(function (g) {
        g.classList.remove("kch-dim", "kch-focus");
      });
      if (!f) {
        return;
      }
      if (f.series != null || f.x != null) {
        series.forEach(function (s, si) {
          var match = f.series == null || s.label === f.series;
          groups[si].classList.toggle("kch-dim", !match);
          groups[si].classList.toggle("kch-focus", match);
        });
      }
      if (f.x != null) {
        var r = Array.isArray(f.x) ? f.x : [f.x, f.x];
        var half = xs.length > 1 ? pw / (xs.length - 1) / 2 : pw / 2;
        var x1 = Math.max(M.l - 10, X(r[0]) - half);
        var x2 = Math.min(W - M.r + 30, X(r[1]) + half);
        bandEl.style.x = x1 + "px";
        bandEl.style.width = Math.max(8, x2 - x1) + "px";
        bandEl.classList.add("on");
      }
    });
    dataTable(
      [data.xLabel || ""].concat(series.map((s) => s.label)),
      xs.map((xl, i) =>
        [String(xl)].concat(
          series.map(function (s) {
            return fmt(s.values[i]);
          }),
        ),
      ),
    );

    function drawIn(g) {
      if (REDUCED_MOTION || window.__kitMeasuring) {
        return;
      }
      const path = g.querySelector(".kch-line");
      const len = path.getTotalLength();
      path.style.strokeDasharray = `${len} ${len}`;
      path.style.strokeDashoffset = String(len);
      path.getBoundingClientRect();
      path.style.transition = "stroke-dashoffset .9s cubic-bezier(0.16,1,0.3,1)";
      path.style.strokeDashoffset = "0";
      // The end-dot pops as the line arrives at it
      setTimeout(() => {
        g.querySelectorAll(".kch-dot").forEach(function (dot) {
          dot.classList.add("kch-pop");
        });
      }, 780);
      setTimeout(() => {
        path.style.strokeDasharray = "";
        path.style.transition = "";
      }, 950);
      // Area fill: one-shot left-to-right wipe — the whole volume fills in a
      // Single Present step, not one data point per keypress
      if (isArea) {
        const area = g.querySelector(".kch-area-g");
        if (area) {
          area.classList.remove("kch-area-wipe");
          area.getBoundingClientRect();
          area.classList.add("kch-area-wipe");
        }
      }
    }
    return present(groups, fig, drawIn, walk);
  }

  /* ── bars ── */
  function bars() {
    const items = data.items || [];
    if (items.length === 0) {
      throw new Error("renderChart(bars): data.items is required");
    }
    items.forEach((item, index) => {
      chartNumber(
        item.value,
        'renderChart(bars): item "' + (item.label || index + 1) + '" value',
        "zero",
      );
    });
    validateRowWalkthrough(
      "bars",
      items.map((item) => item.label),
    );
    const W = data.width || 1000,
      rowH = Math.max(40, 46 * contentSpacing),
      barH = 20;
    const M = { t: 12, b: 14, label: 226, r: 104 };
    const H = M.t + items.length * rowH + M.b;
    const maxV = Math.max.apply(
      null,
      items.map(function (it) {
        return Number(it.value);
      }),
    );
    const sc = niceScale(maxV);
    const x0 = M.label + 6,
      pw = W - x0 - M.r;
    const X = function (v) {
      return (Number(v) / sc.top) * pw;
    };

    const fig = kitEl("figure");
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", data.ariaLabel || "bar chart");
    fig.append(svg);
    host.append(fig);
    add(svg, "line", { class: "kch-base", x1: x0, x2: x0, y1: M.t - 4, y2: H - M.b + 4 });

    const groups = items.map(function (it, i) {
      var tone = toneClass(it.tone, "context");
      var g = add(svg, "g", { class: "kch-item " + tone });
      var y = M.t + i * rowH + (rowH - barH) / 2;
      add(
        g,
        "text",
        { class: "kch-cat", x: M.label - 8, y: y + barH / 2 + 5, "text-anchor": "end" },
        it.label,
      );
      var w = Math.max(1, X(it.value));
      // ≤24px bar, 4px rounded data-end, square at the baseline
      var d =
        w <= 5
          ? "M" + x0 + " " + y + " h" + w + " v" + barH + " h-" + w + " Z"
          : "M" +
            x0 +
            " " +
            y +
            " h" +
            (w - 4) +
            " q4 0 4 4 v" +
            (barH - 8) +
            " q0 4 -4 4 h-" +
            (w - 4) +
            " Z";
      add(g, "path", { class: "kch-bar", d });
      var tipVal = add(
        g,
        "text",
        { class: "kch-val", x: x0 + w + 12, y: y + barH / 2 + 7, "text-anchor": "start" },
        fmt(it.value, it.display),
      );
      g.__kchCount = [{ el: tipVal, v: it.value, d: it.display }];
      // hit target: the whole row, far bigger than the mark
      var hit = add(g, "rect", {
        class: "kch-hit",
        x: 0,
        y: M.t + i * rowH,
        width: W,
        height: rowH,
        tabindex: 0,
      });
      hit.setAttribute("aria-label", it.label + ": " + fmt(it.value, it.display));
      wireHit(hit, g, function (cx, cy) {
        tipShow(cx, cy, it.label, [
          { tone: it.tone || "context", value: fmt(it.value, it.display), label: it.note || "" },
        ]);
      });
      return g;
    });
    const walk = buildWalk(
      rowFocus(
        groups,
        items.map(function (it) {
          return it.label;
        }),
      ),
    );
    dataTable(
      [data.xLabel || "", unit ? `value (${unit})` : "value"],
      items.map((it) => [it.label, fmt(it.value, it.display)]),
    );
    return present(groups, fig, null, walk);
  }

  /* ── dumbbell ── */
  function dumbbell() {
    const items = data.items || [];
    if (items.length === 0) {
      throw new Error("renderChart(dumbbell): data.items is required");
    }
    items.forEach((item, index) => {
      var label = item.label || index + 1;
      chartNumber(item.before, 'renderChart(dumbbell): item "' + label + '" before', "zero");
      chartNumber(item.after, 'renderChart(dumbbell): item "' + label + '" after', "zero");
    });
    validateRowWalkthrough(
      "dumbbell",
      items.map((item) => item.label),
    );
    const W = data.width || 1000,
      rowH = Math.max(44, 52 * contentSpacing);
    const M = { t: 14, b: 14, label: 226, r: 104 };
    const H = M.t + items.length * rowH + M.b;
    let maxV = 0;
    items.forEach((it) => {
      maxV = Math.max(maxV, Number(it.before), Number(it.after));
    });
    const sc = niceScale(maxV);
    const x0 = M.label + 6,
      pw = W - x0 - M.r;
    const X = function (v) {
      return x0 + (Number(v) / sc.top) * pw;
    };

    legend([
      { label: data.beforeLabel || "before", tone: "context" },
      { label: data.afterLabel || "after", tone: "accent" },
    ]);
    const fig = kitEl("figure");
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", data.ariaLabel || "before/after chart");
    fig.append(svg);
    host.append(fig);
    add(svg, "line", { class: "kch-base", x1: x0, x2: x0, y1: M.t - 4, y2: H - M.b + 4 });

    const groups = items.map(function (it, i) {
      var g = add(svg, "g", { class: "kch-item" });
      var cy = M.t + i * rowH + rowH / 2;
      add(
        g,
        "text",
        { class: "kch-cat", x: M.label - 8, y: cy + 5, "text-anchor": "end" },
        it.label,
      );
      var xb = X(it.before),
        xa = X(it.after);
      add(g, "line", { class: "kch-link", x1: xb, y1: cy, x2: xa, y2: cy });
      add(g, "circle", { class: "kch-dot kch-tone-context", cx: xb, cy, r: 5 });
      add(g, "circle", { class: "kch-dot " + toneClass(it.tone, "accent"), cx: xa, cy, r: 6 });
      // outward labels: leftmost value reads left, rightmost right — except
      // when the left dot hugs the axis, where a left-anchored label would
      // run into the category column; there the value rides above its dot
      var lx = Math.min(xb, xa),
        rx = Math.max(xb, xa);
      var leftIsBefore = xb <= xa;
      var leftClass = leftIsBefore ? "kch-tick" : "kch-val";
      var leftText = fmt(
        leftIsBefore ? it.before : it.after,
        leftIsBefore ? it.beforeDisplay : it.display,
      );
      var leftEl;
      if (lx - x0 < 110) {
        leftEl = add(
          g,
          "text",
          { class: leftClass, x: lx + 2, y: cy - 16, "text-anchor": "start" },
          leftText,
        );
      } else {
        leftEl = add(
          g,
          "text",
          { class: leftClass, x: lx - 12, y: cy + 5, "text-anchor": "end" },
          leftText,
        );
      }
      var rightEl = add(
        g,
        "text",
        {
          class: leftIsBefore ? "kch-val" : "kch-tick",
          x: rx + 12,
          y: cy + 5,
          "text-anchor": "start",
        },
        fmt(leftIsBefore ? it.after : it.before, leftIsBefore ? it.display : it.beforeDisplay),
      );
      // the "after" numeral is the one that counts up
      g.__kchCount = [
        leftIsBefore
          ? { el: rightEl, v: it.after, d: it.display }
          : { el: leftEl, v: it.after, d: it.display },
      ];
      var hit = add(g, "rect", {
        class: "kch-hit",
        x: 0,
        y: M.t + i * rowH,
        width: W,
        height: rowH,
        tabindex: 0,
      });
      hit.setAttribute(
        "aria-label",
        it.label + ": " + fmt(it.before, it.beforeDisplay) + " to " + fmt(it.after, it.display),
      );
      wireHit(hit, g, function (cx2, cy2) {
        tipShow(cx2, cy2, it.label, [
          {
            tone: "context",
            value: fmt(it.before, it.beforeDisplay),
            label: data.beforeLabel || "before",
          },
          {
            tone: it.tone || "accent",
            value: fmt(it.after, it.display),
            label: data.afterLabel || "after",
          },
        ]);
      });
      return g;
    });
    const walk = buildWalk(
      rowFocus(
        groups,
        items.map(function (it) {
          return it.label;
        }),
      ),
    );
    dataTable(
      [data.xLabel || "", data.beforeLabel || "before", data.afterLabel || "after"],
      items.map((it) => [it.label, fmt(it.before, it.beforeDisplay), fmt(it.after, it.display)]),
    );
    return present(groups, fig, null, walk);
  }

  /* ── split ── */
  function split() {
    const parts = data.parts || [];
    if (parts.length === 0) {
      throw new Error("renderChart(split): data.parts is required");
    }
    if (parts.length > 6) {
      throw new Error(
        "renderChart(split): data.parts supports at most 6 parts, got " + parts.length,
      );
    }
    let total = 0;
    parts.forEach((part, index) => {
      total += chartNumber(
        part.value,
        'renderChart(split): part "' + (part.label || index + 1) + '" value',
        "positive",
      );
    });
    if (!Number.isFinite(total) || total <= 0) {
      throw new Error("renderChart(split): data.parts total must be finite and > 0");
    }
    validateRowWalkthrough(
      "split",
      parts.map((part) => part.label),
    );
    const W = data.width || 1000,
      H = 120,
      barY = 22,
      barH = 22,
      GAP = 2 * contentSpacing;
    const isPct = data.percent !== false && Math.abs(total - 100) < 1.5;

    const fig = kitEl("figure");
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", data.ariaLabel || "share chart");
    fig.append(svg);
    host.append(fig);

    let x = 8;
    const usable = W - 16 - GAP * (parts.length - 1);
    const groups = parts.map(function (p, i) {
      var tone = toneClass(p.tone, i === 0 ? "accent" : "context");
      var g = add(svg, "g", { class: "kch-item " + tone });
      var w = (Number(p.value) / total) * usable;
      var first = i === 0,
        last = i === parts.length - 1;
      // 4px rounding on the two outer ends only; 2px surface gaps between fills
      var d;
      if (w <= 8) {
        d = "M" + x + " " + barY + " h" + w + " v" + barH + " h-" + w + " Z";
      } else if (first && last) {
        d = roundedBoth(x, barY, w, barH);
      } else if (first) {
        d =
          "M" +
          (x + 4) +
          " " +
          barY +
          " h" +
          (w - 4) +
          " v" +
          barH +
          " h-" +
          (w - 4) +
          " q-4 0 -4 -4 v-" +
          (barH - 8) +
          " q0 -4 4 -4 Z";
      } else if (last) {
        d =
          "M" +
          x +
          " " +
          barY +
          " h" +
          (w - 4) +
          " q4 0 4 4 v" +
          (barH - 8) +
          " q0 4 -4 4 h-" +
          (w - 4) +
          " Z";
      } else {
        d = "M" + x + " " + barY + " h" + w + " v" + barH + " h-" + w + " Z";
      }
      add(g, "path", { class: "kch-bar", d });
      var share = isPct ? Math.round(Number(p.value)) + "%" : fmt(p.value, p.display);
      // labels sit under the bar with a tick, never inside the fill —
      // segments too narrow for a label keep theirs in tooltip + table
      if (w >= 96) {
        add(g, "line", {
          class: "kch-grid",
          x1: x + 1,
          y1: barY + barH + 6,
          x2: x + 1,
          y2: barY + barH + 18,
        });
        var shareEl = add(
          g,
          "text",
          { class: "kch-val kch-big", x: x + 8, y: barY + barH + 38, "text-anchor": "start" },
          share,
        );
        g.__kchCount = [
          isPct
            ? {
                el: shareEl,
                v: Math.round(Number(p.value)),
                f(n) {
                  return Math.round(n) + "%";
                },
              }
            : { el: shareEl, v: p.value, d: p.display },
        ];
        add(
          g,
          "text",
          { class: "kch-name", x: x + 8, y: barY + barH + 60, "text-anchor": "start" },
          p.label,
        );
      }
      var hit = add(g, "rect", {
        class: "kch-hit",
        x,
        y: barY - 10,
        width: Math.max(w, 24),
        height: barH + 20,
        tabindex: 0,
      });
      hit.setAttribute("aria-label", p.label + ": " + share);
      wireHit(hit, g, function (cx, cy) {
        tipShow(cx, cy, p.label, [
          {
            tone: p.tone || (i === 0 ? "accent" : "context"),
            value: share,
            label: isPct ? fmt(p.value) : "",
          },
        ]);
      });
      x += w + GAP;
      return g;
    });
    function roundedBoth(rx, ry, rw, rh) {
      return `M${rx + 4} ${ry} h${rw - 8} q4 0 4 4 v${rh - 8} q0 4 -4 4 h-${
        rw - 8
      } q-4 0 -4 -4 v-${rh - 8} q0 -4 4 -4 Z`;
    }
    const walk = buildWalk(
      rowFocus(
        groups,
        parts.map(function (p) {
          return p.label;
        }),
      ),
    );
    dataTable(
      [data.xLabel || "", isPct ? "share" : "value"],
      parts.map((p) => [
        p.label,
        isPct ? Math.round(Number(p.value)) + "%" : fmt(p.value, p.display),
      ]),
    );
    return present(groups, fig, null, walk);
  }

  /* ── histogram — a distribution over contiguous bins ── */
  function histogram() {
    const bins = data.bins || [];
    if (bins.length === 0) {
      throw new Error("renderChart(histogram): data.bins is required");
    }
    bins.forEach((bin, index) => {
      chartNumber(
        bin.value,
        'renderChart(histogram): bin "' + (bin.label || index + 1) + '" value',
        "zero",
      );
    });
    validateRowWalkthrough(
      "histogram",
      bins.map((bin) => bin.label),
    );
    const W = data.width || 1000,
      M = { t: 46, r: 30, b: 56, l: 84 };
    const H = data.height || 340,
      ph = H - M.t - M.b;
    const pw = W - M.l - M.r,
      slot = pw / bins.length;
    const barW = Math.min(slot - 2 * contentSpacing, 36);
    const maxV = Math.max.apply(
      null,
      bins.map(function (b) {
        return Number(b.value);
      }),
    );
    const sc = niceScale(maxV);
    const Y = function (v) {
      return M.t + ph - (Number(v) / sc.top) * ph;
    };

    const fig = kitEl("figure");
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", data.ariaLabel || "histogram");
    fig.append(svg);
    host.append(fig);
    sc.ticks.forEach((tv) => {
      if (tv > sc.top + 1e-9) {
        return;
      }
      add(svg, "line", { class: "kch-grid", x1: M.l, y1: Y(tv), x2: W - M.r, y2: Y(tv) });
      add(
        svg,
        "text",
        { class: "kch-tick", x: M.l - 12, y: Y(tv) + 5, "text-anchor": "end" },
        fmtTick(tv),
      );
    });
    const maxIdx = bins.reduce(function (mi, b, i) {
      return Number(b.value) > Number(bins[mi].value) ? i : mi;
    }, 0);
    const groups = bins.map(function (b, i) {
      var tone = toneClass(b.tone, "accent"); // one distribution, one hue
      var g = add(svg, "g", { class: "kch-item " + tone });
      var cx = M.l + slot * i + slot / 2;
      var x = cx - barW / 2,
        y = Y(b.value),
        h = M.t + ph - y;
      var d =
        h <= 5
          ? "M" + x + " " + (y + h) + " v-" + h + " h" + barW + " v" + h + " Z"
          : "M" +
            x +
            " " +
            (M.t + ph) +
            " v-" +
            (h - 4) +
            " q0 -4 4 -4 h" +
            (barW - 8) +
            " q4 0 4 4 v" +
            (h - 4) +
            " Z";
      add(g, "path", { class: "kch-bar", d });
      add(
        g,
        "text",
        { class: "kch-tick", x: cx, y: H - M.b + 30, "text-anchor": "middle" },
        b.label,
      );
      if (i === maxIdx) {
        var peak = add(
          g,
          "text",
          { class: "kch-val", x: cx, y: y - 12, "text-anchor": "middle" },
          fmt(b.value, b.display),
        );
        g.__kchCount = [{ el: peak, v: b.value, d: b.display }];
      }
      var hit = add(g, "rect", {
        class: "kch-hit",
        x: M.l + slot * i,
        y: M.t - 10,
        width: slot,
        height: ph + 20,
        tabindex: 0,
      });
      hit.setAttribute("aria-label", b.label + ": " + fmt(b.value, b.display));
      wireHit(hit, g, function (px, py) {
        tipShow(px, py, b.label, [
          { tone: b.tone || "accent", value: fmt(b.value, b.display), label: data.xLabel || "" },
        ]);
      });
      return g;
    });
    add(svg, "line", { class: "kch-base", x1: M.l, x2: W - M.r, y1: M.t + ph, y2: M.t + ph });
    const walk = buildWalk(
      rowFocus(
        groups,
        bins.map(function (b) {
          return b.label;
        }),
      ),
    );
    dataTable(
      [data.xLabel || "bin", unit ? `count (${unit})` : "count"],
      bins.map((b) => [b.label, fmt(b.value, b.display)]),
    );
    // A distribution is one shape, not a sequence — reveal every bin in a
    // Single Present step instead of one keypress per bin
    return present(groups, fig, null, walk, !walk);
  }

  /* ── scatter — two measured axes; emphasis via per-point tone ── */
  function scatter() {
    const points = data.points || [];
    if (points.length === 0) {
      throw new Error("renderChart(scatter): data.points is required");
    }
    points.forEach((point, index) => {
      var label = point.label || index + 1;
      chartNumber(point.x, 'renderChart(scatter): point "' + label + '" x', "zero");
      chartNumber(point.y, 'renderChart(scatter): point "' + label + '" y', "zero");
    });
    validateRowWalkthrough(
      "scatter",
      points.map((point) => point.label || ""),
    );
    const W = data.width || 1000,
      M = { t: 34, r: 60, b: 66, l: 92 };
    const H = data.height || 420,
      ph = H - M.t - M.b,
      pw = W - M.l - M.r;
    const xs = points.map(function (p) {
      return Number(p.x);
    });
    const ys = points.map(function (p) {
      return Number(p.y);
    });
    const sx = niceScale(Math.max.apply(null, xs));
    const sy = niceScale(Math.max.apply(null, ys));
    const X = function (v) {
      return M.l + (Number(v) / sx.top) * pw;
    };
    const Y = function (v) {
      return M.t + ph - (Number(v) / sy.top) * ph;
    };
    const xUnit = data.xUnit || "";
    function fx(v) {
      const keep = unit;
      unit = xUnit;
      const s = fmt(v);
      unit = keep;
      return s;
    }

    const fig = kitEl("figure");
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", data.ariaLabel || "scatter plot");
    fig.append(svg);
    host.append(fig);
    sy.ticks.forEach((tv) => {
      if (tv > sy.top + 1e-9) {
        return;
      }
      add(svg, "line", { class: "kch-grid", x1: M.l, y1: Y(tv), x2: W - M.r + 20, y2: Y(tv) });
      add(
        svg,
        "text",
        { class: "kch-tick", x: M.l - 12, y: Y(tv) + 5, "text-anchor": "end" },
        fmtTick(tv),
      );
    });
    sx.ticks.forEach((tv) => {
      if (tv > sx.top + 1e-9) {
        return;
      }
      add(svg, "line", { class: "kch-grid", x1: X(tv), y1: M.t, x2: X(tv), y2: M.t + ph });
      add(
        svg,
        "text",
        { class: "kch-tick", x: X(tv), y: H - M.b + 30, "text-anchor": "middle" },
        xUnit && xUnit.length <= 3 ? fx(tv) : fmtNum(tv),
      );
    });
    if (data.xLabel) {
      add(
        svg,
        "text",
        { class: "kch-name", x: W - M.r + 20, y: H - 6, "text-anchor": "end" },
        data.xLabel,
      );
    }
    const groups = points.map(function (p, i) {
      var g = add(svg, "g", { class: "kch-item " + toneClass(p.tone, "context") });
      add(g, "circle", { class: "kch-dot", cx: X(p.x), cy: Y(p.y), r: 5.5 });
      if (p.label) {
        var nearEdge = X(p.x) > W - 150;
        add(
          g,
          "text",
          {
            class: "kch-name",
            x: X(p.x) + (nearEdge ? -12 : 12),
            y: Y(p.y) - 10,
            "text-anchor": nearEdge ? "end" : "start",
          },
          p.label,
        );
      }
      // hit target far bigger than the mark — nobody lands on an 11px dot
      var hit = add(g, "circle", { class: "kch-hit", cx: X(p.x), cy: Y(p.y), r: 17, tabindex: 0 });
      hit.setAttribute(
        "aria-label",
        (p.label || "point") + ": " + fx(p.x) + ", " + fmt(p.y, p.display),
      );
      wireHit(hit, g, function (px, py) {
        tipShow(px, py, p.label || "", [
          { tone: p.tone || "context", value: fmt(p.y, p.display), label: data.yLabel || "" },
          { value: fx(p.x), label: data.xLabel || "" },
        ]);
      });
      return g;
    });
    const walk = buildWalk(
      rowFocus(
        groups,
        points.map(function (p) {
          return p.label || "";
        }),
      ),
    );
    dataTable(
      ["", data.xLabel || "x", data.yLabel || "y"],
      points.map((p) => [p.label || "", fx(p.x), fmt(p.y, p.display)]),
    );
    // A scatter cloud is one gesture, not a dotted countdown — reveal every
    // Point in a single Present step instead of one keypress per dot
    return present(groups, fig, null, walk, !walk);
  }

  /* ── heatmap — a grid of magnitudes, one hue, more-is-stronger ── */
  function heatmap() {
    const rows = data.rows || [],
      cols = data.cols || [],
      values = data.values || [];
    if (
      rows.length === 0 ||
      cols.length === 0 ||
      values.length !== rows.length ||
      values.some((r) => !r || r.length !== cols.length)
    ) {
      throw new Error(
        "renderChart(heatmap): data.rows, data.cols, and matching data.values are required",
      );
    }
    values.forEach((row, rowIndex) => {
      row.forEach(function (value, colIndex) {
        chartNumber(
          value,
          "renderChart(heatmap): value at row " + (rowIndex + 1) + ", column " + (colIndex + 1),
          "zero",
        );
      });
    });
    validateRowWalkthrough("heatmap", rows.map(String));
    const strips = data.layout === "briefing";
    const W = data.width || 1000,
      M = { t: strips ? 72 : 40, r: 20, l: strips ? 20 : 130 };
    const GAP = 2 * contentSpacing,
      cellH = 40 * contentSpacing;
    const stripColumns = strips && cols.length <= 6 && rows.length > 1 ? 2 : 1;
    const stripWidth = (W - M.l - M.r - (stripColumns - 1) * 36) / stripColumns;
    const cellW = (stripWidth - GAP * (cols.length - 1)) / cols.length;
    const visualRows = Math.ceil(rows.length / stripColumns);
    const rowPitch = cellH + GAP + (strips ? 62 * contentSpacing : 0);
    const H = M.t + visualRows * rowPitch + 74;
    const flat = [];
    values.forEach((r) => {
      r.forEach(function (v) {
        flat.push(Number(v));
      });
    });
    const minV = Math.min.apply(null, flat),
      maxV = Math.max.apply(null, flat);
    const span = maxV - minV || 1;

    const fig = kitEl("figure");
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", data.ariaLabel || "heatmap");
    fig.append(svg);
    host.append(fig);
    const every = Math.max(1, Math.ceil(cols.length / 12));
    cols.forEach((c, j) => {
      if (strips || j % every) {
        return;
      }
      add(
        svg,
        "text",
        {
          class: "kch-tick",
          x: M.l + j * (cellW + GAP) + cellW / 2,
          y: M.t - 14,
          "text-anchor": "middle",
        },
        String(c),
      );
    });
    const groups = rows.map(function (r, i) {
      var g = add(svg, "g", {
        class: "kch-item kch-tone-accent",
        transform: "translate(" + (i % stripColumns) * (stripWidth + 36) + " 0)",
      });
      var y = M.t + Math.floor(i / stripColumns) * rowPitch;
      add(
        g,
        "text",
        {
          class: "kch-cat",
          x: strips ? M.l : M.l - 14,
          y: strips ? y - 38 : y + cellH / 2 + 6,
          "text-anchor": strips ? "start" : "end",
        },
        String(r),
      );
      cols.forEach(function (c, j) {
        if (strips) {
          add(
            g,
            "text",
            {
              class: "kch-tick",
              x: M.l + j * (cellW + GAP) + cellW / 2,
              y: y - 12,
              "text-anchor": "middle",
            },
            String(c),
          );
        }
        var v = Number(values[i][j]);
        var op = 0.06 + 0.88 * ((v - minV) / span);
        var cell = add(g, "rect", {
          class: "kch-cell",
          x: M.l + j * (cellW + GAP),
          y: strips ? y + cellH - 7 : y,
          width: cellW,
          height: strips ? 7 : cellH,
          rx: strips ? 2 : 4,
          "fill-opacity": op,
          tabindex: 0,
        });
        if (strips && cellW >= 48) {
          add(
            g,
            "text",
            {
              class: "kch-strip-value",
              x: M.l + j * (cellW + GAP) + cellW / 2,
              y: y + cellH / 2,
              "text-anchor": "middle",
              "pointer-events": "none",
            },
            fmtNum(v),
          );
        }
        cell.setAttribute("aria-label", r + " · " + c + ": " + fmt(v));
        wireHit(cell, g, function (px, py) {
          tipShow(px, py, r + " · " + c, [
            { tone: "accent", value: fmt(v), label: data.xLabel || "" },
          ]);
        });
      });
      return g;
    });
    // Ramp legend: the one hue, low → high
    const ly = M.t + visualRows * rowPitch + 26;
    window.__kchGradN = (window.__kchGradN || 0) + 1;
    const gid = "kchg" + window.__kchGradN;
    const lg = add(svg, "g", { class: "kch-tone-accent" });
    const defs = add(lg, "defs", {});
    const grad = add(defs, "linearGradient", { id: gid, x1: 0, y1: 0, x2: 1, y2: 0 });
    add(grad, "stop", { offset: "0%", "stop-color": "var(--kch-c)", "stop-opacity": 0.06 });
    add(grad, "stop", { offset: "100%", "stop-color": "var(--kch-c)", "stop-opacity": 0.94 });
    add(lg, "rect", { fill: "url(#" + gid + ")", height: 10, rx: 5, width: 220, x: M.l, y: ly });
    add(
      lg,
      "text",
      { class: "kch-tick", "text-anchor": "start", x: M.l, y: ly + 30 },
      fmtNum(minV),
    );
    add(
      lg,
      "text",
      { class: "kch-tick", "text-anchor": "end", x: M.l + 220, y: ly + 30 },
      fmt(maxV),
    );
    const walk = buildWalk(rowFocus(groups, rows.map(String)));
    dataTable(
      [""].concat(cols.map(String)),
      rows.map((r, i) =>
        [String(r)].concat(
          values[i].map(function (v) {
            return fmt(v);
          }),
        ),
      ),
    );
    return present(groups, fig, null, walk);
  }

  /* ── map — where things happen in the world (needs the geo-world component:
     pre-projected Natural Earth countries + an Equal Earth point projection).
     Same emphasis grammar as everywhere: the world is context, the story
     wears a tone. Regions are countries by ISO alpha-3 or name; points are
     lon/lat markers with a radar ring. ── */
  function geomap() {
    const geo = window.__kitGeo;
    if (!geo) {
      throw new Error(
        'renderChart(map): the geo-world component is missing — add "geo-world" to meta.components',
      );
    }
    const regions = data.regions || [],
      points = data.pins || [];
    if (regions.length === 0 && points.length === 0) {
      throw new Error("renderChart(map): data.regions or data.pins is required");
    }
    const regionData = regions.map((region, index) => {
      if (region.value != null) {
        chartNumber(
          region.value,
          'renderChart(map): region "' + (region.label || region.id || index + 1) + '" value',
        );
      }
      const country = geo.find(region.id);
      if (!country) {
        throw new Error(
          'renderChart(map): unknown region "' +
            region.id +
            '" — use an ISO alpha-3 code ("NLD") or a country name ("Netherlands")',
        );
      }
      const label = region.label || country.name;
      return {
        aliases: [String(region.id).toLowerCase(), label.toLowerCase(), country.name.toLowerCase()],
        country,
        label,
      };
    });
    const pointCoordinates = points.map((point, index) => {
      var label = point.label || index + 1;
      var lon = chartNumber(point.lon, 'renderChart(map): pin "' + label + '" lon');
      var lat = chartNumber(point.lat, 'renderChart(map): pin "' + label + '" lat');
      if (lon < -180 || lon > 180) {
        throw new Error('renderChart(map): pin "' + label + '" lon must be between -180 and 180');
      }
      if (lat < -90 || lat > 90) {
        throw new Error('renderChart(map): pin "' + label + '" lat must be between -90 and 90');
      }
      if (point.value != null) {
        chartNumber(point.value, 'renderChart(map): pin "' + label + '" value');
      }
      return [lon, lat];
    });
    const keys = regionData
      .map((region) => region.aliases)
      .concat(points.map((point) => [String(point.label || "").toLowerCase()]));
    (data.walkthrough || []).forEach((step, stepIndex) => {
      var focus = step.focus;
      if (!focus || focus.item == null) {
        return;
      }
      var key = focus.item;
      var known =
        typeof key === "number"
          ? Number.isInteger(key) && key >= 0 && key < keys.length
          : keys.some(function (aliases) {
              return aliases.includes(String(key).toLowerCase());
            });
      if (!known) {
        throw new Error(
          "renderChart(map): walkthrough step " +
            (stepIndex + 1) +
            ' references unknown item "' +
            key +
            '"',
        );
      }
    });

    const fig = kitEl("figure");
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${geo.w} ${geo.h}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", data.ariaLabel || "map");
    fig.append(svg);
    host.append(fig);

    add(svg, "path", { class: "kch-map-sphere", d: geo.sphere });
    add(svg, "path", { class: "kch-map-grat", d: geo.graticule });
    // Every country as quiet context, in one path (they are not data)
    add(svg, "path", {
      class: "kch-map-land",
      d: geo.countries.map((c) => c.d).join(" "),
    });

    const groups = [];
    regions.forEach((rg, index) => {
      var country = regionData[index].country;
      var label = regionData[index].label;
      // emphasis grammar as everywhere: the subject region wears the accent,
      // the rest keep a recessive (but still readable) context fill
      var g = add(svg, "g", { class: "kch-item " + toneClass(rg.tone, "context") });
      var shape = add(g, "path", { class: "kch-map-region", d: country.d, tabindex: 0 });
      // a country too small to carry its fill at world scale (Netherlands,
      // Israel, …) gets a ring at its centroid — marking where, not how big
      if (country.b[0] * country.b[1] < 180) {
        add(g, "circle", { class: "kch-map-mark", cx: country.c[0], cy: country.c[1], r: 9 });
      }
      var lx = country.c[0] + (rg.dx || 0),
        ly = country.c[1] + (rg.dy || 0);
      if (rg.value != null) {
        var val = add(
          g,
          "text",
          { class: "kch-val kch-map-halo", x: lx, y: ly, "text-anchor": "middle" },
          fmt(rg.value, rg.display),
        );
        g.__kchCount = [{ el: val, v: rg.value, d: rg.display }];
        add(
          g,
          "text",
          {
            class: "kch-name kch-map-halo",
            x: lx,
            y: ly + Math.max(20, 20 * contentSpacing),
            "text-anchor": "middle",
          },
          label,
        );
      } else {
        add(
          g,
          "text",
          { class: "kch-name kch-map-halo", x: lx, y: ly + 5, "text-anchor": "middle" },
          label,
        );
      }
      shape.setAttribute(
        "aria-label",
        label + (rg.value != null ? ": " + fmt(rg.value, rg.display) : ""),
      );
      wireHit(shape, g, function (px, py) {
        tipShow(px, py, label, [
          {
            tone: rg.tone || "context",
            value: rg.value != null ? fmt(rg.value, rg.display) : country.name,
            label: rg.note || "",
          },
        ]);
      });
      groups.push(g);
    });
    points.forEach((p, index) => {
      var xy = geo.project(pointCoordinates[index][0], pointCoordinates[index][1]);
      var g = add(svg, "g", { class: "kch-item " + toneClass(p.tone, "accent") });
      add(g, "circle", { class: "kch-map-ring", cx: xy[0], cy: xy[1], r: 10 });
      add(g, "circle", { class: "kch-dot", cx: xy[0], cy: xy[1], r: 5 });
      if (p.label) {
        var nearEdge = xy[0] > geo.w - 130;
        add(
          g,
          "text",
          {
            class: "kch-name kch-map-halo",
            x: xy[0] + (nearEdge ? -11 : 11),
            y: xy[1] + 4,
            "text-anchor": nearEdge ? "end" : "start",
          },
          p.label,
        );
      }
      var hit = add(g, "circle", { class: "kch-hit", cx: xy[0], cy: xy[1], r: 16, tabindex: 0 });
      hit.setAttribute(
        "aria-label",
        (p.label || "marker") + (p.value != null ? ": " + fmt(p.value, p.display) : ""),
      );
      wireHit(hit, g, function (px, py) {
        tipShow(px, py, p.label || "", [
          {
            tone: p.tone || "accent",
            value: p.value != null ? fmt(p.value, p.display) : "",
            label: p.note || "",
          },
        ]);
      });
      groups.push(g);
    });

    // Walkthrough focus: {item} is a region id/name, a pin label, or an
    // Index over regions-then-pins
    const walk = buildWalk(function (f) {
      groups.forEach(function (g) {
        g.classList.remove("kch-dim", "kch-focus");
      });
      if (!f || f.item == null) {
        return;
      }
      var key = f.item;
      groups.forEach(function (g, i) {
        var match =
          typeof key === "number" ? i === key : keys[i].includes(String(key).toLowerCase());
        g.classList.toggle("kch-dim", !match);
        g.classList.toggle("kch-focus", match);
      });
    });
    dataTable(
      [data.xLabel || "place", unit ? `value (${unit})` : "value"],
      regions
        .map((rg, index) => [
          regionData[index].label,
          rg.value != null ? fmt(rg.value, rg.display) : "",
        ])
        .concat(points.map((p) => [p.label || "", p.value != null ? fmt(p.value, p.display) : ""])),
    );

    // Arrival: the world sits still, the story pops onto it (rings start
    // Spinning once a group is live; minimal and reduced-motion opt out)
    function drawIn(g) {
      g.classList.add("kch-live");
      if (window.__kitMeasuring) {
        return;
      }
      g.classList.add("kch-pre");
      g.getBoundingClientRect();
      g.classList.remove("kch-pre");
      g.querySelectorAll(".kch-dot").forEach((dot) => {
        dot.classList.add("kch-pop");
      });
    }
    return present(groups, fig, drawIn, walk);
  }

  /* ── stat — 1–4 big numerals that count up (folded in from the retired
     stat component; own markup, own tone vocabulary, no SVG/legend/table
     twin/walkthrough — the numerals themselves are the whole chart). ── */
  function stat() {
    const items = data.items || [];
    if (items.length === 0) {
      throw new Error("renderChart(stat): data.items is required");
    }
    if (items.length > 4) {
      throw new Error(
        "renderChart(stat): data.items supports at most 4 items, got " + items.length,
      );
    }
    items.forEach((item, index) => {
      if (item.ticks == null) {
        return;
      }
      var ticks = chartNumber(
        item.ticks,
        "renderChart(stat): item " + (index + 1) + " ticks",
        "zero",
      );
      if (!Number.isInteger(ticks) || ticks > 24) {
        throw new Error("renderChart(stat): ticks must be an integer from 0 to 24");
      }
    });
    validateRowWalkthrough(
      "stat",
      items.map((item) => item.label),
    );
    const row = kitEl("div", "kch-stat-row");
    row.setAttribute("role", "group");
    if (data.ariaLabel) {
      row.setAttribute("aria-label", data.ariaLabel);
    }
    const parts = items.map(function (it) {
      var el = kitEl("div", "kch-stat-item" + (it.tone ? " " + it.tone : ""));
      var authored = String(it.n);
      var numberMatch = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(.*)$/.exec(authored.trim());
      var target = numberMatch ? Number(numberMatch[1]) : Number.NaN;
      var isNum = numberMatch && Number.isFinite(target);
      var valueEl = kitEl("div", "kch-stat-value");
      var nEl = kitEl("span", "kch-stat-n");
      var numberWrap = nEl;
      if (isNum) {
        valueEl.setAttribute("aria-label", numberMatch[1] + numberMatch[2]);
        var numberSizer = kitEl("span", "kch-stat-n-sizer", numberMatch[1]);
        numberSizer.setAttribute("aria-hidden", "true");
        var numberLive = kitEl("span", "kch-stat-n-live", "0");
        numberLive.setAttribute("aria-hidden", "true");
        nEl.appendChild(numberSizer);
        nEl.appendChild(numberLive);
        nEl = numberLive;
      } else {
        nEl.textContent = authored;
      }
      valueEl.appendChild(numberWrap);
      if (isNum && numberMatch[2]) {
        var unitEl = kitEl("span", "kch-stat-unit");
        unitEl.textContent = numberMatch[2];
        valueEl.appendChild(unitEl);
      }
      el.appendChild(valueEl);
      var labelEl = kitEl("div", "kch-stat-label");
      statText(labelEl, it.label);
      el.appendChild(labelEl);
      if (it.sub) {
        var subEl = kitEl("div", "kch-stat-sub");
        statText(subEl, it.sub);
        el.appendChild(subEl);
      }
      if (it.ticks) {
        var ticksEl = kitEl("div", "kch-stat-ticks");
        for (var t = 0; t < it.ticks; t++) {
          ticksEl.appendChild(kitEl("i"));
        }
        el.appendChild(ticksEl);
      }
      row.appendChild(el);
      return {
        el,
        nEl,
        authoredNumber: isNum ? numberMatch[1] : authored,
        target: isNum ? target : null,
      };
    });
    host.append(row);
    const applyStatFocus = rowFocus(
      parts.map((part) => part.el),
      items.map((item) => item.label),
    );

    let played = false;
    let rafs = [],
      timers = [];
    let motionPreset = statMotionPreset();
    function stop() {
      rafs.forEach((id) => {
        cancelAnimationFrame(id);
      });
      timers.forEach((id) => {
        clearTimeout(id);
      });
      rafs = [];
      timers = [];
    }
    function finalState() {
      parts.forEach((it) => {
        it.nEl.textContent = it.authoredNumber;
        it.el.querySelectorAll(".kch-stat-ticks i").forEach(function (tick) {
          tick.classList.add("on");
        });
      });
    }
    function play(replay) {
      if ((!replay && played) || window.__kitMeasuring) {
        return;
      }
      stop();
      played = true;
      const preset = motionPreset;
      host.dataset.motionPreset = preset;
      parts.forEach((it) => {
        it.el.querySelectorAll(".kch-stat-ticks i").forEach(function (tick) {
          tick.classList.remove("on");
        });
      });
      if (REDUCED_MOTION || preset === "off") {
        finalState();
        return;
      }
      // Normal keeps the brisk authored beat. Calm is deliberately a
      // Different character: a long, gentle count with unhurried tick
      // Arrivals rather than merely a dimmer version of Normal.
      const duration = preset === "calm" ? 1650 : 900;
      parts.forEach((it, itemIndex) => {
        if (it.target == null) {
          it.nEl.textContent = it.authoredNumber;
        } else {
          it.nEl.textContent = "0";
          // keep the authored precision during the count so a decimal stat
          // eases smoothly instead of snapping to it on the last frame
          var dot = it.authoredNumber.indexOf(".");
          var decimals = dot < 0 ? 0 : it.authoredNumber.length - dot - 1;
          var start = null;
          (function tick(ts) {
            if (start == null) {
              start = ts;
            }
            var p = Math.min(1, (ts - start) / duration);
            var value = it.target * (1 - (1 - p) ** 3);
            it.nEl.textContent = p === 1 ? it.authoredNumber : value.toFixed(decimals);
            if (p < 1) {
              rafs.push(requestAnimationFrame(tick));
            }
          })(performance.now());
        }
        var ticks = it.el.querySelectorAll(".kch-stat-ticks i");
        ticks.forEach(function (t, k) {
          var delay = preset === "calm" ? 220 + itemIndex * 90 + k * 120 : 250 + k * 45;
          timers.push(
            setTimeout(function () {
              t.classList.add("on");
            }, delay),
          );
        });
      });
    }
    let guidedPlayed = false;
    const walk = buildWalk(function (focus, state) {
      applyStatFocus(focus);
      if (document.body.classList.contains("pr-exporting")) {
        // CaptureStates advances walkthroughs faster than a browser animation
        // can finish. Export the authored number, never an in-flight counter
        // value that would become permanent text in PowerPoint/Google Slides.
        stop();
        finalState();
        guidedPlayed = true;
      } else if (state.kind === "overview" || state.kind === "completion") {
        stop();
        finalState();
      } else if (state.kind === "step" && !window.__kitMeasuring && !guidedPlayed) {
        guidedPlayed = true;
        play(true);
      }
    });
    const initialPreset = motionPreset;
    host.dataset.motionPreset = initialPreset;
    if (REDUCED_MOTION || initialPreset === "off") {
      finalState();
      played = true;
    }
    function setMotionPreset(preset, replay) {
      if (!["calm", "normal", "off"].includes(preset)) {
        return false;
      }
      motionPreset = preset;
      host.dataset.motionPreset = preset;
      // Studio is hidden in Present; do not mutate an active deck if another
      // Caller dispatches the capability event there.
      if (!document.body.classList.contains("presenting") && replay !== false) {
        play(true);
      } else if (REDUCED_MOTION || preset === "off") {
        stop();
        finalState();
        played = true;
      }
      return preset;
    }
    function onMotionPresetChange(e) {
      setMotionPreset(e && e.detail ? e.detail.preset : statMotionPreset(), true);
    }
    window.addEventListener("kitmotionpresetchange", onMotionPresetChange);
    const motionEntries = (window.__kitMotionAdjustable = window.__kitMotionAdjustable || []);
    const motionEntry = {
      host,
      key: host.id || data.ariaLabel || "Big Stat",
      label: data.ariaLabel || "Big Stat",
      kind: "big stat",
      get() {
        return motionPreset;
      },
      set: setMotionPreset,
    };
    const motionEntryIndex = motionEntries.findIndex(function (entry) {
      return entry.host === host;
    });
    if (motionEntryIndex === -1) {
      motionEntries.push(motionEntry);
    } else {
      motionEntries[motionEntryIndex] = motionEntry;
    }
    host.__kitDispose = function __kitDispose() {
      stop();
      if (obs) {
        obs.disconnect();
      }
      window.removeEventListener("kitmotionpresetchange", onMotionPresetChange);
      const index = motionEntries.indexOf(motionEntry);
      if (index !== -1) {
        motionEntries.splice(index, 1);
      }
    };
    if (!document.body.classList.contains("presenting") && "IntersectionObserver" in window) {
      var obs = new IntersectionObserver(
        (es) => {
          es.forEach(function (e) {
            if (e.isIntersecting && !document.body.classList.contains("presenting")) {
              play();
              obs.disconnect();
            }
          });
        },
        { threshold: 0.35 },
      );
      obs.observe(host);
    }
    if (walk) {
      return { count: walk.count, go: walk.go, play };
    }
    // Arrival shows nothing lit; step 1 plays every count-up at once — the
    // Same beat decks already write: steps:{count:2, go:i=>i>0 && api.play()}
    return {
      count: 2,
      go(i) {
        if (i > 0) {
          play();
        }
      },
      play,
    };
  }

  /* ── trace — a request's time made visible: work/wait spans on a shared
     time axis, rows grouped by lane with overlap sub-rows, and an optional
     before/after "race" with a synced replay sweep. One elapsed-time clock
     (`t`, in `unit`) drives the cursor, every span's partial fill, and both
     TOTAL numerals each frame — they read off the same value so they can
     never drift apart. See references/CONTRACTS.md#chart (trace section)
     for the authored contract. ── */
  function trace() {
    const architectureTrace = data.__architectureTrace === true;
    const REPLAY_MS = 2600; // Wall-clock replay length, independent of `unit` scale
    // Vertical rhythm. A waterfall is a WIDE shape — a race stacks two of
    // Them, and the dedicated architecture trace owns most of the slide.
    // Its rows, bars, and inter-lane spacing use that room so the timeline
    // Carries the explanation without relying on surrounding prose.
    const ROWH = Math.max(28, 34 * contentSpacing),
      BARH = architectureTrace ? 22 : 20,
      LANE_GAP = Math.max(4, (architectureTrace ? 6 : 9) * contentSpacing),
      MAX_SUBROWS = 3;
    const CAP_GAP = Math.max(14, (architectureTrace ? 18 : 20) * contentSpacing); // Headroom under a race side-cap, above its first lane
    const RACE_GAP = Math.max(18, (architectureTrace ? 20 : 26) * contentSpacing); // Between the two stacked waterfalls
    const AXIS_PAD = Math.max(32, 38 * contentSpacing); // Below the baseline: tick labels sit at bottom + 26
    const LABEL_LIFT = 6; // Caption baseline above the bar's top edge
    const M = { t: architectureTrace ? 22 : 26, r: 44, b: architectureTrace ? 38 : 46, l: 136 };

    const traceTag = architectureTrace ? "architecture trace" : "renderChart(trace)";
    function capCheck(cond, msg) {
      if (!cond) {
        throw new Error(traceTag + ": " + msg);
      }
    }
    function validateSpans(spans, tag) {
      capCheck(Array.isArray(spans) && spans.length > 0, `${tag}spans is required`);
      capCheck(
        spans.length <= 12,
        `${tag}spans supports at most 12, got ${spans ? spans.length : 0}`,
      );
      const laneSet = {},
        idSet = {};
      spans.forEach((s) => {
        chartNumber(
          s.dur,
          traceTag + ": " + tag + 'span "' + (s.label || s.id) + '" dur',
          "positive",
        );
        chartNumber(
          s.start,
          traceTag + ": " + tag + 'span "' + (s.label || s.id) + '" start',
          "zero",
        );
        capCheck(
          s.kind == null || s.kind === "work" || s.kind === "wait",
          tag +
            'span "' +
            (s.label || s.id) +
            '" kind must be "work" or "wait" (got "' +
            s.kind +
            '")',
        );
        if (s.lane != null) {
          var ln = String(s.lane);
          laneSet[ln] = true;
        }
        if (s.id != null) {
          idSet[String(s.id)] = true;
        }
      });
      capCheck(
        Object.keys(laneSet).length <= 5,
        `${tag}at most 5 distinct lanes, got ${Object.keys(laneSet).length}`,
      );
      return { ids: idSet, lanes: laneSet };
    }

    const hasSpans = data.spans != null,
      hasCompare = data.compare != null;
    capCheck(
      hasSpans !== hasCompare,
      `provide exactly one of data.spans (single trace) or data.compare (race) — got ${
        hasSpans && hasCompare ? "both" : "neither"
      }`,
    );

    const isRace = hasCompare;
    let sides, known;
    if (isRace) {
      capCheck(
        Boolean(data.compare.before && data.compare.after),
        'data.compare needs both "before" and "after"',
      );
      const kb = validateSpans(data.compare.before.spans, "compare.before.");
      const ka = validateSpans(data.compare.after.spans, "compare.after.");
      known = {
        ids: { ...kb.ids, ...ka.ids },
        lanes: { ...kb.lanes, ...ka.lanes },
      };
      sides = [
        {
          key: "before",
          label: data.compare.before.label || "before",
          spans: data.compare.before.spans,
          tone: "context",
        },
        {
          key: "after",
          label: data.compare.after.label || "after",
          spans: data.compare.after.spans,
          tone: "accent",
        },
      ];
    } else {
      known = validateSpans(data.spans, "");
      sides = [{ key: "trace", label: null, spans: data.spans, tone: "context" }];
    }

    // Walkthrough focus refs must resolve — same "unknown ref throws" contract
    // Map's regions already enforce; {replay:true} is trace's own focus field
    // (no ref to check), everything else must name a real lane or span id.
    (data.walkthrough || []).forEach((step) => {
      var f = step.focus;
      if (!f || f.replay) {
        return;
      }
      if (f.lane != null && !known.lanes[String(f.lane)]) {
        throw new Error(traceTag + ': walkthrough focus references unknown lane "' + f.lane + '"');
      }
      if (f.span != null && !known.ids[String(f.span)]) {
        throw new Error(
          traceTag + ': walkthrough focus references unknown span id "' + f.span + '"',
        );
      }
      (f.spans || []).forEach(function (sid) {
        if (!known.ids[String(sid)]) {
          throw new Error(
            traceTag + ': walkthrough focus references unknown span id "' + sid + '"',
          );
        }
      });
    });

    // Race mode: BOTH mini-waterfalls share one lane order (after-side order
    // First, then any before-only lanes appended) so the same lane sits at
    // The same row in both blocks — without this, a lane authored in a
    // Different order on either side would silently misalign and the race
    // Would stop reading as one comparison.
    function laneUnionOrder(primary, secondary) {
      const order = [],
        seen = {};
      function addFrom(spans) {
        (spans || []).forEach((s) => {
          var ln = s.lane == null ? "" : String(s.lane);
          if (!seen[ln]) {
            seen[ln] = true;
            order.push(ln);
          }
        });
      }
      addFrom(primary);
      addFrom(secondary);
      return order;
    }
    const laneOrder = isRace
      ? laneUnionOrder(sides[1].spans, sides[0].spans)
      : laneUnionOrder(sides[0].spans, null);

    // Greedy interval packing per lane (the "meeting rooms" algorithm) —
    // Concurrency inside a lane must be readable statically, not just
    // During replay, so overlapping spans stack their own sub-row. A lane
    // In `laneOrder` with no spans on THIS side still gets an entry (zero
    // Items, one empty row) so both sides keep the same lane at the same
    // Vertical slot even when one side's story eliminates it entirely.
    function layoutLanes(spans, order) {
      const byLane = {};
      order.forEach((ln) => {
        byLane[ln] = [];
      });
      spans.forEach((s) => {
        var ln = s.lane == null ? "" : String(s.lane);
        (byLane[ln] || (byLane[ln] = [])).push(s);
      });
      const lanes = order.map(function (ln) {
        var sorted = [...byLane[ln]].toSorted(function (a, b) {
          return Number(a.start) - Number(b.start);
        });
        var rowEnds = [];
        var items = sorted.map(function (s) {
          var end = Number(s.start) + Number(s.dur),
            row = -1;
          for (var r = 0; r < rowEnds.length; r++) {
            if (Number(s.start) >= rowEnds[r] - 1e-9) {
              row = r;
              break;
            }
          }
          if (row === -1) {
            row = rowEnds.length;
            rowEnds.push(end);
          } else {
            rowEnds[row] = end;
          }
          return { span: s, row };
        });
        capCheck(
          rowEnds.length <= MAX_SUBROWS,
          'lane "' +
            (ln || "(default)") +
            '" supports at most ' +
            MAX_SUBROWS +
            " overlapping sub-rows, needs " +
            rowEnds.length,
        );
        return { name: ln, items, rows: rowEnds.length || 1 };
      });
      let total = 0;
      spans.forEach((s) => {
        total = Math.max(total, Number(s.start) + Number(s.dur));
      });
      return { lanes, total };
    }

    const sideLayouts = sides.map(function (side) {
      return layoutLanes(side.spans, laneOrder);
    });
    // Per-lane row count is shared too — a lane needing 2 sub-rows on one
    // Side but 1 on the other still reserves the taller height on both, so
    // Every row boundary lines up, not just each lane's top edge
    const laneRows = laneOrder.map(function (_, li) {
      return Math.max.apply(
        null,
        sideLayouts.map(function (l) {
          return l.lanes[li].rows;
        }),
      );
    });
    const overallMax = Math.max.apply(
      null,
      sideLayouts.map(function (l) {
        return l.total;
      }),
    );
    const W = data.width || (architectureTrace ? 1400 : 1000),
      pw = W - M.l - M.r;
    const X = function (t) {
      return M.l + (t / (overallMax || 1)) * pw;
    };
    const traceLegend = [],
      traceLegendByKey = {};
    function traceLegendEntry(span, side) {
      const rawKey =
        span.id != null ? "id:" + String(span.id) : side.key + ":" + side.spans.indexOf(span);
      if (!traceLegendByKey[rawKey]) {
        traceLegendByKey[rawKey] = {
          key: rawKey,
          label: span.label || span.id || "span " + (traceLegend.length + 1),
          num: traceLegend.length + 1,
        };
        traceLegend.push(traceLegendByKey[rawKey]);
      }
      return traceLegendByKey[rawKey];
    }
    if (architectureTrace) {
      sides.forEach(function (side) {
        side.spans.forEach(function (span) {
          traceLegendEntry(span, side);
        });
      });
    }

    /* ── chrome: TOTAL headline(s) — the stat kind's counter, rescaled to a
       corner readout — plus the replay affordance ── */
    // Host marker: lets this kind's own Present-mode sizing be written
    // Without touching a single shared .kch rule (chart.css)
    host.classList.add("kch-trace");
    if (architectureTrace) {
      host.classList.add("ktrace");
    }
    const head = kitEl("div", "kch-trace-head" + (isRace ? " kch-trace-race-head" : ""));
    let replayBtn = null;
    if (!architectureTrace) {
      replayBtn = kitEl("button", "kch-trace-replay", "▶");
      replayBtn.type = "button";
      replayBtn.setAttribute("aria-label", "replay trace");
    }
    const totals = sideLayouts.map(function (layout, i) {
      var side = sides[i];
      var box = kitEl(
        "div",
        "kch-trace-total " + (isRace ? toneClass(null, side.tone) : "kch-tone-accent"),
      );
      if (side.label) {
        var lb = kitEl("div", "kch-trace-total-label");
        lb.textContent = side.label;
        box.appendChild(lb);
      }
      var valEl = kitEl("div", "kch-stat-value");
      var nEl = kitEl("span", "kch-stat-n");
      var endpoint = String(Math.round(layout.total));
      var sizer = kitEl(
        "span",
        "kch-stat-n-sizer",
        architectureTrace ? endpoint + " / " + endpoint : endpoint,
      );
      sizer.setAttribute("aria-hidden", "true");
      var live = kitEl("span", "kch-stat-n-live", architectureTrace ? endpoint : "0");
      live.setAttribute("aria-hidden", "true");
      nEl.appendChild(sizer);
      nEl.appendChild(live);
      valEl.appendChild(nEl);
      if (unit) {
        var uEl = kitEl("span", "kch-stat-unit");
        uEl.textContent = unit;
        valEl.appendChild(uEl);
      }
      box.appendChild(valEl);
      head.appendChild(box);
      return { box, live };
    });
    let deltaEl = null;
    if (isRace) {
      deltaEl = kitEl("div", "kch-trace-delta");
      head.insertBefore(deltaEl, totals[1].box);
    }
    host.append(head);
    if (replayBtn) {
      host.appendChild(replayBtn);
    }

    /* ── figure: the waterfall(s), one shared SVG + shared time axis ── */
    const fig = kitEl("figure");
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", data.ariaLabel || (isRace ? "latency race" : "latency trace"));
    fig.append(svg);
    host.append(fig);

    // The step's time band, created FIRST so it paints behind every bar it
    // Spans (see the walkthrough block at the bottom of this function).
    const bandEls = architectureTrace
      ? sideLayouts.map(function () {
          return add(svg, "rect", { class: "kch-trace-band", x: 0, y: 0, width: 0, height: 0 });
        })
      : [add(svg, "rect", { class: "kch-trace-band", x: 0, y: 0, width: 0, height: 0 })];
    const bandEl = bandEls[0];

    let y = M.t;
    const blocks = [],
      allSpanEls = [];
    sideLayouts.forEach((layout, si) => {
      var side = sides[si],
        top = y;
      if (isRace) {
        add(svg, "text", { class: "kch-trace-side-cap", x: M.l, y: top }, side.label);
      }
      // extra headroom under the race side-cap so it never crowds the first
      // lane's own span label (both are small mono/sans text stacked tight)
      var laneEls = [],
        spanEls = [],
        ly = top + (isRace ? CAP_GAP : 0);
      layout.lanes.forEach(function (lane, li) {
        var laneH = laneRows[li] * ROWH;
        if (lane.name) {
          laneEls.push(
            add(
              svg,
              "text",
              { class: "kch-trace-lane", x: M.l - 12, y: ly + laneH / 2 + 5, "text-anchor": "end" },
              lane.name,
            ),
          );
        }
        lane.items.forEach(function (it, itIdx) {
          var s = it.span,
            isWait = s.kind === "wait";
          var legendEntry = architectureTrace ? traceLegendEntry(s, side) : null;
          var cy = ly + it.row * ROWH + ROWH / 2;
          var bx = X(Number(s.start)),
            bw = Math.max(3, X(Number(s.start) + Number(s.dur)) - bx);
          var g = add(svg, "g", {
            class:
              "kch-item " +
              toneClass(s.tone, isWait ? "context" : side.tone) +
              (isWait ? " kch-trace-wait" : " kch-trace-work"),
            "data-trace-key": legendEntry ? legendEntry.key : "",
          });
          var defs = add(g, "defs", {});
          var clipId = "kchtcl" + (window.__kchClipN = (window.__kchClipN || 0) + 1);
          add(add(defs, "clipPath", { id: clipId }), "rect", {
            x: bx,
            y: cy - BARH / 2,
            width: bw,
            height: BARH,
            rx: 6,
          });
          add(g, "rect", {
            class: "kch-trace-track",
            x: bx,
            y: cy - BARH / 2,
            width: bw,
            height: BARH,
            rx: 6,
          });
          var fillAttrs = {
            class: "kch-trace-fill",
            x: bx,
            y: cy - BARH / 2,
            width: 0,
            height: BARH,
          };
          if (isWait) {
            var hatchId = "kchth" + (window.__kchHatchN = (window.__kchHatchN || 0) + 1);
            var pat = add(defs, "pattern", {
              id: hatchId,
              width: 7,
              height: 7,
              patternUnits: "userSpaceOnUse",
              patternTransform: "rotate(45)",
            });
            add(pat, "rect", { width: 7, height: 7, class: "kch-trace-hatch-bg" });
            add(pat, "line", { x1: 0, y1: 0, x2: 0, y2: 7, class: "kch-trace-hatch-line" });
            // an inline STYLE, not the `fill` presentation attribute: SVG
            // presentation attributes lose to ANY stylesheet rule regardless
            // of specificity, and the shared `.kch-trace-fill{fill:var(--kch-c)}`
            // rule (every other span needs it) was silently flattening this
            // pattern reference back to a solid tone fill — found by
            // screenshotting a "hatched" bar that rendered solid gray.
            fillAttrs.style = "fill:url(#" + hatchId + ")";
          }
          var fillWrap = add(g, "g", { "clip-path": "url(#" + clipId + ")" });
          var fillEl = add(fillWrap, "rect", fillAttrs);
          if (architectureTrace) {
            var marker = add(g, "g", {
              class: "ktrace-span-marker",
              transform: "translate(" + (bx + bw / 2) + " " + cy + ")",
            });
            add(marker, "circle", { r: 9 });
            add(marker, "text", { x: 0, y: 3.5, "text-anchor": "middle" }, String(legendEntry.num));
          }
          var nextStart = null;
          for (var j = itIdx + 1; j < lane.items.length; j++) {
            if (lane.items[j].row === it.row) {
              nextStart = Number(lane.items[j].span.start);
              break;
            }
          }
          // Label + duration share one caption above the bar (a tspan keeps
          // the duration in its own mono/dim style). The full authored label
          // stays intact; the caption flips inward when it reaches the right
          // edge.
          var labelText = s.label || "";
          var durText = " · " + fmt(s.dur);
          var labelFlip = bx + (labelText + durText).length * 7.2 > W - M.r;
          if (!architectureTrace && (labelText || durText)) {
            var labelEl = add(g, "text", {
              class: "kch-trace-label",
              x: labelFlip ? bx + bw : bx,
              y: cy - BARH / 2 - LABEL_LIFT,
              "text-anchor": labelFlip ? "end" : "start",
            });
            labelEl.appendChild(document.createTextNode(labelText));
            if (durText) {
              var durSpan = document.createElementNS(NS, "tspan");
              durSpan.setAttribute("class", "kch-trace-dur");
              durSpan.textContent = durText;
              labelEl.appendChild(durSpan);
            }
          }
          // ── the step's positive mark (built once per span, shown by class)
          // A walkthrough step used to be pure subtraction: everything else
          // faded and the viewer had to work out what was left. These two
          // marks say where to look instead — an accent ring drawn around
          // the span itself, and its duration spelled out on the bar.
          // Inline goes INSIDE the bar when the bar is wide enough and the
          // next span crowds the space after it; otherwise just past its
          // end, where nothing else is drawn.
          add(g, "rect", {
            class: "kch-trace-ring",
            x: bx - 3,
            y: cy - BARH / 2 - 3,
            width: bw + 6,
            height: BARH + 6,
            rx: 8,
          });
          var gapAfter = (nextStart != null ? X(nextStart) : W - M.r) - (bx + bw);
          var durInside = gapAfter < 46 && bw >= 46;
          add(
            g,
            "text",
            {
              class: "kch-trace-focus-dur" + (durInside ? " inside" : ""),
              x: durInside ? bx + bw - 7 : bx + bw + 7,
              y: cy + 4,
              "text-anchor": durInside ? "end" : "start",
            },
            fmt(s.dur),
          );
          var hit = add(g, "rect", {
            class: "kch-hit",
            x: bx - 4,
            y: cy - ROWH / 2,
            width: bw + 8,
            height: ROWH,
            tabindex: 0,
          });
          hit.setAttribute(
            "aria-label",
            (s.label || "span") +
              ": " +
              fmt(s.dur) +
              (isWait ? " (wait)" : "") +
              (s.note ? " — " + s.note : ""),
          );
          wireHit(hit, g, function (px, py) {
            tipShow(px, py, s.label || "", [
              {
                tone: s.tone || (isWait ? "context" : side.tone),
                value: fmt(s.dur),
                label: (isWait ? "wait · " : "") + (s.note || "start " + fmt(Number(s.start))),
              },
            ]);
          });
          var entry = {
            span: s,
            side: side.key,
            lane: lane.name,
            bx,
            bw,
            fillEl,
            group: g,
            traceKey: legendEntry ? legendEntry.key : null,
          };
          spanEls.push(entry);
          allSpanEls.push(entry);
        });
        ly += laneH + LANE_GAP;
      });
      blocks.push({
        side,
        totalIdx: si,
        laneEls,
        spanEls,
        top,
        bottom: ly - LANE_GAP,
        bandEl: bandEls[si],
      });
      y = ly - LANE_GAP + (isRace && si === 0 ? RACE_GAP : 0);
    });
    const bottom = y;
    const sc = niceScale(overallMax);
    sc.ticks.forEach((tv) => {
      if (tv > sc.top + 1e-9) {
        return;
      }
      // X() maps 0..overallMax onto the plot width, so a nice-scale tick ABOVE
      // the trace's own total has no place on the axis: it painted past the
      // figure's right edge (and straight off the screen in Present, where the
      // figure is at its largest) — the waterfall's axis ends where its time does
      if (tv > overallMax + 1e-9) {
        return;
      }
      add(svg, "line", { class: "kch-grid", x1: X(tv), y1: M.t - 10, x2: X(tv), y2: bottom });
      add(
        svg,
        "text",
        { class: "kch-tick", x: X(tv), y: bottom + 26, "text-anchor": "middle" },
        fmtTick(tv),
      );
    });
    add(svg, "line", { class: "kch-base", x1: M.l, x2: W - M.r, y1: bottom + 4, y2: bottom + 4 });
    const H = bottom + AXIS_PAD;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const cursor = add(svg, "line", {
      class: "kch-trace-cursor",
      x1: X(0),
      x2: X(0),
      y1: M.t - 16,
      y2: bottom,
    });
    const cursorLabel = architectureTrace
      ? add(svg, "text", { class: "ktrace-cursor-label", x: X(0) + 8, y: M.t + 10 }, fmt(0))
      : null;
    const traceLegendEls = {},
      traceHoverHandlers = [];
    if (architectureTrace) {
      var traceLegendEl = kitEl("div", "kdf-legend ktrace-legend");
      traceLegendEl.setAttribute("role", "list");
      traceLegend.forEach((item) => {
        var li = kitEl("div", "kdf-legend-item");
        li.setAttribute("role", "listitem");
        li.tabIndex = 0;
        li.innerHTML =
          '<span class="kdf-legend-num">' +
          item.num +
          '</span><span class="kdf-legend-text">' +
          item.label +
          "</span>";
        var enter = function () {
          li.classList.add("hover");
          allSpanEls.forEach(function (e) {
            e.group.classList.toggle("ktrace-hover", e.traceKey === item.key);
          });
        };
        var leave = function () {
          li.classList.remove("hover");
          allSpanEls.forEach(function (e) {
            e.group.classList.remove("ktrace-hover");
          });
        };
        li.addEventListener("mouseenter", enter);
        li.addEventListener("mouseleave", leave);
        li.addEventListener("focus", enter);
        li.addEventListener("blur", leave);
        traceHoverHandlers.push({ li, enter, leave });
        traceLegendEl.appendChild(li);
        traceLegendEls[item.key] = li;
      });
      host.append(traceLegendEl);
    }

    dataTable(
      ["lane", "span", "kind", "start", "dur"].concat(isRace ? ["trace"] : []),
      allSpanEls.map((e) => {
        var row = [
          e.lane || "—",
          e.span.label,
          e.span.kind || "work",
          fmt(Number(e.span.start)),
          fmt(Number(e.span.dur)),
        ];
        if (isRace) {
          row.push(e.side);
        }
        return row;
      }),
    );

    /* ── replay: one elapsed clock `t` drives everything each frame — the
       cursor position, every span's partial fill, and both TOTAL numerals
       read off the SAME value, so they cannot drift out of sync. The sweep
       itself is linear (no easing) so ~2.6s of wall time always maps onto
       the trace's full duration regardless of `unit` scale. ── */
    let rafId = null;
    function setFrame(t, duringReplay) {
      cursor.setAttribute("x1", X(t));
      cursor.setAttribute("x2", X(t));
      if (cursorLabel) {
        const cursorX = X(t),
          labelAtEnd = cursorX > W - M.r - 64;
        cursorLabel.setAttribute("x", cursorX + (labelAtEnd ? -8 : 8));
        cursorLabel.setAttribute("text-anchor", labelAtEnd ? "end" : "start");
        cursorLabel.textContent = fmt(Math.round(t));
        cursorLabel.classList.toggle("on", Boolean(duringReplay));
      }
      blocks.forEach((block) => {
        var sideTotal = sideLayouts[block.totalIdx].total,
          traceStat = totals[block.totalIdx];
        var elapsed = Math.round(Math.min(t, sideTotal));
        traceStat.live.textContent = architectureTrace
          ? duringReplay
            ? elapsed + " / " + Math.round(sideTotal)
            : String(Math.round(sideTotal))
          : String(elapsed);
        traceStat.box.classList.toggle("kch-trace-done", t >= sideTotal - 1e-6);
        block.spanEls.forEach(function (e) {
          var frac = Math.max(0, Math.min(1, (t - Number(e.span.start)) / Number(e.span.dur)));
          e.fillEl.setAttribute("width", frac * e.bw);
        });
      });
    }
    function finish() {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      rafId = null;
      setFrame(overallMax, false);
      cursor.classList.add("kch-trace-cursor-done");
      if (isRace && deltaEl) {
        const bt = sideLayouts[0].total,
          at = sideLayouts[1].total;
        const faster = Math.min(bt, at),
          slower = Math.max(bt, at) || 1;
        const pct = Math.round((1 - faster / slower) * 100),
          ms = Math.round(slower - faster);
        const sign = at <= bt ? "−" : "+";
        deltaEl.textContent = architectureTrace
          ? fmt(ms) + (at <= bt ? " saved · " + pct + "% faster" : " added · " + pct + "% slower")
          : `${sign + pct}% · ${sign}${fmt(ms)}`;
        deltaEl.classList.add("on");
      }
    }
    function play() {
      if (window.__kitMeasuring) {
        return;
      }
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      if (REDUCED_MOTION) {
        finish();
        return;
      }
      totals.forEach((t) => {
        t.box.classList.remove("kch-trace-done");
      });
      if (deltaEl) {
        deltaEl.classList.remove("on");
      }
      cursor.classList.remove("kch-trace-cursor-done");
      let start = null;
      (function frame(ts) {
        if (start == null) {
          start = ts;
        }
        const p = Math.min(1, (ts - start) / REPLAY_MS); // Linear — see header note
        setFrame(p * overallMax, architectureTrace);
        if (p < 1) {
          rafId = requestAnimationFrame(frame);
        } else {
          finish();
        }
      })(performance.now());
    }
    if (REDUCED_MOTION) {
      finish();
      if (replayBtn) {
        replayBtn.style.display = "none";
      }
      cursor.style.display = "none";
      if (cursorLabel) {
        cursorLabel.style.display = "none";
      }
    } else if (architectureTrace) {
      finish();
    } else {
      setFrame(0, false);
    }
    if (replayBtn) {
      replayBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        play();
      });
    }

    let autoPlayed = false,
      obs = null;
    if (
      !REDUCED_MOTION &&
      !document.body.classList.contains("presenting") &&
      "IntersectionObserver" in window
    ) {
      obs = new IntersectionObserver(
        (es) => {
          es.forEach(function (e) {
            if (
              e.isIntersecting &&
              !autoPlayed &&
              !document.body.classList.contains("presenting")
            ) {
              autoPlayed = true;
              play();
              obs.disconnect();
            }
          });
        },
        { threshold: 0.35 },
      );
      obs.observe(host);
    }
    // Teardown for a live re-render on this same host (kitMount calls this
    // Before wiping innerHTML): the rAF loop and the observer both outlive
    // A single render pass and don't get cleaned up just by removing DOM.
    host.__kitDispose = function __kitDispose() {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      rafId = null;
      if (obs) {
        obs.disconnect();
      }
      traceHoverHandlers.forEach((h) => {
        h.li.removeEventListener("mouseenter", h.enter);
        h.li.removeEventListener("mouseleave", h.leave);
        h.li.removeEventListener("focus", h.enter);
        h.li.removeEventListener("blur", h.leave);
      });
    };

    /* ── walkthrough focus: MARK, never merely dim. Dimming alone tells a
       viewer that something changed, not where to look — the matched spans
       get the positive treatment (accent ring + their duration inline, both
       built above) and a translucent band spans the step's own time range
       across BOTH traces, so a race step reads as "this stretch of the
       clock, on both sides" rather than "some bars faded". ── */
    function clearFocus() {
      allSpanEls.forEach((e) => {
        e.group.classList.remove("kch-dim", "kch-trace-focus");
      });
      Object.keys(traceLegendEls).forEach((key) => {
        traceLegendEls[key].classList.remove("active", "dim");
      });
      bandEls.forEach((el) => {
        el.classList.remove("on");
      });
    }
    function bandOver(matched) {
      if (architectureTrace) {
        blocks.forEach((block) => {
          var sideMatched = matched.filter(function (e) {
            return e.side === block.side.key;
          });
          if (!sideMatched.length) {
            block.bandEl.classList.remove("on");
            return;
          }
          var sideFrom = Infinity,
            sideTo = -Infinity;
          sideMatched.forEach(function (e) {
            sideFrom = Math.min(sideFrom, Number(e.span.start));
            sideTo = Math.max(sideTo, Number(e.span.start) + Number(e.span.dur));
          });
          block.bandEl.setAttribute("x", X(sideFrom));
          block.bandEl.setAttribute("width", Math.max(2, X(sideTo) - X(sideFrom)));
          block.bandEl.setAttribute("y", block.top);
          block.bandEl.setAttribute("height", Math.max(2, block.bottom - block.top));
          block.bandEl.classList.add("on");
        });
        return;
      }
      if (matched.length === 0) {
        bandEl.classList.remove("on");
        return;
      }
      let from = Infinity,
        to = -Infinity;
      matched.forEach((e) => {
        from = Math.min(from, Number(e.span.start));
        to = Math.max(to, Number(e.span.start) + Number(e.span.dur));
      });
      const top = M.t - 16;
      bandEl.setAttribute("x", X(from));
      bandEl.setAttribute("width", Math.max(2, X(to) - X(from)));
      bandEl.setAttribute("y", top);
      bandEl.setAttribute("height", Math.max(2, bottom - top));
      bandEl.classList.add("on");
    }
    function applyTraceFocus(f) {
      // Present has no scroll-in moment, and the arrival observer below
      // Deliberately stays out of the deck — so without this a walkthrough
      // Step narrated an EMPTY waterfall: every bar an unfilled track, both
      // TOTALs reading 0. Any non-replay step (arrival included) shows the
      // Finished trace; the replay step still sweeps it from zero, and an
      // In-flight sweep is never interrupted.
      if (!rafId && !(f && f.replay) && document.body.classList.contains("presenting")) {
        finish();
      }
      if (!f) {
        clearFocus();
        return;
      }
      // A replay step shows the whole race — clear any dimming/marking a
      // PRIOR walkthrough step left behind (focus:{replay:true} never marks
      // Anything of its own, so without this a "watch it race" step would
      // Silently inherit whichever lane the step before it was narrating)
      if (f.replay) {
        clearFocus();
        play();
        return;
      }
      const laneKey = f.lane != null ? String(f.lane) : null,
        spanKey = f.span != null ? String(f.span) : null;
      const spanKeys = new Set((f.spans || []).map(String));
      const matched = [],
        matchedLegend = {};
      allSpanEls.forEach((e) => {
        var match =
          (laneKey != null && e.lane === laneKey) ||
          (spanKey != null && String(e.span.id) === spanKey) ||
          spanKeys.has(String(e.span.id));
        e.group.classList.toggle("kch-dim", !match);
        e.group.classList.toggle("kch-trace-focus", match);
        if (match) {
          matched.push(e);
          if (e.traceKey) {
            matchedLegend[e.traceKey] = true;
          }
        }
      });
      Object.keys(traceLegendEls).forEach((key) => {
        traceLegendEls[key].classList.toggle("active", Boolean(matchedLegend[key]));
        traceLegendEls[key].classList.toggle("dim", !matchedLegend[key]);
      });
      bandOver(matched);
    }
    let walk;
    if (architectureTrace) {
      walk = buildWalk(
        function (focus, state) {
          if (state.kind !== "step") {
            finish();
          }
          applyTraceFocus(focus);
        },
        {
          overviewNote: "Numbered spans share one time axis; hatched spans are waiting.",
          overviewTitle: "Read the trace →",
        },
      );
      const traceWalkEl = walk ? walk.el : null;
      if (traceLegendEl || traceWalkEl) {
        const traceFooter = kitEl("div", "ktrace-footer");
        if (traceLegendEl) {
          traceFooter.appendChild(traceLegendEl);
        }
        if (traceWalkEl) {
          traceFooter.append(traceWalkEl);
        }
        host.append(traceFooter);
      }
    } else {
      walk = buildTraceWalk(applyTraceFocus);
    }
    // Deliberately NOT routed through the shared present(groups, fig, drawIn,
    // Walk, batch) driver used by every other kind: that wrapper's job is a
    // Per-item (or single-batch) opacity/transform reveal, and trace already
    // Has its own, stronger arrival moment — the replay sweep itself. Arrival
    // (i=0) always shows the complete static waterfall (same "batched"
    // Instinct that made scatter/histogram reveal in one step, just via a
    // Bespoke driver instead of present(..., batch:true)); a fade-in
    // Underneath a cursor sweep would compete for the same first-impression
    // Beat, not add to it. If a future change wants staggered arrival back,
    // It belongs here, not as a tweak to the shared present() contract.
    if (walk) {
      return { count: walk.count, go: walk.go, play };
    }
    return {
      count: 1,
      go() {
        // A walk-less trace has no step handler, so the arrival-finish the
        // walk's overview step would run must live here — without it a
        // walk-less trace arrives EMPTY in Present (unfilled bars, 0 total).
        if (document.body.classList.contains("presenting") && !window.__kitMeasuring && !rafId) {
          finish();
        }
      },
      play,
    };
  }

  /* Per-mark hover/focus wiring: pointer and keyboard get the same readout */
  function wireHit(hit, g, show) {
    hit.addEventListener("pointermove", (e) => {
      g.classList.add("kch-lift");
      show(e.clientX, e.clientY);
    });
    hit.addEventListener("pointerleave", () => {
      g.classList.remove("kch-lift");
      tipHide();
    });
    // Touch/pen lift and cancel don't reliably emit pointerleave — dismiss
    // The tooltip and drop kch-lift on pointerup/cancel for non-mouse
    // Pointers, leaving mouse hover to pointerleave above.
    function dismissNonMouse() {
      g.classList.remove("kch-lift");
      tipHide();
    }
    hit.addEventListener("pointerup", (e) => {
      if (e.pointerType === "mouse") {
        return;
      }
      dismissNonMouse();
    });
    hit.addEventListener("pointercancel", (e) => {
      if (e.pointerType === "mouse") {
        return;
      }
      dismissNonMouse();
    });
    hit.addEventListener("focus", () => {
      g.classList.add("kch-lift");
      var r = hit.getBoundingClientRect();
      show(r.left + r.width * 0.4, r.top + r.height);
    });
    hit.addEventListener("blur", () => {
      g.classList.remove("kch-lift");
      tipHide();
    });
  }

  /* Present driver + first-view animation. Read view renders fully lit
     (like flow); in Present, items arrive one keypress at a time. `batch`
     collapses the per-item walk into one reveal step — for kinds (scatter,
     histogram) where one-element-at-a-time kills the presentation flow. */
  function present(groups, fig, drawIn, walk, batch) {
    let played = false;
    // One arrival per group: mark animation (draw-in or slide) + numeral count-up
    function reveal(g, delay) {
      if (g.__kchLive) {
        return;
      }
      g.__kchLive = true;
      if (!REDUCED_MOTION && drawIn) {
        drawIn(g);
      }
      (g.__kchCount || []).forEach((c) => {
        setTimeout(function () {
          countUp(c);
        }, delay || 0);
      });
    }
    function go(i) {
      const presenting = document.body.classList.contains("presenting");
      groups.forEach((g, k) => {
        // batch: one keypress lights every group at once (with a small
        // stagger so they pop, not slam); otherwise the per-item walk
        // reveals one group per step.
        var off = batch ? i < 1 : k >= i;
        g.classList.toggle("kch-off", off);
        if (!off && presenting && !window.__kitMeasuring) {
          reveal(g, batch ? k * 50 : 140);
        }
      });
    }
    // A walkthrough replaces the per-item reveal: the chart is the canvas,
    // Arrival shows the overview, and each keypress focuses the next step
    if (!walk) {
      go(batch ? 0 : groups.length);
    }
    function play() {
      if (played || window.__kitMeasuring) {
        return;
      }
      played = true;
      if (!REDUCED_MOTION && !drawIn) {
        // Pre-state without transition, force reflow, release with a stagger
        groups.forEach((g) => {
          g.classList.add("kch-pre");
        });
        fig.getBoundingClientRect();
        groups.forEach((g, k) => {
          g.style.transitionDelay = k * 70 + "ms";
          g.classList.remove("kch-pre");
          setTimeout(
            function () {
              g.style.transitionDelay = "";
            },
            900 + k * 70,
          );
        });
      }
      // Kch-off is the pre-arrival state set by go(0) for batch kinds —
      // Play() is the arrival, so it must clear it or scatter/histogram
      // Stay invisible in read view forever
      groups.forEach((g, k) => {
        g.classList.remove("kch-off");
        reveal(g, 90 * k);
      });
    }
    if (!document.body.classList.contains("presenting") && "IntersectionObserver" in window) {
      const obs = new IntersectionObserver(
        function (es) {
          es.forEach(function (e) {
            if (e.isIntersecting && !document.body.classList.contains("presenting")) {
              play();
              obs.disconnect();
            }
          });
        },
        { threshold: 0.35 },
      );
      obs.observe(host);
    }
    if (walk) {
      return { count: walk.count, go: walk.go, play };
    }
    return { count: batch ? 2 : groups.length + 1, go, play };
  }

  // Present captures the object returned by the authored render. Studio can
  // Re-render this host in place (line ↔ area), so keep that captured object
  // Stable and route it to the driver whose closures point at the live DOM.
  if (!host.__kitChartHolder) {
    host.__kitChartHolder = {
      count: driver.count,
      go(...args) {
        host.__kitChartStep = Number(args[0]) || 0;
        if (host.__kitChartDriver && host.__kitChartDriver.go) {
          return host.__kitChartDriver.go(...args);
        }
      },
      play(...args) {
        if (host.__kitChartDriver && host.__kitChartDriver.play) {
          return host.__kitChartDriver.play(...args);
        }
      },
    };
  }
  host.__kitChartHolder.count = driver.count;
  host.__kitChartDriver = driver;
  globalThis.ExplainerKit.observeContentSpacing(host, () => {
    const step = host.__kitChartStep;
    renderChart(host, { ...data, __kitAdjusted: true });
    if (Number.isInteger(step)) {
      host.__kitChartHolder.go(step);
    }
  });
  return host.__kitChartHolder;
}
