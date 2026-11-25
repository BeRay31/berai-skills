/* Component: iceberg — see references/CONTRACTS.md#iceberg.
   A panoramic iceberg and a readable cutaway share the same visible/hidden
   story. The crystal and ocean are self-contained; callouts, concerns,
   captions and concluding lines come from authored data. Narrow screens
   use the cutaway reading arrangement so labels remain legible. */
function renderIceberg(sel, data) {
  const host = kitMount(sel);
  if (!data.__kitAdjusted) {
    const adjustment = globalThis.ExplainerKit.registerAdjustments(host, {
      base: data,
      defaults: { layout: data.layout || "iceberg" },
      label: data.ariaLabel || data.stamp || "Iceberg diagram",
      options: [
        {
          key: "layout",
          label: "Layout",
          type: "choice",
          choices: ["iceberg", "briefing"],
          choiceLabels: { iceberg: "Iceberg", briefing: "Cutaway" },
          choiceDescriptions: {
            iceberg: "Memorable visible and hidden contrast",
            briefing: "Readable inventory across the waterline",
          },
        },
      ],
      apply(state) {
        return renderIceberg(host, {
          ...host.__kitAdjustments.base,
          layout: state.layout,
          __kitAdjusted: true,
        });
      },
    });
    data = { ...adjustment.base, layout: adjustment.state.layout, __kitAdjusted: true };
  }
  kitValidateTextCaps(host, "renderIceberg", data);
  host.classList.add("kib");
  host.dataset.layout = data.layout || "iceberg";
  host.dataset.zoom = "";
  if (host.dataset.layout !== "briefing") {
    host.removeAttribute("role");
    host.removeAttribute("aria-label");
  }

  // ── structural density limits — this is a punch, not a workhorse ──
  const CAP_ABOVE = 2,
    CAP_LINES = 2;
  const CAP_ROWS = 4,
    CAP_CELLS = 2;

  const above = data.above || [];
  if (above.length > CAP_ABOVE) {
    throw new Error(
      `renderIceberg: above supports at most ${CAP_ABOVE} callouts, got ${above.length}`,
    );
  }
  above.forEach((a) => {
    var lines = a.lines || [];
    if (lines.length > CAP_LINES) {
      throw new Error(
        "renderIceberg: above callout supports at most " +
          CAP_LINES +
          " lines, got " +
          lines.length +
          ' for "' +
          a.title +
          '"',
      );
    }
  });

  const rows = data.below || [];
  if (rows.length > CAP_ROWS) {
    throw new Error(`renderIceberg: below supports at most ${CAP_ROWS} rows, got ${rows.length}`);
  }
  rows.forEach((row) => {
    var cols = Array.isArray(row) ? row : [row];
    if (cols.length > CAP_CELLS) {
      throw new Error(
        "renderIceberg: below row supports at most " + CAP_CELLS + " cells, got " + cols.length,
      );
    }
  });

  if (data.layout === "briefing") {
    // The briefing is the whole graphic, so the host carries the label. The
    // iceberg path labels its own <svg> and keeps the cutaway readable.
    host.setAttribute("role", "img");
    host.setAttribute(
      "aria-label",
      data.ariaLabel ||
        data.stamp ||
        "Iceberg diagram: a small visible part above the waterline and more work below",
    );
    kibRenderBriefing(host, data, above, rows);
    const driver = { count: 1, current: () => 0, go() {} };
    const stable = globalThis.ExplainerKit.stableDriver(host, driver);
    globalThis.ExplainerKit.observeContentSpacing(host, () =>
      renderIceberg(host, { ...data, __kitAdjusted: true }),
    );
    return stable;
  }

  const ns = "http://www.w3.org/2000/svg";
  const contentSpacing = globalThis.ExplainerKit.contentSpacing();
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 1400 680");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    data.ariaLabel ||
      data.stamp ||
      "Iceberg diagram: a small visible tip above the waterline over a larger hidden mass below",
  );

  // Give the illustration its own central stage; the reading columns sit
  // beside the submerged mass instead of obscuring it with a text panel.
  const berg = document.createElementNS(ns, "g");
  berg.setAttribute("class", "kib-berg");
  berg.setAttribute("transform", "translate(700 218) scale(1.1) translate(-500 -218)");
  berg.innerHTML = KIB_CHROME;
  svg.append(berg);

  function add(tag, attrs, text) {
    const e = document.createElementNS(ns, tag);
    Object.keys(attrs || {}).forEach((k) => {
      e.setAttribute(k, attrs[k]);
    });
    if (text != null) {
      e.textContent = text;
    }
    svg.append(e);
    return e;
  }

  const ocean = add("rect", { x: 0, y: 218, width: 1400, height: 462, fill: "url(#kibOcean)" });
  svg.insertBefore(ocean, berg);
  add("line", { class: "kib-leader", x1: 0, y1: 218, x2: 1400, y2: 218 });

  // Top stamp — what mapped / owns the visible part. Sits above the
  // Waterline on the page background, so its fill is theme-aware (set in
  // Iceberg.css); the inline fill only carries the dark-mode default.
  if (data.stamp) {
    // Right-aligned so the enlarged crystal's apex never collides with it
    add(
      "text",
      { class: "kib-stamp", opacity: 0.9, "text-anchor": "end", x: 1352, y: 22 },
      data.stamp,
    );
  }
  // Waterline captions — held clearly apart, above vs below. The above
  // Caption sits on the page background (theme-aware); the below caption
  // Sits on the dark ocean (fixed light). Distinct classes let CSS target
  // Each without fighting the inline fill.
  add(
    "text",
    { class: "kib-waterlbl kib-waterlbl-up", opacity: 0.85, x: 48, y: 200 },
    data.aboveLabel || "VISIBLE",
  );
  add(
    "text",
    { class: "kib-waterlbl kib-waterlbl-down", fill: "#5a8fc0", opacity: 0.85, x: 48, y: 260 },
    data.belowLabel || "INVISIBLE",
  );

  // Flanking callouts on the exposed tip (leader-lined) — the crystal stays
  // The star; these only frame it, one per side, max two total
  const ANCHOR = {
    left: { lx1: 620, ly1: 140, lx2: 424, ly2: 106, tx: 48, ty: 100, anchor: "start" },
    right: { lx1: 780, ly1: 140, lx2: 976, ly2: 106, tx: 998, ty: 100, anchor: "start" },
  };
  above.forEach((a, idx) => {
    // Distribute unspecified or unknown sides by index (even → left, odd →
    // right) so multiple callouts don't collide on one anchor; an explicit
    // 'left'/'right' always wins.
    var side = a.side === "left" || a.side === "right" ? a.side : idx % 2 === 0 ? "left" : "right";
    var g = ANCHOR[side];
    add("line", { class: "kib-leader", x1: g.lx1, y1: g.ly1, x2: g.lx2, y2: g.ly2 });
    add("circle", { cx: g.lx2, cy: g.ly2, r: 2.5, fill: "#4a90d8" });
    // callouts float above the waterline on the page background, so their
    // fills are theme-aware (set in iceberg.css); the inline fill only
    // carries the dark-mode default.
    add("text", { class: "kib-above-title", x: g.tx, y: g.ty, "text-anchor": g.anchor }, a.title);
    (a.lines || []).forEach(function (ln, k) {
      add(
        "text",
        { class: "kib-above-line", x: g.tx, y: g.ty + 28 + k * 23, "text-anchor": g.anchor },
        ln,
      );
    });
  });

  // Consistent outer columns leave the iceberg silhouette unobstructed.
  const startY = 292 + 30 * contentSpacing;
  const step = 62 * contentSpacing;
  const lastY = startY + Math.max(0, rows.length - 1) * step;
  const punchY = Math.max(566, lastY + 54);
  rows.forEach((row, i) => {
    const cells = Array.isArray(row) ? row : [row];
    cells.forEach((cell, column) => {
      const left = column === 0;
      const centered = cells.length === 1;
      const x = centered ? 700 : left ? 48 : 998;
      const y = startY + i * step;
      if (!centered) {
        add("line", {
          class: "kib-leader",
          x1: left ? 424 : 940,
          x2: left ? 460 : 976,
          y1: y - 7,
          y2: y - 7,
        });
      }
      add(
        "text",
        {
          class: "kib-below",
          x,
          y,
          "text-anchor": centered ? "middle" : "start",
        },
        cell,
      );
    });
  });
  // The punch line — the one everyone feels but nobody can answer
  if (data.punch) {
    add(
      "text",
      {
        class: "kib-below kib-punch",
        fill: "#eaf6ff",
        opacity: 1,
        "text-anchor": "middle",
        x: 700,
        y: punchY,
      },
      data.punch,
    );
  }
  // Unknown unknowns
  if (data.bottom) {
    add(
      "text",
      {
        class: "kib-unknown",
        fill: "#1e4060",
        opacity: 0.7,
        "text-anchor": "middle",
        x: 700,
        y: 650,
      },
      data.bottom,
    );
  }
  host.append(svg);
  // On narrow screens the surrounding labels become a readable cutaway;
  // retain the full panoramic composition wherever there is room for it.
  kibRenderBriefing(host, data, above, rows);
  host.lastElementChild.classList.add("kib-mobile-reading");
  const driver = { count: 1, current: () => 0, go() {} };
  const stable = globalThis.ExplainerKit.stableDriver(host, driver);
  globalThis.ExplainerKit.observeContentSpacing(host, () =>
    renderIceberg(host, { ...data, __kitAdjusted: true }),
  );
  return stable;
}

function kibRenderBriefing(host, data, above, rows) {
  function textElement(tag, className, value) {
    const element = kitEl(tag, className);
    element.textContent = String(value == null ? "" : value);
    return element;
  }

  const frame = kitEl("div", "kib-cutaway");
  const art = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  art.setAttribute("class", "kib-cutaway-art");
  art.setAttribute("viewBox", "0 0 300 620");
  art.setAttribute("preserveAspectRatio", "none");
  art.setAttribute("aria-hidden", "true");
  art.innerHTML =
    '<defs><linearGradient id="kibCutTip" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0%" stop-color="#eef7ff"/><stop offset="100%" stop-color="#78aeca"/>' +
    '</linearGradient><linearGradient id="kibCutBody" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0%" stop-color="#1c4a72"/><stop offset="100%" stop-color="#040e1c"/>' +
    "</linearGradient></defs>" +
    '<rect class="kib-cutaway-ocean" x="0" y="218" width="300" height="402"/>' +
    '<polygon points="150,38 64,218 150,180" fill="url(#kibCutTip)"/>' +
    '<polygon points="150,38 236,218 150,180" fill="url(#kibCutTip)" opacity=".76"/>' +
    '<polygon points="64,218 236,218 260,516 150,604 38,516" fill="url(#kibCutBody)"/>' +
    '<path d="M64 218L150 604 236 218M38 516L150 410 260 516" class="kib-cutaway-facet"/>';
  frame.append(art);
  // On narrow screens each half follows its own text height. The waterline
  // stays between the two zones instead of clipping a wrapped callout.
  ["0 0 300 218", "0 218 300 402"].forEach(function (viewBox, index) {
    const half = art.cloneNode(true);
    half.setAttribute("class", "kib-cutaway-mobile-art " + (index ? "below" : "above"));
    half.setAttribute("viewBox", viewBox);
    half.innerHTML = half.innerHTML
      .replaceAll("kibCutTip", "kibCutTipMobile" + index)
      .replaceAll("kibCutBody", "kibCutBodyMobile" + index);
    frame.append(half);
  });

  const notes = kitEl("div", "kib-cutaway-notes");
  const visible = kitEl("div", "kib-cutaway-zone kib-cutaway-visible");
  const visibleHead = kitEl("div", "kib-brief-head");
  visibleHead.append(
    textElement("span", "kib-brief-zone-label", data.aboveLabel || "VISIBLE"),
    textElement("span", "kib-brief-stamp", data.stamp || ""),
  );
  visible.append(visibleHead);

  const aboveGrid = kitEl("div", "kib-cutaway-above");
  above.forEach(function (item, index) {
    const card = kitEl("div", "kib-cutaway-callout");
    card.dataset.side = item.side === "right" ? "right" : index % 2 ? "right" : "left";
    card.append(textElement("strong", null, item.title));
    const lines = item.lines || [];
    if (lines.length) {
      const details = kitEl("div", "kib-brief-lines");
      lines.forEach((line) => details.append(textElement("span", null, line)));
      card.append(details);
    }
    aboveGrid.append(card);
  });
  visible.append(aboveGrid);

  const waterline = kitEl("div", "kib-cutaway-waterline");
  waterline.setAttribute("aria-hidden", "true");
  const hidden = kitEl("div", "kib-cutaway-zone kib-cutaway-hidden");
  hidden.append(textElement("span", "kib-brief-zone-label", data.belowLabel || "INVISIBLE"));
  const belowList = kitEl("div", "kib-cutaway-below");
  rows.forEach(function (row) {
    const rowElement = kitEl("div", "kib-cutaway-row");
    const cells = kitEl("div", "kib-cutaway-cells");
    (Array.isArray(row) ? row : [row]).forEach((cell) =>
      cells.append(textElement("span", null, cell)),
    );
    rowElement.append(cells);
    belowList.append(rowElement);
  });
  hidden.append(belowList);
  if (data.punch) {
    hidden.append(textElement("strong", "kib-brief-punch", data.punch));
  }
  if (data.bottom) {
    hidden.append(textElement("span", "kib-brief-bottom", data.bottom));
  }
  notes.append(visible, waterline, hidden);
  frame.append(notes);
  host.append(frame);
}

/* Fixed crystal chrome: ocean, faceted tip, shimmering waterline, submerged
   body. Kept verbatim as the illustration's identity — only the text is
   data-driven above, and only its wrapping <g> (kib-berg) scales it up. */
const KIB_CHROME =
  "" +
  "<defs>" +
  '<linearGradient id="kibOcean" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#071525"/><stop offset="100%" stop-color="#030a12"/></linearGradient>' +
  '<linearGradient id="kibFaceL" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#eef7ff"/><stop offset="60%" stop-color="#b8d8f0"/><stop offset="100%" stop-color="#8cbcd8"/></linearGradient>' +
  '<linearGradient id="kibFaceR" x1="1" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#cce6f8"/><stop offset="100%" stop-color="#6a9ec0"/></linearGradient>' +
  '<linearGradient id="kibFaceMid" x1="0" y1="1" x2="1" y2="0"><stop offset="0%" stop-color="#a0cce8"/><stop offset="100%" stop-color="#d8eefb"/></linearGradient>' +
  '<linearGradient id="kibSubL" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#1c4a72" stop-opacity="0.9"/><stop offset="100%" stop-color="#0a2340" stop-opacity="0.95"/></linearGradient>' +
  '<linearGradient id="kibSubR" x1="1" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#0e3256" stop-opacity="0.9"/><stop offset="100%" stop-color="#061828" stop-opacity="0.95"/></linearGradient>' +
  '<linearGradient id="kibSubFront" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#1a3e62" stop-opacity="0.85"/><stop offset="100%" stop-color="#08192e" stop-opacity="0.9"/></linearGradient>' +
  '<linearGradient id="kibShimmer" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#0a3060" stop-opacity="0"/><stop offset="25%" stop-color="#2a70c0" stop-opacity="0.5"/><stop offset="50%" stop-color="#4a90d8" stop-opacity="0.7"/><stop offset="75%" stop-color="#2a70c0" stop-opacity="0.5"/><stop offset="100%" stop-color="#0a3060" stop-opacity="0"/></linearGradient>' +
  '<linearGradient id="kibFadeDown" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#071525" stop-opacity="0"/><stop offset="60%" stop-color="#071525" stop-opacity="0.7"/><stop offset="100%" stop-color="#071525" stop-opacity="1"/></linearGradient>' +
  '<linearGradient id="kibReflect" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#b8d8f0" stop-opacity="0.18"/><stop offset="100%" stop-color="#b8d8f0" stop-opacity="0"/></linearGradient>' +
  '<filter id="kibGlow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
  '<filter id="kibEdge" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
  "</defs>" +
  '<polygon points="500,40 360,218 500,180" fill="url(#kibFaceL)" opacity="0.95"/>' +
  '<polygon points="500,40 640,218 500,180" fill="url(#kibFaceR)" opacity="0.88"/>' +
  '<polygon points="360,218 500,180 640,218" fill="url(#kibFaceMid)" opacity="0.7"/>' +
  '<polygon points="500,40 465,148 500,180" fill="#eef7ff" opacity="0.35"/>' +
  '<line x1="500" y1="40" x2="430" y2="175" stroke="#ffffff" stroke-width="0.6" opacity="0.25"/>' +
  '<line x1="500" y1="40" x2="552" y2="160" stroke="#c8e8f8" stroke-width="0.5" opacity="0.2"/>' +
  '<circle cx="500" cy="40" r="6" fill="#eef7ff" opacity="0.4" filter="url(#kibGlow)"/>' +
  '<line x1="500" y1="40" x2="360" y2="218" stroke="#ffffff" stroke-width="1.2" opacity="0.5" filter="url(#kibEdge)"/>' +
  '<line x1="500" y1="40" x2="640" y2="218" stroke="#c0dff0" stroke-width="0.8" opacity="0.3"/>' +
  '<rect x="0" y="216" width="1000" height="5" fill="url(#kibShimmer)"/>' +
  '<line x1="0" y1="218" x2="1000" y2="218" stroke="#3a80c0" stroke-width="0.6" opacity="0.4"/>' +
  '<polygon points="360,218 500,256 640,218" fill="url(#kibReflect)" opacity="0.5"/>' +
  '<polygon points="360,218 500,218 440,420 260,490" fill="url(#kibSubL)" opacity="0.92"/>' +
  '<polygon points="500,218 640,218 740,490 560,420" fill="url(#kibSubR)" opacity="0.88"/>' +
  '<polygon points="360,218 640,218 560,420 440,420" fill="url(#kibSubFront)" opacity="0.75"/>' +
  '<polygon points="260,490 440,420 380,590 230,560" fill="#061020" opacity="0.9"/>' +
  '<polygon points="560,420 740,490 770,560 620,590" fill="#040e1c" opacity="0.9"/>' +
  '<polygon points="380,590 440,420 560,420 620,590 500,625" fill="#030c18" opacity="0.95"/>' +
  '<line x1="440" y1="420" x2="360" y2="218" stroke="#2a6aaa" stroke-width="0.6" opacity="0.25"/>' +
  '<line x1="560" y1="420" x2="640" y2="218" stroke="#1a4a7a" stroke-width="0.6" opacity="0.2"/>' +
  '<line x1="440" y1="420" x2="560" y2="420" stroke="#2a5a8a" stroke-width="0.5" opacity="0.3"/>' +
  '<line x1="440" y1="420" x2="500" y2="218" stroke="#2a6aaa" stroke-width="0.4" opacity="0.15"/>' +
  '<line x1="560" y1="420" x2="500" y2="218" stroke="#2a6aaa" stroke-width="0.4" opacity="0.15"/>' +
  '<line x1="360" y1="218" x2="260" y2="490" stroke="#3a7ab8" stroke-width="0.8" opacity="0.2"/>' +
  '<line x1="640" y1="218" x2="740" y2="490" stroke="#1a4a7a" stroke-width="0.6" opacity="0.15"/>' +
  '<polygon points="420,280 500,260 530,340 450,350" fill="#2a6aaa" opacity="0.08"/>' +
  '<polygon points="470,360 540,350 520,420 460,415" fill="#1a5a9a" opacity="0.06"/>' +
  '<circle cx="360" cy="218" r="2" fill="#4a90d0" opacity="0.5"/>' +
  '<circle cx="500" cy="218" r="2.5" fill="#4a90d0" opacity="0.6"/>' +
  '<circle cx="640" cy="218" r="2" fill="#4a90d0" opacity="0.5"/>';
