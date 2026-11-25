/* Studio's inline content-editing engine. The lens registry
   (inline-edit-lenses.js) maps live component text to authored data paths;
   this engine owns the interaction:

   - Arming is Studio-scoped, never page-wide: studio.js calls arm() when the
     inspector is on the Visual tab, and disarm() everywhere else. Lens
     targets come from the one selected lens-covered host; slide prose
     (h1-h4, p, li, blockquote, figcaption) inside the selected section that
     is NOT inside a lens-covered component host is the fallback, so a slide
     title or paragraph edits exactly like component text. Lenses own any
     element inside a covered host; prose never double-handles one.
   - A prose block is ONE click target regardless of internal markup:
     clicking a plain run and clicking a styled phrase inside it edit the
     same whole block. On commit the block serializes through the passive-
     inline allowlist (b, code, em, br) both apply paths paint back as
     markup; markup outside that allowlist refuses with a toast. A prose
     commit does not rewrite component data: the engine hands the record to
     the review API's recordTextEdit(el, before, after), which files the
     same guarded review record the old whole-page mode built, so it rides
     the existing review state → manifest text override → save pipeline.
   - Hovering an editable text inside the armed scope shows a 1px dashed
     outline and an I-beam. Clicking it turns the text into a
     contenteditable field in place, selected, with min-width/min-height
     pinned from the live rect so emptying it cannot collapse the layout.
   - Enter or blur commits; Escape cancels and restores. Single-line fields
     swallow newline keys; multi-line fields (sub, subs[], caption) accept
     Shift+Enter. An edit gesture swallows its trailing click so interactive
     kit chrome (before-after flip rows) never fires under it. Paste is
     forced to plain text so an edit never imports foreign markup.
   - Commit clones the resolved component, writes the string through the
     lens path, and hands the result to the commit callback studio.js
     supplies — the same update → apply → rollback sequence the structured
     panel editor uses. The host DOM is replaced by that apply, which ends
     the edit; the panel re-arms against the new DOM.
   - Formatted fields (values carrying kitSetPassiveInline markup) edit in
     place: the markup stays rendered while typing, and commit serializes
     the b/code/em/br allowlist back to the string form. Anything outside
     that allowlist refuses with a toast and keeps the old value.
   - A floating `12/24` counter tracks text-caps.json limits while typing and
     turns warning-colored past the cap. It never blocks input, mirroring
     the kit's own diagnostics behavior.
   - Guards: an active item-filtering adjustment (Key items / Key text)
     makes index-anchored lenses unreliable, so clicks refuse with a toast;
     prose blocks whose markup is outside the passive-inline allowlist
     refuse with a toast (a text override cannot express them) and stay
     with the agent handoff. */
(function installExplainerInlineEdit(root) {
  "use strict";

  const LENSES = root.ExplainerInlineEditLenses || null;

  let session = null;
  let targets = [];
  let byEl = new Map();
  let activeEdit = null;
  let hoveredEl = null;
  let capEl = null;
  let lastCommit = null;
  let armedEl = null;

  /* Marks the one host being edited so page CSS can yield to the edit
     gesture there and nowhere else: a kit overlay drawn above its own
     caption would otherwise make that caption unreachable by pointer. */
  function markArmed(host) {
    if (armedEl === host) {
      return;
    }
    if (armedEl) {
      armedEl.classList.remove("st-inline-armed");
    }
    armedEl = host || null;
    if (armedEl) {
      armedEl.classList.add("st-inline-armed");
    }
  }

  function presenting() {
    return document.body.classList.contains("presenting");
  }

  function locked() {
    return Boolean(session && session.isLocked && session.isLocked());
  }

  function active() {
    if (!session) {
      return false;
    }
    if (presenting() || locked()) {
      return false;
    }
    if (session.host && !session.host.isConnected) {
      return false;
    }
    return !session.prose || session.prose.scope.isConnected;
  }

  function clearHover() {
    if (hoveredEl) {
      hoveredEl.classList.remove("st-inline-hover");
      hoveredEl = null;
    }
  }

  /* ── slide prose, the fallback after lenses ──────────────────────────
     A prose block (h1-h4, p, li, blockquote, figcaption) is ONE click
     target regardless of its internal markup: clicking a plain run and
     clicking a styled phrase inside it edit the same whole block, so a
     line like "Regionalize now, or <em>fix the foundation first</em>" is
     editable from anywhere on it. On commit the block serializes through
     the same passive-inline allowlist the component fields use
     (b, code, em, br); markup beyond that allowlist refuses at the click
     with a toast rather than silently flattening what the author wrote.
     Anything inside a lens-covered component host belongs to that host's
     lenses, and anything inside interactive chrome keeps its own
     behavior. */
  const PROSE_TAGS = "h1,h2,h3,h4,p,li,blockquote,figcaption";

  function insideCoveredHosts(node) {
    let current = node;
    while (current && current !== document.body) {
      if (session && session.prose && session.prose.isCoveredHost(current)) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  }

  function proseEditable(el) {
    if (!el.textContent || !el.textContent.trim()) {
      return false; // nothing to edit yet.
    }
    if (
      el.closest("#rv-root") ||
      el.closest("#st-root") ||
      el.closest("button,a,summary,label,input,select,textarea")
    ) {
      return false; // chrome and interactive controls own their own text.
    }
    return !insideCoveredHosts(el); // a covered host owns its own text.
  }

  function proseTarget(el, scope) {
    return { el, host: scope, kind: "prose", field: "slide text", path: null, cap: null };
  }

  function proseTargets(prose) {
    const out = [];
    const scope = prose.scope;
    scope.querySelectorAll(PROSE_TAGS).forEach(function (el) {
      if (el.classList.contains("ea-authored-slide-title")) {
        return; // the authored slide keeps its structured Slide title field.
      }
      if (!proseEditable(el)) {
        return;
      }
      out.push(proseTarget(el, scope));
    });
    return out;
  }

  function collectTargets() {
    targets = [];
    byEl = new Map();
    if (!session) {
      deriveItemAnchors(null);
      return;
    }
    const component = session.component ? session.component() : null;
    if (session.host && component) {
      targets = LENSES.collect(session.host, component);
    }
    if (session.prose) {
      targets = targets.concat(proseTargets(session.prose));
    }
    targets.forEach(function (item) {
      byEl.set(item.el, item);
    });
    deriveItemAnchors(component);
  }

  /* ── in-content item selection + on-demand toolbar ──────────────────
     While a lens-covered host is armed, every collection item the lenses
     anchor (flow station card, table row, grid card, chip, list entry, ...)
     is selectable ON the content: clicking the item's own surface — its
     card padding or row background, never one of its text fields, which
     still start inline editing — outlines the item and shows a floating
     toolbar beside it in the shape toolbar's chrome (ec-shape-toolbar)
     with the structure actions: Duplicate, Add (a clone after this item),
     Move up, Move down, Remove. Actions reuse the component editor's
     exported cloneForInsert / canRemoveItem / move helpers and commit
     through the same session.commit path as a text edit; the selection
     and its toolbar re-derive against the fresh DOM on every render, so a
     commit that re-renders the host re-anchors them. Click-away, Escape,
     or starting a text edit clears the selection. */
  let itemAnchors = [];
  let byContainer = new Map();
  let selectedItem = null;
  let selectionPoint = null;
  let pendingFollow = null;
  let toolbarEl = null;
  const FOLLOW_WINDOW_MS = 3000;

  /* The innermost collection item owning a target: its path runs up to and
     includes the path's last numeric segment (["items", 1, "label"] →
     ["items", 1]; ["items", 1, "subs", 0] → the sub itself). Paths without
     a number (a component's caption) anchor no item. */
  function itemPrefix(path) {
    let last = -1;
    for (let index = 0; index < path.length; index++) {
      if (typeof path[index] === "number") {
        last = index;
      }
    }
    return last === -1 ? null : path.slice(0, last + 1);
  }

  function itemContainer(own, foreign) {
    let box = own[0];
    const holds = function (candidate) {
      return own.every(function (el) {
        return candidate === el || candidate.contains(el);
      });
    };
    while (box && box !== document.body && !holds(box)) {
      box = box.parentElement;
    }
    if (!box || box === document.body) {
      return null; // targets split across the page anchor no item.
    }
    // Expand across non-target chrome: a chip's label span is the item's
    // only target, but the chip around it is the container users see.
    while (
      box.parentElement &&
      !foreign(box.parentElement) &&
      box.parentElement !== document.body
    ) {
      box = box.parentElement;
    }
    return box;
  }

  function deriveItemAnchors(component) {
    // Re-deriving rebuilds the whole anchor set against the live DOM, so
    // the candidate marks from the previous set go first — a host that
    // stays connected after the session moves elsewhere must not keep a
    // pointer cursor over items it no longer offers.
    itemAnchors.forEach(function (anchor) {
      if (anchor.container.isConnected) {
        anchor.container.classList.remove("st-item-candidate");
      }
    });
    itemAnchors = [];
    byContainer = new Map();
    if (!component || !component.data || !component.kind) {
      return;
    }
    const editor = root.ExplainerComponentEditor;
    if (!editor || locked()) {
      return;
    }
    const targetEls = [];
    const byPrefix = new Map();
    targets.forEach(function (item) {
      if (item.kind === "prose" || !Array.isArray(item.path)) {
        return;
      }
      targetEls.push(item.el);
      const prefix = itemPrefix(item.path);
      if (!prefix) {
        return;
      }
      const key = JSON.stringify(prefix);
      const entry = byPrefix.get(key) || { own: [], path: prefix };
      if (!entry.own.includes(item.el)) {
        entry.own.push(item.el);
      }
      byPrefix.set(key, entry);
    });
    byPrefix.forEach(function (entry) {
      // The container is the smallest element holding the item's own
      // targets, expanded while the parent holds no other item's targets:
      // a chip's label span is its only target, but the chip around it is
      // the container users see.
      const container = itemContainer(entry.own, function (candidate) {
        return targetEls.some(function (el) {
          return candidate.contains(el) && !entry.own.includes(el);
        });
      });
      if (!container) {
        return;
      }
      const anchor = {
        container,
        collectionPath: entry.path.slice(0, -1),
        index: entry.path.at(-1),
      };
      itemAnchors.push(anchor);
      if (!byContainer.has(container)) {
        byContainer.set(container, anchor);
      }
      // The selectable affordance: the item's own surface reads as
      // clickable while its text fields keep their I-beam.
      container.classList.add("st-item-candidate");
    });
  }

  /* The anchor whose container an element sits inside, if any. The toolbar
     itself is excluded, so a click on its buttons never re-selects. */
  function resolveItemAt(node) {
    let current = node;
    while (current && current !== document.body) {
      if (current === toolbarEl) {
        return null;
      }
      if (byContainer.has(current)) {
        return byContainer.get(current);
      }
      current = current.parentElement;
    }
    return null;
  }

  function samePath(a, b) {
    return (
      a.length === b.length &&
      a.every(function (part, index) {
        return part === b[index];
      })
    );
  }

  function anchorAt(collectionPath, index) {
    return (
      itemAnchors.find(function (candidate) {
        return candidate.index === index && samePath(candidate.collectionPath, collectionPath);
      }) || null
    );
  }

  /* ── the floating item toolbar ───────────────────────────────────────
     One toolbar element in the shape toolbar's visual language, rebuilt
     only when the engine first needs it and re-targeted on every select.
     It anchors to the item's box — never the pointer — so scroll, resize,
     and every re-render recompute its position, and it hides while its
     item is offscreen. */
  function ensureItemToolbar() {
    if (toolbarEl) {
      return toolbarEl;
    }
    toolbarEl = document.createElement("div");
    toolbarEl.className = "ec-shape-toolbar st-item-toolbar";
    toolbarEl.setAttribute("role", "toolbar");
    toolbarEl.setAttribute("aria-label", "Item actions");
    [
      ["duplicate", "Duplicate", "Duplicate this item, then edit its text on the slide"],
      ["add", "Add", "Add a copy after this item"],
      ["up", "Move up", "Move this item up"],
      ["down", "Move down", "Move this item down"],
      ["remove", "Remove", "Remove this item"],
    ].forEach(function (spec) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.itemAction = spec[0];
      button.textContent = spec[1];
      button.title = spec[2];
      button.setAttribute("aria-label", spec[2]);
      button.addEventListener("click", function () {
        if (selectedItem) {
          runItemAction(selectedItem, spec[0]);
        }
      });
      toolbarEl.append(button);
    });
    document.body.append(toolbarEl);
    return toolbarEl;
  }

  function selectItem(anchor, point) {
    const component = session && session.component ? session.component() : null;
    const editor = root.ExplainerComponentEditor;
    if (!component || !component.data || !editor || !anchor.container.isConnected) {
      return;
    }
    const list = LENSES.valueAt(component.data, anchor.collectionPath);
    if (!Array.isArray(list) || anchor.index == null || anchor.index >= list.length) {
      return; // the render moved underneath the anchor.
    }
    if (selectedItem && selectedItem.container !== anchor.container) {
      clearItemSelection();
    }
    selectedItem = anchor;
    selectionPoint = point || null;
    anchor.container.classList.add("st-item-selected");
    const bar = ensureItemToolbar();
    const capped = list.length >= editor.maxItems;
    const removable = editor.canRemoveItem(list[anchor.index], component.data);
    const titles = {
      duplicate: capped
        ? "This collection is limited to " + editor.maxItems + " items in Studio."
        : "Duplicate this item, then edit its text on the slide",
      add: capped
        ? "This collection is limited to " + editor.maxItems + " items in Studio."
        : "Add a copy after this item",
      up: anchor.index === 0 ? "Already first" : "Move this item up",
      down: anchor.index === list.length - 1 ? "Already last" : "Move this item down",
      remove: removable ? "Remove this item" : "Another field refers to this item's id",
    };
    Array.prototype.forEach.call(bar.children, function (button) {
      const action = button.dataset.itemAction;
      button.title = titles[action];
      button.setAttribute("aria-label", titles[action]);
      button.disabled =
        action === "duplicate" || action === "add"
          ? capped
          : action === "up"
            ? anchor.index === 0
            : action === "down"
              ? anchor.index === list.length - 1
              : !removable;
    });
    positionItemToolbar();
  }

  /* The toolbar sits in the item's own top-right corner, above it; it
     flips below the item when there is no room above or the bar would
     cover the click that selected it, and aligns to the item's left edge
     when the bar would otherwise leave the slide. */
  function positionItemToolbar() {
    if (!toolbarEl || !selectedItem) {
      return;
    }
    const rect = selectedItem.container.getBoundingClientRect();
    const offscreen =
      rect.bottom < 8 ||
      rect.top > window.innerHeight - 8 ||
      rect.right < 8 ||
      rect.left > window.innerWidth - 8;
    toolbarEl.style.display = offscreen ? "none" : "flex";
    if (offscreen) {
      return;
    }
    const width = toolbarEl.offsetWidth || 330;
    const height = toolbarEl.offsetHeight || 40;
    let top = rect.top - height - 8;
    let left = rect.right - width + 4;
    const coversPoint =
      selectionPoint &&
      selectionPoint.x >= left &&
      selectionPoint.x <= left + width &&
      selectionPoint.y >= top &&
      selectionPoint.y <= top + height;
    if (top < 4 || coversPoint) {
      top = rect.bottom + 8;
    }
    if (left < 4) {
      left = rect.left;
    }
    left = Math.max(4, Math.min(left, window.innerWidth - width - 4));
    top = Math.max(4, Math.min(top, window.innerHeight - height - 4));
    toolbarEl.style.left = left + "px";
    toolbarEl.style.top = top + "px";
  }

  function hideItemToolbar() {
    if (toolbarEl) {
      toolbarEl.style.display = "none";
    }
  }

  function clearItemSelection() {
    if (selectedItem && selectedItem.container.isConnected) {
      selectedItem.container.classList.remove("st-item-selected");
    }
    selectedItem = null;
    selectionPoint = null;
    hideItemToolbar();
  }

  function destroyItemToolbar() {
    if (toolbarEl) {
      toolbarEl.remove();
      toolbarEl = null;
    }
  }

  function runItemAction(anchor, action) {
    if (!active() || activeEdit) {
      return;
    }
    const editor = root.ExplainerComponentEditor;
    const component = session && session.component ? session.component() : null;
    if (!editor || !component || !component.data || !component.kind) {
      session.toast("This visual is no longer editable in place.");
      return;
    }
    // The same filtered-adjustment rule as a text click: an adjustment that
    // drops items shifts every index-anchored path, so structure edits wait
    // for the unfiltered view.
    if (adjustmentFiltered(session.host, component.kind)) {
      session.toast("Showing filtered items — switch Text back to Full to edit", true);
      return;
    }
    let data;
    try {
      data = structuredClone(component.data);
    } catch {
      session.toast("Change was not applied: this visual's data could not be copied.", true);
      return;
    }
    const list = LENSES.valueAt(data, anchor.collectionPath);
    if (!Array.isArray(list) || anchor.index == null || anchor.index >= list.length) {
      session.toast("This item is no longer on the slide — it may have just changed.", true);
      return;
    }
    if (action === "duplicate" || action === "add") {
      if (list.length >= editor.maxItems) {
        session.toast(
          "This collection is limited to " + editor.maxItems + " items in Studio.",
          true,
        );
        return;
      }
      list.splice(anchor.index + 1, 0, editor.cloneForInsert(list[anchor.index], data));
    } else if (action === "up") {
      editor.move(list, anchor.index, anchor.index - 1);
    } else if (action === "down") {
      editor.move(list, anchor.index, anchor.index + 1);
    } else if (action === "remove") {
      if (!editor.canRemoveItem(list[anchor.index], data)) {
        session.toast("This item is kept because another field refers to its id.");
        return;
      }
      list.splice(anchor.index, 1);
    } else {
      return;
    }
    const validation = editor.validate({ kind: component.kind, data });
    if (!validation.valid) {
      session.toast("Change was not applied: " + validation.errors[0], true);
      return;
    }
    // The commit re-renders the host synchronously; onKitRender re-derives
    // the anchors and re-anchors the toolbar to the item the action leaves
    // in play (the duplicate or the added clone, the moved item, or the
    // next item after a remove) instead of waiting for the next click.
    // Add keeps the toolbar on the item it acted on: the clone is the one
    // to type into, selected on its own click.
    pendingFollow = {
      host: session.host,
      at: Date.now(),
      collectionPath: anchor.collectionPath,
      index:
        action === "duplicate"
          ? anchor.index + 1
          : action === "add"
            ? anchor.index
            : action === "up"
              ? anchor.index - 1
              : action === "down"
                ? anchor.index + 1
                : Math.min(anchor.index, list.length - 1),
    };
    try {
      session.commit({ kind: component.kind, data });
    } catch (error) {
      session.toast("Change was not applied: " + String((error && error.message) || error), true);
      dropFollow();
    }
  }

  /* The item a structure action asked the toolbar to follow. One commit can
     re-derive the targets several times — the host re-renders, and the
     inspector rebuild disarms and re-arms this engine — so the follow
     outlives a session and is re-applied by each of them. It belongs to the
     host it was set on, expires on its own, and any further gesture (a
     click, Escape, opening a text edit) drops it. */
  function followForSession() {
    if (!pendingFollow) {
      return null;
    }
    if (
      !session ||
      pendingFollow.host !== session.host ||
      Date.now() - pendingFollow.at >= FOLLOW_WINDOW_MS
    ) {
      pendingFollow = null;
      return null;
    }
    return pendingFollow;
  }

  function dropFollow() {
    pendingFollow = null;
  }

  /* Scroll and resize invalidate the toolbar's fixed position: it
     recomputes from its item's box, and hides itself while the item sits
     offscreen. */
  function onViewportShift() {
    if (!session) {
      return;
    }
    if (selectedItem) {
      positionItemToolbar();
    }
  }

  function onPresentChange(event) {
    if (event.detail && event.detail.presenting) {
      clearItemSelection();
    } else if (session) {
      collectTargets();
    }
  }

  /* A click resolves to the nearest target it sits inside. The walk may pass
     through a lens-covered host's own nodes (its targets are inside it), but
     never past the host itself: everything above a covered host belongs to
     prose or nothing, and prose never double-handles lens text. */
  function resolveAt(node) {
    let current = node;
    while (current && current !== document.body) {
      if (byEl.has(current)) {
        return byEl.get(current);
      }
      if (session && coveredHostBoundary(current)) {
        return null;
      }
      current = current.parentElement;
    }
    return null;
  }

  function coveredHostBoundary(el) {
    if (session.host && el === session.host) {
      return true;
    }
    return Boolean(session.prose && session.prose.isCoveredHost && session.prose.isCoveredHost(el));
  }

  /* An SVG <text> cannot host contenteditable, so those targets are edited
     through one floating input placed over the glyphs. It commits through
     the identical path: Enter or blur commits, Escape cancels, and the cap
     counter follows the input instead of the element. */
  const SVG_NS = "http://www.w3.org/2000/svg";

  function isSvgTarget(el) {
    return el.namespaceURI === SVG_NS;
  }

  function openOverlay(edit) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "st-inline-svg-input";
    input.spellcheck = false;
    input.value = edit.original;
    const rect = edit.el.getBoundingClientRect();
    const style = window.getComputedStyle(edit.el);
    input.style.fontFamily = style.fontFamily;
    input.style.fontSize = style.fontSize;
    input.style.fontWeight = style.fontWeight;
    input.style.left = Math.max(4, Math.round(rect.left) - 6) + "px";
    input.style.top = Math.max(4, Math.round(rect.top) - 4) + "px";
    input.style.width = Math.max(90, Math.ceil(rect.width) + 32) + "px";
    document.body.append(input);
    edit.input = input;
    input.addEventListener("keydown", onKeyDown);
    input.addEventListener("input", onInput);
    input.addEventListener("blur", onBlur);
    input.focus();
    input.select();
  }

  /* ── the floating cap counter ─────────────────────────────────────── */
  function showCap(edit) {
    hideCap();
    if (!edit.target.cap) {
      return;
    }
    capEl = document.createElement("div");
    capEl.className = "st-inline-cap";
    document.body.append(capEl);
    positionCap(edit);
    updateCap(edit);
  }

  function positionCap(edit) {
    if (!capEl) {
      return;
    }
    const rect = (edit.input || edit.el).getBoundingClientRect();
    let left = rect.right + 8;
    let top = rect.top - 30;
    if (top < 8) {
      top = rect.bottom + 8;
    }
    if (left + 96 > window.innerWidth) {
      left = Math.max(8, rect.right - 96);
    }
    capEl.style.left = left + "px";
    capEl.style.top = top + "px";
  }

  function updateCap(edit) {
    if (!capEl) {
      return;
    }
    const length = readValue(edit).length;
    capEl.textContent = length + "/" + edit.target.cap;
    capEl.classList.toggle("st-inline-cap-over", length > edit.target.cap);
  }

  function hideCap() {
    if (capEl) {
      capEl.remove();
      capEl = null;
    }
  }

  /* Every lens-covered field renders through textContent into normal
     white-space, so a line break would collapse to a space on re-render and
     fail its round trip. Inline editing is therefore single-line throughout;
     paragraph bodies belong to the slide's own prose fallback. */
  function elementText(el) {
    return String(el.textContent).replace(/\n$/, "");
  }

  function readValue(edit) {
    return edit.input ? edit.input.value : elementText(edit.el);
  }

  /* ── formatted values: serialize, paint, refuse ──────────────────────
     kitSetPassiveInline renders b/code/em/br markup inside a field's text.
     While editing, the markup stays rendered (the user edits rich text, not
     source); on commit the element is walked back to the string form the
     renderer accepts. Anything outside the allowlist — or a paste that
     smuggled an element in — refuses with a toast and keeps the old value,
     painted back through the renderer's own function so the slide never
     shows literal tags. */
  const INLINE_TAG = /^<\/?(?:b|code|em|br)>$/i;
  const ANY_TAG = /<\/?[a-z][^<>]*>/gi;

  function markupAllowed(value) {
    const tags = String(value == null ? "" : value).match(ANY_TAG) || [];
    return tags.every(function (tag) {
      return INLINE_TAG.test(tag.toLowerCase());
    });
  }

  function paintInlineValue(el, value) {
    const paint = window.kitSetPassiveInline;
    if (typeof paint === "function") {
      paint(el, value);
      return;
    }
    // A page without kit components still edits prose: the same allowlist
    // paints locally so canceling a styled block restores its markup.
    const source = String(value == null ? "" : value);
    const tags = /<\/?(?:b|code|em|br)>/gi;
    const stack = [el];
    let offset = 0;
    el.replaceChildren();
    source.replaceAll(tags, function (token, at) {
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
  }

  function serializeInline(el) {
    let failed = false;
    let out = "";
    function walk(node) {
      Array.prototype.forEach.call(node.childNodes, function (child) {
        if (failed) {
          return;
        }
        if (child.nodeType === 3) {
          // Typed "<b>" is text, not markup: the serialized string cannot
          // tell them apart, so tag-shaped text rides the refusal path.
          if (/<\/?[a-z][^<>]*>/i.test(child.nodeValue)) {
            failed = true;
            return;
          }
          out += child.nodeValue;
          return;
        }
        if (child.nodeType !== 1) {
          failed = true;
          return;
        }
        const tag = child.tagName.toLowerCase();
        if (tag === "br") {
          out += "<br>";
          return;
        }
        if (tag !== "b" && tag !== "code" && tag !== "em") {
          failed = true;
          return;
        }
        out += "<" + tag + ">";
        walk(child);
        if (!failed) {
          out += "</" + tag + ">";
        }
      });
    }
    walk(el);
    return failed ? null : out;
  }

  /* ── guards ───────────────────────────────────────────────────────── */
  function keyedMix(list) {
    const items = Array.isArray(list) ? list : [];
    return (
      items.some(function (item) {
        return item && item.key === true;
      }) &&
      items.some(function (item) {
        return !item || item.key !== true;
      })
    );
  }

  function adjustmentFiltered(host, kind) {
    const record = host.__kitAdjustments;
    if (!record || !record.state) {
      return false;
    }
    const state = record.state;
    const base = record.base || {};
    // Index-anchored lenses cannot survive an adjustment that drops items;
    // the id-anchored ones (erd, roadmap, stack frames, sequence actors) can,
    // which is why this list names kinds rather than testing the state alone.
    if ((kind === "chart" || kind === "trace") && state.items === "key" && keyedMix(base.items)) {
      return true;
    }
    if (kind === "sequence" && state.messages === "key" && keyedMix(base.messages)) {
      return true;
    }
    if (kind === "code" && state.lines === "changes") {
      const lines = [
        ...((base.before && base.before.lines) || []),
        ...((base.after && base.after.lines) || []),
      ];
      return lines.some(function (line) {
        return typeof line === "string" || !line.kind || line.kind === "context";
      });
    }
    const isTable = host.classList.contains("kt");
    const rows = [];
    if (isTable) {
      (base.groups || []).forEach(function (group) {
        rows.push(...((group && group.rows) || []));
      });
      rows.push(...(base.rows || []));
    }
    // ktAdjustedData removes unkeyed rows only when the data actually carries
    // keyed rows — that row drop is what breaks index-anchored targets.
    if (isTable && state.items === "key") {
      const keyed = rows.some(function (row) {
        return row && row.key === true;
      });
      const unkeyed = rows.some(function (row) {
        return !row || row.key !== true;
      });
      if (keyed && unkeyed) {
        return true;
      }
    }
    // "Key text" strips authored sub/when/subs text (kf/ktAdjustedData). The
    // strip only makes editing unsafe when there is authored text to hide;
    // when every authored text still renders, targets map 1:1.
    if (state.detail === "key") {
      if (isTable) {
        return rows.some(function (row) {
          return row && row.sub != null;
        });
      }
      const timeline = base.mode === "timeline";
      return (base.items || []).some(function (item) {
        return Boolean(
          item &&
          (item.sub != null ||
            (Array.isArray(item.subs) && item.subs.length > 0) ||
            (!timeline && item.when != null)),
        );
      });
    }
    return false;
  }

  /* ── edit lifecycle ───────────────────────────────────────────────── */
  function beginEdit(item) {
    if (activeEdit) {
      return;
    }
    dropFollow();
    const el = item.el;
    if (item.kind === "prose") {
      beginProseEdit(item);
      return;
    }
    const component = session && session.component ? session.component() : null;
    if (!component || !component.data || !component.kind) {
      if (session) {
        session.toast("This visual is no longer editable in place.");
      }
      return;
    }
    const dataValue = LENSES.valueAt(component.data, item.path);
    if (dataValue == null) {
      session.toast("This field has no text to edit yet.");
      return;
    }
    if (typeof dataValue !== "string") {
      session.toast("This field has no text to edit yet.");
      return;
    }
    if (dataValue.includes("<") && !markupAllowed(dataValue)) {
      session.toast(
        "This text uses formatting that in-place editing can't keep — ask the agent to change it",
        true,
      );
      return;
    }
    const rect = el.getBoundingClientRect();
    activeEdit = {
      target: item,
      el,
      component,
      original: elementText(el),
      originalValue: dataValue,
      priorMinWidth: el.style.minWidth,
      priorMinHeight: el.style.minHeight,
      committing: false,
      cancelled: false,
      input: null,
    };
    if (isSvgTarget(el)) {
      el.classList.add("st-inline-editing");
      clearHover();
      openOverlay(activeEdit);
      showCap(activeEdit);
      return;
    }
    if (rect.width > 0) {
      el.style.minWidth = Math.ceil(rect.width) + "px";
    }
    if (rect.height > 0) {
      el.style.minHeight = Math.ceil(rect.height) + "px";
    }
    el.contentEditable = "true";
    el.spellcheck = false;
    el.classList.add("st-inline-editing");
    el.addEventListener("keydown", onKeyDown);
    el.addEventListener("input", onInput);
    el.addEventListener("blur", onBlur);
    el.addEventListener("paste", onPaste);
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    clearHover();
    showCap(activeEdit);
  }

  /* Slide prose edits the rendered element itself; the committed text is
     filed through the review API as a guarded record against that exact
     element, not as component data, so there is no data path to guard here.
     The block edits as a whole with its markup rendered: on commit the
     allowlist serializer turns the live DOM back into the string form both
     apply paths paint through, and the record keeps the FLATTENED text as
     its `before` — the apply guards compare textContent — while the
     serialized form is what cancel repaints and what `value` carries.
     Markup the serializer cannot express refuses here, after the
     affordance, and stays with the agent handoff. */
  function beginProseEdit(item) {
    const el = item.el;
    const markup = serializeInline(el);
    if (markup == null) {
      session.toast("this text uses styling Studio can't preserve — ask the agent", true);
      return;
    }
    const rect = el.getBoundingClientRect();
    activeEdit = {
      target: item,
      el,
      component: null,
      // `before` must be the EXACT live textContent: the apply guards on
      // reload compare it verbatim. elementText's trailing-newline strip is
      // a component-field convention; prose records stay exact.
      original: String(el.textContent),
      originalValue: markup,
      priorMinWidth: el.style.minWidth,
      priorMinHeight: el.style.minHeight,
      committing: false,
      cancelled: false,
      input: null,
    };
    if (rect.width > 0) {
      el.style.minWidth = Math.ceil(rect.width) + "px";
    }
    if (rect.height > 0) {
      el.style.minHeight = Math.ceil(rect.height) + "px";
    }
    el.contentEditable = "true";
    el.spellcheck = false;
    el.classList.add("st-inline-editing");
    el.addEventListener("keydown", onKeyDown);
    el.addEventListener("input", onInput);
    el.addEventListener("blur", onBlur);
    el.addEventListener("paste", onPaste);
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    clearHover();
    showCap(activeEdit);
  }

  function finishEdit() {
    if (!activeEdit) {
      return;
    }
    const edit = activeEdit;
    if (edit.input) {
      edit.input.removeEventListener("keydown", onKeyDown);
      edit.input.removeEventListener("input", onInput);
      edit.input.removeEventListener("blur", onBlur);
      edit.input.remove();
      edit.el.classList.remove("st-inline-editing");
      hideCap();
      activeEdit = null;
      return;
    }
    edit.el.removeEventListener("keydown", onKeyDown);
    edit.el.removeEventListener("input", onInput);
    edit.el.removeEventListener("blur", onBlur);
    edit.el.removeEventListener("paste", onPaste);
    // The attribute has to go, not just turn false: Studio, canvas and
    // composition key handlers all skip shortcuts inside
    // closest("[contenteditable]"), which still matches a "false" value.
    edit.el.removeAttribute("contenteditable");
    edit.el.removeAttribute("spellcheck");
    edit.el.classList.remove("st-inline-editing");
    edit.el.style.minWidth = edit.priorMinWidth;
    edit.el.style.minHeight = edit.priorMinHeight;
    // Leave the element exactly as it was found: an element that carried no
    // class or style attribute must not keep an empty one, or every edited
    // fragment would drift away from the authored markup.
    ["class", "style"].forEach(function (name) {
      if (edit.el.getAttribute(name) === "") {
        edit.el.removeAttribute(name);
      }
    });
    hideCap();
    activeEdit = null;
  }

  function onKeyDown(event) {
    if (!activeEdit) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelEdit();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (!event.shiftKey) {
        commitEdit();
      }
    }
  }

  function onInput() {
    if (activeEdit) {
      updateCap(activeEdit);
    }
  }

  function onBlur() {
    if (activeEdit && !activeEdit.cancelled && !activeEdit.committing) {
      commitEdit();
    }
  }

  /* Paste is always plain text: a formatted paste would import markup the
     serializer refuses, and source formatting is never what the author
     meant to bring over. insertText keeps the caret and follows the local
     formatting context, like typed characters. */
  function onPaste(event) {
    if (!activeEdit || activeEdit.committing || activeEdit.input) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const text = event.clipboardData ? event.clipboardData.getData("text/plain") : "";
    if (!text) {
      return;
    }
    let inserted;
    try {
      inserted = document.execCommand("insertText", false, text);
    } catch {
      inserted = false;
    }
    if (inserted) {
      return;
    }
    const selection = window.getSelection();
    if (selection && selection.rangeCount) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const node = document.createTextNode(text);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  function cancelEdit() {
    if (!activeEdit || activeEdit.committing) {
      return;
    }
    activeEdit.cancelled = true;
    if (!activeEdit.input) {
      paintInlineValue(activeEdit.el, activeEdit.originalValue);
    }
    finishEdit();
  }

  function commitEdit() {
    const edit = activeEdit;
    if (!edit || edit.committing) {
      return;
    }
    edit.committing = true;
    if (edit.input) {
      commitOverlayEdit(edit);
      return;
    }
    const value = serializeInline(edit.el);
    if (value == null) {
      // A paste or a renderer quirk left markup the string form cannot
      // express; the authored value wins and the slide keeps showing it.
      paintInlineValue(edit.el, edit.originalValue);
      finishEdit();
      session.toast(
        "This text uses formatting that in-place editing can't keep — ask the agent to change it",
        true,
      );
      return;
    }
    finishEdit();
    const record = {
      field: edit.target.field,
      lens: edit.target.kind,
      value,
      changed: value !== edit.originalValue,
    };
    lastCommit = record;
    if (value === edit.originalValue) {
      return; // nothing changed: no re-render round trip needed.
    }
    if (edit.target.kind === "prose") {
      try {
        // The record's before is the FLATTENED text the apply guards
        // compare against (textContent); `value` carries the serialized
        // markup both apply paths paint back as styled inline elements.
        // The serialized original rides along so a discard repaints the
        // styled block instead of flattening it.
        session.prose.commit(edit.el, edit.original, value, edit.originalValue);
        record.verified = edit.el.isConnected && serializeInline(edit.el) === value;
      } catch (error) {
        record.error = String((error && error.message) || error);
        session.toast("Change was not applied: " + record.error, true);
      }
      return;
    }
    let data;
    try {
      data = structuredClone(edit.component.data);
      LENSES.setAt(data, edit.target.path, value);
    } catch (error) {
      record.error = "setAt failed: " + (error && error.message);
      session.toast("Change was not applied: " + record.error, true);
      return;
    }
    try {
      session.commit({ kind: edit.component.kind, data });
    } catch (error) {
      record.error = String((error && error.message) || error);
      session.toast("Change was not applied: " + record.error, true);
      return;
    }
    // The commit's apply replaced the host DOM and re-armed the session;
    // prove the edit survived by finding the same path in the fresh DOM.
    record.verified = verifyRoundTrip(edit.target, value);
  }

  /* The floating overlay path commits the input's plain text — no markup
     can exist there, so no serializer runs. */
  function commitOverlayEdit(edit) {
    const value = edit.input.value;
    finishEdit();
    const record = {
      field: edit.target.field,
      lens: edit.target.kind,
      value,
      changed: value !== edit.original,
    };
    lastCommit = record;
    if (value === edit.originalValue) {
      return; // nothing changed: no re-render round trip needed.
    }
    let data;
    try {
      data = structuredClone(edit.component.data);
      LENSES.setAt(data, edit.target.path, value);
    } catch (error) {
      record.error = "setAt failed: " + (error && error.message);
      session.toast("Change was not applied: " + record.error, true);
      return;
    }
    try {
      session.commit({ kind: edit.component.kind, data });
    } catch (error) {
      record.error = String((error && error.message) || error);
      session.toast("Change was not applied: " + record.error, true);
      return;
    }
    record.verified = verifyRoundTrip(edit.target, value);
  }

  function verifyRoundTrip(item, value) {
    try {
      const found = targets.find(function (candidate) {
        return (
          candidate.path.length === item.path.length &&
          candidate.path.every(function (part, index) {
            return part === item.path[index];
          })
        );
      });
      if (!found) {
        // An emptied field may legitimately disappear from the render; the
        // renderer decides what an empty string means.
        return value === "";
      }
      // The re-rendered element carries the value through the renderer's
      // own passive-inline markup, so the comparison serializes it back.
      return serializeInline(found.el) === value;
    } catch {
      return false;
    }
  }

  /* ── document-level handlers ──────────────────────────────────────── */
  /* The item toolbar is this engine's own overlay: its buttons carry their
     own handlers, and a page click they never made must not rebuild the
     target map underneath them. */
  function overlayNode(node) {
    return Boolean(toolbarEl && toolbarEl.contains(node));
  }

  function onPointerDown(event) {
    if (overlayNode(event.target)) {
      return;
    }
    if (!active() || activeEdit || event.button !== 0) {
      return;
    }
    const item = resolveAt(event.target);
    // Kit chrome under the pointer must not fire under an edit or a select
    // gesture: before-after rows are <button>s that flip on click, and a
    // pointerdown preventDefault does not by itself suppress that trailing
    // click.
    const anchor = item ? null : resolveItemAt(event.target);
    if ((item && item.el.closest("button")) || (anchor && event.target.closest("button"))) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function onClick(event) {
    if (overlayNode(event.target)) {
      return;
    }
    dropFollow();
    if (!active()) {
      return;
    }
    if (!activeEdit) {
      // Kit chrome that swaps panel copy in place — the loop's current
      // stage, the stepper's current step — changes which authored field a
      // panel element names without a render event, so the map is rebuilt
      // on the click that opens an edit rather than trusted from arming.
      collectTargets();
    }
    const item = resolveAt(event.target);
    if (item) {
      // A text target always starts its inline edit; an item selection
      // never outlives the edit opening over it.
      event.preventDefault();
      event.stopImmediatePropagation();
      if (activeEdit) {
        if (activeEdit.el === item.el) {
          return; // clicking inside the open edit keeps the caret.
        }
        commitEdit();
        if (!session || !item.el.isConnected) {
          // The commit's apply may have replaced this element (or failed and
          // rolled back); a stale node must never become the editing surface.
          return;
        }
      }
      clearItemSelection();
      if (item.kind !== "prose") {
        const current = session.component ? session.component() : null;
        if (adjustmentFiltered(session.host, current && current.kind)) {
          session.toast("Showing filtered items — switch Text back to Full to edit", true);
          return;
        }
      }
      beginEdit(item);
      return;
    }
    const anchor = resolveItemAt(event.target);
    if (anchor) {
      // Clicking an item's own surface — its card padding, a row's
      // background, never one of its text fields — selects the item and
      // shows its toolbar. The select gesture swallows its trailing click
      // so kit chrome underneath (a row that flips on click) never fires
      // under it.
      event.preventDefault();
      event.stopImmediatePropagation();
      if (activeEdit) {
        commitEdit();
        if (!active()) {
          return;
        }
      }
      if (selectedItem && selectedItem.container === anchor.container) {
        return; // clicking the selected item keeps its selection.
      }
      selectItem(anchor, { x: event.clientX, y: event.clientY });
      return;
    }
    // Click-away clears the item selection; whatever else sits under the
    // click keeps its own behavior.
    if (selectedItem) {
      clearItemSelection();
    }
  }

  function onMouseOver(event) {
    if (!active() || activeEdit) {
      return;
    }
    let item = resolveAt(event.target);
    if (
      !item &&
      ((session.host && session.host.contains(event.target)) ||
        (session.prose && session.prose.scope.contains(event.target)))
    ) {
      collectTargets();
      item = resolveAt(event.target);
    }
    if (!item) {
      clearHover();
    } else if (hoveredEl !== item.el) {
      clearHover();
      item.el.classList.add("st-inline-hover");
      hoveredEl = item.el;
    }
  }

  function onMouseOut(event) {
    if (!active() || activeEdit) {
      return;
    }
    const item = resolveAt(event.target);
    if (item && item.el === hoveredEl) {
      clearHover();
    }
  }

  /* Escape clears the item selection after the layers above it (an open
     inline edit cancels itself first; a focused typing surface keeps its
     own keys), and Delete or Backspace removes the selected item through
     the same commit path the toolbar's Remove uses. */
  function onKeydown(event) {
    if (
      event.target instanceof Element &&
      event.target.closest("input,textarea,select,[contenteditable]")
    ) {
      return; // a focused typing surface owns its keys.
    }
    if (event.key === "Escape") {
      if (!selectedItem || activeEdit) {
        return; // the inline edit's own handler cancels the edit first.
      }
      event.preventDefault();
      event.stopPropagation();
      dropFollow();
      clearItemSelection();
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && selectedItem && !activeEdit) {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      runItemAction(selectedItem, "remove");
    }
  }

  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("mouseover", onMouseOver, true);
  document.addEventListener("mouseout", onMouseOut, true);
  document.addEventListener("keydown", onKeydown, true);
  document.addEventListener("scroll", onViewportShift, true);
  window.addEventListener("resize", onViewportShift);
  window.addEventListener("kitpresentchange", onPresentChange);

  /* Layout switches and canvas re-renders change the whole anchor set, so
     targets are re-collected from the live DOM on every kit render event and
     never cached across a re-render. kitcomponentchange is dispatched on
     window (which never reaches document listeners); kitcanvasrender bubbles
     up from the host. The item selection and its toolbar re-anchor from the
     fresh anchor set on the same re-render. */
  function onKitRender() {
    if (!session || activeEdit) {
      return;
    }
    if (
      (session.host && !session.host.isConnected) ||
      (session.prose && !session.prose.scope.isConnected)
    ) {
      disarm();
      return;
    }
    // A toolbar action sets pendingFollow to the item it wants the toolbar
    // on next (the duplicate, the moved item); an unrelated re-render keeps
    // the selection anchored where it was. A fresh DOM may have moved the
    // item away entirely, in which case the selection simply clears.
    const follow =
      followForSession() ||
      (selectedItem
        ? { collectionPath: selectedItem.collectionPath, index: selectedItem.index }
        : null);
    clearHover();
    clearItemSelection();
    collectTargets();
    if (follow) {
      const anchor = anchorAt(follow.collectionPath, follow.index);
      if (anchor) {
        selectItem(anchor, null);
      }
    }
  }

  window.addEventListener("kitcomponentchange", onKitRender);
  document.addEventListener("kitcanvasrender", onKitRender, true);

  /* ── the arming API studio.js drives ─────────────────────────────────
     A session arms for the selected lens-covered host (its text commits
     through component data), for slide prose (scope + fallback commit), or
     both at once — lenses always win over prose inside covered hosts. */
  function proseConfig(value) {
    if (!value || !value.scope || !value.scope.isConnected) {
      return null;
    }
    if (typeof value.commit !== "function") {
      return null;
    }
    return {
      scope: value.scope,
      isCoveredHost:
        typeof value.isCoveredHost === "function"
          ? value.isCoveredHost
          : function () {
              return false;
            },
      commit: value.commit,
    };
  }

  function arm(options) {
    if (!LENSES) {
      return false;
    }
    const lensHost = options && options.host;
    const lensCommit = options ? options.commit : null;
    const prose = options ? proseConfig(options.prose) : null;
    if (!((lensHost && typeof lensCommit === "function") || prose)) {
      return false;
    }
    if (activeEdit) {
      cancelEdit();
    }
    markArmed(lensHost || null);
    session = {
      host: lensHost || null,
      component: options && typeof options.component === "function" ? options.component : null,
      commit: typeof lensCommit === "function" ? lensCommit : null,
      toast: options && typeof options.toast === "function" ? options.toast : function () {},
      isLocked: options && typeof options.isLocked === "function" ? options.isLocked : null,
      prose,
    };
    clearHover();
    clearItemSelection();
    collectTargets();
    const follow = followForSession();
    if (follow) {
      const anchor = anchorAt(follow.collectionPath, follow.index);
      if (anchor) {
        selectItem(anchor, null);
      }
    }
    return true;
  }

  function disarm() {
    if (activeEdit) {
      cancelEdit();
    }
    markArmed(null);
    session = null;
    clearHover();
    hideCap();
    clearItemSelection();
    destroyItemToolbar();
    itemAnchors.forEach(function (anchor) {
      if (anchor.container.isConnected) {
        anchor.container.classList.remove("st-item-candidate");
      }
    });
    targets = [];
    byEl = new Map();
    itemAnchors = [];
    byContainer = new Map();
    // pendingFollow deliberately survives: a commit's own inspector rebuild
    // disarms and re-arms this engine, and claimFollow() is what decides
    // whether the follow still belongs to the session that arms next.
  }

  root.ExplainerInlineEdit = Object.freeze({
    version: 1,
    arm,
    disarm,
    armed() {
      return Boolean(session);
    },
    host() {
      return session ? session.host : null;
    },
    targets() {
      return targets.slice();
    },
    editing() {
      return Boolean(activeEdit);
    },
    lastCommit() {
      return lastCommit;
    },
  });
})(globalThis);
