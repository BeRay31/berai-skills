/* Component: roadmap — parallel workstreams across a shared time horizon.
   Temporal spans are not progress bars: length means dates, while state is
   carried by solid/dashed stroke and the kit's status tones. */
const ROADMAP_TYPE_PRESETS = {
  standard: {
    itemSize: 20,
    itemWeight: 560,
    laneSize: 22,
    metaSize: 16,
    keySize: "0.9rem",
    walkTitleSize: "0.9rem",
    walkNoteSize: "0.85rem",
  },
  large: {
    itemSize: 32,
    itemWeight: 650,
    laneSize: 28,
    metaSize: 20,
    keySize: "1.05rem",
    walkTitleSize: "1.25rem",
    walkNoteSize: "1.25rem",
  },
};

function krmWalkFocus(next, reset, dots) {
  if (document.activeElement === next) {
    return ".krm-controls button:first-child";
  }
  if (document.activeElement === reset) {
    return ".krm-controls button:last-child";
  }
  const index = dots.indexOf(document.activeElement);
  return index === -1 ? null : ".krm-dot:nth-child(" + (index + 1) + ")";
}
function krmRestoreWalkFocus(host, selector) {
  if (!selector) {
    return;
  }
  let target = host.querySelector(selector);
  if (target && target.disabled) {
    target = host.querySelector(".krm-controls button:last-child");
  }
  if (target) {
    target.focus({ preventScroll: true });
  }
}
function krmItemContext(data, walkthrough, allItems, dependencies, itemMode, hasKeyItems) {
  // Key means exactly authored key items at rest. A walkthrough reveals only
  // the supporting evidence needed by its active step, then removes it again.
  const contextIndex = Math.max(0, Number(data.__walkContext) || 0);
  const activeContext = walkthrough[contextIndex - 1] || null;
  const supportingIds = new Set((activeContext && activeContext.items) || []);
  ((activeContext && activeContext.dependencies) || []).forEach((index) => {
    supportingIds.add(dependencies[index].from);
    supportingIds.add(dependencies[index].to);
  });
  let visibleItems = allItems;
  if (itemMode === "key" && hasKeyItems) {
    visibleItems = allItems.filter((item) =>
      activeContext && supportingIds.size ? supportingIds.has(item.id) : item.key === true,
    );
  }
  const supportingCount =
    itemMode === "key" && hasKeyItems ? visibleItems.filter((item) => item.key !== true).length : 0;
  const scope =
    visibleItems.length +
    " of " +
    allItems.length +
    " items · " +
    (itemMode === "key" && hasKeyItems
      ? activeContext && supportingIds.size
        ? "Step focus"
        : "Key commitments"
      : "Full roadmap") +
    (supportingCount
      ? " · " +
        supportingCount +
        " supporting item" +
        (supportingCount === 1 ? "" : "s") +
        " for this step"
      : "");
  return { contextIndex, visibleItems, scope };
}
function krmDate(value) {
  return new Date(value).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
function krmDateRange(item) {
  return item.milestone
    ? krmDate(item.startTime) + " milestone"
    : krmDate(item.startTime) + " – " + krmDate(item.endTime);
}
function krmStateLabel(state) {
  return {
    done: "Shipped",
    now: "In progress",
    planned: "Planned",
    risk: "At risk",
  }[state];
}
function krmRiskSignal(host, items) {
  const risks = items.filter((item) => item.state === "risk");
  if (!risks.length) {
    return;
  }
  const signal = kitEl("p", "krm-risk-signal");
  signal.textContent =
    risks.length +
    " at risk · " +
    risks.map((item) => item.label + " · " + krmDate(item.endTime)).join(" / ");
  host.append(signal);
}
function krmTimeScale(value = "adaptive") {
  if (!["adaptive", "calendar"].includes(value)) {
    throw new Error("renderRoadmap: timeScale must be adaptive or calendar");
  }
  return value;
}

function krmAppendScaleNote(figure, timeAxis, rangeStart, rangeEnd) {
  if (timeAxis.split !== null) {
    const scaleNote = kitEl("p", "krm-scale-note");
    scaleNote.textContent =
      "Uneven time scale · " +
      krmDate(rangeStart) +
      "–" +
      krmDate(timeAxis.split - 86_400_000) +
      " expanded · " +
      krmDate(timeAxis.split) +
      "–" +
      krmDate(rangeEnd) +
      " compressed";
    scaleNote.title = "Compare dates, not bar lengths across the break.";
    figure.append(scaleNote);
  }
}

// Expand a concentrated delivery window without dropping later commitments.
// Use the authored set, so walkthrough emphasis never changes the time scale.
function krmTimeAxis(items, start, end, mode) {
  const duration = end - start;
  const ends = items.map((item) => item.endTime).toSorted((a, b) => a - b);
  let split = null;
  if (mode !== "calendar" && ends.length >= 6) {
    const busiestEnd = new Date(ends[Math.ceil(ends.length * 0.8) - 1]);
    const candidate = Date.UTC(busiestEnd.getUTCFullYear(), busiestEnd.getUTCMonth() + 1, 1);
    const fraction = (candidate - start) / duration;
    if (fraction > 0 && fraction < 0.5 && end - candidate >= 45 * 86_400_000) {
      split = candidate;
    }
  }
  return {
    split,
    position(value) {
      if (split === null) {
        return (value - start) / duration;
      }
      return value <= split
        ? ((value - start) / (split - start)) * 0.72
        : 0.72 + ((value - split) / (end - split)) * 0.28;
    },
  };
}

function krmMonthAxis(svg, add, rangeStart, rangeEnd, x, top, bottom) {
  if (rangeEnd - rangeStart > 550 * 86_400_000) {
    return;
  }
  const date = new Date(rangeStart);
  date.setUTCDate(1);
  while (date.getTime() < rangeEnd) {
    const px = x(Math.max(rangeStart, date.getTime()));
    add(
      svg,
      "text",
      { class: "krm-month-label", x: px + 8, y: top - 10 },
      date.toLocaleDateString("en", { month: "short", timeZone: "UTC" }),
    );
    add(svg, "line", { class: "krm-month-rule", x1: px, x2: px, y1: top, y2: bottom });
    date.setUTCMonth(date.getUTCMonth() + 1);
  }
}

function krmCloneBaseLanes(lanes, selectedIds) {
  return lanes.map(function (lane) {
    return {
      ...lane,
      items: (lane.items || []).map(function (item) {
        const copy = Object.assign({}, item);
        if (selectedIds) {
          copy.key = selectedIds.has(item.id);
        }
        return copy;
      }),
    };
  });
}

function krmRecommendKeyItems(lanes, walkthrough, dependencies) {
  const walkthroughIds = new Set();
  walkthrough.forEach(function (step) {
    (step.items || []).forEach((id) => walkthroughIds.add(id));
  });
  const dependencyIds = new Set();
  dependencies.forEach(function (dependency) {
    dependencyIds.add(dependency.from);
    dependencyIds.add(dependency.to);
  });
  const authored = [];
  lanes.forEach(function (lane, laneIndex) {
    (lane.items || []).forEach(function (item, itemIndex) {
      authored.push({
        id: item.id,
        laneIndex,
        itemIndex,
        walkthrough: walkthroughIds.has(item.id) ? 1 : 0,
        dependency: dependencyIds.has(item.id) ? 1 : 0,
        urgent: item.state === "now" || item.state === "risk" ? 1 : 0,
        milestone: item.at ? 1 : 0,
      });
    });
  });
  function compare(a, b) {
    return (
      b.walkthrough - a.walkthrough ||
      b.dependency - a.dependency ||
      b.urgent - a.urgent ||
      b.milestone - a.milestone ||
      a.laneIndex - b.laneIndex ||
      a.itemIndex - b.itemIndex
    );
  }
  const selected = new Set();
  if (lanes.length <= 6) {
    lanes.forEach(function (_lane, laneIndex) {
      const best = authored.filter((item) => item.laneIndex === laneIndex).toSorted(compare)[0];
      if (best) {
        selected.add(best.id);
      }
    });
  }
  const target = Math.min(6, authored.length);
  authored.toSorted(compare).forEach(function (item) {
    if (selected.size < target) {
      selected.add(item.id);
    }
  });
  return authored.filter((item) => selected.has(item.id)).map((item) => item.id);
}

function krmIsNarrowPresent() {
  return document.body.classList.contains("presenting") && window.innerWidth <= 480;
}

function krmContentSpacing() {
  if (typeof getComputedStyle !== "function") {
    return 1;
  }
  const value = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--content-space-scale"),
  );
  return Math.max(0.75, Math.min(1.35, value || 1));
}

function krmTimelineDimensions(narrowPresent) {
  const spacing = krmContentSpacing();
  // Reserve clearance above the largest supported group heading (28px).
  // Move its items with it, so extra group spacing never crowds the first row.
  const laneLabelOffset = 44 + 24 * (spacing - 1);
  return {
    width: narrowPresent ? 900 : 1500,
    left: narrowPresent ? 330 : 480,
    right: narrowPresent ? 20 : 40,
    trackHeight: 44 + 24 * (spacing - 1),
    lanePadding: laneLabelOffset + 24 + 32 * (spacing - 1),
    laneLabelOffset,
  };
}

function krmInstallRoadmapUpdates(host, updateLanePage, data) {
  const timeline = host.classList.contains("krm-layout-timeline");
  let renderedSpacing = krmContentSpacing();
  const renderedDimensions = timeline
    ? JSON.stringify(krmTimelineDimensions(krmIsNarrowPresent()))
    : null;
  const refreshLanePage = () => {
    if (!timeline) {
      const spacing = krmContentSpacing();
      if (spacing !== renderedSpacing) {
        renderedSpacing = spacing;
        window.dispatchEvent(new CustomEvent("kitcomponentchange", { detail: { host } }));
      }
      return;
    }
    const dimensions = JSON.stringify(krmTimelineDimensions(krmIsNarrowPresent()));
    if (dimensions !== renderedDimensions) {
      renderRoadmap(host, {
        ...data,
        __walkContext: host.__kitRoadmapHolder.current(),
      });
      window.dispatchEvent(new CustomEvent("kitcomponentchange", { detail: { host } }));
      return;
    }
    if (updateLanePage) {
      updateLanePage(host.__kitRoadmapLanePage || 0);
    }
  };
  if (timeline) {
    window.addEventListener("resize", refreshLanePage);
    window.addEventListener("kitpresentchange", refreshLanePage);
  }
  const spacingObserver =
    typeof MutationObserver === "function" ? new MutationObserver(refreshLanePage) : null;
  if (spacingObserver) {
    spacingObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "class"],
    });
  }
  host.__kitDispose = function __kitDispose() {
    if (spacingObserver) {
      spacingObserver.disconnect();
    }
    if (timeline) {
      window.removeEventListener("resize", refreshLanePage);
      window.removeEventListener("kitpresentchange", refreshLanePage);
    }
  };
}

function krmSetSwapValue(host, entry, key, value, render) {
  if (
    key === "items" &&
    value === "key" &&
    !host.__kitBase.lanes.some((lane) => (lane.items || []).some((item) => item.key === true))
  ) {
    entry.applyKeyItems(entry.recommendKeyItems());
    return;
  }
  host.__kitSwapState[key] = value;
  render();
}

function krmKeyChoiceLabel(keyCount, suggestedCount) {
  return keyCount ? "Key commitments · " + keyCount : "Suggest key commitments · " + suggestedCount;
}

// A phase briefing keeps the horizon visible without presenting every fact at once.
// Pages retain all commitments, including work that continues across a boundary.
function krmRenderPhaseLayout(host, { periods, lanes, items, dependencies, allItems }) {
  const itemEls = Object.create(null);
  const laneEls = Object.fromEntries(lanes.map((lane) => [lane.id, []]));
  const laneById = Object.fromEntries(lanes.map((lane) => [lane.id, lane]));
  const figure = kitEl("figure", "krm-canvas krm-card-canvas krm-chapters");
  const rail = kitEl("nav", "krm-chapter-rail");
  rail.setAttribute("aria-label", "Roadmap phases");
  const deck = kitEl("div", "krm-chapter-deck");
  const pages = [];
  const phaseButtons = [];
  const phaseCards = [];
  const firstPages = [];
  let selected = 0;
  let showAll = false;
  const membership = new Map(
    allItems.map((item) => {
      const indices = periods.flatMap((period, index) => {
        const overlaps = item.milestone
          ? item.startTime >= period.startTime &&
            (item.startTime < period.endTime ||
              (index === periods.length - 1 && item.startTime === period.endTime))
          : item.startTime < period.endTime && item.endTime > period.startTime;
        return overlaps ? [index] : [];
      });
      // Authored periods may have gaps. Keep gap-only work in the preceding
      // briefing, explicitly labeled, rather than silently losing it.
      if (!indices.length) {
        indices.push(
          Math.max(
            0,
            periods.findLastIndex((period) => period.startTime <= item.startTime),
          ),
        );
      }
      return [item.id, indices];
    }),
  );
  periods.forEach((period, phaseIndex) => {
    const inPhase = (item) => membership.get(item.id).includes(phaseIndex);
    const activeItems = items
      .filter(inPhase)
      .toSorted(
        (a, b) =>
          Number(a.startTime < period.startTime) - Number(b.startTime < period.startTime) ||
          a.startTime - b.startTime ||
          a.laneIndex - b.laneIndex,
      );
    const total = allItems.filter(inPhase).length;
    const count =
      activeItems.length === total ? String(total) : activeItems.length + " of " + total;
    firstPages.push(pages.length);
    const button = kitEl("button", "krm-chapter-tab");
    button.type = "button";
    button.append(
      kitEl("span", "krm-chapter-index", String(phaseIndex + 1).padStart(2, "0")),
      kitEl("span", "", period.label),
      kitEl("small", "", count + (total === 1 ? " commitment" : " commitments")),
    );
    button.addEventListener("click", () => {
      showAll = false;
      select(firstPages[phaseIndex]);
    });
    rail.append(button);
    phaseButtons.push(button);
    for (let offset = 0; offset < Math.max(1, activeItems.length); offset += 4) {
      const page = kitEl("section", "krm-chapter");
      const heading = kitEl("header", "krm-chapter-heading");
      const between = activeItems.filter(
        (item) => item.startTime >= period.endTime && phaseIndex < periods.length - 1,
      ).length;
      const starts =
        activeItems.filter((item) => item.startTime >= period.startTime).length - between;
      heading.append(
        kitEl("span", "krm-chapter-eyebrow", "Phase " + (phaseIndex + 1) + " / " + periods.length),
        kitEl("h3", "krm-chapter-title", period.label),
        kitEl(
          "p",
          "krm-chapter-scope",
          starts +
            " start · " +
            (activeItems.length - starts - between) +
            " continue" +
            (between ? " · " + between + " between phases" : ""),
        ),
      );
      const list = kitEl("div", "krm-chapter-list");
      const pageItems = activeItems.slice(offset, offset + 4);
      pageItems.forEach((item) => {
        const row = kitEl("article", "krm-chapter-item krm-state-" + item.state);
        row.dataset.item = item.id;
        row.append(kitEl("h4", "krm-chapter-item-title", item.label));
        const continuing = item.startTime < period.startTime;
        const betweenPhases = item.startTime >= period.endTime && phaseIndex < periods.length - 1;
        row.append(
          kitEl(
            "p",
            "krm-chapter-meta",
            (betweenPhases
              ? "Between phases"
              : continuing
                ? "Continues"
                : item.milestone
                  ? "Milestone"
                  : "Starts") +
              " · " +
              laneById[item.laneId].label +
              " · " +
              (item.milestone ? krmDate(item.startTime) : krmDateRange(item)),
          ),
        );
        row.append(kitEl("span", "krm-chapter-state", krmStateLabel(item.state)));
        const detail = kitEl("div", "krm-chapter-detail");
        if (item.note) {
          detail.append(kitEl("p", "", item.note));
        }
        dependencies
          .filter((dependency) => dependency.to === item.id)
          .forEach((dependency) => {
            const source = allItems.find((candidate) => candidate.id === dependency.from);
            if (source) {
              detail.append(kitEl("p", "", "Depends on " + source.label));
            }
          });
        row.append(detail);
        list.append(row);
        itemEls[item.id] ||= row;
        phaseCards.push({ item, row });
      });
      if (!pageItems.length) {
        list.append(
          kitEl(
            "p",
            "krm-chapter-empty",
            "No commitments in this phase for the current selection.",
          ),
        );
      }
      page.append(heading, list);
      deck.append(page);
      pages.push({ page, phaseIndex, items: pageItems, offset, total: activeItems.length });
    }
  });
  const footer = kitEl("div", "krm-chapter-footer");
  const previous = kitEl("button", "", "← Previous");
  const position = kitEl("span", "krm-chapter-position");
  position.setAttribute("aria-live", "polite");
  const next = kitEl("button", "", "Next →");
  const all = kitEl("button", "krm-chapter-secondary", "Complete list");
  const detail = kitEl("button", "krm-chapter-secondary", "Notes & dependencies");
  [previous, next, all, detail].forEach((button) => {
    button.type = "button";
  });
  detail.setAttribute("aria-expanded", "false");
  detail.addEventListener("click", () => {
    const expanded = detail.getAttribute("aria-expanded") !== "true";
    detail.setAttribute("aria-expanded", String(expanded));
    figure.classList.toggle("krm-chapter-detailed", expanded);
  });
  previous.addEventListener("click", () => select(selected - 1));
  next.addEventListener("click", () => select(selected + 1));
  all.addEventListener("click", () => {
    showAll = !showAll;
    select(selected);
  });
  footer.append(previous, position, next, all, detail);
  figure.append(rail, deck, footer);
  host.append(figure);
  function select(requestedPage) {
    selected = Math.max(0, Math.min(pages.length - 1, requestedPage));
    host.__kitRoadmapPhasePage = selected;
    const current = pages[selected];
    deck.scrollTop = 0;
    figure.classList.toggle("krm-chapter-all", showAll);
    pages.forEach(({ page }, pageIndex) => {
      const visible = showAll || pageIndex === selected;
      page.classList.toggle("current", visible);
      page.inert = !visible;
      page.setAttribute("aria-hidden", String(!visible));
    });
    phaseButtons.forEach((button, index) => {
      if (!showAll && index === current.phaseIndex) {
        button.setAttribute("aria-current", "step");
      } else {
        button.setAttribute("aria-current", "false");
      }
    });
    previous.disabled = selected === 0 || showAll;
    next.disabled = selected === pages.length - 1 || showAll;
    next.textContent =
      pages[selected + 1] && pages[selected + 1].phaseIndex === current.phaseIndex
        ? "More commitments →"
        : "Next phase →";
    previous.textContent =
      pages[selected - 1] && pages[selected - 1].phaseIndex === current.phaseIndex
        ? "← Earlier commitments"
        : "← Previous phase";
    position.textContent = showAll
      ? "Complete list"
      : current.total
        ? current.offset +
          1 +
          "–" +
          (current.offset + current.items.length) +
          " of " +
          current.total +
          " commitments"
        : "No commitments";
    all.textContent = showAll ? "One phase at a time" : "Complete list";
  }
  select(host.__kitRoadmapPhasePage || 0);
  function focusPhase(focusItems, focusLanes, hasFocus, overview) {
    if (overview) {
      showAll = false;
      select(0);
    }
    const active = (item) => focusItems.has(item.id) || focusLanes.has(item.laneId);
    phaseCards.forEach(({ item, row }) => {
      row.classList.toggle("krm-dim", hasFocus && !active(item));
      row.classList.toggle("krm-focus", hasFocus && active(item));
    });
    phaseButtons.forEach((button, index) => {
      button.classList.toggle(
        "krm-chapter-focused",
        hasFocus && pages.some((page) => page.phaseIndex === index && page.items.some(active)),
      );
    });
    if (hasFocus && !showAll && !pages[selected].items.some(active)) {
      const target = pages.findIndex((page) => page.items.some(active));
      if (target !== -1) {
        select(target);
      }
    }
  }
  return { itemEls, laneEls, dependencyEls: {}, focusPhase };
}

function krmRenderCardLayout(host, options) {
  if (options.layout === "phases") {
    return krmRenderPhaseLayout(host, { ...options, dependencies: options.allDependencies });
  }
  const { lanes, items, dependencies, allItems } = options;
  const itemEls = Object.create(null);
  const laneEls = Object.create(null);
  const dependencyEls = Object.create(null);
  lanes.forEach((lane) => {
    laneEls[lane.id] = [];
  });
  function ordinal(item) {
    return String(allItems.indexOf(item) + 1).padStart(2, "0");
  }
  function card(item) {
    const el = kitEl(
      "div",
      "krm-card-item krm-state-" + item.state + (item.milestone ? " krm-card-milestone" : ""),
    );
    el.dataset.item = item.id;
    if (item.note) {
      el.setAttribute("title", item.note);
    }
    el.append(kitEl("strong", "krm-card-title", item.label || item.id));
    const date = item.milestone
      ? krmStateLabel(item.state) + " · " + krmDate(item.startTime)
      : item.state === "planned"
        ? "Starts " + krmDate(item.startTime)
        : krmStateLabel(item.state) + " · ends " + krmDate(item.endTime);
    el.append(kitEl("span", "krm-card-date", date));
    if (item.note) {
      el.append(kitEl("p", "krm-card-note", item.note));
    }
    const incoming = dependencies.filter((dependency) => dependency.to === item.id);
    incoming.forEach((dependency) => {
      const ref = kitEl(
        "span",
        "krm-card-dependency",
        "Depends on " +
          (allItems.find((candidate) => candidate.id === dependency.from).label ||
            ordinal(allItems.find((candidate) => candidate.id === dependency.from))),
      );
      ref.dataset.dependency = String(dependency.sourceIndex);
      dependencyEls[String(dependency.sourceIndex)] = ref;
      el.append(ref);
    });
    itemEls[item.id] = el;
    return el;
  }

  const figure = kitEl("figure", "krm-canvas krm-card-canvas");
  const board = kitEl("div", "krm-workstream-board");
  const columns = kitEl("div", "krm-workstream-columns");
  ["Workstream", "Shipped", "In flight", "Next", "Later"].forEach((label) =>
    columns.append(kitEl("span", "", label)),
  );
  board.append(columns);
  lanes.forEach((lane) => {
    const row = kitEl("section", "krm-workstream-row");
    row.dataset.lane = lane.id;
    laneEls[lane.id].push(row);
    const label = kitEl("div", "krm-workstream-label");
    label.append(kitEl("strong", "", lane.label));
    if (lane.sub) {
      label.append(kitEl("small", "", lane.sub));
    }
    const flow = kitEl("div", "krm-workstream-flow");
    const laneItems = items
      .filter((item) => item.laneId === lane.id)
      .toSorted((a, b) => a.startTime - b.startTime || a.itemIndex - b.itemIndex);
    const planned = laneItems.filter((item) => item.state === "planned");
    [
      { id: "done", items: laneItems.filter((item) => item.state === "done") },
      {
        id: "now",
        items: laneItems.filter((item) => item.state === "now" || item.state === "risk"),
      },
      { id: "next", items: planned.slice(0, 1) },
      { id: "later", items: planned.slice(1) },
    ].forEach((bucket) => {
      const bucketEl = kitEl("div", "krm-workstream-bucket");
      bucketEl.dataset.status = bucket.id;
      if (bucket.items.length) {
        bucket.items.forEach((item) => bucketEl.append(card(item)));
      } else {
        bucketEl.append(kitEl("span", "krm-workstream-empty", "—"));
      }
      flow.append(bucketEl);
    });
    row.append(label, flow);
    board.append(row);
  });
  figure.append(board);
  host.append(figure);
  return { itemEls, laneEls, dependencyEls, focusPhase() {} };
}

function renderRoadmap(sel, data) {
  const host = kitMount(sel);
  kitValidateTextCaps(host, "renderRoadmap", data);
  const TAG = "renderRoadmap";
  const lanes = data.lanes || [];
  const periods = data.periods || [];
  const dependencies = data.dependencies || [];
  const walkthrough = data.walkthrough || [];
  const hasKeyItems = lanes.some((lane) => (lane.items || []).some((item) => item.key === true));
  const layout = data.layout === undefined ? "timeline" : data.layout;
  const requestedItems = data.items === undefined ? (hasKeyItems ? "key" : "all") : data.items;
  const itemMode = requestedItems === "key" && !hasKeyItems ? "all" : requestedItems;
  const viewMode = data.view === undefined ? "follow" : data.view;
  const timeScale = krmTimeScale(data.timeScale);
  const typeScale = data.typeScale === undefined ? "large" : data.typeScale;
  const walkthroughText = data.walkthroughText !== false;
  if (!["timeline", "phases", "workstreams"].includes(layout)) {
    throw new Error(TAG + ': unknown layout "' + layout + '" — timeline | phases | workstreams');
  }
  if (!["key", "all"].includes(itemMode)) {
    throw new Error(TAG + ': unknown items "' + itemMode + '" — key | all');
  }
  if (!["full", "follow"].includes(viewMode)) {
    throw new Error(TAG + ': unknown view "' + viewMode + '" — full | follow');
  }
  if (!Object.hasOwn(ROADMAP_TYPE_PRESETS, typeScale)) {
    throw new Error(TAG + ': unknown typeScale "' + typeScale + '" — standard | large');
  }
  const typePreset = ROADMAP_TYPE_PRESETS[typeScale];
  if (lanes.length < 1 || lanes.length > 5) {
    throw new Error(TAG + ": supports 1-5 lanes");
  }
  if (periods.length < 2 || periods.length > 8) {
    throw new Error(TAG + ": supports 2-8 periods");
  }
  if (dependencies.length > 12 || walkthrough.length > 6) {
    throw new Error(TAG + ": supports at most 12 dependencies and 6 walkthrough steps");
  }
  function time(value, where) {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) {
      throw new TypeError(TAG + ": " + where + " must be a parseable date");
    }
    return parsed;
  }
  const parsedPeriods = periods.map(function (period, index) {
    const start = time(period.start, "periods[" + index + "].start");
    const end = time(period.end, "periods[" + index + "].end");
    if (!(end > start)) {
      throw new Error(TAG + ": every period end must be after its start");
    }
    return Object.assign({}, period, { startTime: start, endTime: end });
  });
  parsedPeriods.forEach(function (period, index) {
    if (index && period.startTime < parsedPeriods[index - 1].endTime) {
      throw new Error(TAG + ": periods must be ordered and must not overlap");
    }
  });
  const rangeStart = parsedPeriods[0].startTime;
  const rangeEnd = parsedPeriods.at(-1).endTime;
  // author-supplied ids key this map, so an item called "toString" must not
  // arrive already truthy off the prototype
  const itemById = Object.create(null);
  const allItems = [];
  const laneIds = new Set();
  const allowedStates = new Set(["done", "now", "planned", "risk"]);
  lanes.forEach(function (lane, laneIndex) {
    const items = lane.items || [];
    // a duplicate id would overwrite the lane's element and leave the
    // walkthrough able to focus only the last of the pair
    if (!lane.id || laneIds.has(lane.id) || items.length < 1 || items.length > 7) {
      throw new Error(TAG + ": each lane needs a unique id and 1-7 items");
    }
    laneIds.add(lane.id);
    items.forEach(function (item, itemIndex) {
      if (!item.id || itemById[item.id]) {
        throw new Error(TAG + ": item ids must be unique");
      }
      if (item.key != null && typeof item.key !== "boolean") {
        throw new Error(TAG + ': item "' + item.id + '" key must be true or false');
      }
      const start = time(item.at || item.start, "item " + item.id + " start");
      const end = item.at ? start : time(item.end, "item " + item.id + " end");
      if (!item.at && !(end > start)) {
        throw new Error(TAG + ': item "' + item.id + '" end must be after start');
      }
      if (start < rangeStart || end > rangeEnd) {
        throw new Error(TAG + ': item "' + item.id + '" sits outside the period range');
      }
      const state = item.state || "planned";
      if (!allowedStates.has(state)) {
        throw new Error(TAG + ': item "' + item.id + '" has an unknown state');
      }
      const normalized = {
        ...item,
        laneId: lane.id,
        laneIndex,
        itemIndex,
        startTime: start,
        endTime: end,
        state,
        milestone: Boolean(item.at),
      };
      itemById[item.id] = normalized;
      allItems.push(normalized);
    });
  });
  if (allItems.length > 24) {
    throw new Error(TAG + ": supports at most 24 items");
  }
  dependencies.forEach(function (dependency, index) {
    if (!itemById[dependency.from] || !itemById[dependency.to]) {
      throw new Error(TAG + ": dependency " + (index + 1) + " references an unknown item");
    }
  });
  walkthrough.forEach(function (step, index) {
    (step.items || []).forEach(function (id) {
      if (!itemById[id]) {
        throw new Error(
          TAG + ": walkthrough step " + (index + 1) + ' references unknown item "' + id + '"',
        );
      }
    });
    (step.lanes || []).forEach(function (id) {
      if (!lanes.some((lane) => lane.id === id)) {
        throw new Error(
          TAG + ": walkthrough step " + (index + 1) + ' references unknown lane "' + id + '"',
        );
      }
    });
    // dependencies are addressed by position, and an out-of-range index would
    // otherwise dim every arrow and focus none of them without a word
    (step.dependencies || []).forEach(function (ref) {
      const at = Number(ref);
      if (!Number.isInteger(at) || at < 0 || at >= dependencies.length) {
        throw new Error(
          TAG +
            ": walkthrough step " +
            (index + 1) +
            ' references unknown dependency "' +
            ref +
            '"',
        );
      }
    });
  });

  const itemContext = krmItemContext(
    data,
    walkthrough,
    allItems,
    dependencies,
    itemMode,
    hasKeyItems,
  );
  const { contextIndex, visibleItems } = itemContext;
  const visibleItemIds = new Set(visibleItems.map((item) => item.id));
  const visibleLanes = lanes.filter((lane) =>
    (lane.items || []).some((item) => visibleItemIds.has(item.id)),
  );
  const visibleDependencies = dependencies
    .map((dependency, index) => Object.assign({}, dependency, { sourceIndex: index }))
    .filter(
      (dependency) => visibleItemIds.has(dependency.from) && visibleItemIds.has(dependency.to),
    );

  host.classList.remove("krm-layout-timeline", "krm-layout-phases", "krm-layout-workstreams");
  host.classList.add("krm", "krm-layout-" + layout);
  // A key-context walkthrough rebuilds the SVG. Keep that replacement quiet;
  // the walkthrough is changing emphasis, not replaying the canvas entrance.
  const contextRefresh = [host.__kitRoadmapDriver, data.__walkContext !== undefined].every(Boolean);
  host.classList.toggle("krm-context-refresh", contextRefresh);
  host.style.setProperty("--krm-item-label-size", typePreset.itemSize + "px");
  host.style.setProperty("--krm-item-label-weight", typePreset.itemWeight);
  host.style.setProperty("--krm-lane-label-size", typePreset.laneSize + "px");
  host.style.setProperty("--krm-meta-size", typePreset.metaSize + "px");
  host.style.setProperty("--krm-key-size", typePreset.keySize);
  host.style.setProperty("--krm-walk-title-size", typePreset.walkTitleSize);
  host.style.setProperty("--krm-walk-note-size", typePreset.walkNoteSize);
  host.dataset.walkthroughText = String(walkthroughText);
  host.dataset.items = itemMode;
  host.dataset.view = viewMode;
  host.dataset.dependencies = String(data.showDependencies !== false);
  if (!host.__kitBase) {
    const authoredBase = {
      ...data,
      lanes: krmCloneBaseLanes(lanes),
      kind: "roadmap",
    };
    host.__kitRoadmapAuthoredBase = authoredBase;
    host.__kitBase = {
      ...authoredBase,
      lanes: krmCloneBaseLanes(authoredBase.lanes),
    };
    host.__kitSwapState = {
      layout,
      items: itemMode,
      typeScale,
      timeScale,
      view: viewMode,
      showDependencies: data.showDependencies !== false,
    };
    const suggestedKeyCount = krmRecommendKeyItems(
      host.__kitRoadmapAuthoredBase.lanes,
      walkthrough,
      dependencies,
    ).length;
    const itemsOption = {
      key: "items",
      label: "Items",
      type: "choice",
      choices: ["key", "all"],
      choiceLabels: {
        key: krmKeyChoiceLabel(
          allItems.filter((item) => item.key === true).length,
          suggestedKeyCount,
        ),
        all: "All work · " + allItems.length,
      },
      disabledChoices: [],
      recommendChoice: hasKeyItems ? null : "key",
      help: hasKeyItems
        ? "Supporting items appear only during the step that needs them."
        : "Selecting this uses a balanced suggestion from the roadmap and saves the exact items for review.",
    };
    function updateItemsOption(keyCount, recommended) {
      itemsOption.choiceLabels.key = krmKeyChoiceLabel(keyCount, suggestedKeyCount);
      itemsOption.disabledChoices = [];
      itemsOption.help = recommended
        ? "Recommended key commitments applied. Supporting items appear only during the step that needs them."
        : keyCount
          ? "Supporting items appear only during the step that needs them."
          : "Selecting this uses a balanced suggestion from the roadmap and saves the exact items for review.";
    }
    function renderSwapBase() {
      return renderRoadmap(host, {
        ...host.__kitBase,
        __walkContext: host.__kitRoadmapHolder ? host.__kitRoadmapHolder.current() : 0,
        layout: host.__kitSwapState.layout,
        items: host.__kitSwapState.items,
        typeScale: host.__kitSwapState.typeScale,
        timeScale: host.__kitSwapState.timeScale,
        view: host.__kitSwapState.view,
        showDependencies: host.__kitSwapState.showDependencies,
      });
    }
    const entry = {
      host,
      label: data.ariaLabel || "Roadmap",
      options: [
        {
          key: "layout",
          label: "Layout",
          type: "choice",
          choices: ["timeline", "phases", "workstreams"],
          choiceLabels: {
            timeline: "Timeline",
            phases: "Phases",
            workstreams: "Workstreams",
          },
        },
        itemsOption,
        {
          key: "timeScale",
          label: "Timeline spacing",
          // Keep older review selections replayable; Studio uses automatic
          // date-axis spacing instead of exposing an often-identical choice.
          hidden: true,
          type: "choice",
          choices: ["adaptive", "calendar"],
          choiceLabels: { adaptive: "Busy window", calendar: "Even calendar" },
          help: "Busy window gives concentrated work more room and marks the compressed future. Even calendar keeps equal time at equal width.",
        },
        {
          key: "typeScale",
          label: "Text size",
          type: "choice",
          choices: ["standard", "large"],
          choiceLabels: { standard: "Normal", large: "Large" },
        },
        {
          key: "showDependencies",
          label: "Dependencies",
          type: "toggle",
        },
        {
          key: "view",
          label: "Walkthrough emphasis",
          type: "choice",
          choices: ["full", "follow"],
          choiceLabels: { full: "Keep context", follow: "Spotlight step" },
          help: "Advance a step to see the emphasis change.",
        },
      ],
      get(key) {
        return host.__kitSwapState[key];
      },
      set(key, value) {
        if (
          !["layout", "items", "typeScale", "timeScale", "view", "showDependencies"].includes(key)
        ) {
          return;
        }
        krmSetSwapValue(host, entry, key, value, renderSwapBase);
      },
      recommendKeyItems() {
        return krmRecommendKeyItems(host.__kitRoadmapAuthoredBase.lanes, walkthrough, dependencies);
      },
      applyKeyItems(ids) {
        if (!Array.isArray(ids)) {
          throw new TypeError(TAG + ": applyKeyItems(ids) expects an array of item ids");
        }
        const selected = new Set(ids);
        ids.forEach(function (id) {
          if (!itemById[id]) {
            throw new Error(TAG + ': applyKeyItems references unknown item "' + id + '"');
          }
        });
        host.__kitBase = {
          ...host.__kitRoadmapAuthoredBase,
          lanes: krmCloneBaseLanes(host.__kitRoadmapAuthoredBase.lanes, selected),
        };
        host.__kitSwapState.items = "key";
        updateItemsOption(selected.size, true);
        renderSwapBase();
        return allItems.filter((item) => selected.has(item.id)).map((item) => item.label);
      },
      keyItemSelection() {
        return host.__kitBase.lanes
          .flatMap((lane) => lane.items || [])
          .filter((item) => item.key === true)
          .map((item) => ({ id: item.id, label: item.label || item.id }));
      },
      clearRecommendedKeyItems() {
        host.__kitBase = {
          ...host.__kitRoadmapAuthoredBase,
          lanes: krmCloneBaseLanes(host.__kitRoadmapAuthoredBase.lanes),
        };
        host.__kitSwapState.items = itemMode;
        updateItemsOption(allItems.filter((item) => item.key === true).length, false);
        renderSwapBase();
      },
    };
    (window.__kitSwappable = window.__kitSwappable || []).push(entry);
  }
  host.dataset.zoom = "";
  let laneEls = Object.create(null);
  const scope = kitEl("p", "krm-scope");
  scope.textContent = itemContext.scope;
  scope.setAttribute("aria-live", "polite");
  const summary = kitEl("div", "krm-summary");
  summary.append(scope);
  krmRiskSignal(summary, allItems);
  host.append(summary);
  let itemEls = Object.create(null);
  let dependencyEls = Object.create(null);
  let updateLanePage = null;
  let focusPhase = () => {};
  if (layout === "timeline") {
    const narrowPresent = krmIsNarrowPresent();
    const dimensions = krmTimelineDimensions(narrowPresent);
    const NS = "http://www.w3.org/2000/svg";
    function add(parent, tag, attrs, value) {
      const node = document.createElementNS(NS, tag);
      Object.keys(attrs || {}).forEach((key) => node.setAttribute(key, attrs[key]));
      if (value != null) {
        node.textContent = value;
      }
      parent.append(node);
      return node;
    }
    const W = dimensions.width;
    const LEFT = dimensions.left;
    const RIGHT = dimensions.right;
    const TOP = 64;
    const TRACK_H = dimensions.trackHeight;
    const LANE_PAD = dimensions.lanePadding;
    // Placement and rendered type consume the same preset value, so a Studio
    // switch cannot route a label using stale geometry.
    const laneLayouts = [];
    let cursorY = TOP;
    visibleLanes.forEach(function (lane) {
      const ends = [];
      const laid = (lane.items || [])
        .map((item) => itemById[item.id])
        .filter((item) => visibleItemIds.has(item.id))
        .toSorted((a, b) => a.startTime - b.startTime)
        .map(function (item) {
          const track = ends.length;
          ends.push(item.endTime);
          item.track = track;
          return item;
        });
      const height = Math.max(84, ends.length * TRACK_H + LANE_PAD);
      laneLayouts.push({
        lane,
        items: laid,
        y: cursorY,
        height,
      });
      cursorY += height;
    });
    const todayTime = data.today ? time(data.today, "today") : null;
    const showToday = todayTime != null && todayTime >= rangeStart && todayTime <= rangeEnd;
    const GRID_BOTTOM = cursorY;
    const H = GRID_BOTTOM + 12;
    const plotWidth = W - LEFT - RIGHT;
    const timeAxis = krmTimeAxis(allItems, rangeStart, rangeEnd, timeScale);
    const x = (value) => LEFT + timeAxis.position(value) * plotWidth;

    const figure = kitEl("figure", "krm-canvas");
    const periodKey = kitEl("figcaption", "krm-periods");
    parsedPeriods.forEach(function (period) {
      periodKey.append(kitEl("span", "", period.label));
    });
    figure.append(periodKey);
    krmAppendScaleNote(figure, timeAxis, rangeStart, rangeEnd);
    const svg = add(figure, "svg", {
      viewBox: "0 0 " + W + " " + H,
      role: "img",
      "aria-label": data.ariaLabel || "Roadmap by workstream and period",
    });
    const defs = add(svg, "defs");
    const marker = add(defs, "marker", {
      id: "krm-arrow-" + (window.__krmSeq = (window.__krmSeq || 0) + 1),
      viewBox: "0 0 8 8",
      refX: 7,
      refY: 4,
      markerWidth: 7,
      markerHeight: 7,
      orient: "auto-start-reverse",
    });
    add(marker, "path", { d: "M0 0 L8 4 L0 8 Z", class: "krm-arrow-head" });
    const markerId = marker.getAttribute("id");

    const periodRects = [];
    const verticalRules = [];
    parsedPeriods.forEach(function (period, index) {
      const px = x(period.startTime);
      const pw = x(period.endTime) - px;
      periodRects.push(
        add(svg, "rect", {
          class: "krm-period" + (index % 2 ? " alt" : ""),
          x: px,
          y: TOP - 42,
          width: pw,
          height: GRID_BOTTOM - (TOP - 42),
        }),
      );

      verticalRules.push(
        add(svg, "line", {
          class: "krm-period-rule",
          x1: px,
          x2: px,
          y1: TOP - 42,
          y2: GRID_BOTTOM,
        }),
      );
    });
    verticalRules.push(
      add(svg, "line", {
        class: "krm-period-rule",
        x1: W - RIGHT,
        x2: W - RIGHT,
        y1: TOP - 42,
        y2: GRID_BOTTOM,
      }),
    );

    krmMonthAxis(svg, add, rangeStart, rangeEnd, x, TOP, GRID_BOTTOM);
    if (timeAxis.split !== null) {
      const boundary = x(timeAxis.split);
      verticalRules.push(
        add(svg, "line", {
          class: "krm-scale-break",
          x1: boundary,
          x2: boundary,
          y1: TOP,
          y2: GRID_BOTTOM,
        }),
      );
      add(svg, "text", { class: "krm-scale-break-label", x: boundary, y: TOP - 32 }, "//");
    }
    // The today line is a reference, so it paints behind the work it dates:
    // drawn last it cut through span labels and bar ends that sit across it.
    let todayLine = null;
    let todayLabel = null;
    if (showToday) {
      const tx = x(todayTime);
      todayLine = add(svg, "line", {
        class: "krm-today",
        x1: tx,
        x2: tx,
        y1: TOP - 42,
        y2: GRID_BOTTOM,
      });
      todayLabel = add(
        svg,
        "text",
        { class: "krm-today-label", x: tx + 8, y: TOP - 50 },
        data.todayLabel || "NOW",
      );
    }

    const dependencyLayer = add(svg, "g", { class: "krm-dependencies" });
    const itemPositions = Object.create(null);
    const laneGroups = [];
    laneLayouts.forEach(function (laneLayout, laneIndex) {
      const group = add(svg, "g", { class: "krm-lane", "data-lane": laneLayout.lane.id });
      group.dataset.lanePage = String(Math.floor(laneIndex / 2));
      laneGroups.push(group);
      laneEls[laneLayout.lane.id] = [group];
      add(group, "line", {
        class: "krm-lane-rule",
        x1: 22,
        x2: W - RIGHT,
        y1: laneLayout.y + laneLayout.height,
        y2: laneLayout.y + laneLayout.height,
      });
      add(
        group,
        "text",
        { class: "krm-lane-label", x: 22, y: laneLayout.y + dimensions.laneLabelOffset },
        laneLayout.lane.label,
      );
      if (laneLayout.lane.sub) {
        add(
          group,
          "text",
          { class: "krm-lane-sub", x: LEFT, y: laneLayout.y + dimensions.laneLabelOffset },
          laneLayout.lane.sub,
        );
      }
      laneLayout.items.forEach(function (item) {
        const cy = laneLayout.y + LANE_PAD + item.track * TRACK_H + 18;
        const startX = x(item.startTime);
        const endX = item.milestone ? startX : x(item.endTime);
        const g = add(group, "g", {
          class: "krm-item krm-state-" + item.state + (item.milestone ? " krm-milestone" : ""),
          "data-item": item.id,
          role: "img",
          "aria-label":
            item.label +
            " · " +
            krmStateLabel(item.state) +
            " · " +
            krmDateRange(item) +
            dependencies
              .filter((dependency) => dependency.to === item.id)
              .map(
                (dependency) =>
                  " · depends on " + (itemById[dependency.from].label || dependency.from),
              )
              .join(""),
        });
        add(g, "line", { class: "krm-row-guide", x1: LEFT, x2: W - RIGHT, y1: cy, y2: cy });
        // The rail is the only place an item's detail used to live, so it has to
        // survive the rail being dropped in Present.
        if (item.note) {
          add(g, "title", {}, item.note);
        }
        if (item.milestone) {
          add(g, "path", {
            d:
              "M" +
              startX +
              " " +
              (cy - 7) +
              " L" +
              (startX + 7) +
              " " +
              cy +
              " L" +
              startX +
              " " +
              (cy + 7) +
              " L" +
              (startX - 7) +
              " " +
              cy +
              " Z",
            class: "krm-mark",
            "vector-effect": "non-scaling-stroke",
            "shape-rendering": "geometricPrecision",
          });
        } else if (item.state === "planned") {
          add(g, "line", {
            class: "krm-mark",
            x1: startX,
            x2: endX,
            y1: cy,
            y2: cy,
          });
        } else {
          const markHeight = item.state === "now" ? 12 : 8;
          add(g, "rect", {
            class: "krm-mark",
            x: startX,
            y: cy - markHeight / 2,
            width: Math.max(10, endX - startX),
            height: markHeight,
            rx: 5,
            "vector-effect": "non-scaling-stroke",
            "shape-rendering": "geometricPrecision",
          });
          [startX, endX].forEach(function (terminalX) {
            add(g, "line", {
              class: "krm-terminal",
              x1: terminalX,
              x2: terminalX,
              y1: cy - 5,
              y2: cy + 5,
              "vector-effect": "non-scaling-stroke",
              "shape-rendering": "geometricPrecision",
            });
          });
        }
        add(g, "text", { class: "krm-item-label", x: 32, y: cy + 5 }, item.label);

        itemEls[item.id] = g;
        itemPositions[item.id] = {
          x1: startX,
          x2: endX,
          y: cy,
          lanePage: Math.floor(laneIndex / 2),
        };
      });
    });

    const dependencyPaths = [];
    visibleDependencies.forEach(function (dependency) {
      const from = itemPositions[dependency.from];
      const to = itemPositions[dependency.to];
      const bend = Math.max(from.x2 + 24, Math.min(to.x1 - 24, (from.x2 + to.x1) / 2));
      const d =
        "M" +
        from.x2 +
        " " +
        from.y +
        " C" +
        bend +
        " " +
        from.y +
        " " +
        bend +
        " " +
        to.y +
        " " +
        to.x1 +
        " " +
        to.y;
      const path = add(dependencyLayer, "path", {
        class: "krm-dependency",
        d,
        "data-dependency": String(dependency.sourceIndex),
        "marker-end": "url(#" + markerId + ")",
      });
      dependencyEls[String(dependency.sourceIndex)] = path;
      dependencyPaths.push({
        path,
        page: from.lanePage === to.lanePage ? from.lanePage : -1,
      });
    });

    host.append(figure);
    if (laneLayouts.length > 2) {
      const lanePages = kitEl("div", "krm-lane-pages");
      const previousLanes = kitEl("button", "", "←");
      const laneStatus = kitEl("span", "krm-lane-status");
      const nextLanes = kitEl("button", "", "→");
      const laneCues = kitEl("div", "krm-lane-cues");
      const evidenceCue = kitEl("span", "krm-lane-evidence-cue");
      const dependencyCue = kitEl("span", "krm-lane-dependency-cue");
      lanePages.setAttribute("role", "group");
      lanePages.setAttribute("aria-label", "Explore workstreams");
      const exploreLabel = kitEl("span", "krm-explore-label", "Explore workstreams");
      previousLanes.setAttribute("aria-label", "Previous workstreams");
      previousLanes.title = "Previous workstreams";
      nextLanes.setAttribute("aria-label", "Next workstreams");
      nextLanes.title = "Next workstreams";
      previousLanes.type = "button";
      nextLanes.type = "button";
      laneStatus.setAttribute("aria-live", "polite");
      laneCues.setAttribute("aria-live", "polite");
      laneCues.append(evidenceCue, dependencyCue);
      const fullTimeline = kitEl("button", "krm-full-timeline", "Show full timeline");
      fullTimeline.type = "button";
      lanePages.append(exploreLabel, previousLanes, laneStatus, nextLanes, fullTimeline, laneCues);
      host.append(lanePages);
      const monthRules = Array.from(svg.querySelectorAll(".krm-month-rule"));
      const pageCount = Math.ceil(laneLayouts.length / 2);
      const crossPageDependencyCount = dependencyPaths.filter(
        (record) => record.page === -1,
      ).length;
      let lanePage = Math.min(host.__kitRoadmapLanePage || 0, pageCount - 1);
      function laneRange(page) {
        const first = page * 2 + 1;
        return "lanes " + first + "–" + Math.min(first + 1, laneLayouts.length);
      }
      function updateLaneCues() {
        const focusedPages = new Set();
        laneGroups.forEach(function (group, index) {
          if (
            group.classList.contains("krm-lane-focus") ||
            group.querySelector(".krm-item.krm-focus")
          ) {
            focusedPages.add(Math.floor(index / 2));
          }
          group.classList.remove("krm-page-readable");
        });
        dependencyPaths.forEach(function (record) {
          if (record.page >= 0 && record.path.classList.contains("krm-focus")) {
            focusedPages.add(record.page);
          }
        });
        const evidenceElsewhere = focusedPages.size > 0 && !focusedPages.has(lanePage);
        laneGroups.slice(lanePage * 2, lanePage * 2 + 2).forEach(function (group) {
          group.classList.toggle("krm-page-readable", evidenceElsewhere);
        });
        evidenceCue.textContent = evidenceElsewhere
          ? "Step evidence is on " +
            Array.from(focusedPages).toSorted().map(laneRange).join(" and ") +
            "."
          : "";
        dependencyCue.textContent = crossPageDependencyCount
          ? crossPageDependencyCount +
            " " +
            (crossPageDependencyCount === 1 ? "dependency crosses" : "dependencies cross") +
            " workstream pages. Show the full timeline to trace them."
          : "";
      }
      updateLanePage = function (requestedPage) {
        lanePage = Math.max(0, Math.min(pageCount - 1, requestedPage));
        host.__kitRoadmapLanePage = lanePage;
        const pagingAvailable =
          document.body.classList.contains("presenting") &&
          (krmIsNarrowPresent() || visibleItems.length > 10);
        const pagingActive = pagingAvailable && !host.__kitRoadmapFullTimeline;
        scope.textContent = pagingActive
          ? itemContext.scope.replace(" items ·", " items selected ·")
          : itemContext.scope;
        host.dataset.lanePaging = String(pagingAvailable);
        [previousLanes, laneStatus, nextLanes, laneCues].forEach(function (control) {
          control.hidden = !pagingActive;
        });
        fullTimeline.textContent = pagingActive ? "Show full timeline" : "Focus two workstreams";
        if (!pagingActive) {
          svg.setAttribute("viewBox", "0 0 " + W + " " + H);
          laneGroups.forEach(function (group) {
            group.style.display = "";
            group.removeAttribute("aria-hidden");
            group.removeAttribute("transform");
          });
          dependencyPaths.forEach(function (record) {
            record.path.style.display = "";
            record.path.removeAttribute("aria-hidden");
            record.path.removeAttribute("transform");
          });
          periodRects.forEach((rect) => rect.setAttribute("height", GRID_BOTTOM - (TOP - 42)));
          verticalRules.concat(monthRules).forEach((rule) => rule.setAttribute("y2", GRID_BOTTOM));
          if (todayLine) {
            todayLine.setAttribute("y2", GRID_BOTTOM);
            todayLabel.setAttribute("y", TOP - 50);
          }
          return;
        }
        const start = lanePage * 2;
        const activeLayouts = laneLayouts.slice(start, start + 2);
        const shift = activeLayouts[0].y - TOP;
        const pageBottom =
          TOP + activeLayouts.reduce((height, laneLayout) => height + laneLayout.height, 0);
        // Every lane page uses the same frame, so paging cannot move the HUD.
        const pageHeight =
          TOP +
          Math.max(
            ...Array.from({ length: pageCount }, (_, page) =>
              laneLayouts
                .slice(page * 2, page * 2 + 2)
                .reduce((total, lane) => total + lane.height, 0),
            ),
          ) +
          12;
        svg.setAttribute("viewBox", "0 0 " + W + " " + pageHeight);
        laneGroups.forEach(function (group, index) {
          const active = index >= start && index < start + 2;
          group.style.display = active ? "" : "none";
          group.setAttribute("aria-hidden", String(!active));
          group.setAttribute("transform", active ? "translate(0 " + -shift + ")" : "");
        });
        dependencyPaths.forEach(function (record) {
          const active = record.page === lanePage;
          record.path.style.display = active ? "" : "none";
          record.path.setAttribute("aria-hidden", String(!active));
          record.path.setAttribute("transform", active ? "translate(0 " + -shift + ")" : "");
        });
        periodRects.forEach((rect) => rect.setAttribute("height", pageBottom - (TOP - 42)));
        verticalRules.concat(monthRules).forEach((rule) => rule.setAttribute("y2", pageBottom));
        if (todayLine) {
          todayLine.setAttribute("y2", pageBottom);
          todayLabel.setAttribute("y", TOP - 50);
        }
        previousLanes.disabled = lanePage === 0;
        nextLanes.disabled = lanePage === pageCount - 1;
        laneStatus.textContent =
          "Workstreams " +
          (start + 1) +
          "–" +
          Math.min(start + 2, laneLayouts.length) +
          " of " +
          laneLayouts.length;
        updateLaneCues();
      };
      fullTimeline.addEventListener("click", function () {
        host.__kitRoadmapFullTimeline = !host.__kitRoadmapFullTimeline;
        updateLanePage(lanePage);
        window.dispatchEvent(new CustomEvent("kitcomponentchange", { detail: { host } }));
      });
      previousLanes.addEventListener("click", () => updateLanePage(lanePage - 1));
      nextLanes.addEventListener("click", () => updateLanePage(lanePage + 1));
      updateLanePage(lanePage);
    }
  } else {
    const cardLayout = krmRenderCardLayout(host, {
      layout,
      periods: parsedPeriods,
      lanes: visibleLanes,
      items: visibleItems,
      dependencies: visibleDependencies,
      allDependencies: dependencies,
      allItems,
    });
    focusPhase = cardLayout.focusPhase;
    laneEls = cardLayout.laneEls;
    itemEls = cardLayout.itemEls;
    dependencyEls = cardLayout.dependencyEls;
  }

  const legend = kitEl("div", "krm-legend");
  const legendRows = {};
  legend.setAttribute("role", "list");
  visibleItems.forEach(function (item) {
    const row = kitEl("div", "krm-legend-item");
    row.setAttribute("role", "listitem");
    row.dataset.item = item.id;
    legendRows[item.id] = row;
    row.append(kitEl("span", "krm-legend-num", String(allItems.indexOf(item) + 1)));
    const copy = kitEl("span", "krm-legend-copy");
    const title = kitEl("b");
    title.textContent = item.label;
    copy.append(title);
    if (item.note) {
      const note = kitEl("small");
      note.textContent = item.note;
      copy.append(note);
    }
    row.append(copy);
    legend.append(row);
  });
  const context = kitEl("details", "krm-context");
  context.append(kitEl("summary", "", "Item notes · " + visibleItems.length), legend);
  context.hidden = layout !== "timeline";
  host.append(context);

  // Measured at three widths, the per-item rail took 28-32% of the slide height
  // in Present, which pushed the fit scale to its floor and took the canvas type
  // down with it. A numbered row also repeats a label the span already carries.
  // The key explains the encoding instead, in only the states the data uses.
  const KEY_LABELS = { done: "Shipped", now: "In progress", planned: "Planned", risk: "At risk" };
  const key = kitEl("div", "krm-key");
  key.setAttribute("role", "list");
  Object.keys(KEY_LABELS)
    .filter((state) => visibleItems.some((item) => item.state === state))
    .forEach(function (state) {
      const row = kitEl("div", "krm-key-item krm-state-" + state);
      row.setAttribute("role", "listitem");
      row.append(kitEl("span", "krm-key-swatch"), kitEl("span", "krm-key-text", KEY_LABELS[state]));
      key.append(row);
    });
  summary.append(key);

  const states = [
    {
      title:
        layout === "phases"
          ? "Commitments by phase"
          : layout === "workstreams"
            ? "Ownership by horizon"
            : (data.overview || {}).title || "Read the roadmap →",
      note:
        layout === "timeline"
          ? (data.overview || {}).note ||
            "Workstreams share one time horizon; dashed work is planned."
          : {
              phases:
                "One phase at a time. See what starts and what continues; use the horizon above to explore.",
              workstreams: "Compare what each owner has in flight, next, and later.",
            }[layout],
    },
  ];
  walkthrough.forEach(function (step) {
    states.push({ title: step.title, note: step.note || "", step });
  });
  if (data.completion) {
    states.push({
      title: data.completion.title || "Complete",
      note: data.completion.note || "",
      completion: true,
    });
  }
  const walk = kitEl("div", "krm-walk");
  const dots = kitEl("div", "krm-dots");
  const annotation = kitEl("div", "krm-annotation");
  const annotationTitle = kitEl("strong");
  const annotationNote = kitEl("p");
  const activeAnnotation = kitEl("div", "krm-annotation-copy");
  activeAnnotation.append(annotationTitle, annotationNote);
  annotation.append(activeAnnotation);
  // Let CSS reserve the longest step at the current width, including after
  // resizing. Changing emphasis must not move the diagram or its controls.
  states.forEach(function (state) {
    const reserve = kitEl("div", "krm-annotation-copy krm-annotation-reserve");
    reserve.setAttribute("aria-hidden", "true");
    reserve.append(kitEl("strong", "", state.title), kitEl("p", "", state.note));
    annotation.append(reserve);
  });
  annotation.setAttribute("aria-live", "polite");
  walk.append(dots, annotation);
  const dotEls = states.map(function (state, index) {
    const dot = kitEl("button", "krm-dot");
    dot.type = "button";
    dot.setAttribute(
      "aria-label",
      index === 0 ? "Show roadmap overview" : "Show roadmap step " + index + ": " + state.title,
    );
    dot.addEventListener("click", () => go(index));
    dots.append(dot);
    return dot;
  });
  const controls = kitEl("div", "krm-controls");
  const next = kitEl("button", "", "Next story step →");
  const reset = kitEl("button", "", "Overview");
  next.addEventListener("click", () => go(current + 1));
  reset.addEventListener("click", () => go(0));
  controls.append(next, reset);
  walk.append(controls);
  host.append(walk);
  let current = 0;
  function go(index) {
    current = Math.max(0, Math.min(states.length - 1, index));
    if (itemMode === "key" && hasKeyItems && current !== contextIndex) {
      const focus = krmWalkFocus(next, reset, dotEls);
      const refreshed = renderRoadmap(host, { ...data, __walkContext: current });
      krmRestoreWalkFocus(host, focus);
      return refreshed;
    }
    const state = states[current];
    const step = state.step || null;
    host.dataset.activeStep = String(Boolean(step));
    const focusItems = new Set((step && step.items) || []);
    const focusLanes = new Set((step && step.lanes) || []);
    const focusDependencies = new Set(((step && step.dependencies) || []).map(String));
    ((step && step.dependencies) || []).forEach((dependencyIndex) => {
      focusItems.add(dependencies[dependencyIndex].from);
      focusItems.add(dependencies[dependencyIndex].to);
    });
    const hasFocus = Boolean(
      viewMode === "follow" &&
      step &&
      (focusItems.size || focusLanes.size || focusDependencies.size),
    );
    Object.keys(itemEls).forEach(function (id) {
      const item = itemById[id];
      const active = focusItems.has(id) || focusLanes.has(item.laneId);
      itemEls[id].classList.toggle("krm-dim", hasFocus && !active);
      itemEls[id].classList.toggle("krm-focus", hasFocus && active);
      const legendRow = legendRows[id];
      legendRow.classList.toggle("krm-dim", hasFocus && !active);
      legendRow.classList.toggle("krm-focus", hasFocus && active);
    });
    focusPhase(focusItems, focusLanes, hasFocus, current === 0);
    Object.keys(laneEls).forEach(function (id) {
      laneEls[id].forEach(function (el) {
        el.classList.toggle("krm-lane-focus", hasFocus && focusLanes.has(id));
      });
    });
    Object.keys(dependencyEls).forEach(function (id) {
      dependencyEls[id].classList.toggle("krm-dim", hasFocus && !focusDependencies.has(id));
      dependencyEls[id].classList.toggle("krm-focus", hasFocus && focusDependencies.has(id));
    });
    dotEls.forEach(function (dot, dotIndex) {
      dot.classList.toggle("current", dotIndex === current);
      dot.classList.toggle("done", dotIndex < current);
    });
    next.disabled = current >= states.length - 1;
    reset.disabled = current === 0;
    annotationTitle.textContent = state.title;
    annotationNote.textContent = state.note;
    host.classList.add("krm-live");
    if (updateLanePage) {
      const focusedPages = Object.values(itemEls)
        .filter((element) => element.classList.contains("krm-focus"))
        .map((element) => Number(element.closest(".krm-lane").dataset.lanePage));
      const page = host.__kitRoadmapLanePage || 0;
      updateLanePage(focusedPages.length ? focusedPages[0] : page);
    }
  }
  go(contextIndex);
  const driver = { count: states.length, current: () => current, go };
  // Present captures the first returned object. Keep that proxy stable while
  // Studio replaces the live DOM and its walkthrough closures in place.
  if (!host.__kitRoadmapHolder) {
    host.__kitRoadmapHolder = {
      count: driver.count,
      current() {
        return host.__kitRoadmapDriver ? host.__kitRoadmapDriver.current() : 0;
      },
      go(index) {
        if (host.__kitRoadmapDriver) {
          host.__kitRoadmapDriver.go(index);
        }
      },
    };
  }
  host.__kitRoadmapHolder.count = driver.count;
  host.__kitRoadmapDriver = driver;
  krmInstallRoadmapUpdates(host, updateLanePage, data);
  return host.__kitRoadmapHolder;
}
