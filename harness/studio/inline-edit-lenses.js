/* The deterministic DOM → data-path map behind Studio's inline content
   editing. A lens turns one live component host plus its authored component
   into a list of editable text targets:

     { el, host, kind, field, path, cap }

   - `path` is a setAt-style array, identical in semantics to the structured
     component editor, so an inline commit and a panel edit write the same
     field the same way.
   - `cap` carries the max length from components/text-caps.json for the
     fields that have a rule there; null means no cap.
   - Every target is single-line: the renderers print these fields through
     textContent into normal white-space, so a line break would collapse on
     re-render. Paragraph editing stays in the structured panel. That holds
     for the long fields too — no kit stylesheet sets white-space:pre-line,
     and the one pre element (code's .kcd-source) renders a single line.
   - A target may be an SVG <text>. Those cannot host contenteditable, so the
     engine edits them through one shared floating input; a lens does not
     need to say so, and never carries per-kind interaction knowledge.

   Anchoring rules, per kind:
   - flow (renderFlow): anchor=index. Station cards render in items[] order in
     both the across rail and the down briefing; subs resolve to the authored
     shape (sub vs subs[]). The derived .kf-down-status line is never a
     target. Timeline axis labels (SVG <text>) cannot host contenteditable,
     so they stay panel-editable.
   - architecture (renderDataFlow): anchor=id through data-node/data-group/
     data-edge attributes. .kdf-reference-note duplicates are never matched.
   - table (renderTable): anchor=index per rendered mode (rows, before-after,
     grid, chips, specs ledger). Before-after ghost copies are never matched.
   - Each further kind carries its own rule in the comment above its lens:
     sequence, erd, roadmap and the operating model anchor by the ids their
     renderers already require; stack, chart, trace, loop, stepper, code,
     iceberg, pyramid and tree anchor by the index their renderer prints in.

   The lens reads the authored component Studio resolved (authoring session
   record or renderer capture) — never host.__kitBase, which is an adjustment
   side effect rather than a published contract. */
(function installExplainerInlineEditLenses(root) {
  "use strict";

  function setAt(object, path, value) {
    if (!path || !path.length) {
      return;
    }
    let holder = object;
    path.slice(0, -1).forEach(function (key) {
      if (
        !holder ||
        typeof holder !== "object" ||
        !holder[key] ||
        typeof holder[key] !== "object"
      ) {
        throw new TypeError("That component field is no longer editable.");
      }
      holder = holder[key];
    });
    holder[path.at(-1)] = value;
  }

  function valueAt(data, path) {
    let current = data;
    for (const key of path || []) {
      if (current == null || typeof current !== "object") {
        return;
      }
      current = current[key];
    }
    return current;
  }

  function fieldLabel(path) {
    return path
      .map(function (part, index) {
        if (typeof part === "number") {
          return "[" + part + "]";
        }
        return index === 0 ? String(part) : "." + part;
      })
      .join("");
  }

  function target(host, kind, el, path, cap) {
    return {
      el,
      host,
      kind,
      field: fieldLabel(path),
      path,
      cap: cap || null,
    };
  }

  function attrValue(value) {
    return String(value).replaceAll(/["\\]/g, String.raw`\$&`);
  }

  function directChildren(el, tagName) {
    return Array.from(el.children).filter(function (child) {
      return child.tagName === tagName;
    });
  }

  /* Every lens outside flow/architecture/table pushes through this helper:
     it drops a missing element and any non-string value, so numeric cells
     (chart values, stat numbers) and derived copy never become targets. */
  function pusher(targets, host, kind, data) {
    return function push(el, path, cap) {
      if (!el || typeof valueAt(data, path) !== "string") {
        return;
      }
      targets.push(target(host, kind, el, path, cap));
    };
  }

  function byIndex(host, selector) {
    return Array.from(host.querySelectorAll(selector));
  }

  function firstOf(scope, selectors) {
    for (const selector of selectors) {
      const found = scope.querySelector(selector);
      if (found) {
        return found;
      }
    }
    return null;
  }

  /* ── flow ─────────────────────────────────────────────────────────── */
  function flowTargets(host, data) {
    const items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) {
      return [];
    }
    const targets = [];
    const down = host.classList.contains("kf-down");
    const cards = down
      ? Array.from(host.querySelectorAll(".kf-down-row > .kf-down-card"))
      : Array.from(host.querySelectorAll(".kf-canvas > .kf-station"));

    cards.forEach(function (card, i) {
      const item = items[i];
      if (!card || !item) {
        return;
      }
      const spans = directChildren(card, "SPAN");
      let spanAt = 0;
      if (down && item.at && spans[spanAt]) {
        targets.push(target(host, "flow", spans[spanAt], ["items", i, "at"], null));
        spanAt += 1;
      }
      if (item.when != null && spans[spanAt]) {
        targets.push(target(host, "flow", spans[spanAt], ["items", i, "when"], 22));
      }
      const strong = directChildren(card, "STRONG")[0];
      if (strong && item.label != null) {
        targets.push(target(host, "flow", strong, ["items", i, "label"], 24));
      }
      const smalls = Array.from(card.querySelectorAll(":scope > small")).filter(function (small) {
        return !small.classList.contains("kf-down-status");
      });
      const hasSubs = Array.isArray(item.subs);
      const subCount = hasSubs ? item.subs.length : item.sub != null ? 1 : 0;
      smalls.forEach(function (small, j) {
        if (j >= subCount) {
          return;
        }
        const path = hasSubs ? ["items", i, "subs", j] : ["items", i, "sub"];
        targets.push(target(host, "flow", small, path, 30));
      });
      if (item.type === "gate" && Array.isArray(item.outcomes)) {
        const pills = down
          ? Array.from(card.querySelectorAll(".kf-down-outcomes > span"))
          : (function () {
              const zone = card.nextElementSibling;
              return zone && zone.classList.contains("kf-forks")
                ? Array.from(zone.querySelectorAll(":scope > .kf-fork-pill"))
                : [];
            })();
        item.outcomes.forEach(function (outcome, j) {
          if (pills[j] && outcome && outcome.text != null) {
            targets.push(target(host, "flow", pills[j], ["items", i, "outcomes", j, "text"], 24));
          }
        });
      }
    });

    const caption = host.querySelector(":scope > figcaption");
    if (caption && data.caption != null) {
      targets.push(target(host, "flow", caption, ["caption"], null));
    }
    return targets;
  }

  /* ── architecture (renderDataFlow) ────────────────────────────────── */
  function architectureTargets(host, data) {
    const targets = [];
    (data.nodes || []).forEach(function (node, i) {
      if (!node || !node.id) {
        return;
      }
      const el = host.querySelector('.kdf-node[data-node="' + attrValue(node.id) + '"]');
      if (!el || el.closest(".kdf-reference-note")) {
        return;
      }
      const eyebrow = Array.from(el.children).find(function (child) {
        return (
          child.tagName === "SPAN" &&
          !child.classList.contains("kdf-membership") &&
          !child.classList.contains("st-node-resize")
        );
      });
      const title = directChildren(el, "STRONG")[0];
      const sub = directChildren(el, "SMALL")[0];
      if (eyebrow && node.eyebrow != null) {
        targets.push(target(host, "architecture", eyebrow, ["nodes", i, "eyebrow"], 20));
      }
      if (title && node.title != null) {
        targets.push(target(host, "architecture", title, ["nodes", i, "title"], 30));
      }
      if (sub && node.sub != null) {
        targets.push(target(host, "architecture", sub, ["nodes", i, "sub"], 30));
      }
    });
    (data.groups || []).forEach(function (group, i) {
      if (!group || !group.id) {
        return;
      }
      const el = host.querySelector('.kdf-group[data-group="' + attrValue(group.id) + '"]');
      if (!el || el.closest(".kdf-reference-note")) {
        return;
      }
      const label = el.querySelector(":scope > span");
      const sub = el.querySelector(":scope > small");
      if (label && group.label != null) {
        targets.push(target(host, "architecture", label, ["groups", i, "label"], null));
      }
      if (sub && group.sub != null) {
        targets.push(target(host, "architecture", sub, ["groups", i, "sub"], null));
      }
    });
    (data.edges || []).forEach(function (edge, i) {
      if (!edge || edge.label == null) {
        return;
      }
      const id = edge.id != null ? String(edge.id) : String(i);
      const el = host.querySelector(
        '.kdf-legend-item[data-edge="' + attrValue(id) + '"] .kdf-legend-text',
      );
      if (el && !el.closest(".kdf-reference-note")) {
        targets.push(target(host, "architecture", el, ["edges", i, "label"], null));
      }
    });
    return targets;
  }

  /* ── table ───────────────────────────────────────────────────────── */
  function flatGroupRows(data) {
    const flat = [];
    (data.groups || []).forEach(function (group, gi) {
      (group && group.rows ? group.rows : []).forEach(function (row, ri) {
        flat.push({ row, path: ["groups", gi, "rows", ri] });
      });
    });
    return flat;
  }

  function tableTargets(host, data) {
    const targets = [];
    if (host.classList.contains("kt-rows")) {
      const rows = Array.from(host.querySelectorAll(".kt-row.kt-item"));
      flatGroupRows(data).forEach(function (record, i) {
        const el = rows[i];
        if (!el || !record.row) {
          return;
        }
        const titlePath = record.row.title == null ? "label" : "title";
        const title = el.querySelector(".kt-title");
        const sub = el.querySelector(".kt-sub");
        if (title && record.row[titlePath] != null) {
          targets.push(target(host, "table", title, record.path.concat(titlePath), null));
        }
        if (sub && record.row.sub != null) {
          targets.push(target(host, "table", sub, record.path.concat("sub"), null));
        }
      });
    }
    if (host.classList.contains("kt-grid")) {
      const cards = Array.from(host.querySelectorAll(".kt-card"));
      flatGroupRows(data).forEach(function (record, i) {
        const el = cards[i];
        if (!el || !record.row) {
          return;
        }
        const titlePath = record.row.title == null ? "label" : "title";
        const title = el.querySelector(".kt-card-title");
        const sub = el.querySelector(".kt-card-sub");
        if (title && record.row[titlePath] != null) {
          targets.push(target(host, "table", title, record.path.concat(titlePath), null));
        }
        if (sub && record.row.sub != null) {
          targets.push(target(host, "table", sub, record.path.concat("sub"), null));
        }
      });
    }
    if (host.classList.contains("kt-chips")) {
      const chips = Array.from(host.querySelectorAll(".kt-chip"));
      flatGroupRows(data).forEach(function (record, i) {
        const chip = chips[i];
        const label = chip && chip.querySelector("span:not(.kt-chip-dot)");
        const titlePath = record.row && record.row.title == null ? "label" : "title";
        if (chip && label && record.row && record.row[titlePath] != null) {
          targets.push(target(host, "table", label, record.path.concat(titlePath), null));
        }
      });
    }
    if (host.classList.contains("kt-specs") && host.dataset.layout === "ledger") {
      const rows = Array.from(host.querySelectorAll(".kt-specs-row.kt-item"));
      flatGroupRows(data).forEach(function (record, i) {
        const el = rows[i];
        if (!el || !record.row) {
          return;
        }
        const labelText = el.querySelector(".kt-specs-label-text");
        const sub = el.querySelector(".kt-specs-sub");
        if (labelText && record.row.label != null) {
          targets.push(target(host, "table", labelText, record.path.concat("label"), null));
        }
        if (sub && record.row.sub != null) {
          targets.push(target(host, "table", sub, record.path.concat("sub"), null));
        }
        const values = Array.isArray(record.row.values) ? record.row.values : [];
        const cells = Array.from(el.querySelectorAll(":scope > .kt-specs-cell"));
        values.forEach(function (value, vi) {
          if (cells[vi] && value != null) {
            targets.push(target(host, "table", cells[vi], record.path.concat("values", vi), null));
          }
        });
      });
    }
    if (host.classList.contains("kt-before-after")) {
      const rows = Array.from(host.querySelectorAll(".kt-ba-item"));
      (data.rows || []).forEach(function (row, i) {
        const el = rows[i];
        if (!el || !row) {
          return;
        }
        const title = el.querySelector(".kt-ba-title");
        const before = el.querySelector(".kt-ba-before-text");
        const after = el.querySelector(".kt-ba-after-text");
        if (title && row.title != null) {
          targets.push(target(host, "table", title, ["rows", i, "title"], 40));
        }
        if (before && row.before != null) {
          targets.push(target(host, "table", before, ["rows", i, "before"], 60));
        }
        if (after && row.after != null) {
          targets.push(target(host, "table", after, ["rows", i, "after"], 60));
        }
      });
    }
    return targets;
  }

  /* ── sequence (renderSequence) ────────────────────────────────────
     anchor=id. Actors resolve through data-actor in the exchange and parts
     views and through roster order in the briefing; messages resolve through
     the legend's data-edge (authored id, else authored index). The in-canvas
     text.kseq-message-label duplicates the legend copy and is never matched.
     messages[].filter renders into .kdf-labels, which the kit gives
     pointer-events:none, so a filter can never be clicked — it stays
     panel-edited. In the parts view each part re-indexes its own message
     slice, so only authored ids are mapped there. */
  function sequenceTargets(host, data) {
    const targets = [];
    const push = pusher(targets, host, "sequence", data);
    const briefing = host.classList.contains("kseq-briefing");
    const parts = host.classList.contains("kseq-parts");
    const rosterCards = briefing ? byIndex(host, ".kseq-brief-actor-card") : [];
    (data.actors || []).forEach(function (actor, i) {
      if (briefing) {
        const card = rosterCards[i];
        if (!card) {
          return;
        }
        push(directChildren(card, "STRONG")[0], ["actors", i, "label"], 16);
        push(directChildren(card, "SPAN")[0], ["actors", i, "sub"], 18);
        return;
      }
      if (!actor || actor.id == null) {
        return;
      }
      const el = host.querySelector('.kseq-actor[data-actor="' + attrValue(actor.id) + '"]');
      if (!el) {
        return;
      }
      push(directChildren(el, "STRONG")[0], ["actors", i, "label"], 16);
      push(directChildren(el, "SMALL")[0], ["actors", i, "sub"], 18);
    });
    (data.messages || []).forEach(function (message, i) {
      if (!message || (parts && message.id == null)) {
        return;
      }
      const id = attrValue(message.id != null ? String(message.id) : String(i));
      if (briefing) {
        const row = host.querySelector('.kseq-brief-row[data-message="' + id + '"]');
        push(row && row.querySelector(".kseq-brief-copy > strong"), ["messages", i, "label"], 28);
        return;
      }
      push(
        host.querySelector('.kdf-legend-item[data-edge="' + id + '"] .kdf-legend-text'),
        ["messages", i, "label"],
        28,
      );
    });
    return targets;
  }

  /* ── erd (renderErd) ──────────────────────────────────────────────
     anchor=id throughout: entities by data-entity, attributes by the
     data-attr name the renderer already uses for hover, relations by the
     legend's data-edge. Id anchoring survives the Fields/Relationships
     adjustments, which only ever hide rows. The in-canvas .kerd-rel-label
     duplicates the legend label and is never matched. */
  function erdTargets(host, data) {
    const targets = [];
    const push = pusher(targets, host, "erd", data);
    (data.entities || []).forEach(function (entity, i) {
      if (!entity || entity.id == null) {
        return;
      }
      const el = host.querySelector('.kerd-entity[data-entity="' + attrValue(entity.id) + '"]');
      if (!el) {
        return;
      }
      push(el.querySelector(":scope > .kerd-head"), ["entities", i, "label"], 22);
      (entity.attrs || []).forEach(function (attr, j) {
        if (!attr || attr.name == null) {
          return;
        }
        const row = el.querySelector('.kerd-attr[data-attr="' + attrValue(attr.name) + '"]');
        if (!row) {
          return;
        }
        push(row.querySelector(".kerd-attr-name"), ["entities", i, "attrs", j, "name"], 18);
        push(row.querySelector(".kerd-attr-type"), ["entities", i, "attrs", j, "type"], 10);
      });
    });
    (data.relations || []).forEach(function (relation, i) {
      const id = attrValue(relation && relation.id != null ? String(relation.id) : String(i));
      push(
        host.querySelector('.kdf-legend-item[data-edge="' + id + '"] .kerd-relation-label'),
        ["relations", i, "label"],
        20,
      );
    });
    return targets;
  }

  /* ── stack (renderStack) ──────────────────────────────────────────
     anchor=id per frame, index per lane: .kstk-lane follows lanes[] order,
     and each frame wrap carries the authored frame id, which survives the
     default "Main calls" view dropping off-path frames. Frames without
     authored ids fall back to order, and only while nothing was dropped.
     Diff mode maps both panes under before./after. paths. The collapsed
     Present strip repeats the lane label and the guard stub prefixes
     "early exit · ", so neither is matched; a frame's file path renders as
     directory and name spans and stays panel-edited. The call-briefing
     composition (.kstk-brief-calls) restates every frame in a second list,
     so it is left to the panel rather than mapped twice. */
  function stackFramePairs(laneEl, frames) {
    const wraps = byIndex(laneEl, ".kstk-lane-frames .kstk-frame-wrap");
    if (
      frames.length > 0 &&
      frames.every(function (frame) {
        return frame && frame.id != null;
      })
    ) {
      const byFrame = new Map(
        wraps.map(function (wrap) {
          return [wrap.dataset.frame, wrap];
        }),
      );
      return frames.map(function (frame, index) {
        return { index, wrap: byFrame.get(String(frame.id)) };
      });
    }
    if (wraps.length !== frames.length) {
      return [];
    }
    return wraps.map(function (wrap, index) {
      return { index, wrap };
    });
  }

  function stackLaneTargets(push, scope, lanes, base) {
    const laneEls = byIndex(scope, ".kstk-lane");
    if (laneEls.length !== lanes.length) {
      return;
    }
    laneEls.forEach(function (laneEl, i) {
      const lane = lanes[i];
      if (!lane) {
        return;
      }
      const head = laneEl.querySelector(":scope > .kstk-lane-head");
      if (head) {
        push(directChildren(head, "SPAN")[0], base.concat("lanes", i, "label"), 22);
        push(directChildren(head, "SMALL")[0], base.concat("lanes", i, "sub"), 28);
      }
      const framePath = base.concat("lanes", i, "frames");
      stackFramePairs(laneEl, lane.frames || []).forEach(function (pair) {
        const wrap = pair.wrap;
        const j = pair.index;
        if (!wrap) {
          return;
        }
        const row = wrap.querySelector(":scope > .kstk-frame");
        if (row) {
          push(row.querySelector(":scope > .kstk-fn"), framePath.concat(j, "fn"), 36);
          push(row.querySelector(":scope > .kstk-note"), framePath.concat(j, "note"), 40);
          byIndex(row, ":scope > .kstk-chips > .kstk-chip").forEach(function (chip, k) {
            push(chip, framePath.concat(j, "chips", k, "label"), 22);
          });
        }
        byIndex(wrap, ":scope > .kstk-code-card .kstk-code-line").forEach(function (line, k) {
          push(line, framePath.concat(j, "code", k), 64);
        });
      });
    });
  }

  function stackTargets(host, data) {
    const targets = [];
    const push = pusher(targets, host, "stack", data);
    if (host.querySelector(".kstk-brief-calls")) {
      return targets;
    }
    const beforePane = host.querySelector(".kstk-diff-pane-before");
    const afterPane = host.querySelector(".kstk-diff-pane-after");
    if (beforePane && afterPane) {
      [
        { pane: beforePane, side: "before" },
        { pane: afterPane, side: "after" },
      ].forEach(function (entry) {
        const side = data[entry.side] || {};
        push(entry.pane.querySelector(".kstk-diff-pane-chip"), [entry.side, "label"], 14);
        stackLaneTargets(push, entry.pane, side.lanes || [], [entry.side]);
      });
      return targets;
    }
    stackLaneTargets(push, host, data.lanes || [], []);
    return targets;
  }

  /* ── operating-model (renderArchitecture preset) ──────────────────
     anchor=id through data-node/data-edge, which every layout (flow, roles,
     lanes, gates, progression) sets on the stage card and the handoff it
     renders. Only the copy a layout prints verbatim is mapped: the derived
     "Owner: ", "With ", "Ready when: ", "Decides: " and phase-range lines
     are skipped, and the lanes layout's swimlane heading is skipped too
     because it names an owner group rather than one authored field. */
  function operatingModelTargets(host, data) {
    const targets = [];
    const push = pusher(targets, host, "operating-model", data);
    push(host.querySelector(".kom-principle"), ["principle"], 100);
    (data.stages || []).forEach(function (stage, i) {
      if (!stage || stage.id == null) {
        return;
      }
      const el = host.querySelector('[data-node="' + attrValue(stage.id) + '"]');
      if (!el) {
        return;
      }
      push(el.querySelector("h3"), ["stages", i, "title"], 32);
      push(
        firstOf(el, [
          ":scope > p.kom-stage-body",
          ":scope > .kom-responsibility > p.kom-stage-body",
          ".kom-progress-purpose",
          ".kom-gate-commitment",
        ]),
        ["stages", i, "body"],
        140,
      );
      push(el.querySelector(".kom-owner > strong"), ["stages", i, "owner"], 32);
      push(
        firstOf(el, [".kom-cadence > span:not(.kom-field-label)", "small.kom-lane-cadence"]),
        ["stages", i, "cadence"],
        32,
      );
    });
    (data.handoffs || []).forEach(function (edge, i) {
      if (!edge || edge.id == null) {
        return;
      }
      const el = host.querySelector('[data-edge="' + attrValue(edge.id) + '"]');
      if (!el || !el.classList.contains("kom-handoff")) {
        push(
          el && el.classList.contains("kom-gate-panel") ? el.querySelector(":scope > h4") : null,
          ["handoffs", i, "label"],
          36,
        );
      } else {
        push(el.querySelector("strong"), ["handoffs", i, "label"], 36);
      }
      if (!el) {
        return;
      }
      push(el.querySelector(".kom-gate-decision > strong"), ["handoffs", i, "approver"], 32);
      byIndex(el, ".kom-gate-criteria > li").forEach(function (item, j) {
        push(item.querySelector(":scope > strong"), ["handoffs", i, "criteria", j, "label"], 48);
        push(
          item.querySelector(":scope > p.kom-stage-body"),
          ["handoffs", i, "criteria", j, "evidence"],
          72,
        );
      });
    });
    const progression = data.progression || {};
    push(host.querySelector(".kom-progress-caption"), ["progression", "caption"], 120);
    (progression.states || []).forEach(function (state, i) {
      if (!state || state.id == null) {
        return;
      }
      push(
        host.querySelector(
          '.kom-progress-legend .kom-progress-state[data-state="' + attrValue(state.id) + '"] span',
        ),
        ["progression", "states", i, "label"],
        24,
      );
    });
    (progression.capabilities || []).forEach(function (capability, i) {
      if (!capability || capability.id == null) {
        return;
      }
      // The capability name repeats in every phase cell; each copy carries
      // the same path, so an edit to any of them rewrites the one field.
      byIndex(
        host,
        '.kom-progress-cell[data-capability="' + attrValue(capability.id) + '"] > strong',
      ).forEach(function (el) {
        push(el, ["progression", "capabilities", i, "label"], 30);
      });
    });
    (progression.horizons || []).forEach(function (_horizon, i) {
      push(
        host.querySelector('.kom-progress-horizon[data-horizon="' + i + '"] > strong'),
        ["progression", "horizons", i, "label"],
        40,
      );
    });
    return targets;
  }

  /* ── trace (renderTrace) ──────────────────────────────────────────
     anchor=index over spans[] in the briefing composition, where every span
     prints its own row. The timing waterfall draws architecture traces
     without span captions and collapses same-id spans into one shared
     legend row, so a legend edit could not name one authored side — only
     the two compare pane totals are mapped there. */
  function traceTargets(host, data) {
    const targets = [];
    const push = pusher(targets, host, "trace", data);
    if (data.compare) {
      const labels = byIndex(host, ".kch-trace-total-label");
      push(labels[0], ["compare", "before", "label"], 14);
      push(labels[1], ["compare", "after", "label"], 14);
    }
    byIndex(host, ".ktrace-briefing-row").forEach(function (row, i) {
      push(row.querySelector(".ktrace-briefing-lane"), ["spans", i, "lane"], 16);
      push(row.querySelector(".ktrace-briefing-label"), ["spans", i, "label"], 24);
      push(row.querySelector(".ktrace-briefing-note"), ["spans", i, "note"], 28);
    });
    return targets;
  }

  /* ── chart (renderChart) ──────────────────────────────────────────
     anchor=index. stat prints items[] in order as HTML cards; dots prints
     parts[] either as grouped SVG captions (data-part) or as legend chips;
     bars prints items[] as g.kch-item in order. Values stay panel-edited —
     they are numbers, not strings. Other chart kinds have no string label in
     stable DOM order and are left to the panel. */
  function walkthroughNamed(data) {
    // A walkthrough step may point at an item by label rather than by index,
    // which makes that one label an identifier: renaming it alone would leave
    // the step dangling, so it stays with the panel that can fix both.
    const named = new Set();
    (data.walkthrough || []).forEach(function (step) {
      const focus = step && step.focus;
      const key = focus && (focus.item == null ? focus.part : focus.item);
      if (typeof key === "string") {
        named.add(key);
      }
    });
    return named;
  }

  function chartTargets(host, data) {
    const targets = [];
    const push = pusher(targets, host, "chart", data);
    const named = walkthroughNamed(data);
    const editable = function (entry) {
      return entry && !named.has(entry.label);
    };
    if (data.kind === "stat") {
      byIndex(host, ".kch-stat-item").forEach(function (el, i) {
        if (editable((data.items || [])[i])) {
          push(el.querySelector(".kch-stat-label"), ["items", i, "label"], null);
        }
        push(el.querySelector(".kch-stat-sub"), ["items", i, "sub"], null);
      });
      return targets;
    }
    if (data.kind === "dots") {
      (data.parts || []).forEach(function (part, i) {
        if (!editable(part)) {
          return;
        }
        push(
          host.querySelector('.kch-dot-part[data-part="' + i + '"] > text.kch-cat'),
          ["parts", i, "label"],
          24,
        );
      });
      byIndex(host, ".kch-dot-legend-item").forEach(function (el, i) {
        if (editable((data.parts || [])[i])) {
          push(directChildren(el, "SPAN")[0], ["parts", i, "label"], 24);
        }
      });
      return targets;
    }
    if (data.kind === "bars") {
      byIndex(host, "g.kch-item").forEach(function (group, i) {
        if (editable((data.items || [])[i])) {
          push(group.querySelector("text.kch-cat"), ["items", i, "label"], null);
        }
      });
    }
    return targets;
  }

  /* ── roadmap (renderRoadmap) ──────────────────────────────────────
     anchor=id: lanes and items carry the ids renderRoadmap already requires
     to be unique, so the Key-items adjustment and the walkthrough's context
     reveal only ever remove anchors, never shift them. The layout is read
     off the element that matched: SVG lane/item captions in the timeline,
     strong/small in the workstream rows, card and chapter copy elsewhere. A
     commitment that spans two phases renders one card per phase; both copies
     carry the same path. The walkthrough panel keeps a hidden reserve copy
     of every state's text, so walkthrough copy stays panel-edited. */
  function roadmapTargets(host, data) {
    const targets = [];
    const push = pusher(targets, host, "roadmap", data);
    byIndex(host, "figcaption.krm-periods > span").forEach(function (el, i) {
      push(el, ["periods", i, "label"], 32);
    });
    (data.lanes || []).forEach(function (lane, i) {
      if (!lane || lane.id == null) {
        return;
      }
      byIndex(host, '[data-lane="' + attrValue(lane.id) + '"]').forEach(function (laneEl) {
        push(
          firstOf(laneEl, ["text.krm-lane-label", ".krm-workstream-label > strong"]),
          ["lanes", i, "label"],
          22,
        );
        push(
          firstOf(laneEl, ["text.krm-lane-sub", ".krm-workstream-label > small"]),
          ["lanes", i, "sub"],
          32,
        );
      });
      (lane.items || []).forEach(function (item, j) {
        if (!item || item.id == null) {
          return;
        }
        byIndex(host, '[data-item="' + attrValue(item.id) + '"]').forEach(function (itemEl) {
          push(
            firstOf(itemEl, ["text.krm-item-label", ".krm-card-title", ".krm-chapter-item-title"]),
            ["lanes", i, "items", j, "label"],
            28,
          );
          push(
            firstOf(itemEl, [".krm-card-note", ".krm-chapter-detail > p"]),
            ["lanes", i, "items", j, "note"],
            52,
          );
        });
      });
    });
    return targets;
  }

  /* ── loop (renderLoop) ────────────────────────────────────────────
     anchor=index over stages[] and legend[]. The detail panel is one set of
     elements reused by whichever stage is current, and renderLoop makes a
     stage current on hover as well as on click, so the panel is mapped to
     the stage the .sel node names at the moment the map is built — the
     engine rebuilds the map on the click that opens an edit. Its eyebrow and
     title fall back to derived copy when unauthored, so only authored values
     become targets. */
  function loopTargets(host, data) {
    const targets = [];
    const push = pusher(targets, host, "loop", data);
    const stages = data.stages || [];
    const nodes = byIndex(host, ".klp-track > .klp-node");
    nodes.forEach(function (node, i) {
      push(node.querySelector(".klp-label"), ["stages", i, "label"], 24);
      push(node.querySelector(".klp-tag"), ["stages", i, "tag"], 24);
    });
    const current = nodes.findIndex(function (node) {
      return node.classList.contains("sel");
    });
    if (current !== -1 && stages[current]) {
      push(host.querySelector(".klp-detail-eyebrow"), ["stages", current, "eyebrow"], 32);
      push(host.querySelector(".klp-detail-title"), ["stages", current, "title"], 40);
      push(host.querySelector(".klp-detail-body"), ["stages", current, "body"], 180);
    }
    byIndex(host, ".klp-legend > .klp-lk").forEach(function (item, i) {
      push(directChildren(item, "SPAN")[0], ["legend", i, "label"], 24);
    });
    push(host.querySelector(".klp-return-label"), ["return", "label"], 48);
    return targets;
  }

  /* ── stepper (renderStepper) ──────────────────────────────────────
     anchor=index over steps[]. The rail dot prints title, else label, else a
     derived "Step n", so the dot is mapped to whichever field the renderer
     actually printed. Only the active step's panel is mapped, found through
     the dot carrying .active; the panel is rebuilt on every step change, so
     the engine re-reads the map on the click that opens an edit. */
  function stepperTargets(host, data) {
    const targets = [];
    const push = pusher(targets, host, "stepper", data);
    const steps = data.steps || [];
    const dots = byIndex(host, ".kst-dot");
    dots.forEach(function (dot, i) {
      const step = steps[i] || {};
      const title = dot.querySelector(".kst-dot-title");
      if (step.title != null) {
        push(title, ["steps", i, "title"], 40);
      } else {
        push(title, ["steps", i, "label"], 32);
      }
    });
    const current = dots.findIndex(function (dot) {
      return dot.classList.contains("active");
    });
    if (current !== -1 && steps[current]) {
      const prose = host.querySelector(".kst-prose");
      if (prose) {
        push(prose.querySelector(".kst-label"), ["steps", current, "label"], 32);
        push(prose.querySelector("h4"), ["steps", current, "title"], 40);
        push(prose.querySelector("p"), ["steps", current, "body"], 180);
      }
      push(
        host.querySelector(".kst-code .code-head > span"),
        ["steps", current, "code", "filename"],
        64,
      );
    }
    return targets;
  }

  /* ── code (renderCode diff) ───────────────────────────────────────
     anchor=index per pane: .kcd-line follows the authored line order inside
     .kcd-before / .kcd-after. A line may be authored as a bare string or as
     an object, and the path follows the authored shape. The file path
     renders as directory and name spans inside one <code>, so the whole
     element is the target and commits the full path back. */
  function codeTargets(host, data) {
    const targets = [];
    const push = pusher(targets, host, "code", data);
    ["before", "after"].forEach(function (side) {
      const pane = host.querySelector(".kcd-pane.kcd-" + side);
      if (!pane) {
        return;
      }
      push(pane.querySelector(".kcd-label"), [side, "label"], 14);
      push(pane.querySelector("code.kcd-file"), [side, "file"], 48);
      const lines = (data[side] && data[side].lines) || [];
      byIndex(pane, ".kcd-lines > .kcd-line").forEach(function (row, i) {
        if (i >= lines.length) {
          return;
        }
        const path = typeof lines[i] === "string" ? [side, "lines", i] : [side, "lines", i, "text"];
        push(row.querySelector("code.kcd-source"), path, 88);
      });
    });
    return targets;
  }

  /* ── iceberg (renderIceberg) ──────────────────────────────────────
     anchor=index over the SVG captions, which paint above[] titles and their
     lines in authored order and then below[] row by row. renderIceberg also
     builds a .kib-cutaway briefing clone of the same copy for narrow
     screens; that clone is never matched. */
  function icebergTargets(host, data) {
    const targets = [];
    const push = pusher(targets, host, "iceberg", data);
    const above = data.above || [];
    byIndex(host, "text.kib-above-title").forEach(function (el, i) {
      push(el, ["above", i, "title"], 22);
    });
    const linePaths = [];
    above.forEach(function (item, i) {
      ((item && item.lines) || []).forEach(function (_line, k) {
        linePaths.push(["above", i, "lines", k]);
      });
    });
    byIndex(host, "text.kib-above-line").forEach(function (el, i) {
      if (linePaths[i]) {
        push(el, linePaths[i], 26);
      }
    });
    const cellPaths = [];
    (data.below || []).forEach(function (row, r) {
      if (Array.isArray(row)) {
        row.forEach(function (_cell, c) {
          cellPaths.push(["below", r, c]);
        });
      } else {
        cellPaths.push(["below", r]);
      }
    });
    byIndex(host, "text.kib-below:not(.kib-punch)").forEach(function (el, i) {
      if (cellPaths[i]) {
        push(el, cellPaths[i], 34);
      }
    });
    push(host.querySelector("text.kib-punch"), ["punch"], 44);
    push(host.querySelector("text.kib-unknown"), ["bottom"], 60);
    push(host.querySelector("text.kib-stamp"), ["stamp"], 48);
    return targets;
  }

  /* ── pyramid (renderPyramid) ──────────────────────────────────────
     anchor=index over layers[]. Whichever composition rendered is the one
     mapped: the SVG pyramid's captions or the ladder's rows, never both. */
  function pyramidTargets(host, data) {
    const targets = [];
    const push = pusher(targets, host, "pyramid", data);
    const ladder = byIndex(host, ".kpy-ladder-row");
    if (ladder.length > 0) {
      ladder.forEach(function (row, i) {
        const copy = row.querySelector(".kpy-ladder-copy");
        if (copy) {
          push(directChildren(copy, "STRONG")[0], ["layers", i, "name"], 20);
          push(directChildren(copy, "SPAN")[0], ["layers", i, "count"], 18);
        }
        push(row.querySelector(".kpy-ladder-flag"), ["layers", i, "flag", "label"], 18);
      });
      return targets;
    }
    byIndex(host, "g.kpy-row").forEach(function (group, i) {
      push(group.querySelector("text.kpy-name"), ["layers", i, "name"], 20);
      push(group.querySelector("text.kpy-count"), ["layers", i, "count"], 18);
      push(group.querySelector("text.kpy-flag"), ["layers", i, "flag", "label"], 18);
    });
    return targets;
  }

  /* ── tree (renderTree) ────────────────────────────────────────────
     anchor=index over a depth-first walk of the authored tree, which is the
     order renderTree appends its rows. Org mode collapses deep branches
     behind a "+N more" button that builds its cards later, so the walk is
     mapped only when the rendered card count still matches the authored node
     count. Files mode folds some children into leaf chips and some into
     rows by its own rule, so it stays panel-edited. Evolution panes label
     their heading and their subtitle in one element, so the heading is
     mapped only when no subtitle shares it. */
  function treeWalk(nodes, basePath, out) {
    (nodes || []).forEach(function (node, i) {
      if (!node) {
        return;
      }
      const path = basePath.concat(i);
      out.rows.push({ node, path });
      const children = node.children || [];
      if (!children.length) {
        return;
      }
      if (node.columns) {
        children.forEach(function (child, c) {
          out.leaves.push({ node: child, path: path.concat("children", c) });
        });
        return;
      }
      treeWalk(children, path.concat("children"), out);
    });
  }

  function treeTargets(host, data) {
    const targets = [];
    const push = pusher(targets, host, "tree", data);
    if (data.mode === "org" && data.root) {
      const walk = { leaves: [], rows: [] };
      treeWalk([data.root], ["root"], walk);
      // ["root", 0, …] addresses the single-element array the walk was
      // seeded with; the authored path drops that index.
      const paths = walk.rows.map(function (entry) {
        return ["root"].concat(entry.path.slice(2));
      });
      const cards = byIndex(host, ".ktr-card");
      if (cards.length !== paths.length) {
        return targets;
      }
      cards.forEach(function (card, i) {
        push(card.querySelector(".ktr-name"), paths[i].concat("label"), null);
        push(card.querySelector(".ktr-sub"), paths[i].concat("sub"), null);
        push(card.querySelector(".ktr-note"), paths[i].concat("note"), null);
      });
      return targets;
    }
    if (data.mode === "evolution") {
      byIndex(host, ".ktr-pane").forEach(function (pane, i) {
        const authored = (data.panes || [])[i];
        if (!authored) {
          return;
        }
        const label = pane.querySelector(".ktr-pane-label");
        if (label && !label.querySelector(".ktr-pane-sub")) {
          push(label, ["panes", i, "label"], null);
        }
        push(pane.querySelector(".ktr-pane-sub"), ["panes", i, "sub"], null);
        const walk = { leaves: [], rows: [] };
        treeWalk(authored.tree, ["panes", i, "tree"], walk);
        const rows = byIndex(pane, ".ktr-node");
        const leaves = byIndex(pane, ".ktr-leaf");
        if (rows.length !== walk.rows.length || leaves.length !== walk.leaves.length) {
          return;
        }
        rows.forEach(function (row, j) {
          const path = walk.rows[j].path;
          push(row.querySelector(".ktr-name"), path.concat("name"), null);
          push(row.querySelector(".ktr-rationale"), path.concat("rationale"), null);
          push(row.querySelector(".ktr-note"), path.concat("note"), null);
        });
        leaves.forEach(function (leaf, j) {
          const path = walk.leaves[j].path;
          push(leaf.querySelector(".ktr-leaf-name"), path.concat("name"), null);
          push(leaf.querySelector(".ktr-leaf-note"), path.concat("note"), null);
        });
      });
    }
    return targets;
  }

  const LENSES = {
    architecture: architectureTargets,
    chart: chartTargets,
    code: codeTargets,
    erd: erdTargets,
    flow: flowTargets,
    iceberg: icebergTargets,
    loop: loopTargets,
    "operating-model": operatingModelTargets,
    pyramid: pyramidTargets,
    roadmap: roadmapTargets,
    sequence: sequenceTargets,
    stack: stackTargets,
    stepper: stepperTargets,
    table: tableTargets,
    trace: traceTargets,
    tree: treeTargets,
  };

  const TABLE_MODES = new Set(["rows", "before-after", "grid", "chips", "specs"]);

  function supports(kind, data) {
    if (!data || typeof data !== "object") {
      return false;
    }
    if (kind === "flow") {
      return Array.isArray(data.items) && data.items.length > 0;
    }
    if (kind === "architecture") {
      return (
        data.preset !== "operating-model" && Array.isArray(data.nodes) && data.nodes.length > 0
      );
    }
    if (kind === "table") {
      return TABLE_MODES.has(data.mode);
    }
    if (kind === "sequence") {
      return Array.isArray(data.actors) && data.actors.length > 0;
    }
    if (kind === "erd") {
      return Array.isArray(data.entities) && data.entities.length > 0;
    }
    if (kind === "stack") {
      return Array.isArray(data.lanes) ? data.lanes.length > 0 : Boolean(data.before && data.after);
    }
    if (kind === "operating-model") {
      return Array.isArray(data.stages) && data.stages.length > 0;
    }
    if (kind === "trace") {
      return Array.isArray(data.spans) || Boolean(data.compare);
    }
    if (kind === "chart") {
      return ["bars", "dots", "stat"].includes(data.kind);
    }
    if (kind === "roadmap" || kind === "loop") {
      const list = kind === "roadmap" ? data.lanes : data.stages;
      return Array.isArray(list) && list.length > 0;
    }
    if (kind === "stepper") {
      return Array.isArray(data.steps) && data.steps.length > 0;
    }
    if (kind === "code") {
      return Boolean(data.before && data.after);
    }
    if (kind === "iceberg") {
      return Array.isArray(data.above) || Array.isArray(data.below);
    }
    if (kind === "pyramid") {
      return Array.isArray(data.layers) && data.layers.length > 0;
    }
    if (kind === "tree") {
      return data.mode === "org"
        ? Boolean(data.root)
        : data.mode === "evolution" && Array.isArray(data.panes);
    }
    return false;
  }

  function collect(host, component) {
    if (!host || !component || !component.data || !supports(component.kind, component.data)) {
      return [];
    }
    try {
      return LENSES[component.kind](host, component.data);
    } catch {
      // A lens must never break the page: an unexpected shape simply has no
      // inline targets, and the structured panel keeps working.
      return [];
    }
  }

  /* ── panel coverage ──────────────────────────────────────────────────
     isCovered(kind, path, data) tells the structured editor which authored
     fields the lenses already put on the slide, so the panel can stop
     printing them twice. It is the same contract collect() proves on the
     live DOM: covered paths must round-trip through an inline commit.
     Fields whose current value carries markup (kitSetPassiveInline allowlist)
     are NOT covered — inline editing refuses them, so they stay in the panel.
     Collections count as covered only when every item is fully covered. */
  function plain(value) {
    return !(typeof value === "string" && value.includes("<"));
  }

  function flowFieldCovered(rest, data) {
    if (!rest.length) {
      return false;
    }
    if (rest.length === 1) {
      if (rest[0] === "at") {
        return (data && (data.layout || "across")) === "down";
      }
      return rest[0] === "when" || rest[0] === "label" || rest[0] === "sub";
    }
    if (rest[0] === "subs" && rest.length === 2) {
      return true;
    }
    return rest[0] === "outcomes" && rest.length === 3 && rest[2] === "text";
  }

  function flowItemCovered(item, data) {
    if (!item) {
      return true;
    }
    const values = [
      item.when,
      item.label,
      item.sub,
      ...(Array.isArray(item.subs) ? item.subs : []),
      ...(item.outcomes || []).map(function (outcome) {
        return outcome && outcome.text;
      }),
    ];
    if ((data && (data.layout || "across")) === "down") {
      values.push(item.at);
    }
    return values.every(plain);
  }

  function tableRowCovered(row, fields) {
    return (
      Boolean(row) &&
      fields.every(function (field) {
        return plain(row[field]);
      })
    );
  }

  function isIndex(part) {
    return typeof part === "number";
  }

  function childChain(parts) {
    if (parts.length % 2 !== 0) {
      return false;
    }
    for (let i = 0; i < parts.length; i += 2) {
      if (parts[i] !== "children" || !isIndex(parts[i + 1])) {
        return false;
      }
    }
    return true;
  }

  /* Coverage for the kinds B2 added. A field counts as covered only where
     every composition of that kind prints it: copy that one composition
     draws and another hides (stack code cards, roadmap item notes, the
     operating model's owner and gate detail, trace timing captions) stays in
     the panel, so switching composition never hides a field from both
     places. Live emphasis switches inside one composition — the loop's
     current stage, the stepper's current step — do not narrow coverage,
     because every item can be made current from the slide itself. */
  const COVERED = {
    chart(path, data) {
      if (path.length !== 3 || !isIndex(path[1])) {
        return false;
      }
      const entries = (data.kind === "dots" ? data.parts : data.items) || [];
      const entry = entries[path[1]];
      const label = Boolean(entry) && !walkthroughNamed(data).has(entry.label);
      if (data.kind === "stat") {
        return path[0] === "items" && (path[2] === "sub" || (path[2] === "label" && label));
      }
      if (data.kind === "dots") {
        return path[0] === "parts" && path[2] === "label" && label;
      }
      return data.kind === "bars" && path[0] === "items" && path[2] === "label" && label;
    },
    code(path) {
      if (path[0] !== "before" && path[0] !== "after") {
        return false;
      }
      if (path.length === 2) {
        return ["file", "label"].includes(path[1]);
      }
      if (path[1] !== "lines" || !isIndex(path[2])) {
        return false;
      }
      return path.length === 3 || (path.length === 4 && path[3] === "text");
    },
    erd(path) {
      if (path[0] === "entities" && isIndex(path[1])) {
        if (path.length === 3) {
          return path[2] === "label";
        }
        return (
          path.length === 5 &&
          path[2] === "attrs" &&
          isIndex(path[3]) &&
          ["name", "type"].includes(path[4])
        );
      }
      return (
        path.length === 3 && path[0] === "relations" && isIndex(path[1]) && path[2] === "label"
      );
    },
    iceberg(path) {
      if (path.length === 1) {
        return ["bottom", "punch", "stamp"].includes(path[0]);
      }
      if (path[0] === "above" && isIndex(path[1])) {
        if (path.length === 3) {
          return path[2] === "title";
        }
        return path.length === 4 && path[2] === "lines" && isIndex(path[3]);
      }
      return (
        path[0] === "below" &&
        isIndex(path[1]) &&
        (path.length === 2 || (path.length === 3 && isIndex(path[2])))
      );
    },
    loop(path) {
      if (path.length === 2 && path[0] === "return") {
        return path[1] === "label";
      }
      if (path.length === 3 && path[0] === "legend" && isIndex(path[1])) {
        return path[2] === "label";
      }
      return (
        path.length === 3 &&
        path[0] === "stages" &&
        isIndex(path[1]) &&
        ["body", "eyebrow", "label", "tag", "title"].includes(path[2])
      );
    },
    "operating-model"(path) {
      return (
        path.length === 3 &&
        path[0] === "stages" &&
        isIndex(path[1]) &&
        ["body", "title"].includes(path[2])
      );
    },
    pyramid(path) {
      if (path[0] !== "layers" || !isIndex(path[1])) {
        return false;
      }
      if (path.length === 3) {
        return ["count", "name"].includes(path[2]);
      }
      return path.length === 4 && path[2] === "flag" && path[3] === "label";
    },
    roadmap(path) {
      if (path[0] !== "lanes" || !isIndex(path[1])) {
        return false;
      }
      if (path.length === 3) {
        return ["label", "sub"].includes(path[2]);
      }
      return path.length === 5 && path[2] === "items" && isIndex(path[3]) && path[4] === "label";
    },
    sequence(path) {
      if (path.length !== 3 || !isIndex(path[1])) {
        return false;
      }
      if (path[0] === "actors") {
        return ["label", "sub"].includes(path[2]);
      }
      return path[0] === "messages" && path[2] === "label";
    },
    stack(path) {
      let rest = path;
      if (path[0] === "before" || path[0] === "after") {
        if (path.length === 2) {
          return path[1] === "label";
        }
        rest = path.slice(1);
      }
      if (rest[0] !== "lanes" || !isIndex(rest[1])) {
        return false;
      }
      if (rest.length === 3) {
        return ["label", "sub"].includes(rest[2]);
      }
      if (rest[2] !== "frames" || !isIndex(rest[3])) {
        return false;
      }
      if (rest.length === 5) {
        return ["fn", "note"].includes(rest[4]);
      }
      return rest.length === 7 && rest[4] === "chips" && isIndex(rest[5]) && rest[6] === "label";
    },
    stepper(path) {
      if (path[0] !== "steps" || !isIndex(path[1])) {
        return false;
      }
      if (path.length === 4) {
        return path[2] === "code" && path[3] === "filename";
      }
      return path.length === 3 && ["body", "label", "title"].includes(path[2]);
    },
    trace(path, data) {
      return (
        data.layout === "briefing" &&
        path.length === 3 &&
        path[0] === "spans" &&
        isIndex(path[1]) &&
        ["label", "lane", "note"].includes(path[2])
      );
    },
    tree(path, data) {
      if (data.mode === "org") {
        return (
          path[0] === "root" &&
          path.length > 1 &&
          ["label", "note", "sub"].includes(path.at(-1)) &&
          childChain(path.slice(1, -1))
        );
      }
      if (data.mode !== "evolution" || path[0] !== "panes" || !isIndex(path[1])) {
        return false;
      }
      if (path.length === 3) {
        return ["label", "sub"].includes(path[2]);
      }
      return (
        path.length > 4 &&
        path[2] === "tree" &&
        isIndex(path[3]) &&
        ["name", "note", "rationale"].includes(path.at(-1)) &&
        childChain(path.slice(4, -1))
      );
    },
  };

  function legacyCovered(kind, path, data) {
    if (kind === "flow") {
      if (path.length === 1) {
        if (path[0] === "caption") {
          return plain(data && data.caption);
        }
        if (path[0] === "items") {
          return ((data && data.items) || []).every(function (item) {
            return flowItemCovered(item, data);
          });
        }
        return false;
      }
      if (path[0] === "items" && typeof path[1] === "number") {
        const rest = path.slice(2);
        if (!flowFieldCovered(rest, data)) {
          return false;
        }
        return plain(valueAt(data, path));
      }
      return false;
    }
    if (kind === "architecture") {
      if (path.length === 3 && path[0] === "nodes" && typeof path[1] === "number") {
        if (!["eyebrow", "title", "sub"].includes(path[2])) {
          return false;
        }
        return plain(valueAt(data, path));
      }
      if (path.length === 3 && path[0] === "groups" && typeof path[1] === "number") {
        if (!["label", "sub"].includes(path[2])) {
          return false;
        }
        return plain(valueAt(data, path));
      }
      if (path.length === 3 && path[0] === "edges" && typeof path[1] === "number") {
        return path[2] === "label" && plain(valueAt(data, path));
      }
      return false;
    }
    if (kind === "table") {
      const mode = data && data.mode;
      if (path[0] === "rows") {
        if (mode !== "before-after") {
          return false;
        }
        if (path.length === 2 && typeof path[1] === "number") {
          return ((data && data.rows) || []).every(function (row) {
            return tableRowCovered(row, ["title", "before", "after"]);
          });
        }
        return (
          path.length === 3 &&
          ["title", "before", "after"].includes(path[2]) &&
          plain(valueAt(data, path))
        );
      }
      if (path[0] === "groups" && path.length >= 5 && path[2] === "rows") {
        const rest = path.slice(4);
        if (["rows", "grid", "chips"].includes(mode)) {
          return (
            rest.length === 1 &&
            ["title", "label", "sub"].includes(rest[0]) &&
            plain(valueAt(data, path))
          );
        }
        if (mode === "specs") {
          if (rest.length === 1 && ["label", "sub"].includes(rest[0])) {
            return plain(valueAt(data, path));
          }
          return rest.length === 2 && rest[0] === "values" && plain(valueAt(data, path));
        }
      }
      return false;
    }
    return false;
  }

  function isCovered(kind, path, data) {
    if (!Array.isArray(path) || !path.length) {
      return false;
    }
    if (!COVERED[kind]) {
      return legacyCovered(kind, path, data);
    }
    if (!COVERED[kind](path, data || {})) {
      return false;
    }
    const value = valueAt(data, path);
    return Array.isArray(value) ? value.every(plain) : plain(value);
  }

  root.ExplainerInlineEditLenses = Object.freeze({
    version: 1,
    setAt,
    valueAt,
    supports,
    collect,
    isCovered,
  });
})(globalThis);
