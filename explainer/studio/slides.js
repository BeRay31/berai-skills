/* Studio slide actions. Authored component slides save directly to the local
   manifest; section slides and older review-only previews keep their agent
   handoff path. */
(function () {
  "use strict";
  function createSlideAuthoring(api) {
    const { root, store, sections, select, refresh, addSection, titleOf, toast } = api;
    const kit = globalThis.ExplainerKit;
    let undo = null;
    let closeMenu = null;
    const removed = new Map();
    function releasePreview(host) {
      if (globalThis.ExplainerAuthoring && globalThis.ExplainerAuthoring.releaseComponent) {
        globalThis.ExplainerAuthoring.releaseComponent(host);
      } else if (typeof host.__kitDispose === "function") {
        host.__kitDispose();
      }
    }
    function node(tag, className, text) {
      const result = document.createElement(tag);
      result.className = className || "";
      if (text) {
        result.textContent = text;
      }
      return result;
    }
    function button(label, run, className = "st-send") {
      const result = node("button", className, label);
      result.type = "button";
      result.addEventListener("click", run);
      return result;
    }
    function dialog(title, anchor) {
      const box = node("dialog", "st-describe-dialog st-slide-dialog");
      box.setAttribute("aria-label", title);
      const head = node("div", "st-pick-head");
      head.append(node("h2", "", title));
      const close = button("✕", () => box.close(), "st-close");
      close.setAttribute("aria-label", "Close");
      head.append(close);
      box.append(head);
      box.addEventListener("close", () => {
        box.querySelectorAll(".artifact").forEach(releasePreview);
        box.remove();
        if (anchor && anchor.isConnected) {
          anchor.focus();
        }
      });
      root.append(box);
      box.showModal();
      return box;
    }
    function byId(id) {
      return document.querySelector("#" + CSS.escape(id));
    }
    // Authored slides are real manifest records, not review drafts. Keeping
    // this small bridge here lets the existing picker continue to serve
    // section slides and older, agent-applied previews without conflating the
    // two persistence paths.
    function authoredSession() {
      const session = api.authoringSession || null;
      return session && (!session.writable || session.writable()) ? session : null;
    }
    function authoredId() {
      // authoring.py accepts plain identifiers: start with a letter, then
      // letters, digits, hyphens, or underscores. Date + random avoids a
      // collision when users insert quickly in the same millisecond.
      return "slide-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
    }
    function beforeId(section) {
      if (!section) {
        return "";
      }
      // authoring.py rejects a `before` that is not a plain identifier. A
      // source section whose ID breaks that rule is not a usable anchor, so it
      // has to fail here rather than after the slide is inserted and edited.
      const authoring = globalThis.ExplainerStudioAuthoring;
      const id = section.id || "";
      return authoring && authoring.validId(id) ? id : "";
    }
    function refreshAuthored(id) {
      const session = authoredSession();
      if (!session || !globalThis.ExplainerAuthoring || !globalThis.ExplainerAuthoring.apply) {
        return;
      }
      globalThis.ExplainerAuthoring.apply(session.previewManifest());
      refresh();
      const section = globalThis.ExplainerAuthoring.findSlide
        ? globalThis.ExplainerAuthoring.findSlide(id)
        : byId("ea-slide-" + id);
      if (section) {
        select(section);
      }
    }
    function addAuthored(target, entry) {
      const session = authoredSession();
      const samples = kit && kit.studioSamples;
      if (!session || !samples || typeof samples.describe !== "function") {
        return false;
      }
      let component;
      try {
        component = samples.describe(entry.key);
      } catch (error) {
        toast("This visual cannot be inserted locally.", true);
        console.error("Could not describe Studio sample", entry.key, error);
        return false;
      }
      const targetSlideId = target.dataset && target.dataset.authoringSlide;
      const targetSlide = targetSlideId && session.slide ? session.slide(targetSlideId) : null;
      const before = targetSlide ? targetSlide.before : beforeId(target);
      if (!before || typeof session.addSlide !== "function") {
        toast("This explainer has no writable slide target.", true);
        return false;
      }
      const record = {
        id: authoredId(),
        before,
        title: entry.label || "New slide",
        component,
      };
      session.addSlide(record, targetSlideId || "");
      refreshAuthored(record.id);
      toast("Slide added locally — edit it here, then save when ready.");
      return true;
    }
    function duplicateAuthored(section) {
      const session = authoredSession();
      const id = section && section.dataset ? section.dataset.authoringSlide : "";
      if (!session || !id || typeof session.duplicateSlide !== "function") {
        toast("Only Studio-created slides can be duplicated locally right now.", true);
        return false;
      }
      const duplicateId = authoredId();
      if (!session.duplicateSlide(id, { id: duplicateId })) {
        toast("Could not duplicate this slide.", true);
        return false;
      }
      refreshAuthored(duplicateId);
      toast("Slide duplicated locally.");
      return true;
    }
    function duplicate(section) {
      if (section && section.dataset && section.dataset.authoringSlide) {
        return duplicateAuthored(section);
      }
      const session = authoredSession();
      const capture = globalThis.ExplainerComponentCapture;
      if (!session || !capture || typeof capture.get !== "function") {
        toast("Only Studio-created slides can be duplicated locally right now.", true);
        return false;
      }
      const captured = [...section.querySelectorAll(".artifact")]
        .map((host) => ({ host, component: capture.get(host) }))
        .filter((entry) => entry.component);
      if (captured.length !== 1 || typeof session.addSlide !== "function") {
        toast(
          captured.length > 1
            ? "This slide has more than one visual, so Studio cannot safely duplicate it yet."
            : "Studio did not capture a duplicable visual for this slide.",
          true,
        );
        return false;
      }
      const order = sections();
      const following = order.slice(order.indexOf(section) + 1);
      const nextSource = following.find(
        (candidate) => !(candidate.dataset && candidate.dataset.authoringSlide),
      );
      const nextAuthored = following.find(
        (candidate) => candidate.dataset && candidate.dataset.authoringSlide,
      );
      // A missing target means append by design. It gives the last source
      // slide a stable, explicit place without inventing a source node.
      const before = nextSource ? beforeId(nextSource) : "studio-after-last";
      if (!before) {
        toast("This explainer has no writable slide target.", true);
        return false;
      }
      const record = {
        id: authoredId(),
        before,
        title: titleOf(section) + " copy",
        component: captured[0].component,
      };
      session.addSlide(record, nextAuthored ? nextAuthored.dataset.authoringSlide : "");
      refreshAuthored(record.id);
      toast(
        "New slide created from the captured visual. Review its text and decorations before saving.",
        true,
      );
      return true;
    }
    function insert(record) {
      if (record.variant !== store.label) {
        return false;
      }
      if (record.action === "remove") {
        const section = byId(record.target);
        if (
          !section ||
          removed.has(record.id) ||
          (window.__present && !window.__present.setSectionHidden)
        ) {
          return false;
        }
        if (window.__present) {
          window.__present.setSectionHidden(section, true);
        }
        section.hidden = true;
        section.dataset.stRemoved = "true";
        removed.set(record.id, section);
        return true;
      }
      if (byId(record.id)) {
        return false;
      }
      const target = byId(record.target) || sections().at(-1);
      if (!target) {
        return false;
      }
      const wrapper = node("section", "st-draft-slide");
      wrapper.id = record.id;
      wrapper.dataset.stSlidePreview = record.id;
      const heading = node("h2", "st-draft-title", record.title);
      heading.id = record.id + "-title";
      const hint = node(
        "p",
        "st-draft-hint",
        "Sample content · Finish sends your brief to the agent",
      );
      const host = node("div", "artifact");
      host.id = record.id + "-host";
      hint.id = record.id + "-hint";
      wrapper.append(heading, hint, host);
      target.before(wrapper);
      // A sample that no longer renders must not stop restore() before the
      // remaining records and the removal pass.
      let driver = null;
      try {
        driver = kit.studioSamples.render(host, record.visual);
      } catch (error) {
        hint.textContent = "This sample could not load. Choose another visual for this slide.";
        console.error("Slide preview failed", record.visual, error);
      }
      wrapper._presentToken =
        window.__present &&
        window.__present.insertPreviewBefore(
          {
            pick: ["#" + heading.id, "#" + hint.id, "#" + host.id],
            layout: "diagram",
            steps: driver && typeof driver.go === "function" ? driver : undefined,
          },
          target,
        );
      return true;
    }
    function discard(id) {
      const original = removed.get(id);
      if (original) {
        original.hidden = false;
        delete original.dataset.stRemoved;
        if (window.__present) {
          window.__present.setSectionHidden(original, false);
        }
        removed.delete(id);
      } else {
        const wrapper = byId(id);
        if (wrapper) {
          if (window.__present) {
            window.__present.removePreview(wrapper._presentToken);
          }
          wrapper.querySelectorAll(".artifact").forEach(releasePreview);
          wrapper.remove();
        }
      }
      refresh();
      select(original || sections()[0]);
      return true;
    }
    function remove(section) {
      if (
        !section ||
        !sections().includes(section) ||
        sections().length < 2 ||
        document.body.classList.contains("presenting")
      ) {
        return;
      }
      const order = sections().map((item) => item.id);
      const session = authoredSession();
      const slideId = section.dataset && section.dataset.authoringSlide;
      if (session && slideId && typeof session.removeSlide === "function") {
        const before = session.manifest();
        const edits = store.slideEdits(section.id);
        const next = sections()[sections().indexOf(section) + 1] || sections()[0];
        const nextId = next && next.id;
        session.removeSlide(slideId);
        store.discardSlideEdits(section.id);
        refreshAuthored("");
        undo = () => {
          session.replace(before);
          store.restoreSlideEdits(edits);
          refreshAuthored(slideId);
        };
        const refreshedNext = nextId && byId(nextId);
        if (refreshedNext) {
          select(refreshedNext);
        }
        toast("Slide deleted locally. Use Undo above the slide list to restore it.", true);
        return;
      }
      if (session && !slideId && typeof session.removeSourceSlide === "function") {
        const sourceId = section.id;
        const before = session.manifest();
        const edits = store.slideEdits(sourceId);
        const next = sections()[sections().indexOf(section) + 1] || sections()[0];
        if (!session.removeSourceSlide(sourceId)) {
          toast("This source slide is already hidden.", true);
          return;
        }
        store.discardSlideEdits(sourceId);
        refreshAuthored("");
        undo = () => {
          session.replace(before);
          store.restoreSlideEdits(edits);
          refreshAuthored("");
          const restored = byId(sourceId);
          if (restored) {
            select(restored);
          }
        };
        const refreshedNext = next && next.isConnected ? next : sections().at(-1);
        if (refreshedNext) {
          select(refreshedNext);
        }
        toast("Slide deleted locally. Use Undo above the slide list to restore it.", true);
        return;
      }
      const neighbors = { sections: store.sections(), slides: store.slides() };
      const edits = store.slideEdits(section.id);
      const sectionRecord = store.section(section.id);
      const slideRecord = store.slide(section.id);
      const next = sections()[sections().indexOf(section) + 1];
      if (sectionRecord || slideRecord) {
        const record = sectionRecord || slideRecord;
        if (sectionRecord) {
          store.removeSection(record.id);
          window.__studioDiscardSection(record.id);
        } else {
          store.removeSlide(record.id);
          discard(record.id);
        }
        undo = () => {
          if (sectionRecord) {
            addSection(record);
            store.addSection(record, order);
          } else {
            insert(record);
            store.addSlide(record, order);
          }
          store.restoreSlideEdits(edits);
          neighbors.sections.forEach((item) =>
            store.updateSection(item.id, { target: item.target }),
          );
          neighbors.slides.forEach((item) => store.updateSlide(item.id, { target: item.target }));
          api.applyOrder(order);
          select(byId(record.id));
          api.restoreEdits(record.id);
        };
      } else {
        const record = {
          id: "st-slide-" + store.label.toLowerCase() + "-" + Date.now().toString(36),
          action: "remove",
          target: section.id,
          title: titleOf(section),
          variant: store.label,
          created: new Date().toISOString(),
        };
        if (!insert(record)) {
          toast("Rebuild this older explainer to enable slide removal in presentation.", true);
          return;
        }
        store.addSlide(
          record,
          sections().map((item) => item.id),
        );
        undo = () => {
          store.removeSlide(record.id);
          discard(record.id);
          api.applyOrder(order);
          store.setOrder(order);
          select(section);
        };
      }
      refresh();
      select(next && next.isConnected && !next.hidden ? next : sections().at(-1));
      api.focusSelected();
      toast("Slide deleted from preview. Use Undo above the slide list to restore it.", true);
    }
    function undoRemoval() {
      if (!undo || document.body.classList.contains("presenting")) {
        return;
      }
      const restore = undo;
      undo = null;
      restore();
      refresh();
      api.focusSelected();
      toast("Slide restored", 1800);
    }
    function contextMenu(section, anchor, point) {
      if (document.body.classList.contains("presenting")) {
        return;
      }
      if (closeMenu) {
        closeMenu();
      }
      const menu = node("div", "st-slide-menu");
      // Use a manual popover so the browser's auto light-dismiss does not
      // close the menu during the same right-click that opened it.
      menu.setAttribute("popover", "manual");
      menu.setAttribute("role", "menu");
      menu.setAttribute("aria-label", "Actions for " + titleOf(section));
      let closed = false;
      function close() {
        if (closed) {
          return;
        }
        closed = true;
        if (closeMenu === close) {
          closeMenu = null;
        }
        document.removeEventListener("pointerdown", outside, true);
        document.removeEventListener("keydown", escape, true);
        if (menu.matches(":popover-open")) {
          menu.hidePopover();
        }
        menu.remove();
        if (anchor.isConnected) {
          anchor.focus();
        }
      }
      function outside(event) {
        if (!menu.contains(event.target)) {
          close();
        }
      }
      function escape(event) {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
      }
      menu.append(node("p", "st-slide-menu-title", titleOf(section)));
      function item(label, action, disabled = false) {
        const control = button(
          label,
          () => {
            close();
            action();
          },
          "st-slide-menu-item",
        );
        control.setAttribute("role", "menuitem");
        control.disabled = disabled;
        menu.append(control);
        return control;
      }
      const order = sections();
      const index = order.indexOf(section);
      item("Move up", () => api.move(section, order[index - 1], false), index < 1);
      item(
        "Move down",
        () => api.move(section, order[index + 1], true),
        index === order.length - 1,
      );
      const localAuthored = Boolean(section.dataset && section.dataset.authoringSlide);
      const deletion = item(
        localAuthored ? "Delete slide" : "Delete from preview",
        () => remove(section),
        order.length < 2,
      );
      deletion.title =
        order.length < 2
          ? "Keep at least one slide in your story"
          : localAuthored
            ? "Save edits to write this deletion to the authored source"
            : "The source changes only when your agent applies the review";
      item("Undo last deletion", undoRemoval, !undo);
      menu.addEventListener("keydown", (event) => {
        const controls = [...menu.querySelectorAll("button:not(:disabled)")];
        const at = controls.indexOf(document.activeElement);
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? controls.length - 1
                : (at + (event.key === "ArrowDown" ? 1 : -1) + controls.length) % controls.length;
          if (controls[next]) {
            controls[next].focus();
          }
        } else if (event.key === "Tab") {
          close();
        }
      });
      root.append(menu);
      closeMenu = close;
      menu.showPopover();
      document.addEventListener("pointerdown", outside, true);
      document.addEventListener("keydown", escape, true);
      const rect = anchor.getBoundingClientRect();
      menu.style.left =
        Math.max(8, Math.min(point ? point.x : rect.right, innerWidth - menu.offsetWidth - 8)) +
        "px";
      menu.style.top =
        Math.max(8, Math.min(point ? point.y : rect.top, innerHeight - menu.offsetHeight - 8)) +
        "px";
      const first = menu.querySelector("button:not(:disabled)");
      if (first) {
        first.focus();
      }
    }
    function open(target, anchor, existing = null) {
      if (document.body.classList.contains("presenting")) {
        return;
      }
      if (!existing && authoredSession()) {
        api.chooseVisual(
          target,
          anchor,
          (entry) => {
            if (entry.key === "section") {
              api.openSection(target, anchor);
            } else {
              addAuthored(target, entry);
            }
          },
          false,
        );
        return;
      }
      let draftTitle = (existing && existing.title) || "";
      let draftBrief = (existing && existing.brief) || "";
      function choose() {
        api.chooseVisual(
          target,
          anchor,
          (entry) => {
            if (entry.key === "section") {
              api.openSection(target, anchor, choose);
            } else {
              edit(entry);
            }
          },
          Boolean(existing),
        );
      }
      function edit(entry) {
        const visual = entry.key;
        const box = dialog(existing ? "Edit draft slide" : "Preview your new slide", anchor);
        box.append(
          button(
            "← Choose another visual",
            () => {
              draftTitle = title.value;
              draftBrief = brief.value;
              box.close();
              choose();
            },
            "st-slide-secondary",
          ),
        );
        box.append(node("p", "st-describe-context", entry.label + " · " + entry.blurb));
        const fields = node("div", "st-slide-fields");
        const title = node("input");
        title.value = draftTitle || entry.label;
        title.maxLength = 120;
        const titleLabel = node("label", "st-section-field", "Slide title");
        titleLabel.append(title);
        const brief = node("textarea", "st-custom");
        brief.value = draftBrief;
        brief.maxLength = 4000;
        brief.placeholder =
          "For example: Show how our three teams share responsibility from request to launch. Emphasize who makes each decision.";
        const briefLabel = node("label", "st-describe-label", "What should this slide explain?");
        briefLabel.append(brief);
        fields.append(titleLabel, briefLabel);
        const sampleFrame = node("div", "st-slide-sample");
        const sampleStage = node("div", "st-slide-stage");
        let preview = node("div", "artifact");
        sampleStage.append(preview);
        sampleFrame.append(sampleStage);
        const sampleLabel = node(
          "p",
          "st-sub",
          "Illustrative sample · your agent supplies the real content",
        );
        function render() {
          if (preview.__kitDispose) {
            preview.__kitDispose();
          }
          preview = node("div", "artifact");
          sampleStage.replaceChildren(preview);
          try {
            kit.studioSamples.render(preview, visual);
            save.disabled = false;
          } catch (error) {
            sampleLabel.textContent =
              "This preview could not load. Choose another visual or reopen Studio.";
            sampleLabel.setAttribute("role", "alert");
            sampleFrame.hidden = true;
            save.disabled = true;
            console.error("Slide preview failed", visual, error);
          }
          requestAnimationFrame(fitSample);
        }
        function fitSample() {
          const scale = Math.min(
            (sampleFrame.clientWidth - 40) / 1000,
            290 / Math.max(1, preview.offsetHeight),
            1,
          );
          sampleStage.style.zoom = String(Math.max(0.1, scale));
        }
        const resize = new ResizeObserver(fitSample);
        resize.observe(sampleFrame);
        box.addEventListener("close", () => resize.disconnect());
        const save = button(existing ? "Update draft" : "Add to story", () => {
          const record = {
            ...existing,
            id:
              (existing && existing.id) ||
              "st-slide-" + store.label.toLowerCase() + "-" + Date.now().toString(36),
            action: "insert",
            target: (existing && existing.target) || target.id,
            title: title.value.trim() || "New slide",
            brief: brief.value.trim(),
            visual,
            variant: store.label,
            created: (existing && existing.created) || new Date().toISOString(),
          };
          const order = sections().map((item) => item.id);
          if (existing) {
            discard(existing.id);
          }
          insert(record);
          if (existing) {
            store.updateSlide(record.id, record);
            api.applyOrder(order);
          } else {
            store.addSlide(
              record,
              sections().map((item) => item.id),
            );
          }
          box.close();
          refresh();
          select(byId(record.id));
          toast(
            "Draft preview added. Finish sends your brief and visual choice to the agent.",
            true,
          );
        });
        const body = node("div", "st-slide-body");
        const visualColumn = node("div", "st-slide-visual");
        visualColumn.append(sampleLabel, sampleFrame);
        fields.append(save);
        body.append(visualColumn, fields);
        box.append(body);
        save.disabled = true;
        requestAnimationFrame(render);
      }
      choose();
    }
    return {
      open,
      contextMenu,
      remove,
      undoRemoval,
      canUndo: () => Boolean(undo),
      duplicate,
      insert,
      discard,
      restoreEdits() {
        [...store.sections(), ...store.slides()]
          .filter((record) => record.variant === store.label && record.action !== "remove")
          .forEach((record) => api.restoreEdits(record.id));
      },
      restore() {
        let pending = [
          ...store.sections(),
          ...store.slides().filter((record) => record.action === "insert"),
        ].filter((record) => record.variant === store.label && !byId(record.id));
        while (pending.length) {
          const ready = pending.filter((record) => byId(record.target));
          if (!ready.length) {
            break;
          }
          ready.forEach((record) => (record.action ? insert(record) : addSection(record)));
          pending = pending.filter((record) => !ready.includes(record));
        }
        store
          .slides()
          .filter((record) => record.action === "remove")
          .forEach(insert);
      },
    };
  }
  globalThis.ExplainerKit.createSlideAuthoring = createSlideAuthoring;
})();
