(function () {
  "use strict";
  const RV = window.__RV__ || {};
  const variants = RV.variants || [];
  const currentVariant = variants[RV.index] || variants[0] || { label: "A", slug: "" };
  const LABEL = currentVariant.label || "A";
  const state = RV.state || {};
  const STATE_URL = RV.state_url || "/api/state";
  const REVIEW_URL = RV.review_url || "/review.md";
  const HANDOFF_URL = RV.handoff_url || "";
  const agentHandoff = Boolean(HANDOFF_URL);
  let handoff = RV.handoff || { status: "editing" };
  state.comments = state.comments || [];
  state.sections = state.sections || [];
  state.slides = state.slides || [];
  state.tokens = state.tokens || {};
  state.general_notes = state.general_notes || "";
  state.verdict = state.verdict || null;
  state.roadmap_key_items = state.roadmap_key_items || {};

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) {
      e.className = cls;
    }
    if (html != null) {
      e.innerHTML = html;
    }
    return e;
  }
  function esc(s) {
    return String(s == null ? "" : s).replaceAll(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
    );
  }
  let saveTimer = null;
  let pendingSaveResolve = null;
  let lockedSaveRejected = false;
  function save(immediate) {
    if (saveTimer) {
      clearTimeout(saveTimer);
    }
    // A newer save supersedes the pending one — settle its promise so an
    // Awaiting caller (finish/navigation) is never left hanging
    if (pendingSaveResolve) {
      pendingSaveResolve(false);
      pendingSaveResolve = null;
    }
    return new Promise((resolve) => {
      pendingSaveResolve = resolve;
      saveTimer = setTimeout(
        function () {
          saveTimer = null;
          pendingSaveResolve = null;
          fetch(STATE_URL, { method: "POST", body: JSON.stringify(state) })
            .then(function (r) {
              if (r.ok) {
                toast("saved");
                resolve(true);
                return true;
              } else if (r.status === 423 && agentHandoff) {
                return r
                  .json()
                  .catch(() => ({}))
                  .then((payload) => {
                    handoff = payload.handoff || { status: "waiting" };
                    lockedSaveRejected = true;
                    document.body.classList.add("rv-agent-waiting");
                    drawerView = "handoff";
                    drawer.classList.add("rv-open");
                    renderDrawer();
                    toast("That edit was not saved because your agent has the review", 5000);
                    resolve(false);
                    return false;
                  });
              } else if (r.status === 409) {
                toast("this page changed — refresh it before editing", 4000);
              } else {
                toast("save failed");
              }
              resolve(false);
              return false;
            })
            .catch(function () {
              toast("save failed — is the studio still running?");
              resolve(false);
            });
        },
        immediate ? 0 : 500,
      );
    });
  }

  /* ── chrome ── */
  const root = el("div", null, "");
  root.id = "rv-root";
  root.dataset.rvVersion = "1";
  document.body.append(root);
  document.body.classList.add("rv-reviewing");
  document.body.classList.toggle(
    "rv-agent-waiting",
    agentHandoff && (handoff.status === "waiting" || handoff.status === "ready"),
  );
  root.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  const bar = el("div", "rv-bar");
  const barGrip = el("button", "rv-btn rv-grip", "⋮⋮");
  let barPosition = null;
  barGrip.title = "Drag review tools to move; use arrow keys for precise movement";
  barGrip.setAttribute("aria-label", "Move review tools");
  bar.append(barGrip);
  root.append(bar);

  function applyBarPosition() {
    if (!barPosition) {
      return;
    }
    bar.style.right = "auto";
    bar.style.bottom = "auto";
    bar.style.left = `${Math.max(8, Math.min(window.innerWidth - bar.offsetWidth - 8, barPosition.left))}px`;
    bar.style.top = `${Math.max(8, Math.min(window.innerHeight - bar.offsetHeight - 8, barPosition.top))}px`;
  }

  function moveBar(left, top) {
    barPosition = { left, top };
    applyBarPosition();
  }

  function startBarDrag(event) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const rect = bar.getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    barGrip.setPointerCapture(event.pointerId);
    const drag = (next) =>
      moveBar(start.left + next.clientX - start.x, start.top + next.clientY - start.y);
    const stop = () => {
      barGrip.removeEventListener("pointermove", drag);
      barGrip.removeEventListener("pointerup", stop);
      barGrip.removeEventListener("pointercancel", stop);
    };
    barGrip.addEventListener("pointermove", drag);
    barGrip.addEventListener("pointerup", stop);
    barGrip.addEventListener("pointercancel", stop);
  }

  barGrip.addEventListener("pointerdown", startBarDrag);
  barGrip.addEventListener("keydown", (event) => {
    if (event.key === "Home") {
      event.preventDefault();
      barPosition = null;
      bar.removeAttribute("style");
      return;
    }
    const movement = {
      ArrowLeft: [-16, 0],
      ArrowRight: [16, 0],
      ArrowUp: [0, -16],
      ArrowDown: [0, 16],
    }[event.key];
    if (movement) {
      event.preventDefault();
      event.stopPropagation();
      const rect = bar.getBoundingClientRect();
      moveBar(rect.left + movement[0], rect.top + movement[1]);
    }
  });
  window.addEventListener("resize", applyBarPosition);

  if (variants.length > 1) {
    variants.forEach((variant) => {
      var variantBtn = el(
        "button",
        "rv-btn" + (variant.label === LABEL ? " rv-on" : ""),
        variant.label,
      );
      variantBtn.title = variant.title || variant.file || "Variant " + variant.label;
      variantBtn.addEventListener("click", function () {
        if (variant.label === LABEL) {
          return;
        }
        var max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        try {
          sessionStorage.setItem("rv-scroll", String(window.scrollY / max));
        } catch {}
        window.location.href = "/" + variant.slug;
      });
      bar.appendChild(variantBtn);
    });
    var preferBtn = el(
      "button",
      "rv-btn rv-mutate",
      state.verdict && state.verdict.preferred === LABEL ? `Preferred ${LABEL}` : `Prefer ${LABEL}`,
    );
    preferBtn.addEventListener("click", () => {
      state.verdict = { preferred: LABEL, decided_at: new Date().toISOString() };
      preferBtn.textContent = "Preferred " + LABEL;
      updatePendingUI();
      save(true);
    });
    bar.append(preferBtn);
  }
  try {
    const storedScroll = sessionStorage.getItem("rv-scroll");
    if (storedScroll !== null) {
      sessionStorage.removeItem("rv-scroll");
      const savedScroll = Number(storedScroll);
      if (Number.isFinite(savedScroll)) {
        window.__rvRestoringScroll = true;
        window.addEventListener("load", () => {
          window.scrollTo(
            0,
            savedScroll * Math.max(1, document.documentElement.scrollHeight - window.innerHeight),
          );
        });
      }
    }
  } catch {}
  const commentBtn = el("button", "rv-btn rv-tool rv-tool-note rv-mutate", "Select & note");
  commentBtn.title = "Drag an area or click an element to leave feedback (Esc exits)";
  commentBtn.addEventListener("click", toggleCommentMode);
  bar.append(commentBtn);
  const editBtn = el("button", "rv-btn rv-tool rv-tool-edit rv-mutate", "Edit text");
  editBtn.title = "Type directly on the page — your edits save with the review";
  editBtn.addEventListener("click", toggleEditing);
  bar.append(editBtn);
  const drawerBtn = el("button", "rv-btn rv-tool rv-tool-changes", "Changes");
  drawerBtn.title = "Review notes and preview changes";
  drawerBtn.addEventListener("click", () => {
    // While an agent applies the review, the drawer shows the handoff view —
    // the pending list's discard actions would fight the in-flight review.
    const view = agentWaiting() ? "handoff" : "notes";
    const alreadyOpen = drawerView === view && drawer.classList.contains("rv-open");
    drawerView = view;
    drawer.classList.toggle("rv-open", !alreadyOpen);
    renderDrawer();
    placePins();
  });
  bar.append(drawerBtn);
  const previewStatus = el("span", "rv-preview-status", "Preview only");
  previewStatus.setAttribute("role", "status");
  previewStatus.hidden = true;
  bar.append(previewStatus);
  function dockCopyDiagnostics() {
    const diagnostics = document.querySelector(".kit-diagnostics");
    if (diagnostics && diagnostics.parentElement !== bar) {
      diagnostics.classList.add("is-docked");
      bar.append(diagnostics);
    }
  }
  dockCopyDiagnostics();
  window.addEventListener("kitdiagnostic", dockCopyDiagnostics);

  const finishBtn = el("button", "rv-btn rv-finish", "Finish");
  finishBtn.title = agentHandoff
    ? "Review feedback, then send it to your agent"
    : "Review feedback, then copy the prompt for your agent";
  finishBtn.addEventListener("click", () => {
    if (editing) {
      toggleEditing();
    }
    if (!hasPendingChanges()) {
      return;
    }
    drawerView = "handoff";
    drawer.classList.add("rv-open");
    renderDrawer();
  });
  bar.append(finishBtn);
  function hasNestedValues(value) {
    if (!value || typeof value !== "object") {
      return false;
    }
    return Object.keys(value).some((key) => {
      var child = value[key];
      return child && typeof child === "object" ? Object.keys(child).length > 0 : child != null;
    });
  }
  function hasPendingChanges() {
    return Boolean(
      (state.general_notes || "").trim() ||
      (state.comments || []).length ||
      (state.edits || []).length ||
      (state.sections || []).length ||
      (state.slides || []).length ||
      hasNestedValues(state.orders) ||
      hasNestedValues(state.tokens) ||
      hasNestedValues(state.swaps) ||
      hasNestedValues(state.canvas_edits) ||
      hasNestedValues(state.roadmap_key_items) ||
      (state.look && state.look.style) ||
      (state.verdict && state.verdict.preferred),
    );
  }
  const TOKEN_NAMES = {
    font_pct: "Type scale",
    space_scale: "Content spacing",
    measure: "Text width",
    orb_opacity: "Background glow",
    accent: "Accent color",
    accent_preset: "Accent brand preset",
    accent_mode: "Color accessibility",
  };
  function shortText(value, limit) {
    const text = String(value == null ? "" : value)
      .replaceAll(/\s+/g, " ")
      .trim();
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
  }
  function pendingValue(value) {
    if (value === true) {
      return "On";
    }
    if (value === false) {
      return "Off";
    }
    const labels = {
      minimal: "Key only",
      contextual: "More detail",
      "main-flow": "Main flow",
      adyen: "Adyen brand",
      standard: "Normal",
      workstreams: "Workstreams",
      phases: "Phases",
      timeline: "Timeline",
      stages: "Stages",
      groups: "Groups",
      free: "Free",
      key: "Key items",
      follow: "Follow steps",
      safe: "Color-vision safe",
      contrast: "High contrast",
    };
    return labels[value] || String(value == null ? "" : value);
  }
  function changedTo(value) {
    return `Change to: ${pendingValue(value)}`;
  }
  function studioPendingCopy(key, value) {
    const marker = " · ";
    let stableTarget = "";
    if (key.charAt(0) === "@") {
      const readableAt = key.indexOf(marker);
      const identity = readableAt !== -1 ? key.slice(1, readableAt) : key.slice(1);
      stableTarget = identity.split("|")[0];
      let host = null;
      try {
        host = document.querySelector(stableTarget);
      } catch {}
      const section = host && host.closest("section");
      const heading = section && section.querySelector("h1,h2,h3");
      if (heading) {
        const settingKey = identity.split("|")[1] || "Setting";
        const settingLabels = {
          layout: "Layout",
          detail: "Text",
          typeScale: "Text size",
          items: "Items",
          view: "View",
          motion: "Motion",
          pattern: "Pattern",
          showDependencies: "Dependencies",
        };
        const architecture = host && host.classList.contains("kdf-architecture");
        const architectureValues = {
          free: "System map",
          stages: "Domain detail",
          "main-flow": "Request journey",
          groups: "Domain overview",
        };
        const roadmap = host && host.classList.contains("krm");
        const roadmapValues = {
          key: "Key commitments",
          all: "All work",
          follow: "Spotlight step",
          full: "Keep context",
        };
        return {
          label:
            shortText(heading.textContent, 64) + " · " + (settingLabels[settingKey] || settingKey),
          detail:
            architecture && architectureValues[value]
              ? `Change to: ${architectureValues[value]}`
              : roadmap && roadmapValues[value]
                ? `Change to: ${roadmapValues[value]}`
                : changedTo(value),
        };
      }
      if (readableAt !== -1) {
        key = key.slice(readableAt + marker.length);
      }
    }
    const splitAt = key.lastIndexOf(marker);
    const owner = splitAt !== -1 ? key.slice(0, splitAt) : "";
    const setting = splitAt !== -1 ? key.slice(splitAt + marker.length) : key;
    const context = shortText(owner + (stableTarget ? " · " + stableTarget : ""), 84);
    const detail = (context ? context + " · " : "") + changedTo(value);
    if (setting === "walkthrough steps") {
      return {
        detail,
        label: "Chart · Walkthrough steps",
      };
    }
    if (setting === "chart type") {
      return {
        detail,
        label: "Chart · Chart type",
      };
    }
    return { detail: changedTo(value), label: key };
  }
  function pendingChanges() {
    const items = [];
    const multiVariant = variants.length > 1;
    function variantPrefix(label) {
      return multiVariant ? `Variant ${label} · ` : "";
    }
    if ((state.general_notes || "").trim()) {
      items.push({
        detail: shortText(state.general_notes, 140),
        discard() {
          state.general_notes = "";
        },
        kind: "general",
        label: "General note",
      });
    }
    (state.comments || []).forEach((comment) => {
      items.push({
        kind: "note",
        label: "Note #" + comment.id + (comment.kind === "remix" ? " · asking for ideas" : ""),
        detail: shortText(comment.comment, 140) + (comment.section ? " · " + comment.section : ""),
        discard() {
          state.comments = state.comments.filter(function (item) {
            return item.id !== comment.id;
          });
        },
      });
    });
    (state.edits || []).forEach((edit, index) => {
      items.push({
        kind: "edit",
        label: variantPrefix(edit.variant || LABEL) + "Text edit " + (index + 1),
        detail: shortText(edit.before, 64) + " → " + shortText(edit.after, 64),
        discard() {
          state.edits = (state.edits || []).filter(function (item) {
            return item !== edit;
          });
          var node = null;
          try {
            node = document.querySelector(edit.selector);
          } catch {}
          // `after` may carry serialized markup (a <em>b</em>); the node
          // shows its flattened text, so compare against a probe painted
          // the same way the apply path paints the draft. Restore through
          // the styled original when the record carries it — a plain
          // textContent restore would flatten the markup away.
          var probe = document.createElement("div");
          paintDraftText(probe, edit.after);
          if (node && node.textContent === probe.textContent) {
            if (edit.beforeMarkup) {
              paintDraftText(node, edit.beforeMarkup);
            } else {
              node.textContent = edit.before;
            }
          }
        },
      });
    });
    (state.sections || []).forEach((section) => {
      items.push({
        kind: "section",
        label: variantPrefix(section.variant || LABEL) + "Section slide · " + section.title,
        detail: "Before #" + section.target + " · " + section.pattern + " pattern",
        discard() {
          if (section.variant === LABEL) {
            store.removeSection(section.id);
          } else {
            state.sections = (state.sections || []).filter((item) => item.id !== section.id);
          }
          if (section.variant === LABEL && typeof window.__studioDiscardSection === "function") {
            return window.__studioDiscardSection(section.id);
          }
          return true;
        },
      });
    });
    (state.slides || []).forEach((slide) => {
      items.push({
        kind: "slide",
        label:
          variantPrefix(slide.variant || LABEL) +
          (slide.action === "remove" ? "Remove slide · " : "New slide · ") +
          slide.title,
        detail:
          slide.action === "remove"
            ? "Removed from preview; source changes after the agent applies this review"
            : slide.visual +
              " · sample preview" +
              (slide.brief ? " · " + slide.brief : " · add a brief before applying"),
        discard() {
          if (slide.variant === LABEL) {
            store.removeSlide(slide.id);
          } else {
            state.slides = state.slides.filter((item) => item.id !== slide.id);
          }
          return slide.variant === LABEL && window.__studioDiscardSlide
            ? window.__studioDiscardSlide(slide.id)
            : true;
        },
      });
    });
    Object.keys(state.orders || {}).forEach((variant) => {
      items.push({
        kind: "order",
        label: variantPrefix(variant) + "Section order",
        detail: state.orders[variant].length + " sections · matches the story navigation",
        discard() {
          delete state.orders[variant];
          if (variant === LABEL && window.__studioDiscardOrder) {
            return window.__studioDiscardOrder();
          }
          return true;
        },
      });
    });
    Object.keys(state.tokens || {}).forEach((variant) => {
      Object.keys(state.tokens[variant] || {}).forEach(function (key) {
        items.push({
          kind: "design",
          label: variantPrefix(variant) + (TOKEN_NAMES[key] || key),
          detail: changedTo(state.tokens[variant][key]),
          discard() {
            delete state.tokens[variant][key];
            if (!Object.keys(state.tokens[variant]).length) {
              delete state.tokens[variant];
            }
            if (variant === LABEL) {
              applyTokens(currentTokens());
            }
          },
        });
      });
    });
    Object.entries(state.canvas_edits || {}).forEach(([variant, hosts]) => {
      Object.entries(hosts).forEach(([id, edits]) => {
        const host = variant === LABEL ? document.querySelector("#" + CSS.escape(id)) : null;
        const section = host && host.closest("section");
        const heading = section && section.querySelector("h1,h2,h3");
        const kit = globalThis.ExplainerKit;
        const editor =
          host && kit && typeof kit.canvasEditor === "function" ? kit.canvasEditor(host) : null;
        // A rebuild can change the host's editor kind under a saved record;
        // one incompatible record must not take the Changes list down.
        let detail = "Saved canvas adjustments";
        if (editor && edits && edits.kind === editor.kind) {
          try {
            detail = editor.describeChanges(edits);
          } catch (error) {
            console.warn("Saved canvas adjustments could not be described", id, error);
          }
        }
        items.push({
          kind: "canvas",
          label:
            variantPrefix(variant) + (heading ? heading.textContent : id) + " · Canvas adjustments",
          detail,
          discard() {
            delete state.canvas_edits[variant][id];
            if (!Object.keys(state.canvas_edits[variant]).length) {
              delete state.canvas_edits[variant];
            }
            return (
              variant !== LABEL ||
              (window.__studioDiscardCanvas && window.__studioDiscardCanvas(id))
            );
          },
        });
      });
    });
    Object.entries(state.roadmap_key_items || {}).forEach(([variant, hosts]) => {
      Object.entries(hosts).forEach(([id, record]) => {
        const labels = Array.isArray(record.labels) ? record.labels : [];
        const ids = Array.isArray(record.item_ids) ? record.item_ids : [];
        items.push({
          kind: "roadmap-key-items",
          label: variantPrefix(variant) + "Roadmap · Key commitments",
          detail: labels.length ? labels.join(", ") : ids.join(", "),
          discard() {
            delete state.roadmap_key_items[variant][id];
            if (!Object.keys(state.roadmap_key_items[variant]).length) {
              delete state.roadmap_key_items[variant];
            }
            return (
              variant !== LABEL ||
              (typeof window.__studioDiscardRoadmapKeyItems === "function" &&
                window.__studioDiscardRoadmapKeyItems(id))
            );
          },
        });
      });
    });
    Object.keys(state.swaps || {}).forEach((variant) => {
      Object.keys(state.swaps[variant] || {}).forEach(function (key) {
        var copy = studioPendingCopy(key, state.swaps[variant][key]);
        items.push({
          kind: "studio",
          label: variantPrefix(variant) + copy.label,
          detail: copy.detail,
          discard() {
            delete state.swaps[variant][key];
            if (!Object.keys(state.swaps[variant]).length) {
              delete state.swaps[variant];
            }
            if (variant !== LABEL) {
              return true;
            }
            if (typeof window.__studioDiscardSwap === "function") {
              return window.__studioDiscardSwap(key);
            }
            return false;
          },
        });
      });
    });
    if (state.look && state.look.style) {
      items.push({
        detail: changedTo(state.look.style),
        discard() {
          state.look = null;
        },
        kind: "look",
        label: variantPrefix(state.look.variant || LABEL) + "Look",
        previewStale: true,
      });
    }
    if (state.verdict && state.verdict.preferred) {
      items.push({
        detail: changedTo(state.verdict.preferred),
        discard() {
          state.verdict = null;
          if (preferBtn) {
            preferBtn.textContent = "Prefer " + LABEL;
          }
        },
        kind: "variant",
        label: "Preferred variant",
      });
    }
    return items;
  }
  function completeDiscard(message, stale) {
    updatePendingUI();
    renderDrawer();
    placePins();
    return save(true).then((saved) => {
      if (!saved) {
        return false;
      }
      if (stale) {
        try {
          sessionStorage.setItem("rv-return-" + LABEL, drawerView);
        } catch {}
        const destination = new URL(window.location.href);
        if (!state.look) {
          destination.searchParams.delete("style");
        }
        window.location.href = destination.pathname + destination.search;
      } else {
        toast(message);
      }
      return true;
    });
  }
  function discardPending(item) {
    const stale = item.discard() === false || item.previewStale;
    return completeDiscard("Change discarded", stale);
  }
  function discardAllPending() {
    if (!window.confirm("Discard every pending Note, edit, section slide, and setting?")) {
      return;
    }
    state.general_notes = "";
    state.comments = [];
    state.edits = [];
    state.sections = [];
    state.slides = [];
    state.orders = {};
    state.tokens = {};
    state.swaps = {};
    state.canvas_edits = {};
    state.roadmap_key_items = {};
    state.look = null;
    state.verdict = null;
    applyTokens({});
    if (preferBtn) {
      preferBtn.textContent = "Prefer " + LABEL;
    }
    updatePendingUI();
    return save(true).then((saved) => {
      if (saved) {
        window.location.href = window.location.pathname;
      }
      return saved;
    });
  }
  function pendingRow(item, actionLabel) {
    const row = el("div", "rv-pending-row");
    const copy = el("div", "rv-pending-copy");
    copy.append(el("div", "rv-pending-label", esc(item.label)));
    if (item.detail) {
      copy.appendChild(el("div", "rv-pending-detail", esc(item.detail)));
    }
    row.append(copy);
    const discard = el("button", "rv-pending-discard", actionLabel || "Discard");
    discard.type = "button";
    discard.addEventListener("click", () => {
      discardPending(item);
    });
    row.append(discard);
    return row;
  }
  function updatePendingUI() {
    const pending = hasPendingChanges();
    const changes = pendingChanges();
    const previews = changes.filter((item) => item.kind !== "note" && item.kind !== "general");
    finishBtn.hidden = !pending;
    finishBtn.disabled = !pending;
    finishBtn.title = pending
      ? agentHandoff
        ? "Finish for agent: review feedback, then send it"
        : "Finish for agent: review feedback, then copy the instruction"
      : "Add a note or preview a change to prepare feedback for your agent";
    previewStatus.hidden = previews.length === 0;
    previewStatus.textContent = previews.length
      ? RV.studio
        ? "Not saved yet"
        : "Preview only"
      : "";
    previewStatus.title = RV.studio
      ? "Use Save edits in Studio for supported deterministic changes, or Finish to involve your agent."
      : "These changes are visible here, but they are not in the assembled HTML yet. Finish to prepare the instruction for your agent.";
    if (!pending && drawerView === "handoff") {
      drawerView = "notes";
    }
  }
  function updateBadge() {
    const count = pendingChanges().length;
    drawerBtn.innerHTML = `Changes${
      count ? '<span class="rv-count-badge">' + count + "</span>" : ""
    }`;
    updatePendingUI();
  }

  /* ── edit-text mode: type on the page, keep it, then save or delegate ──
     Drafts live in review state and re-apply on every load. Studio can project
     guarded replacements into the source's authoring manifest; plain Review
     mode keeps the established agent handoff. */
  let editing = false;
  let editSnapshot = null;
  let editBanner = null;
  const EDIT_TAGS = "h1,h2,h3,h4,p,li,blockquote,figcaption,td,th,span,b,em,strong";
  function textHosts() {
    const nodes = [];
    document.querySelectorAll(EDIT_TAGS).forEach((n) => {
      if (n.closest("#rv-root") || n.closest("#st-root")) {
        return;
      }
      for (var i = 0; i < n.childNodes.length; i++) {
        var c = n.childNodes[i];
        if (c.nodeType === 3 && c.nodeValue.trim()) {
          nodes.push(n);
          return;
        }
      }
    });
    return nodes;
  }
  function recordEdit(edit) {
    state.edits = state.edits || [];
    for (let i = 0; i < state.edits.length; i++) {
      const e = state.edits[i];
      if (e.selector === edit.selector && e.variant === edit.variant) {
        edit.before = e.before; // Chain re-edits back to the true original
        if (e.beforeMarkup) {
          edit.beforeMarkup = e.beforeMarkup; // and its styled original
        }
        state.edits.splice(i, 1);
        break;
      }
    }
    if (edit.before !== edit.after) {
      state.edits.push(edit);
    }
  }
  function toggleEditing() {
    if (document.body.classList.contains("presenting")) {
      toast("exit Present mode (Esc) first");
      return;
    }
    if (agentWaiting() && !editing) {
      toast("Editing is paused while your agent applies the review", 4000);
      return;
    }
    editing = !editing;
    editBtn.textContent = editing ? "Done editing" : "Edit text";
    editBtn.classList.toggle("rv-on", editing);
    if (editing) {
      drawer.classList.remove("rv-open");
      if (commentBtn.classList.contains("rv-on")) {
        toggleCommentMode();
      }
      editSnapshot = textHosts().map((n) => [n, n.textContent]);
      document.body.setAttribute("contenteditable", "true");
      root.setAttribute("contenteditable", "false");
      const st = document.querySelector("#st-root");
      if (st) {
        st.setAttribute("contenteditable", "false");
      }
      document.body.classList.add("rv-editing");
      editBanner = el("div", "rv-edit-banner");
      editBanner.innerHTML =
        "Editing — click any text to change it. Press <b>Esc</b> or click outside to save.";
      root.append(editBanner);
    } else {
      document.body.removeAttribute("contenteditable");
      document.body.classList.remove("rv-editing");
      if (editBanner) {
        editBanner.remove();
        editBanner = null;
      }
      const changed = [];
      (editSnapshot || []).forEach((pair) => {
        if (pair[0].isConnected && pair[0].textContent !== pair[1]) {
          changed.push(pair[0]);
        }
      });
      // Keep only the OUTERMOST changed element: its textContent is the
      // Complete before/after, so the agent gets one verbatim replacement
      const outer = changed.filter(function (n) {
        var p = n.parentElement;
        while (p) {
          if (changed.includes(p)) {
            return false;
          }
          p = p.parentElement;
        }
        return true;
      });
      outer.forEach((n) => {
        var orig = "";
        for (var i = 0; i < editSnapshot.length; i++) {
          if (editSnapshot[i][0] === n) {
            orig = editSnapshot[i][1];
            break;
          }
        }
        var section = n.closest("section[id]");
        recordEdit({
          selector: cssPath(n),
          before: orig,
          after: n.textContent,
          section: section ? "#" + section.id : "",
          variant: LABEL,
          created: new Date().toISOString(),
        });
      });
      editSnapshot = null;
      if (outer.length > 0) {
        save(true);
        renderDrawer();
        toast(
          `${outer.length} text edit${outer.length === 1 ? "" : "s"} recorded — ${
            RV.studio ? "use Save edits in Studio" : '"apply my review" bakes them into the source'
          }`,
          true,
        );
      } else {
        toast("no text changes");
      }
    }
  }
  /* Saved edits re-apply on every load and style flip — the page keeps
     showing the reviewer's words until the agent bakes them in. A draft's
     `after` may carry the passive-inline allowlist (b, code, em, br) a
     Studio prose commit serializes; it paints as real markup so an unsaved
     styled edit stays styled, never literal tags. Anything outside the
     allowlist stays literal text — the value is never trusted as HTML. */
  function paintDraftText(target, value) {
    const paint =
      (window.ExplainerAuthoring && window.ExplainerAuthoring.paintInline) ||
      window.kitSetPassiveInline;
    if (typeof paint === "function") {
      paint(target, value);
      return;
    }
    const source = String(value == null ? "" : value);
    const tags = /<\/?(?:b|code|em|br)>/gi;
    const stack = [target];
    let offset = 0;
    target.replaceChildren();
    source.replaceAll(tags, (token, at) => {
      if (at > offset) {
        stack.at(-1).append(document.createTextNode(source.slice(offset, at)));
      }
      const closing = token.startsWith("</");
      const tag = token.match(/^<\/?([a-z]+)/i)[1].toLowerCase();
      if (!closing) {
        const child = document.createElement(tag);
        stack.at(-1).append(child);
        if (tag !== "br") {
          stack.push(child);
        }
      } else if (stack.length > 1 && stack.at(-1).localName === tag) {
        stack.pop();
      } else {
        stack.at(-1).append(document.createTextNode(token));
      }
      offset = at + token.length;
      return token;
    });
    if (offset < source.length) {
      stack.at(-1).append(document.createTextNode(source.slice(offset)));
    }
    return target;
  }
  function applyEdits() {
    (state.edits || []).forEach((e) => {
      var n;
      try {
        n = document.querySelector(e.selector);
      } catch {
        return;
      }
      if (n && n.textContent === e.before) {
        paintDraftText(n, e.after);
      }
    });
  }
  applyEdits();

  /* Click-outside-to-save: during editing mode, clicking on the review/studio
     chrome or on non-text empty space saves and exits — the reviewer never
     has to wonder "am I still editing?" or worry about breaking something. */
  document.addEventListener(
    "mousedown",
    (e) => {
      if (!editing) {
        return;
      }
      // The Edit text button owns its own toggle on click; exiting here as
      // well would flip editing off and straight back on.
      if (e.target.closest(".rv-tool-edit")) {
        return;
      }
      if (e.target.closest("#rv-root") || e.target.closest("#st-root")) {
        toggleEditing();
        if (!e.target.closest("button, a, input, select, textarea")) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      var textEl = e.target.closest(EDIT_TAGS);
      if (!textEl) {
        toggleEditing();
      }
    },
    true,
  );

  /* Clear the current pass everywhere it lives: review state, tuner tokens,
     and any studio-side previews. Rolls the state back if the clearing save
     cannot reach the server. Used by the fresh-pass bar and by the handoff
     acknowledgement, which starts the clean pass automatically. */
  function startCleanPass(onCleared) {
    const snapshot = structuredClone(state);
    state.general_notes = "";
    state.comments = [];
    state.edits = [];
    state.sections = [];
    state.slides = [];
    state.tokens = {};
    state.swaps = {};
    state.canvas_edits = {};
    state.roadmap_key_items = {};
    state.look = null;
    state.verdict = null;
    applyTokens({});
    if (preferBtn) {
      preferBtn.textContent = "Prefer " + LABEL;
    }
    renderDrawer();
    placePins();
    return save(true).then(function (saved) {
      if (saved) {
        Object.keys((snapshot.canvas_edits || {})[LABEL] || {}).forEach((id) => {
          if (window.__studioDiscardCanvas) {
            window.__studioDiscardCanvas(id);
          }
        });
        var currentSwaps = (snapshot.swaps && snapshot.swaps[LABEL]) || {};
        if (typeof window.__studioDiscardSwap === "function") {
          Object.keys(currentSwaps).forEach(function (key) {
            window.__studioDiscardSwap(key);
          });
        }
        if (typeof window.__studioDiscardSection === "function") {
          (snapshot.sections || []).forEach(function (section) {
            if (section.variant === LABEL) {
              window.__studioDiscardSection(section.id);
            }
          });
        }
        (snapshot.slides || []).forEach((slide) => {
          if (slide.variant === LABEL && window.__studioDiscardSlide) {
            window.__studioDiscardSlide(slide.id);
          }
        });
        if (onCleared) {
          onCleared();
        }
        toast("clean slate saved — pass cleared", true);
        return true;
      }
      Object.keys(state).forEach(function (key) {
        delete state[key];
      });
      Object.keys(snapshot).forEach(function (key) {
        state[key] = snapshot[key];
      });
      applyTokens(currentTokens());
      if (preferBtn && state.verdict && state.verdict.preferred === LABEL) {
        preferBtn.textContent = "Preferred " + LABEL;
      }
      renderDrawer();
      placePins();
      toast("could not save the clean pass — notes kept", true);
      return false;
    });
  }

  /* The acknowledgement toast is easy to miss when the reviewer looked away
     during the wait; keep a dismissible banner on screen until they confirm
     the rebuild landed. */
  function showAppliedBanner() {
    if (!RV.built_ms) {
      return;
    }
    document.querySelectorAll(".rv-fresh").forEach((existing) => existing.remove());
    const when = new Date(RV.built_ms);
    const hh = ("0" + when.getHours()).slice(-2) + ":" + ("0" + when.getMinutes()).slice(-2);
    const banner = el("div", "rv-fresh");
    banner.append(
      el(
        "span",
        null,
        `Your agent applied the review — this page was <b>rebuilt at ${hh}</b>${
          hasPendingChanges() ? " · pass cleared" : ""
        }. Re-note anything the rebuild missed.`,
      ),
    );
    const gotIt = el("button", "rv-fresh-keep", "Got it");
    gotIt.addEventListener("click", () => {
      banner.remove();
    });
    banner.append(gotIt);
    root.append(banner);
  }

  /* A rebuild is a prompt to verify, not proof that every note was applied.
     Keep the complete review until the reviewer explicitly starts a clean
     pass, and keep it again if that clearing save does not reach the server.
     The agent handoff skips this bar: its acknowledgement starts the clean
     pass automatically once the rebuilt page is loaded and verified. */
  (function freshPass() {
    const updatedMs = Date.parse(state.updated || "") || 0;
    if (!RV.built_ms || !hasPendingChanges() || RV.built_ms <= updatedMs) {
      return;
    }
    if (RV.handoff && RV.handoff.status === "ready") {
      return;
    }
    const freshBar = el("div", "rv-fresh");
    const when = new Date(RV.built_ms);
    const hh = ("0" + when.getHours()).slice(-2) + ":" + ("0" + when.getMinutes()).slice(-2);
    freshBar.append(
      el("span", null, `Page <b>rebuilt at ${hh}</b> — verify your feedback before clearing it.`),
    );
    const clear = el("button", "rv-fresh-go", "Start a fresh pass");
    clear.title = "After verification, clear the Changes, text edits, and settings from this pass";
    clear.addEventListener("click", () => {
      clear.disabled = true;
      return startCleanPass(() => {
        freshBar.remove();
      });
    });
    const keep = el("button", "rv-fresh-keep", "keep for verification");
    keep.addEventListener("click", () => {
      freshBar.remove();
    });
    freshBar.append(clear);
    freshBar.append(keep);
    root.append(freshBar);
  })();

  const toastEl = el("div", "rv-toast");
  toastEl.setAttribute("role", "status");
  toastEl.setAttribute("aria-live", "polite");
  toastEl.setAttribute("aria-atomic", "true");
  root.append(toastEl);
  let toastTimer = null,
    toastHold = 0;
  // Hold (ms) marks a teaching toast the routine "saved" must not overwrite
  function toast(msg, hold) {
    if (!hold && Date.now() < toastHold) {
      return;
    }
    if (hold) {
      toastHold = Date.now() + hold;
    }
    toastEl.textContent = msg;
    toastEl.classList.add("rv-show");
    if (toastTimer) {
      clearTimeout(toastTimer);
    }
    toastTimer = setTimeout(() => {
      toastEl.classList.remove("rv-show");
    }, hold || 1800);
  }

  /* ── comment mode ── */
  let commenting = false,
    hovered = null,
    composer = null;
  function toggleCommentMode() {
    if (document.body.classList.contains("presenting")) {
      toast("exit Present mode (Esc) to add notes");
      return;
    }
    if (agentWaiting() && !commenting) {
      toast("Editing is paused while your agent applies the review", 4000);
      return;
    }
    if (commenting) {
      exitCommentMode();
    } else {
      enterCommentMode();
    }
  }
  function enterCommentMode() {
    commenting = true;
    drawer.classList.remove("rv-open");
    commentBtn.classList.add("rv-on");
    document.documentElement.classList.add("rv-commenting");
    if (window.__revealAll) {
      window.__revealAll();
    }
    toast("drag an area or click an element · Esc to stop");
  }
  function exitCommentMode() {
    cancelArea();
    commenting = false;
    commentBtn.classList.remove("rv-on");
    document.documentElement.classList.remove("rv-commenting");
    setHover(null);
  }
  function setHover(elm) {
    if (hovered) {
      hovered.classList.remove("rv-target-hl");
    }
    hovered = elm;
    if (hovered) {
      hovered.classList.add("rv-target-hl");
    }
  }
  const INLINE = /^(span|b|i|em|strong|code|a|small|sub|sup)$/i;
  function pickTarget(t) {
    if (!t || t.nodeType !== 1) {
      return null;
    }
    while (t && t !== document.body && INLINE.test(t.tagName) && t.parentElement) {
      t = t.parentElement;
    }
    return t === document.body ? null : t;
  }
  function cssEscape(s) {
    return window.CSS && CSS.escape ? CSS.escape(s) : s;
  }
  function cssPath(elm) {
    const parts = [];
    while (elm && elm.nodeType === 1 && elm !== document.body) {
      if (elm.id) {
        parts.unshift(`#${cssEscape(elm.id)}`);
        break;
      }
      const tag = elm.tagName.toLowerCase();
      let n = 1,
        sib = elm;
      while ((sib = sib.previousElementSibling)) {
        if (sib.tagName === elm.tagName) {
          n++;
        }
      }
      parts.unshift(`${tag}:nth-of-type(${n})`);
      elm = elm.parentElement;
    }
    return parts.join(" > ");
  }
  // A rectangle is anchored to its section rather than absolute page pixels.
  // The ordinary click path remains available to keyboard users.
  let areaStart = null;
  let suppressAreaClick = false;
  const areaBox = el("div", "rv-area");
  areaBox.hidden = true;
  document.body.append(areaBox);
  const REVIEW_CHROME =
    "#rv-root,#st-root,.rv-pop,.rv-pin,.st-swap,.st-insert-section,.st-adjust,#themeToggle,#presentToggle";
  function cancelArea() {
    areaStart = null;
    areaBox.hidden = true;
  }
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (
        !commenting ||
        composer ||
        event.button !== 0 ||
        document.body.classList.contains("presenting") ||
        event.target.closest(REVIEW_CHROME)
      ) {
        return;
      }
      const target = event.target.closest(".kdf, section[id]") || pickTarget(event.target);
      if (!target) {
        return;
      }
      areaStart = { x: event.pageX, y: event.pageY, target };
    },
    true,
  );
  document.addEventListener(
    "pointermove",
    (event) => {
      if (!areaStart) {
        return;
      }
      const width = Math.abs(event.pageX - areaStart.x);
      const height = Math.abs(event.pageY - areaStart.y);
      if (width < 6 && height < 6) {
        return;
      }
      areaBox.hidden = false;
      areaBox.style.left = Math.min(event.pageX, areaStart.x) + "px";
      areaBox.style.top = Math.min(event.pageY, areaStart.y) + "px";
      areaBox.style.width = width + "px";
      areaBox.style.height = height + "px";
      setHover(null);
      event.preventDefault();
    },
    { capture: true, passive: false },
  );
  document.addEventListener(
    "pointerup",
    (event) => {
      if (!areaStart) {
        return;
      }
      const start = areaStart;
      areaStart = null;
      if (areaBox.hidden) {
        return;
      }
      const rect = start.target.getBoundingClientRect();
      const clamp = (value) => Math.max(0, Math.min(1, value));
      const x = clamp((Math.min(start.x, event.pageX) - rect.left - window.scrollX) / rect.width);
      const y = clamp((Math.min(start.y, event.pageY) - rect.top - window.scrollY) / rect.height);
      const right = clamp(
        (Math.max(start.x, event.pageX) - rect.left - window.scrollX) / rect.width,
      );
      const bottom = clamp(
        (Math.max(start.y, event.pageY) - rect.top - window.scrollY) / rect.height,
      );
      areaBox.hidden = true;
      if (right <= x || bottom <= y) {
        return;
      }
      suppressAreaClick = true;
      setTimeout(() => {
        suppressAreaClick = false;
      }, 0);
      openComposer(start.target, event.pageX, event.pageY, {
        x,
        y,
        width: right - x,
        height: bottom - y,
      });
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );
  document.addEventListener("pointercancel", cancelArea, true);
  document.addEventListener(
    "mousemove",
    (e) => {
      if (document.body.classList.contains("presenting")) {
        setHover(null);
        return;
      }
      if (!commenting || composer) {
        return;
      }
      if (e.target.closest && e.target.closest(REVIEW_CHROME)) {
        setHover(null);
        return;
      }
      setHover(pickTarget(e.target));
    },
    true,
  );
  document.addEventListener(
    "click",
    (e) => {
      if (suppressAreaClick) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (document.body.classList.contains("presenting")) {
        return;
      }
      if (!commenting || composer) {
        return;
      }
      if (e.target.closest && e.target.closest(REVIEW_CHROME)) {
        return;
      }
      var t = pickTarget(e.target);
      if (!t) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      openComposer(t, e.pageX, e.pageY);
    },
    true,
  );
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") {
        if (document.body.classList.contains("presenting")) {
          return;
        }
        if (editing) {
          toggleEditing();
          e.stopPropagation();
          return;
        }
        if (commenting || composer) {
          closeComposer();
          exitCommentMode();
          e.stopPropagation();
          return;
        }
        if (drawer.classList.contains("rv-open")) {
          drawer.classList.remove("rv-open");
          e.preventDefault();
          e.stopImmediatePropagation();
          drawerBtn.focus();
        }
      }
    },
    true,
  );

  function anchorFor(t) {
    const sec = t.closest && t.closest("section[id]");
    const anyId = t.closest && t.closest("[id]");
    return {
      section: sec ? `#${sec.id}` : anyId && anyId.id ? `#${anyId.id}` : "",
      selector: cssPath(t),
      snippet: (t.textContent || "").replaceAll(/\s+/g, " ").trim().slice(0, 120),
    };
  }
  function openComposer(t, x, y, region = null) {
    closeComposer();
    setHover(region ? null : t);
    if (region) {
      const bounds = t.getBoundingClientRect();
      areaBox.hidden = false;
      areaBox.style.left = bounds.left + window.scrollX + region.x * bounds.width + "px";
      areaBox.style.top = bounds.top + window.scrollY + region.y * bounds.height + "px";
      areaBox.style.width = region.width * bounds.width + "px";
      areaBox.style.height = region.height * bounds.height + "px";
    }
    const a = anchorFor(t);
    composer = el("div", "rv-pop");
    composer.innerHTML = `<div class="rv-where">${esc(
      a.section || a.selector,
    )}${a.snippet ? ' · "' + esc(a.snippet.slice(0, 48)) + '"' : ""}</div>`;
    const ta = el("textarea");
    ta.placeholder = "What should change here?";
    composer.append(ta);
    const acts = el("div", "rv-acts");
    const cancel = el("button", null, "Cancel");
    cancel.addEventListener("click", () => {
      closeComposer();
    });
    function commit(kind) {
      let text = ta.value.trim();
      if (!text && kind === "remix") {
        text =
          "propose 2-3 stronger treatments for this spot — swap the component, cut text for cinema, re-rank the hierarchy, or go bespoke";
      }
      if (!text) {
        closeComposer();
        return;
      }
      let maxId = 0;
      state.comments.forEach((c) => {
        if (c.id > maxId) {
          maxId = c.id;
        }
      });
      state.comments.push({
        comment: text,
        created: new Date().toISOString(),
        id: maxId + 1,
        kind,
        section: a.section,
        selector: a.selector,
        snippet: a.snippet,
        ...(region ? { region } : {}),
        theme: document.documentElement.dataset.theme || "",
        variant: LABEL,
      });
      closeComposer();
      placePins();
      renderDrawer();
      save(true);
      if (kind === "remix") {
        toast("note saved — the agent will propose options here", 3200);
      } else if (state.comments.length === 1) {
        toast("note saved — press Finish when you are done", 3200);
      }
    }
    const remixBtn = el("button", "rv-remixbtn", "Ask for ideas");
    remixBtn.title = "No fix in mind? The agent will propose 2-3 stronger treatments for this spot";
    remixBtn.addEventListener("click", () => {
      commit("remix");
    });
    const saveBtn = el("button", "rv-save", "Save note");
    saveBtn.addEventListener("click", () => {
      commit("note");
    });
    acts.append(cancel);
    acts.append(remixBtn);
    acts.append(saveBtn);
    composer.append(acts);
    document.body.append(composer);
    const w = Math.min(320, window.innerWidth * 0.86);
    composer.style.left = `${Math.max(8, Math.min(x, window.scrollX + window.innerWidth - w - 16))}px`;
    composer.style.top = `${Math.max(window.scrollY + 8, Math.min(y + 12, window.scrollY + window.innerHeight - composer.offsetHeight - 12))}px`;
    ta.focus();
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        saveBtn.click();
      }
      e.stopPropagation();
    });
  }
  function closeComposer() {
    if (composer && composer.parentNode) {
      composer.remove();
    }
    composer = null;
    areaBox.hidden = true;
    setHover(null);
  }

  /* ── pins ── */
  const pinLayer = el("div", "rv-pins");
  document.body.append(pinLayer);
  function placePins() {
    pinLayer.innerHTML = "";
    state.comments.forEach((c) => {
      if (!c.selector) {
        return;
      }
      var t = null;
      try {
        t = document.querySelector(c.selector);
      } catch {}
      if (!t) {
        return;
      }
      var r = t.getBoundingClientRect();
      if (!r.width && !r.height) {
        return;
      }
      var pin = el("button", "rv-pin", String(c.id));
      pin.title = c.comment;
      pin.style.left =
        (c.region ? r.left + (c.region.x + c.region.width) * r.width : r.right) +
        window.scrollX -
        4 +
        "px";
      pin.style.top =
        (c.region ? r.top + c.region.y * r.height : r.top) + window.scrollY + 4 + "px";
      pin.addEventListener("click", function (e) {
        e.stopPropagation();
        openViewer(c, r.right + window.scrollX - 160, r.bottom + window.scrollY + 8);
      });
      pinLayer.appendChild(pin);
    });
  }
  function openViewer(c, x, y) {
    closeComposer();
    composer = el("div", "rv-pop");
    composer.innerHTML =
      `<div class="rv-where">#${c.id} · ${esc(c.section || c.selector)}</div>` +
      `<div>${esc(c.comment)}</div>`;
    const acts = el("div", "rv-acts");
    const del = el("button", null, "Delete");
    del.addEventListener("click", () => {
      state.comments = state.comments.filter(function (o) {
        return o.id !== c.id;
      });
      closeComposer();
      placePins();
      renderDrawer();
      save(true);
    });
    const ok = el("button", "rv-save", "Close");
    ok.addEventListener("click", closeComposer);
    acts.append(del);
    acts.append(ok);
    composer.append(acts);
    document.body.append(composer);
    composer.style.left = `${Math.max(8, x)}px`;
    composer.style.top = `${y}px`;
  }
  window.addEventListener("kitstudiosectionchange", placePins);
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (resizeTimer) {
      clearTimeout(resizeTimer);
    }
    resizeTimer = setTimeout(placePins, 200);
  });
  window.addEventListener("load", () => {
    setTimeout(placePins, 700);
  });
  setTimeout(placePins, 1200);

  /* ── drawer: Notes, pending changes, and the finish/handoff view ── */
  const drawer = el("div", "rv-drawer");
  let drawerView = "notes";
  root.append(drawer);
  /* Anti-affordance: while an agent applies the review, editing controls
     dim (CSS below) and explain themselves on click instead of dying
     silently. Reading stays live — the page, Present mode, the theme
     toggle, and the gallery never pause. */
  function agentWaiting() {
    return document.body.classList.contains("rv-agent-waiting");
  }
  const LOCKED_EDIT_SELECTOR =
    ":is(.rv-mutate, .st-swap, .st-insert-section, .st-adjust, " +
    ".st-panel :is(button, input, select, textarea, summary))";
  document.addEventListener(
    "click",
    (event) => {
      if (!agentWaiting() || !(event.target instanceof Element)) {
        return;
      }
      const control = event.target.closest(LOCKED_EDIT_SELECTOR);
      if (!control) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      toast("Editing is paused while your agent applies the review", 4000);
    },
    true,
  );
  document.addEventListener(
    "focusin",
    (event) => {
      if (!agentWaiting() || !(event.target instanceof Element)) {
        return;
      }
      if (event.target.closest(":is(.rv-mutate, .st-panel :is(input, select, textarea))")) {
        event.target.blur();
        toast("Editing is paused while your agent applies the review", 4000);
      }
    },
    true,
  );
  function syncReviewSurface() {
    const open = drawer.classList.contains("rv-open");
    document.body.classList.toggle("rv-review-open", open);
    requestAnimationFrame(placePins);
    drawerBtn.setAttribute("aria-expanded", String(open && drawerView === "notes"));
    finishBtn.setAttribute("aria-expanded", String(open && drawerView === "handoff"));
  }
  new MutationObserver(syncReviewSurface).observe(drawer, {
    attributes: true,
    attributeFilter: ["class"],
  });
  function reviewHeading(title, subtitle) {
    const heading = el("header", "rv-review-heading");
    heading.append(el("h2", null, title), drawerClose(), el("p", null, subtitle));
    return heading;
  }
  function drawerClose() {
    const b = el("button", "rv-close", "✕");
    b.title = "Close (Esc)";
    b.setAttribute("aria-label", "Close review panel");
    b.addEventListener("click", () => {
      drawer.classList.remove("rv-open");
    });
    return b;
  }
  let previewChangesOpen = false;
  function renderDrawer() {
    updateBadge();
    if (drawerView === "handoff") {
      renderHandoff();
      return;
    }
    drawer.innerHTML = "";
    drawer.dataset.view = "notes";
    syncReviewSurface();
    drawer.append(
      reviewHeading(
        "Changes",
        "Visible adjustments are previews until your agent applies them to the assembled file.",
      ),
    );
    // Notes means notes: the drawer leads with the reviewer's own words.
    // Precision tools live elsewhere — Edit text in the bar, the design
    // Tuner in the studio panel (or below, when reviewing without studio).
    const general = el("details", "rv-general");
    general.open = Boolean(state.general_notes);
    general.append(el("summary", null, "Feedback on the whole story"));
    const ta = el("textarea");
    ta.placeholder = "What should change about the story, order, or tone?";
    ta.setAttribute("aria-label", "Whole story feedback");
    ta.value = state.general_notes;
    let notesTimer = null;
    ta.addEventListener("input", () => {
      state.general_notes = ta.value;
      updatePendingUI();
      if (notesTimer) {
        clearTimeout(notesTimer);
      }
      notesTimer = setTimeout(function () {
        save(true);
      }, 800);
    });
    general.append(ta);
    drawer.append(general);
    const add = el("button", "rv-add-note", "+ Select an area to comment");
    add.addEventListener("click", () => {
      drawer.classList.remove("rv-open");
      if (!commenting) {
        toggleCommentMode();
      }
    });
    drawer.append(add);
    if (!state.comments.length) {
      drawer.append(
        el(
          "p",
          "rv-empty-review",
          "No notes yet. Point to an area on the canvas and describe what you want to change.",
        ),
      );
    }
    state.comments.forEach((c) => {
      let section = null;
      try {
        section = document.querySelector(c.section);
      } catch {}
      const heading = section && section.querySelector("h1,h2,h3");
      const location = heading
        ? shortText(heading.textContent, 72)
        : c.section || c.selector || "Page";
      var row = el("div", "rv-row");
      row.appendChild(el("span", "rv-n", String(c.id)));
      var body = el("div", "rv-body");
      body.appendChild(
        el("div", "rv-where", (c.kind === "remix" ? "Ideas · " : "") + esc(location)),
      );
      body.appendChild(el("div", "rv-text", esc(c.comment)));
      row.appendChild(body);
      var acts = el("div", "rv-acts");
      var go = el("button", null, "Show on canvas");
      go.addEventListener("click", function () {
        var t = null;
        try {
          t = document.querySelector(c.selector);
        } catch {}
        if (t) {
          window.dispatchEvent(new CustomEvent("kitreviewnavigate", { detail: { target: t } }));
          if (window.__revealAll) {
            window.__revealAll();
          }
          drawer.classList.remove("rv-open");
          t.scrollIntoView({ block: "center", behavior: "smooth" });
        } else {
          toast("anchor not found (content changed?)");
        }
      });
      var del = el("button", null, "Delete");
      del.addEventListener("click", function () {
        state.comments = state.comments.filter(function (o) {
          return o.id !== c.id;
        });
        renderDrawer();
        placePins();
        save(true);
      });
      acts.appendChild(go);
      acts.appendChild(del);
      row.appendChild(acts);
      drawer.appendChild(row);
    });

    const previewChanges = pendingChanges().filter(
      (item) => item.kind !== "note" && item.kind !== "general",
    );
    if (previewChanges.length) {
      const previews = el("details", "rv-preview-changes");
      previews.open = previewChangesOpen;
      previews.addEventListener("toggle", () => {
        previewChangesOpen = previews.open;
      });
      previews.append(el("summary", null, "Preview changes · " + previewChanges.length));
      previews.append(
        el(
          "p",
          null,
          RV.studio
            ? "Supported text and visual settings can be saved locally from Studio. Finish still sends notes, custom work, and unsupported changes to your agent."
            : "These adjustments are visible here, but are not yet saved in the assembled HTML. Finish prepares the instruction for your agent.",
        ),
      );
      const selected = new Set();
      const batch = el("div", "rv-batch-actions");
      const selectAll = el("button", null, "Select all");
      const discardSelected = el("button", null, "Discard selected");
      const discardAll = el("button", null, "Discard all preview changes");
      discardSelected.disabled = true;
      const boxes = [];
      function syncSelection() {
        discardSelected.disabled = selected.size === 0;
        discardSelected.textContent = selected.size
          ? "Discard selected · " + selected.size
          : "Discard selected";
        selectAll.textContent =
          selected.size === previewChanges.length ? "Clear selection" : "Select all";
      }
      function discardBatch(items) {
        let stale = false;
        items.forEach((item) => {
          stale = item.discard() === false || item.previewStale || stale;
        });
        previewChangesOpen = true;
        return completeDiscard(items.length + " preview changes discarded", stale);
      }
      selectAll.addEventListener("click", () => {
        const checked = selected.size !== previewChanges.length;
        selected.clear();
        boxes.forEach(({ box, item }) => {
          box.checked = checked;
          if (checked) {
            selected.add(item);
          }
        });
        syncSelection();
      });
      discardSelected.addEventListener("click", () => discardBatch([...selected]));
      discardAll.addEventListener("click", () => discardBatch(previewChanges));
      batch.append(selectAll, discardSelected, discardAll);
      previews.append(batch);
      previewChanges.forEach((item) => {
        const row = pendingRow(item);
        row.classList.add("rv-selectable-change");
        const box = el("input");
        box.type = "checkbox";
        box.setAttribute("aria-label", "Select " + item.label);
        box.addEventListener("change", () => {
          if (box.checked) {
            selected.add(item);
          } else {
            selected.delete(item);
          }
          syncSelection();
        });
        boxes.push({ box, item });
        const selection = el("label", "rv-change-select");
        selection.append(box, row.querySelector(".rv-pending-copy"));
        row.prepend(selection);
        previews.append(row);
      });
      drawer.append(previews);
    }
    // With the studio open, the tuner lives in the studio panel with the
    // Other deterministic tweaks — showing it twice would be noise
    if (!RV.studio) {
      drawer.append(el("div", "rv-h", "design tuner"));
      drawer.append(buildTuner());
    }

    if (hasPendingChanges()) {
      const hint = el(
        "div",
        "rv-hint",
        RV.studio
          ? "Use <b>Save edits</b> for supported local changes. Press <b>Finish</b> when you want your agent to handle the rest."
          : agentHandoff
            ? "Done? Press <b>Finish</b> to review and send these changes to your agent."
            : "Done? Press <b>Finish</b> to review and copy the instruction for your agent.",
      );
      drawer.append(hint);
    }
  }

  let resultWatchTimer = null;
  let resultStatus = null;
  let resultButton = null;
  let sendController = null;
  const HANDOFF_SEND_TIMEOUT_MS = 10_000;
  const HANDOFF_STATUS_TIMEOUT_MS = 5000;
  function reloadUpdatedExplainer() {
    window.location.reload();
  }
  function handoffStatusUrl() {
    const statusUrl = RV.page_status_url || "/api/page-status";
    const separator = statusUrl.includes("?") ? "&" : "?";
    return statusUrl + separator + "index=" + encodeURIComponent(RV.index || 0);
  }
  function fetchHandoffStatus(timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(handoffStatusUrl(), { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error("status unavailable");
        }
        return response.json();
      })
      .finally(() => clearTimeout(timer));
  }
  function reconcileHandoff() {
    return fetchHandoffStatus(HANDOFF_STATUS_TIMEOUT_MS).then((page) => {
      if (page.handoff && typeof page.handoff === "object") {
        handoff = page.handoff;
      }
      const active = handoff.status === "waiting" || handoff.status === "ready";
      if (active) {
        drawerView = "handoff";
        drawer.classList.add("rv-open");
        renderHandoff();
        watchForUpdatedExplainer();
      }
      return active;
    });
  }
  function checkForUpdatedExplainer(manual) {
    if (!resultStatus || !resultButton || !RV.studio) {
      return Promise.resolve(false);
    }
    if (manual) {
      resultStatus.textContent = "Checking the assembled file…";
      resultButton.disabled = true;
    }
    return fetchHandoffStatus(HANDOFF_STATUS_TIMEOUT_MS)
      .then((page) => {
        const previousPhase = handoff.agent_phase;
        const previousDetail = handoff.agent_detail;
        if (page.handoff && typeof page.handoff === "object") {
          handoff = page.handoff;
        }
        const ready =
          handoff.status === "ready" ||
          (handoff.status === "editing" && Number(page.built_ms || 0) > Number(RV.built_ms || 0));
        if (ready) {
          const resultVisible =
            resultButton.isConnected &&
            drawerView === "handoff" &&
            drawer.classList.contains("rv-open");
          if (drawerView === "handoff") {
            /* Re-render so the heading and step rail flip to the ready state. */
            renderHandoff();
          }
          resultStatus.textContent =
            "Your agent rebuilt the explainer. The updated result is ready.";
          resultButton.textContent = "Reload updated explainer";
          resultButton.disabled = false;
          resultButton.classList.add("rv-result-ready");
          resultButton.dataset.ready = "true";
          if (resultWatchTimer) {
            clearInterval(resultWatchTimer);
            resultWatchTimer = null;
          }
          if (agentHandoff && handoff.status === "ready") {
            /* The rebuild is validated and this tab is edit-locked anyway:
               carry the reviewer straight onto the new page instead of
               waiting for another click. The short beat lets the step rail
               flip to ready register before navigation. */
            resultButton.textContent = "Loading the rebuilt explainer…";
            setTimeout(reloadUpdatedExplainer, 900);
          }
          if (!resultVisible) {
            toast("Updated explainer ready — open Finish to reload", 5200);
          }
          return true;
        }
        if (
          handoff.status === "waiting" &&
          drawerView === "handoff" &&
          drawer.classList.contains("rv-open") &&
          (handoff.agent_phase !== previousPhase || handoff.agent_detail !== previousDetail)
        ) {
          renderHandoff();
        }
        if (handoff.agent_phase === "failed" && resultWatchTimer) {
          clearInterval(resultWatchTimer);
          resultWatchTimer = null;
        }
        if (manual) {
          resultStatus.textContent =
            handoff.agent_phase === "failed"
              ? handoff.agent_detail || "The child agent could not finish this review."
              : handoff.status === "waiting"
                ? "Still waiting for your agent. You can cancel it and resume editing, or copy the instruction below if needed."
                : "No rebuild yet. Apply the instruction in your agent session, then check again.";
        }
        resultButton.disabled = false;
        return false;
      })
      .catch(() => {
        if (manual) {
          resultStatus.textContent =
            "Studio could not check automatically. You can still reload after your agent finishes.";
        }
        resultButton.disabled = false;
        return false;
      });
  }
  function watchForUpdatedExplainer() {
    if (!RV.studio || resultWatchTimer) {
      return;
    }
    checkForUpdatedExplainer(false);
    resultWatchTimer = setInterval(() => {
      if (!document.hidden) {
        checkForUpdatedExplainer(false);
      }
    }, 2500);
  }

  function acknowledgeCompletedPage() {
    if (
      !agentHandoff ||
      handoff.status !== "ready" ||
      !handoff.completion_token ||
      handoff.completion_token !== RV.page_token
    ) {
      return;
    }
    fetch(HANDOFF_URL, {
      method: "POST",
      body: JSON.stringify({ action: "acknowledge", page_token: RV.page_token }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("acknowledgement failed");
        }
        return response.json();
      })
      .then((payload) => {
        handoff = payload.handoff || { status: "editing" };
        lockedSaveRejected = false;
        document.body.classList.remove("rv-agent-waiting");
        drawerView = "notes";
        drawer.classList.remove("rv-open");
        showAppliedBanner();
        if (hasPendingChanges()) {
          /* The handed-off pass was consumed by the rebuild now on screen;
             start the clean pass automatically instead of asking for the
             same two clicks again. */
          toast(
            "Updated explainer loaded · pass cleared — re-note anything the rebuild missed",
            6000,
          );
          return startCleanPass(null);
        }
        renderDrawer();
        toast("Updated explainer loaded");
        return payload;
      })
      .catch(() => {
        toast("Reload once more before editing", 4000);
      });
  }

  function copyInstruction(button, instruction, saveFirst) {
    button.disabled = true;
    button.textContent = saveFirst ? "Saving feedback…" : "Copying…";
    const prepared = saveFirst ? save(true) : Promise.resolve(true);
    return prepared.then((saved) => {
      if (!saved) {
        button.textContent = "Save failed — try again";
        button.disabled = false;
        return false;
      }
      const copied =
        navigator.clipboard && navigator.clipboard.writeText
          ? navigator.clipboard.writeText(instruction)
          : Promise.reject(new Error("Clipboard unavailable"));
      return copied
        .then(() => {
          button.textContent = "Copied · paste into your agent";
          button.classList.add("rv-copied");
          watchForUpdatedExplainer();
          return true;
        })
        .catch(() => {
          button.textContent = "Select and copy the instruction above";
          return false;
        })
        .finally(() => {
          button.disabled = false;
        });
    });
  }

  /* The handoff: Studio owns the selected harness adapter and its child session. */

  /* Live wait feedback: a spinner, an elapsed clock anchored to the server's
     send time, and a three-step rail — the wait can run ~2 minutes and a
     silent drawer reads as a dead one. */
  let handoffTickTimer = null;
  function stopHandoffTicker() {
    if (handoffTickTimer) {
      clearInterval(handoffTickTimer);
      handoffTickTimer = null;
    }
  }
  function startHandoffTicker(clock) {
    stopHandoffTicker();
    const sentMs = Number(handoff.created_ms || 0) || Date.now();
    const draw = () => {
      const secs = Math.max(0, Math.round((Date.now() - sentMs) / 1000));
      clock.textContent =
        (handoff.agent_detail || "waiting for the rebuild") +
        " · " +
        Math.floor(secs / 60) +
        ":" +
        ("0" + (secs % 60)).slice(-2);
    };
    draw();
    handoffTickTimer = setInterval(() => {
      if (!clock.isConnected || handoff.status !== "waiting") {
        stopHandoffTicker();
        return;
      }
      draw();
    }, 1000);
  }
  function handoffStepRail(waiting) {
    const rail = el("ol", "rv-ho-steps");
    const step = (label, note, status) => {
      const row = el("li", "rv-ho-step rv-ho-" + status);
      row.append(el("span", null, label));
      row.append(el("span", "rv-ho-note", note));
      return row;
    };
    rail.append(
      step("01 · Sent to your agent", "✓ done", "done"),
      step(
        "02 · Agent applies the review",
        waiting
          ? handoff.agent_phase === "failed"
            ? "needs attention"
            : handoff.agent_phase === "queued"
              ? "queued"
              : "in progress"
          : "✓ done",
        waiting && handoff.agent_phase !== "failed" ? "active" : waiting ? "todo" : "done",
      ),
      step(
        "03 · Reload the rebuilt explainer",
        waiting ? "waiting" : "ready to reload",
        waiting ? "todo" : "active",
      ),
    );
    return rail;
  }

  function renderHandoff() {
    drawer.innerHTML = "";
    stopHandoffTicker();
    drawer.dataset.view = "handoff";
    syncReviewSurface();
    const instruction = "Apply the review in " + (RV.md_path || "");
    const waiting = agentHandoff && handoff.status === "waiting";
    const agentFailed = waiting && handoff.agent_phase === "failed";
    const locked = waiting || (agentHandoff && handoff.status === "ready");
    document.body.classList.toggle("rv-agent-waiting", locked);
    if (locked && editing) {
      toggleEditing();
    }
    if (locked) {
      const heading = el("header", "rv-review-heading");
      heading.append(
        el(
          "h2",
          null,
          agentFailed
            ? "Your agent needs attention"
            : waiting
              ? "Waiting for your agent"
              : "Updated explainer is ready",
        ),
        el(
          "p",
          null,
          lockedSaveRejected
            ? "The handed-off review is saved. Your latest attempted edit was not saved."
            : agentFailed
              ? esc(handoff.agent_detail || "The agent could not finish this review.")
              : waiting
                ? "Your review is saved and editing is paused while the agent works. This page keeps showing the version you handed off; the rebuilt explainer appears when your agent finishes."
                : "Reload to move this tab onto the rebuilt page before editing.",
        ),
      );
      drawer.append(heading);
      if (waiting && !agentFailed) {
        const live = el("div", "rv-handoff-live");
        const pulse = el("span", "rv-spinner");
        pulse.setAttribute("aria-hidden", "true");
        const clock = el("span", null, esc(handoff.agent_detail || "waiting for the rebuild"));
        live.append(pulse, clock);
        drawer.append(live);
        startHandoffTicker(clock);
      }
      drawer.append(handoffStepRail(waiting));
    } else {
      drawer.append(
        reviewHeading("Ready for your agent", "Your feedback and preview changes travel together."),
      );
    }

    if (agentHandoff && !locked) {
      const send = el("div", "rv-delivery");
      send.append(el("span", "rv-step-label", "01 · Send"));
      send.append(el("h3", null, "Hand this review to your agent"));
      send.append(
        el(
          "p",
          null,
          "Studio saves the review, pauses editing, and sends it to its dedicated " +
            (RV.agent_adapter || "agent") +
            " session.",
        ),
      );
      const sendBtn = el("button", "rv-copybtn", "Send to agent");
      sendBtn.addEventListener("click", () => {
        if (saveTimer) {
          clearTimeout(saveTimer);
          saveTimer = null;
        }
        if (pendingSaveResolve) {
          pendingSaveResolve(false);
          pendingSaveResolve = null;
        }
        sendBtn.disabled = true;
        sendBtn.textContent = "Sending…";
        const controller = new AbortController();
        sendController = controller;
        const sendTimer = setTimeout(() => controller.abort(), HANDOFF_SEND_TIMEOUT_MS);
        return fetch(HANDOFF_URL, {
          method: "POST",
          body: JSON.stringify({
            action: "send",
            index: RV.index || 0,
            page_token: RV.page_token,
            state,
          }),
          signal: controller.signal,
        })
          .then((response) => response.json().then((payload) => ({ ok: response.ok, payload })))
          .then(({ ok, payload }) => {
            if (!ok) {
              throw new Error(payload.error || "handoff failed");
            }
            handoff = payload.handoff || { status: "waiting" };
            document.body.classList.add("rv-agent-waiting");
            renderHandoff();
            watchForUpdatedExplainer();
            return payload;
          })
          .catch((error) =>
            reconcileHandoff()
              .then((accepted) => {
                if (accepted) {
                  return true;
                }
                sendBtn.disabled = false;
                sendBtn.textContent = "Send to agent";
                toast(error.message || "Studio did not accept the review", 4500);
                return false;
              })
              .catch(() => {
                sendBtn.disabled = false;
                sendBtn.textContent = "Send to agent";
                toast("Studio did not answer · reload this explainer to recover", 6000);
                return false;
              }),
          )
          .finally(() => {
            clearTimeout(sendTimer);
            if (sendController === controller) {
              sendController = null;
            }
          });
      });
      send.append(sendBtn);
      drawer.append(send);
    }

    if (!agentHandoff) {
      const delivery = el("div", "rv-delivery");
      delivery.append(el("span", "rv-step-label", "01 · Copy"));
      delivery.append(el("h3", null, "Copy the agent instruction"));
      delivery.append(
        el(
          "p",
          null,
          "It points to the saved review containing your note and every preview change.",
        ),
      );
      const box = el("div", "rv-copybox");
      box.textContent = instruction;
      delivery.append(box);
      const copyBtn = el("button", "rv-copybtn", "Copy instruction");
      copyBtn.addEventListener("click", () => copyInstruction(copyBtn, instruction, true));
      delivery.append(copyBtn);
      drawer.append(delivery);
      const next = el("div", "rv-return-step");
      next.append(el("span", "rv-step-label", "02 · Apply"));
      next.append(el("h3", null, "Paste it into the creating session"));
      next.append(
        el(
          "p",
          null,
          "Your agent edits the source and rebuilds the explainer. Keep this Studio tab open while it works.",
        ),
      );
      drawer.append(next);
    }

    const result = el("div", "rv-return-step rv-result-step");
    result.append(
      el("span", "rv-step-label", RV.studio ? "02 · See the result" : "03 · See the result"),
    );
    result.append(
      el(
        "h3",
        null,
        agentFailed
          ? "Review is still safely locked"
          : waiting
            ? "Studio is watching for the rebuild"
            : "Return here when the agent finishes",
      ),
    );
    resultStatus = el(
      "p",
      "rv-result-status",
      RV.studio
        ? waiting && handoff.agent_detail
          ? esc(handoff.agent_detail)
          : "Studio watches the assembled file and will tell you when the rebuild is ready."
        : "Reload this page after your agent rebuilds the explainer.",
    );
    result.append(resultStatus);
    resultButton = el(
      "button",
      "rv-check-result",
      RV.studio ? "Check for updated explainer" : "Reload to see the result",
    );
    resultButton.type = "button";
    resultButton.addEventListener("click", () => {
      if (resultButton.dataset.ready === "true" || !RV.studio) {
        reloadUpdatedExplainer();
      } else {
        checkForUpdatedExplainer(true);
      }
    });
    result.append(resultButton);
    drawer.append(result);
    watchForUpdatedExplainer();

    if (locked) {
      const recovery = el("details", "rv-review-inventory rv-handoff-recovery");
      recovery.append(el("summary", null, "Agent not responding?"));
      recovery.append(
        el(
          "p",
          null,
          "Copy the saved instruction manually, or cancel the child agent and resume editing without discarding your review.",
        ),
      );
      const box = el("div", "rv-copybox");
      box.textContent = instruction;
      recovery.append(box);
      const fallback = el("button", "rv-copybtn", "Copy instruction");
      fallback.addEventListener("click", () => copyInstruction(fallback, instruction, false));
      recovery.append(fallback);
      if (waiting) {
        const resume = el("button", "rv-link", "Cancel agent and resume editing");
        resume.addEventListener("click", () => {
          resume.disabled = true;
          fetch(HANDOFF_URL, {
            method: "POST",
            body: JSON.stringify({ action: "resume" }),
          })
            .then((response) => {
              if (!response.ok) {
                throw new Error("resume failed");
              }
              return response.json();
            })
            .then((payload) => {
              handoff = payload.handoff || { status: "editing" };
              window.location.reload();
              return payload;
            })
            .catch(() => {
              resume.disabled = false;
              toast("Studio could not stop the agent safely; wait here for the result", 4500);
            });
        });
        recovery.append(resume);
      }
      drawer.append(recovery);
      return;
    }

    const changes = pendingChanges();
    const inventory = el("details", "rv-review-inventory");
    inventory.append(el("summary", null, "Included in this review · " + changes.length));
    const handList = el("div", "rv-pending-list rv-hand-list");
    changes.forEach((item) => handList.append(pendingRow(item)));
    inventory.append(handList);
    const discardAll = el("button", "rv-discard-all", "Discard all changes");
    discardAll.type = "button";
    discardAll.addEventListener("click", discardAllPending);
    inventory.append(discardAll);
    drawer.append(inventory);
    const peek = el("button", "rv-link", "Open review file ↗");
    peek.addEventListener("click", () =>
      (waiting ? Promise.resolve(true) : save(true)).then((saved) => {
        if (saved) {
          window.open(REVIEW_URL, "_blank");
        }
        return saved;
      }),
    );
    drawer.append(peek);
    const back = el("button", "rv-link", "← Keep reviewing");
    back.addEventListener("click", () => {
      drawerView = "notes";
      renderDrawer();
    });
    drawer.append(back);
  }

  /* ── tuner ── */
  const docStyle = document.documentElement.style;
  function applyTokens(t) {
    const previousGeometry = [
      docStyle.fontSize,
      docStyle.getPropertyValue("--content-space-scale"),
      docStyle.getPropertyValue("--measure"),
    ].join("|");
    docStyle.setProperty("--rv-font-scale", String((t.font_pct || 100) / 100));
    docStyle.setProperty("--content-space-scale", String(t.space_scale || 1));
    if (t.font_pct != null && t.font_pct !== 100) {
      docStyle.fontSize = t.font_pct + "%";
    } else {
      docStyle.fontSize = "";
    }
    if (t.measure) {
      docStyle.setProperty("--measure", t.measure);
    } else {
      docStyle.removeProperty("--measure");
    }
    // Retain playback of older reviews; glow is no longer an editable control.
    if (t.orb_opacity == null) {
      docStyle.removeProperty("--orb-opacity");
    } else {
      docStyle.setProperty("--orb-opacity", String(t.orb_opacity));
    }
    if (t.accent_mode === "safe" || t.accent_mode === "contrast") {
      document.documentElement.dataset.accentMode = t.accent_mode;
      delete document.documentElement.dataset.accentPreset;
      docStyle.removeProperty("--accent");
      docStyle.removeProperty("--accent-dim");
    } else if (t.accent_preset === "adyen") {
      delete document.documentElement.dataset.accentMode;
      document.documentElement.dataset.accentPreset = "adyen";
      docStyle.removeProperty("--accent");
      docStyle.removeProperty("--accent-dim");
    } else {
      delete document.documentElement.dataset.accentMode;
      delete document.documentElement.dataset.accentPreset;
      if (!t.accent_mode && t.accent) {
        docStyle.setProperty("--accent", t.accent);
        docStyle.setProperty("--accent-dim", `${t.accent}33`);
      } else if (!t.accent_mode) {
        docStyle.removeProperty("--accent");
        docStyle.removeProperty("--accent-dim");
      }
    }
    const geometry = [
      docStyle.fontSize,
      docStyle.getPropertyValue("--content-space-scale"),
      docStyle.getPropertyValue("--measure"),
    ].join("|");
    if (geometry !== previousGeometry) {
      window.dispatchEvent(new CustomEvent("kitappearancechange"));
    }
  }
  function currentTokens() {
    return state.tokens[LABEL] || {};
  }
  function setToken(key, value) {
    const t = state.tokens[LABEL] || (state.tokens[LABEL] = {});
    if (value == null) {
      delete t[key];
    } else {
      t[key] = value;
    }
    if (Object.keys(t).length === 0) {
      delete state.tokens[LABEL];
    }
    applyTokens(t);
    updatePendingUI();
    save();
  }
  function computed(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function buildStudioTuner(options) {
    const wrap = el("div", "rv-appearance-controls");
    const external = options && options.tokens && typeof options.tokens === "object";
    const tokens = external ? options.tokens : currentTokens();
    function changeToken(key, value) {
      if (!external) {
        setToken(key, value);
        return;
      }
      if (value == null) {
        delete tokens[key];
      } else {
        tokens[key] = value;
      }
      applyTokens(tokens);
      if (typeof options.onChange === "function") {
        options.onChange(structuredClone(tokens));
      }
    }
    function choices(label, help, key, entries, fallback) {
      const block = el("fieldset", "rv-appearance-setting");
      block.append(el("legend", null, label), el("p", null, help));
      const group = el("div", "rv-appearance-choices");
      group.setAttribute("role", "radiogroup");
      group.setAttribute("aria-label", label);
      entries.forEach(([value, text]) => {
        const button = el("button", null, text);
        button.setAttribute("role", "radio");
        const selected = tokens[key] == null ? fallback : tokens[key];
        button.setAttribute("aria-checked", String(selected === value));
        button.addEventListener("click", () => {
          changeToken(key, value === fallback ? null : value);
          group
            .querySelectorAll("button")
            .forEach((candidate) =>
              candidate.setAttribute("aria-checked", String(candidate === button)),
            );
        });
        group.append(button);
      });
      block.append(group);
      wrap.append(block);
    }
    choices(
      "Page text",
      "Set the reading scale across the page.",
      "font_pct",
      [
        [90, "Compact"],
        [100, "Default"],
        [115, "Large"],
      ],
      100,
    );
    choices(
      "Content spacing",
      "Adjust the room between rows, labels, and groups within your visuals. Chart values and map locations stay unchanged.",
      "space_scale",
      [
        [0.75, "Compact"],
        [1, "Balanced"],
        [1.35, "Airy"],
      ],
      1,
    );
    if (document.querySelector(".lede,.sec-sub")) {
      choices(
        "Line length",
        "Keep introductions comfortable to scan.",
        "measure",
        [
          ["44ch", "Short"],
          ["52ch", "Medium"],
          ["68ch", "Wide"],
        ],
        "52ch",
      );
    }
    const accent = el("fieldset", "rv-appearance-setting rv-accent-setting");
    accent.append(
      el("legend", null, "Accent"),
      el(
        "p",
        null,
        "Use an accessible palette or choose your own accent. Symbols and line styles still carry meaning.",
      ),
    );
    const modes = el("div", "rv-accent-modes");
    modes.setAttribute("role", "radiogroup");
    modes.setAttribute("aria-label", "Accent choices");
    [
      ["adyen", "Adyen brand", "Malachite on dark pages and Midnight on light pages."],
      ["theme", "Theme default", "Use this style’s built-in accent."],
      [
        "safe",
        "Color-vision safe",
        "Uses a tested blue pair with separate values for dark and light pages.",
      ],
      ["contrast", "High contrast", "Uses near-white on dark pages and near-black on light pages."],
    ].forEach(([value, name, description]) => {
      const button = el("button", "rv-accent-mode");
      button.type = "button";
      button.setAttribute("role", "radio");
      const selectedAccent =
        tokens.accent_mode || (tokens.accent_preset ? "adyen" : tokens.accent ? "custom" : "theme");
      button.setAttribute("aria-checked", String(selectedAccent === value));
      button.append(
        el("i", "rv-accent-sample rv-accent-sample-" + value),
        el("span", null, `<b>${name}</b><small>${description}</small>`),
      );
      button.addEventListener("click", () => {
        delete tokens.accent;
        delete tokens.accent_preset;
        if (value === "adyen") {
          delete tokens.accent_mode;
          changeToken("accent_preset", value);
        } else {
          changeToken("accent_mode", value === "theme" ? null : value);
        }
        modes
          .querySelectorAll("button")
          .forEach((candidate) =>
            candidate.setAttribute("aria-checked", String(candidate === button)),
          );
      });
      modes.append(button);
    });
    const custom = el("label", "rv-custom-accent");
    custom.append(el("span", null, "Custom color"));
    const color = el("input", "rv-accent-input");
    color.type = "color";
    color.setAttribute("aria-label", "Custom accent color");
    const current = tokens.accent || computed("--accent");
    if (/^#[0-9a-f]{6}$/i.test(current)) {
      color.value = current;
    }
    const value = el("span", "rv-custom-accent-value", color.value);
    color.addEventListener("input", () => {
      delete tokens.accent_mode;
      delete tokens.accent_preset;
      changeToken("accent", color.value);
      value.textContent = color.value;
      modes
        .querySelectorAll("button")
        .forEach((button) => button.setAttribute("aria-checked", "false"));
    });
    custom.append(color, value);
    accent.append(modes, custom);
    wrap.append(accent);
    const reset = el("button", "rv-appearance-reset", "Reset page adjustments");
    reset.addEventListener("click", () => {
      if (external) {
        Object.keys(tokens).forEach((key) => delete tokens[key]);
      } else {
        delete state.tokens[LABEL];
      }
      applyTokens({});
      if (external && typeof options.onChange === "function") {
        options.onChange({});
      } else {
        updatePendingUI();
        save(true);
      }
      wrap.replaceWith(buildStudioTuner(options));
    });
    wrap.append(reset);
    return wrap;
  }
  function buildTuner(options) {
    if (options && options.studio) {
      return buildStudioTuner(options);
    }

    const wrap = el("div");
    const t = currentTokens();
    function slider(label, min, max, step, value, fmt, onchange) {
      const row = el("div", "rv-slider");
      row.append(el("span", null, label));
      const input = el("input");
      input.type = "range";
      input.min = min;
      input.max = max;
      input.step = step;
      input.value = value;
      const val = el("span", "rv-val", fmt(value));
      input.addEventListener("input", () => {
        val.textContent = fmt(input.value);
        onchange(Number(input.value));
      });
      row.append(input);
      row.append(val);
      return row;
    }
    function unavailable(label, message) {
      const row = el("div", "rv-tuner-unavailable");
      row.append(el("span", "rv-tuner-label", label));
      row.append(el("span", "rv-tuner-message", message));
      return row;
    }
    const typeValue = t.font_pct != null ? t.font_pct : 100;
    const typeSlider = slider(
      "type scale",
      85,
      115,
      1,
      typeValue,
      function (v) {
        return v + "%";
      },
      function (v) {
        setToken("font_pct", v === 100 ? null : v);
        typePreview.style.fontSize = 9 + (v - 100) * 0.13 + "px";
      },
    );
    typeSlider.classList.add("rv-type-slider");
    const typePreview = el("span", "rv-type-preview", "Aa");
    typePreview.setAttribute("aria-hidden", "true");
    typePreview.style.fontSize = `${9 + (typeValue - 100) * 0.13}px`;
    typeSlider.insertBefore(typePreview, typeSlider.children[1]);
    wrap.append(typeSlider);
    const densityValue = t.space_scale != null ? t.space_scale : 1;
    const densitySlider = slider(
      "content spacing",
      0.75,
      1.35,
      0.05,
      densityValue,
      function (v) {
        return "×" + Number(v).toFixed(2);
      },
      function (v) {
        setToken("space_scale", v === 1 ? null : v);
        densityPreview.style.setProperty("--rv-density-gap", 1 + v * 2.5 + "px");
      },
    );
    densitySlider.classList.add("rv-density-slider");
    const densityPreview = el("span", "rv-density-preview");
    densityPreview.setAttribute("aria-hidden", "true");
    densityPreview.style.setProperty("--rv-density-gap", `${1 + densityValue * 2.5}px`);
    densityPreview.innerHTML = "<i></i><i></i><i></i>";
    densitySlider.insertBefore(densityPreview, densitySlider.children[1]);
    wrap.append(densitySlider);
    if (document.querySelector(".lede,.sec-sub")) {
      const measureBlock = el("div", "rv-tuner-block");
      const m = Number.parseInt(t.measure != null ? t.measure : computed("--measure"), 10) || 52;
      const measureSlider = slider(
        "text width",
        40,
        80,
        1,
        m,
        function (v) {
          return v + "ch";
        },
        function (v) {
          setToken("measure", v + "ch");
          measurePreview.style.setProperty("--rv-preview-width", ((v - 40) / 40) * 50 + 50 + "%");
        },
      );
      measureSlider.classList.add("rv-measure-slider");
      measureSlider.title = "Controls the line length of intro and section-summary text";
      const measurePreview = el("div", "rv-measure-preview");
      measurePreview.setAttribute("aria-hidden", "true");
      measurePreview.style.setProperty("--rv-preview-width", `${((m - 40) / 40) * 50 + 50}%`);
      measurePreview.innerHTML = "<i></i><i></i><i></i>";
      measureSlider.insertBefore(measurePreview, measureSlider.children[1]);
      measureBlock.append(measureSlider);
      measureBlock.append(el("div", "rv-tuner-help", "Intro and section-summary line length"));
      wrap.append(measureBlock);
    } else {
      wrap.append(
        unavailable("text width", "Unavailable — no intro or section-summary text on this page."),
      );
    }
    const accentRow = el("div", "rv-slider rv-accent-row");
    accentRow.append(el("span", null, "accent"));
    const color = el("input");
    color.type = "color";
    color.className = "rv-accent-input";
    color.setAttribute("aria-label", "Accent color");
    const cur = t.accent || computed("--accent");
    if (/^#[0-9a-f]{6}$/i.test(cur)) {
      color.value = cur;
    }
    color.addEventListener("input", () => {
      delete currentTokens().accent_mode;
      setToken("accent", color.value);
    });
    accentRow.append(color);
    const reset = el("button", "rv-link rv-reset-color", "Reset");
    reset.addEventListener("click", () => {
      var tokens = currentTokens();
      delete tokens.accent;
      if (!Object.keys(tokens).length) {
        delete state.tokens[LABEL];
      }
      applyTokens(tokens);
      var themeAccent = computed("--accent");
      if (/^#[0-9a-f]{6}$/i.test(themeAccent)) {
        document.querySelectorAll(".rv-accent-input").forEach(function (input) {
          input.value = themeAccent;
        });
      }
      updatePendingUI();
      save(true);
    });
    accentRow.append(reset);
    wrap.append(accentRow);
    return wrap;
  }

  /* Keyboard: c toggles comment mode (inputs excluded; Present uses p/f/arrows) */
  window.addEventListener("keydown", (e) => {
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) {
      return;
    }
    if (e.key === "c" || e.key === "C") {
      toggleCommentMode();
    }
  });

  function addCopyException(item) {
    const block =
      `Copy-limit exception requested for ${item.renderer} ${item.path}:\n` +
      `- Current copy: ${item.value}\n` +
      `- Limit: ${item.limit}; measured: ${item.actual}\n` +
      "- Verify the rendered component at supported widths before accepting this exception.";
    if (!state.general_notes.includes(block)) {
      state.general_notes = [state.general_notes.trim(), block].filter(Boolean).join("\n\n");
      updatePendingUI();
      save(true);
    }
    drawerView = "notes";
    drawer.classList.add("rv-open");
    renderDrawer();
    toast("exception request added to Changes");
  }

  function addCopyIssues(items) {
    const lines = (items || []).map(function (item) {
      const over = Number(item.actual) - Number(item.limit);
      return `- ${item.renderer} ${item.path}: ${over} characters over the ${item.limit} limit. ${item.hint} Current copy: ${item.value}`;
    });
    if (lines.length === 0) {
      return;
    }
    const block = "Copy cleanup after compatibility upgrade:\n" + lines.join("\n");
    if (!state.general_notes.includes(block)) {
      state.general_notes = [state.general_notes.trim(), block].filter(Boolean).join("\n\n");
      updatePendingUI();
      save(true);
    }
    drawerView = "notes";
    drawer.classList.add("rv-open");
    renderDrawer();
    toast("copy fixes added to Changes");
  }

  applyTokens(currentTokens());
  try {
    const returnView = sessionStorage.getItem("rv-return-" + LABEL);
    if (returnView) {
      sessionStorage.removeItem("rv-return-" + LABEL);
      drawerView = returnView === "handoff" ? "handoff" : "notes";
      previewChangesOpen = true;
      drawer.classList.add("rv-open");
    }
  } catch {}
  if (agentHandoff && (handoff.status === "waiting" || handoff.status === "ready")) {
    drawerView = "handoff";
    drawer.classList.add("rv-open");
  }
  renderDrawer();
  /* A reload during the wait must keep watching: the watcher started by
     Send lives in the pre-reload page only, so without this a refreshed
     tab shows "watching for the rebuild" while polling nothing. */
  if (agentHandoff && handoff.status === "waiting") {
    watchForUpdatedExplainer();
  }
  window.addEventListener("pagehide", () => {
    if (sendController) {
      sendController.abort();
    }
  });
  window.addEventListener("pageshow", (event) => {
    if (agentHandoff && event.persisted) {
      reconcileHandoff().catch(() => {});
    }
  });
  acknowledgeCompletedPage();

  const store = window.ExplainerReview.createStore({
    state,
    label: LABEL,
    persist: () => save(true),
    /* Every store mutator refreshes, so this is the only place that can tell a
       later-injected panel that a review-side edit became pending. */
    refresh: () => {
      renderDrawer();
      document.dispatchEvent(new CustomEvent("explainer:review-changed"));
    },
    pins: placePins,
  });

  /* Shared surface for the studio panel (studio.py injects it after this):
     it reads/writes the same review state so swaps land in review.md too */
  window.__RVAPI = {
    store,
    stateUrl: STATE_URL,
    toast,
    addCopyIssues,
    addCopyException,
    editText() {
      if (!editing) {
        toggleEditing();
      }
    },
    /* One committed slide-text edit, the same record the whole-page edit-text
       mode builds on exit (selector, section, variant, created). Studio's
       click-to-type prose engine calls this per commit; recordEdit chains a
       re-edit's before back to the true original, and the draft rides the
       existing review state → manifest text override → save pipeline. */
    recordTextEdit(node, before, after, beforeMarkup) {
      if (!node || node.nodeType !== 1 || !node.isConnected || before === after) {
        return false;
      }
      const section = node.closest ? node.closest("section[id]") : null;
      recordEdit({
        selector: cssPath(node),
        before: String(before == null ? "" : before),
        after: String(after == null ? "" : after),
        // Studio's whole-block prose editing serializes markup: flattened
        // `before` guards the apply paths, while this carries the styled
        // original so a discard repaints it instead of flattening it.
        ...(beforeMarkup != null && String(beforeMarkup) !== String(before)
          ? { beforeMarkup: String(beforeMarkup) }
          : {}),
        section: section ? "#" + section.id : "",
        variant: LABEL,
        created: new Date().toISOString(),
      });
      updateBadge();
      renderDrawer();
      // A draft text edit is pending review state the moment it lands; the
      // store's own mutators announce the same event for the same reason.
      document.dispatchEvent(new CustomEvent("explainer:review-changed"));
      save(true);
      return true;
    },
    preparePresent() {
      const draft = composer && composer.querySelector("textarea");
      if (draft && draft.value.trim()) {
        toast("Save or cancel your note before presenting", 3500);
        draft.focus();
        return false;
      }
      closeComposer();
      exitCommentMode();
      if (editing) {
        toggleEditing();
      }
      return true;
    },
    buildTuner, // The studio panel hosts the tuner as fine-tune
  };
})();
