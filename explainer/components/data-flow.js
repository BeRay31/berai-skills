let kitDataFlowSeq = 0;
const kdfNS = "http://www.w3.org/2000/svg";
/* Runtime motion contract (shared with flow.js):
   window.__kitSetMotionPreset('calm' | 'normal' | 'off')
   updates mounted components synchronously and emits `kitmotionpresetchange`.
   Invalid names are ignored and return false. Reduced-motion handling remains
   independent and authoritative through the kit's MOTION/REDUCED_MOTION gate. */
function kdfEnsureMotionPreset() {
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
kdfEnsureMotionPreset();

const KDF_ARCHITECTURE_DETAILS = ["minimal", "contextual"];
const KDF_ARCHITECTURE_LAYOUTS = ["free", "stages", "main-flow", "groups"];
function kdfApplyArchitectureDetail(host, value) {
  host.dataset.detail = value;
  host.querySelectorAll(".kdf-canvas, .kom-canvas").forEach((canvas) => {
    canvas.dataset.detail = value;
    canvas.dataset.layout = host.__kitArchitectureDetail
      ? host.__kitArchitectureDetail.layout
      : "free";
  });
}
function kdfRegisterArchitectureDetail(host, data, fallbackLabel) {
  const authored = data.detail == null ? "minimal" : data.detail;
  if (!KDF_ARCHITECTURE_DETAILS.includes(authored)) {
    throw new Error('architecture detail must be "minimal" or "contextual"');
  }
  if (!host.__kitArchitectureDetail) {
    const layout = data.layout == null ? "free" : data.layout;
    if (data.__architectureComponent && !KDF_ARCHITECTURE_LAYOUTS.includes(layout)) {
      throw new Error('architecture layout must be "free", "stages", "main-flow", or "groups"');
    }
    const state = { detail: authored, layout };
    host.__kitArchitectureDetail = state;
    host.__kitArchitectureBase = data.__architectureBase || data;
    const options = [
      {
        key: "detail",
        label: "Text",
        type: "choice",
        choices: KDF_ARCHITECTURE_DETAILS.slice(),
        choiceLabels: { minimal: "Key only", contextual: "More detail" },
      },
    ];
    if (data.__architectureComponent) {
      const base = host.__kitArchitectureBase;
      const domains = (base.groups || []).filter((group) =>
        (base.nodes || []).some((node) => node.group === group.id),
      );
      const overviewCount =
        domains.length + (base.nodes || []).filter((node) => !node.group).length;
      const overviewTooDense = domains.some((group) => {
        const members = (base.nodes || []).filter((node) => node.group === group.id);
        return (
          members.length > 6 ||
          (
            (group.label || group.id) +
            ": " +
            members.map((node) => node.title || node.id).join(" · ")
          ).length > 120
        );
      });
      const disabledChoices = [];
      const limitations = [];
      if (domains.length > 4) {
        disabledChoices.push("stages");
        limitations.push("Domain detail needs four or fewer domains.");
      }
      if (!(base.groups || []).length || overviewCount > 4 || overviewTooDense) {
        disabledChoices.push("groups");
        limitations.push(
          "Domain overview needs one to four domains with up to six systems each and concise labels.",
        );
      }
      options.unshift({
        key: "layout",
        label: "Layout",
        type: "choice",
        choices: KDF_ARCHITECTURE_LAYOUTS.slice(),
        disabledChoices,
        help: limitations.join(" "),
        choiceLabels: {
          free: "System map",
          stages: "Domain detail",
          "main-flow": "Request journey",
          groups: "Domain overview",
        },
      });
    }
    (window.__kitSwappable = window.__kitSwappable || []).push({
      host,
      label: data.ariaLabel || fallbackLabel || "Architecture",
      options,
      get(key) {
        return state[key];
      },
      set(key, value) {
        if (key === "detail") {
          state.detail = value === "contextual" ? "contextual" : "minimal";
          if (data.__architectureComponent && ["stages", "groups"].includes(state.layout)) {
            const at = host.__kitPresentHolder ? host.__kitPresentHolder.current() : 0;
            const driver = renderArchitecture(host, {
              ...host.__kitArchitectureBase,
              detail: state.detail,
              layout: state.layout,
            });
            driver.go(at);
            host.dispatchEvent(new CustomEvent("kitcanvasrender", { bubbles: true }));
          } else {
            kdfApplyArchitectureDetail(host, state.detail);
          }
          return state.detail;
        }
        if (key !== "layout" || !data.__architectureComponent) {
          return false;
        }
        const layoutOption = options.find((option) => option.key === "layout");
        if (layoutOption.disabledChoices.includes(value)) {
          return false;
        }
        const nextLayout = KDF_ARCHITECTURE_LAYOUTS.includes(value) ? value : "free";
        const at = host.__kitPresentHolder ? host.__kitPresentHolder.current() : 0;
        const previousLayout = state.layout;
        state.layout = nextLayout;
        try {
          renderArchitecture(host, {
            ...host.__kitArchitectureBase,
            detail: state.detail,
            layout: nextLayout,
          }).go(at);
        } catch (error) {
          state.layout = previousLayout;
          throw error;
        }
        host.dispatchEvent(new CustomEvent("kitcanvasrender", { bubbles: true }));
        return state.layout;
      },
    });
  }
  kdfApplyArchitectureDetail(host, host.__kitArchitectureDetail.detail);
}
// Top-level (not a renderDataFlow closure) so the pulse engine below — also
// Top-level, since a single pulse-driving fire/cascade cycle only ever
// Touches one render's own elements passed in as `parent` — can build its
// Own <path> pair without needing renderDataFlow's local svgEl in scope.
function svgEl(tag, attrs, parent) {
  const el = document.createElementNS(kdfNS, tag);
  Object.keys(attrs || {}).forEach((key) => {
    el.setAttribute(key, attrs[key]);
  });
  parent.append(el);
  return el;
}

/* ── Pulse engine ───────────────────────────────────────────────────────
   A traveling "packet": a bright dot + an 18px fading tail, drawn as two
   stacked <path> copies of the edge's own geometry (so it follows curves
   exactly) and animated by scrubbing stroke-dashoffset — the same trick
   `kdf-dash` uses for the marching-ants "active" edge, just driven per-edge
   through MOTION (already vendored for reveals/zoom) instead of one fixed
   @keyframes rule, because each edge has its own length/duration and needs
   independent play/pause (continuous async edges) and one-shot replay
   (`fire`). MOTION is null under reduced motion or if Motion failed to
   parse (see base/app.js) — every pulse call branches on it and falls back
   to a static dot, never a moving one. */
const KDF_PULSE_SPEED = 90; // Px/s — the whole kit's "live" pace
const KDF_PULSE_TRAIL_LAG = 15 / KDF_PULSE_SPEED; // Seconds the tail lags the head, in px terms

function kdfMakePulse(layer, tone, d, len, edgeId, getPreset) {
  const trail = svgEl(
    "path",
    { d, class: "kdf-pulse-trail " + tone, "data-pulse-edge": edgeId },
    layer,
  );
  const dot = svgEl(
    "path",
    { d, class: "kdf-pulse-dot " + tone, "data-pulse-edge": edgeId },
    layer,
  );
  trail.style.strokeDasharray = `18 ${len}`;
  dot.style.strokeDasharray = `3.4 ${len}`;
  return { dot, trail, len, live: false, ctl: null, fireCtl: null, fireTimer: null, getPreset };
}
function kdfPulseHide(p) {
  p.dot.classList.remove("on");
  p.trail.classList.remove("on");
  p.dot.style.strokeDashoffset = "";
}
// Live = this pulse should be traveling right now (async edge, overview or
// Its own step active). Idempotent — go() calls this every step for every
// Async edge, so a no-op state stays a genuine no-op.
function kdfPulseSetLive(p, live) {
  const preset = p.getPreset();
  if (preset === "off") {
    live = false;
  }
  if (p.live === live) {
    return;
  }
  p.live = live;
  if (live) {
    if (MOTION) {
      if (p.ctl) {
        p.ctl[0].play();
        p.ctl[1].play();
      } else {
        var dur = p.len / (preset === "calm" ? 55 : KDF_PULSE_SPEED);
        p.ctl = [
          MOTION.animate(
            p.dot,
            { strokeDashoffset: [0, -p.len] },
            { duration: dur, ease: "linear", repeat: Infinity },
          ),
          MOTION.animate(
            p.trail,
            { strokeDashoffset: [0, -p.len] },
            { duration: dur, ease: "linear", repeat: Infinity, delay: KDF_PULSE_TRAIL_LAG },
          ),
        ];
      }
      p.dot.classList.add("on");
      p.trail.classList.add("on");
    } else {
      p.dot.style.strokeDashoffset = String(-p.len / 2); // Reduced motion: static mid-path dot
      p.dot.classList.add("on"); // Trail stays off — dot only
    }
  } else {
    if (p.ctl) {
      p.ctl[0].pause();
      p.ctl[1].pause();
    }
    kdfPulseHide(p);
  }
}
// Fire = a single one-shot travel end to end, 600-900ms, regardless of
// Sync/async. Skipped while the edge is already continuously live — a fire
// On top of that would just fight the same stroke-dashoffset for nothing.
// `onDone` (optional) fires when the head completes its travel — the
// Producer/consumer cascade below uses it as the "packet arrived" event
// That decides what happens at the node it just landed on.
function kdfPulseFire(p, onDone) {
  if (p.live) {
    return;
  }
  const preset = p.getPreset();
  if (preset === "off") {
    if (onDone) {
      setTimeout(onDone, 0);
    }
    return;
  }
  const dur =
    Math.max(0.6, Math.min(0.9, p.len / KDF_PULSE_SPEED)) * (preset === "calm" ? 1.65 : 1);
  if (MOTION) {
    if (p.fireCtl) {
      p.fireCtl[0].stop();
      p.fireCtl[1].stop();
    }
    const dotCtl = MOTION.animate(
      p.dot,
      { strokeDashoffset: [0, -p.len] },
      { duration: dur, ease: "linear" },
    );
    const trailCtl = MOTION.animate(
      p.trail,
      { strokeDashoffset: [0, -p.len] },
      { duration: dur, ease: "linear", delay: KDF_PULSE_TRAIL_LAG },
    );
    p.fireCtl = [dotCtl, trailCtl];
    p.dot.classList.add("on");
    p.trail.classList.add("on");
    dotCtl.finished
      .then(() => {
        if (!p.live) {
          p.dot.classList.remove("on");
        }
        if (onDone) {
          onDone();
        }
        return p;
      })
      .catch(() => {});
    trailCtl.finished
      .then(() => {
        if (!p.live) {
          p.trail.classList.remove("on");
        }
        p.fireCtl = null;
        return p;
      })
      .catch(() => {});
  } else {
    p.dot.style.strokeDashoffset = String(-p.len / 2);
    p.dot.classList.add("on");
    clearTimeout(p.fireTimer);
    p.fireTimer = setTimeout(() => {
      if (!p.live) {
        kdfPulseHide(p);
      }
      if (onDone) {
        onDone();
      }
    }, 700);
  }
}

function kdfChooseMarkerPosition(edge, geometry, nodes, pendingMarkers, edgeLen) {
  const padding = 18;
  function candidate(t) {
    const point = geometry.pointAt(t);
    let x = point.x + (edge.labelDx || 0);
    let y = point.y + (edge.labelDy || 0);
    if (edgeLen < 90 && geometry.start && geometry.end) {
      const horizontal =
        Math.abs(geometry.end.x - geometry.start.x) >= Math.abs(geometry.end.y - geometry.start.y);
      if (horizontal) {
        y -= 24;
      } else {
        x += 24;
      }
    }
    return { x, y };
  }
  function clear(point) {
    const nodeCollision = nodes.some(function (node) {
      if (node.id === edge.from || node.id === edge.to) {
        return false;
      }
      return (
        point.x >= node.x - padding &&
        point.x <= node.x + node.w + padding &&
        point.y >= node.y - padding &&
        point.y <= node.y + node.h + padding
      );
    });
    if (nodeCollision) {
      return false;
    }
    return !(pendingMarkers || []).some(
      (marker) => Math.hypot(point.x - marker.x, point.y - marker.y) < 32,
    );
  }
  const preferred = edgeLen > 400 ? [0.3, 0.2, 0.4, 0.7, 0.8, 0.5] : [0.5, 0.35, 0.65, 0.25, 0.75];
  for (let i = 0; i < preferred.length; i++) {
    const point = candidate(preferred[i]);
    if (clear(point)) {
      return point;
    }
  }
  const base = candidate(preferred[0]);
  const offsets = [
    [0, -32],
    [32, 0],
    [0, 32],
    [-32, 0],
    [0, -48],
    [48, 0],
    [0, 48],
    [-48, 0],
  ];
  for (let j = 0; j < offsets.length; j++) {
    const shifted = { x: base.x + offsets[j][0], y: base.y + offsets[j][1] };
    if (clear(shifted)) {
      return shifted;
    }
  }
  console.warn(`[architecture] no collision-free marker position for edge "${edge.id || "?"}"`);
  return base;
}

function kdfNodeHasRoom(node, width) {
  const scale = Math.min(width, 1200) / width;
  return node.size !== "small" && node.w * scale >= 160 && node.h * scale >= 76;
}

function renderDataFlow(sel, data) {
  const host = kitMount(sel);
  if (!data.__skipTextCaps) {
    kitValidateTextCaps(host, "renderDataFlow", data);
  }
  let motionPreset = kdfEnsureMotionPreset();
  const width = data.width || 1200;
  const height = data.height || 560;
  const groups = data.groups || [];
  const nodes = data.nodes || [];
  const edges = data.edges || [];
  const steps = data.steps || [];
  const id = "kdf-" + ++kitDataFlowSeq;
  const nodeById = {};
  const groupById = {};

  host.classList.add("kdf");
  host.dataset.motionPreset = motionPreset;
  kdfRegisterArchitectureDetail(host, data, "architecture");
  if (data.look === "sketch") {
    host.classList.add("kdf-sketch");
  }
  host.dataset.zoom = "";

  groups.forEach((group) => {
    if (!group.id || groupById[group.id]) {
      throw new Error("architecture group ids must be unique");
    }
    groupById[group.id] = group;
  });
  groups.forEach((group) => {
    if (group.parent && !groupById[group.parent]) {
      throw new Error("architecture group parent not found: " + group.parent);
    }
  });
  const groupToneById = {};
  const automaticGroupTones = ["accent", "success", "violet", "warning"];
  let automaticGroupIndex = 0;
  function groupTone(group, seen) {
    if (groupToneById[group.id]) {
      return groupToneById[group.id];
    }
    if (seen && seen.has(group.id)) {
      throw new Error("architecture group parent cycle: " + group.id);
    }
    seen = seen || new Set();
    seen.add(group.id);
    if (group.tone) {
      groupToneById[group.id] = group.tone;
    } else if (group.parent) {
      groupToneById[group.id] = groupTone(groupById[group.parent], seen);
    } else {
      groupToneById[group.id] =
        automaticGroupTones[automaticGroupIndex % automaticGroupTones.length];
      automaticGroupIndex += 1;
    }
    seen.delete(group.id);
    return groupToneById[group.id];
  }
  groups.forEach(function (group) {
    groupTone(group);
  });
  nodes.forEach((node) => {
    if (!node.id || nodeById[node.id]) {
      throw new Error("architecture node ids must be unique");
    }
    if (node.group && !groupById[node.group]) {
      throw new Error("architecture node group not found: " + node.group);
    }
    nodeById[node.id] = node;
  });

  const edgeById = {};
  edges.forEach((edge, index) => {
    var edgeId = edge.id || String(index);
    if (edgeById[edgeId]) {
      throw new Error("architecture edge ids must be unique: " + edgeId);
    }
    if (!nodeById[edge.from] || !nodeById[edge.to]) {
      throw new Error("architecture edge endpoint not found: " + (edge.from || edge.to));
    }
    edgeById[edgeId] = edge;
  });
  steps.forEach((step, stepIndex) => {
    var stepName = step.title || stepIndex + 1;
    (step.nodes || []).forEach(function (nodeId) {
      if (!nodeById[nodeId]) {
        throw new Error(
          'architecture step "' + stepName + '" references unknown node "' + nodeId + '"',
        );
      }
    });
    (step.edges || []).forEach(function (edgeId) {
      if (!edgeById[edgeId]) {
        throw new Error(
          'architecture step "' + stepName + '" references unknown edge "' + edgeId + '"',
        );
      }
    });
    (step.fire || []).forEach(function (edgeId) {
      if (!edgeById[edgeId]) {
        throw new Error('architecture step "' + stepName + '" fires unknown edge "' + edgeId + '"');
      }
    });
    (step.groups || []).forEach(function (groupId) {
      if (!groupById[groupId]) {
        throw new Error(
          'architecture step "' + stepName + '" references unknown group "' + groupId + '"',
        );
      }
    });
  });
  if (steps.length > 0) {
    const steppedEdges = {};
    steps.forEach((step) => {
      (step.edges || []).forEach(function (edgeId) {
        steppedEdges[edgeId] = true;
      });
    });
    Object.keys(edgeById).forEach((edgeId) => {
      if (edgeById[edgeId].label && !steppedEdges[edgeId]) {
        throw new Error(
          'architecture edge "' + edgeId + '" has a label but is not referenced by any step.edges',
        );
      }
    });
  }

  function pct(value, total) {
    return `${(100 * value) / total}%`;
  }
  function box(el, item) {
    el.style.left = pct(item.x, width);
    el.style.top = pct(item.y, height);
    el.style.width = pct(item.w, width);
    el.style.height = pct(item.h, height);
  }

  host.style.setProperty("--kdf-floor", `${Math.min(width, 1200)}px`);
  const canvas = kitEl("div", "kdf-canvas");
  canvas.style.aspectRatio = `${width} / ${height}`;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", data.ariaLabel || "Grouped technical data flow");

  (data.__stageColumns || []).forEach((column, index) => {
    const heading = kitEl("div", "kdf-stage-heading");
    heading.append(
      kitEl("span", "", String(index + 1).padStart(2, "0")),
      kitEl("strong", "", column.label),
    );
    heading.style.left = pct(column.x, width);
    heading.style.width = pct(column.width, width);
    canvas.append(heading);
  });
  const groupEls = {};
  groups.forEach((group) => {
    var el = kitEl(
      "div",
      "kdf-group " +
        groupToneById[group.id] +
        (group.parent ? " nested" : "") +
        " " +
        (group.style || "dashed"),
    );
    el.dataset.group = group.id;
    if (group.parent) {
      el.dataset.parent = group.parent;
    }
    box(el, group);
    el.innerHTML =
      "<span>" +
      (group.label || group.id) +
      "</span>" +
      (group.sub ? "<small>" + group.sub + "</small>" : "");
    canvas.appendChild(el);
    groupEls[group.id] = el;
  });

  const svg = svgEl(
    "svg",
    {
      class: "kdf-wires",
      viewBox: "0 0 " + width + " " + height,
      preserveAspectRatio: "none",
      "aria-hidden": "true",
    },
    canvas,
  );
  const defs = svgEl("defs", {}, svg);
  const labelSvg = svgEl(
    "svg",
    {
      class: "kdf-labels",
      viewBox: "0 0 " + width + " " + height,
      preserveAspectRatio: "none",
      "aria-hidden": "true",
    },
    canvas,
  );
  ["neutral", "accent", "success", "warning", "violet"].forEach((tone) => {
    var marker = svgEl(
      "marker",
      {
        id: id + "-" + tone,
        markerWidth: "14",
        markerHeight: "14",
        refX: "12",
        refY: "7",
        orient: "auto",
        markerUnits: "userSpaceOnUse",
      },
      defs,
    );
    svgEl("path", { d: "M0,0 L14,7 L0,14 Z", class: "kdf-arrow-head " + tone }, marker);
  });

  function anchor(node, side, slot) {
    const position = slot == null ? 0.5 : slot;
    if (side === "left") {
      return { x: node.x, y: node.y + node.h * position };
    }
    if (side === "right") {
      return { x: node.x + node.w, y: node.y + node.h * position };
    }
    if (side === "top") {
      return { x: node.x + node.w * position, y: node.y };
    }
    return { x: node.x + node.w * position, y: node.y + node.h };
  }

  function autoSides(from, to) {
    const dx = to.x + to.w / 2 - (from.x + from.w / 2);
    const dy = to.y + to.h / 2 - (from.y + from.h / 2);
    if (Math.abs(dx) >= Math.abs(dy)) {
      return dx >= 0 ? ["right", "left"] : ["left", "right"];
    }
    return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
  }

  function route(edge, start, end, fromSide, toSide) {
    function linePoint(a, b, t) {
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    function polylineGeometry(points) {
      const lengths = [];
      let total = 0;
      for (let i = 0; i < points.length - 1; i++) {
        const length = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
        lengths.push(length);
        total += length;
      }
      function polylinePoint(t) {
        const target = total * t;
        let walked = 0;
        for (let j = 0; j < lengths.length; j++) {
          if (walked + lengths[j] >= target || j === lengths.length - 1) {
            return linePoint(
              points[j],
              points[j + 1],
              lengths[j] ? (target - walked) / lengths[j] : 0,
            );
          }
          walked += lengths[j];
        }
        return end;
      }
      return {
        d: points
          .map(function (point, index) {
            return (index ? "L" : "M") + point.x + " " + point.y;
          })
          .join(" "),
        end,
        pointAt: polylinePoint,
        start,
      };
    }
    if (edge.via && edge.via.length > 0) {
      return polylineGeometry([start].concat(edge.via).concat([end]));
    }
    const alignedFaces =
      ((fromSide === "right" && toSide === "left" && end.x > start.x) ||
        (fromSide === "left" && toSide === "right" && end.x < start.x)) &&
      Math.abs(start.y - end.y) < 0.01;
    const alignedVerticalFaces =
      ((fromSide === "bottom" && toSide === "top" && end.y > start.y) ||
        (fromSide === "top" && toSide === "bottom" && end.y < start.y)) &&
      Math.abs(start.x - end.x) < 0.01;
    if (edge.route === "straight" || alignedFaces || alignedVerticalFaces) {
      return {
        d: "M" + start.x + " " + start.y + " L" + end.x + " " + end.y,
        start,
        end,
        pointAt(t) {
          return linePoint(start, end, t);
        },
      };
    }
    if (edge.route !== "curve") {
      let points;
      const horizontal = fromSide === "left" || fromSide === "right";
      const backward =
        (fromSide === "left" && end.x > start.x) || (fromSide === "right" && end.x < start.x);
      if (horizontal && backward) {
        const topClearance = Math.min(start.y, end.y);
        const bottomClearance = height - Math.max(start.y, end.y);
        const railY = topClearance >= bottomClearance ? 24 : height - 24;
        points = [start, { x: start.x, y: railY }, { x: end.x, y: railY }, end];
      } else if (horizontal) {
        const laneX = (start.x + end.x) / 2;
        points = [start, { x: laneX, y: start.y }, { x: laneX, y: end.y }, end];
      } else {
        const laneY = (start.y + end.y) / 2;
        points = [start, { x: start.x, y: laneY }, { x: end.x, y: laneY }, end];
      }
      return polylineGeometry(
        points.filter(function (point, index) {
          return !index || point.x !== points[index - 1].x || point.y !== points[index - 1].y;
        }),
      );
    }
    const dist = Math.hypot(end.x - start.x, end.y - start.y);
    const bend = Math.max(40, Math.min(dist * 0.32, 140));
    function ctrl(side, p) {
      if (side === "right") {
        return { x: p.x + bend, y: p.y };
      }
      if (side === "left") {
        return { x: p.x - bend, y: p.y };
      }
      if (side === "bottom") {
        return { x: p.x, y: p.y + bend };
      }
      if (side === "top") {
        return { x: p.x, y: p.y - bend };
      }
      return { x: p.x, y: p.y };
    }
    const c1 = ctrl(fromSide, start),
      c2 = ctrl(toSide, end);
    function curvePoint(t) {
      const s = 1 - t;
      return {
        x: s * s * s * start.x + 3 * s * s * t * c1.x + 3 * s * t * t * c2.x + t * t * t * end.x,
        y: s * s * s * start.y + 3 * s * s * t * c1.y + 3 * s * t * t * c2.y + t * t * t * end.y,
      };
    }
    return {
      d:
        "M" +
        start.x +
        " " +
        start.y +
        " C" +
        c1.x +
        " " +
        c1.y +
        " " +
        c2.x +
        " " +
        c2.y +
        " " +
        end.x +
        " " +
        end.y,
      end,
      pointAt: curvePoint,
      start,
    };
  }

  const edgeEls = {};
  const edgeMarkerEls = {};
  // Every pulse (continuous async travel + one-shot `fire`) lives in its own
  // Top-level layer, painted after every edge <g>, so a firing/live pulse
  // Reads at full brightness even when its edge group is dimmed by an
  // Active walkthrough step — opacity on the parent <g> would otherwise
  // Multiply into the pulse and make the exact thing meant to draw the eye
  // The dimmest thing on the canvas.
  const pulseLayer = document.createElementNS(kdfNS, "g");
  pulseLayer.setAttribute("class", "kdf-pulse-layer");
  pulseLayer.setAttribute("aria-hidden", "true");
  const pulseByEdge = {};
  // Producer/consumer graph, built alongside the edges themselves: which
  // Async edges leave each node (asyncOut) and land on each node (asyncIn).
  // A node with outgoing async edges and no incoming one is a cascade root
  // (a producer) — see the dispatch engine below.
  const asyncOut = {};
  const asyncIn = {};
  const edgeMeta = {};
  // Collect geometry first; assign stable story numbers after all routes exist.
  const pendingMarkers = [];
  const edgeRouteSides = edges.map(function (edge) {
    const automatic = autoSides(nodeById[edge.from], nodeById[edge.to]);
    return [edge.fromSide || automatic[0], edge.toSide || automatic[1]];
  });
  const edgeSlots = edges.map(function () {
    return { from: 0.5, to: 0.5 };
  });
  const portBuckets = {};
  function addPort(nodeId, side, edgeIndex, endpoint, otherNode) {
    const key = nodeId + ":" + side;
    const horizontalSide = side === "left" || side === "right";
    (portBuckets[key] = portBuckets[key] || []).push({
      edgeIndex,
      endpoint,
      order: horizontalSide ? otherNode.y + otherNode.h / 2 : otherNode.x + otherNode.w / 2,
    });
  }
  edges.forEach(function (edge, edgeIndex) {
    const sides = edgeRouteSides[edgeIndex];
    addPort(edge.from, sides[0], edgeIndex, "from", nodeById[edge.to]);
    addPort(edge.to, sides[1], edgeIndex, "to", nodeById[edge.from]);
  });
  Object.values(portBuckets).forEach(function (ports) {
    ports
      .toSorted(function (a, b) {
        return a.order - b.order || a.edgeIndex - b.edgeIndex;
      })
      .forEach(function (port, portIndex) {
        edgeSlots[port.edgeIndex][port.endpoint] = (portIndex + 1) / (ports.length + 1);
      });
  });
  edges.forEach((edge, index) => {
    var from = nodeById[edge.from];
    var to = nodeById[edge.to];
    if (!from || !to) {
      throw new Error("architecture edge endpoint not found: " + (edge.from || edge.to));
    }
    var sides = edgeRouteSides[index];
    var fromSide = sides[0];
    var toSide = sides[1];
    var fromSlot = Number.isFinite(edge.fromSlot) ? edge.fromSlot : edgeSlots[index].from;
    var toSlot = Number.isFinite(edge.toSlot) ? edge.toSlot : edgeSlots[index].to;
    // A branch must not nudge an otherwise aligned connection off its centre.
    // Preserve authored ports and waypoints, and keep parallel edges separated.
    if (
      data.__architectureComponent &&
      !Number.isFinite(edge.fromSlot) &&
      !Number.isFinite(edge.toSlot) &&
      !(edge.via && edge.via.length) &&
      edges.filter((other) => other.from === edge.from && other.to === edge.to).length === 1
    ) {
      const horizontal = fromSide === "right" || fromSide === "left";
      const opposite = { right: "left", left: "right", top: "bottom", bottom: "top" };
      const sameAxis = horizontal
        ? Math.abs(from.y + from.h / 2 - to.y - to.h / 2) < 0.01
        : Math.abs(from.x + from.w / 2 - to.x - to.w / 2) < 0.01;
      if (opposite[fromSide] === toSide && sameAxis) {
        fromSlot = 0.5;
        toSlot = 0.5;
      }
    }
    var start = anchor(from, fromSide, Math.max(0.1, Math.min(0.9, fromSlot)));
    var end = anchor(to, toSide, Math.max(0.1, Math.min(0.9, toSlot)));
    var geometry = route(edge, start, end, fromSide, toSide);
    var tone = edge.tone || "neutral";
    var kind = edge.kind === "async" ? "async" : "sync";
    var edgeId = edge.id || String(index);
    var group = svgEl(
      "g",
      {
        class:
          "kdf-edge " + tone + (edge.dashed ? " dashed" : "") + (kind === "async" ? " async" : ""),
        "data-edge": edgeId,
        "data-kind": kind,
      },
      svg,
    );
    var pathEl = svgEl(
      "path",
      { d: geometry.d, class: "kdf-edge-path", "marker-end": "url(#" + id + "-" + tone + ")" },
      group,
    );
    var pulse = kdfMakePulse(
      pulseLayer,
      tone,
      geometry.d,
      pathEl.getTotalLength(),
      edgeId,
      function () {
        return motionPreset;
      },
    );
    pulse.async = kind === "async";
    pulseByEdge[edgeId] = pulse;
    edgeMeta[edgeId] = { from: edge.from, to: edge.to, filter: edge.filter || null };
    if (kind === "async") {
      (asyncOut[edge.from] = asyncOut[edge.from] || []).push(edgeId);
      (asyncIn[edge.to] = asyncIn[edge.to] || []).push(edgeId);
    }
    if (edge.label) {
      var edgeLen = Math.hypot(end.x - start.x, end.y - start.y);
      var markerPosition = kdfChooseMarkerPosition(edge, geometry, nodes, pendingMarkers, edgeLen);
      pendingMarkers.push({
        id: edgeId,
        x: markerPosition.x,
        y: markerPosition.y,
        label: edge.label,
        tone,
      });
    }
    // Filter glyph: a small funnel + mono microtype at the edge midpoint —
    // its own thing, not the numbered-marker/legend system (a filter is a
    // predicate on the wire, not a step waypoint). Text always comes from
    // data (validated above); never synthesized.
    if (edge.filter) {
      var fmid = geometry.pointAt(0.5);
      var filterG = svgEl(
        "g",
        {
          class: "kdf-filter " + tone,
          transform: "translate(" + fmid.x + "," + (fmid.y - 13) + ")",
        },
        labelSvg,
      );
      svgEl("path", { class: "kdf-filter-glyph", d: "M-6 -4 L6 -4 L2 5 L-2 5 Z" }, filterG);
      const labelWidth = edge.filter.length * 8;
      const centerLabel = nodes.some(
        (node) =>
          node.y < fmid.y - 5 &&
          node.y + node.h > fmid.y - 24 &&
          node.x < fmid.x + 9 + labelWidth &&
          node.x + node.w > fmid.x + 9,
      );
      var filterText = svgEl(
        "text",
        {
          class: "kdf-filter-text",
          x: centerLabel ? 0 : 9,
          y: centerLabel ? -10 : 4,
          "text-anchor": centerLabel ? "middle" : "start",
        },
        filterG,
      );
      filterText.textContent = edge.filter;
    }
    edgeEls[edgeId] = group;
  });
  svg.append(pulseLayer); // Above every edge <g>, in DOM/paint order

  // ── Producer/consumer cascade ─────────────────────────────────────────
  // Drives the overview's idle pulsing as one coordinated simulation rather
  // Than independent per-edge loops: a beat enters at each root (a node with
  // Outgoing async edges and no incoming one) and travels hop to hop. On
  // Arrival, the node's kind decides what happens next — `topic` (and any
  // Other multi-out node) fans every outgoing edge out together; `queue`
  // Hands the beat to exactly one outgoing edge, taking turns across
  // Arrivals (competing consumers). A `filter` on an edge can still knock it
  // Out of a given broadcast beat (queue's turn-taking already excludes the
  // Others, so filters only apply to broadcast branches).
  const queueTurn = {};
  const filterSkip = {};
  function kdfFilterAllows(edgeId) {
    const filter = edgeMeta[edgeId].filter;
    if (!filter) {
      return true;
    }
    const st = filterSkip[edgeId] || (filterSkip[edgeId] = { fired: 0, skip: 0 });
    if (st.skip > 0) {
      st.skip--;
      return false;
    }
    st.fired++;
    st.skip = st.fired % 2 === 0 ? 2 : 1; // Fire, skip 1, fire, skip 2, repeat — "skip 1-2 beats"
    return true;
  }
  const cascadeTimers = [];
  // Track only live timer handles: each handle removes itself from the
  // Collection when its callback runs, so kdfCascadeStop clears just the
  // Pending ones instead of a set that grows one tick per cascade cycle.
  function trackTimer(fn, delay) {
    const timerId = setTimeout(function () {
      var i = cascadeTimers.indexOf(timerId);
      if (i > -1) {
        cascadeTimers.splice(i, 1);
      }
      fn();
    }, delay);
    cascadeTimers.push(timerId);
    return timerId;
  }
  // Finite hop budget so a cycle in the producer/consumer graph can't
  // Dispatch forever inside one cascade beat (the 1700ms tick restarts it
  // Each cycle anyway, but a runaway within a beat would pin the thread).
  const KDF_HOP_BUDGET = 64;
  function kdfDispatch(nodeId, hops = 0) {
    if (hops >= KDF_HOP_BUDGET) {
      return;
    }
    const outs = asyncOut[nodeId];
    if (!outs || outs.length === 0) {
      return;
    }
    const node = nodeById[nodeId];
    let toFire;
    if (node && node.kind === "queue") {
      const turn = queueTurn[nodeId] || 0;
      toFire = [outs[turn % outs.length]];
      queueTurn[nodeId] = turn + 1;
    } else {
      toFire = outs.filter((edgeId) => kdfFilterAllows(edgeId));
    }
    toFire.forEach((edgeId) => {
      var pulse = pulseByEdge[edgeId];
      if (!pulse || pulse.live) {
        return;
      } // a walkthrough step owns this edge's loop right now
      kdfPulseFire(pulse, function () {
        trackTimer(function () {
          kdfDispatch(edgeMeta[edgeId].to, hops + 1);
        }, 0);
      });
    });
  }
  const cascadeRoots = Object.keys(asyncOut).filter(function (nodeId) {
    return !asyncIn[nodeId];
  });
  let cascadeRunning = false;
  function kdfCascadeTick() {
    if (!cascadeRunning) {
      return;
    }
    cascadeRoots.forEach((r) => {
      kdfDispatch(r, 0);
    });
    trackTimer(kdfCascadeTick, motionPreset === "calm" ? 3000 : 1700);
  }
  function kdfCascadeStart() {
    if (cascadeRunning || cascadeRoots.length === 0) {
      return;
    }
    cascadeRunning = true;
    kdfCascadeTick();
  }
  function kdfCascadeStop() {
    cascadeRunning = false;
    cascadeTimers.forEach((timerId) => clearTimeout(timerId));
    cascadeTimers.length = 0;
  }

  // Layout changes must not turn an early cross-boundary action into the
  // last step. The authored walkthrough owns sequence; remaining references
  // keep edge-array order when they are not part of the walkthrough.
  const legendItems = [];
  const storyOrder = new Map();
  function rememberEdge(edgeKey) {
    if (!storyOrder.has(edgeKey)) {
      storyOrder.set(edgeKey, storyOrder.size);
    }
  }
  (data.steps || []).forEach((step) => {
    [...(step.edges || []), ...(step.fire || [])].forEach(rememberEdge);
  });
  edges.forEach((edge, index) => rememberEdge(edge.id || String(index)));
  pendingMarkers.sort((a, b) => storyOrder.get(a.id) - storyOrder.get(b.id));
  pendingMarkers.forEach((m) => {
    var num = legendItems.length + 1;
    var marker = svgEl(
      "g",
      {
        class: "kdf-edge-marker " + m.tone,
        "data-edge-marker": m.id,
        transform: "translate(" + m.x + "," + m.y + ")",
      },
      labelSvg,
    );
    svgEl("circle", { r: 13, class: "kdf-edge-marker-ring" }, marker);
    svgEl(
      "text",
      { class: "kdf-edge-marker-num", "text-anchor": "middle", "dominant-baseline": "central" },
      marker,
    ).textContent = String(num);
    edgeMarkerEls[m.id] = marker;
    legendItems.push({ id: m.id, num, label: m.label, tone: m.tone });
  });

  const nodeEls = {};
  nodes.forEach((node) => {
    // queue/topic paint a stacked-slats glyph on the node's left edge — the
    // same three bars, parallel for a buffer (queue) or fanned 12° for a
    // fan-out (topic) — plus a pill radius. Everything else (title/sub/
    // eyebrow/tone) renders exactly like a plain node.
    var glyphKind = node.kind === "queue" || node.kind === "topic" ? node.kind : "";
    var el = kitEl(
      "div",
      "kdf-node " +
        (node.tone || (node.group && groupToneById[node.group]) || "neutral") +
        (node.size ? " " + node.size : "") +
        (kdfNodeHasRoom(node, width) ? " kdf-roomy" : "") +
        (glyphKind ? " " + glyphKind : ""),
    );
    el.dataset.node = node.id;
    if (node.group) {
      el.dataset.group = node.group;
    }
    box(el, node);
    // Minimal mode keeps membership explicit without overlapping boundary boxes.
    const ancestry = [];
    const seenGroups = new Set();
    let parentGroup = node.group;
    while (parentGroup && !seenGroups.has(parentGroup)) {
      seenGroups.add(parentGroup);
      const parentId = parentGroup;
      const owner = groups.find((group) => group.id === parentId);
      if (!owner) {
        break;
      }
      ancestry.unshift(owner.label || owner.id);
      parentGroup = owner.parent;
    }
    var slats = glyphKind
      ? '<i class="kdf-slats" aria-hidden="true"><b></b><b></b><b></b></i>'
      : "";
    el.innerHTML =
      slats +
      (node.eyebrow ? "<span>" + node.eyebrow + "</span>" : "") +
      "<strong>" +
      (node.title || node.id) +
      "</strong>" +
      (node.sub ? "<small>" + node.sub + "</small>" : "");
    if (ancestry.length) {
      const membership = kitEl("span", "kdf-membership");
      membership.textContent = ancestry.join(" / ");
      el.prepend(membership);
    }
    canvas.appendChild(el);
    nodeEls[node.id] = el;
  });
  host.append(canvas);
  kdfApplyArchitectureDetail(host, host.__kitArchitectureDetail.detail);

  // Numbered edge markers are meaningless without their key — render a wrapping
  // HTML legend between the canvas and the walkthrough panel. Hover on a legend
  // Chip highlights its edge + marker on the canvas, and vice versa.
  let legend = null;
  const legendItemEls = {};
  if (legendItems.length > 0) {
    legend = kitEl("div", "kdf-legend");
    legend.setAttribute("role", "list");
    legendItems.forEach((item) => {
      var li = kitEl("div", "kdf-legend-item " + item.tone);
      li.dataset.edge = item.id;
      li.setAttribute("role", "listitem");
      li.innerHTML =
        '<span class="kdf-legend-num">' +
        item.num +
        '</span><span class="kdf-legend-text">' +
        item.label +
        "</span>";
      legend.appendChild(li);
      legendItemEls[item.id] = li;
    });
    host.append(legend);
  }
  if (data.__domainLegend && data.__domainLegend.length) {
    const domainLegend = kitEl("div", "kdf-legend kdf-domain-legend");
    domainLegend.setAttribute("role", "list");
    data.__domainLegend.forEach((item) => {
      const li = kitEl("div", "kdf-legend-item " + item.tone);
      li.setAttribute("role", "listitem");
      li.innerHTML =
        '<span class="kdf-legend-num">' +
        item.key +
        '</span><span class="kdf-legend-text">' +
        item.label +
        "</span>";
      domainLegend.append(li);
    });
    host.append(domainLegend);
  }

  const walk = kitEl("div", "kdf-walk");
  if (steps.length === 0) {
    walk.hidden = true;
    walk.setAttribute("aria-hidden", "true");
  }
  const dots = kitEl("div", "kdf-dots");
  const annotation = kitEl("div", "kdf-annotation");
  annotation.setAttribute("aria-live", "polite");
  annotation.innerHTML = "<strong></strong><p></p>";
  const controls = kitEl("div", "kdf-controls");
  const next = kitEl("button", "kdf-next", "Next step →");
  const reset = kitEl("button", "kdf-reset", "Reset");
  next.type = "button";
  reset.type = "button";
  controls.append(next);
  controls.append(reset);
  walk.append(dots);
  walk.append(annotation);
  walk.append(controls);
  host.append(walk);

  const dotEls = steps.map(function (step, index) {
    var dot = kitEl("button", "kdf-dot");
    dot.type = "button";
    dot.setAttribute("aria-label", "Show flow step " + (index + 1));
    dot.addEventListener("click", function () {
      go(index + 1);
    });
    dots.appendChild(dot);
    return dot;
  });

  let current = 0;

  function kdfResetRecurringPulses() {
    kdfCascadeStop();
    Object.keys(pulseByEdge).forEach((edgeId) => {
      var pulse = pulseByEdge[edgeId];
      if (pulse.ctl) {
        pulse.ctl[0].stop();
        pulse.ctl[1].stop();
        pulse.ctl = null;
      }
      pulse.live = false;
      kdfPulseHide(pulse);
    });
  }

  // Reconcile only recurring decoration. This deliberately does not call
  // Go(), so changing a preset cannot replay a step's deterministic `fire`.
  function kdfSyncRecurringPulses(shouldReset) {
    if (shouldReset) {
      kdfResetRecurringPulses();
    }
    const preset = motionPreset;
    host.dataset.motionPreset = preset;
    const step = current ? steps[current - 1] : null;
    const stepEdges = step ? step.edges || [] : [];
    Object.keys(pulseByEdge).forEach((edgeId) => {
      var pulse = pulseByEdge[edgeId];
      if (!pulse.async) {
        return;
      }
      if (step) {
        kdfPulseSetLive(pulse, stepEdges.includes(edgeId));
      } else {
        kdfPulseSetLive(pulse, !MOTION);
      }
    });
    if (preset !== "off" && !step && MOTION) {
      kdfCascadeStart();
    }
  }

  function setMotionPreset(preset) {
    if (!["calm", "normal", "off"].includes(preset)) {
      return false;
    }
    motionPreset = preset;
    kdfSyncRecurringPulses(true);
    if (preset === "off") {
      Object.keys(pulseByEdge).forEach((edgeId) => {
        var pulse = pulseByEdge[edgeId];
        if (pulse.fireCtl) {
          pulse.fireCtl[0].stop();
          pulse.fireCtl[1].stop();
          pulse.fireCtl = null;
        }
        clearTimeout(pulse.fireTimer);
        kdfPulseHide(pulse);
      });
    }
    return preset;
  }
  function onMotionPresetChange(e) {
    setMotionPreset(e && e.detail ? e.detail.preset : kdfEnsureMotionPreset());
  }
  window.addEventListener("kitmotionpresetchange", onMotionPresetChange);

  function setActive(map, ids) {
    Object.keys(map).forEach((key) => {
      map[key].classList.toggle("active", ids.includes(key));
    });
  }

  function go(i) {
    current = Math.max(0, Math.min(i, steps.length));
    const step = current ? steps[current - 1] : null;
    const stepEdges = step ? step.edges || [] : [];
    canvas.classList.toggle("walking", Boolean(step));
    setActive(nodeEls, step ? step.nodes || [] : []);
    setActive(edgeEls, stepEdges);
    setActive(edgeMarkerEls, stepEdges);
    setActive(groupEls, step ? step.groups || [] : []);
    if (legend) {
      Object.keys(legendItemEls).forEach((key) => {
        var isActive = stepEdges.includes(key);
        legendItemEls[key].classList.toggle("active", isActive);
        legendItemEls[key].classList.toggle("dim", !isActive);
      });
    }
    dotEls.forEach((dot, index) => {
      dot.classList.toggle("active", index === current - 1);
      dot.classList.toggle("done", index < current - 1);
    });
    // Continuous pulsing belongs to async edges while their step (or the
    // Overview, step === null) is active. During a step, each active async
    // Edge just loops on its own (kdfPulseSetLive) — the point is that one
    // Edge, not the whole system. In overview, the producer/consumer cascade
    // Owns the show instead (topic broadcast, queue turn-taking, filters);
    // Per-edge loops step aside so the two mechanisms never fight the same
    // Stroke-dashoffset. Without MOTION there is no cascade to run, so every
    // Async edge just shows its static reduced-motion dot together.
    kdfSyncRecurringPulses(false);
    // `fire` is a one-shot travel on step activation — sync or async, and
    // Independent of the edge's own active/dim state.
    if (step && step.fire) {
      step.fire.forEach((edgeId) => {
        kdfPulseFire(pulseByEdge[edgeId]);
      });
    }
    const overview = data.overview || {};
    // Step titles may include an ordinal prefix ("1 · Author the contract")
    // For authoring convenience, but displaying it alongside numbered edge
    // Markers (1–9) creates visual collision. The dots already show which
    // Step is active, so strip the prefix before rendering the title.
    let title = step ? step.title || "Step " + current : overview.title || "Walk the data flow →";
    title = String(title).replace(/^\d+\s*[·•-]\s*/, "");
    annotation.querySelector("strong").innerHTML = title;
    annotation.querySelector("p").innerHTML = step
      ? step.body || ""
      : overview.body || "Use Next step to trace data across groups and trust boundaries.";
    next.disabled = current >= steps.length;
    reset.disabled = current === 0;
  }

  // Hover a legend chip → highlight its edge + marker on the canvas.
  const hoverHandlers = [];
  function highlightEdge(edgeId, on) {
    if (edgeEls[edgeId]) {
      edgeEls[edgeId].classList.toggle("hover", on);
    }
    if (edgeMarkerEls[edgeId]) {
      edgeMarkerEls[edgeId].classList.toggle("hover", on);
    }
    if (legendItemEls[edgeId]) {
      legendItemEls[edgeId].classList.toggle("hover", on);
    }
  }
  if (legend) {
    legendItems.forEach((item) => {
      var li = legendItemEls[item.id];
      var enter = function () {
        highlightEdge(item.id, true);
      };
      var leave = function () {
        highlightEdge(item.id, false);
      };
      li.addEventListener("mouseenter", enter);
      li.addEventListener("mouseleave", leave);
      hoverHandlers.push({ li, enter, leave });
    });
  }

  function advance() {
    if (current < steps.length) {
      go(current + 1);
    }
  }
  function restart() {
    go(0);
  }
  next.addEventListener("click", advance);
  reset.addEventListener("click", restart);
  host.__kitDispose = function __kitDispose() {
    next.removeEventListener("click", advance);
    reset.removeEventListener("click", restart);
    hoverHandlers.forEach((h) => {
      h.li.removeEventListener("mouseenter", h.enter);
      h.li.removeEventListener("mouseleave", h.leave);
    });
    window.removeEventListener("kitmotionpresetchange", onMotionPresetChange);
    // Stop every MOTION control and the cascade's own timers before the
    // Host's markup is torn down — otherwise a re-mount (studio swaps,
    // KitMount's own remount path) leaves orphaned infinite-repeat pulses
    // And dispatch timers running against detached SVG.
    kdfCascadeStop();
    Object.keys(pulseByEdge).forEach((edgeId) => {
      var pulse = pulseByEdge[edgeId];
      if (pulse.ctl) {
        pulse.ctl[0].stop();
        pulse.ctl[1].stop();
      }
      if (pulse.fireCtl) {
        pulse.fireCtl[0].stop();
        pulse.fireCtl[1].stop();
      }
      clearTimeout(pulse.fireTimer);
    });
  };
  go(0);
  return {
    count: steps.length + 1,
    current() {
      return current;
    },
    go,
  };
}

/* Architecture is assembled after this dependency. Keep its shared detail
   behavior explicit while preserving the dependency-free single-file build. */
globalThis.ExplainerKit = Object.assign(globalThis.ExplainerKit || {}, {
  applyArchitectureDetail: kdfApplyArchitectureDetail,
  registerArchitectureDetail: kdfRegisterArchitectureDetail,
});
