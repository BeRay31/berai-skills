/* Component: architecture — see references/CONTRACTS.md#architecture.
   Generic system maps remain a thin semantic layer over data-flow. The
   operating-model preset selects a purpose-built open stage; sequence, ERD,
   and stack are sibling renderers with the same walkthrough/pulse vocabulary. */

// Shared geometry helper for renderErd's auto-grid guard.
function kdfRectOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/* The operating model is a distinct visual grammar, not a data-flow layout.
   Its fixed stage reserves real connector lanes: a policy rail above, inputs
   left, one decision core, outcomes right, and review out of band below.
   There is deliberately no enclosing system box competing with the core. */
/* Program operating models use authored responsibilities and handoffs. Legacy
   policy/input/decision models retain their original schema and walkthrough. */
function kdfRenderOperatingModel(sel, data) {
  if (!Array.isArray(data.stages)) {
    return kdfRenderLegacyOperatingModel(sel, data);
  }
  const canvas = kdfOperatingCanvasSource(sel, data);
  data = canvas.data;
  const { source: canvasSource, authored: canvasAuthored, edits: canvasEdits } = canvas;
  const stages = data.stages;
  const handoffs = data.handoffs || [];
  const steps = data.steps || data.walkthrough || [];
  const ids = new Set(stages.map((stage) => stage.id));
  const edgeIds = new Set(handoffs.map((edge) => edge.id));
  if (
    stages.length < 2 ||
    stages.length > 5 ||
    ids.size !== stages.length ||
    stages.some((stage) => !stage.id || !stage.title)
  ) {
    throw new Error("operating-model: provide 2–5 stages with unique ids and titles");
  }
  if (
    edgeIds.size !== handoffs.length ||
    handoffs.some((edge) => !edge.id || !edge.label || !ids.has(edge.from) || !ids.has(edge.to))
  ) {
    throw new Error("operating-model: handoffs need unique ids, labels, and known endpoints");
  }
  if (
    steps.length > 6 ||
    steps.some(
      (step) =>
        (step.nodes || []).some((id) => !ids.has(id)) ||
        [...(step.edges || []), ...(step.fire || [])].some((id) => !edgeIds.has(id)),
    )
  ) {
    throw new Error(
      "operating-model: walkthrough supports six steps with known stage and handoff ids",
    );
  }
  handoffs.forEach((edge) => {
    if (
      edge.criteria != null &&
      (!Array.isArray(edge.criteria) ||
        edge.criteria.length < 1 ||
        edge.criteria.length > 4 ||
        edge.criteria.some(
          (criterion) =>
            !criterion || typeof criterion.label !== "string" || !criterion.label.trim(),
        ))
    ) {
      throw new Error("operating-model: gate criteria need 1–4 labelled requirements");
    }
  });
  const canUseLanes = stages.every(
    (stage) => typeof stage.owner === "string" && stage.owner.trim(),
  );
  const canUseGates =
    stages.length <= 4 &&
    handoffs.length === stages.length - 1 &&
    stages
      .slice(0, -1)
      .every((stage, index) =>
        handoffs.some(
          (edge) =>
            edge.from === stage.id &&
            edge.to === stages[index + 1].id &&
            edge.kind !== "feedback" &&
            edge.criteria &&
            edge.criteria.length &&
            typeof edge.approver === "string" &&
            edge.approver.trim(),
        ),
      );
  const canUseProgression = kdfValidateOperatingProgression(data);
  const layouts = ["flow", "roles", "lanes", "progression", "gates"];
  if (data.layout && !layouts.includes(data.layout)) {
    throw new Error("operating-model: unknown layout " + data.layout);
  }
  // Offer only what this data can show. A greyed-out layout is a
  // question the reader cannot answer; the help text below tells the
  // author what to add to unlock the rest.
  const availableLayouts = layouts.filter(
    (layout) =>
      (layout !== "lanes" || canUseLanes) &&
      (layout !== "progression" || canUseProgression) &&
      (layout !== "gates" || canUseGates),
  );
  // Authoring guards run before kitMount() empties the host, so a bad layout
  // leaves the previous render standing instead of a blank host.
  const authoredLayout = data.layout || "flow";
  if (!availableLayouts.includes(authoredLayout)) {
    throw new Error(
      "operating-model: " +
        authoredLayout +
        " needs the authored data described by its layout control",
    );
  }
  const existingHost = typeof sel === "string" ? document.querySelector(sel) : sel;
  const liveState =
    existingHost && existingHost.__kitAdjustments && existingHost.__kitAdjustments.state;
  if (liveState && !availableLayouts.includes(liveState.layout)) {
    // Canvas edits can retire the layout the reader picked earlier.
    liveState.layout = authoredLayout;
  }
  const host = kitMount(sel);
  host.classList.add("kdf", "kom-program");
  kitValidateTextCaps(host, data.__capRenderer || "renderOperatingModel", data);
  const adjustments = globalThis.ExplainerKit.registerAdjustments(host, {
    base: { ...data, kind: "operating-model" },
    label: "Operating model",
    defaults: {
      layout: data.layout || "flow",
      detail: data.detail || "minimal",
    },
    options: [
      {
        key: "layout",
        label: "Layout",
        type: "choice",
        choices: availableLayouts,
        choiceLabels: {
          flow: "Working flow",
          roles: "Responsibilities",
          lanes: "Collaboration lanes",
          progression: "Capability progression",
          gates: "Readiness gates",
        },
        choiceDescriptions: {
          flow: "Follow activities and their outgoing handoffs.",
          roles: "Compare accountability, decisions, and cadence.",
          lanes: "See work cross team boundaries and return as feedback.",
          progression: "Compare the same capabilities across successive program phases.",
          gates: "Read the evidence and approval required to enter each phase.",
        },
        help: [
          !canUseLanes && "Collaboration lanes needs an owner for every stage.",
          !canUseProgression &&
            "Capability progression needs explicit capability states for every phase.",
          !canUseGates &&
            "Readiness gates needs 2–4 phases joined in order, with criteria and an approver on each handoff.",
        ]
          .filter(Boolean)
          .join(" "),
      },
      {
        key: "detail",
        label: "Context",
        type: "choice",
        choices: ["minimal", "contextual"],
        choiceLabels: { minimal: "Essentials", contextual: "More context" },
      },
    ],
    apply(next, key) {
      const changedLayout = key === "layout" && next.layout !== host.dataset.operatingLayout;
      const current =
        !changedLayout && host.__kitPresentDriver ? host.__kitPresentDriver.current() : 0;
      const driver = kdfRenderOperatingModel(host, data);
      driver.go(current);
      if (changedLayout) {
        window.dispatchEvent(
          new CustomEvent("kitcomponentchange", {
            detail: { host, count: driver.count, step: 0 },
          }),
        );
      }
    },
  });
  const state = adjustments.state;
  // registerAdjustments caches the first render's options, so refresh the
  // offered layouts from the data this render actually has.
  const layoutOption = adjustments.entry.options.find((option) => option.key === "layout");
  if (layoutOption) {
    layoutOption.choices = availableLayouts.slice();
  }
  host.dataset.operatingLayout = state.layout;
  host.dataset.operatingDetail = state.detail;
  host.dataset.komDensity = kdfOperatingDensity(data);
  const board = kitEl("div", "kom-program-board");
  board.setAttribute("aria-label", data.ariaLabel || "Program responsibilities and handoffs");
  host.append(board);
  if (data.principle && state.layout !== "progression") {
    board.append(kitEl("p", "kom-principle", data.principle));
  }
  const grid = kitEl("div", "kom-stages");
  grid.style.setProperty("--kom-columns", String(stages.length));
  board.append(grid);
  const nodeEls = {};
  const edgeEls = {};
  let disposeView = null;
  if (state.layout === "lanes") {
    kdfOperatingLanes(grid, data, state, nodeEls, edgeEls);
  } else if (state.layout === "gates") {
    kdfOperatingGates(grid, data, nodeEls, edgeEls);
  } else if (state.layout === "progression") {
    disposeView = kdfOperatingProgression(grid, data, nodeEls, edgeEls);
  } else if (state.layout === "flow") {
    kdfOperatingFlow(grid, data, nodeEls, edgeEls);
  } else {
    if (state.layout === "roles") {
      const headings = kitEl("div", "kom-role-head");
      ["Responsibility", "Owner / decision", "Cadence", "Handoff"].forEach((label) =>
        headings.append(kitEl("span", "", label)),
      );
      grid.append(headings);
    }
    stages.forEach((stage, index) => {
      const card = kitEl("article", "kom-stage");
      card.dataset.node = stage.id;
      if (
        stages[index + 1] &&
        handoffs.some(
          (edge) =>
            edge.from === stage.id && edge.to === stages[index + 1].id && edge.kind !== "feedback",
        )
      ) {
        card.dataset.nextHandoff = "true";
      }
      const responsibility = kitEl("div", "kom-responsibility");
      responsibility.append(kitEl("span", "kom-stage-number", String(index + 1).padStart(2, "0")));
      responsibility.append(kitEl("h3", "", stage.title));
      if (stage.body) {
        responsibility.append(kitEl("p", "kom-stage-body", stage.body));
      }
      card.append(responsibility);
      const owner = kitEl("div", "kom-owner");
      owner.append(
        kitEl("span", "kom-field-label", "Accountable owner"),
        kitEl("strong", "", stage.owner || "Not specified"),
      );
      const cadence = kitEl("div", "kom-cadence");
      cadence.append(
        kitEl("span", "kom-field-label", "Cadence"),
        kitEl("span", "", stage.cadence || "Not specified"),
      );
      if (stage.decider) {
        owner.append(kitEl("small", "kom-decision-right", "Decision: " + stage.decider));
      }
      if (stage.partners) {
        owner.append(kitEl("small", "kom-stage-body", "With " + stage.partners));
      }
      card.append(owner, cadence);
      const outgoing = kitEl("div", "kom-handoffs");
      handoffs
        .filter((edge) => edge.from === stage.id)
        .forEach((edge) => {
          const line = kitEl(
            "div",
            "kom-handoff" + (edge.kind === "feedback" ? " is-feedback" : ""),
          );
          line.dataset.edge = edge.id;
          line.append(kitEl("span", "kom-handoff-arrow", edge.kind === "feedback" ? "↺" : "→"));
          const copy = kitEl("div", "");
          copy.append(kitEl("strong", "", edge.label));
          const recipient = stages.find((item) => item.id === edge.to);
          copy.append(kitEl("small", "", "To " + recipient.title));
          if (recipient.owner) {
            copy.append(kitEl("small", "kom-receiver", recipient.owner));
          }
          if (edge.acceptance) {
            copy.append(kitEl("small", "kom-stage-body", "Ready when: " + edge.acceptance));
          }
          line.append(copy);
          outgoing.append(line);
          edgeEls[edge.id] = line;
        });
      if (!outgoing.childElementCount) {
        outgoing.append(kitEl("span", "kom-field-label", "No outgoing handoff specified"));
      }
      card.append(outgoing);
      grid.append(card);
      nodeEls[stage.id] = card;
    });
  }
  const viewSteps =
    state.layout === "progression"
      ? stages.map((stage, index) => ({
          title: stage.title,
          body: stage.body || "",
          nodes: [stage.id],
          edges: handoffs
            .filter(
              (edge) =>
                index > 0 &&
                edge.kind !== "feedback" &&
                edge.from === stages[index - 1].id &&
                edge.to === stage.id,
            )
            .map((edge) => edge.id),
        }))
      : steps;
  const walk = kdfBuildWalk(host, viewSteps, {
    overviewTitle:
      state.layout === "progression"
        ? "Compare capabilities across phases"
        : (data.overview && data.overview.title) || "How the program works",
    overviewBody:
      state.layout === "progression"
        ? "Each capability stays in the same row. Compare its state across the phases using the shared key."
        : (data.overview && (data.overview.body || data.overview.note)) ||
          "Follow the responsibility, owner, and handoff at each stage.",
    onGo(_index, step) {
      board.classList.toggle("is-walking", Boolean(step));
      const focused = new Set((step && step.nodes) || []);
      const edges = new Set(step ? [...(step.edges || []), ...(step.fire || [])] : []);
      handoffs
        .filter((edge) => state.layout !== "progression" && edges.has(edge.id))
        .forEach((edge) => {
          focused.add(edge.from);
          focused.add(edge.to);
        });
      Object.entries(nodeEls).forEach(([id, el]) => el.classList.toggle("active", focused.has(id)));
      Object.entries(edgeEls).forEach(([id, el]) => el.classList.toggle("active", edges.has(id)));
      kdfFocusOperatingPhase(host, state.layout, step, nodeEls);
    },
  });
  host.__kitDispose = () => {
    walk.dispose();
    if (disposeView) {
      disposeView();
    }
  };
  walk.go(0);
  const driver = globalThis.ExplainerKit.stableDriver(host, {
    count: viewSteps.length + 1,
    current: walk.current,
    go: walk.go,
  });
  if (canvasSource) {
    host.__kitCanvasAuthored = structuredClone(canvasAuthored);
    host.__kitCanvasEdits = structuredClone(canvasEdits);
    host.__kitCanvas = {
      kind: "operating-model",
      layout: state.layout,
      validate(next) {
        kdfOperatingEditedData(canvasSource, next);
      },
      apply(next) {
        kdfOperatingEditedData(canvasSource, next);
        const previous = structuredClone(host.__kitCanvasEdits);
        const at = driver.current();
        let rendered;
        try {
          host.__kitCanvasEdits = structuredClone(next);
          rendered = kdfRenderOperatingModel(host, canvasSource);
        } catch (error) {
          host.__kitCanvasEdits = previous;
          kdfRenderOperatingModel(host, canvasSource).go(at);
          host.dispatchEvent(new CustomEvent("kitcanvasrender", { bubbles: true }));
          throw error;
        }
        rendered.go(0);
        host.dispatchEvent(new CustomEvent("kitcanvasrender", { bubbles: true }));
        window.dispatchEvent(
          new CustomEvent("kitcomponentchange", {
            detail: { host, count: rendered.count, step: 0 },
          }),
        );
      },
    };
  }
  return driver;
}

function kdfFocusOperatingPhase(host, layout, step, nodes) {
  if (
    layout !== "progression" ||
    !step ||
    window.__kitMeasuring ||
    window.innerWidth > 1100 ||
    !document.body.classList.contains("presenting")
  ) {
    return;
  }
  const node = nodes[(step.nodes || [])[0]];
  if (!node) {
    return;
  }
  queueMicrotask(() =>
    requestAnimationFrame(() => {
      if (
        node.isConnected &&
        node.classList.contains("active") &&
        host.closest(".pr-slide.active") &&
        document.body.classList.contains("presenting")
      ) {
        node.scrollIntoView({ block: "start", inline: "nearest", behavior: "instant" });
      }
    }),
  );
}

function kdfOperatingCanvasSource(sel, data) {
  const host = typeof sel === "string" ? document.querySelector(sel) : sel;
  if (!data.progression || !host) {
    return { data, source: null, authored: null, edits: null };
  }
  const source = host.__kitOperatingSource || data;
  host.__kitOperatingSource = source;
  const baseline = kdfOperatingSnapshot(source);
  const authored =
    source.canvasEdits && source.canvasEdits.kind === "operating-model"
      ? source.canvasEdits
      : baseline;
  const edits = host.__kitCanvasEdits || authored;
  return {
    source,
    authored,
    edits,
    data:
      JSON.stringify(edits) === JSON.stringify(baseline)
        ? source
        : kdfOperatingEditedData(source, edits),
  };
}

function kdfOperatingSnapshot(data) {
  return structuredClone({
    version: 1,
    kind: "operating-model",
    stages: data.stages,
    progression: data.progression,
  });
}

function kdfOperatingEditedData(source, edits) {
  if (
    !edits ||
    edits.version !== 1 ||
    edits.kind !== "operating-model" ||
    !Array.isArray(edits.stages) ||
    edits.stages.length < 2 ||
    edits.stages.length > 5 ||
    edits.stages.some((stage) => !stage || !stage.id || !stage.title) ||
    new Set(edits.stages.map((stage) => stage.id)).size !== edits.stages.length
  ) {
    throw new Error("operating-model: canvas edits need 2–5 uniquely named phases");
  }
  const stages = structuredClone(edits.stages);
  const ids = new Set(stages.map((stage) => stage.id));
  const handoffs = (source.handoffs || []).filter((edge) => ids.has(edge.from) && ids.has(edge.to));
  const next = {
    ...source,
    stages,
    handoffs,
    progression: structuredClone(edits.progression),
    steps: stages.map((stage) => ({
      title: stage.title,
      body: stage.body || "",
      nodes: [stage.id],
    })),
  };
  if (!kdfValidateOperatingProgression(next)) {
    throw new Error("operating-model: canvas edits need capability progression data");
  }
  return next;
}

let kitOperatingModelSeq = 0;
function kdfOperatingText(tag, className, text) {
  const element = kitEl(tag, className);
  element.textContent = text;
  return element;
}

function kdfValidateOperatingProgression(data) {
  const progression = data.progression;
  if (progression == null) {
    return false;
  }
  const states = progression.states;
  const capabilities = progression.capabilities;
  const tones = new Set(["neutral", "accent", "violet", "success", "warning"]);
  if (
    !Array.isArray(states) ||
    states.length < 2 ||
    states.length > 5 ||
    states.some(
      (state) =>
        !state ||
        !state.id ||
        !state.label ||
        !tones.has(state.tone) ||
        (state.color != null && !/^#[0-9a-f]{6}$/i.test(state.color)),
    ) ||
    new Set(states.map((state) => state.id)).size !== states.length
  ) {
    throw new Error(
      "operating-model: progression needs 2–5 named states with unique ids and explicit tones",
    );
  }
  const stateIds = new Set(states.map((state) => state.id));
  const phaseIds = new Set(data.stages.map((stage) => stage.id));
  if (
    !Array.isArray(capabilities) ||
    capabilities.length > 8 ||
    capabilities.some(
      (capability) =>
        !capability ||
        !capability.id ||
        !capability.label ||
        !capability.states ||
        data.stages.some(
          (stage) =>
            !Object.hasOwn(capability.states, stage.id) ||
            (capability.states[stage.id] !== null && !stateIds.has(capability.states[stage.id])),
        ) ||
        Object.keys(capability.states).some((id) => !phaseIds.has(id)),
    ) ||
    new Set(capabilities.map((capability) => capability.id)).size !== capabilities.length
  ) {
    throw new Error(
      "operating-model: progression needs at most 8 unique capabilities with an explicit state or null for every phase",
    );
  }
  const horizons = progression.horizons || [];
  const phaseIndex = new Map(data.stages.map((stage, index) => [stage.id, index]));
  if (
    !Array.isArray(horizons) ||
    horizons.length > 4 ||
    horizons.some(
      (horizon) =>
        !horizon ||
        !horizon.label ||
        !phaseIds.has(horizon.from) ||
        !phaseIds.has(horizon.to) ||
        phaseIndex.get(horizon.from) > phaseIndex.get(horizon.to),
    )
  ) {
    throw new Error(
      "operating-model: progression horizons need labels and ordered, known phase endpoints",
    );
  }
  return true;
}

function kdfOperatingProgression(grid, data, nodeEls, edgeEls) {
  grid.classList.add("kom-progression");
  const progression = data.progression;
  const states = Object.fromEntries(progression.states.map((state) => [state.id, state]));
  const phaseIndex = new Map(data.stages.map((stage, index) => [stage.id, index]));
  const drawnHandoffs = (data.handoffs || []).filter(
    (edge) => edge.kind !== "feedback" && phaseIndex.get(edge.to) === phaseIndex.get(edge.from) + 1,
  );
  const phases = kitEl("div", "kom-progress-phases");
  phases.style.setProperty("--kom-progress-rows", String(progression.capabilities.length + 1));
  phases.setAttribute("role", "group");
  phases.setAttribute("aria-label", "Capability states by program phase");
  function applyTone(element, state) {
    element.style.setProperty(
      "--kom-status",
      state.color || `var(--${state.tone === "neutral" ? "text-faint" : state.tone})`,
    );
  }
  data.stages.forEach((stage, index) => {
    const phase = kitEl("article", "kom-progress-phase");
    phase.dataset.node = stage.id;
    const heading = kitEl("header", "kom-progress-heading");
    const next = data.stages[index + 1];
    if (next && drawnHandoffs.some((edge) => edge.from === stage.id && edge.to === next.id)) {
      phase.dataset.nextHandoff = "true";
    }
    heading.append(
      kdfOperatingText("span", "kom-progress-index", String(index + 1).padStart(2, "0")),
      kdfOperatingText("h3", "", stage.title),
    );
    if (stage.body) {
      heading.append(kdfOperatingText("p", "kom-progress-purpose", stage.body));
    }
    if (stage.owner) {
      heading.append(kdfOperatingText("small", "kom-stage-body", "Owner: " + stage.owner));
    }
    phase.append(heading);
    progression.capabilities.forEach((capability) => {
      const state = states[capability.states[stage.id]];
      const cell = kitEl("div", state ? "kom-progress-cell" : "kom-progress-empty");
      cell.dataset.capability = capability.id;
      if (state) {
        cell.dataset.state = state.id;
        applyTone(cell, state);
        cell.append(
          kdfOperatingText("strong", "", capability.label),
          kdfOperatingText("span", "", state.label),
        );
      }
      phase.append(cell);
    });
    phases.append(phase);
    nodeEls[stage.id] = phase;
  });
  grid.append(phases);
  if ((progression.horizons || []).length) {
    const horizons = kitEl("div", "kom-progress-horizons");
    const ordered = progression.horizons
      .map((horizon, index) => ({ horizon, index }))
      .toSorted(
        (a, b) =>
          phaseIndex.get(a.horizon.from) - phaseIndex.get(b.horizon.from) || a.index - b.index,
      );
    ordered.forEach(({ horizon, index }) => {
      const band = kitEl("div", "kom-progress-horizon");
      band.dataset.horizon = String(index);
      band.append(kdfOperatingText("strong", "", horizon.label));
      if (horizon.owner) {
        band.append(
          kdfOperatingText("span", "kom-progress-horizon-owner", "Owner: " + horizon.owner),
        );
      }
      band.append(
        kdfOperatingText(
          "span",
          "kom-progress-horizon-range",
          data.stages[phaseIndex.get(horizon.from)].title +
            " → " +
            data.stages[phaseIndex.get(horizon.to)].title,
        ),
      );
      band.style.gridColumn = `${phaseIndex.get(horizon.from) + 1} / ${phaseIndex.get(horizon.to) + 2}`;
      horizons.append(band);
    });
    grid.append(horizons);
  }
  const legend = kitEl("div", "kom-progress-legend");
  legend.setAttribute("role", "list");
  legend.setAttribute("aria-label", "Capability state key");
  progression.states.forEach((state) => {
    const item = kitEl("div", "kom-progress-state");
    item.dataset.state = state.id;
    item.setAttribute("role", "listitem");
    applyTone(item, state);
    item.append(kdfOperatingText("span", "", state.label));
    legend.append(item);
  });
  grid.append(legend);
  if (progression.caption) {
    grid.append(kdfOperatingText("p", "kom-progress-caption", progression.caption));
  }
  const handoffs = kitEl("div", "kom-progress-handoffs");
  drawnHandoffs.forEach((edge) => {
    const item = kitEl("div", "kom-progress-handoff");
    item.dataset.edge = edge.id;
    item.append(kdfOperatingText("strong", "", "→ " + edge.label));
    const from = data.stages[phaseIndex.get(edge.from)];
    const to = data.stages[phaseIndex.get(edge.to)];
    item.append(kdfOperatingText("small", "kom-stage-body", from.title + " → " + to.title));
    handoffs.append(item);
    edgeEls[edge.id] = item;
  });
  if (handoffs.childElementCount) {
    grid.append(handoffs);
  }
  return null;
}

function kdfOperatingGates(grid, data, nodeEls, edgeEls) {
  grid.classList.add("kom-gates");
  const tones = ["accent", "violet", "success", "warning"];
  data.stages.forEach((stage, index) => {
    const phase = kitEl("article", "kom-gate-phase");
    phase.dataset.node = stage.id;
    phase.style.setProperty("--kom-tone", `var(--${tones[index]})`);
    const header = kitEl("header", "kom-gate-heading");
    header.append(
      kdfOperatingText("span", "kom-gate-number", String(index + 1).padStart(2, "0")),
      kdfOperatingText("h3", "", stage.title),
    );
    if (stage.audience) {
      header.append(kdfOperatingText("p", "kom-gate-audience", stage.audience));
    }
    if (stage.owner) {
      header.append(kdfOperatingText("p", "kom-gate-owner", "Owned by " + stage.owner));
    }
    phase.append(header);
    const edge = (data.handoffs || []).find((item) => item.from === stage.id);
    if (edge) {
      const gate = kitEl("div", "kom-gate-panel");
      gate.dataset.edge = edge.id;
      gate.append(kdfOperatingText("span", "kom-field-label", "Exit gate"));
      gate.append(kdfOperatingText("h4", "", edge.label));
      const criteria = kitEl("ol", "kom-gate-criteria");
      edge.criteria.forEach((criterion) => {
        const item = kitEl("li", "");
        item.append(kdfOperatingText("strong", "", criterion.label));
        if (criterion.evidence) {
          item.append(kdfOperatingText("p", "kom-stage-body", criterion.evidence));
        }
        criteria.append(item);
      });
      const decision = kitEl("div", "kom-gate-decision");
      decision.append(
        kdfOperatingText("span", "kom-field-label", "Decision owner"),
        kdfOperatingText("strong", "", edge.approver),
      );
      if (edge.hold) {
        decision.append(kdfOperatingText("p", "kom-gate-hold", "If not ready: " + edge.hold));
      }
      gate.append(criteria, decision);
      phase.append(gate);
      edgeEls[edge.id] = gate;
    } else {
      const ongoing = kitEl("div", "kom-gate-panel kom-gate-ongoing");
      ongoing.append(kdfOperatingText("span", "kom-field-label", "Ongoing operation"));
      if (stage.body) {
        ongoing.append(kdfOperatingText("p", "kom-gate-commitment", stage.body));
      }
      if (stage.cadence) {
        ongoing.append(kdfOperatingText("p", "kom-gate-review", "Review: " + stage.cadence));
      }
      if (stage.decider) {
        ongoing.append(kdfOperatingText("p", "kom-gate-owner", "Decision: " + stage.decider));
      }
      phase.append(ongoing);
    }
    grid.append(phase);
    nodeEls[stage.id] = phase;
  });
}

// Working flow: a spine of numbered stages. What moves between stages sits on
// the spine between them; a return decision draws as an arc back to its target.
function kdfOperatingFlow(grid, data, nodeEls, edgeEls) {
  grid.classList.add("kom-flow");
  const stages = data.stages;
  const handoffs = data.handoffs || [];
  const indexById = Object.fromEntries(stages.map((stage, index) => [stage.id, index]));
  const owners = [...new Set(stages.map((stage) => stage.owner).filter(Boolean))];
  const tones = ["accent", "violet", "success", "warning", "accent"];
  const forward = handoffs.filter(
    (edge) => edge.kind !== "feedback" && indexById[edge.to] === indexById[edge.from] + 1,
  );
  const returns = handoffs.filter((edge) => !forward.includes(edge));
  returns.forEach((edge, index) => {
    const from = indexById[edge.from];
    const to = indexById[edge.to];
    const arc = kitEl("div", "kom-flow-return" + (edge.kind === "feedback" ? " is-feedback" : ""));
    arc.dataset.edge = edge.id;
    arc.style.setProperty("--kom-flow-from", String(Math.max(from, to)));
    arc.style.setProperty("--kom-flow-to", String(Math.min(from, to)));
    arc.style.setProperty("--kom-flow-lift", String(index));
    const label = kitEl("span", "kom-flow-return-label");
    label.append(
      kitEl("span", "kom-flow-return-mark", edge.kind === "feedback" ? "↺" : "→"),
      kitEl("strong", "", edge.label),
      kitEl("small", "", "to " + stages[to].title),
    );
    arc.append(label);
    grid.append(arc);
    edgeEls[edge.id] = arc;
  });
  stages.forEach((stage, index) => {
    const card = kitEl("article", "kom-stage kom-flow-stage");
    card.dataset.node = stage.id;
    const head = kitEl("div", "kom-flow-head");
    head.append(kitEl("span", "kom-flow-node", String(index + 1).padStart(2, "0")));
    const carry = forward.find((edge) => edge.from === stage.id);
    if (carry) {
      card.dataset.nextHandoff = "true";
      const pill = kitEl("span", "kom-flow-carry");
      pill.dataset.edge = carry.id;
      pill.append(kitEl("strong", "", carry.label), kitEl("span", "kom-flow-carry-arrow", "→"));
      if (carry.acceptance) {
        pill.title = "Ready when: " + carry.acceptance;
      }
      head.append(pill);
      edgeEls[carry.id] = pill;
    }
    card.append(head, kitEl("h3", "", stage.title));
    if (stage.body) {
      card.append(kitEl("p", "kom-stage-body", stage.body));
    }
    const owner = kitEl("div", "kom-flow-owner");
    const tone = tones[Math.max(0, owners.indexOf(stage.owner)) % tones.length];
    owner.style.setProperty("--kom-tone", `var(--${tone})`);
    owner.append(
      kitEl("span", "kom-flow-monogram", (stage.owner || "?").trim().charAt(0).toUpperCase()),
    );
    const who = kitEl("div", "kom-flow-who");
    who.append(kitEl("strong", "", stage.owner || "Owner not specified"));
    if (stage.decider) {
      who.append(kitEl("small", "", "Decides: " + stage.decider));
    }
    if (stage.partners) {
      who.append(kitEl("small", "kom-stage-body", "With " + stage.partners));
    }
    owner.append(who);
    card.append(owner);
    if (stage.cadence) {
      card.append(kitEl("span", "kom-flow-cadence", stage.cadence));
    }
    grid.append(card);
    nodeEls[stage.id] = card;
  });
}

// Orthogonal waypoints to a path with rounded corners, so wires read as
// drawn rather than plotted.
function kdfRoundedPath(points, radius) {
  let d = `M${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1];
    const corner = points[i];
    const next = points[i + 1];
    const inDir = { x: Math.sign(corner.x - prev.x), y: Math.sign(corner.y - prev.y) };
    const outDir = { x: Math.sign(next.x - corner.x), y: Math.sign(next.y - corner.y) };
    const r = Math.min(
      radius,
      Math.hypot(corner.x - prev.x, corner.y - prev.y) / 2,
      Math.hypot(next.x - corner.x, next.y - corner.y) / 2,
    );
    d += ` L${corner.x - inDir.x * r} ${corner.y - inDir.y * r}`;
    d += ` Q${corner.x} ${corner.y} ${corner.x + outDir.x * r} ${corner.y + outDir.y * r}`;
  }
  const last = points.at(-1);
  return d + ` L${last.x} ${last.y}`;
}

// Density drives Present sizing: five phases by six or more capabilities, or
// four or more owner lanes, cannot hold the showcase's roomy cells.
function kdfOperatingDensity(data) {
  const stages = data.stages || [];
  const owners = new Set(stages.map((stage) => stage.owner)).size;
  const capabilities = ((data.progression || {}).capabilities || []).length;
  return stages.length >= 5 || capabilities >= 6 || owners >= 4 ? "dense" : "roomy";
}

function kdfOperatingLanes(grid, data, state, nodeEls, edgeEls) {
  grid.classList.add("kom-lanes");
  const spacing = globalThis.ExplainerKit.contentSpacing();
  const stages = data.stages;
  const owners = [...new Set(stages.map((stage) => stage.owner))];
  const tones = ["accent", "violet", "success", "warning", "accent"];
  // The owner column fits its longest name instead of clipping it, and many
  // lanes take shorter cards so five owners still fit one screen.
  const longestOwner = owners.reduce((max, owner) => Math.max(max, String(owner).length), 0);
  const left = Math.max(160, Math.min(260, 48 + longestOwner * 9));
  const compact = owners.length >= 4;
  const column = 300 + 24 * spacing;
  const cardWidth = 284;
  const cardHeight = state.detail === "contextual" ? (compact ? 150 : 180) : compact ? 100 : 138;
  const rowPadding = (compact ? 5 : 12) * spacing;
  const rowHeight = cardHeight + rowPadding * 2;
  const width = left + stages.length * column + 20;
  const indexById = Object.fromEntries(stages.map((stage, index) => [stage.id, index]));
  const laneOf = (id) => owners.indexOf(stages[indexById[id]].owner);
  const longEdges = (data.handoffs || []).filter(
    (edge) => indexById[edge.to] !== indexById[edge.from] + 1,
  );
  // A long edge whose ends both sit in the top lane loops over the top instead
  // of crossing every lane below it.
  const overEdges = longEdges.filter((edge) => laneOf(edge.from) === 0 && laneOf(edge.to) === 0);
  const underEdges = longEdges.filter((edge) => !overEdges.includes(edge));
  const laneStep = compact ? 22 : 28;
  const top = 12 + (overEdges.length ? 10 + overEdges.length * laneStep : 0);
  const laneBottom = top + owners.length * rowHeight;
  const height = laneBottom + (underEdges.length ? 12 + underEdges.length * laneStep : 8);
  const viewport = kitEl("div", "kom-lane-viewport");
  const canvas = kitEl("div", "kom-lane-canvas");
  canvas.style.aspectRatio = `${width} / ${height}`;
  canvas.style.minWidth = `${Math.min(width, 1200)}px`;
  // Cards hold HTML at CSS sizes inside a unit-scaled canvas. Keeping the
  // canvas at least its unit height in pixels keeps every card box at least
  // as tall as the content it was sized for, however narrow the render.
  canvas.style.minHeight = `${height}px`;
  canvas.setAttribute("role", "group");
  canvas.setAttribute(
    "aria-label",
    data.ariaLabel || "Responsibilities grouped by accountable owner",
  );
  viewport.append(canvas);
  grid.append(viewport);
  function box(element, x, y, w, h) {
    Object.assign(element.style, {
      left: `${(x / width) * 100}%`,
      top: `${(y / height) * 100}%`,
      width: `${(w / width) * 100}%`,
      height: `${(h / height) * 100}%`,
    });
  }
  owners.forEach((owner, index) => {
    const lane = kitEl("div", "kom-lane");
    lane.style.setProperty("--kom-tone", `var(--${tones[index]})`);
    box(lane, 0, top + index * rowHeight, width, rowHeight);
    const label = kitEl("div", "kom-lane-owner");
    label.style.width = `${(left / width) * 100}%`;
    label.append(kdfOperatingText("strong", "", owner));
    const count = stages.filter((stage) => stage.owner === owner).length;
    label.append(
      kdfOperatingText(
        "small",
        "",
        count + (count === 1 ? " responsibility" : " responsibilities"),
      ),
    );
    lane.append(label);
    canvas.append(lane);
  });
  const svg = svgEl(
    "svg",
    { class: "kom-lane-wires", viewBox: `0 0 ${width} ${height}`, "aria-hidden": "true" },
    canvas,
  );
  const uid = "kom-lanes-" + ++kitOperatingModelSeq;
  const defs = svgEl("defs", {}, svg);
  const marker = svgEl(
    "marker",
    {
      id: uid,
      viewBox: "0 0 10 10",
      refX: 9,
      refY: 5,
      markerWidth: 7,
      markerHeight: 7,
      orient: "auto-start-reverse",
    },
    defs,
  );
  svgEl("path", { d: "M0 0 L10 5 L0 10 Z", fill: "context-stroke" }, marker);
  const positions = {};
  stages.forEach((stage, index) => {
    const lane = owners.indexOf(stage.owner);
    const x = left + column * index + (column - cardWidth) / 2;
    const y = top + lane * rowHeight + rowPadding;
    positions[stage.id] = { x, y };
    const card = kitEl("article", "kom-lane-card");
    card.dataset.node = stage.id;
    card.style.setProperty("--kom-tone", `var(--${tones[lane]})`);
    box(card, x, y, cardWidth, cardHeight);
    card.append(
      kdfOperatingText("span", "kom-lane-number", String(index + 1).padStart(2, "0")),
      kdfOperatingText("h3", "", stage.title),
    );
    if (stage.body) {
      card.append(kdfOperatingText("p", "kom-stage-body", stage.body));
    }
    if (stage.cadence) {
      card.append(kdfOperatingText("small", "kom-lane-cadence", stage.cadence));
    }
    if (stage.decider) {
      card.append(kdfOperatingText("small", "kom-lane-decider", "Decision: " + stage.decider));
    }
    canvas.append(card);
    nodeEls[stage.id] = card;
  });
  const legend = kitEl("div", "kom-lane-key");
  legend.setAttribute("role", "list");
  legend.setAttribute("aria-label", "Handoffs");
  (data.handoffs || []).forEach((edge, index) => {
    const from = positions[edge.from];
    const to = positions[edge.to];
    const overIndex = overEdges.indexOf(edge);
    const underIndex = underEdges.indexOf(edge);
    let d, labelX, labelY;
    if (overIndex !== -1) {
      // Leave from the top of the source, run above the lanes, drop onto the target.
      const rail = 12 + 14 + overIndex * laneStep;
      const x1 = from.x + cardWidth * 0.75;
      const x2 = to.x + cardWidth / 2;
      d = kdfRoundedPath(
        [
          { x: x1, y: from.y },
          { x: x1, y: rail },
          { x: x2, y: rail },
          { x: x2, y: to.y },
        ],
        14,
      );
      labelX = (x1 + x2) / 2;
      labelY = rail;
    } else if (underIndex !== -1) {
      const rail = laneBottom + 26 + underIndex * laneStep;
      const x1 = from.x + cardWidth / 2;
      const x2 = to.x + cardWidth / 2;
      d = kdfRoundedPath(
        [
          { x: x1, y: from.y + cardHeight },
          { x: x1, y: rail },
          { x: x2, y: rail },
          { x: x2, y: to.y + cardHeight },
        ],
        14,
      );
      labelX = (x1 + x2) / 2;
      labelY = rail;
    } else {
      const x1 = from.x + cardWidth;
      const y1 = from.y + cardHeight / 2;
      const y2 = to.y + cardHeight / 2;
      const gutter = (x1 + to.x) / 2;
      d = kdfRoundedPath(
        [
          { x: x1, y: y1 },
          { x: gutter, y: y1 },
          { x: gutter, y: y2 },
          { x: to.x, y: y2 },
        ],
        10,
      );
      labelX = gutter;
      labelY = (y1 + y2) / 2;
    }
    const group = svgEl(
      "g",
      {
        class: "kom-lane-edge" + (edge.kind === "feedback" ? " is-feedback" : ""),
        "data-edge": edge.id,
      },
      svg,
    );
    svgEl("path", { d, "marker-end": `url(#${uid})` }, group);
    svgEl("circle", { cx: labelX, cy: labelY, r: 12 }, group);
    svgEl(
      "text",
      { x: labelX, y: labelY, "text-anchor": "middle", "dominant-baseline": "central" },
      group,
    ).textContent = String(index + 1);
    edgeEls[edge.id] = group;
    const item = kitEl("div", "kom-lane-key-item");
    item.setAttribute("role", "listitem");
    item.append(kdfOperatingText("span", "kom-lane-key-number", String(index + 1)));
    const copy = kitEl("div", "");
    copy.append(kdfOperatingText("strong", "", edge.label));
    const source = stages[indexById[edge.from]];
    const target = stages[indexById[edge.to]];
    copy.append(kdfOperatingText("small", "", source.title + " → " + target.title));
    if (edge.acceptance) {
      copy.append(kdfOperatingText("small", "kom-stage-body", "Ready when: " + edge.acceptance));
    }
    item.append(copy);
    legend.append(item);
  });
  grid.append(legend);
}

function kdfRenderLegacyOperatingModel(sel, data) {
  const host = kitMount(sel);
  kitValidateTextCaps(host, data.__capRenderer || "renderOperatingModel", data);
  const TAG = "architecture operating-model";
  const policy = data.policy || [];
  const inputs = data.inputs || [];
  const outputs = data.outputs || [];
  const decision = data.decision || {};
  const audit = data.audit || null;
  const walkthrough = data.steps || data.walkthrough || [];
  if (!decision.title) {
    throw new Error(TAG + ": decision.title is required");
  }
  if (policy.length < 1 || policy.length > 3) {
    throw new Error(TAG + ": supports 1-3 policy cards");
  }
  if (inputs.length < 1 || inputs.length > 4 || outputs.length < 1 || outputs.length > 4) {
    throw new Error(TAG + ": supports 1-4 inputs and 1-4 outputs");
  }
  if (walkthrough.length > 6) {
    throw new Error(TAG + ": walkthrough supports at most 6 steps");
  }
  const nodeIds = new Set(["decision"]);
  policy.forEach((_item, index) => nodeIds.add("policy-" + index));
  inputs.forEach((_item, index) => nodeIds.add("input-" + index));
  outputs.forEach((_item, index) => nodeIds.add("output-" + index));
  if (audit) {
    nodeIds.add("audit");
  }
  const edgeIds = new Set();
  policy.forEach((_item, index) => edgeIds.add("policy-" + index + "-decision"));
  inputs.forEach((_item, index) => edgeIds.add("input-" + index + "-decision"));
  outputs.forEach((_item, index) => edgeIds.add("decision-output-" + index));
  if (audit) {
    edgeIds.add("decision-audit");
  }
  walkthrough.forEach(function (step, stepIndex) {
    (step.nodes || []).forEach(function (id) {
      if (!nodeIds.has(id)) {
        throw new Error(
          TAG + ": walkthrough step " + (stepIndex + 1) + ' references unknown node "' + id + '"',
        );
      }
    });
    [...(step.edges || []), ...(step.fire || [])].forEach(function (id) {
      if (!edgeIds.has(id)) {
        throw new Error(
          TAG + ": walkthrough step " + (stepIndex + 1) + ' references unknown edge "' + id + '"',
        );
      }
    });
  });

  const W = 1500;
  const H = 720;
  let motionPreset = kdfEnsureMotionPreset();
  host.classList.add("kdf", "kom");
  globalThis.ExplainerKit.registerArchitectureDetail(host, data, "operating model");
  host.__kitBase = { ...data, kind: "operating-model", preset: "operating-model" };
  host.dataset.motionPreset = motionPreset;
  host.dataset.zoom = "";
  const canvas = kitEl("div", "kom-canvas");
  canvas.style.aspectRatio = W + " / " + H;
  canvas.style.setProperty("--kdf-floor", "1120px");
  canvas.setAttribute("role", "img");
  canvas.setAttribute(
    "aria-label",
    data.ariaLabel ||
      "Policy and inputs feed a decision; outcomes flow right and review sits out of band",
  );
  host.append(canvas);
  globalThis.ExplainerKit.applyArchitectureDetail(host, host.__kitArchitectureDetail.detail);

  const labelSpecs = [
    ["Policy", 750, 22, "middle"],
    ["Inputs", 50, 195, "start"],
    ["Outcomes", 1450, 195, "end"],
  ];
  if (audit) {
    labelSpecs.push(["Review", 980, 570, "start"]);
  }
  labelSpecs.forEach(function (spec) {
    const label = kitEl("span", "kom-zone-label", spec[0]);
    label.style.left = (Number(spec[1]) / W) * 100 + "%";
    label.style.top = (Number(spec[2]) / H) * 100 + "%";
    label.style.transform =
      spec[3] === "middle" ? "translateX(-50%)" : spec[3] === "end" ? "translateX(-100%)" : "none";
    canvas.append(label);
  });

  const wireSvg = svgEl(
    "svg",
    {
      class: "kom-wires",
      viewBox: "0 0 " + W + " " + H,
      preserveAspectRatio: "none",
      "aria-hidden": "true",
    },
    canvas,
  );
  const defs = svgEl("defs", {}, wireSvg);
  const markerId = "kom-arrow-" + ++kitOperatingModelSeq;
  const marker = svgEl(
    "marker",
    {
      id: markerId,
      viewBox: "0 0 8 8",
      refX: 7,
      refY: 4,
      markerWidth: 8,
      markerHeight: 8,
      orient: "auto",
    },
    defs,
  );
  svgEl("path", { d: "M0 0 L8 4 L0 8 Z", class: "kom-arrow-head" }, marker);
  const edgeLayer = svgEl("g", { class: "kom-edge-layer" }, wireSvg);
  const pulseLayer = svgEl("g", { class: "kdf-pulse-layer" }, wireSvg);
  const edgeEls = {};
  const pulses = {};
  const edges = [];
  function addEdge(id, tone, d, kind) {
    const group = svgEl(
      "g",
      { class: "kom-edge " + (tone || "neutral"), "data-edge": id },
      edgeLayer,
    );
    const path = svgEl(
      "path",
      { class: "kom-edge-path", d, "marker-end": "url(#" + markerId + ")" },
      group,
    );
    edgeEls[id] = group;
    edges.push({ id, kind: kind || "sync" });
    const length = Math.max(1, path.getTotalLength());
    pulses[id] = kdfMakePulse(pulseLayer, tone || "neutral", d, length, id, function () {
      return motionPreset;
    });
  }

  const policyW = 240;
  const policyGap = 24;
  const policyStart = 750 - (policy.length * policyW + (policy.length - 1) * policyGap) / 2;
  policy.forEach(function (item, index) {
    const cx = policyStart + index * (policyW + policyGap) + policyW / 2;
    const tx = 660 + (index + 1) * (180 / (policy.length + 1));
    addEdge(
      "policy-" + index + "-decision",
      item.tone || "violet",
      "M" + cx + " 142 C" + cx + " 190 " + tx + " 195 " + tx + " 250",
    );
  });
  function spread(index, count, start, end) {
    return count === 1 ? (start + end) / 2 : start + (index / (count - 1)) * (end - start);
  }
  inputs.forEach(function (item, index) {
    const sy = spread(index, inputs.length, 265, 505);
    const ty = spread(index, inputs.length, 292, 408);
    addEdge(
      "input-" + index + "-decision",
      item.tone || "neutral",
      "M350 " + sy + " C435 " + sy + " 480 " + ty + " 570 " + ty,
    );
  });
  outputs.forEach(function (item, index) {
    const sy = spread(index, outputs.length, 292, 408);
    const ty = spread(index, outputs.length, 265, 505);
    addEdge(
      "decision-output-" + index,
      item.tone || "success",
      "M930 " + sy + " C1020 " + sy + " 1065 " + ty + " 1150 " + ty,
    );
  });
  if (audit) {
    addEdge(
      "decision-audit",
      audit.tone || "neutral",
      "M750 440 C750 530 1120 510 1120 585",
      "async",
    );
  }

  const nodeEls = {};
  function card(id, item, x, y, w, h, role) {
    const tone =
      item.tone || (role === "decision" ? "accent" : role === "output" ? "success" : "neutral");
    const el = kitEl("div", "kom-card kom-" + role + " " + tone);
    el.dataset.node = id;
    el.style.setProperty("--kom-order", String(Object.keys(nodeEls).length));
    kdfBoxRect(el, x, y, w, h, W, H);
    if (item.eyebrow) {
      const eyebrow = kitEl("span", "kom-eyebrow");
      eyebrow.textContent = item.eyebrow;
      el.append(eyebrow);
    }
    const title = kitEl("strong", "kom-title");
    title.textContent = item.title;
    el.append(title);
    const subcopy = item.sub || item.body;
    if (subcopy) {
      const sub = kitEl("small", "kom-sub");
      sub.textContent = subcopy;
      el.append(sub);
    }
    if (role === "decision") {
      el.append(kitEl("i", "kom-core-ring"));
    }
    canvas.append(el);
    nodeEls[id] = el;
  }
  policy.forEach(function (item, index) {
    card(
      "policy-" + index,
      item,
      policyStart + index * (policyW + policyGap),
      44,
      policyW,
      98,
      "policy",
    );
  });
  inputs.forEach(function (item, index) {
    const cy = spread(index, inputs.length, 265, 505);
    card("input-" + index, item, 50, cy - 44, 300, 88, "input");
  });
  card("decision", decision, 570, 250, 360, 190, "decision");
  outputs.forEach(function (item, index) {
    const cy = spread(index, outputs.length, 265, 505);
    card("output-" + index, item, 1150, cy - 44, 300, 88, "output");
  });
  if (audit) {
    card("audit", audit, 980, 585, 340, 98, "audit");
  }
  requestAnimationFrame(function () {
    canvas.classList.add("kom-live");
  });

  function fire(id) {
    if (pulses[id]) {
      kdfPulseFire(pulses[id]);
    }
  }
  const ambient = kdfAmbientCycle(
    edges.map((edge) => edge.id),
    fire,
    function () {
      return motionPreset === "calm" ? 340 : 210;
    },
    function () {
      return motionPreset === "calm" ? 1700 : 1050;
    },
  );
  function onWalkGo(_current, step) {
    ambient.stop();
    Object.keys(pulses).forEach(function (id) {
      kdfPulseSetLive(pulses[id], false);
    });
    canvas.classList.toggle("walking", Boolean(step));
    const focusNodes = new Set((step && step.nodes) || []);
    const focusEdges = new Set((step && step.edges) || []);
    ((step && step.fire) || []).forEach((id) => focusEdges.add(id));
    Object.keys(nodeEls).forEach(function (id) {
      nodeEls[id].classList.toggle("active", Boolean(step) && focusNodes.has(id));
    });
    Object.keys(edgeEls).forEach(function (id) {
      edgeEls[id].classList.toggle("active", Boolean(step) && focusEdges.has(id));
    });
    if (!step) {
      if (motionPreset !== "off" && MOTION) {
        ambient.start();
      }
      return;
    }
    focusEdges.forEach(function (id) {
      const edge = edges.find((item) => item.id === id);
      if (edge && edge.kind === "async") {
        kdfPulseSetLive(pulses[id], true);
      } else {
        fire(id);
      }
    });
  }
  const walkApi = kdfBuildWalk(host, walkthrough, {
    overviewTitle: (data.overview && data.overview.title) || "Walk the operating model →",
    overviewBody:
      (data.overview && (data.overview.note != null ? data.overview.note : data.overview.body)) ||
      "Policy governs, inputs enter the decision, outcomes leave, and review stays out of band.",
    onGo: onWalkGo,
  });
  function onMotionPresetChange(event) {
    const preset = event && event.detail ? event.detail.preset : kdfEnsureMotionPreset();
    if (!["calm", "normal", "off"].includes(preset)) {
      return;
    }
    motionPreset = preset;
    host.dataset.motionPreset = preset;
    ambient.stop();
    Object.keys(pulses).forEach(function (id) {
      kdfPulseSetLive(pulses[id], false);
      if (preset === "off") {
        kdfPulseHide(pulses[id]);
      }
    });
    if (!walkApi.current() && preset !== "off" && MOTION) {
      ambient.start();
    }
  }
  window.addEventListener("kitmotionpresetchange", onMotionPresetChange);
  host.__kitDispose = function __kitDispose() {
    ambient.stop();
    walkApi.dispose();
    window.removeEventListener("kitmotionpresetchange", onMotionPresetChange);
    Object.keys(pulses).forEach(function (id) {
      const pulse = pulses[id];
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
  walkApi.go(0);
  return { count: walkthrough.length + 1, current: walkApi.current, go: walkApi.go };
}

function kdfArchitectureFitGroups(groups, nodes, width, height) {
  const nodeByGroup = {};
  nodes.forEach(function (node) {
    if (node.group) {
      (nodeByGroup[node.group] = nodeByGroup[node.group] || []).push(node);
    }
  });
  const output = groups.map((group) => ({ ...group }));
  const outputById = Object.fromEntries(output.map((group) => [group.id, group]));
  function depth(group) {
    let value = 0;
    let current = group;
    while (current.parent && outputById[current.parent]) {
      value += 1;
      current = outputById[current.parent];
    }
    return value;
  }
  output
    .toSorted((a, b) => depth(b) - depth(a))
    .forEach(function (group) {
      const boxes = (nodeByGroup[group.id] || []).concat(
        output.filter((child) => child.parent === group.id && child.w && child.h),
      );
      if (boxes.length === 0) {
        return;
      }
      const minX = Math.min(...boxes.map((box) => box.x));
      const minY = Math.min(...boxes.map((box) => box.y));
      const maxX = Math.max(...boxes.map((box) => box.x + box.w));
      const maxY = Math.max(...boxes.map((box) => box.y + box.h));
      group.x = Math.max(8, minX - 24);
      group.y = Math.max(8, minY - 52);
      group.w = Math.min(width - group.x - 8, maxX - minX + 48);
      group.h = Math.min(height - group.y - 8, maxY - minY + 76);
    });
  return output;
}

function kdfArchitectureStageLayout(data, spacing = 1) {
  let width = data.width || 1200;
  let height = data.height || 560;
  const nodes = (data.nodes || []).map((node) => Object.assign({}, node));
  const edges = data.edges || [];
  const byId = Object.fromEntries(nodes.map((node) => [node.id, node]));
  const incoming = Object.fromEntries(nodes.map((node) => [node.id, 0]));
  const outgoing = Object.fromEntries(nodes.map((node) => [node.id, []]));
  const depth = Object.fromEntries(nodes.map((node) => [node.id, 0]));
  edges.forEach(function (edge) {
    if (byId[edge.from] && byId[edge.to] && edge.from !== edge.to) {
      outgoing[edge.from].push(edge.to);
      incoming[edge.to] += 1;
    }
  });
  const queue = nodes.filter((node) => incoming[node.id] === 0).map((node) => node.id);
  const visited = new Set();
  while (queue.length > 0) {
    const id = queue.shift();
    if (visited.has(id)) {
      continue;
    }
    visited.add(id);
    outgoing[id].forEach(function (next) {
      depth[next] = Math.max(depth[next], depth[id] + 1);
      incoming[next] -= 1;
      if (incoming[next] === 0) {
        queue.push(next);
      }
    });
  }
  const settledDepth = Math.max(0, ...Object.values(depth));
  nodes
    .filter((node) => !visited.has(node.id))
    .toSorted((a, b) => a.x - b.x || a.y - b.y)
    .forEach(function (node, index) {
      depth[node.id] = settledDepth + 1 + (index % 2);
    });
  if (data.__flowLayout) {
    const roots = (data.groups || []).filter((group) => !group.parent);
    const groupById = Object.fromEntries((data.groups || []).map((group) => [group.id, group]));
    function rootOf(node) {
      let group = groupById[node.group];
      while (group && group.parent) {
        group = groupById[group.parent];
      }
      return group && group.id;
    }
    roots
      .toSorted((a, b) => a.x - b.x)
      .forEach((root) => {
        const arrivals = edges.filter(
          (edge) => rootOf(byId[edge.to]) === root.id && rootOf(byId[edge.from]) !== root.id,
        );
        const floor = Math.max(0, ...arrivals.map((edge) => depth[edge.to]));
        nodes
          .filter((node) => rootOf(node) === root.id)
          .forEach((node) => {
            depth[node.id] = Math.max(depth[node.id], floor);
          });
        // Only forward edges in the existing acyclic ordering can advance depth.
        for (let pass = 0; pass < nodes.length; pass++) {
          edges.forEach((edge) => {
            if (
              visited.has(edge.from) &&
              visited.has(edge.to) &&
              rootOf(byId[edge.to]) === root.id
            ) {
              depth[edge.to] = Math.max(depth[edge.to], depth[edge.from] + 1);
            }
          });
        }
      });
  }
  const columns = {};
  const stageGroups = (data.groups || []).filter((group) =>
    nodes.some((node) => node.group === group.id),
  );
  const byRole = !data.__flowLayout && stageGroups.length > 1;
  if (byRole && stageGroups.length > 4) {
    throw new Error(
      "architecture domain detail: supports at most 4 domain columns; split the view into an explicit continuation",
    );
  }
  const stageOrder = [];
  const remaining = stageGroups.toSorted((a, b) => a.x - b.x || a.y - b.y);
  while (remaining.length) {
    const next =
      remaining.find(
        (group) =>
          !edges.some((edge) => {
            const from = byId[edge.from].group;
            const to = byId[edge.to].group;
            return (
              to === group.id && from !== to && remaining.some((candidate) => candidate.id === from)
            );
          }),
      ) || remaining[0];
    stageOrder.push(next);
    remaining.splice(remaining.indexOf(next), 1);
  }
  // Long journeys fold into functional domains when that fits four columns.
  // Trust boundaries remain the fallback for larger domain sets; a column
  // per hop would shrink fixed-size HTML labels into clipped boxes.
  const journeyRoots = (data.groups || [])
    .filter((group) => !group.parent)
    .toSorted((a, b) => a.x - b.x);
  const groupById = Object.fromEntries((data.groups || []).map((group) => [group.id, group]));
  const foldJourney =
    data.__flowLayout &&
    new Set(Object.values(depth)).size > 4 &&
    journeyRoots.length > 1 &&
    journeyRoots.length <= 4;
  const journeyDomains = foldJourney && stageOrder.length > 1 && stageOrder.length <= 4;
  const journeyOrder = new Map();
  function visitJourney(id) {
    if (journeyOrder.has(id)) {
      return;
    }
    journeyOrder.set(id, journeyOrder.size);
    outgoing[id].forEach(visitJourney);
  }
  if (foldJourney) {
    nodes.toSorted((a, b) => depth[a.id] - depth[b.id]).forEach((node) => visitJourney(node.id));
  }
  function journeyColumn(node) {
    if (journeyDomains) {
      return Math.max(
        0,
        stageOrder.findIndex((group) => group.id === node.group),
      );
    }
    let group = groupById[node.group];
    while (group && group.parent) {
      group = groupById[group.parent];
    }
    return Math.max(
      0,
      journeyRoots.findIndex((root) => group && root.id === group.id),
    );
  }
  nodes.forEach(function (node) {
    const role = stageOrder.findIndex((group) => group.id === node.group);
    const column = foldJourney
      ? journeyColumn(node)
      : byRole
        ? role === -1
          ? stageOrder.length
          : role
        : depth[node.id];
    (columns[column] = columns[column] || []).push(node);
  });
  const columnIds = Object.keys(columns)
    .map(Number)
    .toSorted((a, b) => a - b);
  // Reserve whole node boxes and connector lanes, not just their centres.
  // Grow the intrinsic canvas for large graphs instead of overlapping rows.
  const nodeWidth = data.__groupOverview ? 300 : byRole ? 260 : 280;
  const nodeHeight = data.__groupOverview
    ? 230
    : byRole
      ? data.detail === "contextual"
        ? 64
        : 54
      : foldJourney
        ? 80
        : 120;
  const left = 48;
  const right = 48;
  const top = byRole ? 58 : 100;
  const rowSpace = (byRole ? 12 : 48) * spacing;
  const bottom = byRole ? 18 : 48;
  function stageNodeHeight(node) {
    return byRole
      ? data.detail === "contextual" && (node.sub || node.eyebrow)
        ? 64
        : 54
      : nodeHeight;
  }
  const columnHeights = Object.values(columns).map(
    (column) =>
      column.reduce((sum, node) => sum + stageNodeHeight(node), 0) + (column.length - 1) * rowSpace,
  );
  width = Math.max(
    byRole || foldJourney ? 1232 : width,
    left +
      right +
      columnIds.length * nodeWidth +
      Math.max(0, columnIds.length - 1) * (data.__flowLayout ? 170 : 110),
  );
  const rowCount = Math.max(...Object.values(columns).map((column) => column.length));
  const spacingDelta = (spacing - 1) * (byRole ? 12 : 48) * Math.max(1, rowCount - 1);
  const contentHeight = top + bottom + Math.max(1, ...columnHeights);
  height = foldJourney
    ? contentHeight
    : Math.max((byRole ? 448 : height) + spacingDelta, contentHeight);
  const columnGap =
    columnIds.length > 1 ? (width - left - right - nodeWidth) / (columnIds.length - 1) : 0;
  columnIds.forEach(function (columnId, columnIndex) {
    const column = columns[columnId].toSorted((a, b) =>
      foldJourney ? journeyOrder.get(a.id) - journeyOrder.get(b.id) : a.y - b.y || a.x - b.x,
    );
    const available = height - top - bottom - nodeHeight;
    const rowGap = column.length > 1 ? available / (column.length - 1) : 0;
    const stageGap =
      column.length > 1
        ? Math.max(
            rowSpace,
            (height - top - bottom - column.reduce((sum, node) => sum + stageNodeHeight(node), 0)) /
              (column.length - 1),
          )
        : 0;
    let stageY = top;
    column.forEach(function (node, rowIndex) {
      node.w = nodeWidth;
      node.h = stageNodeHeight(node);
      node.x = columnIds.length > 1 ? left + columnIndex * columnGap : width / 2 - nodeWidth / 2;
      node.y = byRole
        ? stageY
        : foldJourney
          ? top + rowIndex * (nodeHeight + rowSpace)
          : column.length > 1
            ? top + rowIndex * rowGap
            : data.__flowLayout
              ? top
              : top + available / 2;
      stageY += node.h + stageGap;
    });
  });
  return {
    ...data,
    nodes,
    width,
    height,
    edges: edges.map((edge) => {
      const next = Object.assign({}, edge);
      ["via", "fromSide", "toSide", "fromSlot", "toSlot"].forEach((key) => {
        delete next[key];
      });
      const from = byId[edge.from];
      const to = byId[edge.to];
      if (
        foldJourney &&
        from.x === to.x &&
        nodes.some(
          (node) =>
            node.id !== from.id &&
            node.id !== to.id &&
            node.x === from.x &&
            node.y > Math.min(from.y, to.y) &&
            node.y < Math.max(from.y, to.y),
        )
      ) {
        const gutter = from.x + from.w + 28;
        next.fromSide = "right";
        next.toSide = "right";
        next.via = [
          { x: gutter, y: from.y + from.h / 2 },
          { x: gutter, y: to.y + to.h / 2 },
        ];
      }
      return next;
    }),
    __stageColumns: byRole
      ? columnIds.map((id, index) => ({
          label: stageOrder[id] ? stageOrder[id].label || stageOrder[id].id : "Other systems",
          x: left + index * columnGap,
          width: nodeWidth,
        }))
      : [],
    groups: kdfArchitectureFitGroups(data.groups || [], nodes, width, height),
  };
}

function kdfArchitectureMainFlow(data, spacing = 1) {
  const edges = data.edges || [];
  const edgeById = Object.fromEntries(edges.map((edge, index) => [edge.id || String(index), edge]));
  const nodeIds = new Set();
  const edgeIds = new Set();
  const groupIds = new Set();
  (data.steps || []).forEach(function (step) {
    (step.nodes || []).forEach((id) => nodeIds.add(id));
    (step.groups || []).forEach((id) => groupIds.add(id));
    [...(step.edges || []), ...(step.fire || [])].forEach(function (id) {
      if (edgeById[id]) {
        edgeIds.add(id);
        nodeIds.add(edgeById[id].from);
        nodeIds.add(edgeById[id].to);
      }
    });
  });
  if (nodeIds.size < 2) {
    return kdfArchitectureStageLayout({ ...data, __flowLayout: true }, spacing);
  }
  const groups = data.groups || [];
  const groupById = Object.fromEntries(groups.map((group) => [group.id, group]));
  (data.nodes || []).forEach(function (node) {
    if (!nodeIds.has(node.id) || !node.group) {
      return;
    }
    let current = node.group;
    while (current && groupById[current]) {
      groupIds.add(current);
      current = groupById[current].parent;
    }
  });
  return kdfArchitectureStageLayout(
    {
      ...data,
      __flowLayout: true,
      nodes: (data.nodes || []).filter((node) => nodeIds.has(node.id)),
      edges: edges.filter((edge, index) => edgeIds.has(edge.id || String(index))),
      groups: groups.filter((group) => groupIds.has(group.id)),
    },
    spacing,
  );
}

function kdfArchitectureGroupView(data, spacing = 1) {
  const groups = data.groups || [];
  if (groups.length === 0) {
    return kdfArchitectureStageLayout(data, spacing);
  }
  const groupById = Object.fromEntries(groups.map((group) => [group.id, group]));
  // Summarize the groups that own systems, preserving useful domains inside
  // trust boundaries instead of collapsing an entire server into one box.
  function owningGroup(id) {
    return id;
  }
  const containerByNode = {};
  const memberCount = {};
  (data.nodes || []).forEach(function (node) {
    const container = node.group ? "group-" + owningGroup(node.group) : "node-" + node.id;
    containerByNode[node.id] = container;
    memberCount[container] = (memberCount[container] || 0) + 1;
  });
  const topGroups = groups.filter((group) => memberCount["group-" + group.id]);
  const groupTones = ["accent", "success", "violet", "warning"];
  const domainLegend = [];
  const nodes = topGroups.map(function (group, groupIndex) {
    const id = "group-" + group.id;
    const members = (data.nodes || [])
      .filter((node) => node.group === group.id)
      .map((node) => node.title || node.id);
    const domainKey = String.fromCharCode(65 + groupIndex);
    const legendText = (group.label || group.id) + ": " + members.join(" · ");
    if (members.length > 6 || legendText.length > 120) {
      throw new Error(
        'architecture domain overview: domain "' +
          group.id +
          '" key supports at most 6 systems and 120 characters',
      );
    }
    domainLegend.push({
      id: group.id,
      key: domainKey,
      label: legendText,
      tone: group.tone || groupTones[groupIndex % groupTones.length],
    });
    return {
      id,
      x: group.x + group.w / 2 - 90,
      y: group.y + group.h / 2 - 40,
      w: 180,
      h: 80,
      eyebrow: domainKey,
      title: group.label || group.id,
      group: group.id,
      sub: members.length + (members.length === 1 ? " system" : " systems"),
      tone: group.tone || groupTones[groupIndex % groupTones.length],
    };
  });
  (data.nodes || [])
    .filter((node) => !node.group)
    .forEach(function (node) {
      nodes.push({ ...node, id: "node-" + node.id });
    });
  const edges = [];
  const aggregateByKey = {};
  const aggregateByOriginal = {};
  (data.edges || []).forEach(function (edge, index) {
    const from = containerByNode[edge.from];
    const to = containerByNode[edge.to];
    if (!from || !to || from === to) {
      return;
    }
    const key = from + "->" + to + ":" + (edge.kind || "sync");
    let aggregate = aggregateByKey[key];
    if (!aggregate) {
      aggregate = {
        id: "group-edge-" + edges.length,
        from,
        to,
        kind: edge.kind,
        tone: edge.tone,
        labels: [],
      };
      aggregateByKey[key] = aggregate;
      edges.push(aggregate);
    }
    if (edge.label) {
      aggregate.labels.push(edge.label);
    }
    aggregateByOriginal[edge.id || String(index)] = aggregate.id;
  });
  edges.forEach(function (edge) {
    const labels = [...new Set(edge.labels)];
    edge.label = labels.join(" / ");
    delete edge.labels;
  });
  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }
  const steps = (data.steps || []).map(function (step) {
    return Object.assign({}, step, {
      nodes: unique([
        ...(step.nodes || []).map((id) => containerByNode[id]),
        ...(step.groups || []).flatMap((id) =>
          topGroups
            .filter((group) => {
              let current = group;
              while (current) {
                if (current.id === id) {
                  return true;
                }
                current = groupById[current.parent];
              }
              return false;
            })
            .map((group) => "group-" + group.id),
        ),
      ]),
      groups: [],
      edges: unique((step.edges || []).map((id) => aggregateByOriginal[id])),
      fire: unique((step.fire || []).map((id) => aggregateByOriginal[id])),
    });
  });
  if (nodes.length > 4) {
    throw new Error(
      "architecture domain overview: supports at most 4 domains; split the view into an explicit continuation",
    );
  }
  const columns = Math.max(1, nodes.length);
  const width = 1232;
  const height = 360 + 48 * (spacing - 1);
  const cardWidth = Math.min(250, (width - 48 - Math.max(0, columns - 1) * 56) / columns);
  const gap = columns > 1 ? (width - 48 - cardWidth * columns) / (columns - 1) : 0;
  nodes.forEach((node, index) => {
    node.x = columns === 1 ? (width - cardWidth) / 2 : 24 + index * (cardWidth + gap);
    node.y = 72;
    node.w = cardWidth;
    node.h = 170 + 48 * (spacing - 1);
  });
  return {
    ...data,
    width,
    height,
    groups: kdfArchitectureFitGroups(groups, nodes, width, height),
    nodes,
    edges: edges.map((edge) => Object.assign({}, edge, { route: "curve" })),
    steps,
    __domainLegend: domainLegend,
  };
}

function kdfValidateArchitectureLayoutSource(data) {
  const groups = data.groups || [];
  const groupIds = new Set();
  const groupById = {};
  groups.forEach(function (group) {
    if (!group.id || groupIds.has(group.id)) {
      throw new Error("architecture group ids must be unique");
    }
    groupIds.add(group.id);
    groupById[group.id] = group;
  });
  groups.forEach(function (group) {
    if (group.parent && !groupIds.has(group.parent)) {
      throw new Error("architecture group parent not found: " + group.parent);
    }
  });
  groups.forEach(function (group) {
    const ancestors = new Set();
    let current = group;
    while (current.parent) {
      if (ancestors.has(current.id)) {
        throw new Error("architecture group parent cycle: " + current.id);
      }
      ancestors.add(current.id);
      current = groupById[current.parent];
    }
  });
  if (!data.layout || data.layout === "free") {
    return;
  }
  const nodes = data.nodes || [];
  const edges = data.edges || [];
  const nodeIds = new Set();
  nodes.forEach(function (node) {
    if (!node.id || nodeIds.has(node.id)) {
      throw new Error("architecture node ids must be unique");
    }
    if (node.group && !groupIds.has(node.group)) {
      throw new Error("architecture node group not found: " + node.group);
    }
    nodeIds.add(node.id);
  });
  const edgeIds = new Set();
  edges.forEach(function (edge, index) {
    const edgeId = edge.id || String(index);
    if (edgeIds.has(edgeId)) {
      throw new Error("architecture edge ids must be unique: " + edgeId);
    }
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      throw new Error("architecture edge endpoint not found: " + (edge.from || edge.to));
    }
    edgeIds.add(edgeId);
  });
  const steppedEdges = new Set();
  (data.steps || []).forEach(function (step, stepIndex) {
    const stepName = step.title || stepIndex + 1;
    (step.nodes || []).forEach(function (id) {
      if (!nodeIds.has(id)) {
        throw new Error(
          'architecture step "' + stepName + '" references unknown node "' + id + '"',
        );
      }
    });
    (step.groups || []).forEach(function (id) {
      if (!groupIds.has(id)) {
        throw new Error(
          'architecture step "' + stepName + '" references unknown group "' + id + '"',
        );
      }
    });
    (step.edges || []).forEach(function (id) {
      if (!edgeIds.has(id)) {
        throw new Error(
          'architecture step "' + stepName + '" references unknown edge "' + id + '"',
        );
      }
      steppedEdges.add(id);
    });
    (step.fire || []).forEach(function (id) {
      if (!edgeIds.has(id)) {
        throw new Error('architecture step "' + stepName + '" fires unknown edge "' + id + '"');
      }
    });
  });
  if ((data.steps || []).length > 0) {
    edges.forEach(function (edge, index) {
      const edgeId = edge.id || String(index);
      if (edge.label && !steppedEdges.has(edgeId)) {
        throw new Error(
          'architecture edge "' + edgeId + '" has a label but is not referenced by any step.edges',
        );
      }
    });
  }
}

function kdfArchitectureLayout(data, spacing = 1) {
  const layout = data.layout || "free";
  if (layout === "stages") {
    return kdfArchitectureStageLayout(data, spacing);
  }
  if (layout === "main-flow") {
    return kdfArchitectureMainFlow(data, spacing);
  }
  if (layout === "groups") {
    return kdfArchitectureGroupView(data, spacing);
  }
  return data;
}

function renderArchitecture(sel, data) {
  // Preset is sugar: explicit groups/nodes/edges always win and the preset
  // Is skipped entirely (not merged) so authoring never has to reconcile
  // The two — dies gracefully rather than erroring.
  const hasExplicitShape =
    data &&
    ((data.groups && data.groups.length) ||
      (data.nodes && data.nodes.length) ||
      (data.edges && data.edges.length));
  if (data && data.preset === "operating-model" && !hasExplicitShape) {
    return kdfRenderOperatingModel(sel, {
      ...data,
      __capRenderer: "renderArchitecture",
    });
  }
  kdfValidateArchitectureLayoutSource(data);
  const laidOut = kdfArchitectureLayout(data, globalThis.ExplainerKit.contentSpacing());
  const host = kitMount(sel);
  kitValidateTextCaps(host, "renderArchitecture", data);
  host.classList.add("kdf-architecture");
  const layout = data.layout || "free";
  host.__kitCanvasAuthored = data.canvasEdits || { version: 1, layouts: {} };
  const edits = host.__kitCanvasEdits || data.canvasEdits || { version: 1, layouts: {} };
  const saved = edits.version === 1 && edits.layouts ? edits.layouts[layout] : null;
  const width = laidOut.width || 1200;
  const height = laidOut.height || 560;
  const baseNodes = (laidOut.nodes || []).map((node) => Object.assign({}, node));
  const identity = (node) => [node.title || node.id, node.group || "", node.kind || ""].join("|");
  let skipped = 0;
  const nodes = baseNodes.map((node) => {
    const change = saved && saved.nodes && saved.nodes[node.id];
    if (!change) {
      return node;
    }
    if (
      change.identity !== identity(node) ||
      !["x", "y", "w", "h"].every((key) => Number.isFinite(change[key]))
    ) {
      skipped++;
      return node;
    }
    const w = Math.max(60, Math.min(width - 16, change.w * width));
    const h = Math.max(36, Math.min(height - 16, change.h * height));
    return Object.assign({}, node, {
      x: Math.max(8, Math.min(width - w - 8, change.x * width)),
      y: Math.max(8, Math.min(height - h - 8, change.y * height)),
      w,
      h,
    });
  });
  if (saved && saved.nodes) {
    skipped += Object.keys(saved.nodes).filter(
      (id) => !baseNodes.some((node) => node.id === id),
    ).length;
  }
  host.__kitCanvasEdits = edits;
  host.__kitCanvas = {
    layout,
    width,
    height,
    nodes,
    baseNodes,
    identity,
    skipped,
    apply(next) {
      const at = host.__kitPresentHolder ? host.__kitPresentHolder.current() : 0;
      host.__kitCanvasEdits = next;
      const result = renderArchitecture(host, data);
      result.go(at);
      host.dispatchEvent(new CustomEvent("kitcanvasrender", { bubbles: true }));
    },
  };
  const driver = renderDataFlow(host, {
    ...laidOut,
    nodes,
    groups: saved
      ? kdfArchitectureFitGroups(laidOut.groups || [], nodes, width, height)
      : laidOut.groups,
    __architectureBase: data,
    __architectureComponent: true,
    __skipTextCaps: true,
  });
  if (!data.layout || data.layout === "free") {
    const notes = kitEl("div", "kdf-reference-notes");
    const inlineDetails = new Set(
      [...host.querySelectorAll(".kdf-roomy")].map((node) => node.dataset.node),
    );
    nodes
      .filter((node) => (node.eyebrow || node.sub) && !inlineDetails.has(node.id))
      .forEach((node) => {
        const note = kitEl("div", "kdf-reference-note");
        note.append(kitEl("strong", null, node.title));
        note.append(kitEl("p", null, [node.eyebrow, node.sub].filter(Boolean).join(" · ")));
        notes.append(note);
      });
    host.append(notes);
  }
  const stable = globalThis.ExplainerKit.stableDriver(host, driver);
  globalThis.ExplainerKit.observeContentSpacing(host, function () {
    const current = host.__kitPresentDriver ? host.__kitPresentDriver.current() : 0;
    renderArchitecture(host, data);
    if (host.__kitPresentDriver) {
      host.__kitPresentDriver.go(current);
    }
  });
  return stable;
}

/* ── sequence + erd — architecture family members ───────────────────────
   Same three properties architecture already has: a walkthrough panel
   ({count,go} contract, progress dots, step notes), a numbered legend
   (kdf-edge-marker + kdf-legend, hover cross-highlight), and the data-flow
   pulse animation (bright head + fading trail, ambient loop outside a
   walkthrough step, reduced-motion -> static). Reuse is direct: every pulse/
   legend/marker/motion primitive below (kdfMakePulse, kdfPulseFire,
   kdfPulseSetLive, kdfPulseHide, kdfEnsureMotionPreset, svgEl, MOTION/
   REDUCED_MOTION) is called as-is from data-flow.js, which is ALREADY
   top-level there (see that file's own header comment) — no extraction
   needed. The walkthrough-panel chrome and the linear ambient scheduler
   below (kdfBuildWalk, kdfAmbientCycle) are NEW shared helpers, not lifted
   out of renderDataFlow: its own copy is interleaved with edge/node wiring
   for a different data shape, and its ambient motion is a branching
   producer/consumer cascade (queue/topic fan-out) rather than the strict
   array-order walk sequence/erd both want — extracting either would touch
   tested, referee'd behavior in data-flow.js for no shared gain. Markup and
   CSS classes (kdf-walk/kdf-dots/kdf-legend/kdf-edge-marker/kdf-node/
   kdf-canvas…) match data-flow's exactly, so the visuals and behavior are
   identical either way. */

function kdfPctStr(value, total) {
  return `${(100 * value) / total}%`;
}
function kdfBoxRect(el, x, y, w, h, width, height) {
  el.style.left = kdfPctStr(x, width);
  el.style.top = kdfPctStr(y, height);
  el.style.width = kdfPctStr(w, width);
  el.style.height = kdfPctStr(h, height);
}

// Shared walkthrough panel: same markup/behavior as renderDataFlow's own
// (progress dots, annotation, Next/Reset controls, go()/count contract).
function kdfBuildWalk(host, steps, opts) {
  const walk = kitEl("div", "kdf-walk");
  const parent = opts.parent || host;
  if (steps.length === 0) {
    walk.hidden = true;
    walk.setAttribute("aria-hidden", "true");
  }
  const dots = kitEl("div", "kdf-dots");
  const annotation = kitEl("div", "kdf-annotation");
  annotation.setAttribute("aria-live", "polite");
  annotation.innerHTML = "<strong></strong><p></p>";
  const stepCount = opts.showStepCount ? kitEl("span", "kdf-step-count") : null;
  if (stepCount) {
    annotation.prepend(stepCount);
  }
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
  parent.append(walk);
  let current = 0;
  const dotEls = steps.map(function (step, index) {
    var dot = kitEl("button", "kdf-dot");
    dot.type = "button";
    dot.setAttribute("aria-label", "Show step " + (index + 1));
    dot.addEventListener("click", function () {
      go(index + 1);
    });
    dots.appendChild(dot);
    return dot;
  });
  function go(i) {
    current = Math.max(0, Math.min(i, steps.length));
    const step = current ? steps[current - 1] : null;
    dotEls.forEach((dot, index) => {
      dot.classList.toggle("active", index === current - 1);
      dot.classList.toggle("done", index < current - 1);
    });
    let title = step ? step.title || "Step " + current : opts.overviewTitle || "Walk →";
    title = String(title).replace(/^\d+\s*[·•-]\s*/, "");
    if (stepCount) {
      stepCount.textContent = current
        ? "Path " + current + " of " + steps.length
        : "Overview · " + steps.length + (steps.length === 1 ? " path" : " paths");
    }
    annotation.querySelector("strong").innerHTML = title;
    // Documented step field is `note`; `body` also accepted since sequence/
    // Erd steps are the same family as architecture's own `body` steps.
    const text = step ? (step.note != null ? step.note : step.body || "") : opts.overviewBody || "";
    annotation.querySelector("p").innerHTML = text;
    next.disabled = current >= steps.length;
    reset.disabled = current === 0;
    if (opts.onGo) {
      opts.onGo(current, step);
    }
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
  return {
    go,
    current() {
      return current;
    },
    dispose() {
      next.removeEventListener("click", advance);
      reset.removeEventListener("click", restart);
    },
  };
}

// Shared linear ambient scheduler: fire ids in array order, brief gap,
// Pause, repeat. Distinct from renderDataFlow's producer/consumer cascade
// (a branching graph simulation) — sequence/erd both want a strict,
// Author-order walk instead, so this is new code, not an extraction.
function kdfAmbientCycle(ids, fire, getGap, getPause) {
  const timers = [];
  let running = false;
  function track(fn, delay) {
    const t = setTimeout(function () {
      var i = timers.indexOf(t);
      if (i > -1) {
        timers.splice(i, 1);
      }
      fn();
    }, delay);
    timers.push(t);
    return t;
  }
  function step(i) {
    if (!running) {
      return;
    }
    if (i >= ids.length) {
      track(() => {
        step(0);
      }, getPause());
      return;
    }
    fire(ids[i], () => {
      track(function () {
        step(i + 1);
      }, getGap());
    });
  }
  return {
    start() {
      if (running || !ids.length) {
        return;
      }
      running = true;
      step(0);
    },
    stop() {
      running = false;
      timers.forEach((timer) => clearTimeout(timer));
      timers.length = 0;
    },
  };
}

// Fix 3 — the carry-over marker's text, shared by every family member that
// Can be continued: "↑ continued · 1-3" names the range the earlier parts
// Already covered, derived from numberFrom and never authored. A single
// Covered number reads as "1", not "1-1".
function kdfCarryLabel(numberFrom) {
  return `↑ continued · ${numberFrom > 2 ? "1-" + (numberFrom - 1) : String(numberFrom - 1)}`;
}

/* ── renderSequence ── who calls whom, in what order. Vertical lifelines,
   time flows down, messages are horizontal; see CONTRACTS.md#sequence. */
let kitSequenceSeq = 0;
function kseqAdjustedData(data, state) {
  const referenced = new Set();
  (data.walkthrough || []).forEach(function (step) {
    (step.fire || []).forEach(function (id) {
      referenced.add(String(id));
    });
  });
  let messages = (data.messages || []).slice();
  if (state.messages === "key" && messages.some((message) => message.key === true)) {
    messages = messages.filter(function (message, index) {
      const id = message.id != null ? String(message.id) : String(index);
      return message.key === true || referenced.has(id);
    });
  }
  return {
    ...data,
    layout: state.layout,
    messageMode: state.messages,
    messages,
    view: state.view,
    typeScale: state.typeScale,
  };
}

function kseqBriefing(host, data) {
  kitValidateTextCaps(host, "renderSequence", data);
  const TAG = "architecture sequence";
  const actors = data.actors || [];
  const messages = data.messages || [];
  const walkthrough = data.walkthrough || [];
  if (actors.length < 2 || actors.length > 6) {
    throw new Error(TAG + ": supports 2-6 actors (got " + actors.length + ")");
  }
  if (messages.length === 0 || messages.length > 10) {
    throw new Error(TAG + ": supports 1-10 messages (got " + messages.length + ")");
  }
  if (walkthrough.length > 6) {
    throw new Error(
      TAG + ": walkthrough supports at most 6 steps (got " + walkthrough.length + ")",
    );
  }
  const actorById = {};
  actors.forEach(function (actor) {
    if (!actor.id || actorById[actor.id]) {
      throw new Error(TAG + ": actor ids must be unique");
    }
    actorById[actor.id] = actor;
  });
  const seen = {};
  messages.forEach(function (message, index) {
    const id = message.id != null ? String(message.id) : String(index);
    if ((message.id != null && seen[id]) || !actorById[message.from] || !actorById[message.to]) {
      throw new Error(TAG + ': message "' + id + '" has duplicate id or unknown actor');
    }
    seen[id] = true;
    if (
      message.filter != null &&
      actorById[message.to].kind !== "queue" &&
      actorById[message.to].kind !== "topic"
    ) {
      throw new Error(TAG + ': message "' + id + '" filter requires a queue or topic target');
    }
  });

  host.classList.add("kdf", "kseq", "kseq-briefing");
  host.__kitBase = { kind: "sequence" };
  host.dataset.typeScale = data.typeScale || "standard";
  const roster = kitEl("div", "kseq-brief-roster");
  roster.append(kitEl("h3", "kseq-brief-heading", "Participants"));
  const actorList = kitEl("div", "kseq-brief-actors");
  actorList.setAttribute("role", "list");
  actorList.setAttribute("aria-label", "Participants");
  actors.forEach(function (actor) {
    const item = kitEl("div", "kseq-brief-actor-card");
    item.setAttribute("role", "listitem");
    const name = kitEl("strong");
    name.textContent = actor.label || actor.id;
    item.append(name);
    if (actor.sub) {
      const sub = kitEl("span");
      sub.textContent = actor.sub;
      item.append(sub);
    }
    item.dataset.kind = actor.kind || "service";
    actorList.append(item);
  });
  roster.append(actorList);
  host.append(roster, kitEl("h3", "kseq-brief-heading", "Message sequence"));
  const board = kitEl("div", "kseq-brief-board");
  board.setAttribute("role", "list");
  board.setAttribute("aria-label", data.ariaLabel || "Sequence message briefing");
  const rowById = {};
  messages.forEach(function (message, index) {
    const id = message.id != null ? String(message.id) : String(index);
    const kind = message.kind === "async" ? "async" : message.kind === "return" ? "return" : "sync";
    const row = kitEl("article", "kseq-brief-row kseq-brief-" + kind);
    row.dataset.message = id;
    row.setAttribute("role", "listitem");
    const number = kitEl("span", "kseq-brief-num");
    number.textContent = String((data.numberFrom || 1) + index).padStart(2, "0");
    const route = kitEl("div", "kseq-brief-route");
    const from = kitEl("span", "kseq-brief-actor");
    from.textContent = actorById[message.from].label || message.from;
    const arrow = kitEl("span", "kseq-brief-arrow");
    arrow.textContent = message.from === message.to ? "↻" : kind === "return" ? "⇢" : "→";
    arrow.setAttribute("aria-hidden", "true");
    const to = kitEl("span", "kseq-brief-actor");
    to.textContent = actorById[message.to].label || message.to;
    route.append(from, arrow, to);
    const copy = kitEl("div", "kseq-brief-copy");
    const label = kitEl("strong");
    label.textContent = message.label || id;
    const meta = kitEl("span", "kseq-brief-meta");
    meta.textContent = kind + (message.filter ? " · filter " + message.filter : "");
    copy.append(label, meta);
    [message.when, message.timing, message.note].filter(Boolean).forEach(function (value) {
      const note = kitEl("span", "kseq-brief-note");
      note.textContent = String(value);
      copy.append(note);
    });
    row.append(number, route, copy);
    board.append(row);
    rowById[id] = row;
  });
  host.append(board);
  function onGo(_current, step) {
    const active = new Set((step && step.fire ? step.fire : []).map(String));
    Object.keys(rowById).forEach(function (id) {
      rowById[id].classList.toggle("active", Boolean(step) && active.has(id));
      rowById[id].classList.toggle("dim", Boolean(step) && !active.has(id));
    });
  }
  const walkApi = kdfBuildWalk(host, walkthrough, {
    overviewTitle: (data.overview && data.overview.title) || "Read the whole exchange",
    overviewBody:
      (data.overview && (data.overview.note || data.overview.body)) ||
      "Messages remain in authored time order from sender to receiver.",
    onGo,
  });
  host.__kitDispose = () => walkApi.dispose();
  walkApi.go(0);
  return { count: walkthrough.length + 1, current: walkApi.current, go: walkApi.go };
}

function kseqParts(host, data) {
  kitMount(host);
  host.classList.add("kdf", "kseq", "kseq-parts");
  host.dataset.typeScale = data.typeScale || "standard";
  host.dataset.view = "parts";
  const allActors = data.actors || [];
  const messages = data.messages || [];
  // Three messages make a legible presentation scene and avoid the common
  // four-plus-one split that left the final exchange stranded on its own.
  const chunkSize = 3;
  const parts = [];
  for (let start = 0; start < messages.length; start += chunkSize) {
    const partMessages = messages.slice(start, start + chunkSize);
    const ids = new Set(
      partMessages.map(function (message, index) {
        return message.id != null ? String(message.id) : String(start + index);
      }),
    );
    const actorIds = new Set();
    partMessages.forEach(function (message) {
      actorIds.add(message.from);
      actorIds.add(message.to);
    });
    if (actorIds.size < 2) {
      const fallback = allActors.find((actor) => !actorIds.has(actor.id));
      if (fallback) {
        actorIds.add(fallback.id);
      }
    }
    const steps = (data.walkthrough || [])
      .filter(function (step, stepIndex) {
        const fire = step.fire || [];
        return (
          fire.some((id) => ids.has(String(id))) ||
          (fire.length === 0 && start === 0 && stepIndex === 0)
        );
      })
      .map(function (step) {
        return Object.assign({}, step, {
          fire: (step.fire || []).filter((id) => ids.has(String(id))),
        });
      });
    parts.push({
      ...data,
      __kitSequenceInner: true,
      __kitSequenceScene: true,
      actors: allActors.filter((actor) => actorIds.has(actor.id)),
      messages: partMessages,
      numberFrom: (data.numberFrom || 1) + start,
      overview: {
        title: `Part ${parts.length + 1} of ${Math.ceil(messages.length / chunkSize)}`,
        note:
          (data.overview &&
            (data.overview.note != null ? data.overview.note : data.overview.body)) ||
          "Messages continue in the next part.",
      },
      walkthrough: steps,
    });
  }

  const inner = kitEl("div", "kseq-part-stage");
  const pager = kitEl("div", "kseq-part-picker");
  pager.setAttribute("aria-label", "Sequence parts");
  host.append(inner, pager);
  const counts = parts.map((part) => (part.walkthrough || []).length + 1);
  const total = counts.reduce((sum, count) => sum + count, 0);
  let current = 0;
  let activePart = -1;
  let innerDriver = null;
  const buttons = parts.map(function (_part, index) {
    const button = kitEl("button", "kseq-part-button", String(index + 1));
    button.type = "button";
    button.setAttribute("aria-label", `Show sequence part ${index + 1}`);
    button.addEventListener("click", function () {
      const offset = counts.slice(0, index).reduce((sum, count) => sum + count, 0);
      go(offset);
    });
    pager.append(button);
    return button;
  });
  function renderPart(index) {
    if (index === activePart) {
      return;
    }
    activePart = index;
    innerDriver = kseqRenderOne(inner, parts[index]);
    buttons.forEach((button, buttonIndex) => {
      button.classList.toggle("active", buttonIndex === index);
      button.setAttribute("aria-current", buttonIndex === index ? "true" : "false");
    });
  }
  function go(index) {
    current = Math.max(0, Math.min(index, total - 1));
    let partIndex = 0;
    let offset = 0;
    while (partIndex < counts.length - 1 && current >= offset + counts[partIndex]) {
      offset += counts[partIndex];
      partIndex++;
    }
    renderPart(partIndex);
    if (innerDriver && innerDriver.go) {
      innerDriver.go(current - offset);
    }
  }
  host.__kitDispose = function __kitDispose() {
    if (inner.__kitDispose) {
      inner.__kitDispose();
    }
  };
  go(0);
  return { count: Math.max(1, total), current: () => current, go };
}

function renderSequence(sel, data) {
  const walkthrough = data.walkthrough || [];
  if (walkthrough.length) {
    const messageIds = new Set(
      (data.messages || []).map((message, index) => String(message.id ?? index)),
    );
    const covered = new Set();
    walkthrough.forEach((step, index) => {
      (step.fire || []).forEach((value) => {
        const id = String(value);
        if (!messageIds.has(id)) {
          throw new Error(
            `architecture sequence: walkthrough step ${index + 1} fires unknown message "${id}"`,
          );
        }
        covered.add(id);
      });
    });
    const missing = [...messageIds].filter((id) => !covered.has(id));
    if (missing.length) {
      throw new Error(
        `architecture sequence: walkthrough omits messages ${missing.join(", ")}; include every message in a step.fire list`,
      );
    }
  }
  const host = kitMount(sel);
  host.classList.remove("kseq-briefing", "kseq-compact", "kseq-parts");
  if (!data.__kitAdjusted && !data.__kitSequenceInner) {
    const options = [
      {
        choices: ["exchange", "briefing"],
        choiceLabels: { exchange: "Whole exchange", briefing: "Message briefing" },
        key: "layout",
        label: "Layout",
        primary: true,
        type: "choice",
      },
    ];
    if ((data.messages || []).length > 4) {
      options.push({
        choices: ["full", "parts"],
        choiceLabels: { full: "Whole exchange", parts: "Guided scenes" },
        key: "view",
        label: "Composition",
        primary: true,
        type: "choice",
      });
    }
    options.push({
      choices: ["standard", "large"],
      choiceLabels: { standard: "Normal", large: "Large" },
      key: "typeScale",
      label: "Text size",
      type: "choice",
    });
    const adjustment = globalThis.ExplainerKit.registerAdjustments(host, {
      base: data,
      defaults: {
        layout: data.layout || "exchange",
        messages: data.messageMode || "all",
        typeScale: data.typeScale || "standard",
        view: data.view || "full",
      },
      label: data.ariaLabel || "Sequence diagram",
      options,
      apply(state) {
        const viewOption = host.__kitAdjustments.entry.options.find(
          (option) => option.key === "view",
        );
        if (viewOption) {
          viewOption.hidden = state.layout === "briefing";
        }
        const current = host.__kitPresentDriver ? host.__kitPresentDriver.current() : 0;
        const driver = renderSequence(host, {
          ...kseqAdjustedData(host.__kitAdjustments.base, state),
          __kitAdjusted: true,
        });
        driver.go(current);
        return driver;
      },
    });
    const viewOption = adjustment.entry.options.find((option) => option.key === "view");
    if (viewOption) {
      viewOption.hidden = adjustment.state.layout === "briefing";
    }
    data = kseqAdjustedData(adjustment.base, adjustment.state);
  }
  host.dataset.typeScale = data.typeScale || "standard";
  host.dataset.layout = data.layout || "exchange";
  host.dataset.view = data.view || "full";
  const driver =
    data.layout === "briefing"
      ? kseqBriefing(host, data)
      : data.view === "parts" && data.messages.length > 4
        ? kseqParts(host, data)
        : kseqRenderOne(host, { ...data, __kitSequenceInner: true });
  const stable = globalThis.ExplainerKit.stableDriver(host, driver);
  globalThis.ExplainerKit.observeContentSpacing(host, function () {
    const current = host.__kitPresentDriver ? host.__kitPresentDriver.current() : 0;
    renderSequence(host, data);
    if (host.__kitPresentDriver) {
      host.__kitPresentDriver.go(current);
    }
  });
  return stable;
}

function kseqRenderOne(sel, data) {
  const host = kitMount(sel);
  kitValidateTextCaps(host, "renderSequence", data);
  const TAG = "architecture sequence";
  let motionPreset = kdfEnsureMotionPreset();
  const actors = data.actors || [];
  const messages = data.messages || [];
  const walkthrough = data.walkthrough || [];

  if (actors.length < 2 || actors.length > 6) {
    throw new Error(TAG + ": supports 2-6 actors (got " + actors.length + ")");
  }
  if (messages.length === 0 || messages.length > 10) {
    throw new Error(TAG + ": supports 1-10 messages (got " + messages.length + ")");
  }
  if (walkthrough.length > 6) {
    throw new Error(
      TAG + ": walkthrough supports at most 6 steps (got " + walkthrough.length + ")",
    );
  }
  // A story split across slides keeps one numbering: the continuation passes
  // NumberFrom so its legend/markers don't restart at 1 (see the 'continues'
  // Manifest field in base/present.js).
  const numberFrom = data.numberFrom == null ? 1 : data.numberFrom;
  if (typeof numberFrom !== "number" || numberFrom < 1 || Math.floor(numberFrom) !== numberFrom) {
    throw new Error(TAG + ": numberFrom must be a positive integer (got " + data.numberFrom + ")");
  }

  const actorById = {},
    actorIndex = {};
  actors.forEach((a, i) => {
    if (!a.id || actorById[a.id]) {
      throw new Error(TAG + ": actor ids must be unique");
    }
    if ((a.label && a.label.includes("·")) || (a.sub && a.sub.includes("·"))) {
      throw new Error(TAG + ': actor "' + a.id + '" must not use · lists in fixed cards');
    }
    actorById[a.id] = a;
    actorIndex[a.id] = i;
  });
  const msgIdSeen = {};
  messages.forEach((m, idx) => {
    var mid = m.id != null ? String(m.id) : String(idx);
    if (m.id != null) {
      if (msgIdSeen[mid]) {
        throw new Error(TAG + ': message ids must be unique (got "' + mid + '" twice)');
      }
      msgIdSeen[mid] = true;
    }
    if (!actorById[m.from]) {
      throw new Error(TAG + ': message "' + mid + '" references unknown actor "' + m.from + '"');
    }
    if (!actorById[m.to]) {
      throw new Error(TAG + ': message "' + mid + '" references unknown actor "' + m.to + '"');
    }
    if (m.filter != null) {
      var targetKind = actorById[m.to].kind;
      if (targetKind !== "queue" && targetKind !== "topic") {
        throw new Error(
          TAG +
            ': message "' +
            mid +
            '" filter requires the target actor to be kind queue or topic (actor "' +
            m.to +
            '" is "' +
            (targetKind || "service") +
            '")',
        );
      }
    }
  });

  // NumberFrom > 1 IS the continuation signal: this part carries on someone
  // Else's numbering, so the lifelines run up to the canvas top edge and
  // Fade while the actor headers read as a recap.
  const continued = numberFrom > 1;

  // ── layout ──
  const spacing = globalThis.ExplainerKit.contentSpacing();
  const compact = messages.length >= 5 && messages.length <= 6;
  const ACTOR_W = 240,
    ACTOR_H = 88,
    MARGIN_X = 90;
  let COL_GAP = compact ? 330 : 260;
  if (data.__kitSequenceScene) {
    // Keep the same canvas width as each scene changes its actor subset.
    COL_GAP = 680 / Math.max(1, actors.length - 1);
  }
  const width = MARGIN_X * 2 + (actors.length - 1) * COL_GAP + ACTOR_W;
  // A continued part opens a band above the actor cards for the arriving
  // Lifelines and the marker. Column geometry (centerX) is untouched — the
  // Parts must land on the same pixels, which is horizontal, not vertical.
  const CARRY_BAND = 34 * spacing;
  const HEAD_TOP = continued ? 30 * spacing + CARRY_BAND : 30 * spacing,
    HEAD_BOTTOM = HEAD_TOP + ACTOR_H;
  let ROW_H = compact ? 58 : 78;
  if (data.__kitSequenceScene) {
    ROW_H = 100;
  }
  ROW_H = 40 + (ROW_H - 40) * spacing;
  const ROW_TOP = HEAD_BOTTOM + (compact ? 38 : 46) * spacing,
    BOTTOM_PAD = (compact ? 32 : 44) * spacing;
  const lifelineBottom = ROW_TOP + messages.length * ROW_H;
  const height = data.__kitSequenceScene
    ? 530 + (spacing - 1) * (34 + 30 + 46 + 44 + 3 * 60)
    : lifelineBottom + BOTTOM_PAD;
  function centerX(i) {
    return MARGIN_X + ACTOR_W / 2 + i * COL_GAP;
  }
  function rowY(i) {
    return ROW_TOP + i * ROW_H + ROW_H / 2;
  }

  host.classList.add("kdf", "kseq");
  if (compact) {
    host.classList.add("kseq-compact");
  }
  host.__kitBase = { kind: "sequence" };
  host.dataset.motionPreset = motionPreset;
  host.dataset.zoom = "";

  const canvas = kitEl("div", "kdf-canvas kseq-canvas");
  canvas.style.aspectRatio = `${width} / ${height}`;
  canvas.style.setProperty("--kdf-floor", `${Math.min(width, 1400)}px`);
  canvas.setAttribute("role", "img");
  canvas.setAttribute(
    "aria-label",
    data.ariaLabel || `Sequence diagram across ${actors.length} actors`,
  );

  const svg = svgEl(
    "svg",
    {
      class: "kdf-wires kseq-wires",
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
      class: "kdf-labels kseq-labels",
      viewBox: "0 0 " + width + " " + height,
      preserveAspectRatio: "none",
      "aria-hidden": "true",
    },
    canvas,
  );

  const uid = "kseq-" + ++kitSequenceSeq;
  const solidMarker = svgEl(
    "marker",
    {
      id: uid + "-solid",
      markerWidth: "14",
      markerHeight: "14",
      refX: "12",
      refY: "7",
      orient: "auto",
      markerUnits: "userSpaceOnUse",
    },
    defs,
  );
  svgEl("path", { class: "kdf-arrow-head neutral", d: "M0,0 L14,7 L0,14 Z" }, solidMarker);
  const openMarker = svgEl(
    "marker",
    {
      id: uid + "-open",
      markerWidth: "14",
      markerHeight: "14",
      refX: "11",
      refY: "7",
      orient: "auto",
      markerUnits: "userSpaceOnUse",
    },
    defs,
  );
  svgEl("path", { class: "kseq-arrow-open", d: "M1,1 L11,7 L1,13" }, openMarker);
  const openMutedMarker = svgEl(
    "marker",
    {
      id: uid + "-open-muted",
      markerWidth: "14",
      markerHeight: "14",
      refX: "11",
      refY: "7",
      orient: "auto",
      markerUnits: "userSpaceOnUse",
    },
    defs,
  );
  svgEl("path", { class: "kseq-arrow-open muted", d: "M1,1 L11,7 L1,13" }, openMutedMarker);

  // Actor headers reuse the kdf node-card look, eyebrow-less. queue/topic
  // Reuse the exact slats glyph + pill radius from data-flow verbatim;
  // Actor/store get a small new glyph, namespaced kseq-*.
  const PERSON_GLYPH =
    '<svg class="kseq-glyph" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="4.6" r="3"/><path d="M2 15c0-3.6 2.8-6 6-6s6 2.4 6 6"/></svg>';
  const STORE_GLYPH =
    '<svg class="kseq-glyph" viewBox="0 0 16 16" aria-hidden="true"><ellipse cx="8" cy="3.4" rx="6" ry="2.2"/><path d="M2 3.4v9.2c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2V3.4"/><path d="M2 7.6c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2"/></svg>';
  const actorEls = {};
  actors.forEach((a, i) => {
    var kind =
      a.kind === "actor" || a.kind === "queue" || a.kind === "topic" || a.kind === "store"
        ? a.kind
        : "service";
    var glyphClass =
      kind === "queue"
        ? " queue"
        : kind === "topic"
          ? " topic"
          : kind === "actor"
            ? " kseq-actor-person"
            : kind === "store"
              ? " kseq-actor-store"
              : "";
    var el = kitEl(
      "div",
      "kdf-node kseq-actor " +
        (a.tone || "neutral") +
        glyphClass +
        (continued ? " kseq-recap" : ""),
    );
    el.dataset.actor = a.id;
    kdfBoxRect(el, centerX(i) - ACTOR_W / 2, HEAD_TOP, ACTOR_W, ACTOR_H, width, height);
    var glyphHtml =
      kind === "queue" || kind === "topic"
        ? '<i class="kdf-slats" aria-hidden="true"><b></b><b></b><b></b></i>'
        : kind === "actor"
          ? PERSON_GLYPH
          : kind === "store"
            ? STORE_GLYPH
            : "";
    el.innerHTML =
      glyphHtml +
      "<strong>" +
      (a.label || a.id) +
      "</strong>" +
      (a.sub ? "<small>" + a.sub + "</small>" : "");
    canvas.appendChild(el);
    actorEls[a.id] = el;
  });

  // Lifelines — thin dashed verticals descending from each header. In a
  // Continued part they start at the canvas TOP EDGE instead, fading in over
  // The carry band, so the flow visibly arrives from off-screen above rather
  // Than beginning here. The fade is a gradient on the stroke; the gradient
  // Id is per-instance, so the reference has to be inline (a stylesheet
  // Cannot know this uid).
  let carryGrad = null;
  if (continued) {
    carryGrad = svgEl(
      "linearGradient",
      {
        gradientUnits: "userSpaceOnUse",
        id: uid + "-carry",
        x1: "0",
        x2: "0",
        y1: "0",
        y2: String(HEAD_TOP),
      },
      defs,
    );
    svgEl("stop", { class: "kseq-carry-stop", offset: "0", "stop-opacity": "0" }, carryGrad);
    svgEl("stop", { class: "kseq-carry-stop", offset: "1", "stop-opacity": "1" }, carryGrad);
  }
  actors.forEach((a, i) => {
    var top = continued ? 0 : HEAD_BOTTOM;
    var line = svgEl(
      "path",
      {
        class: "kseq-lifeline" + (continued ? " kseq-carry" : ""),
        d: "M" + centerX(i) + " " + top + " L" + centerX(i) + " " + lifelineBottom,
      },
      svg,
    );
    if (carryGrad) {
      line.style.stroke = "url(#" + carryGrad.id + ")";
    }
  });
  // Messages, activations, pulses, numbered markers — numbered strictly in
  // Array order (time order IS reading order; no spatial re-sort).
  const pulseLayer = document.createElementNS(kdfNS, "g");
  pulseLayer.setAttribute("class", "kdf-pulse-layer");
  pulseLayer.setAttribute("aria-hidden", "true");
  const msgById = {},
    msgEls = {},
    markerEls = {},
    activationEls = {},
    pulseByMsg = {};
  const legendItems = [];
  messages.forEach((m, idx) => {
    var mid = m.id != null ? String(m.id) : String(idx);
    msgById[mid] = m;
    var kind = m.kind === "async" ? "async" : m.kind === "return" ? "return" : "sync";
    var y = rowY(idx);
    var xFrom = centerX(actorIndex[m.from]);
    var xTo = centerX(actorIndex[m.to]);
    var isSelf = m.from === m.to;
    var loopW = 62,
      loopH = Math.min(ROW_H - 26, data.__kitSequenceScene ? 32 : 52);
    var d, startPoint, receiverX;
    if (isSelf) {
      d =
        "M" +
        xFrom +
        " " +
        y +
        " C " +
        (xFrom + loopW) +
        " " +
        y +
        " " +
        (xFrom + loopW) +
        " " +
        (y + loopH) +
        " " +
        xFrom +
        " " +
        (y + loopH);
      startPoint = { x: xFrom, y };
      receiverX = xFrom;
    } else {
      d = "M" + xFrom + " " + y + " L" + xTo + " " + y;
      startPoint = { x: xFrom, y };
      receiverX = xTo;
    }
    var markerId =
      kind === "sync" ? uid + "-solid" : kind === "return" ? uid + "-open-muted" : uid + "-open";
    var extraClass =
      kind === "async" ? " async" : kind === "return" ? " dashed kseq-msg-return" : "";
    var group = svgEl(
      "g",
      { class: "kdf-edge kseq-msg" + extraClass, "data-edge": mid, "data-kind": kind },
      svg,
    );
    var pathEl = svgEl(
      "path",
      { d, class: "kdf-edge-path", "marker-end": "url(#" + markerId + ")" },
      group,
    );
    var pulse = kdfMakePulse(pulseLayer, "neutral", d, pathEl.getTotalLength(), mid, function () {
      return motionPreset;
    });
    pulseByMsg[mid] = pulse;
    msgEls[mid] = group;

    // Activation — a slim rounded bar on the receiver's lifeline at this row.
    var actEl = svgEl(
      "rect",
      {
        class: "kseq-activation",
        x: receiverX - 4,
        y: y - 16,
        width: 8,
        height: Math.min(ROW_H - 20, loopH + 20),
        rx: 4,
      },
      labelSvg,
    );
    activationEls[mid] = actEl;

    // Numbered marker at the arrow's start.
    var marker = svgEl(
      "g",
      {
        class: "kdf-edge-marker",
        "data-edge-marker": mid,
        transform: "translate(" + startPoint.x + "," + startPoint.y + ")",
      },
      labelSvg,
    );
    svgEl("circle", { r: 13, class: "kdf-edge-marker-ring" }, marker);
    svgEl(
      "text",
      { class: "kdf-edge-marker-num", "text-anchor": "middle", "dominant-baseline": "central" },
      marker,
    ).textContent = String(numberFrom + idx);
    markerEls[mid] = marker;
    legendItems.push({ id: mid, num: numberFrom + idx, label: m.label || mid });
    if (data.__kitSequenceInner) {
      svgEl(
        "text",
        {
          class: "kseq-message-label",
          x: isSelf ? xFrom + 18 : (xFrom + xTo) / 2,
          y: y - (m.filter ? 38 : 18),
          "text-anchor": isSelf ? "start" : "middle",
        },
        group,
      ).textContent = numberFrom + idx + " · " + (m.label || mid);
    }

    // Filter glyph — reuses data-flow's funnel + mono microtype verbatim.
    if (m.filter) {
      var fmx = isSelf ? xFrom + loopW / 2 : (xFrom + xTo) / 2;
      var filterG = svgEl(
        "g",
        { class: "kdf-filter", transform: "translate(" + fmx + "," + (y - 13) + ")" },
        labelSvg,
      );
      svgEl("path", { class: "kdf-filter-glyph", d: "M-6 -4 L6 -4 L2 5 L-2 5 Z" }, filterG);
      svgEl("text", { class: "kdf-filter-text", x: 9, y: 4 }, filterG).textContent = m.filter;
    }
  });
  svg.append(pulseLayer);
  host.append(canvas);

  // Legend — same kdf-legend markup/roles, hover cross-highlight.
  let legend = null;
  const legendItemEls = {};
  if (legendItems.length > 0) {
    legend = kitEl("div", "kdf-legend");
    legend.setAttribute("role", "list");
    legendItems.forEach((item) => {
      var li = kitEl("div", "kdf-legend-item");
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
  const hoverHandlers = [];
  function highlightMsg(mid, on) {
    if (msgEls[mid]) {
      msgEls[mid].classList.toggle("hover", on);
    }
    if (markerEls[mid]) {
      markerEls[mid].classList.toggle("hover", on);
    }
    if (legendItemEls[mid]) {
      legendItemEls[mid].classList.toggle("hover", on);
    }
  }
  if (legend) {
    legendItems.forEach((item) => {
      var li = legendItemEls[item.id];
      var enter = function () {
        highlightMsg(item.id, true);
      };
      var leave = function () {
        highlightMsg(item.id, false);
      };
      li.addEventListener("mouseenter", enter);
      li.addEventListener("mouseleave", leave);
      hoverHandlers.push({ li, enter, leave });
    });
  }

  // Ambient loop: messages pulse in array order, brief pause, repeat. A
  // Filtered message thins its own turn — mirrors kdfFilterAllows's cadence
  // (data-flow.js's producer/consumer filter) in miniature: fire, skip 1,
  // Fire, skip 2, repeat. Reimplemented rather than extracted since
  // Data-flow's version reads its own edgeMeta/filterSkip closures directly.
  const filterState = {};
  function allowsThisBeat(mid, hasFilter) {
    if (!hasFilter) {
      return true;
    }
    const st = filterState[mid] || (filterState[mid] = { fired: 0, skip: 0 });
    if (st.skip > 0) {
      st.skip--;
      return false;
    }
    st.fired++;
    st.skip = st.fired % 2 === 0 ? 2 : 1;
    return true;
  }
  function fireMessage(mid, onDone) {
    const m = msgById[mid];
    if (!allowsThisBeat(mid, Boolean(m && m.filter))) {
      onDone();
      return;
    }
    const pulse = pulseByMsg[mid];
    if (!pulse) {
      onDone();
      return;
    }
    activationEls[mid].classList.add("on");
    kdfPulseFire(pulse, () => {
      activationEls[mid].classList.remove("on");
      onDone();
    });
  }
  const messageIds = messages.map(function (m, idx) {
    return m.id != null ? String(m.id) : String(idx);
  });
  const ambient = kdfAmbientCycle(
    messageIds,
    fireMessage,
    function () {
      return motionPreset === "calm" ? 460 : 280;
    },
    function () {
      return motionPreset === "calm" ? 1500 : 900;
    },
  );

  // Walkthrough: fired messages + their actors highlight; the rest dim.
  function applyStep(step) {
    const fireIds = step ? step.fire || [] : [];
    const touched = {};
    fireIds.forEach((mid) => {
      var m = msgById[mid];
      if (m) {
        touched[m.from] = true;
        touched[m.to] = true;
      }
    });
    canvas.classList.toggle("walking", Boolean(step));
    Object.keys(actorEls).forEach((aid) => {
      actorEls[aid].classList.toggle("active", Boolean(step) && Boolean(touched[aid]));
    });
    Object.keys(msgEls).forEach((mid) => {
      msgEls[mid].classList.toggle("active", step ? fireIds.includes(mid) : false);
    });
    Object.keys(markerEls).forEach((mid) => {
      markerEls[mid].classList.toggle("active", step ? fireIds.includes(mid) : false);
    });
    if (legend) {
      Object.keys(legendItemEls).forEach((mid) => {
        var active = step ? fireIds.includes(mid) : false;
        legendItemEls[mid].classList.toggle("active", active);
        legendItemEls[mid].classList.toggle("dim", Boolean(step) && !active);
      });
    }
  }
  function onWalkGo(current, step) {
    applyStep(step);
    ambient.stop();
    if (!step) {
      if (motionPreset !== "off" && MOTION) {
        ambient.start();
      }
    } else if (step.fire) {
      step.fire.forEach((mid) => {
        if (pulseByMsg[mid]) {
          activationEls[mid].classList.add("on");
          kdfPulseFire(pulseByMsg[mid], function () {
            activationEls[mid].classList.remove("on");
          });
        } else {
          console.warn(
            '[architecture] sequence step "' +
              (step.title || current) +
              '" fires unknown message "' +
              mid +
              '"',
          );
        }
      });
    }
  }
  const walkApi = kdfBuildWalk(host, walkthrough, {
    overviewTitle: (data.overview && data.overview.title) || "Watch the sequence →",
    overviewBody:
      (data.overview && (data.overview.note != null ? data.overview.note : data.overview.body)) ||
      "Messages travel top to bottom, in the order they are authored.",
    onGo: onWalkGo,
  });
  const walkEl = host.lastElementChild;
  const footer = kitEl("div", "kseq-footer");
  if (legend) {
    footer.appendChild(legend);
  }
  footer.append(walkEl);
  host.append(footer);

  function onMotionPresetChange(e) {
    const preset = e && e.detail ? e.detail.preset : kdfEnsureMotionPreset();
    if (!["calm", "normal", "off"].includes(preset)) {
      return;
    }
    motionPreset = preset;
    host.dataset.motionPreset = preset;
    ambient.stop();
    if (preset === "off") {
      Object.keys(pulseByMsg).forEach((mid) => {
        var pulse = pulseByMsg[mid];
        if (pulse.fireCtl) {
          pulse.fireCtl[0].stop();
          pulse.fireCtl[1].stop();
          pulse.fireCtl = null;
        }
        clearTimeout(pulse.fireTimer);
        kdfPulseHide(pulse);
        activationEls[mid].classList.remove("on");
      });
    }
    if (!walkApi.current() && preset !== "off" && MOTION) {
      ambient.start();
    }
  }
  window.addEventListener("kitmotionpresetchange", onMotionPresetChange);

  host.__kitDispose = function __kitDispose() {
    ambient.stop();
    walkApi.dispose();
    window.removeEventListener("kitmotionpresetchange", onMotionPresetChange);
    Object.keys(pulseByMsg).forEach((mid) => {
      var pulse = pulseByMsg[mid];
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
    hoverHandlers.forEach((h) => {
      h.li.removeEventListener("mouseenter", h.enter);
      h.li.removeEventListener("mouseleave", h.leave);
    });
  };
  walkApi.go(0);
  return { count: walkthrough.length + 1, current: walkApi.current, go: walkApi.go };
}

/* ── renderErd ── what the data is, and how it relates. Entity cards +
   crow's-foot relationships; see CONTRACTS.md#erd. */
const kitErdSeq = 0;
function kerdAdjustedData(data, state) {
  const entities = (data.entities || []).map(function (entity) {
    const attrs = entity.attrs || [];
    if (state.layout === "relationships") {
      return Object.assign({}, entity, { attrs: [] });
    }
    if (state.fields !== "key" || !attrs.some((attr) => attr.key === "pk" || attr.key === "fk")) {
      return Object.assign({}, entity, { attrs: attrs.slice() });
    }
    const keyAttrs = attrs.filter((attr) => attr.key === "pk" || attr.key === "fk");
    return Object.assign({}, entity, {
      attrs: keyAttrs.length ? keyAttrs : attrs.slice(0, 1),
    });
  });
  return { ...data, entities, fields: state.fields, layout: state.layout, view: state.view };
}

function renderErd(sel, data) {
  const host = kitMount(sel);
  if (!data.__kitAdjusted) {
    const entities = data.entities || [];
    const hasExplicitLayout = entities.some(
      (entity) =>
        typeof entity.x === "number" &&
        typeof entity.y === "number" &&
        typeof entity.w === "number" &&
        typeof entity.h === "number",
    );
    const options = [];
    if (!hasExplicitLayout) {
      options.push({
        choices: ["relationships", "schema"],
        choiceLabels: { relationships: "Relationships", schema: "Schema detail" },
        key: "layout",
        label: "Composition",
        type: "choice",
      });
    }
    options.push({
      choices: ["all", "key"],
      choiceLabels: { all: "All fields", key: "Key fields" },
      hidden: data.layout === "relationships",
      key: "fields",
      label: "Fields",
      help:
        entities.length >= 7 && !hasExplicitLayout
          ? "Presentation uses the fields marked for the audience (up to three per entity). These choices adjust the editing and reading views."
          : "Choose how much schema detail to show.",
      type: "choice",
    });
    if ((data.walkthrough || []).length) {
      options.push({
        choices: ["full", "follow"],
        choiceLabels: { full: "Full", follow: "Follow" },
        key: "view",
        label: "View",
        type: "choice",
      });
    }
    const adjustment = globalThis.ExplainerKit.registerAdjustments(host, {
      base: data,
      defaults: {
        fields: data.fields || "all",
        layout: data.layout || "schema",
        view: data.view || "follow",
      },
      label: data.ariaLabel || "Entity relationship diagram",
      options,
      apply(state) {
        const fieldsOption = host.__kitAdjustments.entry.options.find(
          (option) => option.key === "fields",
        );
        if (fieldsOption) {
          fieldsOption.hidden = state.layout === "relationships";
        }
        const driver = kerdRenderOne(host, {
          ...kerdAdjustedData(host.__kitAdjustments.base, state),
          __kitAdjusted: true,
        });
        globalThis.ExplainerKit.stableDriver(host, driver);
      },
    });
    data = kerdAdjustedData(adjustment.base, adjustment.state);
  }
  const driver = kerdRenderOne(host, { ...data, __kitAdjusted: true });
  const stable = globalThis.ExplainerKit.stableDriver(host, driver);
  globalThis.ExplainerKit.observeContentSpacing(host, function () {
    const current = host.__kitPresentDriver ? host.__kitPresentDriver.current() : 0;
    renderErd(host, data);
    if (host.__kitPresentDriver) {
      host.__kitPresentDriver.go(current);
    }
  });
  return stable;
}

// A relationship label sits on its longest horizontal run, just above it.
function kerdPlaceLabel(label, points, width, height) {
  let run = [points[0], points[1]];
  for (let i = 1; i < points.length - 1; i++) {
    const flat = Math.abs(points[i].y - points[i + 1].y) < 0.5;
    if (flat && Math.abs(points[i + 1].x - points[i].x) > Math.abs(run[1].x - run[0].x)) {
      run = [points[i], points[i + 1]];
    }
  }
  label.style.left = ((run[0].x + run[1].x) / 2 / width) * 100 + "%";
  label.style.top = (run[0].y / height) * 100 + "%";
}

// The primary key a relationship leaves and the foreign key it enters: the
// child's fk named like the parent's pk, else one named after the parent.
function kerdKeyPair(parentEntity, childEntity, parentId) {
  const pk = (parentEntity.attrs || []).find((a) => a.key === "pk");
  const attrs = childEntity.attrs || [];
  const fk =
    attrs.find((a) => a.key === "fk" && pk && a.name === pk.name) ||
    attrs.find((a) => a.key === "fk" && String(a.name || "").startsWith(parentId));
  return { pk, fk };
}

// A horizontal corridor free in every intermediate column, nearest to the
// wanted y. null when the columns leave no shared gap.
function kerdCorridorY(between, wanted) {
  let best = null;
  (between[0] || []).forEach(([a, b]) => {
    let lo = a;
    let hi = b;
    between.slice(1).forEach((gaps) => {
      const hit = gaps.find(([ga, gb]) => ga < hi && lo < gb);
      if (hit) {
        lo = Math.max(lo, hit[0]);
        hi = Math.min(hi, hit[1]);
      } else {
        hi = lo - 1;
      }
    });
    if (hi - lo >= 18) {
      const y = Math.max(lo + 9, Math.min(hi - 9, wanted));
      if (best === null || Math.abs(y - wanted) < Math.abs(best - wanted)) {
        best = y;
      }
    }
  });
  return best;
}

// Dependency-ordered dense layout: one column per level, cards stacked and
// ordered by where their parents sit, columns centred on the tallest one.
function kerdColumnarRects(autoEntities, entities, levelOf, parentsOf, opts) {
  const { cols, margin, colWidth, gutter, spacing } = opts;
  // Dense card metrics are CSS pixels; the canvas keeps a pixel-true
  // vertical scale (min-height on the canvas), so units and pixels agree.
  const DENSE_HEAD = 38 + 8 * spacing;
  const DENSE_ATTR = 27 + 8 * spacing;
  const V_GAP = 44;
  const TOP = 36;
  const columns = [];
  for (let c = 0; c < cols; c++) {
    columns.push(autoEntities.filter((e) => levelOf[e.id] === c));
  }
  const rank = {};
  columns.forEach((column, c) => {
    if (c > 0) {
      const bary = (e) => {
        const ranks = parentsOf[e.id].map((p) => rank[p]).filter((v) => v != null);
        return ranks.length
          ? ranks.reduce((sum, v) => sum + v, 0) / ranks.length
          : Number.POSITIVE_INFINITY;
      };
      column.sort((a, b) => bary(a) - bary(b) || entities.indexOf(a) - entities.indexOf(b));
    }
    column.forEach((e, row) => {
      rank[e.id] = row;
    });
  });
  const cardHeight = (e) => DENSE_HEAD + (e.attrs ? e.attrs.length : 0) * DENSE_ATTR + 6;
  const columnHeight = (column) =>
    column.reduce((sum, e) => sum + cardHeight(e), 0) + Math.max(0, column.length - 1) * V_GAP;
  const tallest = Math.max(...columns.map(columnHeight));
  const rects = {};
  columns.forEach((column, c) => {
    let y = TOP + (tallest - columnHeight(column)) / 2;
    column.forEach((e) => {
      rects[e.id] = {
        id: e.id,
        x: margin + c * (colWidth + gutter),
        y,
        w: colWidth,
        h: cardHeight(e),
        col: c,
      };
      y += cardHeight(e) + V_GAP;
    });
  });
  return { columns, rects, height: TOP * 2 + tallest };
}

// Column of each entity in a dependency-ordered ERD: one right of every
// table it references. A cycle breaks at the back edge instead of recursing.
function kerdDependencyLevels(entities, parentsOf) {
  const levelOf = {};
  const visiting = new Set();
  function levelFor(id) {
    if (levelOf[id] != null) {
      return levelOf[id];
    }
    if (visiting.has(id)) {
      return 0;
    }
    visiting.add(id);
    const level = parentsOf[id].reduce((max, parent) => Math.max(max, levelFor(parent) + 1), 0);
    visiting.delete(id);
    levelOf[id] = level;
    return level;
  }
  entities.forEach((e) => levelFor(e.id));
  return levelOf;
}

function kerdRenderOne(sel, data) {
  const host = kitMount(sel);
  kitValidateTextCaps(host, "renderErd", data);
  const TAG = "architecture erd";
  let motionPreset = kdfEnsureMotionPreset();
  const entities = data.entities || [];
  const relations = data.relations || [];
  const walkthrough = data.walkthrough || [];
  const denseAuto =
    entities.length >= 7 &&
    entities.every(
      (entity) => !["x", "y", "w", "h"].every((key) => typeof entity[key] === "number"),
    );

  if (entities.length < 2 || entities.length > 10) {
    throw new Error(TAG + ": supports 2-10 entities (got " + entities.length + ")");
  }
  if (relations.length === 0 || relations.length > 10) {
    throw new Error(TAG + ": supports 1-10 relations (got " + relations.length + ")");
  }
  if (walkthrough.length > 6) {
    throw new Error(
      TAG + ": walkthrough supports at most 6 steps (got " + walkthrough.length + ")",
    );
  }

  const entityById = {};
  entities.forEach((e) => {
    if (!e.id || entityById[e.id]) {
      throw new Error(TAG + ": entity ids must be unique");
    }
    var attrs = e.attrs || [];
    if (attrs.length > 5) {
      throw new Error(
        TAG + ': entity "' + e.id + '" supports at most 5 attrs (got ' + attrs.length + ")",
      );
    }
    attrs.forEach(function (a) {
      if (a.key != null && a.key !== "pk" && a.key !== "fk") {
        throw new Error(
          TAG +
            ': entity "' +
            e.id +
            '" attr "' +
            a.name +
            '" key must be "pk" or "fk" (got "' +
            a.key +
            '")',
        );
      }
    });
    if (denseAuto && data.layout !== "relationships") {
      const selected = attrs.filter((attr) => attr.present === true);
      if (selected.length === 0 || selected.length > 3) {
        throw new Error(
          TAG +
            ': dense entity "' +
            e.id +
            '" requires 1-3 attrs with present:true for Present mode',
        );
      }
    }
    entityById[e.id] = e;
  });

  function parseCardToken(id, token) {
    const t = String(token).trim();
    if (t === "1") {
      return "one";
    }
    if (t === "0..1") {
      return "zeroOne";
    }
    if (t === "N" || t === "M") {
      return "many";
    }
    if (t === "0..N" || t === "0..M") {
      return "zeroMany";
    }
    throw new Error(
      `${TAG}: relation "${id}" card token "${token}" must be one of 1, 0..1, N, 0..N (M accepted as an alias for N)`,
    );
  }
  function parseCard(id, raw = "1:N") {
    const parts = String(raw).split(":");
    if (parts.length !== 2) {
      throw new Error(
        TAG + ': relation "' + id + '" card "' + raw + '" must be "<side>:<side>" (e.g. "1:0..N")',
      );
    }
    return { from: parseCardToken(id, parts[0]), to: parseCardToken(id, parts[1]) };
  }

  const relIdSeen = {};
  relations.forEach((r) => {
    var rid = r.id || "?";
    if (r.id != null) {
      // a duplicate id silently overwrites the earlier relation's legend
      // hover, walkthrough highlight, and pulse — reject it like entity ids
      if (relIdSeen[String(r.id)]) {
        throw new Error(TAG + ': relation ids must be unique (got "' + rid + '" twice)');
      }
      relIdSeen[String(r.id)] = true;
    }
    if (!entityById[r.from]) {
      throw new Error(TAG + ': relation "' + rid + '" references unknown entity "' + r.from + '"');
    }
    if (!entityById[r.to]) {
      throw new Error(TAG + ': relation "' + rid + '" references unknown entity "' + r.to + '"');
    }
    parseCard(rid, r.card); // throws on an invalid card; re-parsed per relation below
    if (denseAuto && String(r.label || "").length > 24) {
      throw new Error(TAG + ': dense relation "' + rid + '" label supports at most 24 characters');
    }
  });

  // ── layout: explicit x/y/w/h wins for that entity; the rest auto-grid on
  // A fixed-width 1500 canvas, 2-3 per row, no overlaps by construction.
  // Canvas height grows past the nominal 720 only when attrs demand it,
  // And the grid centers vertically when it doesn't — no dead band. ──
  const dense = denseAuto;
  const spacing = globalThis.ExplainerKit.contentSpacing();
  const MARGIN = 60,
    ROW_GUTTER = 170 * spacing;
  // Card content (header band + attr rows) is plain HTML at fixed CSS
  // Sizes (padding + rem font), NOT scaled by the canvas's own viewBox
  // Units — only the CARD's outer box follows the width/height percentage
  // System. So these budgets have to stay generous at the canvas's
  // Narrowest realistic render width (the kit's own 920px overflow-scroll
  // Floor, see data-flow.css's `.kdf-canvas{min-width:920px}` on small
  // Viewports) rather than a naive units-per-row guess, or attr rows clip.
  const HEAD_H = 46 + 20 * spacing,
    ATTR_H = 38 + 10 * spacing,
    CARD_MIN_H = HEAD_H + 20;
  const COLS_BY_N = { 2: 2, 3: 3, 4: 2, 5: 3, 6: 3 };
  // Which end of a relation is the parent (the "one" side). N:M reads
  // from→to like an ordinary edge.
  function relationEnds(r, rid) {
    const card = parseCard(rid, r.card);
    const oneAtFrom =
      card.from === "one" ||
      card.from === "zeroOne" ||
      !(card.to === "one" || card.to === "zeroOne");
    return oneAtFrom
      ? { parent: r.from, child: r.to, parentKind: card.from, childKind: card.to }
      : { parent: r.to, child: r.from, parentKind: card.to, childKind: card.from };
  }
  const relationIds = relations.map((r, idx) => (r.id != null ? String(r.id) : String(idx)));
  // Dense boards read left to right by dependency: a table sits one column
  // right of every table it references, so each relationship leaves a
  // primary key and travels rightwards into a foreign key. This is how an
  // ERD is read, and it is what keeps ten tables from becoming a bus bar.
  const parentsOf = {};
  entities.forEach((e) => {
    parentsOf[e.id] = [];
  });
  relations.forEach((r, idx) => {
    const ends = relationEnds(r, relationIds[idx]);
    if (ends.parent !== ends.child) {
      parentsOf[ends.child].push(ends.parent);
    }
  });
  const levelOf = kerdDependencyLevels(entities, parentsOf);
  const levelCount = entities.length ? Math.max(...entities.map((e) => levelOf[e.id])) + 1 : 1;
  const columnar = dense && relations.length > 0 && levelCount > 1;
  const width = columnar || !dense ? 1500 : 1200;
  const cols = columnar
    ? levelCount
    : dense
      ? Math.min(5, Math.ceil(entities.length / 2))
      : data.layout === "relationships"
        ? Math.min(entities.length, 4)
        : COLS_BY_N[entities.length] || 3;
  // The column gutter is the corridor every same-row relation routes
  // Through — crow's-foot terminals need ~20 units of clear air off each
  // Card edge, plus room for the numbered badge beside the line, so this
  // Stays generous: 2 columns have the width budget to be very generous
  // (matches architecture's own wide-canvas convention); 3 columns still
  // Gets a floor well above that clearance minimum.
  const GUTTER_BY_COLS = { 2: 260, 3: 170 };
  const grid = columnar
    ? { margin: 40, gutter: Math.max(96, Math.min(150, 560 / cols)) }
    : dense
      ? { margin: 24, gutter: 24 }
      : { margin: MARGIN, gutter: GUTTER_BY_COLS[cols] || 170 };
  const margin = grid.margin;
  const GUTTER = grid.gutter;
  const colWidth = (width - margin * 2 - (cols - 1) * GUTTER) / cols;

  const autoEntities = [];
  const rects = {};
  entities.forEach((e) => {
    var explicit =
      typeof e.x === "number" &&
      typeof e.y === "number" &&
      typeof e.w === "number" &&
      typeof e.h === "number";
    if (explicit) {
      rects[e.id] = { id: e.id, x: e.x, y: e.y, w: e.w, h: e.h };
    } else {
      autoEntities.push(e);
    }
  });
  let height;
  const columns = [];
  if (columnar) {
    const laid = kerdColumnarRects(autoEntities, entities, levelOf, parentsOf, {
      cols,
      margin,
      colWidth,
      gutter: GUTTER,
      spacing,
    });
    laid.columns.forEach((column) => columns.push(column));
    Object.assign(rects, laid.rects);
    height = laid.height;
  } else {
    const rows = [];
    for (let ri = 0; ri < autoEntities.length; ri += cols) {
      rows.push(autoEntities.slice(ri, ri + cols));
    }
    let cursorY = dense ? 28 : MARGIN;
    rows.forEach((row) => {
      var rowH = dense
        ? data.layout === "relationships"
          ? 48 + 16 * spacing
          : 126 + 24 * spacing
        : row.reduce(function (max, e) {
            return Math.max(max, HEAD_H + (e.attrs ? e.attrs.length : 0) * ATTR_H + 20);
          }, CARD_MIN_H);
      row.forEach(function (e, col) {
        rects[e.id] = {
          id: e.id,
          x: margin + col * (colWidth + GUTTER),
          y: cursorY,
          w: colWidth,
          h: rowH,
        };
      });
      cursorY += rowH + (dense ? 72 * spacing : ROW_GUTTER);
    });
    const contentHeight = cursorY - (dense ? 72 * spacing : ROW_GUTTER) + margin;
    height = dense
      ? data.layout === "relationships"
        ? Math.max(280, contentHeight)
        : 428 + (spacing - 1) * (rows.length * 24 + Math.max(0, rows.length - 1) * 72)
      : Math.max(720, contentHeight);
    // Content shorter than the nominal 720: center the grid vertically
    // Instead of leaving all the slack as a dead band under the last row.
    // Only auto-placed entities move — explicit x/y/w/h is the author's own
    // And stays exactly where they put it.
    if (contentHeight < height) {
      const vShift = (height - contentHeight) / 2;
      if (!dense) {
        autoEntities.forEach((e) => {
          rects[e.id].y += vShift;
        });
      }
    }
  }

  // Guard: explicit coordinates that overlap or leave the canvas throw —
  // Same voice as the operating-model preset's fixed-layout guard.
  entities.forEach((e) => {
    var rect = rects[e.id];
    var offCanvas = rect.x < 0 || rect.y < 0 || rect.x + rect.w > width || rect.y + rect.h > height;
    if (offCanvas) {
      throw new Error(
        TAG +
          ': entity "' +
          e.id +
          '" does not fit the ' +
          width +
          "x" +
          Math.round(height) +
          " canvas — adjust x/y/w/h",
      );
    }
  });
  const ids = entities.map(function (e) {
    return e.id;
  });
  for (let ai = 0; ai < ids.length; ai++) {
    for (let bi = ai + 1; bi < ids.length; bi++) {
      if (kdfRectOverlap(rects[ids[ai]], rects[ids[bi]])) {
        throw new Error(
          TAG +
            ': entity "' +
            ids[ai] +
            '" overlaps entity "' +
            ids[bi] +
            '" — adjust explicit x/y/w/h',
        );
      }
    }
  }

  host.classList.add("kdf", "kerd");
  host.dataset.layout = data.layout || "schema";
  if (dense) {
    host.classList.add("kerd-dense");
  }
  host.__kitBase = { kind: "erd" };
  host.dataset.motionPreset = motionPreset;
  host.dataset.zoom = "";

  const canvas = kitEl("div", "kdf-canvas kerd-canvas");
  canvas.style.aspectRatio = `${width} / ${height}`;
  if (dense && data.layout !== "relationships") {
    canvas.style.minHeight = height + "px";
  }
  if (columnar) {
    host.classList.add("kerd-columnar");
  }
  canvas.setAttribute("role", "img");
  canvas.setAttribute(
    "aria-label",
    data.ariaLabel || `Entity-relationship diagram of ${entities.length} entities`,
  );

  const svg = svgEl(
    "svg",
    {
      class: "kdf-wires kerd-wires",
      viewBox: "0 0 " + width + " " + height,
      preserveAspectRatio: "none",
      "aria-hidden": "true",
    },
    canvas,
  );
  const labelSvg = svgEl(
    "svg",
    {
      class: "kdf-labels kerd-labels",
      viewBox: "0 0 " + width + " " + height,
      preserveAspectRatio: "none",
      "aria-hidden": "true",
    },
    canvas,
  );

  // Entity cards — reuse kdf card chrome (radius, border, shadow, tones);
  // Header band + attribute rows are new (kerd-*), pk/fk get small glyphs.
  const KEY_GLYPH =
    '<svg class="kerd-key" viewBox="0 0 12 12" aria-hidden="true"><circle cx="4.2" cy="4.2" r="2.9" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M6.3 6.3L11 11M8 8l1.6-1.6M9.4 9.4L11 7.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
  const FK_GLYPH =
    '<svg class="kerd-fk" viewBox="0 0 12 12" aria-hidden="true"><rect x="1" y="4" width="6" height="4.4" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="5" y="4" width="6" height="4.4" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';
  const entityEls = {};
  entities.forEach((e) => {
    var rect = rects[e.id];
    var el = kitEl("div", "kerd-entity " + (e.tone || "neutral"));
    el.dataset.entity = e.id;
    kdfBoxRect(el, rect.x, rect.y, rect.w, rect.h, width, height);
    var head = kitEl("div", "kerd-head", e.label || e.id);
    var attrsWrap = kitEl("div", "kerd-attrs");
    (e.attrs || []).forEach(function (a) {
      var row = kitEl(
        "div",
        "kerd-attr" +
          (a.key === "pk" ? " pk" : a.key === "fk" ? " fk" : "") +
          (a.present === true ? " kerd-present" : ""),
      );
      row.dataset.attr = a.name || "";
      var glyph = a.key === "pk" ? KEY_GLYPH : a.key === "fk" ? FK_GLYPH : "";
      row.innerHTML =
        glyph +
        '<span class="kerd-attr-name">' +
        (a.name || "") +
        "</span>" +
        (a.type ? '<span class="kerd-attr-type">' + a.type + "</span>" : "");
      attrsWrap.appendChild(row);
    });
    el.appendChild(head);
    el.appendChild(attrsWrap);
    canvas.appendChild(el);
    entityEls[e.id] = el;
  });

  // Relations — orthogonal-ish connectors (elbows, not Beziers: distinct on
  // Purpose from architecture's curved routing) with crow's-foot terminals.
  // Nearest-facing-edge routing: entities that share a row band connect
  // Right<->left straight across the column gutter; entities that share a
  // Column band connect bottom<->top straight down the row gutter; only a
  // Genuinely diagonal pair (shares neither band) gets a single elbow bend.
  // Two relations that would otherwise run down the exact same gutter
  // Corridor are staggered apart rather than left to overlap.
  function overlapsRange(aMin, aMax, bMin, bMax) {
    return aMin < bMax && bMin < aMax;
  }
  function classifyPair(a, b) {
    const xOverlap = overlapsRange(a.x, a.x + a.w, b.x, b.x + b.w);
    const yOverlap = overlapsRange(a.y, a.y + a.h, b.y, b.y + b.h);
    if (yOverlap && !xOverlap) {
      return "row";
    }
    if (xOverlap && !yOverlap) {
      return "col";
    }
    return "diag";
  }
  function anchorOf(rect, side) {
    if (side === "left") {
      return { x: rect.x, y: rect.y + rect.h / 2 };
    }
    if (side === "right") {
      return { x: rect.x + rect.w, y: rect.y + rect.h / 2 };
    }
    if (side === "top") {
      return { x: rect.x + rect.w / 2, y: rect.y };
    }
    return { x: rect.x + rect.w / 2, y: rect.y + rect.h };
  }
  // Diagonal fallback only (row/col adjacency is already ruled out by the
  // Time this runs) — same dx/dy-magnitude side pick data-flow's own
  // (nested) autoSides() uses, rewritten fresh here since it's entangled
  // There with its Bezier route().
  function sideOf(from, to) {
    const dx = to.x + to.w / 2 - (from.x + from.w / 2);
    const dy = to.y + to.h / 2 - (from.y + from.h / 2);
    if (Math.abs(dx) >= Math.abs(dy)) {
      return dx >= 0 ? ["right", "left"] : ["left", "right"];
    }
    return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
  }
  const STAGGER = 26;
  const usedHBands = [],
    usedVBands = [];
  // Reserve a horizontal/vertical corridor for a straight connector,
  // Nudging its through-coordinate away from any earlier connector whose
  // Span already claims that same band — e.g. two relations between the
  // Same pair of entities, or two column relations sharing a row gutter.
  // A diagonal's own middle segment reserves against the same lists (a
  // Vertical middle segment behaves exactly like a 'col' relation's run,
  // And a horizontal one like a 'row' relation's), so one mechanism covers
  // Every connector kind.
  function reserveHBand(y, xa, xb) {
    const lo = Math.min(xa, xb),
      hi = Math.max(xa, xb);
    let tries = 0;
    while (
      tries < 6 &&
      usedHBands.some((b) => Math.abs(b.y - y) < STAGGER && lo < b.x2 && b.x1 < hi)
    ) {
      tries++;
      y += (tries % 2 ? 1 : -1) * STAGGER * Math.ceil(tries / 2);
    }
    usedHBands.push({ y, x1: lo, x2: hi });
    return y;
  }
  function reserveVBand(x, ya, yb) {
    const lo = Math.min(ya, yb),
      hi = Math.max(ya, yb);
    let tries = 0;
    while (
      tries < 6 &&
      usedVBands.some((b) => Math.abs(b.x - x) < STAGGER && lo < b.y2 && b.y1 < hi)
    ) {
      tries++;
      x += (tries % 2 ? 1 : -1) * STAGGER * Math.ceil(tries / 2);
    }
    usedVBands.push({ x, y1: lo, y2: hi });
    return x;
  }
  // Multiple relations can legitimately leave the same entity from the same
  // Side (a hub entity with several relationships) — anchorOf() alone would
  // Stack them all on the exact same point, so the 2nd+ use of a given
  // (entity, side) fans out along that edge instead, same convention real
  // Crow's-foot diagrams use. Terminals are drawn at the fanned-out point
  // Too (it's what gets passed to terminal() below), so line and glyph
  // Always agree on where the relation actually meets the card.
  const anchorUse = {};
  function anchorOfSpread(rect, side) {
    const key = rect.id + "|" + side;
    const n = anchorUse[key] || 0;
    anchorUse[key] = n + 1;
    const base = anchorOf(rect, side);
    if (n === 0) {
      return base;
    }
    const alongY = side === "left" || side === "right";
    const span = (alongY ? rect.h : rect.w) / 2 - 12;
    const step = Math.min(24, span / 2);
    const offset = Math.max(-span, Math.min(span, (n % 2 ? 1 : -1) * Math.ceil(n / 2) * step));
    return alongY ? { x: base.x, y: base.y + offset } : { x: base.x + offset, y: base.y };
  }
  // A tiny 2-segment nudge onto a staggered band, only when staggering
  // Actually moved the through-coordinate — the common (unstaggered) case
  // Stays the clean straight line the routing rule asks for.
  function nudgedLine(p1, p2, axis, through) {
    const natural = axis === "y" ? p1.y : p1.x;
    if (Math.abs(through - natural) < 0.5) {
      return [p1, p2];
    }
    const nudge = 16;
    if (axis === "y") {
      const dxSign = p2.x >= p1.x ? nudge : -nudge;
      return [p1, { x: p1.x + dxSign, y: through }, { x: p2.x - dxSign, y: through }, p2];
    }
    const dySign = p2.y >= p1.y ? nudge : -nudge;
    return [p1, { x: through, y: p1.y + dySign }, { x: through, y: p2.y - dySign }, p2];
  }
  function pointsToPath(points) {
    return points.map((p, idx) => (idx ? "L" : "M") + p.x + " " + p.y).join(" ");
  }
  const TERM_CLASS = { one: "one", zeroOne: "zero-one", many: "many", zeroMany: "zero-many" };
  function placeTerminal(g, point, side) {
    const angle = { left: 180, right: 0, top: 270, bottom: 90 }[side];
    g.setAttribute("transform", "translate(" + point.x + "," + point.y + ") rotate(" + angle + ")");
  }
  function terminal(kind, point, side, layer) {
    const angle = { left: 180, right: 0, top: 270, bottom: 90 }[side];
    const g = svgEl(
      "g",
      {
        class: "kerd-terminal kerd-term-" + TERM_CLASS[kind],
        transform: "translate(" + point.x + "," + point.y + ") rotate(" + angle + ")",
      },
      layer,
    );
    if (kind === "one" || kind === "zeroOne") {
      svgEl("path", { d: "M9,-8 L9,8", class: "kerd-term-bar" }, g);
    }
    if (kind === "zeroOne" || kind === "zeroMany") {
      svgEl("circle", { cx: 17, cy: 0, r: 6, class: "kerd-term-circle" }, g);
    }
    if (kind === "many" || kind === "zeroMany") {
      svgEl("path", { d: "M2,0 L15,-8 M2,0 L15,0 M2,0 L15,8", class: "kerd-term-crow" }, g);
    }
    if (kind === "one") {
      svgEl("path", { d: "M3,-8 L3,8", class: "kerd-term-bar" }, g);
    }
    return g;
  }

  const pulseLayer = document.createElementNS(kdfNS, "g");
  pulseLayer.setAttribute("class", "kdf-pulse-layer");
  pulseLayer.setAttribute("aria-hidden", "true");
  const relById = {},
    relEls = {},
    pathByRel = {},
    terminalEls = {},
    relLabelEls = {},
    pulseByRel = {};
  const legendItems = [];
  relations.forEach((r, idx) => {
    var rid = r.id != null ? String(r.id) : String(idx);
    relById[rid] = r;
    var fromRect = rects[r.from],
      toRect = rects[r.to];
    var kind = classifyPair(fromRect, toRect);
    var sides, points;
    if (columnar) {
      // Placeholder geometry from the rects; routeColumnar() below replaces
      // it with field-level anchors once the cards have laid out.
      const ends = relationEnds(r, rid);
      const parentRect = rects[ends.parent];
      const childRect = rects[ends.child];
      sides = parentRect.x <= childRect.x ? ["right", "left"] : ["left", "right"];
      points = [anchorOf(parentRect, sides[0]), anchorOf(childRect, sides[1])];
    } else if (kind === "row") {
      var fromIsLeft = fromRect.x <= toRect.x;
      sides = fromIsLeft ? ["right", "left"] : ["left", "right"];
      var rp1 = anchorOfSpread(fromRect, sides[0]),
        rp2 = anchorOfSpread(toRect, sides[1]);
      var throughY = reserveHBand((rp1.y + rp2.y) / 2, rp1.x, rp2.x);
      points = nudgedLine(rp1, rp2, "y", throughY);
    } else if (kind === "col") {
      var fromIsTop = fromRect.y <= toRect.y;
      sides = fromIsTop ? ["bottom", "top"] : ["top", "bottom"];
      var cp1 = anchorOfSpread(fromRect, sides[0]),
        cp2 = anchorOfSpread(toRect, sides[1]);
      var throughX = reserveVBand((cp1.x + cp2.x) / 2, cp1.y, cp2.y);
      points = nudgedLine(cp1, cp2, "x", throughX);
    } else {
      sides = sideOf(fromRect, toRect);
      var dp1 = anchorOfSpread(fromRect, sides[0]),
        dp2 = anchorOfSpread(toRect, sides[1]);
      var horiz1 = sides[0] === "left" || sides[0] === "right";
      // Bend through the true gutter midpoint between the two anchors, not
      // the target's own edge coordinate — the target's anchor x/y can sit
      // inside a *different* card that shares its row or column (e.g. a
      // 3-column grid's middle column), so bending there would route the
      // connector straight through that card instead of the open gutter.
      if (horiz1) {
        var midX = reserveVBand((dp1.x + dp2.x) / 2, dp1.y, dp2.y);
        points = [dp1, { x: midX, y: dp1.y }, { x: midX, y: dp2.y }, dp2];
      } else {
        var midY = reserveHBand((dp1.y + dp2.y) / 2, dp1.x, dp2.x);
        points = [dp1, { x: dp1.x, y: midY }, { x: dp2.x, y: midY }, dp2];
      }
    }
    var p1 = points[0],
      p2 = points.at(-1);
    var d = pointsToPath(points);
    var card = parseCard(rid, r.card);
    // Pulse travels from the '1' side toward the many side; N:M (both many)
    // defaults from→to, same as an ordinary edge.
    var oneAtFrom =
      card.from === "one" ||
      card.from === "zeroOne" ||
      !(card.to === "one" || card.to === "zeroOne");
    var pulseD = oneAtFrom ? d : pointsToPath([...points].toReversed());

    var group = svgEl("g", { class: "kdf-edge", "data-edge": rid }, svg);
    var pathEl = svgEl("path", { d, class: "kdf-edge-path" }, group);
    var pulse = kdfMakePulse(
      pulseLayer,
      "neutral",
      pulseD,
      pathEl.getTotalLength(),
      rid,
      function () {
        return motionPreset;
      },
    );
    pulseByRel[rid] = pulse;
    relEls[rid] = group;
    pathByRel[rid] = pathEl;

    if (!dense || columnar) {
      terminalEls[rid] = [
        terminal(card.from, p1, sides[0], labelSvg),
        terminal(card.to, p2, sides[1], labelSvg),
      ];
    }
    if (columnar && r.label) {
      // HTML, not SVG text: the wires layer stretches non-uniformly and
      // would squash glyphs.
      const label = kitEl("div", "kerd-rel-label", r.label);
      label.dataset.edge = rid;
      canvas.appendChild(label);
      relLabelEls[rid] = label;
    }

    legendItems.push({
      cardinality: String(r.card || "1:N").replace(":", " → "),
      from: entityById[r.from].label || r.from,
      to: entityById[r.to].label || r.to,
      id: rid,
      label: r.label || rid,
    });
  });
  svg.append(pulseLayer);
  const footer = kitEl("div", "kerd-footer");
  host.append(canvas, footer);

  // Columnar routing, measured. Cards are HTML at CSS sizes inside a scaled
  // canvas, so the only honest way to hit a field row is to read where the
  // browser put it. Every relationship leaves the parent's primary key row
  // on the right and enters the child's foreign key row on the left,
  // travelling the column gutters and, when it has to cross a column, a
  // free corridor between that column's cards. Re-runs on resize.
  const rowsByRel = {};
  let resizeObserver = null;
  // Stack each column from the cards' rendered heights (Present hides the
  // rows that are not key, so estimates would leave slack) and size the
  // canvas to the tallest column. Vertical units stay pixel-true.
  function stackColumns() {
    const V_GAP = 32;
    const TOP = 24;
    const heights = {};
    let tallest = 0;
    columns.forEach((column) => {
      let total = 0;
      column.forEach((e) => {
        heights[e.id] = entityEls[e.id].getBoundingClientRect().height || rects[e.id].h;
        total += heights[e.id];
      });
      tallest = Math.max(tallest, total + Math.max(0, column.length - 1) * V_GAP);
    });
    const nextHeight = Math.round(TOP * 2 + tallest);
    if (!tallest || nextHeight === height) {
      return false;
    }
    height = nextHeight;
    columns.forEach((column) => {
      let y =
        TOP +
        (tallest -
          column.reduce((sum, e) => sum + heights[e.id], 0) -
          Math.max(0, column.length - 1) * V_GAP) /
          2;
      column.forEach((e) => {
        rects[e.id].y = y;
        rects[e.id].h = heights[e.id];
        entityEls[e.id].style.top = (y / height) * 100 + "%";
        y += heights[e.id] + V_GAP;
      });
    });
    canvas.style.aspectRatio = `${width} / ${height}`;
    canvas.style.minHeight = height + "px";
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    labelSvg.setAttribute("viewBox", "0 0 " + width + " " + height);
    return true;
  }
  function routeColumnar() {
    if (!canvas.getBoundingClientRect().width) {
      return;
    }
    stackColumns();
    // Re-read after stacking: the canvas may have just changed height.
    const canvasBox = canvas.getBoundingClientRect();
    if (!canvasBox.height) {
      return;
    }
    const sx = width / canvasBox.width;
    const sy = height / canvasBox.height;
    const unitsY = (box) => (box.top + box.height / 2 - canvasBox.top) * sy;
    function fieldRow(entityId, name) {
      const el = entityEls[entityId];
      const row = name
        ? el.querySelector('.kerd-attr[data-attr="' + CSS.escape(name) + '"]')
        : null;
      return row && row.getClientRects().length ? row : null;
    }
    function anchorY(entityId, row) {
      const target = row || entityEls[entityId].querySelector(".kerd-head");
      return unitsY(target.getBoundingClientRect());
    }
    const bottomOf = (id) => {
      const box = entityEls[id].getBoundingClientRect();
      return (box.bottom - canvasBox.top) * sy;
    };
    usedHBands.length = 0;
    usedVBands.length = 0;
    // Free horizontal corridors per column: above the first card, between
    // cards, below the last. Cards are measured, not assumed.
    const corridors = columns.map((column) => {
      const gaps = [];
      let previousBottom = 0;
      column.forEach((e) => {
        gaps.push([previousBottom, rects[e.id].y]);
        previousBottom = bottomOf(e.id);
      });
      gaps.push([previousBottom, height]);
      return gaps.filter(([a, b]) => b - a >= 18);
    });
    relations.forEach((r, idx) => {
      const rid = relationIds[idx];
      const ends = relationEnds(r, rid);
      const parentRect = rects[ends.parent];
      const childRect = rects[ends.child];
      const { pk, fk } = kerdKeyPair(entityById[ends.parent], entityById[ends.child], ends.parent);
      const parentRow = fieldRow(ends.parent, pk && pk.name);
      const childRow = fieldRow(ends.child, fk && fk.name);
      rowsByRel[rid] = [parentRow, childRow].filter(Boolean);
      const y1 = anchorY(ends.parent, parentRow);
      const y2 = anchorY(ends.child, childRow);
      let points;
      let sidesNow;
      if (parentRect.col < childRect.col) {
        sidesNow = ["right", "left"];
        const p1 = { x: parentRect.x + parentRect.w, y: y1 };
        const p2 = { x: childRect.x, y: y2 };
        const gutterX = (c) => margin + (c + 1) * colWidth + c * GUTTER + GUTTER / 2;
        if (childRect.col === parentRect.col + 1) {
          const gx = reserveVBand(gutterX(parentRect.col), y1, y2);
          points = [p1, { x: gx, y: y1 }, { x: gx, y: y2 }, p2];
        } else {
          const between = corridors.slice(parentRect.col + 1, childRect.col);
          const best = kerdCorridorY(between, (y1 + y2) / 2);
          const gx1 = reserveVBand(gutterX(parentRect.col), y1, best == null ? 18 : best);
          const gx2 = reserveVBand(gutterX(childRect.col - 1), best == null ? 18 : best, y2);
          const cy = reserveHBand(best == null ? 18 : best, gx1, gx2);
          points = [
            p1,
            { x: gx1, y: y1 },
            { x: gx1, y: cy },
            { x: gx2, y: cy },
            { x: gx2, y: y2 },
            p2,
          ];
        }
      } else {
        // Same column or a cycle: fall back to an elbow between the nearest
        // facing edges.
        sidesNow = sideOf(parentRect, childRect);
        const p1 = anchorOfSpread(parentRect, sidesNow[0]);
        const p2 = anchorOfSpread(childRect, sidesNow[1]);
        if (sidesNow[0] === "left" || sidesNow[0] === "right") {
          const mx = reserveVBand((p1.x + p2.x) / 2, p1.y, p2.y);
          points = [p1, { x: mx, y: p1.y }, { x: mx, y: p2.y }, p2];
        } else {
          const my = reserveHBand((p1.y + p2.y) / 2, p1.x, p2.x);
          points = [p1, { x: p1.x, y: my }, { x: p2.x, y: my }, p2];
        }
      }
      const d = kdfRoundedPath(points, 10);
      const pathEl = pathByRel[rid];
      pathEl.setAttribute("d", d);
      const len = pathEl.getTotalLength();
      const pulse = pulseByRel[rid];
      pulse.trail.setAttribute("d", d);
      pulse.dot.setAttribute("d", d);
      pulse.trail.style.strokeDasharray = `18 ${len}`;
      pulse.dot.style.strokeDasharray = `3.4 ${len}`;
      pulse.len = len;
      if (terminalEls[rid]) {
        const parentFirst = ends.parent === r.from;
        placeTerminal(terminalEls[rid][parentFirst ? 0 : 1], points[0], sidesNow[0]);
        placeTerminal(terminalEls[rid][parentFirst ? 1 : 0], points.at(-1), sidesNow[1]);
      }
      if (relLabelEls[rid]) {
        kerdPlaceLabel(relLabelEls[rid], points, width, height);
      }
    });
  }
  if (columnar) {
    resizeObserver = new ResizeObserver(() => routeColumnar());
    resizeObserver.observe(canvas);
    Object.values(entityEls).forEach((el) => resizeObserver.observe(el));
    routeColumnar();
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(routeColumnar).catch(() => null);
    }
  }

  let legend = null;
  const legendItemEls = {};
  if (legendItems.length > 0) {
    legend = kitEl("div", "kdf-legend");
    legend.setAttribute("role", "list");
    legendItems.forEach((item) => {
      var li = kitEl("div", "kdf-legend-item");
      li.dataset.edge = item.id;
      li.setAttribute("role", "listitem");
      li.tabIndex = 0;
      const copy = kitEl("span", "kdf-legend-text");
      copy.append(
        kitEl("strong", "kerd-relation-endpoints", item.from + " → " + item.to),
        kitEl("span", "kerd-relation-label", item.label),
        kitEl("small", "kerd-cardinality", item.cardinality),
      );
      li.append(copy);
      legend.appendChild(li);
      legendItemEls[item.id] = li;
    });
    const reference = kitEl("details", "kerd-reference");
    reference.open = walkthrough.length === 0;
    reference.append(kitEl("summary", "", "Relationship details · " + legendItems.length), legend);
    footer.append(reference);
  }
  const hoverHandlers = [];
  function highlightRel(rid, on) {
    if (relEls[rid]) {
      relEls[rid].classList.toggle("hover", on);
    }
    (rowsByRel[rid] || []).forEach((row) => row.classList.toggle("kerd-attr-hot", on));
    if (relLabelEls[rid]) {
      relLabelEls[rid].classList.toggle("hover", on);
    }
    if (legendItemEls[rid]) {
      legendItemEls[rid].classList.toggle("hover", on);
    }
  }
  if (legend) {
    legendItems.forEach((item) => {
      var li = legendItemEls[item.id];
      var enter = function () {
        highlightRel(item.id, true);
      };
      var leave = function () {
        highlightRel(item.id, false);
      };
      li.addEventListener("mouseenter", enter);
      li.addEventListener("mouseleave", leave);
      li.addEventListener("focus", enter);
      li.addEventListener("blur", leave);
      hoverHandlers.push({ li, enter, leave });
    });
  }

  const relIds = relations.map(function (r, idx) {
    return r.id != null ? String(r.id) : String(idx);
  });
  function fireRelation(rid, onDone) {
    const pulse = pulseByRel[rid];
    if (!pulse) {
      onDone();
      return;
    }
    kdfPulseFire(pulse, onDone);
  }
  const ambient = kdfAmbientCycle(
    relIds,
    fireRelation,
    function () {
      return motionPreset === "calm" ? 460 : 280;
    },
    function () {
      return motionPreset === "calm" ? 1500 : 900;
    },
  );

  function applyStep(step) {
    const fireIds = step ? step.fire || [] : [];
    const touched = {};
    fireIds.forEach((rid) => {
      var r = relById[rid];
      if (r) {
        touched[r.from] = true;
        touched[r.to] = true;
      }
    });
    canvas.classList.toggle("walking", Boolean(step));
    Object.keys(entityEls).forEach((eid) => {
      entityEls[eid].classList.toggle("active", Boolean(step) && Boolean(touched[eid]));
    });
    Object.keys(relEls).forEach((rid) => {
      const active = step ? fireIds.includes(rid) : false;
      relEls[rid].classList.toggle("active", active);
      (rowsByRel[rid] || []).forEach((row) => row.classList.toggle("kerd-attr-lit", active));
      if (relLabelEls[rid]) {
        relLabelEls[rid].classList.toggle("active", active);
      }
    });
    if (legend) {
      Object.keys(legendItemEls).forEach((rid) => {
        var active = step ? fireIds.includes(rid) : false;
        legendItemEls[rid].classList.toggle("active", active);
        legendItemEls[rid].classList.toggle("dim", Boolean(step) && !active);
      });
    }
  }
  function onWalkGo(current, step) {
    const displayStep = data.view === "full" ? null : step;
    applyStep(displayStep);
    ambient.stop();
    if (!displayStep) {
      if (motionPreset !== "off" && MOTION) {
        ambient.start();
      }
    } else if (displayStep.fire) {
      displayStep.fire.forEach((rid) => {
        if (pulseByRel[rid]) {
          kdfPulseFire(pulseByRel[rid]);
        } else {
          console.warn(
            '[architecture] erd step "' +
              (step.title || current) +
              '" fires unknown relation "' +
              rid +
              '"',
          );
        }
      });
    }
  }
  const walkApi = kdfBuildWalk(host, walkthrough, {
    overviewTitle: (data.overview && data.overview.title) || "Watch the relationships →",
    overviewBody:
      (data.overview && (data.overview.note != null ? data.overview.note : data.overview.body)) ||
      'Relations take turns pulsing from the "one" side toward the "many" side.',
    onGo: onWalkGo,
    parent: footer,
    showStepCount: true,
  });

  function onMotionPresetChange(e) {
    const preset = e && e.detail ? e.detail.preset : kdfEnsureMotionPreset();
    if (!["calm", "normal", "off"].includes(preset)) {
      return;
    }
    motionPreset = preset;
    host.dataset.motionPreset = preset;
    ambient.stop();
    if (preset === "off") {
      Object.keys(pulseByRel).forEach((rid) => {
        var pulse = pulseByRel[rid];
        if (pulse.fireCtl) {
          pulse.fireCtl[0].stop();
          pulse.fireCtl[1].stop();
          pulse.fireCtl = null;
        }
        clearTimeout(pulse.fireTimer);
        kdfPulseHide(pulse);
      });
    }
    if (!walkApi.current() && preset !== "off" && MOTION) {
      ambient.start();
    }
  }
  window.addEventListener("kitmotionpresetchange", onMotionPresetChange);

  host.__kitDispose = function __kitDispose() {
    ambient.stop();
    walkApi.dispose();
    if (resizeObserver) {
      resizeObserver.disconnect();
    }
    window.removeEventListener("kitmotionpresetchange", onMotionPresetChange);
    Object.keys(pulseByRel).forEach((rid) => {
      var pulse = pulseByRel[rid];
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
    hoverHandlers.forEach((h) => {
      h.li.removeEventListener("mouseenter", h.enter);
      h.li.removeEventListener("mouseleave", h.leave);
      h.li.removeEventListener("focus", h.enter);
      h.li.removeEventListener("blur", h.leave);
    });
  };
  walkApi.go(0);
  return { count: walkthrough.length + 1, current: walkApi.current, go: walkApi.go };
}

/* ── renderStack ── the third architecture-family sibling: one request
   descending through layers (an MR, a code path, a request lifecycle),
   with guards (early exits), side-effect chips, code context cards, and an
   unwind. Same three family traits as sequence/erd (walkthrough panel,
   numbered legend, live pulse) but built in plain HTML flow rather than
   the kdf-canvas coordinate system — frames are real block elements
   nested by depth into a flame-graph-style rail, so the component reflows
   down to mobile width instead of floor-and-scroll like the SVG canvases.
   See CONTRACTS.md#stack.

   kstkBuildFrame(frame) is the reusable seam the next round (`mode:'diff'`,
   a two-pane before/after view) will extend rather than rewrite: it turns
   one frame's data into a self-contained DOM node (path bar, code card,
   chips, guard, kind tag, click-to-toggle) with zero assumption about
   single-column layout. Depth nesting/indentation is applied by the
   *caller* (kstkBuildTree + the lane-assembly loop inside renderStack),
   never by this function, so a future two-pane layout can call it as-is. */

// Fixed extension -> tone map for the code-card path bar's colored dot.
// 'other' is the fallback for any extension outside this documented set.
const KSTK_EXT_TONE = {
  py: "violet",
  js: "warning",
  css: "accent",
  html: "success",
  md: "neutral",
  other: "neutral",
};
function kstkExtTone(filename) {
  const m = /\.([a-zA-Z0-9]+)$/.exec(String(filename || ""));
  const ext = m ? m[1].toLowerCase() : "";
  return KSTK_EXT_TONE[ext] || KSTK_EXT_TONE.other;
}
function kstkPathBar(file) {
  const parts = String(file).split("/");
  const name = parts.pop();
  const dir = parts.length ? parts.join("/") + "/" : "";
  const tone = kstkExtTone(name);
  return (
    `<div class="kstk-path-bar"><span class="kstk-path-text">${
      dir ? '<span class="kstk-path-dir">' + dir + "</span>" : ""
    }<span class="kstk-path-file">${name}</span></span>` +
    `<i class="kstk-ext-dot ${tone}" aria-hidden="true"></i></div>`
  );
}

// Reconstructs a lane's flat, depth-tagged frame array into a tree: each
// Frame's parent is the nearest preceding frame with a strictly smaller
// Depth (a plain stack-based walk, same idea a call stack itself uses).
// Depth need not be contiguous or monotonic — a run of same-depth frames
// Becomes a run of siblings, exactly like the mock's own authored data.
function kstkBuildTree(frames) {
  const root = { depth: -1, children: [] };
  const stack = [root];
  frames.forEach((f) => {
    while (stack.length > 1 && stack.at(-1).depth >= f.depth) {
      stack.pop();
    }
    var node = { depth: f.depth, frame: f, children: [] };
    stack.at(-1).children.push(node);
    stack.push(node);
  });
  return root.children;
}

// Fix 2 — the descent-path seam. Every frame's caller is derived the same
// Way kstkBuildTree finds a parent (nearest preceding frame with a strictly
// Smaller depth), but chained ACROSS lanes too: a lane's own first frame
// (depth has no smaller predecessor within the lane) is called by the
// Previous lane's last frame — the handoff a lane's own `.kstk-handoff`
// Banner already narrates in words. The very first frame of the whole stack
// Has no caller (null). One caller id per frame, precomputed once from the
// Authored shape — independent of which walkthrough step fires it, so a
// Step firing frames out of depth order still draws each frame's own real
// Route rather than a route implied by fire-array order.
function kstkComputeCallers(lanes) {
  const callerOf = {};
  let prevLaneLast = null;
  lanes.forEach((lane) => {
    var stack = [],
      laneFirst = true;
    (lane.frames || []).forEach(function (f) {
      while (stack.length && stack.at(-1).depth >= f.depth) {
        stack.pop();
      }
      var handoffFrom = lane.handoff && lane.handoff.from;
      callerOf[f.id] = Object.hasOwn(f, "caller")
        ? f.caller || null
        : stack.length
          ? stack.at(-1).id
          : laneFirst
            ? handoffFrom || prevLaneLast
            : null;
      stack.push({ depth: f.depth, id: f.id });
      laneFirst = false;
    });
    if (lane.frames && lane.frames.length) {
      prevLaneLast = lane.frames.at(-1).id;
    }
  });
  return callerOf;
}

// Shared code-card open/close — flow's own setCodeOpen(fid, open) and
// Stack-diff's per-pane toggle both delegate here (one seam, not two
// Forked copies) so a walkthrough's programmatic show/close and a click's
// Manual toggle always agree on what "open" means for a given frame.
function kstkSetCodeOpen(rowMap, cardMap, fid, open) {
  const card = cardMap[fid],
    row = rowMap[fid];
  if (!card || !row) {
    return;
  }
  row.classList.toggle("kstk-code-open", open);
  card.classList.toggle("kstk-open", open);
  row.setAttribute("aria-expanded", String(open));
}

// Fix 1 — Present-mode lane collapse. Built once per lane alongside its
// Full kstk-lane-frames content (never lazily) so toggling between the two
// Is a pure CSS class flip, no re-render: lane label, a frame-count chip,
// And one dot per frame (hollow for async, the kit's stand-in for "dashed"
// At dot scale) standing in for the lane's own shape while it's collapsed.
// Scroll mode never shows this (see architecture.css's own .pr-stage
// Scoping) — "everything visible" per the base contract holds there.
function kstkBuildCollapsedStrip(lane) {
  const frames = lane.frames || [];
  const dots = frames
    .map(function (f) {
      return '<i class="kstk-lane-dot' + (f.kind === "async" ? " async" : "") + '"></i>';
    })
    .join("");
  const strip = kitEl("div", "kstk-lane-collapsed");
  strip.innerHTML =
    `<span class="kstk-lane-collapsed-label">${lane.label}</span>` +
    `<span class="kstk-lane-collapsed-count">${frames.length}</span>` +
    `<span class="kstk-lane-collapsed-dots" aria-hidden="true">${dots}</span>`;
  return strip;
}

// Fix 1 — authoring guards. Deliberately rough, documented per-element
// Estimates (never a layout engine — same arithmetic spirit as the
// Operating-model preset's own fixed-layout guard near the top of this
// File), calibrated against this component's real Present-mode metrics
// (a closed frame row ~50px, a guard stub ~60px, an open code card's path
// Bar ~34px + ~26px per line — measured off architecture.css's own
// .pr-stage sizing). Present opens at most one code card at a time (the
// Active step's focus frame — see applyShow below), so a lane's own
// "expanded in Present" estimate budgets for its single tallest card, not
// Every card it carries at once.
const KSTK_PRESENT_STAGE_BUDGET = 700; // Px — one fully-expanded lane's ceiling in Present; past this, collapsing every OTHER lane can't rescue it
const KSTK_SCROLL_COMFORT_BUDGET = 1800; // Px — soft ceiling for the whole stack's frames, scroll mode (code cards default closed there too)
// The runtime budget for the canvas of the CURRENT step, derived from the
// Real viewport rather than guessed: present.js's fit() gives a slide
// `clientHeight - 152` of room (base/present.css's own .pr-slide padding)
// And scales the stage to fit, so a canvas taller than
// Available / SCALE_TARGET is what drags a slide below a legible scale.
// Everything on the stage that is not the canvas — the legend, the
// Walkthrough panel, the kicker and the stage's own 30px gap above the
// Host — is measured, never assumed, so a deck with a longer legend gets a
// Smaller canvas budget instead of a silently over-scaled slide.
const KSTK_PRESENT_SCALE_TARGET = 0.85; // The fitted scale this family aims to stay at or above
const KSTK_PRESENT_SLIDE_PAD = 152; // Present.js fit(): slide clientHeight - 152
const KSTK_PRESENT_KICKER_BAND = 60; // Pr-kicker + the stage's 30px gap above the host
function kstkPresentCanvasBudget(host, canvas) {
  const availH = (window.innerHeight || 900) - KSTK_PRESENT_SLIDE_PAD;
  const chrome = Math.max(0, host.offsetHeight - canvas.offsetHeight) + KSTK_PRESENT_KICKER_BAND;
  return Math.max(240, availH / KSTK_PRESENT_SCALE_TARGET - chrome);
}
// Fix 3 — the carry-over device for a continued part. KSTK_CARRY_FADE is the
// Height, in canvas px, over which the rail arriving from off-canvas fades
// Up into nothing at the top edge.
const KSTK_CARRY_FADE = 54;
const KSTK_EST_LANE_HEAD_PAD = 44; // Lane header block + the lane's own top/bottom padding
const KSTK_EST_FRAME = 50; // One frame row, code closed
const KSTK_EST_GUARD = 60; // One guard stub, immediately after its frame
const KSTK_EST_CODE_HEAD = 34; // An open code card's own path bar
const KSTK_EST_CODE_LINE = 26; // One line inside an open code card
function kstkEstimateLaneFrames(frames) {
  let h = 0;
  (frames || []).forEach((f) => {
    h += KSTK_EST_FRAME;
    if (f.guard) {
      h += KSTK_EST_GUARD;
    }
  });
  return h;
}
function kstkEstimateLaneExpanded(lane) {
  let maxCode = 0;
  (lane.frames || []).forEach((f) => {
    if (f.code && f.code.length) {
      maxCode = Math.max(maxCode, KSTK_EST_CODE_HEAD + f.code.length * KSTK_EST_CODE_LINE);
    }
  });
  return KSTK_EST_LANE_HEAD_PAD + kstkEstimateLaneFrames(lane.frames) + maxCode;
}
// THROW when a single lane, alone, can't fit the Present stage even fully
// Expanded (collapsing every OTHER lane changes nothing for this one) —
// The author's only real fix is to split it across slides or drop code
// Cards, so the message says so. WARN (never throw) when the whole stack's
// Total estimate — frames + guards, no code, matching scroll mode's own
// Closed-by-default cards — passes the scroll-mode comfort budget:
// Existing decks must keep assembling, this is a nudge, not a cap.
function kstkCheckHeightBudgets(TAG, lanes) {
  lanes.forEach((lane) => {
    var est = kstkEstimateLaneExpanded(lane);
    if (est > KSTK_PRESENT_STAGE_BUDGET) {
      throw new Error(
        TAG +
          ': lane "' +
          lane.id +
          '" is too tall to fit the Present stage even expanded alone (~' +
          est +
          "px estimated > " +
          KSTK_PRESENT_STAGE_BUDGET +
          "px budget) — split it across slides or drop code cards",
      );
    }
  });
  const total = lanes.reduce(function (sum, lane) {
    return sum + KSTK_EST_LANE_HEAD_PAD + kstkEstimateLaneFrames(lane.frames);
  }, 0);
  if (total > KSTK_SCROLL_COMFORT_BUDGET) {
    console.warn(
      "[architecture] stack: total estimated height ~" +
        total +
        "px exceeds the " +
        KSTK_SCROLL_COMFORT_BUDGET +
        "px scroll-mode comfort budget — consider trimming lanes or frames",
    );
  }
}

// Frame data -> DOM node. See the family comment above: no layout
// Assumptions live here — indentation/nesting is entirely the caller's job.
function kstkBuildFrame(frame) {
  const kind = frame.kind === "async" ? "async" : "sync";
  const hasCode = Array.isArray(frame.code) && frame.code.length > 0;
  const wrap = kitEl("div", "kstk-frame-wrap");
  wrap.dataset.frame = frame.id;
  const row = kitEl(
    "div",
    "kstk-frame" + (kind === "async" ? " kstk-async" : "") + (hasCode ? " kstk-has-code" : ""),
  );
  let html = "";
  if (frame.depth > 0) {
    html += '<i class="kstk-enter" aria-hidden="true">▸</i>';
  } // Entering a nested call
  html += `<code class="kstk-fn">${frame.fn}</code>`;
  if (kind === "async") {
    html += '<i class="kstk-async-tag">async</i>';
  } // Derived, never authored
  if (frame.note) {
    html += '<small class="kstk-note">' + frame.note + "</small>";
  }
  if (frame.chips && frame.chips.length > 0) {
    html += `<span class="kstk-chips">${frame.chips
      .map(function (c) {
        return '<span class="kstk-chip ' + (c.kind || "plain") + '">' + c.label + "</span>";
      })
      .join("")}</span>`;
  }
  row.innerHTML = html;
  wrap.append(row);
  let codeCard = null;
  if (hasCode) {
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-expanded", "false");
    codeCard = kitEl("div", "kstk-code-card");
    const lines = frame.code
      .map(function (line, idx) {
        return (
          '<code class="kstk-code-line' +
          (frame.hot === idx ? " hot" : "") +
          '">' +
          line +
          "</code>"
        );
      })
      .join("");
    codeCard.innerHTML = `${kstkPathBar(frame.file)}<pre class="kstk-code-lines">${lines}</pre>`;
    wrap.append(codeCard);
  }
  // Guard renders last: the frame's own early-exit stub, always attached to
  // It (never to the tree layout), so it survives verbatim into a future
  // Diff-mode pane too.
  if (frame.guard) {
    const guardEl = kitEl(
      "div",
      "kstk-guard",
      '<i class="kstk-guard-glyph" aria-hidden="true">⤴</i> early exit · ' + frame.guard,
    );
    wrap.append(guardEl);
  }
  return { codeCard, frameRow: row, hasCode, root: wrap };
}

let kitStackSeq = 0;
function kstkSimpleFrames(lanes, state, walkthrough) {
  const handoffSources = new Set();
  const referenced = new Set();
  // Walkthrough shapes are validated in kstkRenderOne, which diff mode never
  // reaches, so read them defensively instead of crashing the whole page.
  const idList = (value) => (Array.isArray(value) ? value : []);
  (walkthrough || []).forEach(function (step) {
    idList(step.fire).forEach((id) => referenced.add(String(id)));
    idList(step.routeTo).forEach((id) => referenced.add(String(id)));
    idList(step.routes).forEach(function (route) {
      referenced.add(String(route && route.from));
      referenced.add(String(route && route.to));
    });
    if (step.show != null) {
      referenced.add(String(step.show));
    }
  });
  (lanes || []).forEach(function (lane) {
    if (lane.handoff && lane.handoff.from != null) {
      handoffSources.add(String(lane.handoff.from));
    }
  });
  return (lanes || []).map(function (lane) {
    let frames = (lane.frames || []).map(function (frame) {
      if (state.detail !== "names" && state.path !== "journey") {
        return Object.assign({}, frame);
      }
      const simple = Object.assign({}, frame);
      delete simple.chips;
      delete simple.code;
      delete simple.file;
      delete simple.hot;
      delete simple.note;
      if (state.detail === "names") {
        delete simple.guard;
      }
      return simple;
    });
    if (state.path === "journey" && frames.length > 2) {
      const keep = new Set([String(frames[0].id)]);
      frames.forEach(function (frame) {
        if (
          frame.guard ||
          handoffSources.has(String(frame.id)) ||
          referenced.has(String(frame.id))
        ) {
          keep.add(String(frame.id));
        }
      });
      for (let pass = 0; pass < 4; pass++) {
        for (const frame of frames) {
          if (
            keep.has(String(frame.id)) &&
            frame.caller != null &&
            !keep.has(String(frame.caller))
          ) {
            keep.add(String(frame.caller));
          }
        }
      }
      frames = frames.filter(function (frame) {
        return keep.has(String(frame.id));
      });
    }
    return Object.assign({}, lane, { frames });
  });
}

function kstkAdjustedData(data, state) {
  if (state.layout === "briefing") {
    return {
      ...data,
      detail: state.detail,
      layout: state.layout,
      path: state.path,
      progression: state.progression,
      view: state.view,
    };
  }
  if (data.mode === "diff") {
    return {
      ...data,
      before: {
        ...data.before,
        lanes: kstkSimpleFrames(data.before && data.before.lanes, state, data.walkthrough),
      },
      after: {
        ...data.after,
        lanes: kstkSimpleFrames(data.after && data.after.lanes, state, data.walkthrough),
      },
      detail: state.detail,
      layout: state.layout,
      view: state.view,
    };
  }
  if (data.mode === "journey") {
    return { ...data, layout: state.layout, progression: state.progression, view: state.view };
  }
  const lanes = kstkSimpleFrames(data.lanes, state, data.walkthrough);
  const visibleFrames = new Set(
    lanes.flatMap(function (lane) {
      return (lane.frames || []).map(function (frame) {
        return String(frame.id);
      });
    }),
  );
  const walkthrough = (data.walkthrough || []).map(function (step) {
    const next = Object.assign({}, step, {
      fire: (step.fire || []).filter(function (id) {
        return visibleFrames.has(String(id));
      }),
      routeTo: (step.routeTo || []).filter(function (id) {
        return visibleFrames.has(String(id));
      }),
      routes: (step.routes || []).filter(function (route) {
        return visibleFrames.has(String(route.from)) && visibleFrames.has(String(route.to));
      }),
    });
    if (next.show != null && !visibleFrames.has(String(next.show))) {
      delete next.show;
    }
    return next;
  });
  return {
    ...data,
    detail: state.detail,
    layout: state.layout,
    lanes,
    path: state.path,
    view: state.view,
    walkthrough,
  };
}

function kstkAppendCallBriefing(host, lanes, label) {
  host.querySelectorAll(".kstk-canvas.kstk-map").forEach((canvas) => {
    canvas.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
    Array.from(canvas.children).forEach((child) => {
      if (
        child.classList.contains("kstk-handoff") &&
        child.nextElementSibling &&
        child.nextElementSibling.classList.contains("kstk-lane")
      ) {
        child.nextElementSibling.prepend(child);
      }
    });
  });
  const callerOf = kstkComputeCallers(lanes);
  const frameById = {};
  (lanes || []).forEach((lane) =>
    (lane.frames || []).forEach((frame) => {
      frameById[frame.id] = frame;
    }),
  );
  const calls = Object.keys(callerOf).filter((id) => callerOf[id] && frameById[callerOf[id]]);
  if (!calls.length) {
    return;
  }
  const section = kitEl("details", "kstk-brief-calls");
  section.append(kitEl("summary", null, (label || "Caller relationships") + " · " + calls.length));
  calls.forEach(function (id) {
    const frame = frameById[id];
    const caller = frameById[callerOf[id]];
    const row = kitEl("div", "kstk-brief-call" + (frame.kind === "async" ? " async" : ""));
    const from = kitEl("span");
    from.textContent = caller.fn;
    const arrow = kitEl("i", null, frame.kind === "async" ? "⇢" : "→");
    arrow.setAttribute("aria-hidden", "true");
    const to = kitEl("strong");
    to.textContent = frame.fn;
    row.append(from, arrow, to);
    section.append(row);
  });
  host.append(section);
}

function kstkRenderBriefing(host, data, TAG) {
  if (data.mode === "diff") {
    return renderStackDiff(host, data, TAG);
  }

  if (data.mode === "journey") {
    return kstkRenderJourneyOutline(host, data, TAG);
  }

  const driver = kstkRenderOne(host, data);
  kstkAppendCallBriefing(host, data.lanes || []);
  return driver;
}

function renderStack(sel, data) {
  const host = kitMount(sel);
  if (!data.__kitAdjusted) {
    const sourceLanes =
      data.mode === "diff"
        ? [
            ...((data.before && data.before.lanes) || []),
            ...((data.after && data.after.lanes) || []),
          ]
        : data.lanes || [];
    const hasDetails = sourceLanes.some((lane) =>
      (lane.frames || []).some(
        (frame) =>
          frame.code || frame.file || frame.note || frame.guard || (frame.chips || []).length,
      ),
    );
    const options = [
      {
        choices: ["diagram", "briefing"],
        choiceLabels: {
          diagram: "Call diagram",
          briefing: data.mode === "diff" ? "Change pairs" : "Stack outline",
        },
        key: "layout",
        label: "Layout",
        primary: true,
        type: "choice",
      },
    ];
    if (hasDetails && data.mode === "diff") {
      options.push({
        choices: ["names", "code"],
        choiceLabels: { names: "Names only", code: "With code" },
        key: "detail",
        label: "Detail",
        type: "choice",
      });
    }
    if (data.mode === "journey") {
      options.push({
        choices: ["overview", "build"],
        choiceLabels: { overview: "Overview", build: "Build path" },
        key: "progression",
        label: "Progression",
        type: "choice",
      });
    } else if (data.mode !== "diff") {
      options.push({
        choices: ["journey", "all"],
        choiceLabels: { journey: "Main calls", all: "All calls" },
        key: "path",
        label: "Calls",
        type: "choice",
      });
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
    const adjustment = globalThis.ExplainerKit.registerAdjustments(host, {
      base: data,
      defaults: {
        detail: data.mode === "diff" ? data.detail || "code" : "code",
        layout: data.layout || "diagram",
        path: data.path || "journey",
        progression: data.progression || "overview",
        view: data.view || "follow",
      },
      label: data.ariaLabel || (data.mode === "diff" ? "Stack comparison" : "Call stack"),
      options,
      apply(state) {
        host.__kitAdjustments.entry.options.forEach(function (option) {
          if (["detail", "path", "progression"].includes(option.key)) {
            option.hidden = state.layout === "briefing";
          }
        });
        const current = host.__kitPresentDriver ? host.__kitPresentDriver.current() : 0;
        const driver = renderStack(host, {
          ...kstkAdjustedData(host.__kitAdjustments.base, state),
          __kitAdjusted: true,
        });
        driver.go(current);
        return driver;
      },
    });
    adjustment.entry.options.forEach(function (option) {
      if (["detail", "path", "progression"].includes(option.key)) {
        option.hidden = adjustment.state.layout === "briefing";
      }
    });
    data = kstkAdjustedData(adjustment.base, adjustment.state);
  }
  host.classList.remove("kcs-diff", "kcs-journey", "kcs-brief-journey");
  host.dataset.layout = data.layout || "diagram";
  const adjusted = { ...data, __kitAdjusted: true };
  const driver =
    data.layout === "briefing"
      ? kstkRenderBriefing(host, adjusted, "architecture stack")
      : kstkRenderOne(host, adjusted);
  return globalThis.ExplainerKit.stableDriver(host, driver);
}

// Validate a journey once, for both the request-spine diagram and the outline.
function kstkJourneyModel(data, TAG) {
  const lanes = data.lanes || [];
  const journey = data.journey || [];
  const walkthrough = data.walkthrough || [];
  const progression = data.progression == null ? "overview" : data.progression;
  if (progression !== "overview" && progression !== "build") {
    throw new Error(
      TAG + ': progression must be "overview" or "build" (got "' + progression + '")',
    );
  }
  if (lanes.length === 0 || lanes.length > 4) {
    throw new Error(TAG + ": journey supports 1-4 lanes (got " + lanes.length + ")");
  }
  if (journey.length < 2 || journey.length > 7) {
    throw new Error(TAG + ": journey supports 2-7 ordered stops (got " + journey.length + ")");
  }
  if (walkthrough.length > 6) {
    throw new Error(
      TAG + ": walkthrough supports at most 6 steps (got " + walkthrough.length + ")",
    );
  }
  const laneById = {};
  const frameById = {};
  const frameLane = {};
  lanes.forEach((lane) => {
    if (!lane.id || laneById[lane.id]) {
      throw new Error(TAG + ": lane ids must be unique");
    }
    if (!lane.label || String(lane.label).length > 24) {
      throw new Error(TAG + ': lane "' + (lane.id || "?") + '" label is required (24 chars max)');
    }
    laneById[lane.id] = lane;
    (lane.frames || []).forEach((frame) => {
      if (!frame.id || frameById[frame.id]) {
        throw new Error(TAG + ": frame ids must be unique");
      }
      frameById[frame.id] = frame;
      frameLane[frame.id] = lane.id;
    });
  });
  const stopIds = new Set();
  const stopFrames = {};
  journey.forEach((stop, index) => {
    if (!stop.id || stopIds.has(stop.id)) {
      throw new Error(TAG + ": journey stop ids must be unique");
    }
    stopIds.add(stop.id);
    if (!stop.label || String(stop.label).length > 28) {
      throw new Error(
        TAG + ': journey stop "' + (stop.id || index + 1) + '" label is required (28 chars max)',
      );
    }
    const refs = stop.frames || (stop.frame != null ? [stop.frame] : []);
    if (!Array.isArray(refs) || refs.length === 0 || refs.length > 4) {
      throw new Error(TAG + ': journey stop "' + stop.id + '" requires frame or 1-4 frames');
    }
    refs.forEach((id) => {
      if (!frameById[id]) {
        throw new Error(
          TAG + ': journey stop "' + stop.id + '" references unknown frame "' + id + '"',
        );
      }
    });
    stopFrames[stop.id] = refs;
  });
  const returnPath = data.returnPath;
  if (
    !returnPath ||
    !frameById[returnPath.from] ||
    !frameById[returnPath.to] ||
    !returnPath.label ||
    String(returnPath.label).length > 32
  ) {
    throw new Error(
      TAG + ": journey returnPath requires known from/to frames and a label (32 chars max)",
    );
  }

  return {
    lanes,
    journey,
    walkthrough,
    progression,
    laneById,
    frameById,
    frameLane,
    stopFrames,
    returnPath,
  };
}

function kstkRenderJourney(host, data, TAG) {
  const { lanes, journey, walkthrough, progression, frameById, frameLane, stopFrames, returnPath } =
    kstkJourneyModel(data, TAG);
  host.classList.add("kcs", "kcs-journey");
  host.__kitBase = { kind: "stack", mode: "journey" };
  host.dataset.progression = progression;
  const board = kitEl("div", "ksp-board");
  board.style.setProperty("--ksp-stops", String(journey.length));
  board.style.setProperty("--ksp-lanes", String(lanes.length));
  board.setAttribute("role", "group");
  board.setAttribute("aria-label", data.ariaLabel || "Request journey");

  const boundaries = kitEl("div", "ksp-boundaries");
  lanes.forEach((lane) => {
    const boundary = kitEl("div", "ksp-boundary");
    boundary.append(kitEl("span", "", lane.label));
    boundaries.append(boundary);
  });
  board.append(boundaries);
  const spine = kitEl("div", "ksp-spine");
  board.append(spine);
  const stopsWrap = kitEl("div", "ksp-stops");
  const stopEls = {};
  const evidenceEls = {};
  journey.forEach((stop, index) => {
    const refs = stopFrames[stop.id];
    const frames = refs.map((id) => frameById[id]);
    const laneId = frameLane[refs[0]];
    if (refs.some((id) => frameLane[id] !== laneId)) {
      throw new Error(
        TAG + ': journey stop "' + stop.id + '" frames must belong to one lane boundary',
      );
    }
    const el = kitEl("article", "ksp-stop");
    if (index === journey.length - 1) {
      el.classList.add("is-last");
    }
    el.dataset.stop = stop.id;
    el.dataset.ordinal = String(index + 1);
    el.dataset.lane = laneId;
    el.style.gridColumn = String(index + 1);
    el.style.gridRow = "1";
    el.append(
      kitEl("span", "ksp-ordinal", String(index + 1).padStart(2, "0")),
      kitEl("strong", "", stop.label),
    );
    const guards = [...new Set(frames.map((frame) => frame.guard).filter(Boolean))];
    if (guards.length > 2 || guards.some((guard) => String(guard).length > 36)) {
      throw new Error(
        TAG + ': journey stop "' + stop.id + '" supports 2 guards of 36 characters each',
      );
    }
    if (guards.length) {
      const guard = kitEl("div", "ksp-guards");
      guards.forEach((label) =>
        guard.append(
          kitEl(
            "span",
            "kstk-guard",
            '<i class="kstk-guard-glyph" aria-hidden="true">⤴</i> ' + label,
          ),
        ),
      );
      el.append(guard);
    }
    stopsWrap.append(el);
    stopEls[stop.id] = el;

    const chips = frames.flatMap((frame) => frame.chips || []);
    if (chips.length > 4) {
      throw new Error(TAG + ': journey stop "' + stop.id + '" derives at most 4 effect chips');
    }
    if (chips.length) {
      const effects = kitEl("div", "ksp-effects");
      effects.dataset.stop = stop.id;
      effects.style.gridColumn = String(index + 1);
      effects.style.gridRow = "2";
      chips.forEach((chip) => {
        if (String(chip.label || "").length > 24) {
          throw new Error(
            TAG + ': journey stop "' + stop.id + '" effect labels support 24 characters',
          );
        }
        effects.append(kitEl("span", "kstk-chip " + (chip.kind || "plain"), chip.label || ""));
      });
      evidenceEls[stop.id] = effects;
      stopsWrap.append(effects);
    }
    const evidenceFrame = frames.find((frame) => frame.file && frame.code && frame.code.length);
    if (evidenceFrame) {
      const evidence = kitEl("div", "ksp-evidence");
      evidence.dataset.stop = stop.id;
      evidence.style.gridColumn =
        String(Math.min(index + 1, Math.max(1, journey.length - 1))) + " / span 2";
      evidence.style.gridRow = "3";
      evidence.innerHTML =
        kstkPathBar(evidenceFrame.file) +
        '<pre class="kstk-code-lines">' +
        evidenceFrame.code
          .map(
            (line, lineIndex) =>
              '<code class="kstk-code-line' +
              (evidenceFrame.hot === lineIndex ? " hot" : "") +
              '">' +
              line +
              "</code>",
          )
          .join("") +
        "</pre>";
      stopsWrap.append(evidence);
      evidenceEls[stop.id + "-code"] = evidence;
    }
  });
  board.append(stopsWrap);
  board.append(
    kitEl(
      "div",
      "ksp-start",
      "Start at the request edge; each outcome appears in its authored slot.",
    ),
  );
  const returnRail = kitEl("div", "ksp-return", "← " + returnPath.label);
  board.append(returnRail);
  host.append(board);

  function activeStopFor(current, step) {
    if (!current) {
      return -1;
    }
    const fired = new Set((step && step.fire) || []);
    const matched = journey.findIndex((stop) =>
      stopFrames[stop.id].some((frameId) => fired.has(frameId)),
    );
    return matched !== -1 ? matched : Math.min(current - 1, journey.length - 1);
  }
  function onGo(current, step) {
    const activeIndex = data.view === "full" ? -1 : activeStopFor(current, step);
    host.dataset.step = String(activeIndex + 1);
    host.style.setProperty(
      "--ksp-progress",
      activeIndex < 0 ? "0%" : (100 * activeIndex) / Math.max(1, journey.length - 1) + "%",
    );
    journey.forEach((stop, index) => {
      const el = stopEls[stop.id];
      el.classList.toggle("active", index === activeIndex);
      el.classList.toggle("past", activeIndex >= 0 && index < activeIndex);
      el.classList.toggle("future", activeIndex < 0 || index > activeIndex);
      [evidenceEls[stop.id], evidenceEls[stop.id + "-code"]].forEach((extra) => {
        if (extra) {
          extra.classList.toggle("active", index === activeIndex);
        }
      });
    });
    board.classList.toggle("walking", activeIndex >= 0);
    returnRail.classList.toggle(
      "active",
      activeIndex >= 0 && stopFrames[journey[activeIndex].id].includes(returnPath.from),
    );
  }
  const walkApi = kdfBuildWalk(host, walkthrough, {
    overviewTitle: (data.overview && data.overview.title) || "Read the whole request",
    overviewBody:
      (data.overview && (data.overview.note || data.overview.body)) ||
      "Outcomes cross named boundaries and return explicitly to the caller.",
    onGo,
  });
  host.__kitDispose = () => walkApi.dispose();
  walkApi.go(0);
  return { count: walkthrough.length + 1, current: walkApi.current, go: walkApi.go };
}

// Stack outline for a journey: the outcomes as a numbered list grouped by
// boundary, one row each, with the function, note, guards, and effects that
// belong to it. Same walkthrough driver as the request-spine diagram.
function kstkRenderJourneyOutline(host, data, TAG) {
  const { journey, walkthrough, laneById, frameById, frameLane, stopFrames, returnPath } =
    kstkJourneyModel(data, TAG);
  host.classList.add("kcs", "kcs-journey", "kcs-brief-journey");
  host.__kitBase = { kind: "stack", mode: "journey" };
  const list = kitEl("ol", "kso");
  list.setAttribute("aria-label", data.ariaLabel || "Request journey outline");
  const stopEls = {};
  let currentLane = null;
  journey.forEach((stop, index) => {
    const refs = stopFrames[stop.id];
    const frames = refs.map((id) => frameById[id]);
    const laneId = frameLane[refs[0]];
    if (laneId !== currentLane) {
      currentLane = laneId;
      const lane = laneById[laneId];
      const boundary = kitEl("li", "kso-boundary");
      boundary.setAttribute("role", "presentation");
      boundary.append(kitEl("span", "", lane.label));
      if (lane.sub) {
        boundary.append(kitEl("small", "", lane.sub));
      }
      list.append(boundary);
    }
    const row = kitEl("li", "kso-stop");
    row.dataset.stop = stop.id;
    row.dataset.lane = laneId;
    row.append(kitEl("span", "kso-ordinal", String(index + 1).padStart(2, "0")));
    const copy = kitEl("div", "kso-copy");
    copy.append(kitEl("strong", "kso-label", stop.label));
    const calls = kitEl("div", "kso-calls");
    frames.forEach((frame) => {
      const call = kitEl("span", "kso-call" + (frame.kind === "async" ? " async" : ""));
      const fn = kitEl("code", "", frame.fn);
      call.append(fn);
      if (frame.note) {
        call.append(kitEl("small", "", frame.note));
      }
      calls.append(call);
    });
    copy.append(calls);
    const guards = [...new Set(frames.map((frame) => frame.guard).filter(Boolean))];
    if (guards.length) {
      const guard = kitEl("div", "kso-guards");
      guards.forEach((label) =>
        guard.append(
          kitEl(
            "span",
            "kstk-guard",
            '<i class="kstk-guard-glyph" aria-hidden="true">⤴</i> ' + label,
          ),
        ),
      );
      copy.append(guard);
    }
    row.append(copy);
    const chips = frames.flatMap((frame) => frame.chips || []);
    const effects = kitEl("div", "kso-effects");
    chips.forEach((chip) =>
      effects.append(kitEl("span", "kstk-chip " + (chip.kind || "plain"), chip.label || "")),
    );
    row.append(effects);
    list.append(row);
    stopEls[stop.id] = row;
  });
  const back = kitEl("li", "kso-return");
  back.setAttribute("role", "presentation");
  back.append(kitEl("span", "kso-return-mark", "↩"), kitEl("span", "", returnPath.label));
  list.append(back);
  host.append(list);

  function activeStopFor(current, step) {
    if (!current) {
      return -1;
    }
    const fired = new Set((step && step.fire) || []);
    const matched = journey.findIndex((stop) =>
      stopFrames[stop.id].some((frameId) => fired.has(frameId)),
    );
    return matched !== -1 ? matched : Math.min(current - 1, journey.length - 1);
  }
  function onGo(current, step) {
    const activeIndex = data.view === "full" ? -1 : activeStopFor(current, step);
    host.dataset.step = String(activeIndex + 1);
    journey.forEach((stop, index) => {
      const el = stopEls[stop.id];
      el.classList.toggle("active", index === activeIndex);
      el.classList.toggle("past", activeIndex >= 0 && index < activeIndex);
      el.classList.toggle("future", activeIndex < 0 || index > activeIndex);
    });
    list.classList.toggle("walking", activeIndex >= 0);
    back.classList.toggle(
      "active",
      activeIndex >= 0 && stopFrames[journey[activeIndex].id].includes(returnPath.from),
    );
  }
  const walkApi = kdfBuildWalk(host, walkthrough, {
    overviewTitle: (data.overview && data.overview.title) || "Read the whole request",
    overviewBody:
      (data.overview && (data.overview.note || data.overview.body)) ||
      "Outcomes cross named boundaries and return explicitly to the caller.",
    onGo,
  });
  host.__kitDispose = () => walkApi.dispose();
  walkApi.go(0);
  return { count: walkthrough.length + 1, current: walkApi.current, go: walkApi.go };
}

function kstkRenderOne(sel, data) {
  const host = kitMount(sel);
  const TAG = "architecture stack";
  // Mode:'diff' is a v3-round sibling built on kstkBuildFrame (the seam
  // Documented in that function's own comment above): a two-pane before/
  // After view for refactor stories, entirely separate below this branch
  // From the mode-absent/'flow' behavior that follows — zero change to it.
  if (
    data.mode != null &&
    data.mode !== "flow" &&
    data.mode !== "diff" &&
    data.mode !== "journey"
  ) {
    throw new Error(TAG + ': mode must be "flow", "journey", or "diff" (got "' + data.mode + '")');
  }
  kitValidateTextCaps(host, "renderStack", data);
  if (data.mode === "diff") {
    return renderStackDiff(host, data, TAG);
  }
  if (data.mode === "journey") {
    return kstkRenderJourney(host, data, TAG);
  }
  let motionPreset = kdfEnsureMotionPreset();
  const lanes = data.lanes || [];
  const walkthrough = data.walkthrough || [];

  if (lanes.length === 0 || lanes.length > 4) {
    throw new Error(TAG + ": supports 1-4 lanes (got " + lanes.length + ")");
  }
  if (walkthrough.length > 6) {
    throw new Error(
      TAG + ": walkthrough supports at most 6 steps (got " + walkthrough.length + ")",
    );
  }
  // A descent split across slides keeps one numbering, exactly like sequence:
  // The continuation passes numberFrom so its handoff numbers carry on
  // Instead of restarting at 1 (see the 'continues' manifest field in
  // Base/present.js). numberFrom > 1 is also what makes this a CONTINUED
  // Part, and turns on the carry-over device (Fix 3).
  const numberFrom = data.numberFrom == null ? 1 : data.numberFrom;
  if (typeof numberFrom !== "number" || numberFrom < 1 || Math.floor(numberFrom) !== numberFrom) {
    throw new Error(TAG + ": numberFrom must be a positive integer (got " + data.numberFrom + ")");
  }
  const continued = numberFrom > 1;

  const laneById = {};
  const frameById = {};
  const frameOrder = [];
  const frameLaneId = {};
  const laneFirstFrame = {};
  let totalFrames = 0;

  lanes.forEach((lane) => {
    if (!lane.id || laneById[lane.id]) {
      throw new Error(TAG + ": lane ids must be unique");
    }
    laneById[lane.id] = lane;
    if (!lane.label) {
      throw new Error(TAG + ': lane "' + lane.id + '" label is required');
    }
    if (
      lane.weight != null &&
      (typeof lane.weight !== "number" ||
        !Number.isFinite(lane.weight) ||
        lane.weight < 0.5 ||
        lane.weight > 3)
    ) {
      throw new Error(
        TAG + ': lane "' + lane.id + '" weight must be numeric 0.5-3 (got ' + lane.weight + ")",
      );
    }
    if (
      lane.gutter != null &&
      (typeof lane.gutter !== "number" ||
        !Number.isFinite(lane.gutter) ||
        lane.gutter < 24 ||
        lane.gutter > 64)
    ) {
      throw new Error(
        TAG + ': lane "' + lane.id + '" gutter must be numeric 24-64 (got ' + lane.gutter + ")",
      );
    }
    var frames = lane.frames || [];
    if (!frames.length || frames.length > 8) {
      throw new Error(
        TAG + ': lane "' + lane.id + '" supports 1-8 frames (got ' + frames.length + ")",
      );
    }
    laneFirstFrame[lane.id] = frames[0].id;
    totalFrames += frames.length;
    frames.forEach(function (f) {
      if (!f.id || frameById[f.id]) {
        throw new Error(TAG + ": frame ids must be unique");
      }
      if (!f.fn) {
        throw new Error(TAG + ': frame "' + f.id + '" fn is required');
      }
      if (
        typeof f.depth !== "number" ||
        f.depth < 0 ||
        f.depth > 3 ||
        Math.floor(f.depth) !== f.depth
      ) {
        throw new Error(TAG + ': frame "' + f.id + '" depth must be 0-3 (got ' + f.depth + ")");
      }
      if (f.code && f.code.length) {
        if (!f.file) {
          throw new Error(TAG + ': frame "' + f.id + '" code requires file');
        }
        if (f.code.length > 4) {
          throw new Error(
            TAG +
              ': frame "' +
              f.id +
              '" code supports at most 4 lines (got ' +
              f.code.length +
              ")",
          );
        }
        if (f.hot != null && (f.hot < 0 || f.hot >= f.code.length)) {
          throw new Error(TAG + ': frame "' + f.id + '" hot index out of range');
        }
      } else if (f.hot != null) {
        throw new Error(TAG + ': frame "' + f.id + '" hot requires code');
      }
      var chips = f.chips || [];
      if (chips.length > 3) {
        throw new Error(
          TAG + ': frame "' + f.id + '" supports at most 3 chips (got ' + chips.length + ")",
        );
      }
      chips.forEach(function (c) {
        if (c.kind != null && c.kind !== "write" && c.kind !== "kill" && c.kind !== "plain") {
          throw new Error(
            TAG +
              ': frame "' +
              f.id +
              '" chip kind must be write, kill, or plain (got "' +
              c.kind +
              '")',
          );
        }
      });
      if (f.kind != null && f.kind !== "sync" && f.kind !== "async") {
        throw new Error(
          TAG + ': frame "' + f.id + '" kind must be "sync" or "async" (got "' + f.kind + '")',
        );
      }
      frameById[f.id] = f;
      frameOrder.push(f.id);
      frameLaneId[f.id] = lane.id;
    });
  });
  if (totalFrames > 18) {
    throw new Error(TAG + ": supports at most 18 frames total (got " + totalFrames + ")");
  }
  lanes.forEach((lane) => {
    var from = lane.handoff && lane.handoff.from;
    if (from && !frameById[from]) {
      throw new Error(
        TAG + ': lane "' + lane.id + '" handoff.from references unknown frame "' + from + '"',
      );
    }
    if (from && frameOrder.indexOf(from) >= frameOrder.indexOf(laneFirstFrame[lane.id])) {
      throw new Error(TAG + ': lane "' + lane.id + '" handoff.from must reference an earlier lane');
    }
    (lane.frames || []).forEach(function (frame) {
      if (frame.caller != null && !frameById[frame.caller]) {
        throw new Error(
          TAG + ': frame "' + frame.id + '" caller references unknown frame "' + frame.caller + '"',
        );
      }
      if (frame.caller === frame.id) {
        throw new Error(TAG + ': frame "' + frame.id + '" cannot call itself');
      }
    });
  });
  kstkCheckHeightBudgets(TAG, lanes);
  const callerOf = kstkComputeCallers(lanes);

  // `show` is a hard reference — a broken one would silently open nothing
  // In the UI it directly controls, so it throws, unlike an orphan `fire`
  // Id below (console.warn, same family convention sequence/erd already
  // Use for their own orphan-fire ids).
  walkthrough.forEach((step, idx) => {
    var stepName = step.title || idx;
    if (step.show != null && !frameById[step.show]) {
      throw new Error(
        TAG +
          ': walkthrough step "' +
          stepName +
          '" show references unknown frame "' +
          step.show +
          '"',
      );
    }
    if (step.routes != null && !Array.isArray(step.routes)) {
      throw new Error(TAG + ': walkthrough step "' + stepName + '" routes must be an array');
    }
    (step.routes || []).forEach(function (route, routeIdx) {
      if (!route || typeof route !== "object" || !route.from || !route.to) {
        throw new Error(
          TAG + ': walkthrough step "' + stepName + '" route ' + routeIdx + " requires from and to",
        );
      }
      if (!frameById[route.from]) {
        throw new Error(
          TAG +
            ': walkthrough step "' +
            stepName +
            '" route from references unknown frame "' +
            route.from +
            '"',
        );
      }
      if (!frameById[route.to]) {
        throw new Error(
          TAG +
            ': walkthrough step "' +
            stepName +
            '" route to references unknown frame "' +
            route.to +
            '"',
        );
      }
      if (callerOf[route.to] !== route.from) {
        throw new Error(
          TAG +
            ': walkthrough step "' +
            stepName +
            '" route "' +
            route.from +
            "→" +
            route.to +
            '" does not match the frame caller',
        );
      }
    });
    if (step.routeTo != null && !Array.isArray(step.routeTo)) {
      throw new Error(TAG + ': walkthrough step "' + stepName + '" routeTo must be an array');
    }
    (step.routeTo || []).forEach(function (fid) {
      if (!frameById[fid]) {
        throw new Error(
          TAG +
            ': walkthrough step "' +
            stepName +
            '" routeTo references unknown frame "' +
            fid +
            '"',
        );
      }
      if (!callerOf[fid]) {
        throw new Error(
          TAG +
            ': walkthrough step "' +
            stepName +
            '" routeTo frame "' +
            fid +
            '" has no caller route',
        );
      }
    });
  });

  // Bare host marker is 'kcs' (Kit Call-Stack), NOT a 'kstk'-prefixed class:
  // Every 'kstk'-prefixed name starts with the literal substring "kst",
  // Which collides with stepper's own pre-existing marker ('kst') inside
  // The shared breakout-selector exclusion list in base.css/its contract
  // Test — see that file's comment on the .kcs rule for the full story.
  // Chrome descendants (below) still use the spec'd 'kstk-' prefix
  // Throughout; only this bare host-level marker is renamed.
  host.classList.add("kcs");
  host.__kitBase = { kind: "stack" };
  host.dataset.motionPreset = motionPreset;

  // Fix 3 — a continued part connects upward instead of re-introducing
  // Itself: the lane headers drop to a recap tone (kstk-recap), a quiet
  // Marker at the top names the range already covered, and the descent rail
  // Reaches the canvas top edge (the carry path built with the overlay).
  const canvas = kitEl(
    "div",
    "kstk-canvas" + (lanes.length > 1 ? " kstk-map" : "") + (continued ? " kstk-recap" : ""),
  );
  canvas.style.setProperty("--kstk-lanes", String(lanes.length));
  if (lanes.length > 1) {
    canvas.style.gridTemplateColumns = lanes
      .map(function (lane) {
        return (lane.weight == null ? 1 : lane.weight) + "fr";
      })
      .join(" ");
  }
  canvas.setAttribute("role", "group");
  canvas.setAttribute(
    "aria-label",
    data.ariaLabel || `Call stack across ${lanes.length} lane${lanes.length === 1 ? "" : "s"}`,
  );
  if (continued) {
    canvas.appendChild(kitEl("div", "kstk-carry-mark", kdfCarryLabel(numberFrom)));
  }

  const frameRowEls = {};
  const codeCards = {};
  const asyncFrameEls = [];
  const frameClickHandlers = [];
  const handoffBannerEls = {};
  const handoffLegendItems = [];

  function setCodeOpen(fid, open) {
    kstkSetCodeOpen(frameRowEls, codeCards, fid, open);
  }

  // In scroll mode, clicking a frame with a code card toggles it open —
  // Independent of any walkthrough. Reduced motion: the base kit's own
  // global `transition:none!important` rule already kills the slide, so
  // The toggle itself needs no separate reduced-motion branch here.
  function renderFrameNodes(container, nodes) {
    nodes.forEach((node) => {
      var f = node.frame;
      var built = kstkBuildFrame(f);
      frameRowEls[f.id] = built.frameRow;
      if (built.codeCard) {
        codeCards[f.id] = built.codeCard;
        var toggle = function () {
          setCodeOpen(f.id, !built.frameRow.classList.contains("kstk-code-open"));
        };
        var onKey = function (e) {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        };
        built.frameRow.addEventListener("click", toggle);
        built.frameRow.addEventListener("keydown", onKey);
        frameClickHandlers.push({ el: built.frameRow, click: toggle, key: onKey });
      }
      if (f.kind === "async") {
        asyncFrameEls.push(built.frameRow);
      }
      container.appendChild(built.root);
      if (node.children.length) {
        var kids = kitEl("div", "kstk-kids");
        renderFrameNodes(kids, node.children);
        container.appendChild(kids);
      }
    });
  }

  const laneEls = {};
  const laneHandoffId = {}; // Lane id -> its own handoff legend entry (Fix 3)
  lanes.forEach((lane, laneIdx) => {
    if (lane.handoff) {
      var hid = "h" + laneIdx;
      var num = numberFrom + handoffLegendItems.length;
      var hand = kitEl("div", "kstk-handoff");
      hand.innerHTML =
        '<span class="kdf-legend-num">' +
        num +
        '</span><b class="kstk-handoff-rule"></b><span class="kstk-handoff-label">' +
        lane.handoff.label +
        "</span>";
      canvas.appendChild(hand);
      handoffBannerEls[hid] = hand;
      laneHandoffId[lane.id] = hid;
      var handoffTarget = laneFirstFrame[lane.id];
      if (!callerOf[handoffTarget] || frameLaneId[callerOf[handoffTarget]] === lane.id) {
        handoffTarget =
          (lane.frames || [])
            .map(function (frame) {
              return frame.id;
            })
            .find(function (fid) {
              return callerOf[fid] && frameLaneId[callerOf[fid]] !== lane.id;
            }) || handoffTarget;
      }
      handoffLegendItems.push({
        id: hid,
        num,
        label: lane.handoff.label,
        routeTo: handoffTarget,
      });
    }
    var laneEl = kitEl("div", "kstk-lane" + (lane.tone ? " " + lane.tone : ""));
    if (lane.gutter != null) {
      laneEl.style.setProperty("--kstk-gutter", lane.gutter + "px");
    }
    laneEl.innerHTML =
      '<div class="kstk-lane-head"><span>' +
      lane.label +
      "</span>" +
      (lane.sub ? "<small>" + lane.sub + "</small>" : "") +
      "</div>";
    var framesWrap = kitEl("div", "kstk-lane-frames");
    renderFrameNodes(framesWrap, kstkBuildTree(lane.frames));
    laneEl.appendChild(framesWrap);
    // Fix 1 — the Present-only collapsed strip sits alongside the full
    // frames wrap from the start (see kstkBuildCollapsedStrip's own
    // comment); which one is visible is a pure CSS class flip.
    laneEl.appendChild(kstkBuildCollapsedStrip(lane));
    laneEls[lane.id] = laneEl;
    canvas.appendChild(laneEl);
  });

  // The descent-path SVG overlay. Mirrors mode:'diff's own kstk-diff-ribbons
  // Plumbing below (an absolutely-positioned <svg> laid over the plain-HTML
  // Canvas, geometry computed on demand from real getBoundingClientRect()
  // Layout): one <path> per frame that HAS a caller (kstkComputeCallers — the
  // Stack's very first frame has none), plus, in a continued part only, one
  // Carry-over rail arriving from off-canvas above (Fix 3).
  //
  // These routes are STRUCTURE, not motion: "this call goes here" is a fact.
  // They are painted the moment the geometry is known and stay painted; a
  // Walkthrough step only restyles them (see applyStep). Nothing here ever
  // Draws on, redraws, or animates — that draw-on is exactly what made the
  // Stack unreadable ("the lines animation is what's making this confusing").
  const kstkUid = "kstk-" + ++kitStackSeq;
  const descentSvg = svgEl("svg", { class: "kstk-descent-svg", "aria-hidden": "true" }, canvas);
  const descentDefs = svgEl("defs", {}, descentSvg);
  const arrowAccent = svgEl(
    "marker",
    {
      id: kstkUid + "-arrow-accent",
      markerWidth: "9",
      markerHeight: "9",
      refX: "8",
      refY: "5",
      orient: "auto",
      markerUnits: "userSpaceOnUse",
      viewBox: "0 0 10 10",
    },
    descentDefs,
  );
  svgEl("path", { class: "kstk-arrow-head", d: "M1,1 L8,5 L1,9" }, arrowAccent);
  const arrowViolet = svgEl(
    "marker",
    {
      id: kstkUid + "-arrow-violet",
      markerWidth: "9",
      markerHeight: "9",
      refX: "8",
      refY: "5",
      orient: "auto",
      markerUnits: "userSpaceOnUse",
      viewBox: "0 0 10 10",
    },
    descentDefs,
  );
  svgEl("path", { class: "kstk-arrow-head async", d: "M1,1 L8,5 L1,9" }, arrowViolet);
  // Fix 3 — the carry-over rail fades in from the canvas top edge, so the
  // Flow visibly arrives from off-screen above instead of starting here. The
  // Fade is a gradient on the stroke; the id is per-instance, so the stroke
  // Reference has to be inline (a stylesheet cannot know this uid).
  const carryGrad = svgEl(
    "linearGradient",
    {
      id: kstkUid + "-carry",
      gradientUnits: "userSpaceOnUse",
      x1: "0",
      y1: "0",
      x2: "0",
      y2: String(KSTK_CARRY_FADE),
    },
    descentDefs,
  );
  svgEl("stop", { class: "kstk-carry-stop", offset: "0", "stop-opacity": "0" }, carryGrad);
  svgEl("stop", { class: "kstk-carry-stop", offset: "1", "stop-opacity": "1" }, carryGrad);
  const pathLayer = document.createElementNS(kdfNS, "g");
  pathLayer.setAttribute("class", "kstk-path-layer");
  descentSvg.append(pathLayer);

  const laneIndexById = {};
  lanes.forEach((lane, idx) => {
    laneIndexById[lane.id] = idx;
  });
  const outgoingCrossRoutes = {};
  frameOrder.forEach((fid) => {
    var callerId = callerOf[fid];
    if (!callerId || frameLaneId[callerId] === frameLaneId[fid]) {
      return;
    }
    if (!outgoingCrossRoutes[callerId]) {
      outgoingCrossRoutes[callerId] = [];
    }
    outgoingCrossRoutes[callerId].push(fid);
  });
  const crossRouteMeta = {};
  Object.keys(outgoingCrossRoutes).forEach((callerId) => {
    var siblings = outgoingCrossRoutes[callerId];
    siblings.forEach(function (fid, idx) {
      crossRouteMeta[fid] = {
        portOffset: (idx - (siblings.length - 1) / 2) * 12,
        trackOffset: (idx - (siblings.length - 1) / 2) * 12,
        returnOffset: idx * 12,
        corridorOffset: idx * 6,
      };
    });
  });
  const pathEls = {};
  let carryFid = null;
  frameOrder.forEach((fid, idx) => {
    var callerId = callerOf[fid];
    var carry = !callerId && idx === 0 && continued;
    if (!callerId && !carry) {
      return;
    } // the stack's very first frame — no caller to draw from
    var kind = frameById[fid].kind === "async" ? "async" : "sync";
    var markerId = kind === "async" ? arrowViolet.id : arrowAccent.id;
    var el = svgEl(
      "path",
      {
        class:
          "kstk-descent-path" +
          (kind === "async" ? " async" : "") +
          (carry ? " kstk-carry-path" : ""),
        "data-frame": fid,
        "data-caller": callerId || "",
        "marker-end": "url(#" + markerId + ")",
      },
      pathLayer,
    );
    if (carry) {
      el.style.stroke = "url(#" + carryGrad.id + ")";
      carryFid = fid;
    }
    pathEls[fid] = el;
  });
  const routeMarkerLayer = svgEl("g", { class: "kstk-route-marker-layer" }, descentSvg);
  const routeMarkerEls = {};
  handoffLegendItems.forEach((item) => {
    var marker = svgEl(
      "g",
      { class: "kstk-route-marker", "data-handoff": item.id },
      routeMarkerLayer,
    );
    svgEl("circle", { class: "kstk-route-marker-badge", cx: "0", cy: "0", r: "9" }, marker);
    var markerText = svgEl(
      "text",
      { class: "kstk-route-marker-text", x: "0", y: "0", dy: ".35em", "text-anchor": "middle" },
      marker,
    );
    markerText.textContent = item.num;
    routeMarkerEls[item.id] = { root: marker, path: pathEls[item.routeTo] || null };
  });

  const unwindEl = kitEl("div", "kstk-unwind");
  unwindEl.setAttribute("aria-hidden", "true");
  canvas.append(unwindEl);
  host.append(canvas);

  // Legend: handoff numbers, same kdf-legend markup/hover as sequence/erd.
  // Only when the stack mixes sync and async frames, one auto-appended
  // Entry decodes the solid/dashed connector convention — never authored,
  // And never present on an all-sync stack.
  const hasAsync = frameOrder.some(function (fid) {
    return frameById[fid].kind === "async";
  });
  let legend = null;
  const legendItemEls = {};
  let kindLegendEl = null;
  if (handoffLegendItems.length > 0 || hasAsync) {
    legend = kitEl("div", "kdf-legend");
    legend.setAttribute("role", "list");
    handoffLegendItems.forEach((item) => {
      var li = kitEl("div", "kdf-legend-item");
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
    if (hasAsync) {
      kindLegendEl = kitEl("div", "kdf-legend-item kstk-kind-legend");
      kindLegendEl.setAttribute("role", "listitem");
      kindLegendEl.innerHTML =
        '<span class="kdf-legend-num" aria-hidden="true"></span><span class="kdf-legend-text">solid — blocks · dashed — fires and continues</span>';
      legend.append(kindLegendEl);
    }
    host.append(legend);
  }
  const hoverHandlers = [];
  handoffLegendItems.forEach((item) => {
    var li = legendItemEls[item.id];
    var banner = handoffBannerEls[item.id];
    var routeMarker = routeMarkerEls[item.id];
    var enter = function () {
      if (banner) {
        banner.classList.add("hover");
      }
      if (routeMarker) {
        routeMarker.root.classList.add("hover");
      }
      if (routeMarker && routeMarker.path) {
        routeMarker.path.classList.add("kstk-path-hover");
      }
    };
    var leave = function () {
      if (banner) {
        banner.classList.remove("hover");
      }
      if (routeMarker) {
        routeMarker.root.classList.remove("hover");
      }
      if (routeMarker && routeMarker.path) {
        routeMarker.path.classList.remove("kstk-path-hover");
      }
    };
    li.addEventListener("mouseenter", enter);
    li.addEventListener("mouseleave", leave);
    hoverHandlers.push({ li, enter, leave });
  });

  // ── Fix 1 — Present-only lane collapse. A lane not touched by the active
  // Walkthrough step (or, with no step active, any lane past the first)
  // Renders as kstkBuildCollapsedStrip's compact strip instead of its full
  // Frame list — CSS-scoped .pr-stage (architecture.css), the same
  // Present-only convention every other override in this file already
  // Uses, so scroll mode ("everything visible") never sees it regardless
  // Of which classes JS sets. ──
  // A lane a step fires into is ALWAYS expanded — that is the whole point:
  // A step that lights frames inside a collapsed lane shows the audience
  // Nothing. The step's code-card focus counts as touched too (`show` may
  // Name a frame the step never fires, and a card can only open inside an
  // Expanded lane).
  function touchedLanesForStep(step) {
    const t = {};
    (step.fire || []).forEach((fid) => {
      if (frameById[fid]) {
        t[frameLaneId[fid]] = true;
      }
    });
    const shown = step.show != null ? step.show : defaultShow(step);
    if (shown && frameById[shown]) {
      t[frameLaneId[shown]] = true;
    }
    return t;
  }
  function isWideMap() {
    return (
      canvas.classList.contains("kstk-map") && window.getComputedStyle(canvas).display === "grid"
    );
  }
  function alignPresentLanes() {
    lanes.forEach((lane) => {
      laneEls[lane.id].querySelector(".kstk-lane-frames").style.marginTop = "";
    });
    if (canvas.classList.contains("kstk-map") || !canvas.classList.contains("kstk-present-wide")) {
      return;
    }
    lanes.slice(1).forEach((lane) => {
      var first = laneFirstFrame[lane.id],
        caller = callerOf[first];
      if (!caller) {
        return;
      }
      var from = frameRowEls[caller].getBoundingClientRect(),
        to = frameRowEls[first].getBoundingClientRect();
      var matrix = descentSvg.getScreenCTM(),
        scaleY = matrix ? Math.hypot(matrix.c, matrix.d) : 1;
      var offset = Math.max(0, from.top + from.height / 2 - to.top - to.height / 2) / (scaleY || 1);
      laneEls[lane.id].querySelector(".kstk-lane-frames").style.marginTop = offset + "px";
    });
  }
  function applyLaneCollapse(touchedLaneIds) {
    const fixedMap = canvas.classList.contains("kstk-map");
    const presentWide =
      !fixedMap &&
      document.body.classList.contains("presenting") &&
      Boolean(canvas.closest(".pr-stage"));
    canvas.classList.toggle("kstk-present-wide", presentWide);
    lanes.forEach((lane) => {
      laneEls[lane.id].classList.toggle(
        "kstk-lane-untouched",
        !fixedMap && !presentWide && !touchedLaneIds[lane.id],
      );
    });
    alignPresentLanes();
    layoutDescentPaths();
  }
  // The last two rungs of the height ladder (collapse → close cards →
  // Kstk-tight → throw): if what is left STILL overruns the Present stage
  // Budget, step the type down one notch. Never a cap, never a scroller —
  // And never in scroll mode, where "everything visible" already holds.
  // Synchronous on purpose: present.js's measureSteps() walks every step
  // And reads the stage height straight after each go(), so anything
  // Deferred to a rAF would be measured one step late and mis-scale the
  // Whole slide.
  function fitStage() {
    canvas.classList.remove("kstk-tight");
    if (canvas.classList.contains("kstk-map") || !document.body.classList.contains("presenting")) {
      return;
    }
    if (canvas.offsetHeight > kstkPresentCanvasBudget(host, canvas)) {
      canvas.classList.add("kstk-tight");
    }
  }

  // ── The descent is drawn, once, as structure. Each frame's own connector
  // (built above) runs caller to callee and ends in the arrowhead that lands
  // On the frame; sync is solid, async dashed (the family's own grammar), and
  // Both are painted at a resting tone from the first layout pass onward. A
  // Step lights the routes it fires and nothing more — see applyStep. ──
  // A frame's anchor is its own row; a frame inside a COLLAPSED lane
  // Anchors on that lane's compact strip instead — the strip is what the
  // Lane looks like right now, so a descent arriving from a lane the step
  // Does not expand still starts somewhere real rather than being dropped.
  function screenToLocal(x, y) {
    const matrix = descentSvg.getScreenCTM();
    if (!matrix) {
      return null;
    }
    let point = descentSvg.createSVGPoint();
    point.x = x;
    point.y = y;
    point = point.matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  }
  function anchorFor(fid, edge, portOffset) {
    let el = frameRowEls[fid];
    if (!el) {
      return null;
    }
    if (laneCollapsedFor(fid)) {
      const stripLane = laneEls[frameLaneId[fid]];
      const strip = stripLane && stripLane.querySelector(".kstk-lane-collapsed");
      if (!strip) {
        return null;
      }
      el = strip;
    }
    const r = el.getBoundingClientRect();
    if (!r.height || !descentSvg.getScreenCTM()) {
      return null;
    }
    const offset = portOffset || 0;
    const gap = isWideMap() ? 0 : 6;
    let anchor;
    if (edge === "top") {
      anchor = screenToLocal(r.left + r.width / 2 + offset, r.top);
      anchor.y -= gap;
      return anchor;
    }
    if (edge === "bottom") {
      anchor = screenToLocal(r.left + r.width / 2 + offset, r.bottom);
      anchor.y += gap;
      return anchor;
    }
    if (edge === "right") {
      anchor = screenToLocal(r.right, r.top + r.height / 2 + offset);
      anchor.x += gap;
      return anchor;
    }
    anchor = screenToLocal(r.left, r.top + r.height / 2 + offset);
    anchor.x -= gap;
    return anchor;
  }
  function laneCollapsedFor(fid) {
    const laneId = frameLaneId[fid],
      laneEl = laneId && laneEls[laneId];
    return laneEl ? laneEl.classList.contains("kstk-lane-untouched") : false;
  }
  // A path reaches its target frame completely or it does not render at all.
  // Three ways it used to end up half-drawn, all still guarded here:
  // (1) a zeroed `d` still paints marker-end, leaving a stub arrowhead
  //     Floating beside a frame with no line attached — hidden paths leave
  //     The render tree (kstk-path-hidden) instead;
  // (2) a target frame inside a collapsed lane has no visible position, so
  //     The path would run to a point that isn't there — it doesn't render;
  // (3) the dash pattern used to be inline state left over from a draw-on's
  //     Own stroke-dasharray, stale after a relayout. There is no draw-on
  //     Any more: async dashing is a plain CSS rule on .async, so no inline
  //     Dash/offset is ever set and nothing can go stale.
  function hidePath(pathEl) {
    pathEl.classList.add("kstk-path-hidden");
    pathEl.setAttribute("d", "M0 0");
  }
  function laneLocalRect(laneId) {
    const laneEl = laneEls[laneId];
    if (!laneEl) {
      return null;
    }
    const r = laneEl.getBoundingClientRect();
    const tl = screenToLocal(r.left, r.top),
      br = screenToLocal(r.right, r.bottom);
    return tl && br ? { bottom: br.y, left: tl.x, right: br.x, top: tl.y } : null;
  }
  function polylinePath(points) {
    return points.map((point, idx) => (idx ? " L" : "M") + point.x + " " + point.y).join("");
  }
  function layoutRouteMarkers() {
    Object.keys(routeMarkerEls).forEach((hid) => {
      var marker = routeMarkerEls[hid],
        pathEl = marker.path;
      if (!pathEl || pathEl.classList.contains("kstk-path-hidden")) {
        marker.root.classList.add("kstk-route-marker-hidden");
        return;
      }
      var length = pathEl.getTotalLength();
      if (!length) {
        marker.root.classList.add("kstk-route-marker-hidden");
        return;
      }
      var point = pathEl.getPointAtLength(length * 0.5);
      marker.root.setAttribute("transform", "translate(" + point.x + " " + point.y + ")");
      marker.root.classList.remove("kstk-route-marker-hidden");
    });
  }
  function layoutDescentPaths() {
    const wideMap = isWideMap();
    Object.keys(pathEls).forEach((fid) => {
      var pathEl = pathEls[fid],
        callerId = callerOf[fid];
      // the target frame itself must be on screen for a connector to mean
      // anything — a caller in a collapsed lane still anchors (its strip)
      if (laneCollapsedFor(fid) && laneFirstFrame[frameLaneId[fid]] !== fid) {
        hidePath(pathEl);
        return;
      }
      var crossLane = callerId && frameLaneId[callerId] !== frameLaneId[fid];
      var presentWide = canvas.classList.contains("kstk-present-wide");
      var callerLaneIndex = crossLane ? laneIndexById[frameLaneId[callerId]] : -1;
      var targetLaneIndex = crossLane ? laneIndexById[frameLaneId[fid]] : -1;
      var movesRight = callerLaneIndex < targetLaneIndex;
      var routeMeta = crossRouteMeta[fid] || {
        portOffset: 0,
        trackOffset: 0,
        returnOffset: 0,
        corridorOffset: 0,
      };
      var sideRoute = crossLane && (wideMap || presentWide);
      var b = anchorFor(
        fid,
        crossLane
          ? sideRoute
            ? movesRight
              ? "left"
              : "right"
            : "top"
          : fid === carryFid
            ? "top"
            : "left",
      );
      // the carry-over rail has no caller on this slide: it comes straight
      // down from the canvas top edge (Fix 3)
      var a =
        fid === carryFid
          ? b
            ? { x: b.x, y: 0 }
            : null
          : anchorFor(
              callerId,
              crossLane ? (sideRoute ? (movesRight ? "right" : "left") : "bottom") : "left",
              wideMap && crossLane ? routeMeta.portOffset : 0,
            );
      if (!a || !b) {
        hidePath(pathEl);
        return;
      }
      // a degenerate route (caller and callee resolved to the same point)
      // would render as that same stub arrowhead — nothing to draw
      if (Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1) {
        hidePath(pathEl);
        return;
      }
      pathEl.classList.remove("kstk-path-hidden");
      var d;
      if (fid === carryFid || Math.abs(a.x - b.x) < 0.5) {
        d = "M" + a.x + " " + a.y + " L" + b.x + " " + b.y;
      } else if (crossLane && wideMap) {
        var callerLaneRect = laneLocalRect(frameLaneId[callerId]);
        var targetLaneRect = laneLocalRect(frameLaneId[fid]);
        var adjacent = Math.abs(callerLaneIndex - targetLaneIndex) === 1;
        var trackX =
          adjacent && movesRight
            ? (callerLaneRect.right + targetLaneRect.left) / 2 + routeMeta.trackOffset
            : movesRight
              ? callerLaneRect.right + 12 + routeMeta.returnOffset
              : callerLaneRect.left - 18 - routeMeta.returnOffset;
        if (adjacent) {
          d = polylinePath([a, { x: trackX, y: a.y }, { x: trackX, y: b.y }, b]);
        } else {
          var targetTrackX = movesRight
            ? targetLaneRect.left - 12 - routeMeta.trackOffset
            : targetLaneRect.right + 12 + routeMeta.trackOffset;
          var corridorY = 10 + routeMeta.corridorOffset;
          d = polylinePath([
            a,
            { x: trackX, y: a.y },
            { x: trackX, y: corridorY },
            { x: targetTrackX, y: corridorY },
            { x: targetTrackX, y: b.y },
            b,
          ]);
        }
      } else if (crossLane && presentWide) {
        var control = Math.max(18, Math.abs(b.x - a.x) * 0.42);
        var direction = b.x > a.x ? 1 : -1;
        d =
          "M" +
          a.x +
          " " +
          a.y +
          " C" +
          (a.x + direction * control) +
          " " +
          a.y +
          " " +
          (b.x - direction * control) +
          " " +
          b.y +
          " " +
          b.x +
          " " +
          b.y;
      } else if (crossLane) {
        var midY = a.y + (b.y - a.y) / 2;
        var crossR = Math.min(10, Math.abs(a.x - b.x) / 2, Math.abs(b.y - a.y) / 4);
        var crossSign = b.x > a.x ? 1 : -1;
        d =
          "M" +
          a.x +
          " " +
          a.y +
          " L" +
          a.x +
          " " +
          (midY - crossR) +
          " Q" +
          a.x +
          " " +
          midY +
          " " +
          (a.x + crossSign * crossR) +
          " " +
          midY +
          " L" +
          (b.x - crossSign * crossR) +
          " " +
          midY +
          " Q" +
          b.x +
          " " +
          midY +
          " " +
          b.x +
          " " +
          (midY + crossR) +
          " L" +
          b.x +
          " " +
          b.y;
      } else if (wideMap) {
        var sameLaneRect = laneLocalRect(frameLaneId[fid]);
        var depthTrackX = sameLaneRect.left + 6;
        d = polylinePath([a, { x: depthTrackX, y: a.y }, { x: depthTrackX, y: b.y }, b]);
      } else {
        var sameR = Math.min(10, Math.abs(a.x - b.x) / 2, Math.abs(b.y - a.y) / 2);
        var sameSignX = b.x > a.x ? 1 : -1;
        var sameSignY = b.y > a.y ? 1 : -1;
        d =
          "M" +
          a.x +
          " " +
          a.y +
          " L" +
          a.x +
          " " +
          (b.y - sameSignY * sameR) +
          " Q" +
          a.x +
          " " +
          b.y +
          " " +
          (a.x + sameSignX * sameR) +
          " " +
          b.y +
          " L" +
          b.x +
          " " +
          b.y;
      }
      pathEl.setAttribute("d", d);
    });
    layoutRouteMarkers();
  }
  function ambientDwellMs() {
    return motionPreset === "calm" ? 520 : 330;
  }
  function unwindMs() {
    return motionPreset === "calm" ? 1500 : 900;
  }

  const stepTimers = [];
  function trackStepTimer(fn, ms) {
    const t = setTimeout(function () {
      var i = stepTimers.indexOf(t);
      if (i > -1) {
        stepTimers.splice(i, 1);
      }
      fn();
    }, ms);
    stepTimers.push(t);
    return t;
  }
  // ── ambient — a slow attention pass down the frames in authored order,
  // Then the unwind rail lights on the way back up, a pause, repeat. It
  // Moves EMPHASIS only: every route is already on the canvas, so a pass
  // Brightens the frame it reaches and the route that arrives there and
  // Then hands both back to their resting tone. Nothing is drawn, nothing
  // Appears, and the lane collapse the current shape settled on is left
  // Exactly as it is — a frame inside a collapsed lane simply has no
  // Visible turn and is skipped. Async frames additionally carry their own
  // Continuous glow the whole time ambient runs (data-flow's async-edge
  // Convention, in miniature). Reuses kdfAmbientCycle (shared with
  // Sequence/erd) — the unwind is one extra virtual id at the end. ──
  const UNWIND_ID = "__kstk-unwind__";
  function runUnwind(onDone) {
    unwindEl.classList.add("kstk-unwind-on");
    trackStepTimer(() => {
      unwindEl.classList.remove("kstk-unwind-on");
      onDone();
    }, unwindMs());
  }
  function ambientFire(id, onDone) {
    if (id === UNWIND_ID) {
      runUnwind(onDone);
      return;
    }
    if (laneCollapsedFor(id)) {
      onDone();
      return;
    } // No visible turn to take
    const el = frameRowEls[id];
    let pathEl = pathEls[id];
    if (pathEl && pathEl.classList.contains("kstk-path-hidden")) {
      pathEl = null;
    }
    if (el) {
      el.classList.add("kstk-lit");
    }
    if (pathEl) {
      pathEl.classList.add("kstk-path-pass");
    }
    trackStepTimer(() => {
      if (el) {
        el.classList.remove("kstk-lit");
      }
      if (pathEl) {
        pathEl.classList.remove("kstk-path-pass");
      }
      onDone();
    }, ambientDwellMs());
  }
  const ambient = kdfAmbientCycle(
    frameOrder.concat([UNWIND_ID]),
    ambientFire,
    function () {
      return motionPreset === "calm" ? 140 : 70;
    },
    function () {
      return motionPreset === "calm" ? 2200 : 1300;
    },
  );

  function startAmbient() {
    if (motionPreset === "off" || !MOTION) {
      return;
    }
    asyncFrameEls.forEach((el) => {
      el.classList.add("kstk-async-live");
    });
    ambient.start();
  }
  // Clears ambient's own transient marks ONLY — a step's emphasis
  // (.kstk-path-lit / .active) belongs to the step and survives, so
  // OnWalkGo can stop ambient before applying a step without a flicker.
  function stopAmbient() {
    ambient.stop();
    asyncFrameEls.forEach((el) => {
      el.classList.remove("kstk-async-live");
    });
    Object.keys(frameRowEls).forEach((fid) => {
      frameRowEls[fid].classList.remove("kstk-lit");
    });
    Object.keys(pathEls).forEach((fid) => {
      pathEls[fid].classList.remove("kstk-path-pass");
    });
    unwindEl.classList.remove("kstk-unwind-on");
    stepTimers.forEach((timer) => clearTimeout(timer));
    stepTimers.length = 0;
  }

  // ── walkthrough: touched frames highlight, the rest dim (same
  // Focus/dim convention the whole family uses); the step's `show` frame
  // (default: the last fired frame that carries code) slides its code
  // Card open, every other card closes — in Present AND scroll mode alike
  // (scroll mode's own "everything visible" promise is about frames, not
  // Code cards, which have always been click-to-toggle/one-at-a-time
  // During a walkthrough). Lane collapse (Fix 1) is Present-only by CSS
  // Scoping alone, so computing it unconditionally here is safe. ──
  function applyStep(step) {
    const fireIds = step ? step.fire || [] : [];
    const active = {};
    fireIds.forEach((fid) => {
      if (frameById[fid]) {
        active[fid] = true;
      } else {
        console.warn(
          '[architecture] stack step "' +
            (step.title || "step") +
            '" fires unknown frame "' +
            fid +
            '"',
        );
      }
    });
    canvas.classList.toggle("walking", Boolean(step));
    Object.keys(frameRowEls).forEach((fid) => {
      frameRowEls[fid].classList.toggle("active", Boolean(active[fid]));
    });
    const activeRoutes = {};
    if (step) {
      if (step.routes != null || step.routeTo != null) {
        (step.routes || []).forEach((route) => {
          activeRoutes[route.to] = true;
        });
        (step.routeTo || []).forEach((fid) => {
          activeRoutes[fid] = true;
        });
      } else {
        fireIds.forEach((fid) => {
          if (pathEls[fid]) {
            activeRoutes[fid] = true;
          }
        });
      }
    }
    // A step owns the EMPHASIS, never the structure: the routes it fires
    // Light, every other route drops to its resting tone, and not one path
    // Appears, disappears or redraws on the way.
    Object.keys(pathEls).forEach((fid) => {
      pathEls[fid].classList.toggle("kstk-path-lit", Boolean(activeRoutes[fid]));
    });
    const touched = step ? touchedLanesForStep(step) : defaultOverviewTouch();
    applyLaneCollapse(touched);
    applyLegend(step, touched, fireIds, activeRoutes);
  }
  // ── Fix 3 — the legend tracks the walk. Same family convention
  // Data-flow/sequence/erd already use (kdf-legend-item .active/.dim, both
  // Styled in data-flow.css): the handoff number of every lane this step
  // Touches switches on — that IS the number the step is walking towards —
  // The solid/dashed key switches on when the step fires an async frame,
  // And everything else dims. Nothing dims outside a step: the overview
  // Shows the whole key at rest. ──
  function applyLegend(step, touchedLaneIds, fireIds, activeRoutes) {
    if (!legend) {
      return;
    }
    const onIds = {};
    Object.keys(touchedLaneIds).forEach((laneId) => {
      if (laneHandoffId[laneId]) {
        onIds[laneHandoffId[laneId]] = true;
      }
    });
    handoffLegendItems.forEach((item) => {
      var on =
        Boolean(step) &&
        (canvas.classList.contains("kstk-map")
          ? Boolean(activeRoutes[item.routeTo])
          : Boolean(onIds[item.id]));
      legendItemEls[item.id].classList.toggle("active", on);
      legendItemEls[item.id].classList.toggle("dim", Boolean(step) && !on);
      if (handoffBannerEls[item.id]) {
        handoffBannerEls[item.id].classList.toggle("kstk-handoff-on", on);
      }
      if (routeMarkerEls[item.id]) {
        routeMarkerEls[item.id].root.classList.toggle("active", on);
      }
    });
    if (kindLegendEl) {
      const kindOn =
        Boolean(step) &&
        fireIds.some(function (fid) {
          return frameById[fid] && frameById[fid].kind === "async";
        });
      kindLegendEl.classList.toggle("active", kindOn);
      kindLegendEl.classList.toggle("dim", Boolean(step) && !kindOn);
    }
  }
  // No active step: nothing is "touched" by a walkthrough, so default to
  // The first lane expanded (a stable, deterministic starting shape) —
  // Ambient's own per-hop lane-following (below) takes over from there the
  // Moment motion is allowed to run.
  function defaultOverviewTouch() {
    const t = {};
    if (data.view === "full") {
      lanes.forEach((lane) => {
        t[lane.id] = true;
      });
      return t;
    }
    if (lanes.length > 0) {
      t[lanes[0].id] = true;
    }
    return t;
  }
  function defaultShow(step) {
    const fire = step.fire || [];
    for (let i = fire.length - 1; i >= 0; i--) {
      if (codeCards[fire[i]]) {
        return fire[i];
      }
    }
    return null;
  }
  function applyShow(step) {
    Object.keys(codeCards).forEach((fid) => {
      setCodeOpen(fid, false);
    });
    if (!step) {
      return;
    }
    const target = step.show != null ? step.show : defaultShow(step);
    if (target && codeCards[target]) {
      setCodeOpen(target, true);
    }
  }
  // Every rung runs synchronously, in reduction order: stop ambient, mark
  // The step, collapse what it doesn't touch, close every card but its
  // Focus, step the type down if that still overruns, and only then lay
  // Out the routes against the geometry all of that settled on. Present's
  // MeasureSteps() reads the stage height immediately after this returns,
  // So nothing here may be deferred to a timer or a rAF — and with the
  // Collapse now a display flip rather than an eased max-height, there is
  // No later "settle" pass to wait for either.
  function onWalkGo(current, step) {
    stopAmbient();
    const displayStep = data.view === "full" ? null : step;
    applyStep(displayStep);
    applyShow(displayStep);
    fitStage();
    alignPresentLanes();
    layoutDescentPaths();
    if (!step) {
      startAmbient();
    }
  }
  const walkApi = kdfBuildWalk(host, walkthrough, {
    overviewTitle: (data.overview && data.overview.title) || "Watch the descent →",
    overviewBody:
      (data.overview && (data.overview.note != null ? data.overview.note : data.overview.body)) ||
      "One request travels down through the lanes; guards can exit early, side effects land as chips.",
    onGo: onWalkGo,
  });
  const walkEl = host.lastElementChild;
  const footer = kitEl("div", "kstk-footer");
  if (legend) {
    footer.appendChild(legend);
  }
  footer.append(walkEl);
  host.append(footer);

  let layoutRaf = 0,
    settleRaf = 0;
  function settleLayout() {
    const presentWide =
      document.body.classList.contains("presenting") && Boolean(canvas.closest(".pr-stage"));
    if (canvas.classList.contains("kstk-map") || !presentWide) {
      canvas.classList.remove("kstk-present-wide", "kstk-tight");
      lanes.forEach((lane) => {
        laneEls[lane.id].classList.remove("kstk-lane-untouched");
      });
    }
    alignPresentLanes();
    fitStage();
    layoutDescentPaths();
  }
  function scheduleLayout() {
    cancelAnimationFrame(layoutRaf);
    cancelAnimationFrame(settleRaf);
    layoutRaf = requestAnimationFrame(() => {
      settleRaf = requestAnimationFrame(settleLayout);
    });
  }
  function onResize() {
    scheduleLayout();
  }
  function onPresentChange() {
    scheduleLayout();
  }
  const stackResizeObserver =
    typeof ResizeObserver === "function" ? new ResizeObserver(scheduleLayout) : null;
  if (stackResizeObserver) {
    stackResizeObserver.observe(canvas);
  }
  window.addEventListener("resize", onResize);
  window.addEventListener("fullscreenchange", scheduleLayout);
  window.addEventListener("kitpresentchange", onPresentChange);

  function onMotionPresetChange(e) {
    const preset = e && e.detail ? e.detail.preset : kdfEnsureMotionPreset();
    if (!["calm", "normal", "off"].includes(preset)) {
      return;
    }
    motionPreset = preset;
    host.dataset.motionPreset = preset;
    // The routes themselves are structure and stay painted under every
    // Preset, 'off' included — stopAmbient() only takes back the pass light.
    stopAmbient();
    if (!walkApi.current() && preset !== "off" && MOTION) {
      startAmbient();
    }
  }
  window.addEventListener("kitmotionpresetchange", onMotionPresetChange);

  host.__kitDispose = function __kitDispose() {
    stopAmbient();
    walkApi.dispose();
    window.removeEventListener("kitmotionpresetchange", onMotionPresetChange);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("fullscreenchange", scheduleLayout);
    window.removeEventListener("kitpresentchange", onPresentChange);
    if (stackResizeObserver) {
      stackResizeObserver.disconnect();
    }
    cancelAnimationFrame(layoutRaf);
    cancelAnimationFrame(settleRaf);
    frameClickHandlers.forEach((h) => {
      h.el.removeEventListener("click", h.click);
      h.el.removeEventListener("keydown", h.key);
    });
    hoverHandlers.forEach((h) => {
      h.li.removeEventListener("mouseenter", h.enter);
      h.li.removeEventListener("mouseleave", h.leave);
    });
  };
  walkApi.go(0);
  return { count: walkthrough.length + 1, current: walkApi.current, go: walkApi.go };
}

/* ── renderStack mode:'diff' ── the refactor story: two panes (before →
   after), the change model derived by matching frame `id` across sides
   (never a hand-authored flag, except the one documented exception below),
   move ribbons connecting a changed frame's two positions, and a path-bar
   diff for a frame that changed files. See CONTRACTS.md#stack-diff.

   Built entirely on kstkBuildFrame (the seam the base round factored for
   exactly this): each pane is its own lane/frame tree, rendered by the same
   kstkBuildTree + kstkBuildFrame calls the flow branch above uses, then
   decorated in place (badges, path-bar diff, rename pill) — frame rendering
   itself is never forked. */

// Per-side validation, mirroring the flow branch's own cap set (lanes 1-4,
// Frames 1-8 per lane / <=18 total, every per-frame cap) plus the one
// Diff-only field (`was`, after-side only). Kept as its own function rather
// Than reused from the flow branch above: that branch is pinned, referee'd
// Behavior (see renderStack's own header comment) and inlines its checks
// Directly into frameById/frameOrder construction for a single side, so
// Sharing it would mean either changing its shape (risking the frozen
// Mode-absent behavior) or wrapping it twice for no real gain — this is
// Deliberate, bounded duplication, not a missed extraction.
function kstkValidateDiffSide(TAG, side, lanes) {
  if (!lanes || lanes.length === 0 || lanes.length > 4) {
    throw new Error(
      TAG + ": " + side + ".lanes supports 1-4 lanes (got " + (lanes ? lanes.length : 0) + ")",
    );
  }
  const laneById = {},
    frameById = {},
    frameOrder = [],
    frameMeta = {};
  let totalFrames = 0;
  lanes.forEach((lane, laneIdx) => {
    if (!lane.id || laneById[lane.id]) {
      throw new Error(TAG + ": " + side + " lane ids must be unique");
    }
    laneById[lane.id] = lane;
    if (!lane.label) {
      throw new Error(TAG + ": " + side + ' lane "' + lane.id + '" label is required');
    }
    var frames = lane.frames || [];
    if (!frames.length || frames.length > 8) {
      throw new Error(
        TAG +
          ": " +
          side +
          ' lane "' +
          lane.id +
          '" supports 1-8 frames (got ' +
          frames.length +
          ")",
      );
    }
    totalFrames += frames.length;
    frames.forEach(function (f) {
      if (!f.id || frameById[f.id]) {
        throw new Error(TAG + ": " + side + " frame ids must be unique");
      }
      if (!f.fn) {
        throw new Error(TAG + ": " + side + ' frame "' + f.id + '" fn is required');
      }
      if (
        typeof f.depth !== "number" ||
        f.depth < 0 ||
        f.depth > 3 ||
        Math.floor(f.depth) !== f.depth
      ) {
        throw new Error(
          TAG + ": " + side + ' frame "' + f.id + '" depth must be 0-3 (got ' + f.depth + ")",
        );
      }
      if (f.code && f.code.length) {
        if (!f.file) {
          throw new Error(TAG + ": " + side + ' frame "' + f.id + '" code requires file');
        }
        if (f.code.length > 4) {
          throw new Error(
            TAG +
              ": " +
              side +
              ' frame "' +
              f.id +
              '" code supports at most 4 lines (got ' +
              f.code.length +
              ")",
          );
        }
        if (f.hot != null && (f.hot < 0 || f.hot >= f.code.length)) {
          throw new Error(TAG + ": " + side + ' frame "' + f.id + '" hot index out of range');
        }
      } else if (f.hot != null) {
        throw new Error(TAG + ": " + side + ' frame "' + f.id + '" hot requires code');
      }
      var chips = f.chips || [];
      if (chips.length > 3) {
        throw new Error(
          TAG +
            ": " +
            side +
            ' frame "' +
            f.id +
            '" supports at most 3 chips (got ' +
            chips.length +
            ")",
        );
      }
      chips.forEach(function (c) {
        if (c.kind != null && c.kind !== "write" && c.kind !== "kill" && c.kind !== "plain") {
          throw new Error(
            TAG +
              ": " +
              side +
              ' frame "' +
              f.id +
              '" chip kind must be write, kill, or plain (got "' +
              c.kind +
              '")',
          );
        }
      });
      if (f.kind != null && f.kind !== "sync" && f.kind !== "async") {
        throw new Error(
          TAG +
            ": " +
            side +
            ' frame "' +
            f.id +
            '" kind must be "sync" or "async" (got "' +
            f.kind +
            '")',
        );
      }
      if (f.was != null && side !== "after") {
        throw new Error(
          TAG + ": " + side + ' frame "' + f.id + '" was is only valid on an after frame',
        );
      }
      frameById[f.id] = f;
      frameOrder.push(f.id);
      frameMeta[f.id] = {
        laneId: lane.id,
        laneIndex: laneIdx,
        depth: f.depth,
        file: f.file || null,
      };
    });
  });
  if (totalFrames > 18) {
    throw new Error(
      TAG + ": " + side + " supports at most 18 frames total (got " + totalFrames + ")",
    );
  }
  return { laneById, frameById, frameOrder, frameMeta };
}

// The change model. Structurally derived from matching `id` across sides —
// Unchanged/moved/added/removed never read a hand-authored flag — except
// `renamed`, the one documented exception: it exists only because an
// After-side `was` was authored, never inferred from an fn difference.
// `renamed` is independent of (and composable with) `moved`.
function kstkDiffClassify(beforeInfo, afterInfo) {
  const ids = {},
    classes = {};
  beforeInfo.frameOrder.forEach((id) => {
    ids[id] = true;
  });
  afterInfo.frameOrder.forEach((id) => {
    ids[id] = true;
  });
  Object.keys(ids).forEach((id) => {
    var b = beforeInfo.frameById[id],
      a = afterInfo.frameById[id];
    if (b && !a) {
      classes[id] = { state: "removed", moved: false, renamed: false };
      return;
    }
    if (a && !b) {
      classes[id] = { state: "added", moved: false, renamed: a.was != null };
      return;
    }
    var bm = beforeInfo.frameMeta[id],
      am = afterInfo.frameMeta[id];
    var moved = bm.laneId !== am.laneId || bm.depth !== am.depth || bm.file !== am.file;
    var renamed = a.was != null;
    if (!moved && !renamed) {
      classes[id] = { state: "unchanged", moved: false, renamed: false };
      return;
    }
    classes[id] = { state: "changed", moved, renamed };
  });
  return classes;
}

// A numbered badge, reusing kdf-legend-num's exact circle chrome (no new
// CSS needed for the shape) with a diff tone painted on top.
function kstkDiffBadge(num, tone) {
  return kitEl("span", `kdf-legend-num kstk-diff-num kstk-diff-num-${tone}`, String(num));
}
function kstkDiffRenamePill(was, fn) {
  return kitEl(
    "div",
    "kstk-diff-rename",
    `${was} <i class="kstk-diff-rename-arrow" aria-hidden="true">→</i> ${fn}`,
  );
}
// A standalone path bar (independent of any code card — a moved frame need
// Not carry code) showing ONE side's file, with whichever segment (dir or
// Filename) actually differs from the other side tinted `tone`; the segment
// That matches stays dimmed. Mirrors kstkPathBar's dir/file split without
// Touching that function (it has no per-segment tint concept, and frame
// Rendering's own seam is kstkBuildFrame — this is genuinely new chrome).
function kstkDiffPathBar(file, otherFile, tone) {
  const parts = String(file).split("/");
  const name = parts.pop();
  const dir = parts.length ? parts.join("/") + "/" : "";
  const otherParts = String(otherFile).split("/");
  const otherName = otherParts.pop();
  const otherDir = otherParts.length ? otherParts.join("/") + "/" : "";
  const segClass = " kstk-diff-seg-" + tone;
  const html =
    '<span class="kstk-diff-path-seg' +
    (dir !== otherDir ? segClass : "") +
    '">' +
    dir +
    "</span>" +
    '<span class="kstk-diff-path-seg' +
    (name !== otherName ? segClass : "") +
    '">' +
    name +
    "</span>" +
    '<i class="kstk-ext-dot ' +
    kstkExtTone(name) +
    '" aria-hidden="true"></i>';
  return kitEl("div", "kstk-diff-path-bar", html);
}

// Pair the same frame across versions so a reader never has to trace a ribbon.
function kstkDiffBriefing(host, data, beforeInfo, afterInfo, classes) {
  const board = kitEl("div", "kstk-change-briefing");
  const head = kitEl("div", "kstk-change-head");
  ["Change", data.before.label || "Before", data.after.label || "After"].forEach((label) => {
    const cell = kitEl("span");
    cell.textContent = label;
    head.append(cell);
  });
  board.append(head);
  const rows = Object.keys(classes).map((id) => {
    const change = classes[id];
    const row = kitEl("div", "kstk-change-row");
    row.dataset.change = change.state;
    const label = kitEl("span", "kstk-change-label");
    label.textContent =
      change.state === "changed"
        ? [change.moved && "Moved", change.renamed && "Renamed"].filter(Boolean).join(" · ")
        : change.state;
    row.append(label);
    [beforeInfo, afterInfo].forEach((side) => {
      const cell = kitEl("div", "kstk-change-cell");
      const frame = side.frameById[id];
      if (!frame) {
        cell.textContent = "—";
      } else {
        const meta = side.frameMeta[id];
        const context = kitEl("small", "kstk-change-context");
        context.textContent = side.laneById[meta.laneId].label + " · depth " + meta.depth;
        cell.append(context);
        const built = kstkBuildFrame(frame);
        if (built.hasCode) {
          function toggle() {
            kstkSetCodeOpen(
              { [id]: built.frameRow },
              { [id]: built.codeCard },
              id,
              !built.frameRow.classList.contains("kstk-code-open"),
            );
          }
          built.frameRow.addEventListener("click", toggle);
          built.frameRow.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              toggle();
            }
          });
        } else if (frame.file) {
          const file = kitEl("small", "kstk-change-file");
          file.textContent = frame.file;
          built.root.append(file);
        }
        cell.append(built.root);
      }
      row.append(cell);
    });
    board.append(row);
    return { id, row };
  });
  host.append(board);
  const walk = kdfBuildWalk(host, data.walkthrough || [], {
    overviewTitle: (data.overview && data.overview.title) || "Read the changes across versions",
    overviewBody:
      (data.overview && data.overview.note) ||
      "Each row pairs the same frame. Names, ownership and side effects stay together.",
    onGo(current, step) {
      rows.forEach(({ id, row }) => {
        const focused = data.view !== "full" && step;
        const selected = focused && (step.fire || []).includes(id);
        row.classList.toggle("active", Boolean(selected));
        row.classList.toggle("dim", Boolean(focused && !selected));
      });
    },
  });
  return { count: (data.walkthrough || []).length + 1, current: walk.current, go: walk.go };
}

function renderStackDiff(host, data, TAG) {
  let motionPreset = kdfEnsureMotionPreset();
  const before = data.before,
    after = data.after;
  if (!before || !Array.isArray(before.lanes)) {
    throw new Error(TAG + ": diff mode requires before.lanes");
  }
  if (!after || !Array.isArray(after.lanes)) {
    throw new Error(TAG + ": diff mode requires after.lanes");
  }
  const walkthrough = data.walkthrough || [];
  if (walkthrough.length > 6) {
    throw new Error(
      TAG + ": walkthrough supports at most 6 steps (got " + walkthrough.length + ")",
    );
  }

  const beforeInfo = kstkValidateDiffSide(TAG, "before", before.lanes);
  const afterInfo = kstkValidateDiffSide(TAG, "after", after.lanes);
  const classes = kstkDiffClassify(beforeInfo, afterInfo);

  // Numbering: non-unchanged after-pane frames (added + changed) in
  // After-pane reading order, THEN removed-only frames in before-pane
  // Reading order — the draft spec's own numbering rule, verbatim.
  const changeOrder = [];
  afterInfo.frameOrder.forEach((id) => {
    var c = classes[id];
    if (c.state === "added" || c.state === "changed") {
      changeOrder.push(id);
    }
  });
  beforeInfo.frameOrder.forEach((id) => {
    if (classes[id].state === "removed") {
      changeOrder.push(id);
    }
  });
  if (changeOrder.length === 0 || changeOrder.length > 10) {
    throw new Error(TAG + ": diff mode supports 1-10 changes (got " + changeOrder.length + ")");
  }
  changeOrder.forEach((id, i) => {
    classes[id].num = i + 1;
  });

  host.classList.add("kcs", "kcs-diff");
  host.__kitBase = { kind: "stack", mode: "diff" };
  host.dataset.motionPreset = motionPreset;
  if (data.layout === "briefing") {
    return kstkDiffBriefing(host, data, beforeInfo, afterInfo, classes);
  }

  const canvas = kitEl("div", "kstk-diff-canvas");
  canvas.setAttribute("role", "group");
  canvas.setAttribute("aria-label", data.ariaLabel || "Before and after call structure diff");

  const panesWrap = kitEl("div", "kstk-diff-panes");
  const beforePane = kitEl("div", "kstk-diff-pane kstk-diff-pane-before");
  const afterPane = kitEl("div", "kstk-diff-pane kstk-diff-pane-after");
  beforePane.append(
    kitEl(
      "div",
      "kstk-diff-pane-head",
      `<span class="kstk-diff-pane-chip">${before.label || "before"}</span>`,
    ),
  );
  afterPane.append(
    kitEl(
      "div",
      "kstk-diff-pane-head",
      `<span class="kstk-diff-pane-chip">${after.label || "after"}</span>`,
    ),
  );

  const litTimers = [];
  function lightFrame(el) {
    if (!el) {
      return;
    }
    el.classList.add("kstk-diff-lit");
    litTimers.push(
      setTimeout(() => {
        el.classList.remove("kstk-diff-lit");
      }, 700),
    );
  }

  // Decoration applied on top of kstkBuildFrame's own output — badges,
  // Rename pill, path-bar diff. Frame rendering itself stays untouched;
  // This only adds classes/children to what kstkBuildFrame already built.
  function decorateFrame(side, frame, built) {
    const cls = classes[frame.id];
    const row = built.frameRow,
      wrap = built.root;
    if (cls.state === "unchanged") {
      row.classList.add("kstk-diff-unchanged");
      return;
    }
    if (cls.state === "removed") {
      row.classList.add("kstk-diff-removed");
      row.insertBefore(kstkDiffBadge(cls.num, "error"), row.firstChild);
      return;
    }
    if (cls.state === "added") {
      row.classList.add("kstk-diff-added");
      row.insertBefore(kstkDiffBadge(cls.num, "success"), row.firstChild);
      if (cls.renamed) {
        wrap.appendChild(kstkDiffRenamePill(frame.was, frame.fn));
      }
      return;
    }
    // Changed: composable moved + renamed
    row.classList.add("kstk-diff-changed");
    if (cls.moved) {
      row.classList.add("kstk-diff-is-moved");
    }
    if (cls.renamed) {
      row.classList.add("kstk-diff-is-renamed");
    }
    row.insertBefore(kstkDiffBadge(cls.num, cls.renamed ? "violet" : "accent"), row.firstChild);
    if (side === "after" && cls.renamed) {
      wrap.appendChild(kstkDiffRenamePill(frame.was, frame.fn));
    }
    if (cls.moved) {
      const bf = beforeInfo.frameById[frame.id],
        af = afterInfo.frameById[frame.id];
      if (bf.file && af.file && bf.file !== af.file) {
        const tone = side === "before" ? "error" : "success";
        const thisFile = side === "before" ? bf.file : af.file;
        const otherFile = side === "before" ? af.file : bf.file;
        wrap.append(kstkDiffPathBar(thisFile, otherFile, tone));
      }
    }
  }

  const clickHandlers = [];
  function buildPane(paneEl, lanes, side) {
    const frameRowEls = {},
      codeCards = {},
      laneEls = {};
    function renderNodes(container, nodes) {
      nodes.forEach((node) => {
        var f = node.frame;
        var built = kstkBuildFrame(f);
        frameRowEls[f.id] = built.frameRow;
        if (built.codeCard) {
          codeCards[f.id] = built.codeCard;
          (function (builtFrame) {
            var toggle = function () {
              kstkSetCodeOpen(
                frameRowEls,
                codeCards,
                f.id,
                !builtFrame.frameRow.classList.contains("kstk-code-open"),
              );
            };
            var onKey = function (e) {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggle();
              }
            };
            builtFrame.frameRow.addEventListener("click", toggle);
            builtFrame.frameRow.addEventListener("keydown", onKey);
            clickHandlers.push({ el: builtFrame.frameRow, click: toggle, key: onKey });
          })(built);
        }
        decorateFrame(side, f, built);
        container.appendChild(built.root);
        if (node.children.length) {
          var kids = kitEl("div", "kstk-kids");
          renderNodes(kids, node.children);
          container.appendChild(kids);
        }
      });
    }
    lanes.forEach((lane) => {
      var laneEl = kitEl("div", "kstk-lane" + (lane.tone ? " " + lane.tone : ""));
      laneEl.innerHTML =
        '<div class="kstk-lane-head"><span>' +
        lane.label +
        "</span>" +
        (lane.sub ? "<small>" + lane.sub + "</small>" : "") +
        "</div>";
      var framesWrap = kitEl("div", "kstk-lane-frames");
      renderNodes(framesWrap, kstkBuildTree(lane.frames));
      laneEl.appendChild(framesWrap);
      // Fix 1, ported to mode:'diff' per the same-round addendum: each pane
      // gets the identical Present-only collapsed-strip treatment the flow
      // branch uses (kstkBuildCollapsedStrip, same CSS) — inactive lanes in
      // EACH pane collapse independently (a moved frame can sit in
      // different lanes per side).
      laneEl.appendChild(kstkBuildCollapsedStrip(lane));
      laneEls[lane.id] = laneEl;
      paneEl.appendChild(laneEl);
    });
    return { frameRowEls, codeCards, laneEls };
  }
  const beforeMaps = buildPane(beforePane, before.lanes, "before");
  const afterMaps = buildPane(afterPane, after.lanes, "after");
  panesWrap.append(beforePane);
  panesWrap.append(afterPane);

  // ── move ribbons — an SVG overlay across the pane gutter, one per
  // 'changed' id (moved and/or renamed; added/removed have only one
  // Position and route no ribbon). A gentle cubic curve from the before
  // Frame's right edge to the after frame's left edge, violet when renamed,
  // Accent otherwise. Positions are real pixel geometry (plain HTML flow,
  // Not a percentage kdf-canvas), so layout is computed on demand — at
  // Mount and again on resize — exactly like the flow branch's own
  // AnchorFor() does for its descent dot. Below the ~900px side-by-side
  // Breakpoint the panes stack and the ribbon layer hides (architecture.css)
  // — the numbered badges shared by both panes carry the correspondence
  // Instead ("paired numbered markers"). ──
  // Like the flow branch's descent, a ribbon is STRUCTURE: "this frame is
  // That frame, moved". It is painted with the panes and stays painted; a
  // Step only lights the ones it fires. There is no travelling head here —
  // The same reason the flow branch's draw-on is gone (the whole diff reads
  // Because you see all of it at once).
  const ribbonIds = changeOrder.filter(function (id) {
    return classes[id].state === "changed";
  });
  const ribbonSvg = svgEl("svg", { class: "kstk-diff-ribbons", "aria-hidden": "true" }, panesWrap);
  const ribbonLineLayer = document.createElementNS(kdfNS, "g");
  ribbonLineLayer.setAttribute("class", "kstk-diff-ribbon-lines");
  ribbonSvg.append(ribbonLineLayer);
  const ribbonLineEls = {};
  ribbonIds.forEach((id) => {
    var tone = classes[id].renamed ? "violet" : "accent";
    ribbonLineEls[id] = svgEl(
      "path",
      { class: "kstk-diff-ribbon-line " + tone, "data-change": id },
      ribbonLineLayer,
    );
  });
  // Present's pane-lane collapse (below) can hide either side of a moved/
  // Renamed pair — a ribbon into a now-compact strip has nowhere real to
  // Land, so it's hidden for that pair rather than drawn into blank space;
  // The paired numbered badges (both panes carry the same number) keep the
  // Before<->after correspondence readable regardless. Addendum-sanctioned
  // Fallback, called out in the report rather than attempted as full
  // Correct-anchoring-into-the-strip geometry.
  function laneCollapsedForSide(maps, laneId) {
    const laneEl = laneId && maps.laneEls[laneId];
    return laneEl ? laneEl.classList.contains("kstk-lane-untouched") : false;
  }
  function layoutRibbons() {
    const rect = panesWrap.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }
    ribbonSvg.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
    ribbonIds.forEach((id) => {
      var beforeEl = beforeMaps.frameRowEls[id],
        afterEl = afterMaps.frameRowEls[id];
      if (
        !beforeEl ||
        !afterEl ||
        laneCollapsedForSide(beforeMaps, beforeInfo.frameMeta[id].laneId) ||
        laneCollapsedForSide(afterMaps, afterInfo.frameMeta[id].laneId)
      ) {
        ribbonLineEls[id].setAttribute("d", "M0 0 L0 0");
        return;
      }
      var br = beforeEl.getBoundingClientRect(),
        ar = afterEl.getBoundingClientRect();
      var x1 = br.right - rect.left,
        y1 = br.top - rect.top + br.height / 2;
      var x2 = ar.left - rect.left,
        y2 = ar.top - rect.top + ar.height / 2;
      var midX = (x1 + x2) / 2;
      ribbonLineEls[id].setAttribute(
        "d",
        "M" + x1 + " " + y1 + " C " + midX + " " + y1 + " " + midX + " " + y2 + " " + x2 + " " + y2,
      );
    });
  }
  // Attach to the live document BEFORE the first layout pass — getBoundingClientRect
  // On a not-yet-attached subtree returns all zeros, and layoutRibbons's own
  // Guard would silently skip every ribbon forever (there is no later
  // Retry besides a real resize event).
  canvas.append(panesWrap);
  host.append(canvas);
  layoutRibbons();
  function onResize() {
    fitStage();
    layoutRibbons();
  }
  window.addEventListener("resize", onResize);
  // Code-card toggles and the container-query breakpoint move frame rows
  // Without a window resize — observe the panes so the ribbons follow.
  let ribbonObserver = null;
  if (typeof ResizeObserver === "function") {
    ribbonObserver = new ResizeObserver(() => {
      layoutRibbons();
    });
    ribbonObserver.observe(panesWrap);
  }

  // Ambient's attention pass: one change takes its turn — its ribbon and
  // Both of its frames brighten for a beat and hand the emphasis back.
  // Nothing travels, nothing is drawn; the ribbon was already there.
  const DIFF_PASS_MS = 700;
  function fireChange(id, onDone) {
    const cls = classes[id];
    if (cls.state !== "removed") {
      lightFrame(afterMaps.frameRowEls[id]);
    }
    if (cls.state !== "added") {
      lightFrame(beforeMaps.frameRowEls[id]);
    }
    const ribbon = ribbonLineEls[id];
    if (ribbon) {
      ribbon.classList.add("kstk-ribbon-pass");
      litTimers.push(
        setTimeout(() => {
          ribbon.classList.remove("kstk-ribbon-pass");
        }, DIFF_PASS_MS),
      );
    }
    if (onDone) {
      litTimers.push(setTimeout(onDone, DIFF_PASS_MS));
    }
  }

  // Legend — same kdf-legend markup/hover as sequence/erd/the flow branch's
  // Own handoff legend, one entry per numbered change.
  function changeLabel(id) {
    const c = classes[id];
    if (c.state === "removed") {
      return "removed · " + beforeInfo.frameById[id].fn;
    }
    if (c.state === "added") {
      return (c.renamed ? "added+renamed" : "added") + " · " + afterInfo.frameById[id].fn;
    }
    const parts = [];
    if (c.moved) {
      parts.push("moved");
    }
    if (c.renamed) {
      parts.push("renamed");
    }
    return `${parts.join("+")} · ${afterInfo.frameById[id].fn}`;
  }
  const legend = kitEl("div", "kdf-legend");
  legend.setAttribute("role", "list");
  const legendItemEls = {};
  changeOrder.forEach((id) => {
    var c = classes[id];
    var tone =
      c.state === "removed"
        ? "error"
        : c.state === "added"
          ? "success"
          : c.renamed
            ? "violet"
            : "accent";
    var li = kitEl("div", "kdf-legend-item " + tone);
    li.dataset.change = id;
    li.setAttribute("role", "listitem");
    li.innerHTML =
      '<span class="kdf-legend-num">' +
      c.num +
      '</span><span class="kdf-legend-text">' +
      changeLabel(id) +
      "</span>";
    legend.appendChild(li);
    legendItemEls[id] = li;
  });
  host.append(legend);
  const hoverHandlers = [];
  changeOrder.forEach((id) => {
    var li = legendItemEls[id];
    var enter = function () {
      if (beforeMaps.frameRowEls[id]) {
        beforeMaps.frameRowEls[id].classList.add("hover");
      }
      if (afterMaps.frameRowEls[id]) {
        afterMaps.frameRowEls[id].classList.add("hover");
      }
      if (ribbonLineEls[id]) {
        ribbonLineEls[id].classList.add("hover");
      }
    };
    var leave = function () {
      if (beforeMaps.frameRowEls[id]) {
        beforeMaps.frameRowEls[id].classList.remove("hover");
      }
      if (afterMaps.frameRowEls[id]) {
        afterMaps.frameRowEls[id].classList.remove("hover");
      }
      if (ribbonLineEls[id]) {
        ribbonLineEls[id].classList.remove("hover");
      }
    };
    li.addEventListener("mouseenter", enter);
    li.addEventListener("mouseleave", leave);
    hoverHandlers.push({ li, enter, leave });
  });

  // Ambient: ribbons take turns (kdfAmbientCycle, shared with sequence/erd —
  // A strict array-order walk, not data-flow's branching cascade), each turn
  // An emphasis pass over a ribbon that is already drawn. Reduced motion /
  // Preset 'off': startAmbient never starts, so the diff is completely still
  // — and completely legible, which is the whole point of this mode.
  const ambient = kdfAmbientCycle(
    ribbonIds,
    fireChange,
    function () {
      return motionPreset === "calm" ? 460 : 280;
    },
    function () {
      return motionPreset === "calm" ? 1500 : 900;
    },
  );
  function startAmbient() {
    if (motionPreset !== "off" && MOTION) {
      ambient.start();
    }
  }
  // Takes back ambient's transient marks only — a step's own emphasis
  // (.active / .kstk-ribbon-lit) is applied after this and must survive it.
  function stopAmbient() {
    ambient.stop();
    litTimers.forEach((timer) => clearTimeout(timer));
    litTimers.length = 0;
    Object.keys(beforeMaps.frameRowEls).forEach((fid) => {
      beforeMaps.frameRowEls[fid].classList.remove("kstk-diff-lit");
    });
    Object.keys(afterMaps.frameRowEls).forEach((fid) => {
      afterMaps.frameRowEls[fid].classList.remove("kstk-diff-lit");
    });
    ribbonIds.forEach((id) => {
      ribbonLineEls[id].classList.remove("kstk-ribbon-pass");
    });
  }

  // Walkthrough: `fire` names changes (frame ids), same as the flow branch.
  function applyStep(step) {
    const fireIds = step ? step.fire || [] : [];
    const active = {};
    fireIds.forEach((fid) => {
      active[fid] = true;
    });
    canvas.classList.toggle("kstk-diff-walking", Boolean(step));
    Object.keys(beforeMaps.frameRowEls).forEach((fid) => {
      beforeMaps.frameRowEls[fid].classList.toggle("active", Boolean(active[fid]));
    });
    Object.keys(afterMaps.frameRowEls).forEach((fid) => {
      afterMaps.frameRowEls[fid].classList.toggle("active", Boolean(active[fid]));
    });
    // Emphasis only: the ribbons the step fires light, the rest go back to
    // Their resting tone — no ribbon appears, moves or redraws
    ribbonIds.forEach((id) => {
      ribbonLineEls[id].classList.toggle("kstk-ribbon-lit", Boolean(active[id]));
    });
    applyLegend(step, active);
  }
  // Fix 3, diff side — the changes legend is this mode's index, so a step
  // Lights exactly the numbers it fires and dims the rest (kdf-legend-item
  // .active/.dim, the family's own convention; each entry keeps its change
  // Tone while it is on — see architecture.css). Nothing dims outside a
  // Step: the overview shows the whole change list at rest.
  function applyLegend(step, activeIds) {
    changeOrder.forEach((id) => {
      var on = Boolean(step) && Boolean(activeIds[id]);
      legendItemEls[id].classList.toggle("active", on);
      legendItemEls[id].classList.toggle("dim", Boolean(step) && !on);
    });
  }
  // Fix 1, ported to mode:'diff' (same-round addendum): inactive lanes
  // Collapse independently per pane — a moved frame can sit in a different
  // Lane on each side, so "touched" is computed separately for before and
  // After from the same fired change ids (frameMeta's own laneId per side).
  function touchedLanesForChange(fireIds) {
    const bt = {},
      at = {};
    (fireIds || []).forEach((id) => {
      var bm = beforeInfo.frameMeta[id],
        am = afterInfo.frameMeta[id];
      if (bm) {
        bt[bm.laneId] = true;
      }
      if (am) {
        at[am.laneId] = true;
      }
    });
    return { after: at, before: bt };
  }
  function defaultOverviewTouchDiff() {
    const bt = {},
      at = {};
    if (data.view === "full") {
      before.lanes.forEach((lane) => {
        bt[lane.id] = true;
      });
      after.lanes.forEach((lane) => {
        at[lane.id] = true;
      });
      return { after: at, before: bt };
    }
    if (before.lanes.length > 0) {
      bt[before.lanes[0].id] = true;
    }
    if (after.lanes.length > 0) {
      at[after.lanes[0].id] = true;
    }
    return { after: at, before: bt };
  }
  function applyLaneCollapseDiff(touched) {
    before.lanes.forEach((lane) => {
      beforeMaps.laneEls[lane.id].classList.toggle("kstk-lane-untouched", !touched.before[lane.id]);
    });
    after.lanes.forEach((lane) => {
      afterMaps.laneEls[lane.id].classList.toggle("kstk-lane-untouched", !touched.after[lane.id]);
    });
    layoutRibbons();
  }
  // A pane's lane is expanded whenever the step fires a change that lives
  // In it — same rule as the flow branch, computed per side because a
  // Moved frame sits in a different lane on each side.
  // Present-only (checked live, not cached — the same page can enter/exit
  // Present repeatedly): code cards open only for the step's focus frame,
  // Mirroring the flow branch's applyShow default (the last fired id that
  // Carries code), independently per pane since a changed frame's code
  // Need not exist on both sides. Scroll mode keeps this mode's existing,
  // Documented contract untouched — cards stay click-to-toggle only there.
  function defaultShowSide(fireIds, maps) {
    for (let i = fireIds.length - 1; i >= 0; i--) {
      if (maps.codeCards[fireIds[i]]) {
        return fireIds[i];
      }
    }
    return null;
  }
  function applyShowDiff(step) {
    Object.keys(beforeMaps.codeCards).forEach((fid) => {
      kstkSetCodeOpen(beforeMaps.frameRowEls, beforeMaps.codeCards, fid, false);
    });
    Object.keys(afterMaps.codeCards).forEach((fid) => {
      kstkSetCodeOpen(afterMaps.frameRowEls, afterMaps.codeCards, fid, false);
    });
    if (!step) {
      return;
    }
    const fireIds = step.fire || [];
    const bShow = defaultShowSide(fireIds, beforeMaps),
      aShow = defaultShowSide(fireIds, afterMaps);
    if (bShow) {
      kstkSetCodeOpen(beforeMaps.frameRowEls, beforeMaps.codeCards, bShow, true);
    }
    if (aShow) {
      kstkSetCodeOpen(afterMaps.frameRowEls, afterMaps.codeCards, aShow, true);
    }
  }
  // Same last-two-rungs ladder the flow branch uses (see fitStage there):
  // Both panes have already dropped their untouched lanes and every code
  // Card but the step's focus, so if the canvas STILL overruns what the
  // Stage can show at a legible scale, the type steps down one notch —
  // Never a cap, never a scroller.
  function fitStage() {
    canvas.classList.remove("kstk-tight");
    if (!document.body.classList.contains("presenting")) {
      return;
    }
    if (canvas.offsetHeight > kstkPresentCanvasBudget(host, canvas)) {
      canvas.classList.add("kstk-tight");
    }
  }
  // Synchronous, in reduction order, for the same reason the flow branch
  // Is: present.js measures the stage height the moment this returns, and
  // A pulse fired below must travel the geometry the collapse just
  // Settled on — the old 380ms "settle" timer left both reading the
  // PREVIOUS step's layout.
  function onWalkGo(current, step) {
    stopAmbient();
    const displayStep = data.view === "full" ? null : step;
    applyStep(displayStep);
    applyLaneCollapseDiff(
      displayStep ? touchedLanesForChange(displayStep.fire || []) : defaultOverviewTouchDiff(),
    );
    if (document.body.classList.contains("presenting")) {
      applyShowDiff(displayStep);
    }
    fitStage();
    layoutRibbons();
    if (!step) {
      startAmbient();
      return;
    }
    (step.fire || []).forEach((fid) => {
      var cls = classes[fid];
      if (!cls || cls.state === "unchanged") {
        console.warn(
          '[architecture] stack diff step "' +
            (step.title || current) +
            '" fires unknown change "' +
            fid +
            '"',
        );
      }
    });
  }
  const walkApi = kdfBuildWalk(host, walkthrough, {
    overviewTitle: (data.overview && data.overview.title) || "Watch it change →",
    overviewBody:
      (data.overview && (data.overview.note != null ? data.overview.note : data.overview.body)) ||
      "Ribbons trace what moved or was renamed; added and removed frames stay put in their own pane.",
    onGo: onWalkGo,
  });

  function onMotionPresetChange(e) {
    const preset = e && e.detail ? e.detail.preset : kdfEnsureMotionPreset();
    if (!["calm", "normal", "off"].includes(preset)) {
      return;
    }
    motionPreset = preset;
    host.dataset.motionPreset = preset;
    // The ribbons are structure and stay painted under every preset, 'off'
    // Included — stopAmbient() only takes back the pass light.
    stopAmbient();
    if (!walkApi.current() && preset !== "off" && MOTION) {
      startAmbient();
    }
  }
  window.addEventListener("kitmotionpresetchange", onMotionPresetChange);

  host.__kitDispose = function __kitDispose() {
    stopAmbient();
    walkApi.dispose();
    window.removeEventListener("kitmotionpresetchange", onMotionPresetChange);
    window.removeEventListener("resize", onResize);
    if (ribbonObserver) {
      ribbonObserver.disconnect();
    }
    litTimers.forEach((timer) => clearTimeout(timer));
    clickHandlers.forEach((h) => {
      h.el.removeEventListener("click", h.click);
      h.el.removeEventListener("keydown", h.key);
    });
    hoverHandlers.forEach((h) => {
      h.li.removeEventListener("mouseenter", h.enter);
      h.li.removeEventListener("mouseleave", h.leave);
    });
  };
  walkApi.go(0);
  return { count: walkthrough.length + 1, current: walkApi.current, go: walkApi.go };
}
