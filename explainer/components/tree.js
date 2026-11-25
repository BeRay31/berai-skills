/* Component: tree — one hierarchy device, three renderings behind one call.
   org        boxes-and-elbow-connectors org chart (root largest, shrinks per depth,
              depths beyond 3 collapse behind a "+N more" pill, >5 siblings wrap into rows)
   files      filetree's "map" look ported in as the default: airy cards, folder icons,
              rationale labels, card-grid leaves. A studio toggle flips it to a plain
              indented list (same data).
   evolution  dense mono revisions, either parallel or read revision by revision.
   All three return a depth- or row-based Present driver {count, go}. */
function ktrHasDetail(node) {
  if (!node || typeof node !== "object") {
    return false;
  }
  if (Array.isArray(node)) {
    return node.some(ktrHasDetail);
  }
  if (node.sub || node.note || node.rationale) {
    return true;
  }
  return (node.children || []).some(ktrHasDetail);
}

function ktrAdjustedData(data, state) {
  function clean(node) {
    if (!node || typeof node !== "object") {
      return node;
    }
    if (Array.isArray(node)) {
      return node.map(clean);
    }
    const next = {
      ...node,
      children: (node.children || []).map(clean),
    };
    if (state.detail === "key") {
      delete next.sub;
      delete next.note;
      delete next.rationale;
    }
    return next;
  }
  return {
    ...data,
    detail: state.detail,
    direction: state.direction,
    layout: state.layout,
    root: clean(data.root),
    panes: (data.panes || []).map(function (pane) {
      return Object.assign({}, pane, { tree: clean(pane.tree) });
    }),
  };
}

function renderTree(sel, data) {
  const host = kitMount(sel);
  if (!data.__kitAdjusted) {
    const mode = data.mode || "org";
    const roots = [data.root].concat(
      (data.panes || []).map(function (pane) {
        return pane.tree;
      }),
    );
    const options = [];
    if (mode === "files") {
      options.push({
        key: "layout",
        label: "Layout",
        type: "choice",
        choices: ["map", "list"],
        choiceLabels: { map: "Map", list: "List" },
      });
    }
    if (mode === "org") {
      options.push(
        {
          key: "layout",
          label: "Layout",
          type: "choice",
          choices: ["chart", "outline"],
          choiceLabels: { chart: "Reporting map", outline: "Team outline" },
          choiceDescriptions: {
            chart: "See reporting relationships as a connected hierarchy.",
            outline: "Scan every team in reporting-depth order.",
          },
        },
        {
          key: "direction",
          label: "Direction",
          type: "choice",
          choices: ["down", "across"],
          choiceLabels: { down: "Top to bottom", across: "Left to right" },
        },
      );
    }
    if (mode === "evolution") {
      options.push({
        key: "layout",
        label: "Layout",
        type: "choice",
        choices: ["parallel", "revisions"],
        choiceLabels: { parallel: "Parallel trees", revisions: "Revision reading" },
        choiceDescriptions: {
          parallel: "Compare revisions on one shared surface.",
          revisions: "Read each authored revision in sequence.",
        },
      });
    }
    if (roots.some(ktrHasDetail)) {
      options.push({
        key: "detail",
        label: "Text",
        type: "choice",
        choices: ["key", "more"],
        choiceLabels: { key: "Key only", more: "More detail" },
      });
    }
    if (options.length) {
      const adjustment = globalThis.ExplainerKit.registerAdjustments(host, {
        base: data,
        label: data.ariaLabel || `${mode} tree`,
        defaults: {
          layout: data.layout || (mode === "files" ? "map" : mode === "org" ? "chart" : "parallel"),
          direction: data.direction || "down",
          detail: data.detail || "more",
        },
        options,
        apply(state) {
          const previous = host.__kitTreeDriver || host.__kitPresentDriver;
          const current =
            previous && typeof previous.current === "function" ? previous.current() : 0;
          const directionOption = host.__kitAdjustments.entry.options.find(
            (option) => option.key === "direction",
          );
          if (directionOption) {
            directionOption.hidden = state.layout === "outline";
          }
          if (host.__kitTreeDriver && typeof host.__kitTreeDriver.dispose === "function") {
            host.__kitTreeDriver.dispose();
          } else if (
            host.__kitPresentDriver &&
            typeof host.__kitPresentDriver.dispose === "function"
          ) {
            host.__kitPresentDriver.dispose();
          }
          const next = renderTree(host, {
            ...ktrAdjustedData(host.__kitAdjustments.base, state),
            __kitAdjusted: true,
          });
          if (next && next.go) {
            next.go(Math.min(current, Math.max(0, next.count - 1)));
          }
          return next;
        },
      });
      const directionOption = adjustment.entry.options.find((option) => option.key === "direction");
      if (directionOption) {
        directionOption.hidden = adjustment.state.layout === "outline";
      }
      data = ktrAdjustedData(adjustment.base, adjustment.state);
    }
  }
  const mode = data.mode || "org";
  // Additive, never overwrite: the host keeps its page classes (.artifact
  // Carries the reveal styling and the studio's swap button)
  ["org", "files", "evolution"].forEach(function (name) {
    host.classList.remove(`ktr-${name}`);
  });
  host.classList.add("ktr", `ktr-${mode}`);
  host.dataset.direction = data.direction || "down";
  host.dataset.layout =
    data.layout || (mode === "files" ? "map" : mode === "org" ? "chart" : "parallel");

  const DIR_ICON =
    '<svg class="ktr-fico" width="17" height="14" viewBox="0 0 18 15" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M1.3 3.3c0-.6.5-1.1 1.1-1.1h3.6c.3 0 .6.1.8.4l1 1.2h8c.6 0 1.1.5 1.1 1.1v7.1c0 .6-.5 1.1-1.1 1.1H2.4c-.6 0-1.1-.5-1.1-1.1z"/></svg>';
  const FILE_ICON =
    '<svg class="ktr-fico" width="13" height="15" viewBox="0 0 15 17" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M2 1.3h6l5 5v9.4H2z"/><path d="M8 1.3v5h5"/></svg>';

  /* ── shared: depth-based Present driver for org + files ──
     go(i) shows depths 0..i; depthGroups[d] holds the wrapper element(s)
     introduced at depth d (depth 0, the root, is never toggled — it is
     always on screen). Read view renders fully lit; Present mode reveals
     depth by depth with a kch-pre-style stagger (pre-state, force reflow,
     staggered transition-delay release), same move as chart.js's play(). */
  function presentDepths(depthGroups, viewport) {
    const depths = Object.keys(depthGroups)
      .map(Number)
      .toSorted(function (a, b) {
        return a - b;
      });
    const maxDepth = depths.length ? depths.at(-1) : 0;
    const revealed = {};
    function reveal(d) {
      if (revealed[d] || REDUCED_MOTION) {
        return;
      }
      revealed[d] = true;
      (depthGroups[d] || []).forEach((el, k) => {
        el.classList.add("ktr-pre");
        el.getBoundingClientRect();
        el.style.transitionDelay = k * 60 + "ms";
        el.classList.remove("ktr-pre");
        setTimeout(
          function () {
            el.style.transitionDelay = "";
          },
          460 + k * 60,
        );
      });
    }
    let current = 0;
    function go(i) {
      current = Math.max(0, Math.min(maxDepth, i));
      const presenting = document.body.classList.contains("presenting");
      const hasStep = current > 0;
      for (let d = 1; d <= maxDepth; d++) {
        const off = d > i;
        (depthGroups[d] || []).forEach((el) => {
          el.classList.toggle("ktr-off", off && host.dataset.layout !== "outline");
          el.classList.toggle("ktr-muted", off && hasStep && host.dataset.layout === "outline");
        });
        if (!off && presenting && !window.__kitMeasuring) {
          reveal(d);
        }
      }
    }
    go(maxDepth); // Read view: fully lit, nothing staged
    let played = false;
    function play() {
      if (played || window.__kitMeasuring) {
        return;
      }
      played = true;
      for (let d = 1; d <= maxDepth; d++) {
        reveal(d);
      }
    }
    let obs = null;
    if (!document.body.classList.contains("presenting") && "IntersectionObserver" in window) {
      obs = new IntersectionObserver(
        (es) => {
          es.forEach(function (e) {
            if (e.isIntersecting && !document.body.classList.contains("presenting")) {
              play();
              obs.disconnect();
              obs = null;
            }
          });
        },
        { threshold: 0.3 },
      );
      obs.observe(viewport);
    }
    return {
      count: maxDepth + 1,
      current: () => current,
      dispose() {
        if (obs) {
          obs.disconnect();
          obs = null;
        }
      },
      go,
      play,
    };
  }

  if (mode === "org") {
    return globalThis.ExplainerKit.stableDriver(host, org());
  }
  if (mode === "files") {
    return globalThis.ExplainerKit.stableDriver(host, files());
  }
  if (mode === "evolution") {
    return globalThis.ExplainerKit.stableDriver(host, evolution());
  }
  throw new Error(`renderTree: unknown mode "${mode}" — org | files | evolution`);

  /* ── org: boxes-and-elbow-connectors ── */
  function org() {
    if (!data.root) {
      throw new Error("renderTree(org): data.root is required");
    }
    host.dataset.zoom = "";
    const COLLAPSE_DEPTH = 3; // Depths 0..3 render; only deeper descendants collapse
    const ROW_MAX = 5; // >5 siblings wrap into balanced rows

    function chunkRows(list) {
      if (list.length <= ROW_MAX) {
        return [list];
      }
      const rows = Math.ceil(list.length / ROW_MAX);
      const size = Math.ceil(list.length / rows);
      const out = [];
      for (let i = 0; i < list.length; i += size) {
        out.push(list.slice(i, i + size));
      }
      return out;
    }
    function countAll(node) {
      let n = 0;
      (node.children || []).forEach((c) => {
        n += 1 + countAll(c);
      });
      return n;
    }
    function card(node, depth) {
      const el = kitEl(
        "div",
        "ktr-card ktr-depth-" + Math.min(depth, 3) + (node.tone ? " ktr-tone-" + node.tone : ""),
      );
      el.tabIndex = 0;
      el.innerHTML = `<span class="ktr-name">${node.label}</span>${
        node.sub ? '<span class="ktr-sub">' + node.sub + "</span>" : ""
      }${node.note ? '<span class="ktr-note">' + node.note + "</span>" : ""}`;
      return el;
    }
    function buildOutline(node, depth, depthGroups) {
      const branch = kitEl("div", "ktr-outline-branch");
      const row = kitEl("div", "ktr-outline-row");
      row.style.setProperty("--ktr-depth", depth);
      row.append(kitEl("span", "ktr-outline-depth", String(depth).padStart(2, "0")));
      row.append(card(node, depth));
      branch.append(row);
      depthGroups[depth] = depthGroups[depth] || [];
      depthGroups[depth].push(row);
      const children = node.children || [];
      if (children.length) {
        const kids = kitEl("div", "ktr-outline-kids");
        kids.style.setProperty("--ktr-kids-depth", depth + 1);
        children.forEach(function (child) {
          kids.append(buildOutline(child, depth + 1, depthGroups));
        });
        branch.append(kids);
      }
      return branch;
    }
    function buildPill(kidsArr, depth, depthGroups) {
      const count = kidsArr.reduce(function (n, k) {
        return n + 1 + countAll(k);
      }, 0);
      const wrap = kitEl("div", "ktr-more-wrap");
      const btn = kitEl("button", "ktr-more", "+" + count + " more");
      btn.type = "button";
      btn.setAttribute("aria-expanded", "false");
      let open = false,
        built = null;
      btn.addEventListener("click", () => {
        if (!built) {
          built = buildKids(kidsArr, depth + 1, depthGroups);
          wrap.appendChild(built);
        }
        open = !open;
        btn.setAttribute("aria-expanded", String(open));
        btn.textContent = open ? "hide" : "+" + count + " more";
        wrap.classList.toggle("ktr-more-open", open);
      });
      wrap.append(btn);
      return wrap;
    }
    function buildBranch(node, depth, depthGroups) {
      const branch = kitEl("div", "ktr-branch");
      branch.append(card(node, depth));
      const kidsArr = node.children || [];
      if (kidsArr.length > 0) {
        if (depth + 1 > COLLAPSE_DEPTH) {
          branch.append(buildPill(kidsArr, depth, depthGroups));
        } else {
          branch.append(buildKids(kidsArr, depth + 1, depthGroups));
        }
      }
      return branch;
    }
    function buildKids(kidsArr, depth, depthGroups) {
      const wrap = kitEl("div", "ktr-kids");
      depthGroups[depth] = depthGroups[depth] || [];
      depthGroups[depth].push(wrap);
      const rows = chunkRows(kidsArr);
      if (rows.length > 1) {
        wrap.classList.add("ktr-chunked");
      }
      rows.forEach((rowKids) => {
        var row = kitEl("div", "ktr-row");
        rowKids.forEach(function (child) {
          row.appendChild(buildBranch(child, depth, depthGroups));
        });
        wrap.appendChild(row);
      });
      return wrap;
    }

    const canvas = kitEl("div", "ktr-canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", data.ariaLabel || "organization chart");
    const depthGroups = {};
    if (host.dataset.layout === "outline") {
      const outline = kitEl("div", "ktr-outline");
      outline.append(buildOutline(data.root, 0, depthGroups));
      canvas.append(outline);
      host.append(canvas);
      return presentDepths(depthGroups, canvas);
    }
    const rootBranch = buildBranch(data.root, 0, depthGroups);
    rootBranch.classList.add("ktr-root");
    canvas.append(rootBranch);
    host.append(canvas);
    return presentDepths(depthGroups, canvas);
  }

  /* ── files: the flagship "map" look, with a compact-list studio toggle ── */
  function files() {
    if (!data.root) {
      throw new Error("renderTree(files): data.root is required");
    }

    const compact = data.layout === "list";
    host.classList.toggle("ktr-compact", compact);

    function isFolder(node) {
      return (
        node.kind === "folder" || (!node.kind && Boolean(node.children && node.children.length))
      );
    }
    // Returns the wrapper element for one node (row + its own kids/cols),
    // Pushing the kids/cols container into depthGroups at the depth it
    // Introduces — mirrors the retired filetree component's node() shape
    // One-for-one.
    function buildNode(node, depth, depthGroups) {
      const dir = isFolder(node);
      const el = kitEl("div", null);
      const row = kitEl("div", "ktr-fnode" + (dir ? " dir" : ""));
      let html = dir ? DIR_ICON : FILE_ICON;
      html += `<span class="ktr-fname">${node.label}</span>`;
      if (node.note) {
        html += '<span class="ktr-frationale">' + node.note + "</span>";
      }
      row.innerHTML = html;
      el.append(row);
      const kidsArr = node.children || [];
      if (kidsArr.length > 0) {
        depthGroups[depth + 1] = depthGroups[depth + 1] || [];
        // Map mode's flagship move: a group of only leaves renders as a card
        // Grid (name + rationale cards) instead of another indented list —
        // The same "columns" idea filetree opts into per-node, applied here
        // Automatically wherever it fits (compact mode always stays plain).
        const allLeaves =
          !compact &&
          kidsArr.length > 1 &&
          kidsArr.every(function (k) {
            return !(k.children && k.children.length);
          });
        if (allLeaves) {
          const cols = kitEl("div", "ktr-fcols");
          kidsArr.forEach((k) => {
            cols.appendChild(
              kitEl(
                "div",
                "ktr-fleaf",
                '<code class="ktr-fleaf-name">' +
                  k.label +
                  "</code>" +
                  (k.note ? '<span class="ktr-fleaf-note">' + k.note + "</span>" : ""),
              ),
            );
          });
          depthGroups[depth + 1].push(cols);
          el.append(cols);
        } else {
          const kids = kitEl("div", "ktr-fkids");
          kidsArr.forEach((k) => {
            kids.appendChild(buildNode(k, depth + 1, depthGroups));
          });
          depthGroups[depth + 1].push(kids);
          el.append(kids);
        }
      }
      return el;
    }

    const pane = kitEl("div", "ktr-fpane");
    if (data.root.label) {
      pane.append(
        kitEl(
          "div",
          "ktr-fpane-label",
          data.root.label +
            (data.root.sub ? '<span class="ktr-fpane-sub">' + data.root.sub + "</span>" : ""),
        ),
      );
    }
    const depthGroups = {};
    const rootKids = data.root.children || [];
    if (compact) {
      const list = kitEl("div", "ktr-fkids ktr-fkids-top");
      depthGroups[1] = [list];
      rootKids.forEach((child) => {
        list.appendChild(buildNode(child, 1, depthGroups));
      });
      pane.append(list);
    } else {
      depthGroups[1] = [];
      rootKids.forEach((child) => {
        var group = kitEl("div", "ktr-fgroup");
        group.appendChild(buildNode(child, 1, depthGroups));
        depthGroups[1].push(group);
        pane.appendChild(group);
      });
    }
    host.append(pane);
    const driver = presentDepths(depthGroups, pane);
    // Stable holder: the deck captures this object once and calls .go each
    // Keypress; on a compact toggle we swap the inner driver it delegates to
    // (host.__kitTreeDriver) so the active Present driver tracks the new
    // DepthGroups instead of the detached originals.
    if (!host.__kitTreeHolder) {
      host.__kitTreeHolder = {
        count: driver.count,
        go(i) {
          if (host.__kitTreeDriver) {
            host.__kitTreeDriver.go(i);
          }
        },
        play() {
          if (host.__kitTreeDriver) {
            host.__kitTreeDriver.play();
          }
        },
      };
    }
    host.__kitTreeHolder.count = driver.count;
    host.__kitTreeDriver = driver;
    return host.__kitTreeHolder;
  }

  /* ── evolution: filetree's dense mono before/after tree, ported verbatim
     (same panes/tree contract, "kt-" renamed to "ktr-"). Present reveal is
     filetree's row-by-row move (fragSteps over every row), built in here
     since this component must hand back its own {count, go}. ── */
  function evolution() {
    const panes = data.panes || [];
    host.classList.add("ktr-grid");
    if (panes.length === 1) {
      host.classList.add("single");
    }
    const MARKS = { added: "+ added", removed: "− removed", moved: "→ moved" };
    const rows = [];
    const revisionPanes = [];
    function node(n) {
      const name = String(n.name == null ? "" : n.name);
      const isDir = Boolean(n.children && n.children.length) || name.endsWith("/");
      const el = kitEl("div", "ktr-entry");
      const row = kitEl(
        "div",
        "ktr-node" +
          (host.dataset.layout === "revisions" ? "" : " pr-frag") +
          (isDir ? " dir" : "") +
          (n.mark ? " " + n.mark : ""),
      );
      let html = "";
      // Icons default on for evolution — folder/file glyphs reinforce the
      // Before/after structure visual (opt out with icons:false).
      if (data.icons !== false) {
        html += isDir ? DIR_ICON : FILE_ICON;
      }
      html += `<span class="ktr-name">${name}</span>`;
      if (n.rationale) {
        html += '<span class="ktr-rationale">' + n.rationale + "</span>";
      }
      if (n.mark && MARKS[n.mark]) {
        html += '<span class="ktr-mark">' + MARKS[n.mark] + "</span>";
      }
      if (n.note) {
        html += '<span class="ktr-note">' + n.note + "</span>";
      }
      row.innerHTML = html;
      rows.push(row);
      el.append(row);
      if (n.children && n.children.length > 0) {
        if (n.columns) {
          const cols = kitEl("div", "ktr-cols");
          n.children.forEach((c) => {
            cols.appendChild(
              kitEl(
                "div",
                "ktr-leaf",
                '<code class="ktr-leaf-name">' +
                  c.name +
                  "</code>" +
                  (c.note ? '<span class="ktr-leaf-note">' + c.note + "</span>" : ""),
              ),
            );
          });
          el.append(cols);
        } else {
          const kids = kitEl("div", "ktr-kids");
          n.children.forEach((c) => {
            kids.appendChild(node(c));
          });
          el.append(kids);
        }
      }
      return el;
    }
    panes.forEach((p, paneIndex) => {
      var pane = kitEl("div", "ktr-pane" + (p.accent ? " accent" : ""));
      pane.dataset.revision = String(paneIndex + 1).padStart(2, "0");
      if (p.label) {
        pane.appendChild(
          kitEl(
            "div",
            "ktr-pane-label",
            p.label + (p.sub ? '<span class="ktr-pane-sub">' + p.sub + "</span>" : ""),
          ),
        );
      }
      (p.tree || []).forEach(function (n) {
        pane.appendChild(node(n));
      });
      host.appendChild(pane);
      revisionPanes.push(pane);
    });
    if (data.legend !== false) {
      host.append(
        kitEl(
          "div",
          "ktr-legend",
          '<span class="added"><b>+</b> added</span>' +
            '<span class="moved"><b>→</b> moved</span>' +
            '<span class="removed"><b>−</b> removed</span>' +
            "<span>plain = unchanged</span>",
        ),
      );
    }
    let current = 0;
    function go(i) {
      current = i;
      if (host.dataset.layout === "revisions") {
        revisionPanes.forEach((pane, k) => {
          pane.classList.toggle(
            "ktr-off",
            k !== i && document.body.classList.contains("presenting"),
          );
        });
        return;
      }
      rows.forEach((r, k) => {
        r.classList.toggle("pr-on", k <= i - 1);
      });
    }
    return {
      count: host.dataset.layout === "revisions" ? revisionPanes.length : rows.length + 1,
      current: () => current,
      go,
    };
  }
}
