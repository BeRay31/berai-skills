function ktraceTotal(spans) {
  return (spans || []).reduce(function (max, span) {
    return Math.max(max, Number(span.start || 0) + Number(span.dur || 0));
  }, 0);
}

function ktraceSummary(sel, data) {
  const host = kitMount(sel);
  host.classList.add("ktrace", "ktrace-summary");
  const before = data.compare.before;
  const after = data.compare.after;
  const beforeTotal = ktraceTotal(before.spans);
  const afterTotal = ktraceTotal(after.spans);
  const unit = data.unit || "ms";
  const hero = kitEl("div", "ktrace-summary-hero");
  const arrow = kitEl("span", "ktrace-summary-arrow", "→");
  arrow.setAttribute("aria-hidden", "true");
  hero.append(
    kitEl("span", "ktrace-summary-before", `${Math.round(beforeTotal)} ${unit}`),
    arrow,
    kitEl("strong", "ktrace-summary-after", `${Math.round(afterTotal)} ${unit}`),
  );
  const totalSummary =
    afterTotal < beforeTotal
      ? `${Math.round(beforeTotal - afterTotal)} ${unit} faster end to end`
      : afterTotal > beforeTotal
        ? `${Math.round(afterTotal - beforeTotal)} ${unit} slower end to end`
        : "No end-to-end change";
  hero.append(kitEl("small", null, totalSummary));
  host.append(hero);

  const evidence = kitEl("div", "ktrace-summary-evidence");
  const beforeWaits = (before.spans || [])
    .filter((span) => span.kind === "wait")
    .toSorted((a, b) => Number(b.dur) - Number(a.dur));
  const afterStarts = new Map(
    (after.spans || []).map((span) => [String(span.id), Number(span.start)]),
  );
  const afterWaits = new Map(
    (after.spans || [])
      .filter((span) => span.kind === "wait")
      .map((span) => [String(span.id), Number(span.dur)]),
  );
  const overlapping = [];
  (after.spans || []).forEach(function (span, index, spans) {
    spans.slice(index + 1).forEach(function (other) {
      const overlap =
        Math.min(Number(span.start) + Number(span.dur), Number(other.start) + Number(other.dur)) -
        Math.max(Number(span.start), Number(other.start));
      if (overlap > 0) {
        overlapping.push([span, other]);
      }
    });
  });
  const rows = [];
  const improvedWait = beforeWaits.find(function (span) {
    const afterWait = afterWaits.get(String(span.id));
    return afterWait === undefined || afterWait < Number(span.dur);
  });
  if (improvedWait) {
    const afterWait = afterWaits.get(String(improvedWait.id));
    rows.push({
      label: improvedWait.label || improvedWait.id || "Longest wait",
      value: `${Math.round(Number(improvedWait.dur) - (afterWait || 0))} ${unit} wait ${
        afterWait === undefined ? "removed" : "reduced"
      }`,
    });
  }
  if (overlapping[0]) {
    rows.push({
      label: `${overlapping[0][0].label || overlapping[0][0].id} + ${overlapping[0][1].label || overlapping[0][1].id}`,
      value: "now overlap instead of queueing",
    });
  }
  const moved = (before.spans || []).find(function (span) {
    return (
      afterStarts.has(String(span.id)) && afterStarts.get(String(span.id)) < Number(span.start)
    );
  });
  if (moved) {
    rows.push({
      label: moved.label || moved.id,
      value: `starts ${Math.round(Number(moved.start) - afterStarts.get(String(moved.id)))} ${unit} earlier`,
    });
  }
  rows.slice(0, 3).forEach(function (row, index) {
    const item = kitEl("div", "ktrace-summary-row");
    item.append(kitEl("span", "ktrace-summary-num", String(index + 1).padStart(2, "0")));
    item.append(kitEl("strong", null, row.label));
    item.append(kitEl("small", null, row.value));
    evidence.append(item);
  });
  host.append(evidence);
  host.__kitBase = { kind: "trace" };
  return { count: 1, current: () => 0, go() {} };
}

function ktraceBriefing(sel, data) {
  const host = kitMount(sel);
  host.classList.add("ktrace", "ktrace-briefing");
  const spans = data.spans || [];
  const total = ktraceTotal(spans);
  const unit = data.unit || "ms";
  function amount(value) {
    const number = Number(value);
    return Number.isInteger(number) ? String(number) : String(Number(number.toFixed(2)));
  }
  function spanLabel(span) {
    return String(span.label != null ? span.label : span.id != null ? span.id : "Span");
  }
  const head = kitEl("div", "ktrace-briefing-head");
  const context = kitEl("div", "ktrace-briefing-context");
  context.append(kitEl("span", null, "Trace context"));
  context.append(kitEl("strong", null, `${amount(total)} ${unit} total`));
  const scale = kitEl("div", "ktrace-briefing-scale");
  scale.append(kitEl("span", null, `0 ${unit}`));
  scale.append(kitEl("span", null, `${amount(total)} ${unit}`));
  head.append(context, scale);
  host.append(head);

  const list = kitEl("div", "ktrace-briefing-list");
  const rows = spans.map(function (span, index) {
    const start = Number(span.start);
    const duration = Number(span.dur);
    const end = start + duration;
    const wait = span.kind === "wait";
    const row = kitEl("div", "ktrace-briefing-row" + (wait ? " is-wait" : " is-work"));
    row.dataset.spanId = span.id == null ? "" : String(span.id);
    row.dataset.lane = span.lane == null ? "" : String(span.lane);
    const identity = kitEl("div", "ktrace-briefing-identity");
    identity.append(
      kitEl("span", "ktrace-briefing-num", String(index + 1).padStart(2, "0")),
      kitEl("span", "ktrace-briefing-lane", span.lane == null ? "Unassigned" : String(span.lane)),
    );
    const label = kitEl("strong", "ktrace-briefing-label", spanLabel(span));
    identity.append(label);
    if (span.note) {
      identity.append(kitEl("span", "ktrace-briefing-note", span.note));
    }
    const timing = kitEl("div", "ktrace-briefing-timing");
    const rail = kitEl("div", "ktrace-briefing-rail");
    const mark = kitEl("span", "ktrace-briefing-mark");
    mark.style.setProperty("--ktrace-start", String((start / total) * 100));
    mark.style.setProperty("--ktrace-duration", String((duration / total) * 100));
    mark.setAttribute(
      "aria-label",
      `${spanLabel(span)}: starts at ${amount(start)} ${unit}, lasts ${amount(duration)} ${unit}`,
    );
    rail.append(mark);
    timing.append(rail);
    const facts = kitEl("div", "ktrace-briefing-facts");
    facts.append(
      kitEl("span", "ktrace-briefing-kind", wait ? "Wait" : "Work"),
      kitEl("span", null, `${amount(start)}–${amount(end)} ${unit}`),
      kitEl("strong", null, `${amount(duration)} ${unit}`),
    );
    timing.append(facts);
    row.append(identity, timing);
    list.append(row);
    return { element: row, span };
  });
  host.append(list);

  const steps = data.walkthrough || [];
  const overview = data.overview || {};
  const states = [
    {
      focus: null,
      kind: "overview",
      note:
        overview.note != null
          ? String(overview.note)
          : "Every span uses the same total-time scale; hatched rails are waiting.",
      title: String(overview.title || "Read the spans →"),
    },
  ];
  steps.forEach(function (step, index) {
    states.push({
      focus: step.focus || null,
      kind: "step",
      note: String(step.note != null ? step.note : step.body || ""),
      title: String(step.title || step.label || `Step ${index + 1}`),
    });
  });
  if (data.completion) {
    states.push({
      focus: null,
      kind: "completion",
      note: String(
        data.completion.note != null ? data.completion.note : data.completion.body || "",
      ),
      title: String(data.completion.title || "Complete"),
    });
  }

  let current = 0;
  if (steps.length) {
    const panel = kitEl("div", "kch-walk kch-walk-guided ktrace-briefing-walk");
    const dots = kitEl("div", "kch-walk-dots");
    const annotation = kitEl("div", "kch-walk-annotation");
    annotation.setAttribute("aria-live", "polite");
    const title = document.createElement("strong");
    const note = document.createElement("p");
    annotation.append(title, note);
    const controls = kitEl("div", "kch-walk-controls");
    const previous = kitEl("button", "kch-walk-previous", "Previous");
    const next = kitEl("button", "kch-walk-next", "Next");
    previous.type = "button";
    next.type = "button";
    controls.append(previous, next);
    panel.append(dots, annotation, controls);
    const dotButtons = states.map(function (state, index) {
      const dot = kitEl("button", "kch-walk-dot");
      dot.type = "button";
      dot.setAttribute(
        "aria-label",
        state.kind === "overview"
          ? "Show trace overview"
          : state.kind === "completion"
            ? "Show trace completion"
            : `Show trace step ${index}: ${state.title}`,
      );
      dot.addEventListener("click", function (event) {
        event.stopPropagation();
        go(index);
      });
      dots.append(dot);
      return dot;
    });
    function matches(span, focus) {
      if (!focus || focus.replay || data.view === "full") {
        return true;
      }
      return (
        (focus.lane != null && String(span.lane == null ? "" : span.lane) === String(focus.lane)) ||
        (focus.span != null && String(span.id) === String(focus.span)) ||
        (focus.spans || []).map(String).includes(String(span.id))
      );
    }
    function go(index) {
      current = Math.max(0, Math.min(states.length - 1, index));
      host.__kitChartStep = current;
      const state = states[current];
      const focused = state.kind === "step" ? state.focus : null;
      rows.forEach(function (row) {
        const match = matches(row.span, focused);
        row.element.classList.toggle("is-dim", !match);
        row.element.classList.toggle("is-focus", Boolean(focused && !focused.replay && match));
      });
      dotButtons.forEach(function (dot, dotIndex) {
        dot.classList.toggle("current", dotIndex === current);
        dot.classList.toggle("done", dotIndex < current);
        if (dotIndex === current) {
          dot.setAttribute("aria-current", "step");
        } else {
          dot.removeAttribute("aria-current");
        }
      });
      title.textContent = state.title;
      note.textContent = state.note;
      panel.classList.toggle("kch-walk-complete", state.kind === "completion");
      previous.disabled = current === 0;
      next.disabled = current === states.length - 1;
    }
    previous.addEventListener("click", function () {
      go(current - 1);
    });
    next.addEventListener("click", function () {
      go(current + 1);
    });
    host.append(panel);
    go(0);
    return { count: states.length, current: () => current, go };
  }
  return { count: 1, current: () => 0, go() {} };
}

function renderTrace(sel, data) {
  const host = kitMount(sel);
  const previousStep =
    !data.compare && Number.isInteger(host.__kitChartStep) ? host.__kitChartStep : null;
  host.classList.remove("ktrace-summary", "ktrace-briefing");
  if (!data.__kitAdjusted && data.compare) {
    const adjustment = globalThis.ExplainerKit.registerAdjustments(host, {
      base: data,
      defaults: { layout: data.layout || "timing" },
      label: data.ariaLabel || "Trace comparison",
      options: [
        {
          key: "layout",
          label: "Composition",
          type: "choice",
          choices: ["timing", "summary"],
          choiceLabels: { timing: "Timing", summary: "Outcome summary" },
        },
      ],
      apply(state) {
        renderTrace(host, {
          ...host.__kitAdjustments.base,
          layout: state.layout,
          __kitAdjusted: true,
        });
      },
    });
    data = { ...adjustment.base, layout: adjustment.state.layout, __kitAdjusted: true };
  }
  if (!data.__kitAdjusted && !data.compare) {
    const adjustment = globalThis.ExplainerKit.registerAdjustments(host, {
      base: data,
      defaults: { layout: data.layout || "timing" },
      label: data.ariaLabel || "Trace",
      options: [
        {
          key: "layout",
          label: "Composition",
          type: "choice",
          choices: ["timing", "briefing"],
          choiceLabels: { timing: "Timing waterfall", briefing: "Span briefing" },
          choiceDescriptions: {
            timing: "See concurrency and waiting on one shared clock.",
            briefing: "Read every span with its timing on a common scale.",
          },
        },
      ],
      apply(state) {
        return renderTrace(host, {
          ...host.__kitAdjustments.base,
          layout: state.layout,
          __kitAdjusted: true,
        });
      },
    });
    data = { ...adjustment.base, layout: adjustment.state.layout, __kitAdjusted: true };
  }
  kitValidateTextCaps(host, "renderTrace", data);
  if (data.layout === "summary" && data.compare) {
    return globalThis.ExplainerKit.stableDriver(host, ktraceSummary(host, data));
  }
  const cfg = { ...data, kind: "trace", __architectureTrace: true, __skipTextCaps: true };
  if (data.layout === "briefing" && !data.compare) {
    renderChart(host, cfg);
    const driver = ktraceBriefing(host, data);
    if (previousStep != null) {
      driver.go(previousStep);
    }
    return globalThis.ExplainerKit.stableDriver(host, driver);
  }
  const driver = renderChart(host, cfg);
  if (!data.compare && previousStep != null) {
    driver.go(previousStep);
  }
  if (host) {
    host.classList.add("ktrace");
    host.__kitBase = { kind: "trace" };
  }
  return globalThis.ExplainerKit.stableDriver(host, driver);
}
