/* Component: loop — see references/CONTRACTS.md#loop.
   A closed process circuit: numbered nodes ride a spine, kind tints the ring,
   hover/click reveals a detail panel, and an optional return arc makes the
   loop literally close. Returns {count, go, current} so a Present slide can
   walk it stage by stage. */
function renderLoop(sel, data) {
  const host = kitMount(sel);
  if (!data.__kitAdjusted) {
    const adjustment = globalThis.ExplainerKit.registerAdjustments(host, {
      base: data,
      defaults: { layout: data.layout || "circuit" },
      label: data.ariaLabel || "Process loop",
      options: [
        {
          key: "layout",
          label: "Layout",
          type: "choice",
          choices: ["circuit", "briefing"],
          choiceLabels: { circuit: "Closed circuit", briefing: "Stage briefing" },
          choiceDescriptions: {
            circuit: "See the feedback structure as one loop",
            briefing: "Read how each stage works",
          },
        },
      ],
      apply(state) {
        const current = host.__kitPresentDriver ? host.__kitPresentDriver.current() : 0;
        const driver = renderLoop(host, {
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
  kitValidateTextCaps(host, "renderLoop", data);
  host.classList.add("klp");
  host.dataset.layout = data.layout || "circuit";
  const stages = data.stages || [];
  if (stages.length === 0) {
    throw new Error("renderLoop: data.stages is required");
  }
  if (stages.length > 6) {
    throw new Error("renderLoop: data.stages supports at most 6 stages, got " + stages.length);
  }
  const KINDS = new Set(["human", "agent", "both", "gate", "future"]);
  function resolveKind(value) {
    return KINDS.has(value) ? value : "";
  }
  function visibleLength(value) {
    return String(value == null ? "" : value).length;
  }
  stages.forEach((stage, index) => {
    if (!visibleLength(stage.label) && !visibleLength(stage.title)) {
      throw new Error("renderLoop: stage " + (index + 1) + " needs label or title");
    }
  });

  if (data.legend && data.legend.length > 0) {
    const lg = kitEl("div", "klp-legend");
    data.legend.forEach((item) => {
      const legendItem = kitEl("span", "klp-lk");
      const kind = resolveKind(item.kind);
      if (kind) {
        legendItem.classList.add(kind);
      }
      legendItem.append(kitEl("i"));
      const label = kitEl("span");
      label.textContent = item.label == null ? "" : String(item.label);
      legendItem.append(label);
      lg.append(legendItem);
    });
    host.append(lg);
  }

  const circuit = kitEl("div", "klp-circuit");
  const track = kitEl("div", "klp-track");
  const nodes = stages.map(function (st, i) {
    var num = st.num || String(i + 1).padStart(2, "0");
    var n = kitEl("button", "klp-node");
    const kind = resolveKind(st.kind);
    if (kind) {
      n.classList.add(kind);
    }
    n.type = "button";
    n.setAttribute("aria-label", "Stage " + num + ": " + (st.label || ""));
    const ring = kitEl("i", "klp-ring");
    ring.textContent = num;
    n.append(ring);
    const label = kitEl("span", "klp-label");
    label.textContent = st.label == null ? "" : String(st.label);
    n.append(label);
    if (st.tag) {
      const tag = kitEl("span", "klp-tag");
      tag.textContent = String(st.tag);
      n.append(tag);
    }
    n.addEventListener("mouseenter", function () {
      go(i);
    });
    n.addEventListener("click", function () {
      go(i);
    });
    n.addEventListener("focus", function () {
      go(i);
    });
    track.appendChild(n);
    return n;
  });
  circuit.append(track);
  if (data.return) {
    const ret = kitEl("div", "klp-return");
    const arrow = kitEl("span", "klp-return-arrow", "↑");
    arrow.setAttribute("aria-hidden", "true");
    ret.append(arrow);
    const label = kitEl("span", "klp-return-label");
    label.textContent = data.return.label == null ? "" : String(data.return.label);
    ret.append(label);
    circuit.append(ret);
  }
  host.append(circuit);

  const detail = kitEl("div", "klp-detail");
  detail.setAttribute("aria-live", "polite");
  const eyebrow = kitEl("div", "klp-detail-eyebrow");
  const title = kitEl("h4", "klp-detail-title");
  const body = kitEl("div", "klp-detail-body");
  detail.append(eyebrow);
  detail.append(title);
  detail.append(body);
  host.append(detail);

  let cur = -1;
  function go(i) {
    if (i < 0 || i >= stages.length || i === cur) {
      return;
    }
    cur = i;
    const st = stages[i];
    const num = st.num || String(i + 1).padStart(2, "0");
    nodes.forEach((n, k) => {
      var on = k === i;
      n.classList.toggle("sel", on);
      if (on) {
        n.setAttribute("aria-current", "step");
      } else {
        n.removeAttribute("aria-current");
      }
    });
    eyebrow.className = "klp-detail-eyebrow";
    const kind = resolveKind(st.kind);
    if (kind) {
      eyebrow.classList.add(kind);
    }
    eyebrow.textContent = st.eyebrow || `Stage ${num}`;
    title.textContent = st.title || st.label || "";
    body.textContent = st.body || "";
    if (typeof swapIn === "function") {
      swapIn(detail);
    }
  }
  go(0);
  return globalThis.ExplainerKit.stableDriver(host, {
    go,
    count: stages.length,
    current() {
      return cur;
    },
  });
}
