/* Review state boundary shared with Studio. Dependency-free by design: the
   factory receives persistence and rendering callbacks from review.js. */
(function () {
  "use strict";

  function createStore({ state, label, persist, refresh, pins }) {
    function retargetDependents(id, target) {
      (state.sections || []).forEach((record) => {
        if (record.variant === label && record.target === id) {
          record.target = target;
        }
      });
      (state.slides || []).forEach((record) => {
        if (record.variant === label && record.target === id) {
          record.target = target;
        }
      });
    }
    function ownsKey(key, id) {
      const value = String(key || "");
      return (
        value === id ||
        value.startsWith(id + ".") ||
        value.startsWith(id + "-host") ||
        value.includes("#" + id + "-host")
      );
    }
    // Selectors start at the nearest id, so "#s1" must not claim "#s10".
    // The id token owns the slide when it ends at a separator, alone or with
    // one of the suffixes Studio gives a sample slide's parts.
    function ownsSelector(selector, id) {
      const token = "#" + String(id).replaceAll(/[^\w-]/g, String.raw`\$&`);
      return new RegExp(token + String.raw`(?:-host|-hint|-title)?(?![\w-])`).test(
        String(selector || ""),
      );
    }
    function ownsRecord(item, id) {
      return item.section === "#" + id || ownsSelector(item.selector, id);
    }
    function scopedEntries(records, id) {
      return Object.fromEntries(
        Object.entries(records || {})
          .filter(([key]) => ownsKey(key, id))
          .map(([key, value]) => [key, structuredClone(value)]),
      );
    }
    function clearSlideEdits(id) {
      ["swaps", "canvas_edits", "roadmap_key_items"].forEach((field) => {
        const mine = state[field] && state[field][label];
        if (mine) {
          Object.keys(mine)
            .filter((key) => ownsKey(key, id))
            .forEach((key) => delete mine[key]);
        }
      });
      state.comments = (state.comments || []).filter(
        (item) => !(item.variant === label && ownsRecord(item, id)),
      );
      state.edits = (state.edits || []).filter(
        (item) => !(item.variant === label && ownsRecord(item, id)),
      );
    }
    return {
      label,
      review: state.review || "",
      sections() {
        return (state.sections || []).map((record) => Object.assign({}, record));
      },
      section(id) {
        const record = (state.sections || []).find(
          (candidate) => candidate.id === id && candidate.variant === label,
        );
        return record ? { ...record } : null;
      },
      slides() {
        return (state.slides || []).map((record) => structuredClone(record));
      },
      slide(id) {
        const record = (state.slides || []).find(
          (candidate) => candidate.id === id && candidate.variant === label,
        );
        return record ? structuredClone(record) : null;
      },
      slideEdits(id) {
        return {
          swaps: scopedEntries(state.swaps && state.swaps[label], id),
          canvas_edits: scopedEntries(state.canvas_edits && state.canvas_edits[label], id),
          roadmap_key_items: scopedEntries(
            state.roadmap_key_items && state.roadmap_key_items[label],
            id,
          ),
          comments: (state.comments || [])
            .filter((item) => item.variant === label && ownsRecord(item, id))
            .map((item) => structuredClone(item)),
          edits: (state.edits || [])
            .filter((item) => item.variant === label && ownsRecord(item, id))
            .map((item) => structuredClone(item)),
        };
      },
      restoreSlideEdits(snapshot) {
        if (!snapshot || typeof snapshot !== "object") {
          return;
        }
        ["swaps", "canvas_edits", "roadmap_key_items"].forEach((field) => {
          const saved = snapshot[field];
          if (!saved || typeof saved !== "object" || !Object.keys(saved).length) {
            return;
          }
          state[field] = state[field] || {};
          state[field][label] = state[field][label] || {};
          Object.entries(saved).forEach(([key, value]) => {
            state[field][label][key] = structuredClone(value);
          });
        });
        ["comments", "edits"].forEach((field) => {
          const saved = Array.isArray(snapshot[field]) ? snapshot[field] : [];
          state[field] = state[field] || [];
          saved.forEach((item) => {
            const duplicate = state[field].some(
              (current) => JSON.stringify(current) === JSON.stringify(item),
            );
            if (!duplicate) {
              state[field].push(structuredClone(item));
            }
          });
        });
        refresh();
        return persist();
      },
      discardSlideEdits(id) {
        clearSlideEdits(id);
        refresh();
        pins();
        return persist();
      },
      addSlide(record, order) {
        state.slides = state.slides || [];
        state.slides = state.slides.filter(
          (candidate) => !(candidate.id === record.id && candidate.variant === label),
        );
        state.slides.push(structuredClone(record));
        state.orders = state.orders || {};
        state.orders[label] = order.slice();
        refresh();
        return persist();
      },
      updateSlide(id, patch) {
        const record = (state.slides || []).find(
          (candidate) => candidate.id === id && candidate.variant === label,
        );
        if (!record) {
          return false;
        }
        Object.assign(record, structuredClone(patch));
        refresh();
        persist();
        return true;
      },
      removeSlide(id) {
        const removedRecord = (state.slides || []).find(
          (candidate) => candidate.id === id && candidate.variant === label,
        );
        const before = (state.slides || []).length;
        state.slides = (state.slides || []).filter(
          (candidate) => !(candidate.id === id && candidate.variant === label),
        );
        const removed = before !== state.slides.length;
        if (state.orders && state.orders[label]) {
          state.orders[label] = state.orders[label].filter((sectionId) => sectionId !== id);
        }
        if (removedRecord) {
          if (removedRecord.action !== "remove") {
            clearSlideEdits(id);
          }
          retargetDependents(id, removedRecord.target);
        }
        refresh();
        return removed ? persist() : undefined;
      },
      removeSection(id) {
        const record = (state.sections || []).find(
          (candidate) => candidate.id === id && candidate.variant === label,
        );
        state.sections = (state.sections || []).filter(
          (candidate) => !(candidate.id === id && candidate.variant === label),
        );
        if (state.orders && state.orders[label]) {
          state.orders[label] = state.orders[label].filter((sectionId) => sectionId !== id);
        }
        if (record) {
          clearSlideEdits(id);
          retargetDependents(id, record.target);
        }
        refresh();
        return persist();
      },
      addSection(record, order) {
        state.sections = state.sections || [];
        state.sections.push(record);
        state.orders = state.orders || {};
        state.orders[label] = order.slice();
        refresh();
        return persist();
      },
      updateSection(id, patch) {
        const record = (state.sections || []).find(
          (candidate) => candidate.id === id && candidate.variant === label,
        );
        if (!record) {
          return false;
        }
        Object.assign(record, patch);
        refresh();
        persist();
        return true;
      },
      order() {
        const order = state.orders && state.orders[label];
        return order ? order.slice() : null;
      },
      setOrder(order) {
        state.orders = state.orders || {};
        state.orders[label] = order.slice();
        refresh();
        return persist();
      },
      removeFromOrder(id) {
        if (!state.orders || !state.orders[label]) {
          return;
        }
        state.orders[label] = state.orders[label].filter((sectionId) => sectionId !== id);
        refresh();
        return persist();
      },
      addComment(comment) {
        const id = state.comments.reduce((highest, item) => Math.max(highest, item.id || 0), 0) + 1;
        state.comments.push({ ...comment, id, variant: label });
        refresh();
        pins();
        persist();
        return id;
      },
      swaps() {
        return { ...(state.swaps && state.swaps[label]) };
      },
      authoringDraft() {
        return {
          text: (state.edits || [])
            .filter((item) => item.variant === label)
            .map((item) => ({
              target: item.selector,
              before: item.before,
              value: item.after,
            })),
          tokens: structuredClone((state.tokens && state.tokens[label]) || {}),
          swaps: structuredClone((state.swaps && state.swaps[label]) || {}),
          canvas: structuredClone((state.canvas_edits && state.canvas_edits[label]) || {}),
        };
      },
      setSwap(key, value, staleKeys) {
        state.swaps = state.swaps || {};
        const mine = state.swaps[label] || (state.swaps[label] = {});
        (staleKeys || []).forEach((staleKey) => {
          if (staleKey && staleKey !== key) {
            delete mine[staleKey];
          }
        });
        mine[key] = value;
        refresh();
        return persist();
      },
      setLook(style) {
        state.look = { style, variant: label };
        refresh();
      },
      serialized() {
        return JSON.stringify(state);
      },
      save() {
        return persist();
      },
      canvasEdits() {
        return structuredClone((state.canvas_edits && state.canvas_edits[label]) || {});
      },
      setCanvasEdits(id, edits, authored) {
        state.canvas_edits = state.canvas_edits || {};
        const mine = state.canvas_edits[label] || (state.canvas_edits[label] = {});
        if (JSON.stringify(edits) === JSON.stringify(authored)) {
          delete mine[id];
        } else {
          mine[id] = structuredClone(edits);
        }
        refresh();
        return persist();
      },
      roadmapKeyItems(id) {
        const mine = state.roadmap_key_items && state.roadmap_key_items[label];
        return mine && mine[id] ? structuredClone(mine[id]) : null;
      },
      setRoadmapKeyItems(id, itemIds, itemLabels) {
        state.roadmap_key_items = state.roadmap_key_items || {};
        const mine = state.roadmap_key_items[label] || (state.roadmap_key_items[label] = {});
        mine[id] = {
          item_ids: [...new Set(itemIds)].slice(0, 24),
          labels: itemLabels.slice(0, 24),
        };
        refresh();
        return persist();
      },
      clearRoadmapKeyItems(id) {
        const mine = state.roadmap_key_items && state.roadmap_key_items[label];
        if (!mine || !mine[id]) {
          return Promise.resolve();
        }
        delete mine[id];
        if (!Object.keys(mine).length) {
          delete state.roadmap_key_items[label];
        }
        refresh();
        return persist();
      },
    };
  }

  window.ExplainerReview = Object.freeze({ createStore });
})();
