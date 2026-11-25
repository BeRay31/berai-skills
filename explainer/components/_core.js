/* ── Component core ────────────────────────────────────────────────────
   Tiny DOM helpers shared by every component renderer. Renderers take
   (selector, data) and build markup from the documented contract in
   _kit/CONTRACTS.md — authors supply data, not markup. */
const kitTextCapsRegistry = globalThis.__kitInjectedTextCaps;
const kitLegacyComponentCompat = globalThis.__kitLegacyComponentCompat === true;
Reflect.deleteProperty(globalThis, "__kitInjectedTextCaps");
Reflect.deleteProperty(globalThis, "__kitLegacyComponentCompat");
const kitTextCapSeen = new WeakMap();
const kitTextCapHosts = new WeakMap();

function kitTextCapSegments(path) {
  return String(path)
    .split(".")
    .map(function (part) {
      const traversals = (part.match(/\[\]/g) || []).length;
      return { field: part.replaceAll("[]", ""), traversals };
    });
}

function kitTextCapMaterialize(data, path, fallback) {
  const segments = kitTextCapSegments(path);
  let states = [{ path: "", value: data }];
  segments.forEach(function (segment, segmentIndex) {
    const next = [];
    states.forEach(function (state) {
      if (state.value == null || typeof state.value !== "object" || !segment.field) {
        return;
      }
      let field = segment.field;
      let value = state.value[field];
      if (segmentIndex === segments.length - 1 && fallback && (value == null || value === "")) {
        field = fallback;
        value = state.value[field];
      }
      let fieldStates = [
        {
          path: state.path + (state.path ? "." : "") + field,
          value,
        },
      ];
      for (let depth = 0; depth < segment.traversals; depth += 1) {
        const traversed = [];
        fieldStates.forEach(function (fieldState) {
          if (Array.isArray(fieldState.value)) {
            fieldState.value.forEach(function (item, index) {
              traversed.push({ path: fieldState.path + "[" + index + "]", value: item });
            });
          } else if (fieldState.value != null) {
            traversed.push(fieldState);
          }
        });
        fieldStates = traversed;
      }
      next.push(...fieldStates);
    });
    states = next;
  });
  return states.filter(function (state) {
    return state.value != null;
  });
}

function kitTextCapNonempty(value) {
  if (value == null) {
    return false;
  }
  if (Array.isArray(value) || typeof value === "string") {
    return value.length > 0;
  }
  return true;
}

function kitTextCapRuleMatches(rule, renderer, data) {
  if (!Array.isArray(rule.renderers) || !rule.renderers.includes(renderer)) {
    return false;
  }
  const when = rule.when || {};
  if (
    !Object.keys(when).every(function (field) {
      const expected = when[field];
      const actual = data[field] == null ? null : data[field];
      return Array.isArray(expected) ? expected.includes(actual) : expected === actual;
    })
  ) {
    return false;
  }
  return !(rule.unlessAnyNonempty || []).some(function (path) {
    return kitTextCapMaterialize(data, path).some(function (state) {
      return kitTextCapNonempty(state.value);
    });
  });
}

function kitTextCapLength(value, measure) {
  const source = String(value == null ? "" : value);
  if (measure !== "passive-inline") {
    return source.length;
  }
  const probe = document.createElement("span");
  kitSetPassiveInline(probe, source);
  return probe.textContent.length;
}

function kitTextCapLocation(diagnostic) {
  const labels = {
    after: "after text",
    before: "before text",
    body: "body",
    sub: "supporting text",
    title: "title",
  };
  const match = String(diagnostic.path || "").match(/(?:items|rows|steps)\[(\d+)]\.([\w]+)/);
  if (!match) {
    return String(diagnostic.path || "Copy field");
  }
  const kind = diagnostic.path.startsWith("steps")
    ? "Step"
    : diagnostic.path.startsWith("rows")
      ? "Row"
      : "Item";
  return `${kind} ${Number(match[1]) + 1}, ${labels[match[2]] || match[2]}`;
}

function kitShowTextCapHost(diagnostic) {
  const host = kitTextCapHosts.get(diagnostic);
  if (!host || !document.body.contains(host)) {
    return false;
  }
  if (typeof window.__revealAll === "function") {
    window.__revealAll();
  }
  const step = String(diagnostic.path || "").match(/^steps\[(\d+)]/);
  if (step && diagnostic.renderer === "renderStepper") {
    const control = host.querySelectorAll(".kst-dot")[Number(step[1])];
    if (control) {
      control.click();
    }
  }
  host.scrollIntoView({ behavior: "smooth", block: "center" });
  host.classList.add("kit-copy-focus");
  window.setTimeout(function () {
    host.classList.remove("kit-copy-focus");
  }, 1800);
  return true;
}

function kitShowTextCapIssues() {
  const previous = document.querySelector(".kit-diagnostics-panel");
  if (previous) {
    previous.remove();
    return;
  }
  const diagnostics = (window.__kitDiagnostics || []).filter(function (item) {
    return item && item.type === "text-cap";
  });
  const panel = kitEl("section", "kit-diagnostics-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Copy issues to fix");
  const heading = kitEl("div", "kit-diagnostics-heading");
  heading.append(kitEl("strong", null, `${diagnostics.length} copy issues to fix`));
  const close = kitEl("button", null, "Close");
  close.addEventListener("click", kitShowTextCapIssues);
  heading.append(close);
  panel.append(heading);
  panel.append(
    kitEl(
      "p",
      "kit-diagnostics-help",
      "This explainer kept older copy during upgrade. Shorten these fields to meet the current component limits.",
    ),
  );
  const list = kitEl("ol", "kit-diagnostics-list");
  diagnostics.forEach(function (item) {
    const row = kitEl("li");
    row.append(kitEl("strong", null, kitTextCapLocation(item)));
    row.append(
      kitEl(
        "span",
        null,
        ` ${item.actual} characters, ${item.actual - item.limit} over the ${item.limit} limit`,
      ),
    );
    const current = kitEl("q");
    kitSetPassiveInline(current, item.value);
    row.append(current);
    const hint = kitEl("small");
    kitSetPassiveInline(hint, item.hint);
    row.append(hint);
    const show = kitEl("button", "kit-diagnostics-show", "Show in explainer");
    show.addEventListener("click", function () {
      kitShowTextCapHost(item);
    });
    row.append(show);
    if (window.__RVAPI && typeof window.__RVAPI.addCopyException === "function") {
      const request = kitEl("button", "kit-diagnostics-exception", "Request exception");
      request.addEventListener("click", function () {
        window.__RVAPI.addCopyException(item);
        request.textContent = "Exception requested";
        request.disabled = true;
      });
      row.append(request);
    }
    list.append(row);
  });
  panel.append(list);
  const action = kitEl(
    "button",
    "kit-diagnostics-action",
    window.__RVAPI ? "Add fixes to Notes" : "Copy fix list",
  );
  action.addEventListener("click", function () {
    if (window.__RVAPI && typeof window.__RVAPI.addCopyIssues === "function") {
      window.__RVAPI.addCopyIssues(diagnostics);
      action.textContent = "Added to Notes";
      action.disabled = true;
      return;
    }
    const text = diagnostics
      .map(function (item) {
        return `${kitTextCapLocation(item)}: ${item.hint} Current copy: ${item.value}`;
      })
      .join("\n");
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") {
      action.textContent = "Copy failed";
      return false;
    }
    return navigator.clipboard
      .writeText(text)
      .then(function () {
        action.textContent = "Copied";
        return true;
      })
      .catch(function () {
        action.textContent = "Copy failed";
        return false;
      });
  });
  panel.append(action);
  (document.body || document.documentElement).append(panel);
}

function kitTextCapBadge() {
  let badge = document.querySelector(".kit-diagnostics");
  if (!badge) {
    badge = document.createElement("button");
    badge.className = "kit-diagnostics";
    badge.setAttribute("type", "button");
    badge.setAttribute("aria-live", "polite");
    badge.addEventListener("click", kitShowTextCapIssues);
    (document.body || document.documentElement).append(badge);
  }
  const diagnostics = window.__kitDiagnostics || [];
  const count = diagnostics.filter(function (item) {
    return item && item.type === "text-cap";
  }).length;
  badge.dataset.count = String(count);
  badge.textContent = count + " copy " + (count === 1 ? "issue" : "issues") + " · Review fixes";
}

function kitTextCapReport(host, diagnostic) {
  host.dataset.copyIssue = "true";
  kitTextCapHosts.set(diagnostic, host);
  window.__kitDiagnostics = window.__kitDiagnostics || [];
  window.__kitDiagnostics.push(diagnostic);
  console.error(
    "[kit text cap] " +
      diagnostic.renderer +
      " " +
      diagnostic.path +
      ": actual " +
      diagnostic.actual +
      ", limit " +
      diagnostic.limit +
      ". " +
      diagnostic.hint,
  );
  kitTextCapBadge(diagnostic);
  window.dispatchEvent(new window.CustomEvent("kitdiagnostic", { detail: diagnostic }));
}

function kitValidateTextCaps(host, renderer, data) {
  const diagnostics = [];
  try {
    if (!host || !host.dataset || !data || typeof data !== "object") {
      return diagnostics;
    }
    const registry = kitTextCapsRegistry;
    if (!registry || registry.schema !== 1 || !Array.isArray(registry.rules)) {
      return diagnostics;
    }
    const rendererName = typeof renderer === "function" ? renderer.name : String(renderer);
    let seen = kitTextCapSeen.get(host);
    if (!seen) {
      seen = new Set();
      kitTextCapSeen.set(host, seen);
    }
    registry.rules.forEach(function (rule) {
      if (!kitTextCapRuleMatches(rule, rendererName, data) || !Array.isArray(rule.targets)) {
        return;
      }
      rule.targets.forEach(function (target) {
        kitTextCapMaterialize(data, target.path, target.fallback).forEach(function (field) {
          const value = String(field.value);
          const actual = kitTextCapLength(value, target.measure);
          if (actual <= target.max) {
            return;
          }
          const key = JSON.stringify([rule.id, field.path, value]);
          if (seen.has(key)) {
            host.dataset.copyIssue = "true";
            return;
          }
          seen.add(key);
          const diagnostic = {
            actual,
            component: rule.component,
            fatal: false,
            hint: target.hint,
            limit: target.max,
            measure: target.measure,
            path: field.path,
            renderer: rendererName,
            ruleId: rule.id,
            severity: "warning",
            type: "text-cap",
            value,
          };
          diagnostics.push(diagnostic);
          kitTextCapReport(host, diagnostic);
        });
      });
    });
  } catch (error) {
    console.error("[kit text cap] diagnostic validation failed without blocking render", error);
  }
  return diagnostics;
}

function kitEl(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) {
    e.className = cls;
  }
  if (html != null) {
    e.innerHTML = html;
  }
  return e;
}
function kitSetAllowedInline(target, value, highlightedCode) {
  const source = String(value == null ? "" : value);
  const tokenPattern =
    /<\/?(?:code|em|strong|b|i|br)>|<\/span>|<span class="(?:y-key|y-str|y-num|y-bool|y-com)">/gi;
  const stack = [target];
  let offset = 0;
  target.replaceChildren();
  source.replaceAll(tokenPattern, function (token, at) {
    if (at > offset) {
      stack.at(-1).append(document.createTextNode(source.slice(offset, at)));
    }
    const closing = token.startsWith("</");
    const tag = token.match(/^<\/?([a-z]+)/i)[1].toLowerCase();
    const codeSpan = tag === "span";
    const allowed = codeSpan ? highlightedCode : !highlightedCode;
    if (!allowed || (closing && (stack.length === 1 || stack.at(-1).localName !== tag))) {
      stack.at(-1).append(document.createTextNode(token));
    } else if (closing) {
      stack.pop();
    } else {
      const child = document.createElement(tag);
      if (codeSpan) {
        child.className = token.match(/class="([^"]+)"/i)[1];
      }
      stack.at(-1).append(child);
      if (tag !== "br") {
        stack.push(child);
      }
    }
    offset = at + token.length;
    return token;
  });
  if (offset < source.length) {
    stack.at(-1).append(document.createTextNode(source.slice(offset)));
  }
  return target;
}
function kitSetPassiveInline(target, value) {
  return kitSetAllowedInline(target, value, false);
}
function kitSetHighlightedCode(target, value) {
  return kitSetAllowedInline(target, value, true);
}
function kitMount(sel) {
  const host = typeof sel === "string" ? document.querySelector(sel) : sel;
  if (!host) {
    throw new Error("component host not found: " + sel);
  }
  if (typeof host.__kitDispose === "function") {
    host.__kitDispose();
  }
  host.__kitDispose = null;
  host.innerHTML = "";
  return host;
}

// CSS handles flowing content. Geometry-based renderers use the same token
// when placing nodes and routes, and rebuild only when that token changes.
function kitContentSpacing() {
  if (typeof getComputedStyle !== "function") {
    return 1;
  }
  const value = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--content-space-scale"),
  );
  return Math.max(0.75, Math.min(1.35, value || 1));
}

function kitObserveContentSpacing(host, refresh) {
  if (typeof MutationObserver !== "function") {
    return;
  }
  let spacing = kitContentSpacing();
  const observer = new MutationObserver(function () {
    const next = kitContentSpacing();
    if (next === spacing) {
      return;
    }
    spacing = next;
    refresh();
    window.dispatchEvent(new CustomEvent("kitcomponentchange", { detail: { host } }));
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["style", "class"],
  });
  const dispose = host.__kitDispose;
  host.__kitDispose = function () {
    observer.disconnect();
    if (dispose) {
      dispose();
    }
  };
}

/* Register deterministic, host-scoped Studio adjustments without making each
   component rebuild the same options/get/set plumbing. The component still
   owns the useful part: its defaults and one apply(state) callback. State
   survives kitMount() re-renders on the host; the authored base data never
   gets replaced by a preview. */
function kitRegisterAdjustments(host, config) {
  if (host.__kitAdjustments) {
    return host.__kitAdjustments;
  }
  const options = (config.options || []).map(function (option) {
    return Object.assign({}, option, {
      choices: option.choices ? option.choices.slice() : undefined,
    });
  });
  const state = { ...config.defaults };
  const record = {
    base: config.base,
    state,
  };
  const entry = {
    host,
    label: config.label || "component",
    options,
    get(key) {
      return state[key];
    },
    set(key, value) {
      const option = options.find(function (candidate) {
        return candidate.key === key;
      });
      if (!option) {
        return false;
      }
      if (option.type === "choice" && !option.choices.includes(value)) {
        return false;
      }
      if (option.type === "toggle") {
        value = value !== false;
      }
      state[key] = value;
      const applied = config.apply ? config.apply({ ...state }, key) : value;
      return applied === false ? false : value;
    },
  };
  record.entry = entry;
  host.__kitAdjustments = record;
  if (!host.__kitBase) {
    host.__kitBase = config.base;
  }
  // Kept as a public alias for existing Studio integrations and older
  // component tests; new code should use __kitAdjustments.state.
  host.__kitSwapState = state;
  (window.__kitSwappable = window.__kitSwappable || []).push(entry);
  return record;
}

/* Present manifests keep the object returned by the first render. Components
   that Studio can re-render route that object through this stable holder. */
function kitStableDriver(host, driver) {
  if (!host.__kitPresentHolder) {
    host.__kitPresentHolder = {
      count: driver.count,
      current() {
        const live = host.__kitPresentDriver;
        return live && typeof live.current === "function" ? live.current() : 0;
      },
      go(index) {
        const live = host.__kitPresentDriver;
        return live && typeof live.go === "function" ? live.go(index) : undefined;
      },
      play() {
        const live = host.__kitPresentDriver;
        return live && typeof live.play === "function" ? live.play() : undefined;
      },
    };
  }
  host.__kitPresentDriver = driver;
  host.__kitPresentHolder.count = driver.count;
  return host.__kitPresentHolder;
}
function kitDataImage(uri, alt) {
  if (typeof uri !== "string" || !uri.startsWith("data:image/")) {
    throw new Error("component images must use data:image URIs");
  }
  const image = kitEl("img");
  image.src = uri;
  image.alt = alt || "";
  return image;
}
function kitFlag(f, extra) {
  const kinds = new Set(["done", "progress", "next", "gap"]);
  const flag = kitEl("span", "flag " + (kinds.has(f.kind) ? f.kind : "next"));
  if (extra) {
    flag.classList.add(extra);
  }
  flag.append(kitEl("i"));
  const label = document.createTextNode(String(f.label == null ? "" : f.label));
  flag.append(label);
  return flag;
}

/* Inline adjustment bars: the choices a component registered, as chips above
   it, so a reader of the showcase can switch layouts without Studio. Bars
   live outside the host, so a re-render never removes them. */
function kitMountAdjustmentBars(scope) {
  const root = scope || document;
  const mounted = [];
  (window.__kitSwappable || []).forEach((entry) => {
    const host = entry.host;
    if (!host || !host.isConnected || !root.contains(host) || host.__kitAdjustBar) {
      return;
    }
    const choices = (entry.options || []).filter(
      (option) => option.type === "choice" && (option.choices || []).length > 1,
    );
    if (!choices.length) {
      return;
    }
    const bar = kitEl("div", "kit-adjust");
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", entry.label + " options");
    choices.forEach((option) => {
      const row = kitEl("div", "kit-adjust-row");
      row.append(kitEl("span", "kit-adjust-label", option.label || option.key));
      const seg = kitEl("div", "kit-adjust-seg");
      seg.setAttribute("role", "radiogroup");
      // Readers see what this data can show; unsupported choices stay in
      // Studio, greyed with the help text that says what to add.
      const offered = option.choices.filter(
        (choice) => !(option.disabledChoices || []).includes(choice),
      );
      if (offered.length < 2) {
        return;
      }
      const buttons = offered.map((choice) => {
        const button = kitEl(
          "button",
          "kit-adjust-choice",
          (option.choiceLabels || {})[choice] || choice,
        );
        button.type = "button";
        button.dataset.choice = choice;
        button.setAttribute("role", "radio");
        button.addEventListener("click", () => {
          if (entry.get(option.key) === choice) {
            return;
          }
          if (entry.set(option.key, choice) === false) {
            return;
          }
          sync();
          const driver = host.__kitPresentHolder;
          window.dispatchEvent(
            new CustomEvent("kitcomponentchange", {
              detail: { host, count: driver ? driver.count : null },
            }),
          );
        });
        seg.append(button);
        return button;
      });
      function sync() {
        const current = entry.get(option.key);
        buttons.forEach((button) => {
          const on = button.dataset.choice === current;
          button.classList.toggle("is-on", on);
          button.setAttribute("aria-checked", String(on));
        });
      }
      sync();
      row.append(seg);
      bar.append(row);
    });
    host.__kitAdjustBar = bar;
    host.before(bar);
    mounted.push(bar);
  });
  return mounted;
}

/* Embed mode: ?kit-embed shows one section at a time with no page chrome, and
   switches on request from a parent frame. Studio uses it to preview visuals
   from the showcase while the reader hovers a choice; nothing here executes
   or stores what the parent sends beyond an element id. */
function kitEmbedMode() {
  let params;
  try {
    params = new URLSearchParams(window.location.search);
  } catch {
    return;
  }
  if (!params.has("kit-embed")) {
    return;
  }
  document.documentElement.dataset.kitEmbed = "";
  const theme = params.get("theme");
  if (theme === "light" || theme === "dark") {
    document.documentElement.dataset.theme = theme;
  }
  function focusSection(id) {
    const target =
      typeof id === "string" && id ? document.querySelector("#" + CSS.escape(id)) : null;
    const section = target ? target.closest("section") || target : null;
    document.querySelectorAll(".shell > section").forEach((candidate) => {
      const on = candidate === section;
      candidate.hidden = !on;
      candidate.classList.toggle("kit-embed-focus", on);
      if (on) {
        [...candidate.children].forEach((child) => {
          child.hidden = false;
        });
        candidate.querySelectorAll(".reveal").forEach((node) => node.classList.add("is-visible"));
      }
    });
    // A section can hold several variants, each a heading block followed by
    // its artifact. When the anchor is one of those headings, show only that
    // block and what follows it up to the next heading.
    if (section && target !== section) {
      const children = [...section.children];
      const isHead = (node) =>
        Boolean(node.querySelector(":scope > .eyebrow, :scope > .sec-title"));
      let start = target.parentElement === section ? target : null;
      while (start && !isHead(start) && start.previousElementSibling) {
        start = start.previousElementSibling;
      }
      if (start) {
        // A heading anchor shows its whole block; an artifact anchor shows
        // the heading and that artifact alone.
        const wholeBlock = isHead(target);
        let inside = false;
        children.forEach((child) => {
          if (child === start) {
            inside = true;
          } else if (inside && isHead(child)) {
            inside = false;
          }
          const artifact = child.classList.contains("artifact");
          child.hidden = !(inside && (wholeBlock || !artifact || child === target));
        });
      }
    }
    window.scrollTo(0, 0);
    return Boolean(section);
  }
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.source !== "explainer-embed") {
      return;
    }
    if (typeof data.focus === "string") {
      focusSection(data.focus);
    }
    if (data.theme === "light" || data.theme === "dark") {
      document.documentElement.dataset.theme = data.theme;
    }
  });
  const ready = () => {
    kitMountAdjustmentBars();
    focusSection(params.get("kit-embed"));
    if (window.parent !== window) {
      window.parent.postMessage({ source: "explainer-embed", ready: true }, "*");
    }
  };
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", ready, { once: true });
  } else {
    ready();
  }
}
kitEmbedMode();

/* Every component file is concatenated into the self-contained HTML. Expose
   the few cross-file helpers through one deliberate runtime boundary so each
   source remains lintable in isolation without adding a module loader. */
globalThis.ExplainerKit = Object.assign(globalThis.ExplainerKit || {}, {
  contentSpacing: kitContentSpacing,
  mountAdjustmentBars: kitMountAdjustmentBars,
  observeContentSpacing: kitObserveContentSpacing,
  registerAdjustments: kitRegisterAdjustments,
  stableDriver: kitStableDriver,
});
