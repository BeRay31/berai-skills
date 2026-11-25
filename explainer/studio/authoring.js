/* Deterministic Studio persistence. This module projects only changes that
   have a stable authoring representation; notes and unsupported review items
   remain available for an explicit agent handoff. */
(function () {
  "use strict";

  const MAX_MANIFEST_BYTES = 1_500_000;
  // Matches authoring.py and the detach traversal bound.
  const MAX_SHAPE_DEPTH = 16;

  function clone(value) {
    return structuredClone(value);
  }

  function emptyManifest() {
    return {
      version: 2,
      text: [],
      tokens: {},
      components: {},
      shapes: [],
      slides: [],
      sourceSlides: [],
      order: [],
    };
  }

  function storySections() {
    const shell = document.querySelector(".shell");
    return shell
      ? [...shell.children].filter(
          (node) => node.localName === "section" && !node.dataset.stSlidePreview,
        )
      : [];
  }

  function validId(value) {
    return /^[A-Za-z][A-Za-z0-9_-]{0,119}$/.test(String(value || ""));
  }

  function sourceState(source) {
    const current = storySections();
    const saved = Array.isArray(source.sourceSlides) ? source.sourceSlides : [];
    const savedById = new Map(saved.map((record) => [record.id, record]));
    const sourceSlides = current
      .filter((section) => !section.dataset.authoringSlide && validId(section.id))
      .map((section) => savedById.get(section.id) || { id: section.id, hidden: false });
    // Undo can restore a slide before its DOM has been recreated. Keep IDs
    // declared by the manifest as well as the sections currently on screen.
    const insertedIds = (Array.isArray(source.slides) ? source.slides : [])
      .filter((slide) => slide && validId(slide.id))
      .map((slide) => slideDomId(slide.id));
    const known = new Set([...sourceSlides.map((slide) => slide.id), ...insertedIds]);
    const order = [
      ...(Array.isArray(source.order) ? source.order : []).filter((id) => known.has(id)),
      ...[...known].filter((id) => !(Array.isArray(source.order) && source.order.includes(id))),
    ];
    return { sourceSlides, order };
  }

  function normalized(value) {
    if (value && value.version !== 1 && value.version !== 2) {
      throw new Error("This authoring manifest needs a newer Studio version.");
    }
    const source = value && (value.version === 1 || value.version === 2) ? value : emptyManifest();
    return {
      // v1 and v2 share the original fields; v2 adds scene groups, paths, and
      // detached component roots. Keep the migration local and non-mutating.
      version: 2,
      text: Array.isArray(source.text) ? clone(source.text) : [],
      tokens: source.tokens && typeof source.tokens === "object" ? clone(source.tokens) : {},
      components:
        source.components && typeof source.components === "object" ? clone(source.components) : {},
      shapes: Array.isArray(source.shapes) ? clone(source.shapes) : [],
      slides: Array.isArray(source.slides) ? clone(source.slides) : [],
      ...sourceState(source),
    };
  }

  function componentIdentity(target) {
    if (typeof target === "string") {
      return target;
    }
    if (target && typeof target.identity === "string") {
      return target.identity;
    }
    if (target && target.host && globalThis.ExplainerAuthoring) {
      return globalThis.ExplainerAuthoring.identity(target.host);
    }
    return "";
  }

  function shapeDescendants(shapes, root) {
    const byParent = new Map();
    shapes.forEach((shape) => {
      if (!shape || typeof shape.id !== "string") {
        return;
      }
      const children = byParent.get(shape.parent) || [];
      children.push(shape.id);
      byParent.set(shape.parent, children);
    });
    const ids = new Set([root]);
    const pending = [root];
    while (pending.length) {
      const children = byParent.get(pending.pop()) || [];
      children.forEach((id) => {
        if (!ids.has(id)) {
          ids.add(id);
          pending.push(id);
        }
      });
    }
    return ids;
  }

  function cloneSlideShapes(shapes, sourceSlideId, duplicateSlideId, duplicateId) {
    const selected = shapes.filter((shape) => shape && shape.slide === sourceSlideId);
    const ids = new Map(
      selected.map((shape, index) => [shape.id, `${duplicateId}-shape-${index + 1}`]),
    );
    return selected.map((shape, index) => {
      const copy = clone(shape);
      copy.id = ids.get(shape.id) || `${duplicateId}-shape-${index + 1}`;
      copy.slide = duplicateSlideId;
      if (copy.parent) {
        copy.parent = ids.get(copy.parent) || copy.parent;
      }
      return copy;
    });
  }

  function rebaseDetachedRoot(component, sourceShapes, copiedShapes) {
    const root = component && component.detached && component.detached.root;
    if (!root) {
      return;
    }
    const source = sourceShapes.filter((shape) => shape && shape.id);
    const copied = copiedShapes.filter((shape) => shape && shape.id);
    const index = source.findIndex((shape) => shape.id === root);
    if (index !== -1 && copied[index]) {
      component.detached.root = copied[index].id;
    }
  }

  function detachedScene(scene, slideId, existingShapes) {
    if (!scene || typeof scene !== "object" || !Array.isArray(scene.shapes)) {
      throw new Error("Detached components need a scene with shapes.");
    }
    const root = scene.root;
    if (typeof root !== "string" || !root) {
      throw new Error("Detached components need a group root.");
    }
    const shapes = clone(scene.shapes);
    const ids = new Set(shapes.map((shape) => shape && shape.id));
    if (
      ids.size !== shapes.length ||
      shapes.some((shape) => !shape || typeof shape.id !== "string")
    ) {
      throw new Error("Detached shape ids must be unique.");
    }
    if (!ids.has(root)) {
      throw new Error("The detached root must be included in the scene.");
    }
    const rootShape = shapes.find((shape) => shape.id === root);
    if (rootShape.type !== "group") {
      throw new Error("The detached root must be a group.");
    }
    if (rootShape.parent) {
      throw new Error("The detached root cannot have a parent.");
    }
    shapes.forEach((shape) => {
      shape.slide = slideId;
      if (shape.parent && !ids.has(shape.parent)) {
        throw new Error("Detached shape parents must be in the same scene.");
      }
      if (shape.parent && shape.parent === shape.id) {
        throw new Error("Detached shape parents must be acyclic.");
      }
    });
    const byId = new Map(shapes.map((shape) => [shape.id, shape]));
    shapes.forEach((shape) => {
      const seen = new Set();
      let current = shape;
      let depth = 0;
      while (current.parent) {
        if (seen.has(current.id) || depth++ >= MAX_SHAPE_DEPTH) {
          throw new Error("Detached shape nesting is too deep or cyclic.");
        }
        seen.add(current.id);
        current = byId.get(current.parent);
        if (current.type !== "group") {
          throw new Error("Detached shape parents must be groups.");
        }
      }
      if (current.id !== root) {
        throw new Error("Every detached shape must belong to the scene root.");
      }
    });
    const occupied = new Set(existingShapes.map((shape) => shape && shape.id));
    shapes.forEach((shape) => {
      if (occupied.has(shape.id)) {
        throw new Error(`Shape id ${shape.id} is already in use.`);
      }
    });
    return { root, shapes };
  }

  function stableSwap(key) {
    const stable = String(key || "").split(" · ")[0];
    if (!stable.startsWith("@")) {
      return null;
    }
    const divider = stable.lastIndexOf("|");
    if (divider < 2 || divider === stable.length - 1) {
      return null;
    }
    return { identity: stable.slice(1, divider), option: stable.slice(divider + 1) };
  }

  const AUTHORING_TOKENS = new Set([
    "font_pct",
    "space_scale",
    "measure",
    "accent",
    "accent_mode",
    "accent_preset",
  ]);

  function mergeText(manifest, draft, consumed) {
    draft.forEach((edit) => {
      if (!edit || !edit.target || edit.before === edit.value) {
        return;
      }
      const at = manifest.text.findIndex((current) => current.target === edit.target);
      if (at === -1) {
        manifest.text.push(clone(edit));
      } else if (edit.value === manifest.text[at].before) {
        manifest.text.splice(at, 1);
      } else {
        manifest.text[at].value = edit.value;
      }
      consumed.push(edit.target);
    });
  }

  function mergeSwaps(manifest, swaps, consumed) {
    Object.entries(swaps).forEach(([key, value]) => {
      const parsed = stableSwap(key);
      if (!parsed) {
        return;
      }
      const component = manifest.components[parsed.identity] || { settings: {} };
      component.settings = component.settings || {};
      component.settings[parsed.option] = clone(value);
      manifest.components[parsed.identity] = component;
      consumed.push(key);
    });
  }

  function slideDomId(id) {
    return `ea-slide-${id}`;
  }

  function replaceSlideSelector(selector, sourceId, duplicateId) {
    const prefix = `#${slideDomId(sourceId)}`;
    if (typeof selector !== "string" || !selector.startsWith(prefix)) {
      return "";
    }
    const suffix = selector.slice(prefix.length);
    const boundary = suffix.startsWith("-host") ? suffix.slice(5) : suffix;
    // A slide named "one" must never consume selectors for "one-more".
    return !boundary || !/[\w-]/.test(boundary[0]) ? `#${slideDomId(duplicateId)}${suffix}` : "";
  }

  function create({ boot, reviewStore, onChange }) {
    let manifest = normalized(boot.authoring);
    let sourceToken = boot.source_token || "";
    let pageToken = boot.page_token || "";
    let dirty = false;
    const listeners = new Set();

    function notify() {
      listeners.forEach((listener) => listener());
      if (typeof onChange === "function") {
        onChange(manifest);
      }
    }

    function changed() {
      dirty = true;
      notify();
    }

    function reviewDraft() {
      return reviewStore && typeof reviewStore.authoringDraft === "function"
        ? reviewStore.authoringDraft()
        : { text: [], tokens: {}, swaps: {}, canvas: {} };
    }

    function canvasKind(host) {
      const editor =
        host &&
        globalThis.ExplainerKit &&
        typeof globalThis.ExplainerKit.canvasEditor === "function"
          ? globalThis.ExplainerKit.canvasEditor(host)
          : null;
      const kind = editor && editor.kind;
      return kind === "architecture" || kind === "operating-model" ? kind : null;
    }

    function authoredSlide(targetManifest, host) {
      const section = host && host.closest && host.closest("[data-authoring-slide]");
      const id = section && section.dataset.authoringSlide;
      return id ? targetManifest.slides.find((slide) => slide && slide.id === id) : null;
    }

    function canvasTargets(targetManifest, edits) {
      if (!edits || typeof edits !== "object") {
        return [];
      }
      return Object.entries(edits).flatMap(([hostId, record]) => {
        const host = document.querySelector("#" + CSS.escape(hostId));
        const kind = canvasKind(host);
        if (!host || !kind) {
          return [];
        }
        const slide = authoredSlide(targetManifest, host);
        if (slide) {
          return slide.component && slide.component.kind === kind
            ? [{ hostId, record, slide }]
            : [];
        }
        const identity =
          globalThis.ExplainerAuthoring && globalThis.ExplainerAuthoring.identity(host);
        return identity ? [{ hostId, record, identity, kind }] : [];
      });
    }

    function mergeCanvas(targetManifest, edits, consumed) {
      canvasTargets(targetManifest, edits).forEach((target) => {
        if (target.slide) {
          target.slide.component.canvas = clone(target.record);
        } else {
          const component = targetManifest.components[target.identity] || { settings: {} };
          component.canvas = { kind: target.kind, record: clone(target.record) };
          targetManifest.components[target.identity] = component;
        }
        consumed.push(target.hostId);
      });
    }

    function projected() {
      const next = clone(manifest);
      const draft = reviewDraft();
      const consumed = { text_targets: [], swap_keys: [], canvas_hosts: [], tokens: false };
      mergeText(next, draft.text || [], consumed.text_targets);
      mergeSwaps(next, draft.swaps || {}, consumed.swap_keys);
      mergeCanvas(next, draft.canvas, consumed.canvas_hosts);
      const tokenEntries = Object.entries(draft.tokens || {});
      const tokens = Object.fromEntries(tokenEntries);
      if (tokenEntries.length && tokenEntries.every(([key]) => AUTHORING_TOKENS.has(key))) {
        Object.assign(next.tokens, clone(tokens));
        consumed.tokens = true;
      }
      return { manifest: next, consumed };
    }

    function hasReviewChanges() {
      const draft = reviewDraft();
      return Boolean(
        (draft.text && draft.text.length) ||
        (Object.keys(draft.tokens || {}).length > 0 &&
          Object.keys(draft.tokens || {}).every((key) => AUTHORING_TOKENS.has(key))) ||
        Object.keys(draft.swaps || {}).some((key) => stableSwap(key)) ||
        canvasTargets(manifest, draft.canvas).length > 0,
      );
    }

    function resolvedComponent(target, targetManifest) {
      const authored = target && typeof target.slideId === "string" ? target.slideId : "";
      if (authored) {
        const slide = targetManifest.slides.find((item) => item && item.id === authored);
        return slide && slide.component
          ? { component: slide.component, slideId: slideDomId(authored), slide }
          : null;
      }
      const identity = componentIdentity(target);
      if (!identity) {
        return null;
      }
      const host = target && target.host;
      const section = host && host.closest ? host.closest("section[id]") : null;
      const inferredSlide = section && section.id;
      const raw = identity.replace(/^#/, "").split("/", 1)[0];
      const record = targetManifest.components[identity] || { settings: {} };
      if ((!record.kind || !record.data) && host && globalThis.ExplainerComponentCapture) {
        const captured = globalThis.ExplainerComponentCapture.get(host);
        if (captured && captured.kind && captured.data) {
          record.kind = captured.kind;
          record.data = clone(captured.data);
          if (captured.canvas && !record.canvas) {
            record.canvas = { kind: captured.kind, record: clone(captured.canvas) };
          }
        }
      }
      return {
        component: record,
        identity,
        slideId: inferredSlide || (raw.endsWith("-host") ? raw.slice(0, -5) : raw),
      };
    }

    function detachedManifest(target, scene) {
      const next = clone(manifest);
      const resolved = resolvedComponent(target, next);
      if (!resolved || !resolved.slideId) {
        return null;
      }
      const oldRoot = resolved.component.detached && resolved.component.detached.root;
      if (oldRoot) {
        const oldIds = shapeDescendants(next.shapes, oldRoot);
        next.shapes = next.shapes.filter((shape) => !oldIds.has(shape && shape.id));
      }
      const detached = detachedScene(scene, resolved.slideId, next.shapes);
      next.shapes.push(...detached.shapes);
      resolved.component.detached = { root: detached.root };
      if (resolved.identity) {
        next.components[resolved.identity] = resolved.component;
      }
      return next;
    }

    function restore(target) {
      const next = clone(manifest);
      const resolved = resolvedComponent(target, next);
      const root = resolved && resolved.component.detached && resolved.component.detached.root;
      if (!resolved || !root) {
        return false;
      }
      const ids = shapeDescendants(next.shapes, root);
      next.shapes = next.shapes.filter((shape) => !ids.has(shape && shape.id));
      delete resolved.component.detached;
      if (resolved.identity) {
        next.components[resolved.identity] = resolved.component;
      }
      manifest = next;
      changed();
      return true;
    }

    const initialTokens = Object.entries(reviewDraft().tokens || {});
    if (initialTokens.length && initialTokens.every(([key]) => AUTHORING_TOKENS.has(key))) {
      Object.assign(manifest.tokens, Object.fromEntries(initialTokens));
    }

    return {
      writable() {
        return Boolean(boot.authoring_url && sourceToken && pageToken);
      },
      manifest() {
        return clone(manifest);
      },
      checkpoint() {
        return { manifest: clone(manifest), dirty };
      },
      restoreCheckpoint(checkpoint) {
        if (!checkpoint || typeof checkpoint !== "object" || !checkpoint.manifest) {
          throw new Error("An authoring checkpoint is required.");
        }
        manifest = normalized(checkpoint.manifest);
        dirty = Boolean(checkpoint.dirty);
        notify();
      },
      previewManifest() {
        // Rebuilding slides must include pending text/settings/canvas edits,
        // while leaving those drafts independently discardable in Review.
        return projected().manifest;
      },
      tokens() {
        return manifest.tokens;
      },
      slides() {
        return clone(manifest.slides);
      },
      sourceSlides() {
        return clone(manifest.sourceSlides);
      },
      sourceSlide(id) {
        const found = manifest.sourceSlides.find((item) => item && item.id === id);
        return found ? clone(found) : null;
      },
      sourceComponent(host) {
        const identity = globalThis.ExplainerAuthoring.identity(host);
        const record = identity && manifest.components[identity];
        return record && record.kind && record.data
          ? {
              kind: record.kind,
              data: clone(record.data),
              ...(record.canvas ? { canvas: clone(record.canvas.record) } : {}),
              ...(record.detached ? { detached: clone(record.detached) } : {}),
            }
          : null;
      },
      updateSourceComponent(host, component) {
        const identity = globalThis.ExplainerAuthoring.identity(host);
        if (!identity || !component || typeof component.kind !== "string" || !component.data) {
          return false;
        }
        const record = manifest.components[identity] || { settings: {} };
        record.kind = component.kind;
        record.data = clone(component.data);
        if (
          component.canvas &&
          (component.kind === "architecture" || component.kind === "operating-model")
        ) {
          record.canvas = { kind: component.kind, record: clone(component.canvas) };
        }
        manifest.components[identity] = record;
        changed();
        return true;
      },
      previewSlideDetachment(slideId, scene) {
        return detachedManifest({ slideId }, scene);
      },
      previewSourceDetachment(host, scene) {
        return detachedManifest({ host }, scene);
      },
      restoreSlideComponent(slideId) {
        return restore({ slideId });
      },
      restoreSourceComponent(hostOrIdentity) {
        const target =
          typeof hostOrIdentity === "string"
            ? { identity: hostOrIdentity }
            : hostOrIdentity && hostOrIdentity.host
              ? hostOrIdentity
              : { host: hostOrIdentity };
        return restore(target);
      },
      slide(id) {
        const found = manifest.slides.find((item) => item && item.id === id);
        return found ? clone(found) : null;
      },
      addSlide(slide, beforeSlideId = "") {
        if (!slide || typeof slide !== "object" || typeof slide.id !== "string" || !slide.id) {
          throw new Error("An authored slide needs an id.");
        }
        if (manifest.slides.some((item) => item && item.id === slide.id)) {
          throw new Error("That authored slide already exists.");
        }
        const beforeIndex = beforeSlideId
          ? manifest.slides.findIndex((item) => item && item.id === beforeSlideId)
          : -1;
        manifest.slides.splice(
          beforeIndex === -1 ? manifest.slides.length : beforeIndex,
          0,
          clone(slide),
        );
        const domId = slideDomId(slide.id);
        const targetId = beforeSlideId
          ? slideDomId(beforeSlideId)
          : slide.before === "studio-after-last"
            ? ""
            : slide.before;
        const orderAt = targetId ? manifest.order.indexOf(targetId) : -1;
        if (!manifest.order.includes(domId)) {
          manifest.order.splice(orderAt === -1 ? manifest.order.length : orderAt, 0, domId);
        }
        changed();
      },
      updateSlide(id, patch) {
        const slide = manifest.slides.find((item) => item && item.id === id);
        if (!slide || !patch || typeof patch !== "object") {
          return false;
        }
        Object.assign(slide, clone(patch));
        changed();
        return true;
      },
      removeSlide(id) {
        const next = manifest.slides.filter((item) => !item || item.id !== id);
        if (next.length === manifest.slides.length) {
          return false;
        }
        manifest.slides = next;
        const sectionId = slideDomId(id);
        manifest.order = manifest.order.filter((item) => item !== sectionId);
        delete manifest.components[`#${sectionId}-host`];
        manifest.shapes = manifest.shapes.filter((shape) => !shape || shape.slide !== sectionId);
        manifest.text = manifest.text.filter(
          (edit) => !replaceSlideSelector(edit && edit.target, id, id),
        );
        changed();
        return true;
      },
      duplicateSlide(id, duplicate) {
        const sourceIndex = manifest.slides.findIndex((item) => item && item.id === id);
        const preview = projected().manifest;
        const source = preview.slides[sourceIndex];
        if (!source || !duplicate || typeof duplicate.id !== "string" || !duplicate.id) {
          return false;
        }
        if (manifest.slides.some((item) => item && item.id === duplicate.id)) {
          throw new Error("That authored slide already exists.");
        }
        const duplicateSlide = { ...clone(source), ...clone(duplicate) };
        manifest.slides.splice(sourceIndex + 1, 0, duplicateSlide);
        const sourceHost = `#${slideDomId(id)}-host`;
        const duplicateHost = `#${slideDomId(duplicate.id)}-host`;
        const sourceDomId = slideDomId(id);
        const duplicateDomId = slideDomId(duplicate.id);
        const sourceOrderAt = manifest.order.indexOf(sourceDomId);
        manifest.order.splice(
          sourceOrderAt === -1 ? manifest.order.length : sourceOrderAt + 1,
          0,
          duplicateDomId,
        );
        const sourceShapes = manifest.shapes.filter(
          (shape) => shape && shape.slide === slideDomId(id),
        );
        if (preview.components[sourceHost]) {
          manifest.components[duplicateHost] = clone(preview.components[sourceHost]);
        }
        const copiedShapes = cloneSlideShapes(
          sourceShapes,
          slideDomId(id),
          slideDomId(duplicate.id),
          duplicate.id,
        );
        if (preview.components[sourceHost]) {
          rebaseDetachedRoot(manifest.components[duplicateHost], sourceShapes, copiedShapes);
        }
        if (duplicateSlide.component && source.component) {
          rebaseDetachedRoot(duplicateSlide.component, sourceShapes, copiedShapes);
        }
        manifest.shapes.push(...copiedShapes);
        const savedText = manifest.text
          .map((edit) =>
            Object.assign(clone(edit), {
              target: replaceSlideSelector(edit.target, id, duplicate.id),
            }),
          )
          .filter((edit) => edit.target);
        const draftText = (reviewDraft().text || [])
          .map((edit) =>
            Object.assign(clone(edit), {
              target: replaceSlideSelector(edit.target, id, duplicate.id),
            }),
          )
          .filter((edit) => edit.target);
        mergeText(manifest, [...savedText, ...draftText], []);
        changed();
        return true;
      },
      reorderSlides(sectionOrder) {
        if (!Array.isArray(sectionOrder)) {
          return false;
        }
        const bySection = new Map(manifest.slides.map((slide) => [slideDomId(slide.id), slide]));
        // Plan the whole order first: a rejected order must leave every slide's
        // anchor untouched rather than half-rewritten.
        const planned = sectionOrder.flatMap((sectionId, index) => {
          const slide = bySection.get(sectionId);
          if (!slide) {
            return [];
          }
          const nextSource = sectionOrder.slice(index + 1).find((id) => !bySection.has(id));
          return [{ slide, before: nextSource || "studio-after-last" }];
        });
        // A repeated section ID would otherwise plan one slide twice while
        // dropping another, and the length check alone would accept it.
        const plannedIds = new Set(planned.map((entry) => entry.slide.id));
        if (
          planned.length !== manifest.slides.length ||
          plannedIds.size !== manifest.slides.length
        ) {
          return false;
        }
        planned.forEach((entry) => {
          entry.slide.before = entry.before;
        });
        manifest.slides = planned.map((entry) => entry.slide);
        changed();
        return true;
      },
      reorderSections(sectionOrder) {
        if (!Array.isArray(sectionOrder)) {
          return false;
        }
        const hidden = new Set(
          manifest.sourceSlides.filter((item) => item.hidden).map((item) => item.id),
        );
        const visible = manifest.order.filter((id) => !hidden.has(id));
        const requested = sectionOrder.filter((id) => !hidden.has(id));
        if (
          requested.length !== visible.length ||
          new Set(requested).size !== requested.length ||
          requested.some((id) => !visible.includes(id))
        ) {
          return false;
        }
        let cursor = 0;
        manifest.order = manifest.order.map((id) => (hidden.has(id) ? id : requested[cursor++]));
        changed();
        return true;
      },
      removeSourceSlide(id) {
        const source = manifest.sourceSlides.find((item) => item && item.id === id);
        if (!source || source.hidden) {
          return false;
        }
        source.hidden = true;
        changed();
        return true;
      },
      replace(next) {
        manifest = normalized(next);
        changed();
      },
      setTokens(tokens) {
        manifest.tokens = clone(tokens || {});
        changed();
      },
      pending() {
        return dirty || hasReviewChanges();
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      save() {
        if (!this.writable()) {
          throw new Error("This explainer has no writable authored source.");
        }
        const next = projected();
        const manifestBytes = new TextEncoder().encode(JSON.stringify(next.manifest)).length;
        if (manifestBytes > MAX_MANIFEST_BYTES) {
          return Promise.reject(
            new Error(`These edits exceed the ${MAX_MANIFEST_BYTES}-byte save limit.`),
          );
        }
        return fetch(boot.authoring_url, {
          method: "POST",
          signal: AbortSignal.timeout(45_000),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            index: boot.index || 0,
            page_token: pageToken,
            source_token: sourceToken,
            manifest: next.manifest,
            consumed_review: next.consumed,
          }),
        })
          .then((response) =>
            response
              .json()
              .catch(() => ({}))
              .then((result) => ({ response, result })),
          )
          .then(({ response, result }) => {
            if (!response.ok || !result.ok) {
              throw new Error(result.error || "Could not save these edits.");
            }
            manifest = normalized(result.authoring || next.manifest);
            sourceToken = result.source_token || sourceToken;
            pageToken = result.page_token || pageToken;
            dirty = false;
            listeners.forEach((listener) => listener());
            return result;
          });
      },
    };
  }

  window.ExplainerStudioAuthoring = Object.freeze({ create, validId });
})();
