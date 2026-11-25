/* Component: flow — see _kit/CONTRACTS.md#flow. Old DATA contract kept
   exactly (caption, items[]: station/gate, kind, when, label, cmd, sub/subs,
   check, loop, outcomes) plus an additive `mode:'timeline'` variant
   (at/state/today). Returns {count, go} so a Present slide can walk it.
   New visual, built on the same pulse-engine idea as architecture/data-flow
   (a bright head + fading tail scrubbed along stroke-dashoffset, driven by
   MOTION — see data-flow.js's pulse engine comment for why): one thick track,
   stations as typography standing on it, and a diamond gate that forks into
   a continuing track and a stopping branch that draws in once lit. */
let kitFlowSeq = 0;

/* Runtime motion contract (shared with data-flow.js):
   window.__kitSetMotionPreset('calm' | 'normal' | 'off')
   updates mounted components synchronously and emits `kitmotionpresetchange`.
   Invalid names are ignored and return false. Reduced-motion handling remains
   independent and authoritative through the kit's REDUCED_MOTION gate. */
function kfEnsureMotionPreset() {
  const root = typeof window !== "undefined" ? window : globalThis;
  if (typeof root.__kitSetMotionPreset !== "function") {
    root.__kitMotionPreset = "normal";
    root.__kitSetMotionPreset = function __kitSetMotionPreset(name) {
      if (!["calm", "normal", "off"].includes(name)) {
        return false;
      }
      root.__kitMotionPreset = name;
      if (typeof root.dispatchEvent === "function" && typeof CustomEvent === "function") {
        root.dispatchEvent(new CustomEvent("kitmotionpresetchange", { detail: { preset: name } }));
      }
      return name;
    };
  }
  return !["calm", "normal", "off"].includes(root.__kitMotionPreset)
    ? "normal"
    : root.__kitMotionPreset;
}
kfEnsureMotionPreset();

// Legacy short tone names ('warn','ok') from the pre-v3 contract map onto
// The shared accent/success/warning/violet vocabulary; anything else (or
// Nothing) is neutral.
function kfTone(kind, fallback) {
  if (kind === "accent" || kind === "success" || kind === "warning" || kind === "violet") {
    return kind;
  }
  if (kind === "warn") {
    return "warning";
  }
  if (kind === "ok") {
    return "success";
  }
  return fallback || "neutral";
}

// `at:'Q3 25'`-style quarter labels, or anything Date.parse understands.
// Returns a sortable number or null — callers fall back to equal spacing
// The moment any item fails to parse, rather than half-place a timeline.
function kfParseAt(s) {
  if (!s) {
    return null;
  }
  const m = /^Q([1-4])\D*(\d{2,4})$/i.exec(String(s).trim());
  if (m) {
    const q = Math.trunc(Number(m[1]));
    let y = Math.trunc(Number(m[2]));
    if (y < 100) {
      y += 2000;
    }
    return y * 4 + q;
  }
  const t = Date.parse(String(s).trim());
  return Number.isNaN(t) ? null : t;
}

function kfLayoutWidth(width, itemCount) {
  const minCardWidth = 150;
  const cardClearance = 36;
  const minWidth = 220 + Math.max(0, itemCount - 1) * (minCardWidth + cardClearance);
  const requestedWidth = Number(width) || 1200;
  if (requestedWidth > 4800) {
    throw new Error("renderFlow: data.width supports at most 4800, got " + requestedWidth);
  }
  return Math.max(requestedWidth, minWidth);
}

function kfAppendCardText(parent, tag, value, className) {
  if (!value) {
    return;
  }
  const child = document.createElement(tag);
  if (className) {
    child.className = className;
  }
  child.textContent = String(value);
  parent.appendChild(child);
}

function kfAdjustedData(data, state) {
  return {
    ...data,
    layout: state.layout,
    detail: state.detail,
    view: state.view,
    items: (data.items || []).map(function (item) {
      if (state.detail !== "key") {
        return Object.assign({}, item);
      }
      const simple = Object.assign({}, item);
      delete simple.sub;
      delete simple.subs;
      if (data.mode !== "timeline") {
        delete simple.when;
      }
      return simple;
    }),
  };
}

function kfItems(data) {
  return (data.items || []).map(function (item) {
    if (!kitLegacyComponentCompat || item.subs || !String(item.sub || "").includes("·")) {
      return item;
    }
    const parts = String(item.sub)
      .split("·")
      .map((part) => part.trim())
      .filter(Boolean);
    return Object.assign({}, item, {
      sub: "",
      subs: parts.length <= 2 ? parts : [parts[0], parts.slice(1).join(" · ")],
    });
  });
}

function kfValidateItems(items) {
  items.forEach(function (item, index) {
    const where = "item " + (index + 1) + " ";
    const subs = item.subs || (item.sub ? [item.sub] : []);
    if (subs.length > 2) {
      throw new Error("renderFlow: " + where + "supports at most 2 sub lines");
    }
    subs.forEach(function (sub, subIndex) {
      if (String(sub).includes("·")) {
        throw new Error(
          "renderFlow: " +
            where +
            "sub " +
            (subIndex + 1) +
            " must not use · lists — use separate subs entries",
        );
      }
    });
    if ((item.outcomes || []).length > 3) {
      throw new Error("renderFlow: " + where + "supports at most 3 outcomes");
    }
  });
}

function kfRenderDown(host, data) {
  kitMount(host);
  kitValidateTextCaps(host, "renderFlow", data);
  const items = kfItems(data);
  if (!items.length || items.length > 6) {
    throw new Error("renderFlow: data.items supports 1-6 items");
  }
  kfValidateItems(items);
  host.classList.add("kf", "kf-down");
  host.dataset.layout = "down";
  host.dataset.view = data.view || "follow";
  if (data.mode === "timeline" && data.today) {
    host.append(kitEl("p", "kf-down-today", "Today · " + data.today));
  }
  const canvas = kitEl("div", "kf-down-canvas");
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", data.ariaLabel || "Process flow");
  const entries = items.map(function (item, index) {
    const row = kitEl("div", "kf-down-row");
    const marker = kitEl(
      "span",
      item.type === "gate" ? "kf-down-marker gate" : "kf-down-marker",
      item.type === "gate" ? "" : String(index + 1),
    );
    marker.setAttribute("aria-hidden", "true");
    const card = kitEl("div", "kf-down-card " + kfTone(item.kind, "neutral"));
    kfAppendCardText(card, "span", item.at);
    if (item.when !== item.at) {
      kfAppendCardText(card, "span", item.when);
    }
    kfAppendCardText(card, "strong", item.label, item.cmd ? "kf-cmd" : "");
    const status = [
      data.mode === "timeline" ? item.state : "",
      item.check ? "Complete" : "",
      item.loop ? "Repeats" : "",
    ].filter(Boolean);
    if (status.length) {
      kfAppendCardText(card, "small", status.join(" · "), "kf-down-status");
    }
    (item.subs || (item.sub ? [item.sub] : [])).forEach((sub) =>
      kfAppendCardText(card, "small", sub),
    );
    if ((item.outcomes || []).length) {
      const outcomes = kitEl("div", "kf-down-outcomes");
      item.outcomes.forEach(function (outcome) {
        const chip = kitEl("span", kfTone(outcome && (outcome.kind || outcome.tone), "neutral"));
        chip.textContent =
          typeof outcome === "string"
            ? outcome
            : (outcome && (outcome.label || outcome.text)) || "";
        outcomes.append(chip);
      });
      card.append(outcomes);
    }
    row.append(marker, card);
    canvas.append(row);
    return row;
  });
  host.append(canvas);
  let caption = null;
  if (data.caption) {
    caption = kitEl("figcaption");
    kitSetPassiveInline(caption, data.caption);
    host.append(caption);
  }
  const count = items.length + 1;
  let current = 0;
  function go(index) {
    current = Math.max(0, Math.min(index, count - 1));
    entries.forEach(function (entry, itemIndex) {
      entry.classList.toggle("lit", data.view === "full" || itemIndex < current);
    });
    if (caption) {
      caption.classList.toggle("dim", data.view !== "full" && current < items.length);
    }
  }
  go(data.view === "full" ? count - 1 : 0);
  return { count, current: () => current, go };
}

function renderFlow(sel, data) {
  const host = kitMount(sel);
  if (!data.__kitAdjusted) {
    const hasDetail = (data.items || []).some(
      (item) => item.sub || (item.subs || []).length || item.when,
    );
    const options = [
      {
        choices: ["across", "down"],
        choiceLabels:
          data.mode === "timeline"
            ? { across: "Timeline", down: "Event briefing" }
            : { across: "Process map", down: "Stage briefing" },
        choiceDescriptions:
          data.mode === "timeline"
            ? {
                across: "Shared horizon · Compare when events happen.",
                down: "Event briefing · Read each date, status, and outcome in order.",
              }
            : {
                across: "Process map · See the route and its decision branches.",
                down: "Stage briefing · Read the work and outcomes at each stage.",
              },
        key: "layout",
        label: "Layout",
        type: "choice",
      },
    ];
    if (hasDetail) {
      options.push({
        choices: ["key", "more"],
        choiceLabels: { key: "Key text", more: "More text" },
        key: "detail",
        label: "Text",
        type: "choice",
      });
    }
    options.push({
      choices: ["full", "follow"],
      choiceLabels: { full: "Full", follow: "Follow" },
      key: "view",
      label: "View",
      type: "choice",
    });
    const adjustment = globalThis.ExplainerKit.registerAdjustments(host, {
      base: data,
      defaults: {
        detail: data.detail || "more",
        layout: data.layout || "across",
        view: data.view || "follow",
      },
      label: data.ariaLabel || (data.mode === "timeline" ? "Timeline" : "Flow"),
      options,
      apply(state, key) {
        const step = host.__kitPresentHolder ? host.__kitPresentHolder.current() : 0;
        renderFlow(host, {
          ...kfAdjustedData(host.__kitAdjustments.base, state),
          __kitAdjusted: true,
        });
        if (key !== "view") {
          host.__kitPresentHolder.go(step);
        }
      },
    });
    data = kfAdjustedData(adjustment.base, adjustment.state);
  }
  host.dataset.layout = data.layout || "across";
  host.dataset.view = data.view || "follow";
  host.classList.toggle("kf-down", data.layout === "down");
  host.classList.toggle("kf-timeline", data.mode === "timeline");
  const driver = data.layout === "down" ? kfRenderDown(host, data) : kfRenderAcross(host, data);
  const stable = globalThis.ExplainerKit.stableDriver(host, driver);
  globalThis.ExplainerKit.observeContentSpacing(host, () => {
    const step = host.__kitPresentHolder.current();
    renderFlow(host, { ...data, __kitAdjusted: true });
    host.__kitPresentHolder.go(step);
  });
  return stable;
}

function kfRenderAcross(sel, data) {
  const host = kitMount(sel);
  kitValidateTextCaps(host, "renderFlow", data);
  host.classList.add("kf");
  let motionPreset = kfEnsureMotionPreset();
  host.dataset.motionPreset = motionPreset;
  host.dataset.zoom = "";
  const uid = "kf-" + ++kitFlowSeq;
  const contentSpacing = globalThis.ExplainerKit.contentSpacing();
  const items = kfItems(data);
  if (items.length === 0) {
    throw new Error("renderFlow: data.items is required");
  }
  if (items.length > 6) {
    throw new Error("renderFlow: data.items supports at most 6 items, got " + items.length);
  }
  kfValidateItems(items);
  const mode = data.mode === "timeline" ? "timeline" : "default";
  // Stamp a mode-specific class so the studio picker can tell timeline
  // Hosts apart from plain flow hosts (both carry .kf)
  if (mode === "timeline") {
    host.classList.add("kf-timeline");
  }
  // Minimal is a whitepaper register (no pulses/glow, static final state);
  // Reduced motion asks for the same "everything final" outcome. Both
  // Collapse to one flag so every render path only has to check once.
  const STATIC = REDUCED_MOTION || document.body.dataset.style === "minimal";

  // One visual for both modes: stations are typography standing on a thick
  // track, a gate is a real fork, and timeline dates sit on the axis below.
  const n = items.length;
  const W = kfLayoutWidth(data.width, n);
  let margin = 110;
  const RAIL_Y = 164,
    CARD_H = 132,
    CARD_GAP = 22 * contentSpacing;
  let span = W - margin * 2;
  let pitch = n > 1 ? span / (n - 1) : span;
  let CARD_W = Math.max(150, Math.min(240, pitch - 36));
  margin = Math.max(margin, CARD_W / 2 + 10);
  span = W - margin * 2;
  pitch = n > 1 ? span / (n - 1) : span;
  CARD_W = Math.max(150, Math.min(240, pitch - 36));

  function equalXs() {
    return items.map((_, i) => (n > 1 ? margin + i * pitch : W / 2));
  }
  let xs = equalXs();
  const atValues = items.map(function () {
    return null;
  });
  let timelineOK = false;
  if (mode === "timeline") {
    const stationIdx = [];
    items.forEach((it, i) => {
      if (it.type !== "gate") {
        stationIdx.push(i);
      }
    });
    const parsed = stationIdx.map(function (i) {
      atValues[i] = kfParseAt(items[i].at);
      return atValues[i];
    });
    timelineOK =
      stationIdx.length > 1 &&
      parsed.every((v) => v != null) &&
      Math.min.apply(Math, parsed) !== Math.max.apply(Math, parsed);
    if (timelineOK) {
      const lo = Math.min.apply(Math, parsed),
        hi = Math.max.apply(Math, parsed);
      // Stations keep their proportional date-based positions; gates have
      // No parsed `at` value, so place each between its neighbouring
      // Stations (interpolated by index) rather than at margin + i * pitch,
      // Which would lie about where the gate sits on the timeline.
      const positioned = items.map(function (it, i) {
        return atValues[i] != null ? margin + ((atValues[i] - lo) / (hi - lo)) * span : null;
      });
      xs = positioned.map((x, i) => {
        if (x != null) {
          return x;
        }
        var prevI = i - 1,
          nextI = i + 1;
        while (prevI >= 0 && positioned[prevI] == null) {
          prevI--;
        }
        while (nextI < items.length && positioned[nextI] == null) {
          nextI++;
        }
        if (prevI >= 0 && nextI < items.length) {
          var frac = (i - prevI) / (nextI - prevI);
          return positioned[prevI] + frac * (positioned[nextI] - positioned[prevI]);
        }
        if (prevI >= 0) {
          return positioned[prevI] + pitch;
        }
        if (nextI < items.length) {
          return positioned[nextI] - pitch;
        }
        return margin + i * pitch;
      });
    }
  }
  // Room below the track for the deepest fork any gate draws, or the date axis.
  const forkDepth = items.reduce(function (deepest, item) {
    const bad = (item.outcomes || []).filter((o) => o.tone === "bad").length;
    return Math.max(deepest, bad ? 60 + (bad - 1) * 32 : 0);
  }, 0);
  const H = RAIL_Y + Math.max(48, forkDepth + 30, mode === "timeline" ? 76 : 0);
  const ns = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs, parent) {
    const el = document.createElementNS(ns, tag);
    Object.keys(attrs || {}).forEach((k) => {
      el.setAttribute(k, attrs[k]);
    });
    if (parent) {
      parent.appendChild(el);
    }
    return el;
  }
  function pct(v, total) {
    return `${(100 * v) / total}%`;
  }
  function box(el, x, y, w, h) {
    el.style.left = pct(x, W);
    el.style.top = pct(y, H);
    el.style.width = pct(w, W);
    el.style.height = pct(h, H);
  }

  const canvas = kitEl("div", "kf-canvas");
  canvas.style.aspectRatio = `${W} / ${H}`;
  canvas.style.setProperty("--kf-floor", `${W}px`);
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", data.ariaLabel || "Process flow");
  if (STATIC) {
    canvas.classList.add("kf-static");
  }

  const svg = svgEl("svg", {
    class: "kf-wires",
    viewBox: "0 0 " + W + " " + H,
    preserveAspectRatio: "none",
    "aria-hidden": "true",
  });
  canvas.append(svg);

  canvas.classList.add("kf-plain");

  // Segments between consecutive items — each one independently lit and
  // Pulse-fired the moment go() crosses its threshold.
  const segs = items.slice(1).map(function (_, k) {
    var x1 = xs[k],
      x2 = xs[k + 1],
      len = Math.abs(x2 - x1);
    var el = svgEl(
      "path",
      { class: "kf-seg", d: "M" + x1 + " " + RAIL_Y + " L" + x2 + " " + RAIL_Y },
      svg,
    );
    var trail = svgEl(
      "path",
      { class: "kf-pulse-trail", d: "M" + x1 + " " + RAIL_Y + " L" + x2 + " " + RAIL_Y },
      svg,
    );
    var dot = svgEl(
      "path",
      { class: "kf-pulse-dot", d: "M" + x1 + " " + RAIL_Y + " L" + x2 + " " + RAIL_Y },
      svg,
    );
    trail.style.strokeDasharray = "16 " + len;
    dot.style.strokeDasharray = "3 " + len;
    return { el, trail, dot, len, fireCtl: null };
  });

  function fireSegment(seg) {
    if (STATIC || !MOTION || !seg.len || motionPreset === "off") {
      return;
    }
    const dur =
      Math.max(0.32, Math.min(0.8, seg.len / 90)) *
      (mode === "timeline" ? 2 : 1) *
      (motionPreset === "calm" ? 1.65 : 1);
    seg.dot.classList.add("on");
    seg.trail.classList.add("on");
    const dotCtl = MOTION.animate(
      seg.dot,
      { strokeDashoffset: [0, -seg.len] },
      { duration: dur, ease: "linear" },
    );
    const trailCtl = MOTION.animate(
      seg.trail,
      { strokeDashoffset: [0, -seg.len] },
      { duration: dur, ease: "linear", delay: 0.05 },
    );
    seg.fireCtl = [dotCtl, trailCtl];
    dotCtl.finished
      .then(() => {
        seg.dot.classList.remove("on");
        return seg;
      })
      .catch(() => {});
    trailCtl.finished
      .then(() => {
        seg.trail.classList.remove("on");
        seg.fireCtl = null;
        return seg;
      })
      .catch(() => {});
  }

  function kfArrive(el) {
    if (STATIC || !el) {
      return;
    }
    el.classList.remove("kf-arrive");
    el.getBoundingClientRect();
    el.classList.add("kf-arrive");
  }

  // Today marker — timeline mode only, and only when positions are truly
  // Proportional (a marker on an equally-spaced fallback axis would lie
  // About where "today" sits, so it's skipped rather than guessed).
  if (mode === "timeline" && timelineOK && data.today) {
    const t = kfParseAt(data.today);
    if (t != null) {
      const lo2 = Math.min.apply(
        Math,
        atValues.filter(function (v) {
          return v != null;
        }),
      );
      const hi2 = Math.max.apply(
        Math,
        atValues.filter(function (v) {
          return v != null;
        }),
      );
      if (hi2 > lo2) {
        const tx = margin + ((t - lo2) / (hi2 - lo2)) * span;
        // The date already sits on the axis; the marker only has to say
        // "today" and stay clear of the station text above the track.
        svgEl(
          "line",
          {
            class: "kf-today",
            x1: tx,
            x2: tx,
            y1: RAIL_Y - CARD_GAP + 4,
            y2: RAIL_Y + 46,
          },
          svg,
        );
        const lbl = svgEl(
          "text",
          {
            class: "kf-today-label",
            x: tx,
            y: RAIL_Y + 62,
            "text-anchor": "middle",
          },
          svg,
        );
        lbl.textContent = "today";
      }
    }
  }

  const itemEls = [];
  function plainBlock(it, x, tone, extra) {
    const block = kitEl("div", "kf-station " + tone + (extra || ""));
    box(block, x - CARD_W / 2, RAIL_Y - CARD_GAP - CARD_H, CARD_W, CARD_H);
    kfAppendCardText(block, "span", it.when);
    kfAppendCardText(block, "strong", it.label, it.cmd ? "kf-cmd" : "");
    (it.subs || (it.sub ? [it.sub] : [])).forEach(function (sub) {
      kfAppendCardText(block, "small", sub);
    });
    canvas.appendChild(block);
    return block;
  }
  items.forEach((it, i) => {
    var x = xs[i];
    if (it.type === "gate") {
      // The fork: the track carries on for outcomes that continue; each
      // stopping outcome branches down and ends in a bar.
      const tone = kfTone(it.kind, "accent");
      const gg = svgEl("g", { class: "kf-gate " + tone }, svg);
      const r = 14;
      svgEl(
        "path",
        {
          class: "kf-gate-diamond",
          d: `M${x} ${RAIL_Y - r} L${x + r} ${RAIL_Y} L${x} ${RAIL_Y + r} L${x - r} ${RAIL_Y} Z`,
        },
        gg,
      );
      const block = plainBlock(it, x, tone, " kf-gate-block");
      const outcomes = it.outcomes || [];
      let zone = null;
      if (outcomes.length) {
        zone = kitEl("div", "kf-forks");
        const nextX = i + 1 < n ? xs[i + 1] : x + pitch;
        const reach = Math.min(nextX - x - 40, 300);
        let ok = 0;
        let bad = 0;
        // Pills sit centred on their track; the bg fill masks the line
        // underneath so the label reads as part of the rail, not a caption.
        function pill(o, cls, cx, cy) {
          const label = kitEl("div", "kf-fork-pill " + cls);
          label.textContent = o.text || "";
          label.style.left = pct(cx, W);
          label.style.top = pct(cy, H);
          zone.appendChild(label);
        }
        outcomes.forEach(function (o) {
          if (o.tone === "bad") {
            // Peel off the gate's lower vertex on a curve, run a parallel
            // track, and end in a buffer stop.
            const y = RAIL_Y + 50 + bad * 32;
            const bend = 30;
            const runX = Math.min(x + reach, W - 24);
            const branch = svgEl(
              "path",
              {
                class: "kf-branch bad",
                pathLength: "1",
                d: `M${x} ${RAIL_Y + r - 2} V${y - bend} Q${x} ${y} ${x + bend} ${y} H${runX}`,
              },
              gg,
            );
            branch.style.transitionDelay = `${0.08 + bad * 0.1}s`;
            svgEl(
              "rect",
              { class: "kf-stop bad", x: runX - 1, y: y - 10, width: 6, height: 20, rx: 2 },
              gg,
            );
            pill(o, "bad", (x + bend + runX) / 2, y);
            bad += 1;
          } else {
            // The continuing track is the promote path: tint the next
            // segment and label it on the line.
            if (segs[i] && ok === 0) {
              segs[i].el.classList.add("kf-seg-continue");
            }
            pill(o, "ok", (x + r + nextX) / 2, RAIL_Y - ok * 28);
            ok += 1;
          }
        });
        canvas.appendChild(zone);
      }
      itemEls.push({ root: gg, card: block, outcomeZone: zone });
      return;
    }
    const tone = kfTone(it.kind);
    const state = mode === "timeline" && it.state ? " kf-state-" + it.state : "";
    const mark = svgEl(
      "g",
      { class: "kf-mark " + tone + (it.check ? " kf-mark-check" : "") + state },
      svg,
    );
    if (state === " kf-state-now") {
      svgEl("circle", { class: "kf-mark-halo", cx: x, cy: RAIL_Y, r: 9 }, mark);
    }
    svgEl("circle", { cx: x, cy: RAIL_Y, r: it.check ? 15 : 9 }, mark);
    if (it.check) {
      svgEl("path", { class: "kf-mark-glyph", d: `M${x - 6} ${RAIL_Y} l4 4 l8 -8` }, mark);
    }
    const block = plainBlock(it, x, tone, (it.check ? " kf-check" : "") + state);
    if (it.loop) {
      kfAppendCardText(block, "i", "\u27F2", "kf-loop-badge");
      block.lastChild.setAttribute("title", "repeats");
      block.lastChild.setAttribute("aria-hidden", "true");
    }
    if (mode === "timeline" && it.at) {
      const atLbl = svgEl(
        "text",
        { class: "kf-at", x, y: RAIL_Y + 34, "text-anchor": "middle" },
        svg,
      );
      atLbl.textContent = it.at;
    }
    itemEls.push({ root: block, card: block, marker: mark });
  });
  host.append(canvas);

  let captionEl = null;
  if (data.caption) {
    captionEl = kitEl("figcaption");
    kitSetPassiveInline(captionEl, data.caption);
    host.append(captionEl);
  }

  const count = items.length + 1;
  let current = 0;
  function setMotionPreset(preset, replay) {
    if (!["calm", "normal", "off"].includes(preset)) {
      return false;
    }
    motionPreset = preset;
    host.dataset.motionPreset = preset;
    // Preset changes only reconcile decoration already in flight. They never
    // Call go(), reveal another authored station, or re-fire a segment.
    segs.forEach((seg) => {
      if (seg.fireCtl) {
        seg.fireCtl[0].stop();
        seg.fireCtl[1].stop();
        seg.fireCtl = null;
      }
      seg.dot.classList.remove("on");
      seg.trail.classList.remove("on");
    });
    return preset;
  }
  function onMotionPresetChange(e) {
    setMotionPreset(e && e.detail ? e.detail.preset : kfEnsureMotionPreset());
  }
  window.addEventListener("kitmotionpresetchange", onMotionPresetChange);
  const motionEntries = (window.__kitMotionAdjustable = window.__kitMotionAdjustable || []);
  const motionEntry = {
    host,
    key: host.id || data.ariaLabel || (mode === "timeline" ? "Timeline Flow" : "Flow"),
    label: data.ariaLabel || (mode === "timeline" ? "Timeline Flow" : "Flow"),
    kind: mode === "timeline" ? "timeline flow" : "flow",
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
  function unregisterMotionEntry() {
    const index = motionEntries.indexOf(motionEntry);
    if (index !== -1) {
      motionEntries.splice(index, 1);
    }
  }

  function go(i) {
    const prev = current;
    current = Math.max(0, Math.min(i, count - 1));
    itemEls.forEach((entry, k) => {
      var lit = data.view === "full" || k < current,
        wasLit = data.view === "full" || k < prev;
      entry.root.classList.toggle("lit", lit);
      if (entry.card && entry.card !== entry.root) {
        entry.card.classList.toggle("lit", lit);
      }
      if (entry.marker) {
        entry.marker.classList.toggle("lit", lit);
      }
      if (entry.outcomeZone) {
        entry.outcomeZone.classList.toggle("lit", lit);
      }
      if (lit && !wasLit) {
        kfArrive(entry.card);
      }
    });
    segs.forEach((seg, k) => {
      var lit = data.view === "full" || k + 1 < current,
        wasLit = data.view === "full" || k + 1 < prev;
      seg.el.classList.toggle("lit", lit);
      if (lit && !wasLit) {
        fireSegment(seg);
      }
    });
    // Brighten the payoff caption the moment the walk reaches the last
    // Station — keeping it dim past that point buries it under the newly
    // Revealed cards (reviewer: "the legend 'All acked' gets buried the
    // Moment 'Retry worker' appears"). One step of headroom so the caption
    // Arrives with the final card, not after an extra empty beat.
    if (captionEl) {
      captionEl.classList.toggle("dim", data.view !== "full" && current < items.length);
    }
  }

  if (STATIC) {
    go(count - 1); // Static register: land on the final state, no travel
    host.__kitDispose = function __kitDispose() {
      window.removeEventListener("kitmotionpresetchange", onMotionPresetChange);
      unregisterMotionEntry();
    };
  } else {
    go(0);
    let chainTimer = null;
    let obs = new IntersectionObserver(
      function (es) {
        es.forEach(function (e) {
          if (!e.isIntersecting || document.body.classList.contains("presenting")) {
            return;
          }
          obs.disconnect();
          var step = 1;
          (function chain() {
            go(step);
            if (step >= count - 1) {
              return;
            }
            step++;
            chainTimer = setTimeout(chain, 420);
          })();
        });
      },
      { threshold: 0.4 },
    );
    obs.observe(host);
    // Match renderDataFlow's lifecycle contract: teardown disconnects the
    // Observer and clears the pending chain timer so a re-mount (studio
    // Swaps, kitMount's remount path) can't leave a stray reveal walking
    // Against a detached host.
    host.__kitDispose = function __kitDispose() {
      if (obs) {
        obs.disconnect();
        obs = null;
      }
      if (chainTimer) {
        clearTimeout(chainTimer);
        chainTimer = null;
      }
      window.removeEventListener("kitmotionpresetchange", onMotionPresetChange);
      unregisterMotionEntry();
      segs.forEach((seg) => {
        if (seg.fireCtl) {
          seg.fireCtl[0].stop();
          seg.fireCtl[1].stop();
        }
      });
    };
  }

  return { count, go };
}
