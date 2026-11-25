(function () {
  "use strict";
  const kit = globalThis.ExplainerKit;
  kit.registerCanvasEditor("operating-model", (host) => {
    if (
      !host.__kitCanvas ||
      host.__kitCanvas.kind !== "operating-model" ||
      !host.querySelector(".kom-program-board")
    ) {
      return null;
    }
    return {
      version: 1,
      availability() {
        if (
          !window.__RV__ ||
          !window.__RV__.canvas_editors ||
          window.__RV__.canvas_editors["operating-model"] !== 1
        ) {
          return "Restart Studio to enable saved structural editing. Your current review is kept.";
        }
        return host.__kitCanvas.layout === "progression"
          ? null
          : "Choose Capability progression to edit phases, boxes, delivery groups, and colours.";
      },
      snapshot: () => structuredClone(host.__kitCanvasEdits),
      authoredSnapshot: () => structuredClone(host.__kitCanvasAuthored),
      historyKey: () => "component",
      validate: (record) => host.__kitCanvas.validate(record),
      apply: (record) => host.__kitCanvas.apply(record),
      describeChanges: (record) =>
        `${record.stages.length} phases · ${record.progression.capabilities.length} capabilities · ${(record.progression.horizons || []).length} delivery groups`,
      help: "Click text to edit, or drag a tile by its coloured space. Blue dotted targets add items. Enter or Add confirms a new box; clicking away cancels it. Settings stay beside the item on the canvas.",
      resetLabel: "Reset edits",
      createSession(context) {
        const { element, button } = context;
        const targets = new Map();
        const textTargets = new Map();
        const listeners = new AbortController();
        let popover = null;
        let draft = null;
        let drag = null;
        let rowGrid = null;
        let rowCount = "";
        let suppressClickUntil = 0;
        let disposed = false;
        function glyph() {
          const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          svg.setAttribute("viewBox", "0 0 20 20");
          svg.setAttribute("aria-hidden", "true");
          svg.classList.add("st-progression-glyph");
          const path = document.createElementNS(svg.namespaceURI, "path");
          path.setAttribute("d", "M10 4v12M4 10h12");
          svg.append(path);
          return svg;
        }
        function markSelection() {
          const selected = context.selection();
          targets.forEach((value, target) => {
            const matches =
              selected &&
              (JSON.stringify(selected) === JSON.stringify(value) ||
                (value.kind === "phase" &&
                  selected.kind === "box" &&
                  !selected.id &&
                  selected.phase === value.id));
            target.classList.toggle("st-progression-selected", Boolean(matches));
            const hit = target.querySelector(".st-progression-hit");
            if (hit) {
              hit.setAttribute("aria-pressed", String(Boolean(matches)));
            }
          });
        }
        function control(label, className, action, disabled = false) {
          const node = button("", action, disabled);
          node.classList.add(className);
          node.dataset.stProgressionControl = "";
          node.setAttribute("aria-label", label);
          node.title = label;
          return node;
        }
        function addControl(label, action, disabled = false) {
          const node = control(label, "st-progression-add", action, disabled);
          node.append(glyph(), element("span", "", label));
          return node;
        }
        function settingsControl(label, hint, action) {
          const node = control(label + ". " + hint, "st-progression-settings", action);
          node.append(element("span", "", label));
          return node;
        }
        function bindText(node, target, value, field, label, state = false) {
          if (!node) {
            return;
          }
          const attributes = Object.fromEntries(
            ["tabindex", "role", "aria-label"].map((name) => [name, node.getAttribute(name)]),
          );
          textTargets.set(node, { target, value: { ...value, field }, attributes, state });
          node.classList.add(state ? "st-progression-state-label" : "st-progression-text");
          node.tabIndex = 0;
          node.setAttribute("role", "button");
          node.setAttribute("aria-label", label);
        }
        function editable(target, value, label, empty = false, emptyLabel = "Add here") {
          target.classList.add("st-progression-target");
          targets.set(target, value);
          if (empty) {
            const hit = control(label, "st-progression-hit", () =>
              beginAdd(target, value.phase, value.id),
            );
            hit.classList.add("st-progression-gap");
            hit.append(glyph(), element("span", "", emptyLabel));
            target.append(hit);
            return;
          }
          if (value.kind === "box") {
            bindText(
              target.querySelector(":scope > strong"),
              target,
              value,
              "label",
              "Edit capability name: " + label,
            );
            bindText(
              target.querySelector(":scope > span"),
              target,
              value,
              "state",
              "Change capability state",
              true,
            );
          } else if (value.kind === "phase") {
            bindText(target.querySelector("h3"), target, value, "title", label);
            bindText(
              target.querySelector(".kom-progress-purpose"),
              target,
              value,
              "body",
              "Edit phase description",
            );
            bindText(
              target.querySelector(".kom-stage-body"),
              target,
              value,
              "owner",
              "Edit phase owner",
            );
          } else if (value.kind === "group") {
            bindText(target.querySelector("strong"), target, value, "label", label);
            bindText(
              target.querySelector(".kom-progress-horizon-owner"),
              target,
              value,
              "owner",
              "Edit delivery group owner",
            );
          } else {
            bindText(target.querySelector(":scope > span"), target, value, "label", label);
          }
        }
        function change(update) {
          if (disposed) {
            return false;
          }
          const next = context.snapshot();
          try {
            update(next);
            return context.commit(next);
          } catch (error) {
            context.toast(error.message || "Could not apply this edit", true);
            return false;
          }
        }
        function select(value, open = true) {
          if (draft && !draft.leave()) {
            return;
          }
          closePopover();
          context.select(value);
          markSelection();
          const target = value && targetFor(value);
          if (open && target) {
            if (value.kind === "box") {
              openActions(target, value);
            } else {
              openSettings(value, target);
            }
          }
        }
        function closePopover() {
          const previous = popover;
          popover = null;
          if (previous) {
            previous.node.remove();
          }
        }
        function dismissPopover(restoreFocus = false) {
          const anchor = popover && popover.anchor;
          closePopover();
          context.select(null);
          markSelection();
          if (restoreFocus && anchor && anchor.isConnected) {
            const target =
              anchor.querySelector(".st-progression-text,.st-progression-state-label") || anchor;
            target.focus({ preventScroll: true });
          }
        }
        function positionPopover() {
          if (!popover) {
            return;
          }
          if (!popover.anchor.isConnected) {
            closePopover();
            return;
          }
          const { node, anchor } = popover;
          const bounds = anchor.getBoundingClientRect();
          node.style.maxHeight = Math.max(120, window.innerHeight - 32) + "px";
          const width = node.offsetWidth;
          const height = node.offsetHeight;
          node.style.left =
            Math.max(16, Math.min(bounds.left, window.innerWidth - width - 16)) + "px";
          const below = bounds.bottom + 8;
          const top = below + height <= window.innerHeight - 16 ? below : bounds.top - height - 8;
          node.style.top = Math.max(16, Math.min(top, window.innerHeight - height - 16)) + "px";
        }
        function showPopover(anchor, content, label) {
          closePopover();
          if (!anchor || !anchor.isConnected || !content) {
            return;
          }
          const node = context.dialog(label);
          node.classList.add("st-progression-popover");
          const close = button("×", () => dismissPopover(true));
          close.classList.add("st-progression-popover-close");
          close.setAttribute("aria-label", "Close canvas settings");
          node.append(close, content);
          popover = { node, anchor };
          document.body.append(node);
          positionPopover();
          markSelection();
          const input =
            node.querySelector("input,select,textarea") ||
            node.querySelector('button[aria-pressed="true"]') ||
            node.querySelector("button:not(.st-progression-popover-close):not(:disabled)");
          if (input) {
            input.focus({ preventScroll: true });
          }
        }
        function openSettings(value, anchor) {
          if (draft && !draft.leave()) {
            return;
          }
          context.select(value);
          const form = buildSettings(value);
          const title = form && form.querySelector("h4");
          showPopover(
            targetFor(value) || anchor,
            form,
            title ? title.textContent : "Canvas item settings",
          );
        }
        function openStatePicker(target, value) {
          if (draft && !draft.leave()) {
            return;
          }
          const base = { ...value };
          delete base.field;
          const data = context.snapshot();
          const capability = entryFor(data, base);
          const panel = element("div", "st-progression-state-picker");
          const phase = data.stages.find((stage) => stage.id === base.phase);
          menuHeading(panel, "Change state", capability.label + " · in " + phase.title);
          data.progression.states.forEach((state) => {
            const pick = button(state.label, () =>
              change((next) => {
                entryFor(next, base).states[base.phase] = state.id;
              }),
            );
            pick.classList.add("st-progression-state-choice", "st-canvas-choice");
            pick.setAttribute("aria-pressed", String(capability.states[base.phase] === state.id));
            pick.style.setProperty(
              "--kom-status",
              state.color || `var(--${state.tone === "neutral" ? "text-faint" : state.tone})`,
            );
            panel.append(pick);
          });
          const back = button("Back to capability actions", () =>
            openActions(targetFor(base) || target, base),
          );
          back.classList.add("st-canvas-menu-back");
          panel.append(back);
          context.select(base);
          showPopover(targetFor(base) || target, panel, "Choose capability state");
        }
        function targetFor(value) {
          const base = { ...value };
          delete base.field;
          for (const [target, candidate] of targets) {
            if (JSON.stringify(candidate) === JSON.stringify(base)) {
              return target;
            }
          }
          return null;
        }
        function entryFor(data, value) {
          if (value.kind === "box") {
            return data.progression.capabilities.find((item) => item.id === value.id);
          }
          if (value.kind === "phase") {
            return data.stages.find((item) => item.id === value.id);
          }
          if (value.kind === "group") {
            return (data.progression.horizons || [])[value.index];
          }
          return data.progression.states.find((item) => item.id === value.id);
        }
        function cancelDraft() {
          const previous = draft;
          draft = null;
          if (previous) {
            previous.cancel();
          }
        }
        function beginText(target, value, point = null) {
          if (draft && !draft.leave()) {
            return;
          }
          closePopover();
          context.select(null);
          markSelection();
          target = targetFor(value) || target;
          const property = value.field || (value.kind === "phase" ? "title" : "label");
          const selectors = { box: "strong", phase: "h3", group: "strong", state: ":scope > span" };
          const selector =
            property === "body"
              ? ".kom-progress-purpose"
              : property === "owner"
                ? value.kind === "phase"
                  ? ".kom-stage-body"
                  : ".kom-progress-horizon-owner"
                : selectors[value.kind];
          const limits = { box: 30, phase: 32, group: 40, state: 24 };
          const entry = entryFor(context.snapshot(), value);
          const original = target.querySelector(selector);
          if (!entry || !original || !target.isConnected) {
            return;
          }
          let caret = null;
          if (point && document.caretPositionFromPoint) {
            const position = document.caretPositionFromPoint(point.x, point.y);
            if (position && original.contains(position.offsetNode)) {
              caret = position.offset;
            }
          } else if (point && document.caretRangeFromPoint) {
            const range = document.caretRangeFromPoint(point.x, point.y);
            if (range && original.contains(range.startContainer)) {
              caret = range.startOffset;
            }
          }
          const input = element(
            property === "body" ? "textarea" : "input",
            "st-progression-inline-text",
          );
          input.dataset.stProgressionControl = "";
          input.value = entry[property];
          input.maxLength =
            property === "body" ? 140 : property === "owner" ? 32 : limits[value.kind];
          input.autocomplete = "off";
          input.setAttribute(
            "aria-label",
            value.kind === "box"
              ? "Capability name, shared across phases"
              : "Edit " + value.kind + " text",
          );
          Object.assign(input.style, {
            left: original.offsetLeft + "px",
            top: original.offsetTop + "px",
            width: original.offsetWidth + "px",
            height: Math.max(24, original.offsetHeight) + "px",
            font: getComputedStyle(original).font,
          });
          const visibility = original.style.visibility;
          const hit = target.querySelector(".st-progression-hit");
          original.style.visibility = "hidden";
          if (hit) {
            hit.hidden = true;
          }
          target.classList.add("st-progression-drafting");
          target.append(input);
          const pending = {
            leave() {
              return pending.save();
            },
            cancel() {
              original.style.visibility = visibility;
              if (hit) {
                hit.hidden = false;
              }
              target.classList.remove("st-progression-drafting");
              input.remove();
            },
            save() {
              if (draft !== pending) {
                return true;
              }
              const text = input.value.trim();
              if (!text) {
                input.setCustomValidity("Enter a name, or press Escape to cancel.");
                input.reportValidity();
                return false;
              }
              const unchanged = text === entryFor(context.snapshot(), value)[property];
              cancelDraft();
              return (
                unchanged ||
                change((next) => {
                  entryFor(next, value)[property] = text;
                })
              );
            },
          };
          draft = pending;
          input.addEventListener("input", () => input.setCustomValidity(""));
          input.addEventListener("blur", () => pending.save());
          input.addEventListener("keydown", (event) => {
            if ((event.key === "Enter" && !event.shiftKey) || event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              if (event.key === "Enter") {
                pending.save();
              } else {
                cancelDraft();
              }
            }
          });
          input.focus();
          if (caret !== null) {
            const prefix = Math.max(0, original.textContent.indexOf(entry[property]));
            const position = Math.max(0, Math.min(input.value.length, caret - prefix));
            input.setSelectionRange(position, position);
          } else {
            input.select();
          }
        }
        function beginAdd(target, phaseId, capabilityId = null, stateId = null) {
          if (draft && !draft.leave()) {
            return;
          }
          const data = context.snapshot();
          const known = data.progression.capabilities.find((item) => item.id === capabilityId);
          if (!target.isConnected) {
            const phase = [...host.querySelectorAll(".kom-progress-phase")].find(
              (item) => item.dataset.node === phaseId,
            );
            target = capabilityId
              ? targetFor({ kind: "box", phase: phaseId, id: capabilityId })
              : phase && phase.querySelector(".st-progression-insertion");
          }
          if (!target) {
            return;
          }
          context.select(null);
          markSelection();
          const form = element("form", "st-progression-inline-form");
          form.dataset.stProgressionControl = "";
          const name = element("input", "st-progression-inline-name");
          name.placeholder = "Capability name";
          name.autocomplete = "off";
          form.setAttribute(
            "aria-description",
            "Enter or Add creates this box. Escape or clicking outside cancels.",
          );
          name.value = known ? known.label : "";
          name.readOnly = Boolean(known);
          name.maxLength = 30;
          name.required = true;
          name.setAttribute("aria-label", "Capability name");
          const state = element("select", "st-progression-inline-state");
          state.setAttribute("aria-label", "State for the new capability");
          data.progression.states.forEach((item) => {
            const option = element("option", "", item.label);
            option.value = item.id;
            state.append(option);
          });
          state.value = stateId || data.progression.states[0].id;
          const submit = element("button", "st-progression-inline-submit");
          submit.type = "submit";
          submit.setAttribute("aria-label", "Add capability");
          submit.title = "Enter to add";
          submit.append(glyph());
          form.append(name, state, submit);
          // A recovered target can be a populated cell, which carries no hit.
          const hit = target.querySelector(".st-progression-hit");
          if (hit) {
            hit.hidden = true;
          }
          target.classList.add("st-progression-drafting");
          target.append(form);
          const pending = {
            leave() {
              if (draft === pending) {
                cancelDraft();
              }
              return true;
            },
            cancel() {
              if (hit) {
                hit.hidden = false;
              }
              target.classList.remove("st-progression-drafting");
              form.remove();
            },
            save(again = false) {
              if (draft !== pending) {
                return true;
              }
              const label = name.value.trim();
              if (!label) {
                cancelDraft();
                return true;
              }
              const latest = context.snapshot();
              const matches = latest.progression.capabilities.filter((item) =>
                capabilityId
                  ? item.id === capabilityId
                  : item.label.toLowerCase() === label.toLowerCase(),
              );
              if (matches.length > 1 || (matches[0] && matches[0].states[phaseId] !== null)) {
                name.setCustomValidity(
                  "That capability is already in this phase. Use an empty position to restore an existing box.",
                );
                name.reportValidity();
                return false;
              }
              if (!matches.length && latest.progression.capabilities.length >= 8) {
                context.toast("The model already has eight capabilities.", true);
                return false;
              }
              const selectedState = state.value;
              cancelDraft();
              const saved = change((next) => {
                let item = next.progression.capabilities.find(
                  (candidate) => matches[0] && candidate.id === matches[0].id,
                );
                if (!item) {
                  item = {
                    id: "capability-" + crypto.randomUUID(),
                    label,
                    states: Object.fromEntries(next.stages.map((phase) => [phase.id, null])),
                  };
                  next.progression.capabilities.push(item);
                }
                item.states[phaseId] = selectedState;
              });
              if (saved && again && context.snapshot().progression.capabilities.length < 8) {
                const phase = [...host.querySelectorAll(".kom-progress-phase")].find(
                  (item) => item.dataset.node === phaseId,
                );
                const nextTile = phase && phase.querySelector(".st-progression-insertion");
                if (nextTile) {
                  beginAdd(nextTile, phaseId, null, selectedState);
                }
              }
              return saved;
            },
          };
          draft = pending;
          name.addEventListener("input", () => name.setCustomValidity(""));
          form.addEventListener("submit", (event) => {
            event.preventDefault();
            pending.save(true);
          });
          form.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              cancelDraft();
            }
          });
          form.addEventListener("focusout", (event) => {
            if (event.relatedTarget && form.contains(event.relatedTarget)) {
              return;
            }
            queueMicrotask(() => {
              if (draft === pending && !form.contains(document.activeElement)) {
                pending.leave();
              }
            });
          });
          name.focus();
        }
        function moveBox(value, toPhase) {
          const moved = change((next) => {
            const item = next.progression.capabilities.find(
              (candidate) => candidate.id === value.id,
            );
            if (
              !item ||
              item.states[value.phase] == null ||
              !Object.hasOwn(item.states, toPhase) ||
              item.states[toPhase] !== null
            ) {
              throw new Error("Move to a phase where this capability is not already present.");
            }
            item.states[toPhase] = item.states[value.phase];
            item.states[value.phase] = null;
          });
          if (moved) {
            select({ ...value, phase: toPhase }, false);
          }
        }
        function menuAction(label, description, run, disabled = false, danger = false) {
          const action = button("", run, disabled);
          action.classList.add("st-canvas-menu-action");
          action.classList.toggle("st-canvas-danger", danger);
          action.append(element("strong", "", label), element("span", "", description));
          action.title = description;
          return action;
        }
        function menuHeading(panel, label, contextLabel) {
          panel.append(element("h4", "", label), element("p", "st-canvas-context", contextLabel));
        }
        function openMovePicker(target, value) {
          const data = context.snapshot();
          const capability = entryFor(data, value);
          const from = data.stages.find((stage) => stage.id === value.phase);
          const panel = element("div", "st-canvas-menu");
          menuHeading(
            panel,
            "Move to another phase",
            capability.label + " · currently in " + from.title,
          );
          data.stages
            .filter((stage) => stage.id !== value.phase)
            .forEach((stage) => {
              const occupied = capability.states[stage.id] !== null;
              panel.append(
                menuAction(
                  stage.title,
                  occupied
                    ? "Already contains this capability"
                    : "Move here and keep the current state",
                  () => moveBox(value, stage.id),
                  occupied,
                ),
              );
            });
          const back = button("Back to capability actions", () => openActions(target, value));
          back.classList.add("st-canvas-menu-back");
          panel.append(back);
          showPopover(targetFor(value) || target, panel, "Move capability to another phase");
        }
        function openActions(target, value) {
          const data = context.snapshot();
          const capability = entryFor(data, value);
          if (!capability || capability.states[value.phase] == null) {
            return;
          }
          const phase = data.stages.find((stage) => stage.id === value.phase);
          const current = data.progression.states.find(
            (state) => state.id === capability.states[value.phase],
          );
          const destinations = data.stages.filter(
            (stage) => stage.id !== value.phase && capability.states[stage.id] === null,
          );
          const panel = element("div", "st-canvas-menu");
          menuHeading(panel, capability.label, "In " + phase.title);
          panel.append(
            menuAction("Change state", "Currently " + current.label + " in this phase", () =>
              openStatePicker(target, value),
            ),
            menuAction(
              "Move to another phase",
              destinations.length
                ? "Keep the state and leave an empty position here"
                : "Already present in every other phase",
              () => openMovePicker(target, value),
              !destinations.length,
            ),
            menuAction(
              "Remove from this phase",
              "Other phases keep this capability. Undo restores it.",
              () =>
                change((next) => {
                  entryFor(next, value).states[value.phase] = null;
                  pruneCapabilities(next);
                }),
              false,
              true,
            ),
          );
          showPopover(target, panel, "Actions for " + capability.label);
        }
        function pruneCapabilities(next) {
          next.progression.capabilities = next.progression.capabilities.filter((item) =>
            Object.values(item.states).some((value) => value !== null),
          );
        }
        function removePhase(id) {
          change((next) => {
            if (next.stages.length <= 2) {
              throw new Error("Keep at least two phases.");
            }
            const previous = next.stages.map((stage) => stage.id);
            next.stages = next.stages.filter((stage) => stage.id !== id);
            next.progression.capabilities.forEach((item) => delete item.states[id]);
            pruneCapabilities(next);
            next.progression.horizons = (next.progression.horizons || []).flatMap((group) => {
              const members = previous
                .slice(previous.indexOf(group.from), previous.indexOf(group.to) + 1)
                .filter((phase) => phase !== id);
              return members.length ? [{ ...group, from: members[0], to: members.at(-1) }] : [];
            });
          });
        }
        function clearDropTargets() {
          host
            .querySelectorAll(
              ".st-progression-drop-target,.st-progression-drop-blocked,.st-progression-drop-slot",
            )
            .forEach((node) =>
              node.classList.remove(
                "st-progression-drop-target",
                "st-progression-drop-blocked",
                "st-progression-drop-slot",
              ),
            );
        }
        function cancelDrag() {
          const previous = drag;
          drag = null;
          if (previous) {
            if (previous.frame) {
              cancelAnimationFrame(previous.frame);
            }
            if (host.hasPointerCapture(previous.pointerId)) {
              host.releasePointerCapture(previous.pointerId);
            }
            Object.entries(previous.styles).forEach(([name, property]) => {
              if (property.value) {
                previous.cell.style.setProperty(name, property.value, property.priority);
              } else {
                previous.cell.style.removeProperty(name);
              }
            });
            previous.cell.classList.remove("st-progression-drag-source");
          }
          clearDropTargets();
          host.classList.remove("st-progression-dragging", "st-progression-drop-invalid");
          const status = host.querySelector(".st-progression-drag-status");
          if (status) {
            status.textContent = "";
          }
        }
        function updateDrop(current) {
          const hit = document.elementFromPoint(current.x, current.y);
          const phase = hit && hit.closest(".kom-progress-phase");
          const id = phase && host.contains(phase) ? phase.dataset.node : null;
          const capability = entryFor(current.before, current.value);
          const allowed = id && id !== current.value.phase && capability.states[id] === null;
          const blocked = id && id !== current.value.phase && !allowed;
          current.toPhase = id;
          current.allowed = Boolean(allowed);
          if (id === current.lastTarget) {
            return;
          }
          current.lastTarget = id;
          clearDropTargets();
          host.classList.toggle("st-progression-drop-invalid", Boolean(blocked));
          const status = host.querySelector(".st-progression-drag-status");
          if (phase && (allowed || blocked)) {
            phase.classList.add(
              allowed ? "st-progression-drop-target" : "st-progression-drop-blocked",
            );
            const slot = [...phase.querySelectorAll("[data-capability]")].find(
              (node) => node.dataset.capability === current.value.id,
            );
            if (slot) {
              slot.classList.add("st-progression-drop-slot");
            }
          }
          if (status) {
            const target = current.before.stages.find((stage) => stage.id === id);
            status.textContent = allowed
              ? "Move to " + target.title
              : blocked
                ? target.title + " already contains this capability"
                : "Drop into another phase";
          }
        }
        function dragFrame() {
          if (!drag || !drag.moved) {
            return;
          }
          const current = drag;
          const viewport = current.viewport;
          const bounds = viewport.getBoundingClientRect();
          const direction =
            current.y >= bounds.top && current.y <= bounds.bottom
              ? current.x > bounds.right - 36
                ? 1
                : current.x < bounds.left + 36
                  ? -1
                  : 0
              : 0;
          viewport.scrollLeft = Math.max(
            0,
            Math.min(current.maxScroll, viewport.scrollLeft + direction * 12),
          );
          const dx =
            (current.x - current.startX) / current.scaleX +
            viewport.scrollLeft -
            current.scrollLeft;
          const dy =
            (current.y - current.startY + window.scrollY - current.scrollY) / current.scaleY;
          current.cell.style.transform = `translate(${dx}px, ${dy}px)`;
          updateDrop(current);
          current.frame = requestAnimationFrame(dragFrame);
        }
        function activateText(node, point = null) {
          const entry = textTargets.get(node);
          if (!entry) {
            return false;
          }
          if (entry.state) {
            openStatePicker(entry.target, entry.value);
          } else {
            beginText(entry.target, entry.value, point);
          }
          return true;
        }
        function pointerDown(event) {
          suppressClickUntil = 0;
          if (
            event.button !== 0 ||
            drag ||
            event.target.closest(
              "input,select,textarea,.st-progression-context,.st-progression-inline-form",
            )
          ) {
            return;
          }
          const text = event.target.closest(".st-progression-text,.st-progression-state-label");
          if (text && textTargets.has(text)) {
            event.preventDefault();
            event.stopPropagation();
            activateText(text, { x: event.clientX, y: event.clientY });
            suppressClickUntil = performance.now() + 180;
            return;
          }
          let cell = event.target.closest(".kom-progress-cell[data-capability]");
          if (!cell || !host.contains(cell)) {
            return;
          }
          const value = {
            kind: "box",
            phase: cell.closest(".kom-progress-phase").dataset.node,
            id: cell.dataset.capability,
          };
          if (draft && !draft.leave()) {
            event.preventDefault();
            return;
          }
          cell = targetFor(value) || cell;
          if (!cell.isConnected) {
            return;
          }
          closePopover();
          const bounds = cell.getBoundingClientRect();
          const viewport = host.querySelector(".kom-progression");
          event.preventDefault();
          event.stopPropagation();
          drag = {
            cell,
            viewport,
            pointerId: event.pointerId,
            moved: false,
            startX: event.clientX,
            startY: event.clientY,
            x: event.clientX,
            y: event.clientY,
            scaleX: bounds.width / cell.offsetWidth,
            scaleY: bounds.height / cell.offsetHeight,
            scrollLeft: viewport.scrollLeft,
            scrollY: window.scrollY,
            maxScroll: Math.max(0, viewport.scrollWidth - viewport.clientWidth),
            value,
            before: context.snapshot(),
            styles: Object.fromEntries(
              ["transform", "z-index", "pointer-events"].map((name) => [
                name,
                {
                  value: cell.style.getPropertyValue(name),
                  priority: cell.style.getPropertyPriority(name),
                },
              ]),
            ),
          };
          host.setPointerCapture(event.pointerId);
        }
        function pointerMove(event) {
          if (!drag || event.pointerId !== drag.pointerId) {
            return;
          }
          drag.x = event.clientX;
          drag.y = event.clientY;
          if (!drag.moved && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 5) {
            return;
          }
          event.preventDefault();
          if (!drag.moved) {
            drag.moved = true;
            context.select(null);
            markSelection();
            host.classList.add("st-progression-dragging");
            drag.cell.classList.add("st-progression-drag-source");
            drag.cell.style.pointerEvents = "none";
            drag.cell.style.zIndex = "20";
            drag.frame = requestAnimationFrame(dragFrame);
          }
        }
        function pointerUp(event) {
          if (!drag || event.pointerId !== drag.pointerId) {
            return;
          }
          const finished = drag;
          finished.x = event.clientX;
          finished.y = event.clientY;
          if (finished.moved) {
            updateDrop(finished);
          }
          cancelDrag();
          suppressClickUntil = performance.now() + 180;
          event.preventDefault();
          event.stopPropagation();
          if (!finished.moved) {
            select(finished.value);
          } else if (finished.allowed) {
            moveBox(finished.value, finished.toPhase);
          } else if (finished.toPhase && finished.toPhase !== finished.value.phase) {
            context.toast(
              "That phase already contains this capability. Nothing was replaced.",
              true,
            );
          }
        }
        function clearDecoration() {
          cancelDraft();
          closePopover();
          cancelDrag();
          textTargets.forEach((entry, node) => {
            Object.entries(entry.attributes).forEach(([name, value]) => {
              if (value === null) {
                node.removeAttribute(name);
              } else {
                node.setAttribute(name, value);
              }
            });
            node.classList.remove("st-progression-text", "st-progression-state-label");
          });
          textTargets.clear();
          if (rowGrid) {
            if (rowCount) {
              rowGrid.style.setProperty("--kom-progress-rows", rowCount);
            } else {
              rowGrid.style.removeProperty("--kom-progress-rows");
            }
            rowGrid = null;
          }
          host.querySelectorAll("[data-st-progression-control]").forEach((node) => node.remove());
          targets.forEach((_value, target) =>
            target.classList.remove("st-progression-target", "st-progression-selected"),
          );
          targets.clear();
        }
        function refresh() {
          if (disposed) {
            return;
          }
          clearDecoration();
          host.classList.add("st-progression-editing");
          const data = context.snapshot();
          rowGrid = host.querySelector(".kom-progress-phases");
          rowCount = rowGrid.style.getPropertyValue("--kom-progress-rows");
          rowGrid.style.setProperty(
            "--kom-progress-rows",
            String(data.progression.capabilities.length + 2),
          );
          const sample = rowGrid.querySelector(".kom-progress-cell");
          const tileHeight = sample ? Math.max(60, sample.offsetHeight) : 60;
          host.querySelectorAll(".kom-progress-phase").forEach((phase) => {
            const id = phase.dataset.node;
            const stage = data.stages.find((item) => item.id === id);
            const heading = phase.querySelector(".kom-progress-heading");
            editable(heading, { kind: "phase", id }, "Edit phase: " + stage.title);
            heading.append(
              settingsControl(
                "Phase settings",
                stage.body ? "Owner, cadence, remove" : "Add description, owner, cadence",
                () => openSettings({ kind: "phase", id }, heading),
              ),
            );
            phase.querySelectorAll(".kom-progress-cell,.kom-progress-empty").forEach((cell) => {
              const capability = data.progression.capabilities.find(
                (item) => item.id === cell.dataset.capability,
              );
              const absent = capability.states[id] === null;
              editable(
                cell,
                { kind: "box", phase: id, id: capability.id },
                (absent ? "Add " : "Edit ") + capability.label + " in " + stage.title,
                absent,
                "Add " + capability.label,
              );
            });
            const insertion = element(
              "div",
              "kom-progress-empty st-progression-target st-progression-insertion",
            );
            insertion.dataset.stProgressionControl = "";
            insertion.style.minHeight = tileHeight + "px";
            const limit = data.progression.capabilities.length >= 8;
            const add = control(
              "Add capability to " + stage.title,
              "st-progression-hit",
              () => beginAdd(insertion, id),
              limit,
            );
            add.classList.add("st-progression-gap");
            add.append(
              glyph(),
              element("span", "", limit ? "Eight-capability limit" : "Add capability"),
            );
            insertion.append(add);
            phase.append(insertion);
          });
          host.querySelectorAll(".kom-progress-horizon").forEach((band) => {
            const index = Number(band.dataset.horizon);
            editable(
              band,
              { kind: "group", index },
              "Edit delivery group: " + data.progression.horizons[index].label,
            );
            band.append(
              settingsControl("Adjust group", "Change which phases it spans", () =>
                openSettings({ kind: "group", index }, band),
              ),
            );
          });
          host.querySelectorAll(".kom-progress-state").forEach((item) => {
            const state = data.progression.states.find((entry) => entry.id === item.dataset.state);
            editable(item, { kind: "state", id: state.id }, "Edit state label: " + state.label);
            const color = element("input", "st-progression-color");
            color.dataset.stProgressionControl = "";
            color.type = "color";
            const current =
              state.color || getComputedStyle(item).getPropertyValue("--kom-status").trim();
            color.value = /^#[0-9a-f]{6}$/i.test(current) ? current : "#666666";
            color.setAttribute("aria-label", "Change colour for " + state.label);
            color.title = "Change " + state.label + " colour";
            color.addEventListener("change", () =>
              change((next) => {
                next.progression.states.find((entry) => entry.id === state.id).color = color.value;
              }),
            );
            item.append(color);
          });
          const strip = element("div", "st-progression-strip");
          strip.dataset.stProgressionControl = "";
          strip.append(element("span", "st-progression-editing-label", "Editing canvas"));
          const status = element("span", "st-progression-drag-status");
          status.setAttribute("role", "status");
          strip.append(status);
          const actions = element("div", "st-progression-insert");
          const addPhase = addControl(
            "Phase",
            () => openSettings({ kind: "phase" }, addPhase),
            data.stages.length >= 5,
          );
          addPhase.title = data.stages.length >= 5 ? "Five-phase limit reached" : "Insert a phase";
          const addGroup = addControl(
            "Delivery group",
            () => openSettings({ kind: "group" }, addGroup),
            (data.progression.horizons || []).length >= 4,
          );
          actions.append(addPhase, addGroup);
          strip.append(actions);
          host.querySelector(".kom-progression").prepend(strip);
          markSelection();
        }
        function buildSettings(selected) {
          if (!selected) {
            return null;
          }
          const data = context.snapshot();
          const form = element("form", "st-progression-form");
          const heading = element("h4", "");
          form.append(heading);
          function field(label, value, max, required = false, multiline = false, hint = "") {
            const wrap = element("label", "st-progression-field");
            const input = element(multiline ? "textarea" : "input", "");
            input.value = value || "";
            input.maxLength = max;
            input.required = required;
            input.placeholder = hint;
            input.autocomplete = "off";
            wrap.append(element("span", "", label), input);
            form.append(wrap);
            return input;
          }
          function choice(label, options, value) {
            const wrap = element("label", "st-progression-field");
            const input = element("select", "");
            options.forEach(([id, name]) => {
              const option = element("option", "", name);
              option.value = id;
              input.append(option);
            });
            input.value = value;
            wrap.append(element("span", "", label), input);
            form.append(wrap);
            return input;
          }
          let apply;
          let removal = null;
          if (selected.kind === "phase") {
            const phase = data.stages.find((item) => item.id === selected.id);
            if (selected.id && !phase) {
              return null;
            }
            heading.textContent = phase ? phase.title : "Add phase";
            form.append(
              element(
                "p",
                "st-canvas-context",
                phase
                  ? "Phase name, ownership and cadence"
                  : "Choose where this phase belongs and who owns it",
              ),
            );
            if (phase) {
              removal = {
                label: "Remove phase",
                help:
                  data.stages.length <= 2
                    ? "Keep at least two phases in the model."
                    : "Removes this phase and its boxes. Undo restores them.",
                disabled: data.stages.length <= 2,
                run: () => removePhase(phase.id),
              };
            }
            const title = field(
              "Phase name",
              phase && phase.title,
              32,
              true,
              false,
              "e.g. Prepare the launch",
            );
            const owner = field(
              "Accountable owner",
              phase && phase.owner,
              32,
              true,
              false,
              "Role or team, e.g. Launch lead",
            );
            const body = field(
              "Phase description",
              phase && phase.body,
              140,
              false,
              true,
              "What this phase is for, in one sentence",
            );
            const cadence = field(
              "Cadence",
              phase && phase.cadence,
              32,
              false,
              false,
              "How often it runs, e.g. Weekly review",
            );
            const after =
              !phase &&
              choice(
                "Insert after",
                [
                  ["", "Before the first phase"],
                  ...data.stages.map((item) => [item.id, item.title]),
                ],
                data.stages.at(-1).id,
              );
            apply = (next) => {
              const values = {
                title: title.value.trim(),
                owner: owner.value.trim(),
                body: body.value.trim(),
                cadence: cadence.value.trim(),
              };
              if (phase) {
                Object.assign(
                  next.stages.find((item) => item.id === phase.id),
                  values,
                );
              } else {
                const id = "phase-" + crypto.randomUUID();
                next.stages.splice(
                  next.stages.findIndex((item) => item.id === after.value) + 1,
                  0,
                  { id, ...values },
                );
                next.progression.capabilities.forEach((item) => {
                  item.states[id] = null;
                });
              }
            };
          } else if (selected.kind === "box") {
            const phase = data.stages.find((item) => item.id === selected.phase);
            const capability = data.progression.capabilities.find(
              (item) => item.id === selected.id,
            );
            if (!phase || (selected.id && !capability)) {
              return null;
            }
            heading.textContent = capability ? "Capability settings" : "New capability";
            form.append(element("p", "st-progression-form-context", phase.title));
            if (capability && capability.states[phase.id] !== null) {
              removal = {
                label: "Remove from this phase",
                help: "Keeps this capability in the other phases.",
                run: () =>
                  change((next) => {
                    next.progression.capabilities.find((item) => item.id === capability.id).states[
                      phase.id
                    ] = null;
                    pruneCapabilities(next);
                  }),
              };
            }
            const absent = data.progression.capabilities.filter(
              (item) => item.states[phase.id] === null,
            );
            const options = [
              ...(data.progression.capabilities.length < 8 ? [["", "New capability"]] : []),
              ...absent.map((item) => [item.id, item.label]),
            ];
            if (!capability && !options.length) {
              return null;
            }
            const existing = !capability && choice("Capability", options, options[0][0]);
            const label = field(
              capability ? "Capability name, all phases" : "New capability name",
              capability && capability.label,
              30,
              true,
              false,
              "e.g. Support model",
            );
            if (existing) {
              const sync = () => {
                label.disabled = Boolean(existing.value);
                label.required = !existing.value;
              };
              existing.addEventListener("change", sync);
              sync();
            }
            const value = capability && capability.states[phase.id];
            const state = choice(
              "State in this phase",
              data.progression.states.map((item) => [item.id, item.label]),
              value || data.progression.states[0].id,
            );
            apply = (next) => {
              let item = next.progression.capabilities.find(
                (entry) => entry.id === (selected.id || existing.value),
              );
              if (!item) {
                item = {
                  id: "capability-" + crypto.randomUUID(),
                  label: label.value.trim(),
                  states: Object.fromEntries(next.stages.map((stage) => [stage.id, null])),
                };
                next.progression.capabilities.push(item);
              } else if (capability) {
                item.label = label.value.trim();
              }
              item.states[phase.id] = state.value;
            };
          } else if (selected.kind === "group") {
            const group = (data.progression.horizons || [])[selected.index];
            heading.textContent = group ? group.label : "Add delivery group";
            form.append(
              element(
                "p",
                "st-canvas-context",
                "Accountable owner and the phases this group covers",
              ),
            );
            if (group) {
              removal = {
                label: "Remove delivery group",
                help: "Its phases and capabilities stay in place.",
                run: () => change((next) => next.progression.horizons.splice(selected.index, 1)),
              };
            }
            const label = field(
              "Group name",
              group && group.label,
              40,
              true,
              false,
              "e.g. Rollout and learning",
            );
            const owner = field(
              "Accountable owner",
              group && group.owner,
              32,
              true,
              false,
              "Role or team, e.g. Program lead",
            );
            const phases = data.stages.map((stage) => [stage.id, stage.title]);
            const from = choice("First phase", phases, group ? group.from : data.stages[0].id);
            const to = choice("Last phase", phases, group ? group.to : data.stages.at(-1).id);
            apply = (next) => {
              const values = {
                label: label.value.trim(),
                owner: owner.value.trim(),
                from: from.value,
                to: to.value,
              };
              next.progression.horizons = next.progression.horizons || [];
              if (group) {
                next.progression.horizons[selected.index] = values;
              } else {
                next.progression.horizons.push(values);
              }
            };
          } else if (selected.kind === "state") {
            const state = data.progression.states.find((item) => item.id === selected.id);
            if (!state) {
              return null;
            }
            heading.textContent = "Edit state label";
            const label = field("Label, all phases", state.label, 24, true);
            apply = (next) => {
              next.progression.states.find((item) => item.id === state.id).label =
                label.value.trim();
            };
          } else {
            return null;
          }
          const save = element("button", "st-progression-apply", "Apply changes");
          save.type = "submit";
          const actions = element("div", "st-progression-form-actions");
          actions.append(
            save,
            button("Cancel", () => dismissPopover(true)),
          );
          form.append(actions);
          if (removal) {
            const remove = button(removal.label, removal.run, removal.disabled);
            remove.classList.add("st-progression-remove", "st-canvas-danger");
            remove.title = removal.help;
            const danger = element("div", "st-progression-remove-area");
            danger.append(remove, element("p", "", removal.help));
            form.append(danger);
          }
          form.addEventListener("submit", (event) => {
            event.preventDefault();
            if (form.reportValidity()) {
              change(apply);
            }
          });
          return form;
        }
        host.addEventListener("pointerdown", pointerDown, {
          capture: true,
          signal: listeners.signal,
        });
        host.addEventListener("pointermove", pointerMove, {
          passive: false,
          signal: listeners.signal,
        });
        host.addEventListener("pointerup", pointerUp, { signal: listeners.signal });
        host.addEventListener("pointercancel", cancelDrag, { signal: listeners.signal });
        host.addEventListener("lostpointercapture", cancelDrag, { signal: listeners.signal });
        host.addEventListener(
          "click",
          (event) => {
            if (event.detail > 0 && performance.now() < suppressClickUntil) {
              suppressClickUntil = 0;
              event.preventDefault();
              event.stopImmediatePropagation();
              return;
            }
            if (
              event.target.closest(
                "input,select,textarea,button,.st-progression-context,.st-progression-inline-form",
              )
            ) {
              return;
            }
            const text = event.target.closest(".st-progression-text,.st-progression-state-label");
            if (text && activateText(text)) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            const target = event.target.closest(".st-progression-target");
            if (target && targets.has(target)) {
              select(targets.get(target));
            }
          },
          { capture: true, signal: listeners.signal },
        );
        host.addEventListener(
          "keydown",
          (event) => {
            const text = event.target.closest(".st-progression-text,.st-progression-state-label");
            if (text && ["Enter", " ", "F2"].includes(event.key)) {
              event.preventDefault();
              event.stopPropagation();
              activateText(text);
            }
          },
          { capture: true, signal: listeners.signal },
        );
        window.addEventListener(
          "pointerdown",
          (event) => {
            if (
              popover &&
              !popover.node.contains(event.target) &&
              !popover.anchor.contains(event.target)
            ) {
              closePopover();
            }
          },
          { capture: true, signal: listeners.signal },
        );
        window.addEventListener(
          "keydown",
          (event) => {
            if (popover && event.key === "Escape") {
              event.preventDefault();
              event.stopImmediatePropagation();
              dismissPopover(true);
            }
          },
          { capture: true, signal: listeners.signal },
        );
        window.addEventListener("scroll", positionPopover, {
          capture: true,
          passive: true,
          signal: listeners.signal,
        });
        window.addEventListener(
          "resize",
          () => {
            cancelDrag();
            positionPopover();
          },
          { signal: listeners.signal },
        );
        return {
          refresh,
          renderInspector: () => null,
          dispose() {
            if (disposed) {
              return;
            }
            disposed = true;
            listeners.abort();
            clearDecoration();
            host.classList.remove("st-progression-editing");
          },
        };
      },
    };
  });
})();
