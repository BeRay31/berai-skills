/* Gallery page — preview-first browsing for assembled explainers. */
(function () {
  "use strict";

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) {
      node.className = cls;
    }
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  }

  const root = document.querySelector("#gl-root");
  let pages = [];
  let opening = false;
  let previewObservers = [];

  function releasePreviews() {
    previewObservers.forEach((observer) => {
      observer.disconnect();
    });
    previewObservers = [];
  }

  const header = el("header", "gl-header");
  const headerInner = el("div", "gl-header-inner");
  const identity = el("div", "gl-identity");
  identity.append(el("span", "gl-brand", "Studio"));
  identity.append(el("span", "gl-heading", "Your explainers"));
  headerInner.append(identity);

  const headerTools = el("div", "gl-header-tools");
  const meta = el("span", "gl-meta", "Loading…");
  meta.setAttribute("aria-live", "polite");
  headerTools.append(meta);
  // Discoverability: the roster is worth seeing before you need it. Without
  // This the only way in is a Swap button on a page you already made.
  const boot = window.__galleryBoot || {};
  if (boot.showcase) {
    const browse = el("a", "gl-browse", "Browse components ↗");
    browse.href = boot.showcase;
    browse.target = "_blank";
    browse.rel = "noopener";
    browse.title = "Every component the kit can build, with live examples";
    headerTools.append(browse);
  }
  headerInner.append(headerTools);
  header.append(headerInner);
  root.append(header);

  const main = el("main", "gl-main");
  main.setAttribute("aria-busy", "true");
  root.append(main);
  renderLoading();
  loadPages();

  function loadPages() {
    main.setAttribute("aria-busy", "true");
    const query = boot.review ? "?review=" + encodeURIComponent(boot.review) : "";
    fetch("/api/pages" + query)
      .then((response) => {
        if (!response.ok) {
          throw new Error("The library responded with " + response.status + ".");
        }
        return response.json();
      })
      .then((data) => {
        pages = Array.isArray(data.pages) ? data.pages : [];
        main.setAttribute("aria-busy", "false");
        meta.textContent = pages.length + (pages.length === 1 ? " explainer" : " explainers");
        renderLibrary();
        return pages;
      })
      .catch((error) => {
        main.setAttribute("aria-busy", "false");
        meta.textContent = "Library unavailable";
        renderError(error);
      });
  }

  function renderLoading() {
    releasePreviews();
    main.innerHTML = "";
    main.className = "gl-main";
    const loading = el("p", "gl-loading-status", "Loading explainers…");
    loading.setAttribute("role", "status");
    main.append(loading);
    const grid = el("ul", "gl-grid gl-skeleton-grid");
    grid.setAttribute("aria-hidden", "true");
    for (let index = 0; index < 3; index += 1) {
      const item = el("li", "gl-card-item");
      const card = el("article", "gl-card gl-card-skeleton");
      card.append(el("div", "gl-card-preview gl-skeleton-preview"));
      const body = el("div", "gl-card-body");
      const title = el("div", "gl-skeleton-title");
      title.append(el("span", "gl-skeleton-line"));
      title.append(el("span", "gl-skeleton-line gl-skeleton-line-short"));
      body.append(title);
      body.append(el("span", "gl-skeleton-line gl-skeleton-meta"));
      body.append(el("span", "gl-skeleton-line gl-skeleton-state"));
      body.append(el("span", "gl-skeleton-action"));
      card.append(body);
      item.append(card);
      grid.append(item);
    }
    main.append(grid);
  }

  function renderLibrary() {
    releasePreviews();
    main.innerHTML = "";
    if (pages.length === 0) {
      renderEmpty();
      return;
    }
    main.className = "gl-main";
    const introduction = el("div", "gl-introduction");
    introduction.append(el("h1", null, "Your explainers"));
    introduction.append(
      el(
        "p",
        null,
        "Pick up a story. Shape the visuals, arrange slides, and leave feedback in Studio.",
      ),
    );
    main.append(introduction);
    renderGrid();
  }

  function renderGrid() {
    const grid = el("ul", "gl-grid");
    pages.forEach((page) => {
      var item = el("li", "gl-card-item");
      var card = el("article", "gl-card" + (page.current ? " is-current" : ""));
      var preview = createPreview(page, "gl-card-preview", true);
      card.appendChild(preview);
      var body = el("div", "gl-card-body");
      var title = page.title || page.file;
      var cardTitle = el("h2", "", title);
      cardTitle.title = title;
      body.appendChild(cardTitle);

      body.appendChild(el("p", "gl-card-facts", formatFacts(page)));

      var state = el("div", "gl-card-state");
      var statuses = el("div", "gl-card-statuses");
      if (page.current) {
        var currentStatus = el("span", "gl-card-status gl-current-status");
        var currentDot = el("span", "gl-status-dot");
        currentDot.setAttribute("aria-hidden", "true");
        currentStatus.appendChild(currentDot);
        currentStatus.appendChild(el("span", "", "Current"));
        statuses.appendChild(currentStatus);
      }
      if (page.needs_upgrade) {
        statuses.appendChild(
          el(
            "span",
            page.upgradable
              ? "gl-card-status gl-upgrade-status"
              : "gl-card-status gl-unavailable-status",
            page.upgradable ? "Update available" : "Can’t update — source file unavailable.",
          ),
        );
      }
      state.appendChild(statuses);
      var version = formatVersion(page.version);
      if (version) {
        state.appendChild(el("span", "gl-card-version", version));
      }
      body.appendChild(state);

      var actions = el("div", "gl-card-actions");
      var action = el("button", "gl-card-action", "Open in Studio →");
      action.type = "button";
      var actionLabel = (page.current ? "Return to Studio with " : "Open in Studio: ") + title;
      if (page.upgradable) {
        actionLabel += ". Update available.";
      }
      action.setAttribute("aria-label", actionLabel);
      action.addEventListener("click", function () {
        openPage(page, card, action);
      });
      actions.appendChild(action);
      var shareable = el("a", "gl-share-action", "Open HTML file ↗");
      shareable.href = "/preview?file=" + encodeURIComponent(page.file);
      shareable.target = "_blank";
      shareable.rel = "noopener";
      shareable.title =
        "Open the self-contained HTML without Studio controls. Send the file itself or host it; this local URL only works on your computer.";
      shareable.setAttribute("aria-label", "Open HTML file: " + title);
      actions.appendChild(shareable);
      if (page.needs_upgrade && page.upgradable) {
        var upgradeDescription = page.upgrade_requires_style
          ? "Choose a supported style before updating with the current kit."
          : "Rebuild with the current kit. Content and style stay unchanged.";
        var upgrade = el(
          "button",
          "gl-upgrade-button",
          page.upgrade_requires_style ? "Choose update style" : "Update explainer",
        );
        upgrade.type = "button";
        upgrade.title = upgradeDescription;
        upgrade.setAttribute("aria-label", "Update " + title + ". " + upgradeDescription);
        upgrade.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();
          if (page.upgrade_requires_style) {
            openPage(page, card, upgrade);
          } else {
            upgradePage(page, card, upgrade);
          }
        });
        actions.appendChild(upgrade);
      }
      body.appendChild(actions);
      card.appendChild(body);
      item.appendChild(card);
      grid.appendChild(item);
    });
    main.append(grid);
  }

  function formatFacts(page) {
    const facts = [];
    const style = String(page.style || "").trim();
    if (style) {
      facts.push(style.charAt(0).toUpperCase() + style.slice(1));
    }
    if (typeof page.slide_count === "number") {
      facts.push(page.slide_count + (page.slide_count === 1 ? " slide" : " slides"));
    }
    if (typeof page.component_count === "number") {
      facts.push(
        page.component_count + (page.component_count === 1 ? " component" : " components"),
      );
    }
    return facts.join(" · ");
  }

  function formatVersion(value) {
    const version = String(value || "")
      .trim()
      .replace(/^v/i, "");
    return version ? `v${version}` : "";
  }

  function upgradePage(page, card, control) {
    if (control.disabled || card.classList.contains("is-upgrading")) {
      return;
    }
    card.classList.add("is-upgrading");
    card.setAttribute("aria-busy", "true");
    control.disabled = true;
    control.textContent = "Updating…";
    fetch("/api/upgrade", {
      body: JSON.stringify({ file: page.file, index: 0 }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
      .then((response) =>
        response.json().then(function (result) {
          if (!response.ok || !result.ok) {
            throw new Error(result.error || "Update request failed with " + response.status + ".");
          }
          return result;
        }),
      )
      .then(() => {
        control.textContent = "Updated";
        card.classList.remove("is-upgrading");
        card.classList.add("is-upgraded");
        card.setAttribute("aria-busy", "false");
        return window.setTimeout(loadPages, 600);
      })
      .catch((error) => {
        card.classList.remove("is-upgrading");
        card.setAttribute("aria-busy", "false");
        control.disabled = false;
        control.textContent = "Retry update";
        showToast("Update failed", error.message);
      });
  }

  function previewChannel() {
    return window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `preview-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function createPreview(page, className, lazy) {
    const wrap = el("div", className + " gl-preview");
    const iframe = document.createElement("iframe");
    const channel = previewChannel();
    let listening = true;
    const disconnect = () => {
      if (listening) {
        window.removeEventListener("message", receive);
        listening = false;
      }
    };
    const unavailable = () => {
      wrap.classList.add("is-unavailable");
      disconnect();
    };
    const receive = (event) => {
      const data = event.data;
      if (
        event.source === iframe.contentWindow &&
        event.origin === "null" &&
        data &&
        data.source === "explainer-gallery-preview" &&
        data.channel === channel &&
        data.unavailable === true
      ) {
        unavailable();
      }
    };
    window.addEventListener("message", receive);
    previewObservers.push({ disconnect });
    iframe.scrolling = "no";
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.setAttribute("title", `Preview of ${page.title || page.file}`);
    iframe.setAttribute("aria-hidden", "true");
    iframe.tabIndex = -1;
    if (lazy) {
      iframe.setAttribute("loading", "lazy");
    }
    iframe.addEventListener("error", unavailable);
    iframe.src = `/preview?file=${encodeURIComponent(page.file)}&channel=${encodeURIComponent(channel)}`;
    wrap.append(iframe);
    wrap.append(el("span", "gl-preview-unavailable", "Preview unavailable"));
    sizePreview(wrap);
    return wrap;
  }

  function sizePreview(wrap) {
    function update() {
      const width = wrap.clientWidth;
      if (width) {
        wrap.style.setProperty("--preview-scale", String(width / 1280));
      }
    }
    if (window.ResizeObserver) {
      const observer = new ResizeObserver(update);
      observer.observe(wrap);
      // Tracked so a re-render can disconnect them — otherwise every
      // LoadPages leaks one observer per card for the lifetime of the tab
      previewObservers.push(observer);
    }
    window.requestAnimationFrame(update);
  }

  function openPage(page, busyTarget, control) {
    if (opening) {
      return;
    }
    control.disabled = true;
    control.textContent = "Opening…";
    busyTarget.classList.add("is-opening");
    busyTarget.setAttribute("aria-busy", "true");
    if (page.current) {
      window.location.href = `/${page.slug}`;
      return;
    }
    opening = true;
    fetch("/api/open", {
      body: JSON.stringify({ file: page.file }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
      .then((response) =>
        // read the body first — the server sends {"error": "<reason>"} with
        // a 400 when open_page rejects the file, and that reason is the
        // useful part (same pattern as upgradePage above)
        response
          .json()
          .catch(function () {
            return {};
          })
          .then(function (result) {
            if (!response.ok) {
              throw new Error(result.error || "Open request failed with " + response.status + ".");
            }
            return result;
          }),
      )
      .then((result) => {
        if (result.ok && result.slug) {
          window.location.href = "/" + result.slug;
          return result;
        }
        throw new Error(result.error || "Could not open this explainer.");
      })
      .catch((error) => {
        opening = false;
        busyTarget.classList.remove("is-opening");
        busyTarget.setAttribute("aria-busy", "false");
        control.disabled = false;
        control.textContent = "Open in Studio →";
        showToast("Couldn’t open explainer", error.message);
      });
  }

  function renderEmpty() {
    main.className = "gl-main gl-view-state";
    const state = el("section", "gl-state");
    state.append(el("h2", "", "No explainers found"));
    state.append(el("p", "", "Assemble an explainer in this folder, then reload."));
    const code = el(
      "code",
      "",
      "python3 .factory/skills/explainer/assemble.py .explainers/_sources/<topic>.html",
    );
    state.append(code);
    main.append(state);
  }

  function renderError(error) {
    releasePreviews();
    main.innerHTML = "";
    main.className = "gl-main gl-view-state";
    const state = el("section", "gl-state gl-state-error");
    state.setAttribute("role", "alert");
    state.append(el("h2", "", "Couldn’t load explainers"));
    state.append(
      el("p", "", error && error.message ? error.message : "Could not load your explainers."),
    );
    const retry = el("button", "gl-retry-button", "Retry");
    retry.type = "button";
    retry.addEventListener("click", () => {
      renderLoading();
      loadPages();
    });
    state.append(retry);
    main.append(state);
  }

  function showToast(title, message) {
    const previous = document.querySelector(".gl-toast");
    if (previous) {
      previous.remove();
    }
    const toast = el("div", "gl-toast");
    toast.setAttribute("role", "alert");
    toast.append(el("strong", "", title));
    toast.append(el("span", "", message || "Please try again."));
    document.body.append(toast);
    window.setTimeout(() => {
      if (toast.parentNode) {
        toast.remove();
      }
    }, 5000);
  }
})();
