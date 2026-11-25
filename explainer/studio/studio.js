/* Studio panel — injected by studio.py AFTER the review overlay, so it can
   share the same saved state via window.__RVAPI (swaps land in review.md).
   A human-editable file on purpose: edit, restart studio.py, refresh.

   What it does, all deterministic (no model in the loop):
   - LOOK: one-click style flip — the server re-runs assemble.py --style and
     serves the result in well under a second, scroll position preserved.
   - SWITCHES: components that registered with window.__kitSwappable (charts
     expose their walkthrough) re-render instantly in the page. Stable choices
     can be saved into the authored source without an agent.
   - SECTION SLIDES: inserts a reversible divider before existing content;
     it never treats a chapter break as a component replacement. */
(function () {
  "use strict";
  const SB = window.__STUDIO__ || {};
  const RV = window.__RVAPI || null;
  const reviewStore = RV && RV.store;
  const authoringSession =
    window.ExplainerStudioAuthoring && window.ExplainerStudioAuthoring.create
      ? window.ExplainerStudioAuthoring.create({
          boot: SB,
          reviewStore,
          onChange: updateSaveBar,
        })
      : null;
  // Restore draft structure before Present adopts the source nodes on reload.
  const initialPresentation = window.__present && window.__present.state();
  if (initialPresentation && initialPresentation.presenting) {
    window.__present.exit();
  }

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
  // An id read back from a saved review is not guaranteed to be a valid
  // selector, and querySelector throws on a malformed one where the callers
  // below all expect a null miss.
  function byId(id) {
    const raw = String(id || "");
    if (!raw) {
      return null;
    }
    return document.querySelector("#" + (window.CSS && CSS.escape ? CSS.escape(raw) : raw));
  }
  // Hold is a duration in ms; `true` means "long enough to read a sentence"
  function toast(msg, hold) {
    if (RV && RV.toast) {
      RV.toast(msg, hold === true ? 4200 : hold);
    }
  }

  const root = el("div");
  root.id = "st-root";
  document.body.append(root);
  document.body.classList.add("st-studio-available");
  root.addEventListener("click", (e) => {
    e.stopPropagation();
  });
  // Review's whole-page edit-text mode is hidden through studio.css
  // (`.rv-tool-edit`): unreachable in Studio, kept in plain Review.

  /* The save affordance rides the review bar next to Changes: a compact
     "● Unsaved changes" + Save pill that appears only while there is unsaved
     work, so nothing Studio-owned ever overlays the canvas or the slide
     list. The same save action fires; the "without an agent" wording lives
     in the pill's tooltip. */
  const savePill = el("div", "st-save-pill");
  const saveDot = el("span", "st-save-dot", "●");
  const saveLabel = el("span", "st-save-label", "Unsaved changes");
  const saveEdits = el("button", "st-save-button", "Save");
  let saveInFlight = false;
  let exportInFlight = false;
  saveEdits.type = "button";
  saveEdits.addEventListener("click", () => {
    if (saveInFlight || exportInFlight) {
      return;
    }
    if (!authoringSession) {
      toast("This explainer has no writable authored source.", true);
      return Promise.resolve();
    }
    if (!authoringSession.pending()) {
      toast("Everything editable in Studio is already saved.");
      return Promise.resolve();
    }
    saveEdits.disabled = true;
    saveInFlight = true;
    const previouslyInert = document.body.inert;
    document.body.inert = true;
    saveEdits.textContent = "Saving…";
    return Promise.resolve()
      .then(() => authoringSession.save())
      .then(() => {
        saveLabel.textContent = "Saved — reloading";
        return location.reload();
      })
      .catch((error) => {
        saveInFlight = false;
        document.body.inert = previouslyInert;
        saveEdits.disabled = false;
        saveEdits.textContent = "Try again";
        saveLabel.textContent = "Unsaved changes";
        toast(String(error.message || "Could not save edits"), true);
        return false;
      });
  });
  savePill.append(saveDot, saveLabel, saveEdits);
  const changesTool = document.querySelector(".rv-bar .rv-tool-changes");
  if (changesTool) {
    changesTool.after(savePill);
  } else {
    root.append(savePill); // no review bar on this page: stay reachable.
  }

  function updateSaveBar() {
    if (saveInFlight) {
      return;
    }
    const writable = Boolean(authoringSession && SB.authoring_url && SB.source_token);
    // The pill answers unsaved work rather than standing in the top bar as
    // furniture: it appears only while there is something to save.
    savePill.classList.toggle(
      "st-save-pill--pending",
      Boolean(authoringSession && authoringSession.pending()),
    );
    saveEdits.disabled = !writable;
    saveEdits.textContent = "Save";
    saveLabel.textContent = "Unsaved changes";
    savePill.title = writable
      ? "Save without sending anything to an agent"
      : "Restore or upgrade the authored source to save";
  }
  if (authoringSession) {
    authoringSession.subscribe(updateSaveBar);
    // Text, swap and canvas edits mutate the shared review store without
    // touching the authored manifest, so they cannot be seen through subscribe.
    document.addEventListener("explainer:review-changed", updateSaveBar);
  }
  updateSaveBar();
  // Inert blocks pointer/focus editing; stop document-level Studio shortcuts
  // too, so the snapshot being saved cannot race with one more edit.
  window.addEventListener(
    "keydown",
    (event) => {
      if (saveInFlight || exportInFlight) {
        event.stopImmediatePropagation();
      }
    },
    true,
  );

  let inspectorMode = "visual";
  try {
    inspectorMode = sessionStorage.getItem("st-inspector-mode") || "visual";
  } catch {}
  let selectedSection = null;
  let selectedHost = null;
  const expandedFineTune = new WeakSet();
  const navigation = el("nav", "st-navigation");
  navigation.setAttribute("aria-label", "Explainer sections");
  const workspaceHeader = el("header", "st-workspace-header");
  const home = el("a", "st-home", "Gallery");
  home.href = "/gallery?review=" + encodeURIComponent(reviewStore ? reviewStore.review : "");
  home.setAttribute("aria-label", "Studio gallery");
  const documentName = el("span", "st-document-name");
  documentName.textContent = document.title.replace(/ —.*$/, "");
  workspaceHeader.append(home, documentName);
  const readingAction = el("button", "st-reading-action", "Reading view");
  readingAction.type = "button";
  readingAction.title = "Close Studio and return to the full story (S)";
  readingAction.addEventListener("click", () => setPanelOpen(false));
  workspaceHeader.append(readingAction);
  const servedVariants = (window.__RV__ && window.__RV__.variants) || [];
  const servedVariant = servedVariants[SB.index] || servedVariants[0];
  if (servedVariant && servedVariant.file) {
    const assembledFile = String(servedVariant.file);
    const assembledName = assembledFile.split("/").pop();
    const shareable = el("a", "st-share-html", "Open HTML file ↗");
    shareable.href = "/preview?file=" + encodeURIComponent(assembledName);
    shareable.target = "_blank";
    shareable.rel = "noopener";
    shareable.title = `Open the self-contained HTML without Studio controls. Send the file itself or host it; this local URL only works on your computer. · ${assembledFile}`;
    workspaceHeader.append(shareable);
  }
  const exportPptx = el("button", "st-export-pptx", "Export presentation");
  exportPptx.type = "button";
  exportPptx.title =
    "Download an editable presentation for Google Slides or PowerPoint. Walkthrough steps become separate slides.";
  exportPptx.addEventListener("click", () => {
    if (exportInFlight || saveInFlight) {
      return;
    }
    if (!window.ExplainerPptx || typeof window.ExplainerPptx.exportDeck !== "function") {
      toast("The PPTX exporter is unavailable in this Studio session.", true);
      return;
    }
    exportInFlight = true;
    exportPptx.disabled = true;
    saveEdits.disabled = true;
    exportPptx.textContent = "Exporting…";
    const previouslyInert = document.body.inert;
    document.body.inert = true;
    const finishExport = () => {
      exportInFlight = false;
      document.body.inert = previouslyInert;
      exportPptx.disabled = false;
      exportPptx.textContent = "Export presentation";
      updateSaveBar();
    };
    const reportExportError = (error) => {
      console.error("[explainer] PPTX export failed:", error);
      toast(error.message || "The PPTX export could not be created.", true);
    };
    return Promise.resolve()
      .then(() => {
        stopCompositionEditing();
        const manifest = authoringSession
          ? authoringSession.previewManifest()
          : window.ExplainerAuthoring.read(window.__explainerAuthoring);
        return window.ExplainerPptx.exportDeck({
          manifest,
          title: documentName.textContent || document.title,
          lang: document.documentElement.lang || "en-US",
        });
      })
      .then((result) => {
        const caveat = result.warnings.length
          ? ` ${result.warnings.length} visual ${result.warnings.length === 1 ? "note" : "notes"} logged.`
          : "";
        toast(
          `Downloaded ${result.slides} editable ${result.slides === 1 ? "slide" : "slides"}.${caveat}`,
          true,
        );
        if (result.warnings.length) {
          console.info("[explainer] PPTX export notes:", result.warnings);
        }
        return result;
      })
      .catch(reportExportError)
      .then(finishExport, (error) => {
        finishExport();
        throw error;
      });
  });
  workspaceHeader.append(exportPptx);
  const presentAction = el("button", "st-present-action");
  presentAction.type = "button";
  presentAction.title = "Present from this slide (P). Press F in presentation for fullscreen.";
  presentAction.setAttribute("aria-label", "Present from this slide (P)");
  presentAction.append(el("span", "", "Present"), el("kbd", "", "P"));
  presentAction.addEventListener("click", () => {
    const presentToggle = document.querySelector("#presentToggle");
    if (presentToggle) {
      presentToggle.click();
    }
  });
  workspaceHeader.append(presentAction);
  root.append(workspaceHeader, navigation);

  function workspaceSections() {
    return [...document.querySelectorAll(".shell section")].filter(
      (section) =>
        !section.parentElement.closest("section") &&
        !section.dataset.stRemoved &&
        !section.dataset.authoringHidden,
    );
  }
  const authoredSectionOrder = workspaceSections().map((section) => section.id);
  function applySectionOrder(ids) {
    const sections = workspaceSections();
    if (
      !sections.length ||
      sections.some((section) => section.parentElement !== sections[0].parentElement)
    ) {
      return false;
    }
    const rank = new Map(ids.map((id, index) => [id, index]));
    const ordered = sections.toSorted(
      (a, b) =>
        (rank.has(a.id) ? rank.get(a.id) : ids.length) -
        (rank.has(b.id) ? rank.get(b.id) : ids.length),
    );
    const marker = document.createComment("Studio section order");
    sections[0].before(marker);
    ordered.forEach((section) => marker.before(section));
    marker.remove();
    if (window.__present && window.__present.reorderSections) {
      window.__present.reorderSections(ordered);
    }
    renderNavigation();
    return true;
  }
  function moveSection(section, target, after) {
    if (section === target) {
      return;
    }
    const order = workspaceSections().filter((candidate) => candidate !== section);
    order.splice(order.indexOf(target) + (after ? 1 : 0), 0, section);
    const authoredId = section.dataset && section.dataset.authoringSlide;
    if (
      authoringSession &&
      typeof authoringSession.reorderSections === "function" &&
      authoringSession.reorderSections(order.map((candidate) => candidate.id))
    ) {
      window.ExplainerAuthoring.apply(authoringSession.previewManifest());
      const moved = authoredId ? window.ExplainerAuthoring.findSlide(authoredId) : byId(section.id);
      if (moved) {
        selectSection(moved);
      }
      toast("Slide moved locally — save when ready");
      return;
    }
    if (
      authoredId &&
      authoringSession &&
      typeof authoringSession.reorderSlides === "function" &&
      authoringSession.reorderSlides(order.map((candidate) => candidate.id))
    ) {
      window.ExplainerAuthoring.apply(authoringSession.previewManifest());
      const moved = window.ExplainerAuthoring.findSlide(authoredId);
      if (moved) {
        selectSection(moved);
      }
      toast("Slide moved locally — save when ready");
      return;
    }
    if (!applySectionOrder(order.map((candidate) => candidate.id))) {
      return;
    }
    if (reviewStore) {
      reviewStore.setOrder(order.map((candidate) => candidate.id));
    }
    selectSection(section);
    toast("Section moved — presentation order updated");
  }
  window.__studioDiscardOrder = function () {
    const order = authoredSectionOrder.slice();
    (reviewStore
      ? [
          ...reviewStore.sections(),
          ...reviewStore.slides().filter((record) => record.action === "insert"),
        ]
      : []
    )
      .filter((record) => record.variant === reviewStore.label)
      .forEach((record) => {
        const at = order.indexOf(record.target);
        order.splice(at === -1 ? order.length : at, 0, record.id);
      });
    return applySectionOrder(order);
  };
  function sectionTitle(section) {
    const heading = section.querySelector("h1,h2,h3,.ksc-title");
    return heading
      ? [...heading.childNodes]
          .map((node) => (node.nodeName === "BR" ? " " : node.textContent))
          .join("")
          .replaceAll(/\s+/g, " ")
          .trim()
      : section.getAttribute("aria-label") || section.id.replaceAll("-", " ") || "Untitled section";
  }
  function selectSection(section, host = null) {
    if (!section) {
      return;
    }
    selectedSection = section;
    selectedHost = host;
    workspaceSections().forEach((candidate) =>
      candidate.classList.toggle("st-active-section", candidate === section),
    );
    try {
      sessionStorage.setItem("st-section-" + (SB.slug || "page"), section.id);
    } catch {}
    renderNavigation();
    window.dispatchEvent(new CustomEvent("kitstudiosectionchange"));
    if (panel.classList.contains("st-open")) {
      renderPanel();
      window.scrollTo({ top: 0, behavior: "instant" });
      if (window.__revealAll) {
        window.__revealAll();
      }
    }
  }
  // Index the story, not just the section currently exposed by Studio.
  const searchDialog = el("dialog", "st-story-search");
  searchDialog.setAttribute("aria-label", "Search all slides");
  const searchHeader = el("div", "st-search-header");
  const searchInput = el("input");
  searchInput.type = "search";
  searchInput.placeholder = "Search all slides";
  searchInput.setAttribute("aria-label", "Search all slides");
  const searchClose = el("button", "st-search-close", "Esc");
  searchClose.type = "button";
  searchClose.setAttribute("aria-label", "Close search");
  searchHeader.append(searchInput, searchClose);
  const searchStatus = el("p", "st-search-status");
  searchStatus.setAttribute("role", "status");
  const searchResults = el("div", "st-search-results");
  searchDialog.append(
    searchHeader,
    searchStatus,
    searchResults,
    el("p", "st-search-help", "↑ ↓ to choose · Enter to open · Esc to close"),
  );
  root.append(searchDialog);
  let searchReturnFocus = null;
  let searchIndex = [];
  let searchSectionOrder = [];
  const ignoredSearch =
    "script,style,button,input,textarea,select,.kdf-walk-controls,.st-swap,.rv-pin";
  function searchableText(node) {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const chunks = [];
    while (walker.nextNode()) {
      if (!walker.currentNode.parentElement.closest(ignoredSearch)) {
        chunks.push(walker.currentNode.textContent);
      }
    }
    return chunks.join(" ").replaceAll(/\s+/g, " ").trim();
  }
  function buildSearchIndex() {
    const moved =
      window.__present && window.__present.searchSources ? window.__present.searchSources() : [];
    return (
      document.body.classList.contains("presenting") ? searchSectionOrder : workspaceSections()
    ).map((section, index) => {
      const roots = [
        section,
        ...moved.filter((item) => item.section === section).map((item) => item.node),
      ];
      const text = roots.map(searchableText).join(" ");
      const heading = roots
        .map((node) =>
          node.matches("h1,h2,.ksc-title") ? node : node.querySelector("h1,h2,.ksc-title"),
        )
        .find(Boolean);
      const title = heading
        ? heading.textContent.replaceAll(/\s+/g, " ").trim()
        : sectionTitle(section);
      return { section, number: index + 1, title, text };
    });
  }
  function closeStorySearch() {
    searchDialog.close();
    if (searchReturnFocus && searchReturnFocus.isConnected) {
      searchReturnFocus.focus({ preventScroll: true });
    }
  }
  function searchSnippet(text, query) {
    const at = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
    const start = Math.max(0, at - 55);
    const snippet = text.slice(start, Math.max(start + 170, at + query.length + 45));
    const p = el("span", "st-search-snippet");
    if (start) {
      p.append(document.createTextNode("…"));
    }
    const hit = snippet.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
    if (hit === -1) {
      p.append(document.createTextNode(snippet));
    } else {
      p.append(document.createTextNode(snippet.slice(0, hit)));
      const mark = el("mark");
      mark.textContent = snippet.slice(hit, hit + query.length);
      p.append(mark, document.createTextNode(snippet.slice(hit + query.length)));
    }
    if (start + snippet.length < text.length) {
      p.append(document.createTextNode("…"));
    }
    return p;
  }
  function renderSearchResults() {
    const query = searchInput.value.trim();
    searchResults.replaceChildren();
    if (!query) {
      searchStatus.textContent =
        "Find text anywhere in your story. Titles and slide content are included.";
      return;
    }
    const found = searchIndex.filter((item) =>
      (item.title + " " + item.text).toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    );
    searchStatus.textContent = found.length
      ? found.length + (found.length === 1 ? " matching slide" : " matching slides")
      : "No matching slides. Try another word or a shorter phrase.";
    found.forEach((item) => {
      const button = el("button", "st-search-result");
      button.type = "button";
      const title = el("strong");
      title.textContent = String(item.number).padStart(2, "0") + " · " + item.title;
      button.append(title, searchSnippet(item.text, query));
      button.addEventListener("click", () => {
        const presenting = document.body.classList.contains("presenting");
        searchDialog.close();
        if (presenting) {
          window.__present.exit();
        }
        selectSection(item.section);
        if (presenting) {
          window.__present.enterAt(item.section);
        } else {
          if (!panel.classList.contains("st-open")) {
            item.section.scrollIntoView({ block: "start" });
          }
          item.section.tabIndex = -1;
          item.section.focus({ preventScroll: true });
        }
      });
      searchResults.append(button);
    });
  }
  function openStorySearch() {
    if (searchDialog.open) {
      searchInput.focus();
      searchInput.select();
      return;
    }
    searchReturnFocus = document.activeElement;
    searchIndex = buildSearchIndex();
    renderSearchResults();
    searchDialog.showModal();
    searchInput.focus();
    searchInput.select();
  }
  function searchButton(className) {
    const button = el("button", className, "Search all slides");
    button.type = "button";
    button.title = "Search all slides (⌘F / Ctrl+F)";
    button.setAttribute("aria-label", "Search all slides");
    button.addEventListener("click", openStorySearch);
    return button;
  }
  searchClose.addEventListener("click", closeStorySearch);
  searchDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeStorySearch();
  });
  searchInput.addEventListener("input", renderSearchResults);
  window.addEventListener(
    "keydown",
    (event) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        event.stopImmediatePropagation();
        openStorySearch();
        return;
      }
      if (!searchDialog.open) {
        return;
      }
      event.stopImmediatePropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        closeStorySearch();
      }
      if (event.key === "Enter" && event.target === searchInput) {
        event.preventDefault();
        const first = searchResults.querySelector("button");
        if (first) {
          first.click();
        }
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const buttons = [...searchResults.querySelectorAll("button")];
        const at = buttons.indexOf(document.activeElement);
        if (buttons.length) {
          buttons[
            (at + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length
          ].focus();
        }
      }
    },
    true,
  );

  function renderNavigation() {
    const sections = workspaceSections();
    const selectedIndex = sections.indexOf(selectedSection);
    searchSectionOrder = sections;
    navigation.replaceChildren();
    const storyHeading = el("div", "st-story-heading");
    storyHeading.append(el("div", "st-navigation-label", "Your story"));
    const undoDeletion = el("button", "st-undo-deletion", "Undo");
    undoDeletion.type = "button";
    undoDeletion.setAttribute("aria-label", "Undo last deletion");
    undoDeletion.title = "Undo the last slide deletion in this session";
    undoDeletion.disabled = !slideAuthoring.canUndo();
    undoDeletion.addEventListener("click", () => slideAuthoring.undoRemoval());
    storyHeading.append(undoDeletion);
    navigation.append(storyHeading);
    navigation.append(searchButton("st-navigation-search"));
    navigation.append(el("p", "st-navigation-help", "Drag to reorder · select to edit"));
    const sectionTools = el("div", "st-navigation-tools");
    sectionTools.setAttribute("aria-label", "Selected slide actions");
    const insert = el("button", "st-add-section", "+ Add slide");
    insert.type = "button";
    insert.disabled = !selectedSection;
    insert.title = "Add a slide before the selected slide";
    insert.setAttribute("aria-label", "Add slide");
    insert.addEventListener("click", () => slideAuthoring.open(selectedSection, insert));
    sectionTools.append(insert);
    const duplicate = el("button", "st-duplicate-slide", "Duplicate");
    duplicate.type = "button";
    duplicate.disabled = !selectedSection;
    duplicate.title = "Duplicate this slide locally when its component data is available";
    duplicate.setAttribute("aria-label", "Duplicate selected slide");
    duplicate.addEventListener("click", () => slideAuthoring.duplicate(selectedSection));
    sectionTools.append(duplicate);
    [
      ["↑", "Move selected slide up", sections[selectedIndex - 1], false],
      ["↓", "Move selected slide down", sections[selectedIndex + 1], true],
    ].forEach(([glyph, label, target, after]) => {
      const move = el("button", "st-move-section", glyph);
      move.type = "button";
      move.setAttribute("aria-label", label);
      move.title = label;
      move.disabled = !target;
      move.addEventListener("click", () => moveSection(selectedSection, target, after));
      sectionTools.append(move);
    });
    const deletion = el("button", "st-delete-slide", "Delete");
    deletion.type = "button";
    deletion.disabled = !selectedSection || sections.length < 2;
    deletion.setAttribute(
      "aria-label",
      "Delete slide: " + (selectedSection ? sectionTitle(selectedSection) : "none selected"),
    );
    deletion.title =
      sections.length < 2
        ? "Keep at least one slide in your story"
        : "Delete the selected slide from preview · Undo is available above";
    deletion.addEventListener("click", () => slideAuthoring.remove(selectedSection));
    sectionTools.append(deletion);
    navigation.append(sectionTools);
    sections.forEach((section, index) => {
      const button = el("button", "st-section-link");
      button.type = "button";
      button.setAttribute("aria-label", "Section " + (index + 1) + ": " + sectionTitle(section));
      if (section === selectedSection) {
        button.setAttribute("aria-current", "true");
      }
      const number = el("span", "st-section-number");
      number.textContent = String(index + 1).padStart(2, "0");
      const title = el("span", "st-section-title");
      title.textContent = sectionTitle(section);
      const grip = el("span", "st-drag-grip", "⠿");
      grip.setAttribute("aria-hidden", "true");
      grip.title = "Drag to reorder this slide";
      button.title = "Select to edit · drag to reorder · right-click for slide actions";
      button.append(grip, number, title);
      button.addEventListener("click", () => selectSection(section));
      button.addEventListener("contextmenu", (event) => {
        if (document.body.classList.contains("presenting")) {
          return;
        }
        event.preventDefault();
        slideAuthoring.contextMenu(
          section,
          button,
          event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : null,
        );
      });
      button.addEventListener("keydown", (event) => {
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault();
          slideAuthoring.contextMenu(section, button);
        }
      });
      button.draggable = true;
      button.addEventListener("dragstart", (event) => {
        event.dataTransfer.setData("text/studio-section", section.id);
        event.dataTransfer.effectAllowed = "move";
        button.classList.add("st-dragging");
      });
      button.addEventListener("dragend", () => button.classList.remove("st-dragging"));
      button.addEventListener("dragover", (event) => {
        if ([...event.dataTransfer.types].includes("text/studio-section")) {
          event.preventDefault();
          button.classList.add("st-drop-target");
        }
      });
      button.addEventListener("dragleave", () => button.classList.remove("st-drop-target"));
      button.addEventListener("drop", (event) => {
        const source = byId(event.dataTransfer.getData("text/studio-section"));
        if (!source || !workspaceSections().includes(source)) {
          return;
        }
        event.preventDefault();
        const rect = button.getBoundingClientRect();
        moveSection(source, section, event.clientY > rect.top + rect.height / 2);
      });
      navigation.append(button);
    });
    requestAnimationFrame(() => {
      const current = navigation.querySelector('[aria-current="true"]');
      if (current) {
        navigation.scrollTop =
          current.offsetTop - navigation.clientHeight / 2 + current.offsetHeight / 2;
        navigation.scrollLeft =
          current.offsetLeft - navigation.clientWidth / 2 + current.offsetWidth / 2;
      }
    });
  }

  const panel = el("div", "st-panel");
  const tab = el("button", "st-tab", "⠿ Studio");
  let tabPosition = null;
  let suppressTabClick = false;
  tab.title = "Open Studio · drag to move · S shortcut";
  tab.setAttribute("aria-label", "Open Studio controls; drag or use arrow keys to move");
  tab.addEventListener("click", () => {
    if (suppressTabClick) {
      suppressTabClick = false;
      return;
    }
    togglePanel();
  });
  root.append(tab);
  root.append(panel);

  function applyTabPosition() {
    if (!tabPosition || panel.classList.contains("st-open")) {
      return;
    }
    tab.style.left = `${Math.max(8, Math.min(window.innerWidth - tab.offsetWidth - 8, tabPosition.left))}px`;
    tab.style.top = `${Math.max(8, Math.min(window.innerHeight - tab.offsetHeight - 8, tabPosition.top))}px`;
    tab.style.transform = "none";
  }

  function moveTab(left, top) {
    tabPosition = { left, top };
    applyTabPosition();
  }

  function startTabDrag(event) {
    if (event.button !== 0 || panel.classList.contains("st-open")) {
      return;
    }
    event.preventDefault();
    const rect = tab.getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    let moved = false;
    tab.setPointerCapture(event.pointerId);
    const drag = (next) => {
      const dx = next.clientX - start.x;
      const dy = next.clientY - start.y;
      moved ||= Math.abs(dx) + Math.abs(dy) > 4;
      moveTab(start.left + dx, start.top + dy);
    };
    const stop = (endEvent) => {
      suppressTabClick = endEvent.type === "pointerup" && moved;
      tab.removeEventListener("pointermove", drag);
      tab.removeEventListener("pointerup", stop);
      tab.removeEventListener("pointercancel", stop);
    };
    tab.addEventListener("pointermove", drag);
    tab.addEventListener("pointerup", stop);
    tab.addEventListener("pointercancel", stop);
  }

  function setPanelOpen(open) {
    panel.classList.toggle("st-open", open);
    tab.classList.toggle("st-on", open);
    document.body.classList.toggle("st-studio-open", open);
    if (open) {
      if (!selectedSection || !document.body.contains(selectedSection)) {
        let saved = "";
        try {
          saved = sessionStorage.getItem("st-section-" + (SB.slug || "page")) || "";
        } catch {}
        selectedSection =
          workspaceSections().find((section) => section.id === saved) ||
          workspaceSections()[0] ||
          null;
      }
      workspaceSections().forEach((section) =>
        section.classList.toggle("st-active-section", section === selectedSection),
      );
      renderNavigation();
      if (window.__revealAll) {
        window.__revealAll();
      }
      tab.removeAttribute("style");
      closePicker();
      renderPanel();
    } else {
      stopCompositionEditing();
      disarmInlineEditing();
      applyTabPosition();
      if (selectedSection) {
        // Closing Studio changes the document from one isolated slide back to
        // the full story. Wait for that layout to settle before restoring the
        // selected slide, otherwise the old isolated offset can land several
        // sections away.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            selectedSection.scrollIntoView({ block: "start", behavior: "instant" });
          });
        });
      }
    }
  }

  function togglePanel() {
    if (document.body.classList.contains("presenting")) {
      return;
    }
    setPanelOpen(!panel.classList.contains("st-open"));
  }

  // Present owns the full viewport. CSS removes the complete Studio surface
  // From layout and hit testing while preserving its open state for exit.
  // Swap buttons move with their authored heading (or remain beside a stable
  // Host), so Present needs no DOM observer or remount lifecycle.

  /* Scroll-preserving navigation (same mechanism as the review A/B flip) */
  function keepScroll() {
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    try {
      sessionStorage.setItem("rv-scroll", String(window.scrollY / max));
    } catch {}
  }

  let highlightedHost = null;
  let highlightTimer = null;
  function jumpToComponent(host) {
    if (guardPresenting()) {
      return false;
    }
    if (!host || !document.body.contains(host)) {
      return true;
    }
    if (window.__revealAll) {
      window.__revealAll();
    }
    if (panel.classList.contains("st-open")) {
      const section = host.closest("section");
      if (section && section !== selectedSection) {
        selectSection(section, host);
      }
    } else {
      host.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    if (highlightedHost) {
      highlightedHost.classList.remove("st-component-highlight");
    }
    if (highlightTimer) {
      clearTimeout(highlightTimer);
    }
    highlightedHost = host;
    host.classList.add("st-component-highlight");
    highlightTimer = setTimeout(() => {
      host.classList.remove("st-component-highlight");
      if (highlightedHost === host) {
        highlightedHost = null;
      }
    }, 1400);
    return true;
  }

  /* One-line descriptions so non-technical reviewers can choose without
     knowing the vocabulary — unknown styles just show their name */
  const STYLE_BLURBS = {
    keynote: "big type, one idea per slide — built for a room",
    playful: "vivid color, rounded shapes — same honest content",
  };

  function compactIdentity(value) {
    value = String(value || "component");
    if (value.length <= 52) {
      return value;
    }
    let hash = 2_166_136_261;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.codePointAt(i);
      hash = Math.imul(hash, 16_777_619);
    }
    return `${value.slice(0, 40)}~${Math.trunc(hash).toString(36)}`;
  }
  function componentIdentity(host) {
    if (window.ExplainerAuthoring && window.ExplainerAuthoring.identity) {
      return window.ExplainerAuthoring.identity(host);
    }
    if (host && host.id) {
      return compactIdentity("#" + host.id);
    }
    const section = host && host.closest ? host.closest("section[id]") : null;
    const scope = section || document;
    const artifacts = [...scope.querySelectorAll(".artifact")];
    const at = artifacts.indexOf(host);
    const base = section ? "#" + section.id : "page";
    if (at !== -1) {
      return compactIdentity(base + "/artifact:" + (at + 1));
    }
    const path = [];
    let node = host;
    while (node && node !== scope && node.parentElement) {
      path.unshift(
        `${node.tagName.toLowerCase()}:${
          Array.prototype.indexOf.call(node.parentElement.children, node) + 1
        }`,
      );
      node = node.parentElement;
    }
    return compactIdentity(`${base}/${path.join("/")}`);
  }
  function compactOption(value) {
    value = String(value || "setting");
    return value.length <= 28 ? value : compactIdentity(value).slice(0, 28);
  }
  function swapPrefix(host, optionKey) {
    return `@${componentIdentity(host)}|${compactOption(optionKey)}`;
  }
  function swapStateKey(host, optionKey, readable) {
    const prefix = swapPrefix(host, optionKey) + " · ";
    return prefix + String(readable || optionKey).slice(0, Math.max(0, 118 - prefix.length));
  }
  function savedStableKey(settings, prefix) {
    const marker = prefix + " · ";
    return Object.keys(settings || {}).find((key) => key.indexOf(marker) === 0) || "";
  }
  function notifyComponentChange(host) {
    if (!host) {
      return;
    }
    const driver = host.__kitPresentHolder || host.__kitChartHolder || host.__kitTableHolder;
    const count = driver && typeof driver.count === "number" ? driver.count : null;
    window.dispatchEvent(
      new CustomEvent("kitcomponentchange", {
        detail: { host, count },
      }),
    );
  }

  /* The swap catalog: what the on-page picker offers. marker = a class the
     component renders (host or rows), anchor = its section id in the
     showcase, glyph = a tiny schematic preview. Human-editable on purpose. */
  const CATALOG = [
    {
      key: "table-rows",
      label: "table rows",
      blurb: "grouped rows for any list or table of 5+ items",
      anchor: "tableRowsHead",
      marker: "kt",
      glyph:
        '<svg viewBox="0 0 24 16"><path d="M3 4h18M3 8h18M3 12h18" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>',
    },
    {
      key: "table-before-after",
      label: "before → after",
      blurb: "old state vs new state, row by row",
      anchor: "tableBaHead",
      marker: "kt",
      glyph:
        '<svg viewBox="0 0 24 16"><circle cx="4" cy="8" r="1.6" fill="currentColor"/><path d="M6.5 8h9.5M13 5l3 3-3 3" stroke="currentColor" stroke-width="1.5" fill="none"/><circle cx="20" cy="8" r="1.6" fill="currentColor"/></svg>',
    },
    {
      key: "table-compare",
      label: "compare",
      blurb: "two subjects scored over shared concerns",
      anchor: "tableCompareHead",
      marker: "kt",
      glyph:
        '<svg viewBox="0 0 24 16"><path d="M9 3v10M9 5H4M9 8H5M9 11H4" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M15 3v10M15 5h5M15 8h4M15 11h5" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>',
    },
    {
      key: "table-grid",
      label: "grid",
      blurb: "item grid grouped by tone, no headers",
      anchor: "tableGridHead",
      marker: "kt",
      glyph:
        '<svg viewBox="0 0 24 16"><rect x="4" y="2" width="7" height="5" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="13" y="2" width="7" height="5" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="4" y="9" width="7" height="5" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="13" y="9" width="7" height="5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    },
    {
      key: "table-chips",
      label: "chips",
      blurb: "grouped tag chips for labels and rosters",
      anchor: "tableChipsHead",
      marker: "kt",
      glyph:
        '<svg viewBox="0 0 24 16"><rect x="3" y="5" width="9" height="6" rx="3" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="14" y="5" width="7" height="6" rx="3" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    },
    {
      key: "table-specs",
      label: "specs",
      blurb: "subjects as columns, one winner cell per row",
      anchor: "tableSpecsHead",
      marker: "kt",
      glyph:
        '<svg viewBox="0 0 24 16"><path d="M2 4h20M2 4v9M9 4v9M16 4v9M23 4v9" stroke="currentColor" stroke-width="1.3" fill="none"/><circle cx="12.5" cy="9.5" r="1.5" fill="currentColor"/></svg>',
    },
    {
      key: "tree-org",
      label: "org chart",
      blurb: "a team or company hierarchy, boxes and connectors",
      anchor: "treeOrgHead",
      marker: "ktr",
      glyph:
        '<svg viewBox="0 0 24 16"><rect x="9" y="1.5" width="6" height="4.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M12 6v2M12 8H6M12 8h6M6 8v2M18 8v2" stroke="currentColor" stroke-width="1.4" fill="none"/><rect x="3" y="10" width="6" height="4.5" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="15" y="10" width="6" height="4.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
    },
    {
      key: "tree-files",
      label: "file map",
      blurb: "a repo or IA map — folders, rationale, leaf cards",
      anchor: "treeFilesHead",
      marker: "ktr",
      glyph:
        '<svg viewBox="0 0 24 16"><path d="M2 4.5c0-.8.6-1.4 1.4-1.4h4.6l1.6 2h11c.8 0 1.4.6 1.4 1.4v7.2c0 .8-.6 1.4-1.4 1.4H3.4C2.6 15.1 2 14.5 2 13.7z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
    },
    {
      key: "tree-evolution",
      label: "evolution",
      blurb: "before/after code structure, what moved or changed",
      anchor: "treeEvoHead",
      marker: "ktr",
      glyph:
        '<svg viewBox="0 0 24 16"><path d="M3 3v10M3 5h5M3 8h4M3 11h5" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M15 3v10M15 5h5M15 8h4M15 11h5" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M20 2.2v2.6M18.7 3.5h2.6" stroke="currentColor" stroke-width="1.4"/></svg>',
    },
    {
      key: "loop",
      label: "loop",
      blurb: "a workflow that feeds back into itself",
      anchor: "loop",
      marker: "klp",
      glyph:
        '<svg viewBox="0 0 24 16"><path d="M18 8A6 6 0 1 1 15 2.8" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    },
    {
      key: "stepper",
      label: "stepper",
      blurb: "one concept per step, prose plus code",
      anchor: "stepper",
      marker: "kst",
      glyph:
        '<svg viewBox="0 0 24 16"><circle cx="5" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="5" cy="8" r="1.2" fill="currentColor"/><circle cx="12" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="19" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    },
    {
      key: "flow",
      label: "flow",
      blurb: "a linear sequence of stations and gates",
      anchor: "flow",
      marker: "kf",
      glyph:
        '<svg viewBox="0 0 24 16"><path d="M6 8h4M14 8h4" stroke="currentColor" stroke-width="1.5" fill="none"/><circle cx="4" cy="8" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="8" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="20" cy="8" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    },
    {
      key: "flow-timeline",
      label: "timeline",
      blurb: "stations placed along a dated timeline",
      anchor: "flow-timeline",
      marker: "kf-timeline",
      glyph:
        '<svg viewBox="0 0 24 16"><path d="M2 8h20" stroke="currentColor" stroke-width="1.5" fill="none"/><circle cx="4" cy="8" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="11" cy="8" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="20" cy="8" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M15 2v12" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 2"/></svg>',
    },
    {
      key: "section",
      label: "Section title slide",
      blurb: "introduce a chapter, pause, or new part of your story",
      anchor: "section-slide",
      marker: "ksc",
      insertOnly: true,
      glyph:
        '<svg viewBox="0 0 24 16"><path d="M3 3h18v10H3z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M14 3l7 7M11 3l10 10M17 3l4 4" stroke="currentColor" stroke-width="1.3" opacity=".65"/><path d="M5 8h7M5 11h5" stroke="currentColor" stroke-width="1.5"/></svg>',
    },
    {
      key: "roadmap",
      label: "roadmap",
      blurb: "parallel workstreams, periods, milestones, and dependencies",
      aliases: ["planning", "timeline", "milestone", "dependency"],
      outcomes: ["plan delivery", "show commitments", "track dependencies"],
      anchor: "roadmap",
      marker: "krm",
      glyph:
        '<svg viewBox="0 0 24 16"><path d="M5 2v12M11 2v12M17 2v12" stroke="currentColor" stroke-width="1" opacity=".45"/><path d="M2 5h8M8 8h9M13 11h9" stroke="currentColor" stroke-width="2"/><path d="M17 8l2-2" stroke="currentColor" stroke-width="1.3"/></svg>',
    },
    {
      key: "code",
      label: "annotated diff",
      blurb: "stable before/after code with guided evidence",
      anchor: "code",
      marker: "kcd",
      glyph:
        '<svg viewBox="0 0 24 16"><path d="M2 2.5h9v11H2zM13 2.5h9v11h-9z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M4 6h5M4 9h4M15 6h5M15 9h4" stroke="currentColor" stroke-width="1.2"/><path d="M15 12h3M16.5 10.5v3" stroke="currentColor" stroke-width="1.2"/></svg>',
    },
    {
      key: "operating-model",
      label: "operating model",
      blurb: "team responsibilities, cadence, handoffs, and learning",
      anchor: "architecture-operating-model",
      marker: "kom",
      glyph:
        '<svg viewBox="0 0 24 16"><path d="M2 8h5M17 8h5M12 3v2M12 11v3" stroke="currentColor" stroke-width="1.4"/><rect x="8" y="5" width="8" height="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 1.5h4" stroke="currentColor" stroke-width="1.5"/></svg>',
    },
    {
      key: "architecture",
      label: "architecture",
      blurb: "system map with boundaries and data flow",
      anchor: "architecture",
      marker: "kdf",
      glyph:
        '<svg viewBox="0 0 24 16"><rect x="3" y="4" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="5" y="6.5" width="4" height="3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M11 8h5" stroke="currentColor" stroke-width="1.5" fill="none"/><rect x="16" y="5" width="5" height="6" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    },
    {
      key: "sequence",
      label: "sequence",
      blurb: "who calls whom, in what order — lifelines and numbered messages",
      anchor: "sequence",
      marker: "kseq",
      glyph:
        '<svg viewBox="0 0 24 16"><path d="M5 2v12M19 2v12" stroke="currentColor" stroke-width="1.4" stroke-dasharray="1.5 2"/><path d="M5 6h12" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M15 4l4 2-4 2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M19 11H7" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 2" fill="none"/><path d="M9 9l-4 2 4 2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    },
    {
      key: "erd",
      label: "erd",
      blurb: "what the data is, how it relates — entity cards and crow's-foot relationships",
      anchor: "erd",
      marker: "kerd",
      glyph:
        '<svg viewBox="0 0 24 16"><rect x="1" y="3" width="9" height="6.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M1 6.3h9" stroke="currentColor" stroke-width="1.1"/><rect x="14" y="6" width="9" height="6.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M14 9.3h9" stroke="currentColor" stroke-width="1.1"/><path d="M10 6.3h2.4M12.4 4.6l1.8 1.7-1.8 1.7" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
    },
    {
      key: "stack",
      label: "call stack",
      blurb: "one request descending through layers — guards, chips, an unwind",
      anchor: "stack",
      marker: "kcs",
      glyph:
        '<svg viewBox="0 0 24 16"><rect x="2" y="1.5" width="14" height="3.4" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="5" y="6.2" width="14" height="3.4" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="8" y="10.9" width="14" height="3.4" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M3.5 4.9v1.3M6.5 9.6v1.3" stroke="currentColor" stroke-width="1.3" fill="none"/></svg>',
    },
    {
      key: "stack-diff",
      label: "call stack diff",
      blurb: "before/after call structures for a refactor — moved, renamed, added, removed",
      anchor: "stack-diff",
      marker: "kcs",
      glyph:
        '<svg viewBox="0 0 24 16"><rect x="1" y="3" width="7" height="3" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="1" y="9.5" width="7" height="3" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M10 8h4M12 5.5l2.5 2.5-2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="16" y="3" width="7" height="3" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="16" y="9.5" width="7" height="3" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
    },
    {
      key: "chart-bars",
      label: "bar chart",
      blurb: "compare magnitudes across a few items",
      anchor: "chartBarsHost",
      marker: "kch",
      glyph:
        '<svg viewBox="0 0 24 16"><path d="M3 4h12M3 8h18M3 12h7" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>',
    },
    {
      key: "chart-line",
      label: "line chart",
      blurb: "trends over time, up to 3 series",
      anchor: "chartLineHost",
      marker: "kch",
      glyph:
        '<svg viewBox="0 0 24 16"><polyline points="3,13 9,9 14,10 21,3" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    },
    {
      key: "chart-split",
      label: "split bar",
      blurb: "part-to-whole share in one bar",
      anchor: "chartSplitHost",
      marker: "kch",
      glyph:
        '<svg viewBox="0 0 24 16"><rect x="3" y="6" width="12" height="4" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="17" y="6" width="4" height="4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    },
    {
      key: "chart-dumbbell",
      label: "dumbbell",
      blurb: "before and after values per item, one scale",
      anchor: "chartDumbbellHost",
      marker: "kch",
      glyph:
        '<svg viewBox="0 0 24 16"><path d="M5.5 8h13" stroke="currentColor" stroke-width="1.5" fill="none"/><circle cx="4" cy="8" r="1.6" fill="currentColor"/><circle cx="20" cy="8" r="1.6" fill="currentColor"/></svg>',
    },
    {
      key: "chart-histogram",
      label: "histogram",
      blurb: "a distribution over bins",
      anchor: "chartHistHost",
      marker: "kch",
      glyph:
        '<svg viewBox="0 0 24 16"><path d="M5 13V10M10 13V3M15 13V6M20 13V11" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>',
    },
    {
      key: "chart-heatmap",
      label: "heatmap",
      blurb: "magnitude over a grid, e.g. day by hour",
      anchor: "chartHeatHost",
      marker: "kch",
      glyph:
        '<svg viewBox="0 0 24 16"><path d="M3 3h4v4H3zM10 3h4v4h-4zM17 3h4v4h-4zM3 9h4v4H3zM10 9h4v4h-4zM17 9h4v4h-4z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    },
    {
      key: "chart-dots",
      label: "dot units",
      blurb: "exact counts or representation, one visible dot per unit",
      anchor: "chartDotsHost",
      marker: "kch",
      glyph:
        '<svg viewBox="0 0 24 16"><circle cx="4" cy="4" r="1.5" fill="currentColor"/><circle cx="9" cy="4" r="1.5" fill="currentColor"/><circle cx="14" cy="4" r="1.5" fill="currentColor"/><circle cx="19" cy="4" r="1.5" fill="currentColor"/><circle cx="4" cy="9" r="1.5" fill="currentColor"/><circle cx="9" cy="9" r="1.5" fill="currentColor"/><circle cx="14" cy="9" r="1.5" fill="currentColor" opacity=".4"/><circle cx="19" cy="9" r="1.5" fill="currentColor" opacity=".4"/></svg>',
    },
    {
      key: "chart-scatter",
      label: "scatter",
      blurb: "two measured axes, one point per subject",
      anchor: "chartScatterHost",
      marker: "kch",
      glyph:
        '<svg viewBox="0 0 24 16"><circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="10" cy="5" r="1.5" fill="currentColor"/><circle cx="15" cy="10" r="1.5" fill="currentColor"/><circle cx="20" cy="4" r="1.5" fill="currentColor"/></svg>',
    },
    {
      key: "chart-map",
      label: "world map",
      blurb: "values and pins on world geography",
      anchor: "chartMapHost",
      marker: "kch",
      glyph:
        '<svg viewBox="0 0 24 16"><path d="M4 8C4 4.5 8 3 12 3.5c4 .5 8 1.5 7.5 6-.4 3.5-5 4.5-9.5 4C6.5 13.1 4 11.5 4 8z" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="14" cy="8" r="1.5" fill="currentColor"/></svg>',
    },
    {
      key: "chart-stat",
      label: "big stat",
      blurb: "two or three big numbers that set scale",
      anchor: "chartStatHost",
      marker: "kch",
      glyph:
        '<svg viewBox="0 0 24 16"><text x="4" y="12" font-size="12" fill="currentColor" stroke="none">42</text><path d="M4 14.5h10" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>',
    },
    {
      key: "architecture-trace",
      label: "latency trace",
      blurb: "where a request's time goes — spans, waits, and the before/after race",
      anchor: "trace",
      marker: "ktrace",
      glyph:
        '<svg viewBox="0 0 24 16"><rect x="2" y="1.6" width="5" height="2.6" rx="1" fill="currentColor"/><rect x="9" y="6.2" width="11" height="2.6" rx="1" fill="currentColor" opacity=".55"/><rect x="5" y="10.8" width="8" height="2.6" rx="1" fill="currentColor"/><path d="M15.5 1v14" stroke="currentColor" stroke-width="1" stroke-dasharray="1.5 1.5"/></svg>',
    },
    {
      key: "iceberg",
      label: "iceberg",
      blurb: "a tiny visible tip over a mass of hidden risk",
      anchor: "iceberg",
      marker: "kib",
      glyph:
        '<svg viewBox="0 0 24 16"><path d="M12 1L17 6L12 11L7 6Z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M1 13q2.75-2.5 5.5 0t5.5 0t5.5 0t5.5 0" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    },
    {
      key: "pyramid",
      label: "pyramid",
      blurb: "layered tiers from broad base to rare apex",
      anchor: "pyramid",
      marker: "kpy",
      glyph:
        '<svg viewBox="0 0 24 16"><path d="M12 2.5L21 13.5H3z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6.9 9h10.2" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>',
    },
  ];

  let compositionEditing = null;
  let compositionSection = null;
  let compositionSelection = null;
  let compositionBaseline = "";
  let compositionCheckpoint = null;
  let compositionChanged = false;
  let structuredComponentEditor = null;
  let componentTemplateKey = "";
  let componentTemplates = new Map();
  let transientDetachment = null;

  function agentEditingLocked() {
    return document.body.classList.contains("rv-agent-waiting");
  }

  function detachedComponent(host) {
    if (!host) {
      return false;
    }
    if (window.ExplainerAuthoring && window.ExplainerAuthoring.isDetached(host)) {
      return true;
    }
    const slide = authoredSlideFor(host.closest("section"));
    if (slide && slide.component && slide.component.detached) {
      return true;
    }
    const source = authoringSession && authoringSession.sourceComponent(host);
    return Boolean(source && source.detached);
  }

  function refreshAuthoringPreview(sectionId) {
    window.ExplainerAuthoring.apply(authoringSession.previewManifest(), { strict: true });
    const refreshed = byId(sectionId);
    if (refreshed) {
      selectedSection = refreshed;
      selectedHost = refreshed.querySelector(".artifact");
    }
    renderNavigation();
    mountSwapButtons();
    mountAdjustButtons();
  }

  function rebaseDetachedScene(scene) {
    const prefix = `editable-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const ids = new Map(scene.shapes.map((shape, index) => [shape.id, `${prefix}-${index + 1}`]));
    return {
      ...scene,
      root: ids.get(scene.root),
      shapes: scene.shapes.map((shape) => ({
        ...shape,
        id: ids.get(shape.id),
        ...(shape.parent ? { parent: ids.get(shape.parent) } : {}),
      })),
    };
  }

  function makeEditable(host, options = {}) {
    if (!host || !authoringSession || !window.ExplainerDetach) {
      toast("This visual cannot be edited in this Studio session.", true);
      return false;
    }
    if (detachedComponent(host)) {
      return true;
    }
    if (!authoringSession.writable()) {
      toast("Open an explainer with a writable authored source to edit this visual.", true);
      return false;
    }
    if (agentEditingLocked()) {
      toast("Wait for the agent update to finish before editing this visual.", true);
      return false;
    }
    if (document.body.classList.contains("presenting")) {
      toast("Exit Present mode before editing this visual.", true);
      return false;
    }
    const section = host.closest("section");
    const sectionId = section && section.id;
    const slide = authoredSlideFor(section);
    const captured =
      (slide && slide.component) ||
      authoringSession.sourceComponent(host) ||
      (window.ExplainerComponentCapture && window.ExplainerComponentCapture.get(host));
    if (!captured || !captured.kind || !captured.data) {
      toast(
        "This custom visual can be arranged as one object, but its internal parts are not portable.",
        true,
      );
      return false;
    }
    try {
      const scene = rebaseDetachedScene(window.ExplainerDetach.capture({ host, section }));
      const preview = slide
        ? authoringSession.previewSlideDetachment(slide.id, scene)
        : authoringSession.previewSourceDetachment(host, scene);
      if (!preview) {
        throw new Error("This visual does not have a stable authored identity.");
      }
      stopCompositionEditing();
      transientDetachment = {
        sectionId,
        manifest: preview,
      };
      inspectorMode = "arrange";
      try {
        sessionStorage.setItem("st-inspector-mode", inspectorMode);
      } catch {}
      renderPanel();
      if (options.announce !== false && scene.warnings && scene.warnings.length) {
        toast(`Visual is editable. ${scene.warnings.join(" ")}`, true);
      }
      return true;
    } catch (error) {
      toast(`${error.message || "This visual could not be edited."} Nothing was changed.`, true);
      return false;
    }
  }

  function resetEditableVisual(host) {
    if (!host || !authoringSession || agentEditingLocked()) {
      toast("Wait for the agent update to finish before resetting this visual.", true);
      return false;
    }
    if (
      !window.confirm(
        "Reset this visual?\n\nThis discards its freeform edits and restores the original automatic layout. Other slide edits are preserved.",
      )
    ) {
      return false;
    }
    const section = host.closest("section");
    const sectionId = section && section.id;
    const slide = authoredSlideFor(section);
    const before = authoringSession.manifest();
    try {
      const restored = slide
        ? authoringSession.restoreSlideComponent(slide.id)
        : authoringSession.restoreSourceComponent(host);
      if (!restored) {
        toast("The visual could not be reset.", true);
        return false;
      }
      stopCompositionEditing();
      refreshAuthoringPreview(sectionId);
      renderPanel();
      toast("Visual reset — save when ready.");
      return true;
    } catch (error) {
      authoringSession.replace(before);
      window.ExplainerAuthoring.apply(before);
      toast(error.message || "The visual could not be reset.", true);
      return false;
    }
  }

  function editableComponentControls(host) {
    const wrapper = el("div", "st-editable-component");
    if (detachedComponent(host)) {
      wrapper.append(
        el(
          "p",
          "st-control-help",
          "Editable elements are independent. Automatic layout and component controls are paused.",
        ),
      );
      const restore = el("button", "st-reset-visual", "Reset visual");
      restore.type = "button";
      restore.disabled = agentEditingLocked();
      restore.addEventListener("click", () => resetEditableVisual(host));
      wrapper.append(restore);
      return { wrapper, detached: true };
    }
    return { wrapper: null, detached: false };
  }

  function templatesForComponent(key) {
    if (componentTemplateKey !== key) {
      componentTemplateKey = key;
      componentTemplates = new Map();
    }
    return componentTemplates;
  }

  function stopCompositionEditing() {
    const selectedSectionId = selectedSection && selectedSection.id;
    if (compositionEditing) {
      compositionEditing.destroy();
    }
    compositionEditing = null;
    compositionSection = null;
    compositionSelection = null;
    compositionBaseline = "";
    compositionCheckpoint = null;
    const shouldApply = compositionChanged;
    compositionChanged = false;
    transientDetachment = null;
    if (shouldApply && authoringSession && window.ExplainerAuthoring) {
      window.ExplainerAuthoring.apply(authoringSession.previewManifest(), { strict: true });
      selectedSection = byId(selectedSectionId) || selectedSection;
      if (selectedSection && (!selectedHost || !document.body.contains(selectedHost))) {
        selectedHost = selectedSection.querySelector(".artifact");
      }
      renderNavigation();
      mountSwapButtons();
      mountAdjustButtons();
    }
  }

  function stopStructuredComponentEditor() {
    if (structuredComponentEditor) {
      structuredComponentEditor.destroy();
    }
    structuredComponentEditor = null;
  }

  function authoredSlideFor(section = selectedSection) {
    const id = section && section.dataset ? section.dataset.authoringSlide : "";
    return id && authoringSession && typeof authoringSession.slide === "function"
      ? authoringSession.slide(id)
      : null;
  }

  function refreshAuthoredSlide(id) {
    if (!authoringSession || !window.ExplainerAuthoring || !window.ExplainerAuthoring.apply) {
      return;
    }
    window.ExplainerAuthoring.apply(authoringSession.previewManifest(), { strict: true });
    const refreshed =
      window.ExplainerAuthoring.findSlide && window.ExplainerAuthoring.findSlide(id);
    if (refreshed) {
      selectedSection = refreshed;
      selectedHost = refreshed.querySelector(".artifact");
      renderNavigation();
    }
  }

  function renderAuthoredSlideEditor() {
    const slide = authoredSlideFor();
    if (!slide || !authoringSession || typeof authoringSession.updateSlide !== "function") {
      return false;
    }
    stopStructuredComponentEditor();
    panel.append(el("div", "st-h", "slide"));
    const title = document.createElement("input");
    title.className = "st-authored-slide-title";
    title.type = "text";
    title.maxLength = 300;
    title.value = slide.title || "";
    title.setAttribute("aria-label", "Slide title");
    title.addEventListener("input", () => {
      authoringSession.updateSlide(slide.id, { title: title.value });
      const heading = selectedSection && selectedSection.querySelector(".ea-authored-slide-title");
      if (heading) {
        heading.textContent = title.value;
      }
    });
    const titleField = el("label", "st-section-field");
    titleField.append(el("span", "", "Slide title"), title);
    panel.append(titleField);

    const authoredHost = selectedSection.querySelector(".artifact");
    if (detachedComponent(authoredHost)) {
      panel.append(
        el(
          "p",
          "st-control-help",
          "This visual is made of independent elements. Use Arrange to edit them.",
        ),
      );
      return true;
    }

    // A lens-covered slide component edits on the canvas: the hint replaces
    // the form, and the panel keeps only the Advanced aria field.
    const inline = authoredInlineSetup(slide, authoredHost);
    if (inline) {
      panel.append(
        el(
          "p",
          "st-inline-hint",
          "Click any text to edit it. Click an item's card for its actions.",
        ),
      );
      const commit = (component) => commitInlineAuthoredSlide(slide, authoredHost, component);
      appendInlineAdvanced(panel, inline.component, commit);
      armInlineEdit(inline, authoredHost, {
        component: () => {
          const live = authoringSession.slide(slide.id);
          return live && live.component ? live.component : slide.component;
        },
        commit,
      });
      return true;
    }

    const editor = window.ExplainerComponentEditor;
    if (!editor || !editor.canEdit || !editor.canEdit(slide.component)) {
      panel.append(
        el(
          "p",
          "st-control-help",
          "Edit its text on the slide, arrange it as one object, or use any component controls below.",
        ),
      );
      return true;
    }
    panel.append(el("div", "st-h", "component"));
    const container = el("div", "st-component-editor");
    panel.append(container);
    structuredComponentEditor = editor.mount({
      container,
      component: slide.component,
      templates: templatesForComponent(`slide:${slide.id}`),
      toast,
      onChange(component, validation) {
        if (!validation.valid) {
          return;
        }
        const previous = authoringSession.slide(slide.id);
        try {
          authoringSession.updateSlide(slide.id, { component });
          refreshAuthoredSlide(slide.id);
          renderPanel();
        } catch (error) {
          if (previous) {
            authoringSession.updateSlide(slide.id, { component: previous.component });
            refreshAuthoredSlide(slide.id);
            renderPanel();
          }
          throw error;
        }
      },
    });
    return true;
  }

  /* ── inline content editing (studio/inline-edit.js) ───────────────────
     Studio owns the arming decision: on the Visual tab the selected section
     arms for slide prose (the fallback), plus lens targets when the selected
     host is lens-covered. Everything else disarms, and the page outside the
     selected section never changes. */
  function inlineEditSetupFor(host) {
    const lenses = window.ExplainerInlineEditLenses;
    const engine = window.ExplainerInlineEdit;
    if (!host || !engine || !lenses || !authoringSession || !window.ExplainerComponentCapture) {
      return null;
    }
    const component =
      authoringSession.sourceComponent(host) || window.ExplainerComponentCapture.get(host);
    if (
      !component ||
      !window.ExplainerComponentEditor ||
      !window.ExplainerComponentEditor.canEdit(component) ||
      !authoringSession.writable() ||
      agentEditingLocked() ||
      detachedComponent(host) ||
      host.classList.contains("st-canvas-editing") ||
      !lenses.supports(component.kind, component.data)
    ) {
      return null;
    }
    return { engine, lenses, component };
  }

  /* An authored slide's component: the slide record, not the source
     components map, owns its data, so the setup and the commit both go
     through the slide. */
  function authoredInlineSetup(slide, host) {
    const lenses = window.ExplainerInlineEditLenses;
    const engine = window.ExplainerInlineEdit;
    const component = slide && slide.component;
    if (!host || !host.isConnected || !engine || !lenses || !component || !component.data) {
      return null;
    }
    if (
      !window.ExplainerComponentEditor ||
      !window.ExplainerComponentEditor.canEdit(component) ||
      !authoringSession.writable() ||
      agentEditingLocked() ||
      detachedComponent(host) ||
      host.classList.contains("st-canvas-editing") ||
      !lenses.supports(component.kind, component.data)
    ) {
      return null;
    }
    return { engine, lenses, component };
  }

  /* Whether one element is itself a lens-covered component host: its text
     belongs to its lenses, so the engine never resolves a click past it and
     slide prose never offers anything inside it. */
  function inlineCoveredHost(node) {
    if (!node || !node.classList || !node.classList.contains("artifact")) {
      return false;
    }
    if (node.closest("#st-root") || node.closest("#rv-root")) {
      return false;
    }
    const lenses = window.ExplainerInlineEditLenses;
    if (!lenses) {
      return false;
    }
    const component = authoringSession ? authoringSession.sourceComponent(node) : null;
    const captured =
      component || !window.ExplainerComponentCapture
        ? null
        : window.ExplainerComponentCapture.get(node);
    const resolved = component || captured;
    return Boolean(resolved && lenses.supports(resolved.kind, resolved.data));
  }

  /* Slide prose commits through the review API: the guarded record rides
     the existing review state → manifest text override → save pipeline. */
  function proseSetup() {
    const engine = window.ExplainerInlineEdit;
    const section = selectedSection && selectedSection.isConnected ? selectedSection : null;
    if (!engine || !section || !RV || typeof RV.recordTextEdit !== "function") {
      return null;
    }
    return {
      scope: section,
      isCoveredHost: inlineCoveredHost,
      commit: (node, before, after, beforeMarkup) =>
        RV.recordTextEdit(node, before, after, beforeMarkup),
    };
  }

  function armInlineEdit(setup, host, overrides = {}) {
    const prose = proseSetup();
    setup.engine.arm({
      host,
      component:
        typeof overrides.component === "function"
          ? overrides.component
          : () =>
              authoringSession.sourceComponent(host) ||
              (window.ExplainerComponentCapture
                ? window.ExplainerComponentCapture.get(host)
                : null),
      commit:
        typeof overrides.commit === "function"
          ? overrides.commit
          : (component) => commitInlineComponent(host, component),
      toast,
      isLocked: agentEditingLocked,
      ...(prose ? { prose } : {}),
    });
  }

  // Prose-only arming: the Visual tab keeps slide text editable even when no
  // lens-covered component is selected (or the section has none at all).
  function armProseOnly() {
    const engine = window.ExplainerInlineEdit;
    if (!engine || engine.armed()) {
      return; // a lens session already carries prose.
    }
    const prose = proseSetup();
    if (prose) {
      engine.arm({ prose });
    }
  }

  function commitInlineComponent(host, component) {
    // The exact commit sequence the structured form below uses: update the
    // session, apply the preview manifest, and on a throw restore the saved
    // manifest and re-render the component that was on the slide.
    const before = authoringSession.manifest();
    const applied =
      authoringSession.sourceComponent(host) || window.ExplainerComponentCapture.get(host);
    try {
      authoringSession.updateSourceComponent(host, component);
      window.ExplainerAuthoring.apply(authoringSession.previewManifest(), { strict: true });
      selectedHost = host;
      renderNavigation();
      renderPanel();
    } catch (error) {
      authoringSession.replace(before);
      if (applied) {
        window.ExplainerAuthoring.renderComponent(host, applied);
      }
      window.ExplainerAuthoring.apply(before);
      renderPanel();
      throw error;
    }
  }

  function commitInlineAuthoredSlide(slide, host, component) {
    // The authored-slide twin of commitInlineComponent: the slide record owns
    // the data, so the update, rollback, and re-render all go through it.
    const previous = authoringSession.slide(slide.id);
    try {
      authoringSession.updateSlide(slide.id, { component });
      refreshAuthoredSlide(slide.id);
      selectedHost = host;
      renderNavigation();
      renderPanel();
    } catch (error) {
      if (previous) {
        authoringSession.updateSlide(slide.id, { component: previous.component });
        refreshAuthoredSlide(slide.id);
        renderPanel();
      }
      throw error;
    }
  }

  /* ── the covered component's panel content ───────────────────────────
     With the structured form retired for lens-covered components, the
     Visual panel keeps exactly what the slide cannot do: the one invisible
     field, ariaLabel, behind a collapsed Advanced disclosure. Items edit
     on the canvas — clicking a card selects it for its toolbar — so the
     panel carries no item summaries. The action clones the component,
     mutates the copy, validates it, and commits through the same
     update → apply → rollback sequence an inline edit uses. */
  function commitInlinePanelEdit(component, commit, mutator) {
    let next;
    try {
      next = structuredClone(component);
      mutator(next.data);
    } catch (error) {
      toast("Change was not applied: " + String((error && error.message) || error), true);
      return;
    }
    const validation = window.ExplainerComponentEditor.validate(next);
    if (!validation.valid) {
      toast("Change was not applied: " + validation.errors[0], true);
      return;
    }
    try {
      commit(next);
    } catch (error) {
      toast("Change was not applied: " + String((error && error.message) || error), true);
    }
  }

  function appendInlineAdvanced(container, component, commit) {
    const details = el("details", "st-advanced");
    details.append(el("summary", "", "Advanced"));
    const field = el("label", "ece-field st-advanced-field");
    field.append(el("span", "ece-label", "Aria label"));
    const input = el("input", "ece-control");
    input.type = "text";
    input.value = typeof component.data.ariaLabel === "string" ? component.data.ariaLabel : "";
    input.placeholder = "Screen-reader label for this visual";
    input.setAttribute("aria-label", "Aria label for this visual");
    input.addEventListener("change", function () {
      const next = input.value;
      commitInlinePanelEdit(component, commit, function (data) {
        if (next === "") {
          delete data.ariaLabel;
        } else {
          data.ariaLabel = next;
        }
      });
    });
    field.append(input);
    details.append(
      field,
      el(
        "p",
        "st-control-help",
        "The label screen readers announce for this visual. Everything else edits on the slide.",
      ),
    );
    container.append(details);
  }

  function disarmInlineEditing() {
    if (window.ExplainerInlineEdit) {
      window.ExplainerInlineEdit.disarm();
    }
  }

  // The tweaks accordion can move the host selection without a panel
  // rebuild, so inline editing re-derives its target from the live state.
  function syncInlineEditHost(host) {
    const engine = window.ExplainerInlineEdit;
    if (!engine) {
      return;
    }
    const visual =
      inspectorMode === "visual" &&
      panel.classList.contains("st-open") &&
      !document.body.classList.contains("presenting");
    const setup = visual && host && host.isConnected ? inlineEditSetupFor(host) : null;
    if (setup) {
      armInlineEdit(setup, host);
      return;
    }
    const prose = visual ? proseSetup() : null;
    if (prose) {
      // Replaces any session armed for the previous host: prose owns the
      // slide whenever no lens-covered component is selected.
      engine.arm({ prose });
      return;
    }
    engine.disarm();
  }

  function renderSourceComponentEditor() {
    if (
      !selectedSection ||
      authoredSlideFor() ||
      !authoringSession ||
      !window.ExplainerComponentEditor ||
      !window.ExplainerComponentCapture
    ) {
      return false;
    }
    const artifacts = [...selectedSection.querySelectorAll(".artifact")];
    const host =
      selectedHost && selectedSection.contains(selectedHost)
        ? selectedHost
        : artifacts.length === 1
          ? artifacts[0]
          : null;
    if (!host) {
      return false;
    }
    if (detachedComponent(host)) {
      return false;
    }
    const saved = authoringSession.sourceComponent(host);
    let applied = saved || window.ExplainerComponentCapture.get(host);
    const editor = window.ExplainerComponentEditor;
    if (!applied || !editor.canEdit(applied)) {
      return false;
    }
    selectedHost = host;
    // A lens-covered host edits on the canvas: the panel keeps the hint,
    // the Advanced aria field, and the chip sections below — never an item
    // summary. Non-covered kinds keep today's full form.
    const inline = inlineEditSetupFor(host);
    if (inline) {
      panel.append(
        el(
          "p",
          "st-inline-hint",
          "Click any text to edit it. Click an item's card for its actions.",
        ),
      );
      appendInlineAdvanced(panel, inline.component, (component) =>
        commitInlineComponent(host, component),
      );
      armInlineEdit(inline, host);
      return true;
    }
    panel.append(el("div", "st-h", "content"));
    const container = el("div", "st-component-editor");
    panel.append(container);
    structuredComponentEditor = editor.mount({
      container,
      component: applied,
      templates: templatesForComponent(`host:${window.ExplainerAuthoring.identity(host)}`),
      toast,
      onChange(component, validation) {
        if (!validation.valid) {
          return;
        }
        const before = authoringSession.manifest();
        try {
          authoringSession.updateSourceComponent(host, component);
          window.ExplainerAuthoring.apply(authoringSession.previewManifest(), { strict: true });
          applied = component;
          selectedHost = host;
          renderNavigation();
          renderPanel();
        } catch (error) {
          authoringSession.replace(before);
          window.ExplainerAuthoring.renderComponent(host, applied);
          window.ExplainerAuthoring.apply(before);
          renderPanel();
          throw error;
        }
      },
    });
    return true;
  }

  function renderArrangePanel() {
    if (!selectedSection || !authoringSession || !window.ExplainerComposition) {
      panel.append(
        el(
          "p",
          "st-empty",
          "Open an explainer with a writable authored source to arrange visuals and shapes.",
        ),
      );
      return;
    }
    if (agentEditingLocked()) {
      panel.append(
        el(
          "p",
          "st-empty",
          "The agent is updating this explainer. Element editing unlocks when it finishes.",
        ),
      );
      return;
    }
    panel.append(
      el(
        "p",
        "st-arrange-intro",
        "Click a visual to move it as one object. Double-click it to work with its individual parts.",
      ),
    );
    const historyActions = el("div", "st-history-actions");
    const undo = el("button", "", "Undo");
    const redo = el("button", "", "Redo");
    undo.type = "button";
    redo.type = "button";
    function updateHistoryActions() {
      undo.disabled = !(compositionEditing && compositionEditing.canUndo());
      redo.disabled = !(compositionEditing && compositionEditing.canRedo());
    }
    undo.addEventListener("click", () => {
      if (compositionEditing) {
        compositionEditing.undo();
      }
    });
    redo.addEventListener("click", () => {
      if (compositionEditing) {
        compositionEditing.redo();
      }
    });
    historyActions.append(undo, redo);
    panel.append(historyActions);
    // "Edit slide text" is gone by design: slide text edits in place on the
    // Visual tab (click any text and type), and Arrange stays about shapes.
    panel.append(el("div", "st-h", "add shape"));

    const tools = el("div", "st-shape-tools");
    const toolButtons = new Map();
    function updateToolButtons() {
      const armed = compositionEditing ? compositionEditing.armedTool() : null;
      toolButtons.forEach((button, type) => {
        const on = type === armed;
        button.classList.toggle("st-armed", on);
        button.setAttribute("aria-pressed", String(on));
      });
    }
    [
      ["rect", "Rectangle"],
      ["ellipse", "Ellipse"],
      ["line", "Line"],
      ["arrow", "Arrow"],
      ["text", "Text label"],
    ].forEach(([type, label]) => {
      const button = el("button", "st-shape-add", label);
      button.type = "button";
      button.setAttribute("aria-pressed", "false");
      button.title = "Arm the tool, then draw on the slide (Escape disarms)";
      button.addEventListener("click", () => {
        if (!compositionEditing) {
          return;
        }
        if (compositionEditing.armedTool() === type) {
          compositionEditing.disarmTool();
        } else if (!compositionEditing.armTool(type)) {
          toast("Wait for the agent update to finish before drawing.", true);
        }
      });
      toolButtons.set(type, button);
      tools.append(button);
    });
    panel.append(tools, el("div", "st-h", "selection"));
    const selection = el("div", "st-shape-selection");
    panel.append(selection);

    function field(label, input) {
      const row = el("label", "st-shape-field");
      row.append(el("span", "", label), input);
      return row;
    }
    function updateSelection(value) {
      compositionSelection = value;
      selection.replaceChildren();
      if (!value) {
        selection.append(
          el("p", "st-empty", "Select a shape or outlined visual on the slide to edit it."),
        );
        return;
      }
      if (value.kind === "component") {
        selection.append(
          el("strong", "st-selection-title", "Visual"),
          el("p", "st-control-help", "Drag to move it. Use the green handle to resize it."),
        );
        return;
      }
      if (value.kind === "multiple") {
        selection.append(
          el("strong", "st-selection-title", `${value.ids.length} elements selected`),
          el(
            "p",
            "st-control-help",
            value.canGroup
              ? "Drag them together, or group them for one-click editing."
              : "Drag them together. Grouping stays within one editable visual so Reset remains safe.",
          ),
        );
        const actions = el("div", "st-shape-actions");
        [
          ["Group", () => compositionEditing.group()],
          ["Duplicate", () => compositionEditing.duplicate()],
          ["Delete", () => compositionEditing.remove()],
        ].forEach(([label, action]) => {
          const button = el("button", "", label);
          button.type = "button";
          if (label === "Group" && value.canGroup === false) {
            button.disabled = true;
            button.title = "Group elements within one editable visual at a time";
          }
          button.addEventListener("click", action);
          actions.append(button);
        });
        selection.append(actions);
        return;
      }
      const name =
        value.type === "rect" ? "Rectangle" : value.type === "group" ? "Element group" : value.type;
      selection.append(
        el(
          "strong",
          "st-selection-title",
          value.type === "group" ? name : name.charAt(0).toUpperCase() + name.slice(1) + " shape",
        ),
      );
      if (value.type === "group") {
        const groupColor = (label, key, fallback) => {
          const input = el("input");
          input.type = "color";
          input.value = fallback;
          input.addEventListener("input", () =>
            compositionEditing.patch(value.id, { groupStyle: { [key]: input.value } }),
          );
          selection.append(field(label, input));
        };
        groupColor("Fill", "fill", "#30d158");
        groupColor("Stroke", "stroke", "#111827");
        groupColor("Text", "text", "#111827");
      } else {
        // Single shapes style through the floating toolbar beside them on
        // the slide; the panel keeps only their slide-level actions.
        selection.append(
          el(
            "p",
            "st-control-help",
            value.type === "text"
              ? "Fill, stroke, duplicate and delete are on the toolbar beside the shape. Double-click it on the slide to edit its text."
              : "Fill, stroke, duplicate and delete are on the toolbar beside the shape.",
          ),
        );
      }
      const actions = el("div", "st-shape-actions");
      [
        ["Backward", () => compositionEditing.sendBackward()],
        ["Forward", () => compositionEditing.bringForward()],
        ["Duplicate", () => compositionEditing.duplicate()],
        ...(value.type === "group" ? [["Ungroup", () => compositionEditing.ungroup()]] : []),
        ["Delete", () => compositionEditing.remove(value.id)],
      ].forEach(([label, action]) => {
        const button = el("button", "", label);
        button.type = "button";
        button.addEventListener("click", action);
        actions.append(button);
      });
      selection.append(actions);
    }

    if (compositionSection !== selectedSection) {
      const pendingTransient =
        transientDetachment && transientDetachment.sectionId === selectedSection.id
          ? transientDetachment
          : null;
      stopCompositionEditing();
      transientDetachment = pendingTransient;
      compositionSection = selectedSection;
      const manifest = pendingTransient ? pendingTransient.manifest : authoringSession.manifest();
      compositionCheckpoint = authoringSession.checkpoint();
      compositionBaseline = JSON.stringify(manifest);
      compositionEditing = window.ExplainerComposition.create({
        root: selectedSection,
        manifest,
        onChange: (next) => {
          compositionChanged = JSON.stringify(next) !== compositionBaseline;
          if (compositionChanged) {
            authoringSession.replace(next);
          } else {
            authoringSession.restoreCheckpoint(compositionCheckpoint);
          }
        },
        onSelect: updateSelection,
        onHistory: updateHistoryActions,
        onActivateComponent: (host) => makeEditable(host, { announce: true }),
        onToolChange: () => updateToolButtons(),
        isLocked: agentEditingLocked,
      });
    }
    updateSelection(compositionSelection);
    updateHistoryActions();
    updateToolButtons();
  }

  function renderPanel() {
    if (inspectorMode !== "arrange") {
      stopCompositionEditing();
    }
    stopStructuredComponentEditor();
    // Every mode re-derives arming from the live state; the Visual branch
    // below re-arms when the selected host is lens-covered.
    disarmInlineEditing();
    panel.innerHTML = "";
    panel.append(el("div", "st-inspector-label", "Inspector"));
    const inspectorTitle = el("div", "st-inspector-title");
    inspectorTitle.textContent = selectedSection
      ? sectionTitle(selectedSection)
      : "Select a section";
    panel.append(inspectorTitle);
    const tabs = el("div", "st-inspector-tabs");
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Studio inspector");
    const inspectorTabs = [
      ["visual", "Visual"],
      ["arrange", "Arrange"],
      ["appearance", "Appearance"],
    ];
    inspectorTabs.forEach(([mode, label], index) => {
      const button = el("button", mode === inspectorMode ? "st-selected" : "", label);
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(mode === inspectorMode));
      button.tabIndex = mode === inspectorMode ? 0 : -1;
      button.addEventListener("keydown", (event) => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? inspectorTabs.length - 1
                : (index + (event.key === "ArrowRight" ? 1 : -1) + inspectorTabs.length) %
                  inspectorTabs.length;
          inspectorMode = inspectorTabs[next][0];
          try {
            sessionStorage.setItem("st-inspector-mode", inspectorMode);
          } catch {}
          renderPanel();
          panel.querySelector('[role="tab"][aria-selected="true"]').focus();
        }
      });
      button.addEventListener("click", () => {
        inspectorMode = mode;
        try {
          sessionStorage.setItem("st-inspector-mode", mode);
        } catch {}
        renderPanel();
      });
      tabs.append(button);
    });
    panel.append(tabs);
    if (inspectorMode === "arrange") {
      renderArrangePanel();
      return;
    }
    if (inspectorMode === "visual") {
      panel.append(el("div", "st-inspector-group-heading", "Section"));
      if (!renderAuthoredSlideEditor()) {
        renderSourceComponentEditor();
      }
      // Slide prose edits in place wherever the selected section stands,
      // including sections with no lens-covered component at all.
      armProseOnly();
    }

    /* ── UPGRADE: an older page + a reachable source = one click ── */
    if (SB.upgrade) {
      const update = el("section", "st-update");
      update.setAttribute("aria-labelledby", "st-update-title");
      const updateHead = el("div", "st-update-head");
      const updateMark = el("span", "st-update-mark", "↻");
      updateMark.setAttribute("aria-hidden", "true");
      const updateIdentity = el("div", "st-update-identity");
      const updateTitle = el("strong", null, "Update explainer");
      updateTitle.id = "st-update-title";
      const updateVersion = el(
        "span",
        null,
        `v${SB.page_version || "unknown"} → v${SB.kit_version}`,
      );
      updateIdentity.append(updateTitle, updateVersion);
      updateHead.append(updateMark, updateIdentity);
      update.append(updateHead);

      const up = el("p", "st-update-copy");
      up.textContent = SB.upgrade_requires_style
        ? `The ${SB.current || "current"} theme is no longer available. Choose a current theme to rebuild this explainer.`
        : "Refresh the components and Studio controls while keeping this story and its current theme.";
      update.append(up);
      let legacyCopyCompatibility = false;
      const upgrade = (upBtn, style) => {
        var prevErr = panel.querySelector(".st-upgrade-error");
        if (prevErr) {
          prevErr.remove();
        }
        upBtn.textContent = "Updating…";
        upBtn.disabled = true;
        fetch(SB.upgrade_url || "/api/upgrade", {
          method: "POST",
          body: JSON.stringify({
            index: SB.index || 0,
            style: style || SB.current,
            legacy_copy_compat: legacyCopyCompatibility,
          }),
        })
          .then(function (r) {
            return r.json().then((res) => ({ ok: r.ok, res }));
          })
          .then(function (result) {
            if (result.ok && result.res.ok) {
              toast("Explainer updated — reloading");
              setTimeout(function () {
                location.reload();
              }, 500);
            } else if (result.res.copy_limit_recovery) {
              legacyCopyCompatibility = true;
              upBtn.disabled = false;
              upBtn.textContent = "Keep existing copy and update";
              const recovery = el("div", "st-upgrade-error");
              recovery.textContent =
                "Some existing copy exceeds the current component limits. You can keep that copy for this update and revise it later.";
              upBtn.after(recovery);
            } else {
              throw new Error(result.res.error || "update failed");
            }
            return result.res;
          })
          .catch(function (error) {
            upBtn.disabled = false;
            upBtn.textContent = "Update explainer";
            var errDiv = el("div", "st-upgrade-error");
            errDiv.textContent = String(error.message || "update failed");
            upBtn.after(errDiv);
          });
      };
      let selectedStyle = () => SB.current;
      if (SB.upgrade_requires_style) {
        const choices = el("label", "st-upgrade-choice");
        choices.append(el("span", null, "Choose a current theme"));
        const select = el("select");
        (SB.styles || []).forEach((style) => {
          const option = el("option", null, style);
          option.value = style;
          select.append(option);
        });
        choices.append(select);
        update.append(choices);
        selectedStyle = () => select.value;
      }
      const upBtn = el("button", "st-upgrade");
      upBtn.append(el("span", null, "Update explainer"), el("span", "st-upgrade-arrow", "→"));
      upBtn.addEventListener("click", () => upgrade(upBtn, selectedStyle()));
      update.append(upBtn);
      update.append(el("p", "st-update-foot", "Previous HTML kept in _reviews/"));
      panel.append(update);
    } else if (SB.needs_upgrade) {
      const update = el("section", "st-update");
      update.setAttribute("aria-labelledby", "st-update-title");
      const updateHead = el("div", "st-update-head");
      const updateMark = el("span", "st-update-mark", "↻");
      updateMark.setAttribute("aria-hidden", "true");
      const updateIdentity = el("div", "st-update-identity");
      const updateTitle = el("strong", null, "Update unavailable");
      updateTitle.id = "st-update-title";
      const updateVersion = el("span", null, `v${SB.page_version || "unknown"}`);
      updateIdentity.append(updateTitle, updateVersion);
      updateHead.append(updateMark, updateIdentity);
      update.append(updateHead);
      update.append(
        el(
          "p",
          "st-update-copy",
          SB.upgrade_reason || "No authored source is available to rebuild this explainer.",
        ),
      );
      update.append(
        el(
          "p",
          "st-update-foot",
          "This HTML remains usable. Restore its authored source to update it.",
        ),
      );
      panel.append(update);
    }

    /* ── LOOK: style flip via server-side re-assembly ── */
    panel.append(el("div", "st-h", "theme"));
    const styles = SB.styles || [];
    if (styles.length > 0 && SB.source) {
      const grid = el("div", "st-styles");
      styles.forEach((s) => {
        var b = el("button", "st-style" + (s === SB.current ? " st-cur" : ""));
        var name = el("span", "st-name");
        name.appendChild(el("b", null, null)).textContent = s;
        name.appendChild(el("span", null, null)).textContent = STYLE_BLURBS[s] || "";
        const preview = el("span", "st-style-preview st-style-preview-" + s);
        preview.setAttribute("aria-hidden", "true");
        preview.innerHTML = "<b>Aa</b><i></i><i></i>";
        b.append(preview);
        b.appendChild(name);
        b.appendChild(el("span", "st-check", "✓"));
        b.setAttribute("role", "radio");
        b.setAttribute("aria-checked", String(s === SB.current));
        b.addEventListener("click", function () {
          if (s === SB.current) {
            return;
          }
          keepScroll();
          var q = s === SB.base ? "" : "?style=" + encodeURIComponent(s);
          // wait for the preference save to land before navigating, so a
          // beacon failure (or unavailable sendBeacon) can't lose the pick
          return recordLook(s).then(function () {
            location.href = "/" + SB.slug + q;
            return s;
          });
        });
        grid.appendChild(b);
      });
      panel.append(grid);
    } else {
      panel.append(
        el(
          "div",
          "st-empty",
          SB.upgrade
            ? "Update this page first to preview themes. A theme preview rebuilds with the current kit, so it is not only a style change on an older page."
            : "Theme controls are unavailable because this page has neither a reachable content source nor an embedded v3 source. Changes still work.",
        ),
      );
    }

    /* ── FINE-TUNE: the design tuner — type scale, spacing, measure,
       accent — lives here with the other deterministic tweaks ── */
    if (RV && RV.buildTuner) {
      panel.append(el("div", "st-h", "fine-tune"));
      const tunerBox = el("div", "st-tuner");
      tunerBox.append(
        RV.buildTuner(
          authoringSession
            ? {
                studio: true,
                tokens: authoringSession.tokens(),
                onChange: (tokens) => authoringSession.setTokens(tokens),
              }
            : { studio: true },
        ),
      );
      panel.append(tunerBox);
    }

    const pageSettings = el("div", "st-page-settings");
    const appearanceStart = [...panel.children].find(
      (node) => node.classList.contains("st-h") && node.textContent === "theme",
    );
    if (appearanceStart) {
      let node = appearanceStart;
      while (node) {
        const next = node.nextElementSibling;
        pageSettings.append(node);
        node = next;
      }
    }
    if (inspectorMode === "appearance") {
      panel.append(
        el(
          "p",
          "st-appearance-intro",
          "A consistent look across your story. Changes preview immediately.",
        ),
      );
      panel.append(pageSettings);
      return;
    }
    const swaps = (window.__kitSwappable || []).filter(function (entry) {
      return entry.host && document.body.contains(entry.host) && (entry.options || []).length;
    });
    const motions = (window.__kitMotionAdjustable || []).filter(function (entry) {
      return (
        entry.host &&
        document.body.contains(entry.host) &&
        typeof entry.get === "function" &&
        typeof entry.set === "function"
      );
    });
    const groups = [];
    function groupFor(host) {
      for (let gi = 0; gi < groups.length; gi++) {
        if (groups[gi].host === host) {
          return groups[gi];
        }
      }
      const group = { host, swap: null, motion: null };
      groups.push(group);
      return group;
    }
    swaps.forEach((entry) => {
      groupFor(entry.host).swap = entry;
    });
    motions.forEach((entry) => {
      groupFor(entry.host).motion = entry;
    });
    if (selectedSection) {
      selectedSection.querySelectorAll(".artifact").forEach((host) => {
        if (!host.closest("#st-root") && detect(host)) {
          groupFor(host);
        }
      });
    }
    // Page order, not registration order. A section inserted after load
    // registers last, so without this its row lands at the bottom of the
    // panel instead of beside the slide it was added in front of.
    groups.sort(function (a, b) {
      const rel = a.host.compareDocumentPosition(b.host);
      if (rel & Node.DOCUMENT_POSITION_FOLLOWING) {
        return -1;
      }
      return rel & Node.DOCUMENT_POSITION_PRECEDING ? 1 : 0;
    });

    function titleCase(value) {
      return String(value || "").replaceAll(/\b[a-z]/g, (letter) => letter.toUpperCase());
    }
    function componentType(group) {
      const detected = detect(group.host);
      if (group.motion && group.motion.kind) {
        return titleCase(group.motion.kind);
      }
      if (!detected) {
        return "Component";
      }
      if (detected.key === "chart-stat") {
        return "Big Stat";
      }
      if (detected.key.indexOf("chart-") === 0) {
        const chartKind = detected.key.slice(6);
        if (chartKind === "line" || chartKind === "area" || chartKind === "bars") {
          return chartKind === "bars" ? "Bar Chart" : titleCase(chartKind) + " Chart";
        }
        return titleCase(chartKind.replace("-", " ")) + (chartKind === "split" ? " Bar" : " Chart");
      }
      if (detected.key.indexOf("table-") === 0) {
        const tableMode = detected.key.slice(6);
        const tableNames = {
          rows: "Rows Table",
          "before-after": "Before–After Table",
          compare: "Compare Table",
          grid: "Grid Table",
          chips: "Chips",
          specs: "Specs Table",
        };
        return tableNames[tableMode] || "Table";
      }
      if (detected.key === "table") {
        return "Table";
      }
      if (detected.key === "flow-timeline") {
        return "Timeline Flow";
      }
      if (detected.key === "flow") {
        return "Flow";
      }
      if (detected.key === "architecture") {
        return "Architecture";
      }
      if (detected.key === "sequence") {
        return "Sequence";
      }
      if (detected.key === "erd") {
        return "ERD";
      }
      if (detected.key.indexOf("tree-") === 0) {
        return titleCase(detected.label);
      }
      return titleCase(detected.label || detected.key);
    }
    groups.forEach((group) => {
      group.typeName = componentType(group);
    });
    function slideContext(host) {
      const section = host.closest ? host.closest("section") : null;
      // swapEyebrow() may reach a document-wide eyebrow so a Swap button
      // always has an anchor. Borrowing that here would name this row after
      // the preceding slide — which is what an inserted section, whose own
      // shell carries no eyebrow, would always get.
      const eyebrow = swapEyebrow(host);
      if (eyebrow && section && section.contains(eyebrow) && eyebrow.textContent.trim()) {
        return eyebrow.textContent.trim();
      }
      if (section) {
        const heading = section.querySelector("h1, h2, h3");
        if (heading) {
          const headingLabel = heading.textContent;
          if (headingLabel && headingLabel.trim()) {
            return headingLabel.trim();
          }
        }
        const sectionLabel = section.getAttribute("aria-label");
        if (sectionLabel && sectionLabel.trim()) {
          return sectionLabel.trim();
        }
        if (section.id) {
          return "#" + section.id;
        }
      }
      return host.id ? `#${host.id}` : "Later on page";
    }

    groups.forEach((group, groupIndex) => {
      if (selectedSection && group.host.closest("section") !== selectedSection) {
        return;
      }
      if (!selectedHost || selectedHost.closest("section") !== selectedSection) {
        selectedHost = group.host;
      }
      var entry = group.swap;
      // Assembled explainers can carry an older renderer with this control.
      const optionHidden = (option) =>
        Boolean(
          option &&
          (option.hidden || (option.key === "timeScale" && group.host.classList.contains("krm"))),
        );
      var motion = group.motion;
      var details = el("details", "st-tweaks");
      details._adjustHost = group.host;
      details.dataset.pickerIndex = String(groupIndex);
      details.hidden = false;
      details.open = group.host === selectedHost;
      var summary = el("summary", "st-tweaks-summary");
      var componentLabel = group.typeName;
      summary.appendChild(el("span", "st-tweaks-name", null)).textContent = componentLabel;
      summary.appendChild(el("span", "st-tweaks-kind", null)).textContent = slideContext(
        group.host,
      );
      details.appendChild(summary);
      details.addEventListener("toggle", function () {
        // A panel rebuild can leave a queued toggle on a detached inspector.
        if (!details.isConnected) {
          return;
        }
        if (details.open) {
          details.hidden = false;
          selectedHost = group.host;
          syncInlineEditHost(group.host);
          panel.querySelectorAll(".st-tweaks[data-picker-index]").forEach(function (other) {
            if (other !== details) {
              other.open = false;
              other.hidden = false;
            }
          });
          jumpToComponent(group.host);
        }
      });
      var body = el("div", "st-tweaks-body");
      const editableControls = editableComponentControls(group.host);
      if (editableControls.wrapper) {
        body.append(editableControls.wrapper);
      }
      if (editableControls.detached) {
        details.appendChild(body);
        panel.appendChild(details);
        return;
      }
      const changeVisual = el("button", "st-change-visual", "Change visual…");
      changeVisual.type = "button";
      changeVisual.addEventListener("click", function () {
        openPicker(group.host, detect(group.host), changeVisual);
      });
      body.append(changeVisual);

      if (motion) {
        var motionRow = el("div", "st-switch st-switch-stack st-motion-row");
        var motionName = el("div", "st-name");
        motionName.appendChild(el("b", null, null)).textContent = "Motion";
        motionRow.appendChild(motionName);
        var motionCurrent = motion.get();
        var motionSeg = el("div", "st-seg st-motion");
        motionSeg.setAttribute("role", "radiogroup");
        motionSeg.setAttribute("aria-label", componentLabel + " motion");
        [
          { key: "calm", label: "Calm", title: "Quieter and slower decorative motion" },
          { key: "normal", label: "Normal", title: "Default decorative motion" },
          { key: "off", label: "Off", title: "Stop adjustable decorative motion" },
        ].forEach(function (choice) {
          var motionBtn = el("button", motionCurrent === choice.key ? "st-on" : "", choice.label);
          motionBtn.title = choice.title;
          motionBtn.setAttribute("role", "radio");
          motionBtn.setAttribute("aria-checked", String(motionCurrent === choice.key));
          motionBtn.addEventListener("click", function () {
            if (motionCurrent === choice.key || !jumpToComponent(group.host)) {
              return;
            }
            if (motion.set(choice.key, true) === false) {
              return;
            }
            motionCurrent = choice.key;
            var motionLabel = motion.key + " · motion";
            recordSwap(swapStateKey(group.host, "motion", motionLabel), choice.key, motionLabel);
            motionSeg.querySelectorAll("button").forEach(function (button) {
              var on = button === motionBtn;
              button.classList.toggle("st-on", on);
              button.setAttribute("aria-checked", String(on));
            });
            toast(componentLabel + " motion: " + choice.label.toLowerCase() + " — ready to save");
          });
          motionSeg.appendChild(motionBtn);
        });
        motionRow.appendChild(motionSeg);
        motionRow.appendChild(
          el("p", "st-layout-purpose", "Calm is quieter and slower. Previews this component only."),
        );
        body.appendChild(motionRow);
      }

      const fineTune = el("details", "st-fine-tune");
      fineTune.append(el("summary", "", "Fine-tune"));
      fineTune.open = expandedFineTune.has(group.host);
      fineTune.addEventListener("toggle", () => {
        if (fineTune.open) {
          expandedFineTune.add(group.host);
        } else {
          expandedFineTune.delete(group.host);
        }
      });
      (entry ? entry.options || [] : []).forEach(function (opt) {
        // A named-choice row stacks: the label keeps a full line and the
        // segmented control gets the panel width, so three or more choices
        // can't squeeze the label into a wrapped, ellipsized column.
        var row = el("div", "st-switch" + (opt.type === "choice" ? " st-switch-stack" : ""));
        row.dataset.optionKey = opt.key;
        row.hidden = optionHidden(opt);
        var name = el("div", "st-name");
        name.appendChild(el("b", null, null)).textContent = opt.label;
        name.style.cursor = "pointer";
        name.title = "Click to jump to this component on the page";
        name.addEventListener("click", function () {
          jumpToComponent(group.host);
        });
        row.appendChild(name);
        if (opt.type === "choice") {
          var choiceClasses = "st-seg" + ((opt.choices || []).length > 4 ? " st-seg-grid" : "");
          var seg = el("div", choiceClasses + (opt.key === "layout" ? " st-layout-choices" : ""));
          seg.setAttribute("role", "radiogroup");
          seg.setAttribute("aria-label", entry.label + " — " + opt.label);
          const purpose = el("p", "st-layout-purpose");
          const purposes =
            opt.choiceDescriptions ||
            (group.host.classList.contains("kom-program")
              ? {
                  flow: "Program briefing · Follow the work, owners, and handoffs.",
                  roles: "Accountability review · Compare responsibilities, cadence, and outputs.",
                }
              : group.host.classList.contains("krm")
                ? {
                    timeline: "Timing & dependencies · Compare dates and parallel work.",
                    phases: "Phase briefing · What starts and continues, one phase at a time.",
                    workstreams: "Ownership review · Follow each team's sequence of work.",
                  }
                : group.host.classList.contains("kdf")
                  ? {
                      free: "System reference · The authored topology and trust boundaries.",
                      stages: "Technical briefing · All systems organized by their domain.",
                      "main-flow": "Walkthrough · Only the systems and connections in your story.",
                      groups: "Executive overview · Domains and the connections between them.",
                    }
                  : {});
          if (opt.key === "layout") {
            purpose.textContent =
              purposes[entry.get(opt.key)] || "Choose a composition for this visual.";
          }
          (opt.choices || []).forEach(function (choice) {
            var b = el("button", entry.get(opt.key) === choice ? "st-on" : "", null);
            var choiceLabel = (opt.choiceLabels || {})[choice] || choice;
            b.textContent = choiceLabel;
            b.dataset.choice = choice;
            if (opt.key === "layout") {
              const sample = el("span", "st-layout-sample");
              sample.dataset.layout = choice;
              sample.setAttribute("aria-hidden", "true");
              for (let dot = 0; dot < 4; dot++) {
                sample.append(el("i"));
              }
              b.prepend(sample);
            }
            b.disabled = (opt.disabledChoices || []).includes(choice);
            b.setAttribute("role", "radio");
            b.setAttribute("aria-checked", String(entry.get(opt.key) === choice));
            b.addEventListener("click", function () {
              if (entry.get(opt.key) === choice || !jumpToComponent(group.host)) {
                return;
              }
              const roadmapId = componentIdentity(group.host);
              if (
                opt.key === "items" &&
                choice === "all" &&
                reviewStore &&
                reviewStore.roadmapKeyItems(roadmapId) &&
                typeof entry.clearRecommendedKeyItems === "function"
              ) {
                entry.clearRecommendedKeyItems();
                reviewStore.clearRoadmapKeyItems(roadmapId);
              }
              entry.set(opt.key, choice);
              body.querySelectorAll("[data-option-key]").forEach((control) => {
                const option = entry.options.find(
                  (candidate) => candidate.key === control.dataset.optionKey,
                );
                control.hidden = optionHidden(option);
              });
              const keyItems =
                opt.key === "items" &&
                choice === "key" &&
                typeof entry.keyItemSelection === "function"
                  ? entry.keyItemSelection()
                  : [];
              if (opt.key === "layout") {
                purpose.textContent = purposes[choice] || "";
              }
              notifyComponentChange(group.host);
              const direct = body.querySelector(".st-canvas-controls");
              if (direct) {
                direct.replaceWith(canvasControls(group.host));
              }
              var readable = entry.label + " · " + opt.label;
              if (
                opt.key === "pattern" &&
                group.host.dataset.stSectionPreview &&
                updateSectionRecord(group.host, choice)
              ) {
                /* The inserted section owns its pattern in one structured record. */
              } else if (keyItems.length) {
                const ids = keyItems.map((item) => item.id);
                const labels = keyItems.map((item) => item.label);
                if (reviewStore) {
                  reviewStore.setRoadmapKeyItems(roadmapId, ids, labels);
                }
                const recovery = row.nextElementSibling;
                if (recovery && typeof recovery.__studioRenderRoadmapKeys === "function") {
                  recovery.__studioRenderRoadmapKeys({ item_ids: ids, labels });
                }
              } else {
                recordSwap(swapStateKey(group.host, opt.key, readable), choice, readable);
              }
              toast(
                keyItems.length
                  ? "Key commitments: " + keyItems.length + " suggested — added to Changes"
                  : opt.label + ": " + choiceLabel + " — ready to save",
                keyItems.length,
              );
              // mirror the toggle branch: flip this segmented control in
              // place rather than re-rendering the whole panel
              seg.querySelectorAll("button").forEach(function (btn) {
                var on = btn === b;
                btn.classList.toggle("st-on", on);
                btn.setAttribute("aria-checked", String(on));
              });
              if (keyItems.length) {
                b.textContent = "Key commitments · " + keyItems.length;
              }
            });
            seg.appendChild(b);
          });
          row.appendChild(seg);
          if (opt.help) {
            row.append(el("p", "st-control-help", opt.help));
          }
          if (opt.key === "layout") {
            row.append(purpose);
          }
        } else {
          var toggle = el("button", "st-toggle" + (entry.get(opt.key) !== false ? " st-on" : ""));
          toggle.setAttribute("role", "switch");
          toggle.setAttribute("aria-checked", String(entry.get(opt.key) !== false));
          toggle.setAttribute("aria-label", entry.label + " — " + opt.label);
          toggle.addEventListener("click", function () {
            if (!jumpToComponent(group.host)) {
              return;
            }
            var on = entry.get(opt.key) === false;
            entry.set(opt.key, on);
            notifyComponentChange(group.host);
            toggle.classList.toggle("st-on", on);
            toggle.setAttribute("aria-checked", String(on));
            var readable = entry.label + " · " + opt.label;
            recordSwap(swapStateKey(group.host, opt.key, readable), on, readable);
            toast(opt.label + " " + (on ? "on" : "off") + " — ready to save");
          });
          row.appendChild(toggle);
        }
        const destination =
          !opt.primary && ["typeScale", "timeScale", "showDependencies", "view"].includes(opt.key)
            ? fineTune
            : body;
        destination.appendChild(row);
        const roadmapRecovery = roadmapKeyRecovery(group, entry, opt, row);
        if (roadmapRecovery) {
          destination.appendChild(roadmapRecovery);
        }
      });
      if (fineTune.children.length > 1) {
        body.append(fineTune);
      }
      const directControls = canvasControls(group.host);
      if (directControls) {
        body.append(directControls);
      }
      details.appendChild(body);
      panel.appendChild(details);
    });

    const activeControls = panel.querySelectorAll(".st-tweaks");
    if (!activeControls.length) {
      panel.append(
        el(
          "p",
          "st-empty",
          "Click any text to edit it, or use the section’s Change visual action to try another treatment.",
        ),
      );
    }
    // Keep the visual's settings first. Appearance is always within reach below.

    const hasMotionAPI = typeof window.__kitSetMotionPreset === "function";
    if (motions.length === 0 && hasMotionAPI) {
      const legacy = el("details", "st-tweaks");
      legacy.append(el("summary", "st-tweaks-summary", "Motion"));
      legacy.addEventListener("toggle", () => {
        if (legacy.open) {
          jumpToComponent(null);
        }
      });
      const legacyBody = el("div", "st-tweaks-body");
      legacyBody.append(el("div", "st-empty", "Choose how much motion appears across the story."));
      let legacyCurrent = window.__kitMotionPreset || "normal";
      const legacySeg = el("div", "st-seg st-motion");
      legacySeg.setAttribute("role", "radiogroup");
      legacySeg.setAttribute("aria-label", "Page motion");
      ["calm", "normal", "off"].forEach((preset) => {
        var button = el(
          "button",
          legacyCurrent === preset ? "st-on" : "",
          preset.charAt(0).toUpperCase() + preset.slice(1),
        );
        button.setAttribute("role", "radio");
        button.setAttribute("aria-checked", String(legacyCurrent === preset));
        button.addEventListener("click", function () {
          if (legacyCurrent === preset || !jumpToComponent(null)) {
            return;
          }
          window.__kitSetMotionPreset(preset);
          legacyCurrent = preset;
          recordSwap("Motion · pulse effects", preset);
          legacySeg.querySelectorAll("button").forEach(function (candidate) {
            var on = candidate === button;
            candidate.classList.toggle("st-on", on);
            candidate.setAttribute("aria-checked", String(on));
          });
        });
        legacySeg.appendChild(button);
      });
      legacyBody.append(legacySeg);
      legacy.append(legacyBody);
      panel.append(legacy);
    } else if (groups.length === 0) {
      panel.append(
        el(
          "div",
          "st-empty",
          SB.upgrade
            ? "This page does not expose component tweaks yet. Update it with the current kit to check for supported controls."
            : "No mounted component on this page exposes adjustable settings.",
        ),
      );
    }
  }

  function guardPresenting() {
    if (document.body.classList.contains("presenting")) {
      toast("exit Present mode (Esc) to switch components");
      return true;
    }
    return false;
  }

  /* Files a note anchored to a component host — how every component request,
     picked or free-typed, reaches review.md for the agent to apply. The
     note appears on the page IMMEDIATELY: a request must look like a
     request, filed and visible — never like a click that did nothing. */
  function requestNote(host, snippet, text) {
    if (!reviewStore) {
      return 0;
    }
    const section = host.closest ? host.closest("section[id]") : null;
    return reviewStore.addComment({
      comment: text,
      created: new Date().toISOString(),
      kind: "remix",
      section: section ? "#" + section.id : "",
      selector: host.id ? "#" + host.id : "",
      snippet,
      theme: document.documentElement.dataset.theme || "",
    });
  }

  function roadmapKeyRecovery(group, entry, opt, row) {
    if (
      !group.host.classList.contains("krm") ||
      !opt ||
      opt.key !== "items" ||
      typeof entry.recommendKeyItems !== "function" ||
      typeof entry.applyKeyItems !== "function" ||
      typeof entry.keyItemSelection !== "function" ||
      typeof entry.clearRecommendedKeyItems !== "function"
    ) {
      return null;
    }
    const id = componentIdentity(group.host);
    const recovery = el("div", "st-key-recovery");
    const copy = el("p", "st-control-help");
    const actions = el("div", "st-key-actions");
    recovery.append(copy, actions);
    const saved = reviewStore && reviewStore.roadmapKeyItems(id);

    function syncChoice(value, count) {
      row.querySelectorAll(".st-seg button").forEach(function (button) {
        const on = button.dataset.choice === value;
        button.classList.toggle("st-on", on);
        button.setAttribute("aria-checked", String(on));
        if (button.dataset.choice === "key" && count != null) {
          button.textContent = count
            ? "Key commitments · " + count
            : "Suggest key commitments · " + entry.recommendKeyItems().length;
        }
      });
    }
    function renderSaved(record) {
      const labels = (record && record.labels) || [];
      copy.textContent =
        "Previewing: " + (labels.length ? labels.join(", ") : record.item_ids.join(", "));
      actions.replaceChildren();
      const undo = el("button", "st-key-undo", "Undo");
      undo.type = "button";
      undo.addEventListener("click", function () {
        entry.clearRecommendedKeyItems();
        if (reviewStore) {
          reviewStore.clearRoadmapKeyItems(id);
        }
        syncChoice(entry.get("items"), 0);
        toast("Key commitments preview undone");
        renderInitial();
      });
      actions.append(undo);
      syncChoice("key", record.item_ids.length);
    }
    function renderInitial() {
      const marked = entry.keyItemSelection();
      copy.textContent = marked.length
        ? marked.length +
          " commitments are marked in the source. Choose Key commitments for a focused briefing."
        : "No commitments are marked yet. Select Suggest key commitments to preview a balanced set.";
      actions.replaceChildren();
    }
    recovery.__studioRenderRoadmapKeys = renderSaved;
    if (saved) {
      entry.applyKeyItems(saved.item_ids);
      renderSaved(saved);
    } else {
      renderInitial();
    }
    return recovery;
  }

  window.__studioDiscardRoadmapKeyItems = function (id) {
    const entry = (window.__kitSwappable || []).find(function (candidate) {
      return (
        candidate.host &&
        componentIdentity(candidate.host) === id &&
        typeof candidate.clearRecommendedKeyItems === "function"
      );
    });
    if (!entry) {
      return false;
    }
    entry.clearRecommendedKeyItems();
    notifyComponentChange(entry.host);
    return true;
  };

  /* ── "Swap", always there, beside the slide number ──
     Each slide gets one button immediately before its eyebrow. Component
     re-renders preserve the stable host/button association, so mounting is a
     bounded startup operation rather than a body-wide mutation scan. */
  let picker = null;
  let pickerAnchor = null; // The button that opened the picker — focus
  // Returns here when it closes

  const SECTION_PATTERNS = ["ribbons", "dots", "arcs", "iso", "waves", "frames", "rays", "swarm"];
  function sectionHeading(section) {
    return section
      ? [...section.querySelectorAll("h1, h2, h3")].find(function (heading) {
          return !heading.closest(".artifact");
        }) || null
      : null;
  }
  function sectionEyebrow(section) {
    return section
      ? [...section.querySelectorAll(".eyebrow")].find(function (eyebrow) {
          return !eyebrow.closest(".artifact");
        }) || null
      : null;
  }
  function sectionRecord(id) {
    return reviewStore ? reviewStore.section(id) || null : null;
  }
  function addSectionPreview(record) {
    if (!record || record.variant !== (reviewStore && reviewStore.label) || byId(record.id)) {
      return false;
    }
    const target = byId(record.target);
    if (!target || typeof window.renderSection !== "function") {
      return false;
    }
    const wrapper = document.createElement("section");
    wrapper.id = record.id;
    wrapper.className = "st-section-preview-shell";
    wrapper.dataset.stSectionPreview = record.id;
    const host = document.createElement("div");
    host.id = record.id + "-host";
    host.className = "artifact st-section-preview";
    host.dataset.stSectionPreview = record.id;
    wrapper.append(host);
    target.before(wrapper);
    window.renderSection(host, {
      ariaLabel: record.title + " section slide preview",
      kicker: record.kicker || "",
      mode: "chapter",
      pattern: record.pattern,
      title: record.title,
    });
    if (window.__present && typeof window.__present.insertPreviewBefore === "function") {
      wrapper._presentToken = window.__present.insertPreviewBefore(
        { pick: ["#" + host.id], layout: "cover" },
        target,
      );
    }
    return true;
  }
  function saveSectionRecord(record) {
    if (!reviewStore) {
      return;
    }
    reviewStore.addSection(
      record,
      workspaceSections().map((section) => section.id),
    );
  }
  function updateSectionRecord(host, pattern) {
    const id = host && host.dataset ? host.dataset.stSectionPreview : "";
    const record = sectionRecord(id);
    if (!record || !SECTION_PATTERNS.includes(pattern)) {
      return false;
    }
    return reviewStore.updateSection(id, { pattern });
  }
  window.__studioDiscardSection = function __studioDiscardSection(id) {
    const wrapper = byId(id);
    if (!wrapper) {
      return true;
    }
    if (
      wrapper._presentToken &&
      window.__present &&
      typeof window.__present.removePreview === "function"
    ) {
      window.__present.removePreview(wrapper._presentToken);
    }
    const host = wrapper.querySelector(".artifact");
    if (host && typeof host.__kitDispose === "function") {
      host.__kitDispose();
    }
    const wasSelected = wrapper.contains(selectedSection);
    const neighbor = wrapper.nextElementSibling || wrapper.previousElementSibling;
    if (reviewStore) {
      reviewStore.removeFromOrder(id);
    }
    wrapper.remove();
    if (wasSelected) {
      selectSection(neighbor && neighbor.matches("section") ? neighbor : workspaceSections()[0]);
    } else {
      renderNavigation();
    }
    return true;
  };
  function applySavedSectionPreviews() {
    if (!reviewStore) {
      return;
    }
    reviewStore.sections().forEach(function (record) {
      if (record.variant === reviewStore.label) {
        addSectionPreview(record);
      }
    });
  }
  function mountSectionButtons() {
    document.querySelectorAll("section[id]").forEach(function (section) {
      if (
        section.dataset.stSectionPreview ||
        section.closest("#st-root") ||
        section.closest("#rv-root") ||
        section.querySelector(".ksc") ||
        section._stSectionButton
      ) {
        return;
      }
      const anchor = sectionEyebrow(section) || sectionHeading(section);
      if (!anchor) {
        return;
      }
      const button = el("button", "st-insert-section", "Add section");
      button.type = "button";
      button.title = "Add a section divider before this slide; existing content stays";
      button._sectionTarget = section;
      section._stSectionButton = button;
      button.addEventListener("click", function (event) {
        event.stopPropagation();
        openSectionPicker(section, button);
      });
      anchor.before(button);
    });
  }

  function swapEyebrow(host) {
    const section = host.closest("section");
    const candidates = section
      ? [...section.querySelectorAll(".eyebrow")].filter(function (node) {
          return !node.closest(".artifact");
        })
      : [];
    const preceding = candidates.filter(function (node) {
      return Boolean(node.compareDocumentPosition(host) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    if (preceding.length > 0) {
      return preceding.at(-1);
    }
    if (candidates.length > 0) {
      return candidates[0];
    }
    const all = [...document.querySelectorAll(".eyebrow")].filter(function (node) {
      return !node.closest(".artifact");
    });
    const globalPreceding = all.filter(function (node) {
      return Boolean(node.compareDocumentPosition(host) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    return globalPreceding.length > 0 ? globalPreceding.at(-1) : null;
  }

  function mountSwapButtons() {
    // Clean up buttons whose artifact left the DOM. A slide with several
    // Artifacts intentionally keeps only the first (nearest) association.
    [...document.querySelectorAll(".st-swap")].forEach((btn) => {
      if (btn._swapHost && !document.body.contains(btn._swapHost)) {
        btn._swapHost._swapBtn = null;
        btn.remove();
      }
    });
    document.querySelectorAll(".artifact").forEach((host) => {
      if (detachedComponent(host)) {
        if (host._swapBtn) {
          host._swapBtn.remove();
          host._swapBtn = null;
        }
        return;
      }
      if (!host.id || host.closest("#st-root") || host.closest("#rv-root")) {
        return;
      }
      if (!host.firstElementChild) {
        return;
      }
      if (host.classList.contains("ksc") || host.querySelector(".ksc")) {
        return;
      }
      if (host._swapBtn && !document.body.contains(host._swapBtn)) {
        host._swapBtn = null;
      }
      if (host._swapBtn) {
        return;
      }
      var eyebrow = swapEyebrow(host);
      if (
        eyebrow &&
        eyebrow.previousElementSibling &&
        eyebrow.previousElementSibling.classList.contains("st-swap")
      ) {
        return;
      }
      var b = el("button", "st-swap", "Change visual");
      b.type = "button";
      b.title = "Choose a different visual for this section";
      b._swapHost = host;
      host._swapBtn = b;
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        openPicker(host, detect(host), b);
      });
      if (eyebrow) {
        eyebrow.before(b);
      } else {
        b.classList.add("st-swap-fallback");
        host.before(b);
      }
    });
  }

  function openAdjust(host) {
    selectedSection = host.closest("section") || selectedSection;
    selectedHost = host;
    inspectorMode = "visual";
    setPanelOpen(true);
    const details = [...panel.querySelectorAll(".st-tweaks")].find(
      (entry) => entry._adjustHost === host,
    );
    if (!details) {
      toast("No adjustments are available for this component", true);
      return;
    }
    details.hidden = false;
    details.open = true;
    const summary = details.querySelector(".st-tweaks-summary");
    requestAnimationFrame(function () {
      panel.scrollTop = 0;
      if (summary) {
        summary.focus({ preventScroll: true });
      }
    });
  }

  function mountAdjustButtons() {
    [...document.querySelectorAll(".st-adjust")].forEach((button) => {
      if (
        button._adjustHost &&
        (!document.body.contains(button._adjustHost) || detachedComponent(button._adjustHost))
      ) {
        button._adjustHost._adjustBtn = null;
        button.remove();
      }
    });
    const hosts = [];
    [...(window.__kitSwappable || []), ...(window.__kitMotionAdjustable || [])].forEach((entry) => {
      if (
        entry.host &&
        document.body.contains(entry.host) &&
        !hosts.includes(entry.host) &&
        ((entry.options || []).length ||
          (typeof entry.get === "function" && typeof entry.set === "function"))
      ) {
        hosts.push(entry.host);
      }
    });
    hosts.forEach(function (host) {
      if (host._adjustBtn && !document.body.contains(host._adjustBtn)) {
        host._adjustBtn = null;
      }
      if (host._adjustBtn) {
        return;
      }
      const eyebrow = swapEyebrow(host);
      const button = el("button", "st-adjust", "Adjust");
      button.type = "button";
      button.title = "Open this component's controls in Studio";
      button._adjustHost = host;
      host._adjustBtn = button;
      button.addEventListener("click", function (event) {
        event.stopPropagation();
        openAdjust(host);
      });
      if (eyebrow) {
        eyebrow.before(button);
      } else {
        button.classList.add("st-adjust-fallback");
        host.before(button);
      }
    });
  }
  const slideAuthoring = globalThis.ExplainerKit.createSlideAuthoring({
    root,
    store: reviewStore,
    sections: workspaceSections,
    select: selectSection,
    titleOf: sectionTitle,
    toast,
    authoringSession,
    addSection: addSectionPreview,
    openSection(target, anchor, back) {
      const sectionPicker = openSectionPicker(target, anchor);
      if (back) {
        const previous = el("button", "st-slide-secondary", "← Choose another visual");
        previous.addEventListener("click", () => {
          pickerAnchor = null;
          closePicker();
          back();
        });
        sectionPicker.querySelector(".st-pick-head").after(previous);
      }
    },
    chooseVisual(target, anchor, choose, editing = false) {
      openPicker(target, null, anchor, { choose, editing });
    },
    applyOrder: applySectionOrder,
    move: moveSection,
    focusSelected() {
      const button = navigation.querySelector('[aria-current="true"]');
      if (button) {
        button.focus({ preventScroll: true });
      }
    },
    restoreEdits(id) {
      const section = byId(id);
      if (!section) {
        return;
      }
      renderPanel();
      applySavedSwaps(section);
      const edits = reviewStore.slideEdits(id);
      Object.entries(edits.canvas_edits).forEach(([hostId, value]) => {
        canvasEditing.restore(byId(hostId), value);
      });
      edits.edits.forEach((edit) => {
        let target;
        try {
          target = document.querySelector(edit.selector);
        } catch {
          return;
        }
        if (target && section.contains(target)) {
          // A draft may carry passive-inline markup; paint it through the
          // authoring layer's allowlist so it renders styled, never flat.
          if (window.ExplainerAuthoring && window.ExplainerAuthoring.paintInline) {
            window.ExplainerAuthoring.paintInline(target, edit.after);
          } else {
            target.textContent = edit.after;
          }
        }
      });
    },
    refresh() {
      mountSectionButtons();
      mountSwapButtons();
      mountAdjustButtons();
      renderNavigation();
      renderPanel();
    },
  });
  window.__studioDiscardSlide = slideAuthoring.discard;
  applySavedSectionPreviews();
  slideAuthoring.restore();
  if (reviewStore.order()) {
    applySectionOrder(reviewStore.order());
  }
  mountSectionButtons();
  mountSwapButtons();
  mountAdjustButtons();
  // One scheduled follow-up covers scripts completing in the same load turn.
  // No long-lived subtree observer or per-mutation document scan.
  requestAnimationFrame(() => {
    if (!document.body.classList.contains("presenting")) {
      mountSectionButtons();
      mountSwapButtons();
      mountAdjustButtons();
    }
  });

  // Tree's three modes never register host.__kitBase for org/evolution (only
  // Files does — see tree.js), but every mode DOES stamp its own 'ktr-<mode>'
  // Class on the host itself, unlike chart/table which need __kitBase for
  // This — so tree reads its mode straight off the host's own classList.
  const TREE_MODES = ["org", "files", "evolution"];

  function detect(host) {
    if (host.classList.contains("kom-program")) {
      return CATALOG.find((item) => item.key === "operating-model");
    }
    const traceHost = host.classList.contains("ktrace") ? host : host.querySelector(".ktrace");
    if (traceHost) {
      let hitTrace = null;
      CATALOG.forEach((c) => {
        if (c.key === "architecture-trace") {
          hitTrace = c;
        }
      });
      if (hitTrace) {
        return hitTrace;
      }
    }
    const kitHost = host.classList.contains("kch") ? host : host.querySelector(".kch");
    if (kitHost) {
      const kind = (kitHost.__kitBase && kitHost.__kitBase.kind) || "";
      let hit = null;
      CATALOG.forEach((c) => {
        if (c.key === "chart-" + kind) {
          hit = c;
        }
      });
      return (
        hit || {
          anchor: "chart",
          blurb: "",
          key: "chart",
          label: (kind || "line") + " chart",
          marker: "kch",
        }
      );
    }
    // Table: every mode stamps host.__kitBase = data (see table.js), so the
    // Mode always comes from there — the same trick as chart's kind above.
    const tableHost = host.classList.contains("kt") ? host : host.querySelector(".kt");
    if (tableHost) {
      const mode = (tableHost.__kitBase && tableHost.__kitBase.mode) || "";
      let hitT = null;
      CATALOG.forEach((c) => {
        if (c.key === "table-" + mode) {
          hitT = c;
        }
      });
      return (
        hitT || {
          anchor: "table",
          blurb: "",
          key: "table",
          label: (mode || "rows") + " table",
          marker: "kt",
        }
      );
    }
    const treeHost = host.classList.contains("ktr") ? host : host.querySelector(".ktr");
    if (treeHost) {
      let tmode = "";
      TREE_MODES.forEach((m) => {
        if (treeHost.classList.contains("ktr-" + m)) {
          tmode = m;
        }
      });
      let hitR = null;
      CATALOG.forEach((c) => {
        if (c.key === "tree-" + tmode) {
          hitR = c;
        }
      });
      return (
        hitR || {
          anchor: "tree",
          blurb: "",
          key: "tree",
          label: (tmode || "org") + " tree",
          marker: "ktr",
        }
      );
    }
    // Flow-timeline stamps its own mode class (kf-timeline) on top of kf;
    // Resolve it before the generic kf entry below claims it as plain flow
    const flowTimelineHost = host.classList.contains("kf-timeline")
      ? host
      : host.querySelector(".kf-timeline");
    if (flowTimelineHost) {
      let hitFT = null;
      CATALOG.forEach((c) => {
        if (c.key === "flow-timeline") {
          hitFT = c;
        }
      });
      if (hitFT) {
        return hitFT;
      }
    }
    // Sequence/erd are architecture-family siblings and carry the shared
    // 'kdf' marker too (for data-flow.css's pulse/legend/Present-mode
    // Chrome) alongside their own 'kseq'/'kerd' class — resolve those first,
    // Same reasoning as flow-timeline above, or the generic 'kdf' match
    // Below would claim them as plain architecture.
    const seqHost = host.classList.contains("kseq") ? host : host.querySelector(".kseq");
    if (seqHost) {
      let hitSeq = null;
      CATALOG.forEach((c) => {
        if (c.key === "sequence") {
          hitSeq = c;
        }
      });
      if (hitSeq) {
        return hitSeq;
      }
    }
    const erdHost = host.classList.contains("kerd") ? host : host.querySelector(".kerd");
    if (erdHost) {
      let hitErd = null;
      CATALOG.forEach((c) => {
        if (c.key === "erd") {
          hitErd = c;
        }
      });
      if (hitErd) {
        return hitErd;
      }
    }
    // Stack is architecture family too, but built in plain HTML flow (no
    // Shared 'kdf' canvas marker, and its own bare host marker is 'kcs' —
    // See architecture.js/base.css for why it isn't 'kstk') — resolve it
    // Via host.__kitBase.kind, the same idiom chart/table use for their
    // Own kind, rather than the marker-classList scan every other family
    // Member above uses. mode:'diff' stamps host.__kitBase.mode = 'diff'
    // (see architecture.js) — the same table-mode trick, one level deeper.
    const stackHost = host.classList.contains("kcs") ? host : host.querySelector(".kcs");
    if (stackHost && stackHost.__kitBase && stackHost.__kitBase.kind === "stack") {
      const stackKey = stackHost.__kitBase.mode === "diff" ? "stack-diff" : "stack";
      let hitStack = null;
      CATALOG.forEach((c) => {
        if (c.key === stackKey) {
          hitStack = c;
        }
      });
      if (hitStack) {
        return hitStack;
      }
    }
    for (let i = 0; i < CATALOG.length; i++) {
      const c = CATALOG[i];
      if (
        c.marker !== "kch" &&
        c.marker !== "kt" &&
        c.marker !== "ktr" &&
        (host.classList.contains(c.marker) || host.querySelector(`.${c.marker}`))
      ) {
        return c;
      }
    }
    return null;
  }

  /* Hover a choice in the picker and see it rendered with the showcase's
     sample data, at reading scale, beside the panel. One sandboxed embed of
     the showcase is loaded once and told which section to show; nothing from
     the frame reaches Studio except a ready flag. */
  const visualPeek = (() => {
    let pane = null;
    let frame = null;
    let caption = null;
    let ready = false;
    let pending = null;
    let hideTimer = null;
    function themeName() {
      return document.documentElement.dataset.theme === "light" ? "light" : "dark";
    }
    function focus(anchorId) {
      pending = anchorId;
      if (ready && frame && frame.contentWindow) {
        frame.contentWindow.postMessage(
          { source: "explainer-embed", focus: anchorId, theme: themeName() },
          "*",
        );
      }
    }
    function ensure() {
      if (pane) {
        return;
      }
      pane = el("div", "st-visual-peek");
      pane.hidden = true;
      pane.setAttribute("aria-hidden", "true");
      const viewport = el("div", "st-visual-peek-viewport");
      frame = document.createElement("iframe");
      frame.setAttribute("sandbox", "allow-scripts");
      frame.setAttribute("aria-hidden", "true");
      frame.tabIndex = -1;
      frame.title = "Visual preview";
      const showcase = (window.__RV__ && window.__RV__.showcase) || "/showcase";
      frame.src =
        showcase + (showcase.includes("?") ? "&" : "?") + "kit-embed=1&theme=" + themeName();
      window.addEventListener("message", (event) => {
        const data = event.data;
        if (
          event.source === frame.contentWindow &&
          event.origin === "null" &&
          data &&
          data.source === "explainer-embed" &&
          data.ready === true
        ) {
          ready = true;
          pane.classList.add("is-ready");
          if (pending) {
            focus(pending);
          }
        }
      });
      const unavailable = () => {
        if (!ready) {
          pane.classList.add("is-unavailable");
        }
      };
      frame.addEventListener("error", unavailable);
      window.setTimeout(unavailable, 6000);
      viewport.append(frame);
      caption = el("div", "st-visual-peek-caption");
      pane.append(
        viewport,
        caption,
        el("span", "st-visual-peek-hint", "Sample data from the showcase"),
      );
      root.append(pane);
    }
    function show(component, card) {
      if (!component.anchor || window.innerWidth < 1100) {
        return;
      }
      ensure();
      window.clearTimeout(hideTimer);
      focus(component.anchor);
      caption.replaceChildren(el("b", "", component.label), el("span", "", component.blurb));
      pane.hidden = false;
      const rect = card.getBoundingClientRect();
      const dialog = card.closest(".st-picker");
      const box = dialog ? dialog.getBoundingClientRect() : rect;
      const height = pane.offsetHeight;
      const width = pane.offsetWidth;
      const top = Math.max(
        72,
        Math.min(rect.top + rect.height / 2 - height / 2, window.innerHeight - height - 16),
      );
      pane.style.top = top + "px";
      if (box.left - 12 >= width) {
        pane.style.left = box.left - width - 12 + "px";
      } else {
        pane.style.left = Math.min(box.right + 12, window.innerWidth - width - 16) + "px";
      }
    }
    function hide() {
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => {
        if (pane) {
          pane.hidden = true;
        }
      }, 140);
    }
    return { show, hide };
  })();

  function closePicker() {
    document.body.classList.remove("st-swap-open", "st-section-open");
    visualPeek.hide();
    if (picker) {
      picker.remove();
      picker = null;
    }
    if (pickerAnchor) {
      try {
        pickerAnchor.focus();
      } catch {}
      pickerAnchor = null;
    }
  }

  function openSectionPicker(target, anchor) {
    closePicker();
    pickerAnchor = anchor || null;
    const heading = sectionHeading(target);
    const eyebrow = sectionEyebrow(target);
    const targetTitle = heading
      ? [...heading.childNodes]
          .map((node) => (node.nodeName === "BR" ? " " : node.textContent))
          .join("")
          .replaceAll(/\s+/g, " ")
          .trim()
      : target.id;
    let chosenPattern = "ribbons";
    picker = el("div", "st-picker st-section-picker");
    picker.setAttribute("role", "dialog");
    picker.setAttribute("aria-modal", "true");
    picker.setAttribute("aria-label", "Add a section slide before " + targetTitle);

    const head = el("div", "st-pick-head");
    head.appendChild(el("b", null, "Add section slide"));
    const x = el("button", "st-close", "✕");
    x.setAttribute("aria-label", "Close");
    x.addEventListener("click", closePicker);
    head.append(x);
    picker.append(head);
    picker.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closePicker();
      }
    });
    picker.append(
      el(
        "div",
        "st-sub",
        "Introduce a new part of your story with a title slide. It will appear immediately before the selected slide.",
      ),
    );

    const titleLabel = el("label", "st-section-field");
    titleLabel.append(el("span", null, "Section title"));
    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.value = "New section";
    titleInput.setAttribute("aria-describedby", "st-section-title-help");
    titleLabel.append(titleInput);
    picker.append(titleLabel);
    const titleHelp = el("div", "st-section-limit");
    titleHelp.id = "st-section-title-help";
    picker.append(titleHelp);

    picker.append(el("div", "st-section-label", "Background pattern"));
    const patterns = el("div", "st-patterns");
    patterns.setAttribute("role", "radiogroup");
    patterns.setAttribute("aria-label", "Section background pattern");
    SECTION_PATTERNS.forEach(function (pattern) {
      const choice = el("button", "st-pattern" + (pattern === chosenPattern ? " st-on" : ""));
      choice.type = "button";
      choice.dataset.pattern = pattern;
      choice.setAttribute("role", "radio");
      choice.setAttribute("aria-checked", String(pattern === chosenPattern));
      choice.append(el("span", "st-pattern-swatch st-pattern-" + pattern));
      choice.append(el("span", null, pattern));
      choice.addEventListener("click", function () {
        chosenPattern = pattern;
        patterns.querySelectorAll(".st-pattern").forEach(function (button) {
          const on = button === choice;
          button.classList.toggle("st-on", on);
          button.setAttribute("aria-checked", String(on));
        });
      });
      patterns.append(choice);
    });
    picker.append(patterns);

    const send = el("button", "st-send", "Preview section slide");
    function updateTitleState() {
      const length = titleInput.value.trim().length;
      titleHelp.textContent = length + "/56 characters";
      titleHelp.classList.toggle("st-over", length > 56 || length === 0);
      send.disabled = length > 56 || length === 0;
    }
    titleInput.addEventListener("input", updateTitleState);
    updateTitleState();
    // Not { once: true }: a failed insert must leave the button usable. On the
    // success path closePicker() detaches it, so it cannot fire twice anyway.
    send.addEventListener("click", function () {
      const title = titleInput.value.trim();
      if (!title || title.length > 56) {
        titleInput.focus();
        return;
      }
      const suffix = Date.now().toString(36);
      const record = {
        created: new Date().toISOString(),
        id:
          "st-section-" +
          String(reviewStore ? reviewStore.label : "a").toLowerCase() +
          "-" +
          suffix,
        kicker:
          eyebrow && eyebrow.textContent.trim().length <= 28 ? eyebrow.textContent.trim() : "",
        mode: "chapter",
        pattern: chosenPattern,
        target: target.id,
        title,
        variant: reviewStore ? reviewStore.label : "A",
      };
      if (!addSectionPreview(record)) {
        toast("could not preview this section slide", true);
        return;
      }
      saveSectionRecord(record);
      toast("section slide added — existing content stays next", true);
      pickerAnchor = null;
      closePicker();
      mountSectionButtons();
      mountSwapButtons();
      mountAdjustButtons();
      renderNavigation();
      const added = byId(record.id);
      if (added) {
        selectSection(added.matches("section") ? added : added.querySelector("section"));
      }
    });
    picker.append(send);
    root.append(picker);
    document.body.classList.add("st-section-open");
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(460, window.innerWidth - 24);
    picker.style.width = width + "px";
    picker.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 12)) + "px";
    picker.style.top = Math.max(8, Math.min(rect.bottom + 8, window.innerHeight * 0.22)) + "px";
    titleInput.focus();
    titleInput.select();
    return picker;
  }

  function openPicker(host, current, anchor, insertion = null) {
    const draft = !insertion && host.closest("[data-st-slide-preview]");
    if (draft) {
      slideAuthoring.open(draft, anchor, reviewStore.slide(draft.id));
      return;
    }
    closePicker();
    pickerAnchor = anchor || null;
    const currentLabel = current ? current.label : "component";
    picker = el("dialog", "st-picker st-component-picker");
    picker.setAttribute(
      "aria-label",
      insertion
        ? insertion.editing
          ? "Choose a visual"
          : "Add a slide"
        : `Change visual from ${currentLabel}`,
    );
    const head = el("div", "st-pick-head");
    const heading = el("b", null, null);
    heading.textContent = insertion
      ? insertion.editing
        ? "Choose a visual"
        : "Add a slide"
      : "Change visual";
    head.append(heading);
    const x = el("button", "st-close", "✕");
    x.setAttribute("aria-label", "Close");
    x.addEventListener("click", closePicker);
    head.append(x);
    picker.append(head);
    picker.append(
      el(
        "div",
        "st-sub",
        insertion
          ? "Choose a visual or section slide. Preview it with sample content before adding it to your story."
          : "Choose a different way to tell this part of the story. Your agent applies it after Finish.",
      ),
    );
    const search = document.createElement("input");
    search.className = "st-component-search";
    search.type = "search";
    search.placeholder = "Search components or outcomes";
    search.setAttribute("aria-label", "Search components or outcomes");
    picker.append(search);
    const categories = el("div", "st-component-categories");
    categories.setAttribute("aria-label", "Component categories");
    const list = el("div", "st-pick-list st-component-grid");
    const status = el("p", "st-component-status");
    status.setAttribute("role", "status");
    let category = "all";
    let active = 0;
    function categoryFor(c) {
      if (c.key === "roadmap" || c.key === "operating-model" || c.key === "flow-timeline") {
        return "planning";
      }
      if (c.key.startsWith("chart-") || c.key.startsWith("table-") || c.key === "erd") {
        return "data";
      }
      if (c.key === "section" || ["stepper", "loop", "iceberg", "pyramid"].includes(c.key)) {
        return "narrative";
      }
      return "systems";
    }
    function chooseComponent(c) {
      if (insertion) {
        pickerAnchor = null;
        closePicker();
        insertion.choose(c);
        return;
      }
      var id = requestNote(
        host,
        currentLabel,
        "replace this " + currentLabel + " with a " + c.label + " (" + c.blurb + ")",
      );
      toast(
        "note #" + id + " saved: " + c.label + " here — changes when your agent applies the review",
        true,
      );
      pickerAnchor = null;
      closePicker();
    }
    function renderComponents() {
      const query = search.value.trim().toLocaleLowerCase();
      const shown = CATALOG.filter(function (c) {
        if (
          (c.insertOnly && (!insertion || insertion.editing)) ||
          (current && c.key === current.key)
        ) {
          return false;
        }
        const categoryName = categoryFor(c);
        const searchable = [
          c.label,
          c.blurb,
          c.key,
          c.anchor,
          ...(c.aliases || []),
          ...(c.outcomes || []),
        ]
          .join(" ")
          .toLocaleLowerCase();
        return (category === "all" || category === categoryName) && searchable.includes(query);
      });
      if (insertion) {
        shown.sort((a, b) => Number(b.insertOnly || false) - Number(a.insertOnly || false));
      }
      active = Math.min(active, Math.max(0, shown.length - 1));
      list.replaceChildren();
      shown.forEach(function (c, index) {
        const main = el("button", "st-pick-main");
        main.type = "button";
        main.dataset.componentIndex = String(index);
        main.tabIndex = index === active ? 0 : -1;
        const schematic = el("span", "st-glyph", c.glyph);
        schematic.setAttribute("aria-hidden", "true");
        main.appendChild(schematic);
        const nm = el("span", "st-name");
        nm.appendChild(el("b", null, null)).textContent = c.label;
        nm.appendChild(el("span", null, null)).textContent = c.blurb;
        main.appendChild(nm);
        main.addEventListener("focus", function () {
          active = index;
          list.querySelectorAll(".st-pick-main").forEach(function (button, at) {
            button.tabIndex = at === active ? 0 : -1;
          });
          visualPeek.show(c, main);
        });
        main.addEventListener("blur", visualPeek.hide);
        main.addEventListener("pointerenter", function () {
          visualPeek.show(c, main);
        });
        main.addEventListener("pointerleave", visualPeek.hide);
        main.addEventListener("click", function () {
          chooseComponent(c);
        });
        list.append(main);
      });
      status.textContent =
        shown.length + (shown.length === 1 ? " matching component" : " matching components");
    }
    ["all", "planning", "systems", "data", "narrative"].forEach(function (value) {
      const button = el(
        "button",
        "st-component-category-button" + (value === category ? " st-on" : ""),
        value.charAt(0).toUpperCase() + value.slice(1),
      );
      button.type = "button";
      button.addEventListener("click", function () {
        category = value;
        active = 0;
        categories.querySelectorAll("button").forEach(function (candidate) {
          candidate.classList.toggle("st-on", candidate === button);
        });
        renderComponents();
        search.focus();
      });
      categories.append(button);
    });
    picker.append(categories, status, list);
    search.addEventListener("input", function () {
      active = 0;
      renderComponents();
    });
    if (!insertion) {
      const describeToggle = el("button", "st-describe-toggle");
      describeToggle.type = "button";
      describeToggle.setAttribute("aria-haspopup", "dialog");
      describeToggle.append(
        el("b", "", "Describe another approach"),
        el("span", "", "A new visual, in your own words"),
      );
      // Keep the custom route outside the scrolling and filtered catalog.
      picker.insertBefore(describeToggle, search);
      const describe = el("dialog", "st-describe-dialog");
      describe.setAttribute("aria-labelledby", "st-describe-title");
      const describeHead = el("div", "st-pick-head");
      const describeTitle = el("h2", "", "Describe your visual");
      describeTitle.id = "st-describe-title";
      const closeDescribe = el("button", "st-close", "✕");
      closeDescribe.type = "button";
      closeDescribe.setAttribute("aria-label", "Close custom visual request");
      describeHead.append(describeTitle, closeDescribe);
      const slideHeading = sectionHeading(host.closest("section") || host);
      const describeContext = el(
        "p",
        "st-describe-context",
        slideHeading ? slideHeading.textContent : "This part of your story",
      );
      const describeLabel = el(
        "label",
        "st-describe-label",
        "What would you like the audience to see?",
      );
      const ta = document.createElement("textarea");
      ta.className = "st-custom";
      ta.rows = 6;
      ta.id = "st-describe-input";
      describeLabel.htmlFor = ta.id;
      ta.placeholder = "Describe the idea. No diagram terminology needed.";
      ta.setAttribute("aria-describedby", "st-describe-example st-describe-handoff");
      describeLabel.append(ta);
      const describeExample = el("div", "st-describe-example");
      describeExample.id = "st-describe-example";
      describeExample.append(
        el("span", "", "For example"),
        el(
          "p",
          "",
          "Show the customer journey as three scenes. Make the handoff between teams clear, and keep supporting detail in the background.",
        ),
      );
      const describeHelp = el(
        "p",
        "st-describe-help",
        "This adds a request to Changes. After Finish, your agent creates the visual using this slide’s content.",
      );
      describeHelp.id = "st-describe-handoff";
      const describeActions = el("div", "st-describe-actions");
      const cancelDescribe = el("button", "st-describe-cancel", "Back to visuals");
      cancelDescribe.type = "button";
      const send = el("button", "st-send", "Add change request");
      send.type = "button";
      send.disabled = true;
      describeActions.append(cancelDescribe, send);
      describe.append(
        describeHead,
        describeContext,
        describeLabel,
        describeExample,
        describeHelp,
        describeActions,
      );
      function dismissDescribe() {
        describe.close();
        describeToggle.focus();
      }
      describeToggle.addEventListener("click", () => {
        describe.showModal();
        ta.focus();
      });
      closeDescribe.addEventListener("click", dismissDescribe);
      cancelDescribe.addEventListener("click", dismissDescribe);
      describe.addEventListener("cancel", (event) => {
        event.preventDefault();
        event.stopPropagation();
        dismissDescribe();
      });
      describe.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          dismissDescribe();
        }
      });
      describe.addEventListener("click", (event) => {
        if (event.target === describe) {
          dismissDescribe();
        }
      });
      ta.addEventListener("input", () => {
        send.disabled = !ta.value.trim();
      });
      send.addEventListener("click", () => {
        const text = ta.value.trim();
        if (!text) {
          ta.focus();
          return;
        }
        requestNote(host, currentLabel, text);
        toast("Visual request added to Changes. Finish to send it to your agent.", true);
        describe.close();
        closePicker();
      });
      picker.append(describe);
    }
    const footer = el("footer", "st-component-footer");
    const gallery = el("a", "st-component-gallery", "See visual examples ↗");
    gallery.setAttribute("aria-label", "See visual examples (opens in a new tab)");
    gallery.href = (window.__RV__ && window.__RV__.showcase) || "/showcase";
    gallery.target = "_blank";
    gallery.rel = "noopener";
    footer.append(gallery, el("span", "", "Explore working examples in a new tab."));
    picker.append(footer);
    root.append(picker);
    document.body.classList.add("st-swap-open");
    renderComponents();
    picker.addEventListener("cancel", function (event) {
      event.preventDefault();
      closePicker();
    });
    picker.addEventListener("click", function (event) {
      if (event.target === picker) {
        closePicker();
      }
    });
    picker.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closePicker();
        return;
      }
      const cards = [...list.querySelectorAll(".st-pick-main")];
      const cardNavigation =
        event.target === search ||
        Boolean(event.target.closest && event.target.closest(".st-pick-main"));
      if (
        cardNavigation &&
        (event.key === "ArrowDown" || event.key === "ArrowRight") &&
        cards.length
      ) {
        event.preventDefault();
        active = (active + 1) % cards.length;
        cards[active].focus();
      } else if (
        cardNavigation &&
        (event.key === "ArrowUp" || event.key === "ArrowLeft") &&
        cards.length
      ) {
        event.preventDefault();
        active = (active - 1 + cards.length) % cards.length;
        cards[active].focus();
      } else if (event.key === "Enter" && event.target === search && cards[active]) {
        event.preventDefault();
        cards[active].click();
      }
    });
    if (document.body.classList.contains("st-studio-open")) {
      picker.classList.add("st-picker-docked");
      picker.show();
      if (window.innerWidth >= 700 && window.innerWidth < 900 && selectedSection) {
        const headerHeight =
          Number.parseFloat(
            getComputedStyle(document.body).getPropertyValue("--st-header-height"),
          ) || 104;
        const previousScrollBehavior = document.documentElement.style.scrollBehavior;
        document.documentElement.style.scrollBehavior = "auto";
        window.scrollTo(
          0,
          selectedSection.getBoundingClientRect().top + window.scrollY - headerHeight - 16,
        );
        document.documentElement.style.scrollBehavior = previousScrollBehavior;
      }
    } else {
      picker.showModal();
    }
    search.focus();
  }

  document.addEventListener("mousedown", (e) => {
    if (document.body.classList.contains("presenting")) {
      return;
    }
    if (
      picker &&
      !picker.contains(e.target) &&
      !e.target.closest(".st-swap") &&
      !e.target.closest(".st-insert-section")
    ) {
      closePicker();
    }
  });

  /* Switches persist through the review state so review.md carries them */
  function recordSwap(key, value, legacyKey) {
    if (!reviewStore) {
      return;
    }
    const mine = reviewStore.swaps();
    const prefix = key.split(" · ")[0];
    const prior = savedStableKey(mine, prefix);
    reviewStore.setSwap(key, value, [prior, legacyKey]);
  }

  /* Picking a style in this panel IS the preference — record it, and use
     sendBeacon so the save survives the page navigation that follows.
     Returns a promise that resolves once the preference is durably saved
     (beacon queued, or the fetch fallback completed) so the caller can
     navigate only after the save lands. */
  function recordLook(style) {
    if (!reviewStore) {
      return Promise.resolve();
    }
    reviewStore.setLook(style);
    try {
      const queued = navigator.sendBeacon(
        RV.stateUrl,
        new Blob([reviewStore.serialized()], { type: "application/json" }),
      );
      if (queued) {
        return Promise.resolve();
      }
    } catch {
      /* Fall through to the async save */
    }
    // Beacon refused (returned false) or threw — fall back to a real save
    // And let the caller await it before navigating away
    return reviewStore.save();
  }

  tab.addEventListener("pointerdown", startTabDrag);
  tab.addEventListener("keydown", (event) => {
    if (panel.classList.contains("st-open")) {
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      tabPosition = null;
      tab.removeAttribute("style");
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
      const rect = tab.getBoundingClientRect();
      moveTab(rect.left + movement[0], rect.top + movement[1]);
    }
  });
  window.addEventListener("resize", applyTabPosition);

  const presentationKeys = new WeakSet();
  document.addEventListener(
    "keydown",
    (event) => {
      if (document.body.classList.contains("presenting")) {
        presentationKeys.add(event);
      }
    },
    true,
  );
  window.addEventListener("keydown", (e) => {
    if (presentationKeys.has(e)) {
      return;
    }
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) {
      return;
    }
    if (document.body.classList.contains("presenting")) {
      return;
    }
    if (e.key === "s" || e.key === "S") {
      togglePanel();
    }
    // Escape is owned by whatever is in progress on the page — the
    // composition editor's layered contract (inline edit, text prompt,
    // drawing gesture, armed tool, selection/toolbar) handles it at its own
    // capture listener, and an open modal picker closes itself. A bare
    // Escape must never close the Studio panel: it would tear down the
    // composition editor mid-edit and blank the whole editing surface,
    // which is exactly the "drew a shape, pressed Esc, everything broke"
    // live-testing finding. "S" and Reading view stay the panel exits.
    if (e.key === "Escape" && picker) {
      closePicker();
    }
  });

  /* Saved switches survive style flips and reloads. Stable controls restore
     exactly one host. Old label-keyed state is accepted only when that label
     identifies one control; an ambiguous legacy label must never fan out. */
  const swapDefaults = {};
  const swapControls = [];
  const motionControls = [];
  (window.__kitSwappable || []).forEach((entry) => {
    (entry.options || []).forEach(function (opt) {
      var legacy = entry.label + " · " + opt.label;
      var prefix = swapPrefix(entry.host, opt.key);
      swapDefaults[prefix] = entry.get(opt.key);
      swapDefaults[entry.label + " · " + opt.label] = entry.get(opt.key);
      swapControls.push({ entry, opt, prefix, legacy });
    });
  });
  (window.__kitMotionAdjustable || []).forEach((entry) => {
    if (typeof entry.get !== "function") {
      return;
    }
    var legacy = entry.key + " · motion";
    var prefix = swapPrefix(entry.host, "motion");
    swapDefaults[prefix] = entry.get();
    swapDefaults[legacy] = entry.get();
    motionControls.push({ entry, prefix, legacy });
  });
  if (typeof window.__kitSetMotionPreset === "function") {
    swapDefaults["Motion · pulse effects"] = window.__kitMotionPreset || "normal";
  }
  function controlForKey(key, controls) {
    if (key.charAt(0) === "@") {
      const prefix = key.split(" · ")[0];
      return controls.find((control) => control.prefix === prefix) || null;
    }
    const matches = controls.filter(function (control) {
      return control.legacy === key;
    });
    return matches.length === 1 ? matches[0] : null;
  }
  function savedControlKey(settings, control, controls) {
    const stable = savedStableKey(settings, control.prefix);
    if (stable) {
      return stable;
    }
    return controls.filter((candidate) => candidate.legacy === control.legacy).length === 1 &&
      Object.hasOwn(settings, control.legacy)
      ? control.legacy
      : "";
  }
  window.__studioDiscardSwap = function __studioDiscardSwap(key) {
    const requestedKey = key;
    let restored = false;
    const control = controlForKey(key, swapControls);
    if (control) {
      const entry = control.entry;
      const opt = control.opt;
      key = control.prefix;
      entry.set(opt.key, swapDefaults[key]);
      notifyComponentChange(entry.host);
      restored = true;
    }
    if (!restored) {
      const motionControl = controlForKey(requestedKey, motionControls);
      if (motionControl && typeof motionControl.entry.set === "function") {
        motionControl.entry.set(swapDefaults[motionControl.prefix], true);
        restored = true;
      }
    }
    if (
      !restored &&
      requestedKey === "Motion · pulse effects" &&
      typeof window.__kitSetMotionPreset === "function"
    ) {
      window.__kitSetMotionPreset(swapDefaults[requestedKey]);
      restored = true;
    }
    if (restored && panel.classList.contains("st-open")) {
      renderPanel();
    }
    return restored;
  };
  function applySavedSwaps(onlySection = null) {
    if (!reviewStore) {
      return;
    }
    const mine = reviewStore.swaps();
    swapControls.forEach((control) => {
      if (onlySection && !onlySection.contains(control.entry.host)) {
        return;
      }
      var key = savedControlKey(mine, control, swapControls);
      if (!key || control.entry.get(control.opt.key) === mine[key]) {
        return;
      }
      control.entry.set(control.opt.key, mine[key]);
      notifyComponentChange(control.entry.host);
    });
    const legacyMotion = mine["Motion · pulse effects"];
    motionControls.forEach((control) => {
      if (onlySection && !onlySection.contains(control.entry.host)) {
        return;
      }
      var key = savedControlKey(mine, control, motionControls);
      var saved = key ? mine[key] : legacyMotion;
      if (saved) {
        control.entry.set(saved, false);
      }
    });
    // Compatibility for pages assembled before host-scoped motion existed.
    if (
      motionControls.length === 0 &&
      legacyMotion &&
      typeof window.__kitSetMotionPreset === "function"
    ) {
      window.__kitSetMotionPreset(legacyMotion);
    }
  }
  // Canvas edits belong to a stable host and layout, not screen pixels.
  const canvasEditing =
    typeof globalThis.ExplainerKit.createCanvasEditing === "function"
      ? globalThis.ExplainerKit.createCanvasEditing({
          store: reviewStore,
          renderPanel,
          toast: (message, hold) => RV.toast(message, hold),
          prepare: () => !RV.preparePresent || RV.preparePresent(),
          notify: notifyComponentChange,
        })
      : {
          controls: () =>
            el("p", "st-control-help", "Restart Studio to load the updated canvas editors."),
          restore: () => false,
          discard: () => false,
        };
  function canvasControls(host) {
    return canvasEditing.controls(host);
  }
  window.__studioDiscardCanvas = canvasEditing.discard;
  Object.entries(reviewStore ? reviewStore.canvasEdits() : {}).forEach(([id, edits]) => {
    canvasEditing.restore(document.querySelector("#" + CSS.escape(id)), edits);
  });

  applySavedSwaps();
  slideAuthoring.restoreEdits();
  function componentAt(target) {
    const entry = [...(window.__kitSwappable || []), ...(window.__kitMotionAdjustable || [])].find(
      (candidate) => candidate.host && candidate.host.contains(target),
    );
    const capturedHost = target.closest && target.closest(".artifact");
    return (
      (entry && entry.host) ||
      (capturedHost &&
      window.ExplainerComponentCapture &&
      window.ExplainerComponentCapture.get(capturedHost)
        ? capturedHost
        : null)
    );
  }
  document.addEventListener("click", (event) => {
    if (
      !panel.classList.contains("st-open") ||
      document.body.classList.contains("presenting") ||
      event.target.closest("#st-root,#rv-root,.rv-pop,button,a,input,textarea,select") ||
      document.documentElement.classList.contains("rv-commenting")
    ) {
      return;
    }
    const host = componentAt(event.target);
    if (host && host !== selectedHost) {
      selectedHost = host;
      inspectorMode = "visual";
      try {
        sessionStorage.setItem("st-inspector-mode", inspectorMode);
      } catch {}
      renderPanel();
    }
  });
  document.addEventListener("dblclick", (event) => {
    if (
      !panel.classList.contains("st-open") ||
      document.body.classList.contains("presenting") ||
      event.target.closest("#st-root,#rv-root,.rv-pop,button,a,input,textarea,select") ||
      document.documentElement.classList.contains("rv-commenting")
    ) {
      return;
    }
    const host = componentAt(event.target);
    if (host) {
      selectedSection = host.closest("section") || selectedSection;
      selectedHost = host;
      makeEditable(host, { announce: true });
    }
  });
  function presentSelected(event) {
    if (
      !panel.classList.contains("st-open") ||
      document.body.classList.contains("presenting") ||
      !selectedSection ||
      !window.__present ||
      typeof window.__present.enterAt !== "function"
    ) {
      return;
    }
    const key = event.type === "keydown";
    if (
      key &&
      (event.key.toLowerCase() !== "p" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.target.closest("input,textarea,select,[contenteditable]"))
    ) {
      return;
    }
    if (!key && !event.target.closest("#presentToggle")) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (RV && RV.preparePresent && !RV.preparePresent()) {
      return;
    }
    stopCompositionEditing();
    window.__present.enterAt(selectedSection);
  }
  document.addEventListener("click", presentSelected, true);
  document.addEventListener("keydown", presentSelected, true);
  window.addEventListener("kitreviewnavigate", (event) => {
    if (panel.classList.contains("st-open")) {
      selectSection(event.detail.target.closest("section"));
    }
  });
  window.addEventListener("kitpresentchange", (event) => {
    if (!event.detail.presenting && panel.classList.contains("st-open")) {
      const section = event.detail.anchor && event.detail.anchor.closest("section");
      selectSection(section || selectedSection);
    }
  });
  const savedOrder = reviewStore && reviewStore.order();
  if (savedOrder) {
    applySectionOrder(savedOrder);
  }
  setPanelOpen(true);
  if (initialPresentation && initialPresentation.presenting) {
    window.__present.enter({ slide: initialPresentation.slide, step: initialPresentation.step });
  }
  window.addEventListener("pageshow", () => {
    if (!document.body.classList.contains("presenting") && !window.__rvRestoringScroll) {
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "instant" }));
    }
  });
})();
