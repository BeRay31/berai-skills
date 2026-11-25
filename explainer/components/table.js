/* Component: table — see references/CONTRACTS.md#table (v3 diet: the one
   tabular device). One API shape (groups of rows), five modes:
     rows         — the ledger baseline; a row may carry a `dots` cell, the
                    dotplot spectrum embedded as one line (label left,
                    spectrum right) instead of a plain sub line.
     before-after — the reinvented flip: one line per row, dim BEFORE text
                    that flips to lit AFTER text on reveal, leaving a struck
                    ghost of the claim it replaced.
     compare      — a butterfly map over shared concerns; a missing side
                    reads "— not covered" (honest absence, never invented).
     grid         — calmer tiles-DNA cards, auto-fill.
     chips        — chips-DNA soft pills, tone per chip.
     specs        — the chip-launch spec-comparison strip: subjects as
                    columns, one winner cell per row wears the accent.
   All text renders via textContent except title/sub, which allow a strict
   passive inline-formatting allowlist. Interactive markup is inert text. */
function ktAdjustedData(data, state) {
  const useKeys = state.items === "key";
  const keyOnly = state.detail === "key";
  function rows(values) {
    const source = values || [];
    const hasKeys = source.some(function (row) {
      return row.key === true;
    });
    const visible =
      useKeys && hasKeys
        ? source.filter(function (row) {
            return row.key === true;
          })
        : source;
    return visible.map(function (row) {
      if (!keyOnly || !row.sub) {
        return row;
      }
      const next = Object.assign({}, row);
      delete next.sub;
      return next;
    });
  }
  return {
    ...data,
    mode: state.mode || data.mode,
    layout: state.layout || data.layout,
    groups: (data.groups || []).map(function (group) {
      return Object.assign({}, group, { rows: rows(group.rows) });
    }),
    rows: rows(data.rows),
  };
}

function renderTable(sel, data) {
  const host = kitMount(sel);
  if (!data.__kitAdjusted) {
    const sourceRows = (data.groups || [])
      .flatMap(function (group) {
        return group.rows || [];
      })
      .concat(data.rows || []);
    const options = [];
    if (data.mode === "rows") {
      options.push({
        key: "mode",
        label: "Composition",
        type: "choice",
        choices: ["briefing", "rows"],
        choiceLabels: { briefing: "Briefing", rows: "Detailed ledger" },
      });
    } else if (["grid", "chips"].includes(data.mode)) {
      options.push({
        key: "mode",
        label: "Layout",
        type: "choice",
        choices: ["rows", "grid", "chips"],
        choiceLabels: { rows: "Rows", grid: "Grid", chips: "Chips" },
      });
    }
    if (data.mode === "before-after") {
      options.push({
        key: "layout",
        label: "Layout",
        type: "choice",
        choices: ["changes", "parallel"],
        choiceLabels: { changes: "Change rows", parallel: "Before and after" },
        choiceDescriptions: {
          changes: "Reveal each replacement as a compact change story.",
          parallel: "Compare old and new states in aligned columns.",
        },
      });
    } else if (data.mode === "compare") {
      options.push({
        key: "layout",
        label: "Layout",
        type: "choice",
        choices: ["sides", "criteria"],
        choiceLabels: { sides: "Side by side", criteria: "By criterion" },
        choiceDescriptions: {
          sides: "Compare both subjects across a shared concern index.",
          criteria: "Read one criterion and both subject answers together.",
        },
      });
    } else if (data.mode === "specs") {
      options.push({
        key: "layout",
        label: "Layout",
        type: "choice",
        choices: ["ledger", "sections"],
        choiceLabels: { ledger: "Specification ledger", sections: "Specification sections" },
        choiceDescriptions: {
          ledger: "Compare every subject in a compact shared matrix.",
          sections: "Read authored groups as sections with labeled values.",
        },
      });
    }
    if (
      sourceRows.some(function (row) {
        return row.key === true;
      })
    ) {
      options.push({
        key: "items",
        label: "Items",
        type: "choice",
        choices: ["key", "all"],
        choiceLabels: { key: "Key items", all: "All items" },
      });
    }
    if (
      data.mode !== "rows" &&
      sourceRows.some(function (row) {
        return Boolean(row.sub);
      })
    ) {
      options.push({
        key: "detail",
        label: "Text",
        type: "choice",
        choices: ["key", "more"],
        choiceLabels: { key: "Key only", more: "More detail" },
      });
    }
    if (data.mode === "before-after") {
      options.push({ key: "flipped", label: "Show end state", type: "toggle" });
    }
    if (options.length) {
      const adjustment = globalThis.ExplainerKit.registerAdjustments(host, {
        base: data,
        label: data.ariaLabel || `${data.mode} table`,
        defaults: {
          mode: data.mode,
          layout:
            data.layout ||
            (data.mode === "before-after"
              ? "changes"
              : data.mode === "compare"
                ? "sides"
                : data.mode === "specs"
                  ? "ledger"
                  : undefined),
          items: data.items || "all",
          detail: data.detail || "more",
          flipped: data.flipped === true,
        },
        options,
        apply(state) {
          const api = renderTable(host, {
            ...ktAdjustedData(host.__kitAdjustments.base, state),
            __kitAdjusted: true,
          });
          if (state.flipped && api.go) {
            api.go(api.count - 1);
          }
          return api;
        },
      });
      data = ktAdjustedData(adjustment.base, adjustment.state);
    }
  }
  const flippedOption =
    host.__kitAdjustments &&
    host.__kitAdjustments.entry.options.find((option) => option.key === "flipped");
  if (flippedOption) {
    flippedOption.hidden = data.layout === "parallel";
  }
  const mode = data.mode;
  kitValidateTextCaps(host, "renderTable", data);
  host.classList.add("kt");
  const MODES = ["briefing", "rows", "before-after", "compare", "grid", "chips", "specs"];
  if (!MODES.includes(mode)) {
    throw new Error(
      `renderTable: unknown mode "${mode}" — rows | before-after | compare | grid | chips | specs`,
    );
  }
  MODES.forEach((m) => {
    host.classList.remove("kt-" + m);
  });
  host.classList.add(`kt-${mode}`);
  host.dataset.layout =
    data.layout ||
    (mode === "before-after"
      ? "changes"
      : mode === "compare"
        ? "sides"
        : mode === "specs"
          ? "ledger"
          : mode);
  if (data.ariaLabel) {
    host.setAttribute("role", "group");
    host.setAttribute("aria-label", data.ariaLabel);
  }

  const TONES = new Set(["accent", "violet", "success", "warning", "error"]);
  const KINDS = new Set(["done", "progress", "next", "gap"]);
  function resolveTone(t) {
    return TONES.has(t) ? t : "neutral";
  }
  function resolveKind(kind) {
    return KINDS.has(kind) ? kind : "next";
  }
  function rowName(r) {
    return r.title == null ? r.label : r.title;
  }
  function stripTags(s) {
    return String(s == null ? "" : s).replaceAll(/<\/?(?:code|em|strong|b|i|br)>/gi, "");
  }
  // Sets both the solid tone color and its translucent glow companion, the
  // Same -dim token pairing every other component's tone system reads
  function setTone(el, tone) {
    el.style.setProperty("--kt-tone", `var(--${tone})`);
    el.style.setProperty("--kt-tone-dim", `var(--${tone}-dim)`);
  }

  // ── shared reveal driver for rows/grid/chips/compare/specs: read view
  // Renders fully lit with a one-time scroll-triggered stagger; Present
  // Reveals items 0..i-1 one keypress at a time (the kch-off/kch-pre
  // Pattern from chart.js, renamed to this component's kt- prefix).
  // `onReveal(el, k)` is optional and fires exactly once per item, only at
  // A genuine reveal moment (a Present go() step while presenting, or the
  // Read-view stagger) — never at the silent initial mount, exactly
  // Mirroring chart.js's reveal()/go()/play() split so a one-time flourish
  // (specs mode's winner-cell pop) never fires on page load. ──
  function present(items, onReveal) {
    const live = [];
    const briefing = ["parallel", "criteria", "sections"].includes(data.layout);
    function reveal(el, k) {
      if (live[k]) {
        return;
      }
      live[k] = true;
      if (onReveal) {
        onReveal(el, k);
      }
    }
    function go(i) {
      const presenting = document.body.classList.contains("presenting");
      items.forEach((el, k) => {
        var off = k >= i;
        el.classList.toggle("kt-off", off && !briefing);
        el.classList.toggle("kt-muted", off && briefing && i > 0);
        if (!off && presenting && !window.__kitMeasuring) {
          reveal(el, k);
        }
      });
    }
    go(items.length); // Read-view default: everything lit, no flourish
    let played = false;
    function play() {
      if (played || window.__kitMeasuring || REDUCED_MOTION) {
        return;
      }
      played = true;
      items.forEach((el) => {
        el.classList.add("kt-pre");
      });
      host.getBoundingClientRect();
      items.forEach((el, k) => {
        el.style.transitionDelay = k * 70 + "ms";
        el.classList.remove("kt-pre");
        setTimeout(
          function () {
            el.style.transitionDelay = "";
          },
          700 + k * 70,
        );
        reveal(el, k);
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
    return { count: items.length + 1, go, play };
  }

  function buildDotsCell(spec, tone) {
    if (!spec.ends || spec.ends.length < 2) {
      throw new Error(
        "renderTable: dots.ends is required — a [start, end] label pair (see references/CONTRACTS.md#table)",
      );
    }
    const cell = kitEl("span", "kt-dots-cell");
    const endL = document.createElement("span");
    endL.className = "kt-dot-end";
    endL.textContent = spec.ends[0];
    const track = kitEl("span", "kt-dot-track");
    track.append(kitEl("span", "kt-dot-tick"));
    const dot = kitEl("span", "kt-dot-marker");
    if (tone) {
      setTone(dot, tone);
    }
    const p = Math.max(0, Math.min(100, Number(spec.value) || 0));
    dot.style.left = `calc(${p}% + ${4.5 - p * 0.09}px)`;
    track.append(dot);
    const endR = document.createElement("span");
    endR.className = "kt-dot-end kt-dot-end-r";
    endR.textContent = spec.ends[1];
    cell.append(endL);
    cell.append(track);
    cell.append(endR);
    return cell;
  }

  function groupHeader(g, target) {
    if (!g.label) {
      return;
    }
    const header = kitEl("div", "kt-group");
    if (g.kind) {
      header.append(kitEl("i", resolveKind(g.kind)));
    }
    const label = kitEl("span");
    label.textContent =
      mode === "briefing"
        ? String(g.label).replace(/\s*·\s*\d+\s*$/, ` · ${(g.rows || []).length}`)
        : String(g.label);
    header.append(label);
    (target || host).append(header);
  }

  function buildRows() {
    if (data.legend) {
      const legend = kitEl("div", "kt-legend");
      data.legend.forEach((item) => {
        const entry = kitEl("span");
        const kind = resolveKind(item.kind);
        const toneVar = { done: "success", progress: "warning", next: "accent", gap: "error" }[
          kind
        ];
        const marker = kitEl("i", kind);
        marker.style.background = `var(--${toneVar})`;
        entry.append(marker);
        const label = kitEl("span");
        label.textContent = item.label == null ? "" : String(item.label);
        entry.append(label);
        legend.append(entry);
      });
      host.append(legend);
    }
    const items = [];
    let counter = 0;
    (data.groups || []).forEach((g) => {
      groupHeader(g);
      (g.rows || []).forEach(function (r) {
        counter++;
        var row = kitEl("div", "kt-row kt-item" + (r.dots ? " has-dots" : ""));
        if (r.tone && TONES.has(r.tone)) {
          row.classList.add("has-tone");
          setTone(row, r.tone);
        }
        if (r.num !== undefined) {
          var numEl = document.createElement("span");
          numEl.className = "kt-num";
          numEl.textContent = r.num;
          row.appendChild(numEl);
        } else if (data.numbered) {
          var numEl2 = document.createElement("span");
          numEl2.className = "kt-num";
          numEl2.textContent = String(counter).padStart(2, "0");
          row.appendChild(numEl2);
        }
        var titleEl = document.createElement("span");
        titleEl.className = "kt-title";
        kitSetPassiveInline(titleEl, rowName(r));
        var subEl = null;
        if (r.sub) {
          subEl = document.createElement("span");
          subEl.className = "kt-sub";
          kitSetPassiveInline(subEl, r.sub);
        }
        if (r.dots) {
          // A spectrum row stacks its words in a fixed-width column so every
          // track starts at the same x. Letting the title push the track along
          // put three rows holding the same value 105px apart, which is the one
          // thing a comparable spectrum must not do (2026-09-03).
          var labelEl = kitEl("span", "kt-label");
          labelEl.appendChild(titleEl);
          if (subEl) {
            labelEl.appendChild(subEl);
          }
          row.appendChild(labelEl);
          row.appendChild(buildDotsCell(r.dots, r.tone && TONES.has(r.tone) ? r.tone : null));
        } else {
          row.appendChild(titleEl);
          if (subEl) {
            row.appendChild(subEl);
          }
        }
        if (r.flag || r.ref) {
          var endEl = document.createElement("span");
          endEl.className = "kt-end";
          if (r.flag) {
            endEl.append(kitFlag(r.flag));
          }
          if (r.ref) {
            var refEl = document.createElement("span");
            refEl.className = "kt-ref";
            refEl.textContent = r.ref;
            endEl.appendChild(refEl);
          }
          row.appendChild(endEl);
        }
        host.appendChild(row);
        items.push(row);
      });
    });
    return present(items);
  }

  function buildBriefing() {
    const items = [];
    (data.groups || []).forEach(function (g) {
      groupHeader(g);
      const group = kitEl("div", "kt-briefing-group");
      (g.rows || []).forEach(function (r) {
        const row = kitEl("div", "kt-briefing-row kt-item");
        if (r.tone && TONES.has(r.tone)) {
          setTone(row, r.tone);
        }
        const title = kitEl("strong", "kt-briefing-title");
        title.textContent = stripTags(rowName(r));
        row.append(title);
        let measure = "";
        if (r.dots) {
          measure = `${Math.round(Number(r.dots.value) || 0)}%`;
        } else if (r.flag && r.flag.label) {
          measure = String(r.flag.label);
        } else if (r.sub) {
          measure = stripTags(r.sub);
        }
        const measureEl = kitEl("span", "kt-briefing-measure");
        measureEl.textContent = measure;
        row.append(measureEl);
        group.append(row);
        items.push(row);
      });
      host.append(group);
    });
    const dotRow = (data.groups || [])
      .flatMap((group) => group.rows || [])
      .find((row) => row.dots && row.dots.ends && row.dots.ends.length >= 2);
    if (dotRow) {
      host.append(
        kitEl(
          "p",
          "kt-briefing-scale",
          `Measurement scale · ${dotRow.dots.ends[0]} to ${dotRow.dots.ends[1]}`,
        ),
      );
    }
    return present(items);
  }

  function buildGrid() {
    const items = [];
    (data.groups || []).forEach((g) => {
      groupHeader(g);
      var grid = kitEl("div", "kt-cards");
      (g.rows || []).forEach(function (r) {
        var card = kitEl("div", "kt-card kt-item cat-" + resolveTone(r.tone));
        var nameEl = document.createElement("span");
        nameEl.className = "kt-card-title";
        kitSetPassiveInline(nameEl, rowName(r));
        card.appendChild(nameEl);
        if (r.sub) {
          var subEl = document.createElement("span");
          subEl.className = "kt-card-sub";
          kitSetPassiveInline(subEl, r.sub);
          card.appendChild(subEl);
        }
        grid.appendChild(card);
        items.push(card);
      });
      host.appendChild(grid);
    });
    return present(items);
  }

  function buildChips() {
    const items = [];
    (data.groups || []).forEach((g) => {
      groupHeader(g);
      var wrap = kitEl("div", "kt-chips-row");
      (g.rows || []).forEach(function (r) {
        var tone = resolveTone(r.tone);
        var chip = kitEl("span", "kt-chip kt-item " + tone);
        chip.appendChild(kitEl("i", "kt-chip-dot " + tone));
        var lbl = document.createElement("span");
        lbl.textContent = rowName(r) || "";
        chip.appendChild(lbl);
        wrap.appendChild(chip);
        items.push(chip);
      });
      host.appendChild(wrap);
    });
    return present(items);
  }

  function buildCompare() {
    if (host.dataset.layout === "criteria") {
      return buildCompareCriteria();
    }
    const wrap = kitEl("div", "kt-cmp");
    const head = kitEl("div", "kt-cmp-head");
    const lh = document.createElement("div");
    lh.className = "kt-cmp-h";
    lh.textContent = data.leftName || "";
    const mh = document.createElement("div");
    mh.className = "kt-cmp-mid";
    mh.textContent = data.mid || "";
    const rh = document.createElement("div");
    rh.className = "kt-cmp-h right";
    rh.textContent = data.rightName || "";
    head.append(lh);
    head.append(mh);
    head.append(rh);
    wrap.append(head);
    const items = [];
    (data.rows || []).forEach((r) => {
      var row = kitEl("div", "kt-cmp-row kt-item" + (r.subject ? " subject" : ""));
      var left = document.createElement("div");
      left.className = "kt-cmp-cell kt-cmp-left";
      if (r.left) {
        left.textContent = r.left;
      } else {
        left.classList.add("kt-cmp-empty");
        left.appendChild(kitEl("span", "kt-cmp-missing", "Not covered"));
      }
      var concern = document.createElement("div");
      concern.className = "kt-cmp-concern";
      var cSpan = document.createElement("span");
      cSpan.textContent = r.concern || "";
      concern.appendChild(cSpan);
      if (r.note) {
        var noteEl = document.createElement("span");
        noteEl.className = "kt-cmp-note";
        noteEl.textContent = r.note;
        concern.appendChild(noteEl);
      }
      var right = document.createElement("div");
      right.className = "kt-cmp-cell kt-cmp-right";
      if (r.right) {
        right.textContent = r.right;
      } else {
        right.classList.add("kt-cmp-empty");
        right.appendChild(kitEl("span", "kt-cmp-missing", "Not covered"));
      }
      row.appendChild(left);
      row.appendChild(concern);
      row.appendChild(right);
      wrap.appendChild(row);
      items.push(row);
    });
    host.append(wrap);
    return present(items);
  }

  function buildCompareCriteria() {
    const wrap = kitEl("div", "kt-cmp-criteria");
    const items = [];
    (data.rows || []).forEach(function (r) {
      const row = kitEl("div", "kt-cmp-criterion kt-item" + (r.subject ? " subject" : ""));
      const heading = kitEl("div", "kt-cmp-criterion-head");
      heading.append(kitEl("strong", "kt-cmp-criterion-title", r.concern || ""));
      if (r.note) {
        heading.append(kitEl("span", "kt-cmp-note", r.note));
      }
      row.append(heading);
      [
        [data.leftName, r.left],
        [data.rightName, r.right],
      ].forEach(function (entry) {
        const answer = kitEl("div", "kt-cmp-answer" + (entry[1] ? "" : " kt-cmp-empty"));
        answer.append(kitEl("span", "kt-cmp-answer-subject", entry[0] || ""));
        answer.append(
          kitEl(
            "span",
            entry[1] ? "kt-cmp-answer-value" : "kt-cmp-missing",
            entry[1] || "Not covered",
          ),
        );
        row.append(answer);
      });
      wrap.append(row);
      items.push(row);
    });
    host.append(wrap);
    return present(items);
  }

  function buildSpecs() {
    if (host.dataset.layout === "sections") {
      return buildSpecSections();
    }
    const subjects = data.subjects || [];
    const wrap = kitEl("div", "kt-specs");
    wrap.style.setProperty("--kt-specs-cols", subjects.length);
    const head = kitEl("div", "kt-specs-row kt-specs-head");
    head.append(kitEl("div", "kt-specs-label"));
    subjects.forEach((s) => {
      var sEl = document.createElement("div");
      sEl.className = "kt-specs-subject";
      sEl.textContent = s;
      head.appendChild(sEl);
    });
    wrap.append(head);
    const items = [];
    (data.groups || []).forEach((g) => {
      groupHeader(g, wrap); // group headers are plain block chrome, not grid items
      (g.rows || []).forEach(function (r) {
        var values = r.values || [];
        if (values.length !== subjects.length) {
          throw new Error(
            'renderTable(specs): row "' +
              (r.label || "") +
              '" has ' +
              values.length +
              " value(s) but there " +
              (subjects.length === 1 ? "is" : "are") +
              " " +
              subjects.length +
              " subject(s) — values.length must equal subjects.length",
          );
        }
        var row = kitEl("div", "kt-specs-row kt-item");
        var labelWrap = document.createElement("div");
        labelWrap.className = "kt-specs-label";
        var labelText = document.createElement("span");
        labelText.className = "kt-specs-label-text";
        kitSetPassiveInline(labelText, r.label);
        labelWrap.appendChild(labelText);
        if (r.sub) {
          var subEl = document.createElement("span");
          subEl.className = "kt-specs-sub";
          kitSetPassiveInline(subEl, r.sub);
          labelWrap.appendChild(subEl);
        }
        row.appendChild(labelWrap);
        values.forEach(function (v, i) {
          var isWinner = r.winner === i;
          var isDash = v == null || String(v).trim() === "" || String(v).trim() === "—";
          var cell = document.createElement("div");
          cell.className = "kt-specs-cell" + (isWinner ? " winner" : "") + (isDash ? " dim" : "");
          cell.textContent = isDash ? "—" : v;
          // winner alone wears the accent — chart's kch-tone-accent grammar,
          // ported to this component's --kt-tone/--kt-tone-dim pairing
          if (isWinner) {
            setTone(cell, "accent");
          }
          row.appendChild(cell);
        });
        wrap.appendChild(row);
        items.push(row);
      });
    });
    host.append(wrap);
    // One-time winner-cell pop on genuine reveal (Present step or the
    // Read-view stagger) — never on the silent initial mount
    return present(items, (el) => {
      if (REDUCED_MOTION) {
        return;
      }
      var wc = el.querySelector(".kt-specs-cell.winner");
      if (wc) {
        wc.classList.add("kt-pop");
      }
    });
  }

  function validateSpecValues(row, subjects) {
    const values = row.values || [];
    if (values.length !== subjects.length) {
      throw new Error(
        'renderTable(specs): row "' +
          (row.label || "") +
          '" has ' +
          values.length +
          " value(s) but there " +
          (subjects.length === 1 ? "is" : "are") +
          " " +
          subjects.length +
          " subject(s) — values.length must equal subjects.length",
      );
    }
    return values;
  }

  function buildSpecSections() {
    const subjects = data.subjects || [];
    const wrap = kitEl("div", "kt-spec-sections");
    const items = [];
    (data.groups || []).forEach(function (group) {
      const section = kitEl("div", "kt-spec-section");
      groupHeader(group, section);
      const records = kitEl("div", "kt-spec-records");
      (group.rows || []).forEach(function (r) {
        const values = validateSpecValues(r, subjects);
        const record = kitEl("article", "kt-spec-record kt-item");
        const heading = kitEl("div", "kt-spec-record-head");
        const label = kitEl("strong", "kt-specs-label-text");
        kitSetPassiveInline(label, r.label);
        heading.append(label);
        if (r.sub) {
          const sub = kitEl("span", "kt-specs-sub");
          kitSetPassiveInline(sub, r.sub);
          heading.append(sub);
        }
        record.append(heading);
        const valuesWrap = kitEl("div", "kt-spec-record-values");
        values.forEach(function (value, index) {
          const isWinner = r.winner === index;
          const isDash =
            value == null || String(value).trim() === "" || String(value).trim() === "—";
          const cell = kitEl(
            "div",
            "kt-spec-record-value" + (isWinner ? " winner" : "") + (isDash ? " dim" : ""),
          );
          cell.append(kitEl("span", "kt-spec-record-subject", subjects[index] || ""));
          cell.append(kitEl("span", "kt-spec-record-reading", isDash ? "—" : String(value)));
          if (isWinner) {
            setTone(cell, "accent");
          }
          valuesWrap.append(cell);
        });
        record.append(valuesWrap);
        records.append(record);
        items.push(record);
      });
      section.append(records);
      wrap.append(section);
    });
    host.append(wrap);
    return present(items);
  }

  function buildBeforeAfter() {
    if (host.dataset.layout === "parallel") {
      return buildBeforeAfterParallel();
    }
    const rows = [];
    (data.rows || []).forEach((r) => {
      var row = document.createElement("button");
      row.type = "button";
      row.className = "kt-ba-row kt-ba-item";
      row.setAttribute(
        "aria-label",
        stripTags(r.title) + ": before, " + stripTags(r.before) + "; after, " + stripTags(r.after),
      );
      row.appendChild(kitEl("span", "kt-ba-edge"));
      row.appendChild(kitEl("span", "kt-ba-dot"));
      var titleEl = document.createElement("span");
      titleEl.className = "kt-ba-title";
      kitSetPassiveInline(titleEl, r.title);
      row.appendChild(titleEl);
      row.appendChild(kitEl("span", "kt-ba-sep", "·"));
      var state = kitEl("span", "kt-ba-state");
      var beforeText = document.createElement("span");
      beforeText.className = "kt-ba-before-text";
      beforeText.textContent = r.before;
      var afterText = document.createElement("span");
      afterText.className = "kt-ba-after-text";
      afterText.textContent = r.after;
      state.appendChild(beforeText);
      state.appendChild(afterText);
      row.appendChild(state);
      if (r.flag) {
        row.append(kitFlag(r.flag));
      }
      var ghost = document.createElement("span");
      ghost.className = "kt-ba-ghost";
      ghost.textContent = r.before;
      row.appendChild(ghost);
      row.addEventListener("click", function () {
        if (document.body.classList.contains("presenting")) {
          return;
        }
        row.classList.toggle("kt-flip");
      });
      host.appendChild(row);
      rows.push(row);
    });
    function go(i) {
      rows.forEach((el, k) => {
        el.classList.toggle("kt-flip", k < i);
      });
    }
    go(0); // Arrival: all unflipped
    if (REDUCED_MOTION) {
      go(rows.length); // No wipes — land in the after state, instantly
    } else if (
      !document.body.classList.contains("presenting") &&
      "IntersectionObserver" in window
    ) {
      let played = false;
      const obs = new IntersectionObserver(
        function (es) {
          es.forEach(function (e) {
            // Present's enter() reparents the picked nodes into the slide
            // stage (adopt()) before it flips on document.body.presenting —
            // re-check here too, or a P keypress mid-scroll can steal this
            // read-view stagger and corrupt Present's "arrival = unflipped".
            if (e.isIntersecting && !played && !document.body.classList.contains("presenting")) {
              played = true;
              rows.forEach(function (el, k) {
                setTimeout(function () {
                  el.classList.add("kt-flip");
                }, k * 160);
              });
              obs.disconnect();
            }
          });
        },
        { threshold: 0.35 },
      );
      obs.observe(host);
    }
    return { count: rows.length + 1, go };
  }

  function buildBeforeAfterParallel() {
    const wrap = kitEl("div", "kt-ba-parallel");
    const head = kitEl("div", "kt-ba-parallel-head");
    head.append(kitEl("span", "", "Before"));
    head.append(kitEl("span", "", "After"));
    wrap.append(head);
    const items = [];
    (data.rows || []).forEach(function (r) {
      const row = kitEl("div", "kt-ba-pair kt-item");
      const title = kitEl("strong", "kt-ba-pair-title");
      kitSetPassiveInline(title, r.title);
      row.append(title);
      row.append(kitEl("span", "kt-ba-pair-before", r.before));
      row.append(kitEl("span", "kt-ba-pair-after", r.after));
      if (r.flag) {
        const flag = kitEl("span", "kt-ba-pair-flag");
        flag.append(kitFlag(r.flag));
        row.append(flag);
      }
      wrap.append(row);
      items.push(row);
    });
    host.append(wrap);
    return present(items);
  }

  let driver;
  if (mode === "briefing") {
    driver = buildBriefing();
  } else if (mode === "rows") {
    driver = buildRows();
  } else if (mode === "grid") {
    driver = buildGrid();
  } else if (mode === "chips") {
    driver = buildChips();
  } else if (mode === "compare") {
    driver = buildCompare();
  } else if (mode === "specs") {
    driver = buildSpecs();
  } else {
    driver = buildBeforeAfter();
  }

  // Present captures the object returned by the authored render. Studio
  // Re-renders this same host in place, so keep that captured object stable
  // And only replace the live delegate whose closures point at current DOM.
  if (!host.__kitTableHolder) {
    host.__kitTableHolder = {
      count: driver.count,
      go(i) {
        if (host.__kitTableDriver) {
          host.__kitTableDriver.go(i);
        }
      },
      play() {
        if (host.__kitTableDriver && host.__kitTableDriver.play) {
          host.__kitTableDriver.play();
        }
      },
    };
  }
  host.__kitTableHolder.count = driver.count;
  host.__kitTableDriver = driver;
  return host.__kitTableHolder;
}
