/* Component: stepper — see _kit/CONTRACTS.md#stepper */
function renderStepper(sel, data) {
  const host = kitMount(sel);
  if (!data.__kitAdjusted) {
    const adjustment = globalThis.ExplainerKit.registerAdjustments(host, {
      base: data,
      defaults: { layout: data.layout || "focused" },
      label: data.ariaLabel || "Stepper",
      options: [
        {
          key: "layout",
          label: "Layout",
          type: "choice",
          choices: ["focused", "overview"],
          choiceLabels: { focused: "Focused step", overview: "Overview" },
          choiceDescriptions: {
            focused: "Present one step at a time",
            overview: "Keep the whole process in view",
          },
        },
      ],
      apply(state) {
        const current = host.__kitPresentDriver ? host.__kitPresentDriver.current() : 0;
        const driver = renderStepper(host, {
          ...host.__kitAdjustments.base,
          layout: state.layout,
          __kitAdjusted: true,
        });
        driver.go(current);
        return driver;
      },
    });
    data = { ...adjustment.base, layout: adjustment.state.layout, __kitAdjusted: true };
  }
  kitValidateTextCaps(host, "renderStepper", data);
  host.classList.add("kst");
  host.dataset.layout = data.layout || "focused";
  const steps = data.steps || [];
  if (steps.length === 0) {
    throw new Error("renderStepper: data.steps is required");
  }
  if (steps.length > 6 && !kitLegacyComponentCompat) {
    throw new Error("renderStepper: data.steps supports at most 6 steps, got " + steps.length);
  }
  function visibleLength(value) {
    return String(value == null ? "" : value).replaceAll(/<[^>]*>/g, "").length;
  }
  steps.forEach((step, index) => {
    var where = "step " + (index + 1) + " ";
    var hasCodeContent = step.code && visibleLength(step.code.html) > 0;
    if (step.code && !hasCodeContent) {
      throw new Error("renderStepper: " + where + "code requires non-empty html");
    }
    if (!visibleLength(step.title) && !visibleLength(step.body) && !hasCodeContent) {
      throw new Error("renderStepper: step " + (index + 1) + " has no content");
    }
    if (step.code) {
      var lines = String(step.code.html == null ? "" : step.code.html).split("\n").length;
      if (lines > 4) {
        throw new Error("renderStepper: " + where + "code supports at most 4 lines, got " + lines);
      }
    }
  });
  const rail = kitEl("div", "kst-rail");
  const dots = steps.map(function (s, i) {
    var d = kitEl("button", "kst-dot", String(i + 1).padStart(2, "0"));
    d.type = "button";
    d.setAttribute(
      "aria-label",
      "Step " + (i + 1) + (s.title ? ": " + s.title.replaceAll(/<[^>]+>/g, "") : ""),
    );
    const dotTitle = kitEl("span", "kst-dot-title");
    dotTitle.textContent = s.title || s.label || "Step " + (i + 1);
    d.append(dotTitle);
    d.addEventListener("click", function () {
      go(i);
    });
    rail.appendChild(d);
    return d;
  });
  const nav = kitEl("div", "kst-nav");
  const prevB = kitEl("button", null, "←");
  prevB.type = "button";
  prevB.setAttribute("aria-label", "Previous step");
  const nextB = kitEl("button", null, "→");
  nextB.type = "button";
  nextB.setAttribute("aria-label", "Next step");
  prevB.addEventListener("click", () => {
    go(cur - 1);
  });
  nextB.addEventListener("click", () => {
    go(cur + 1);
  });
  nav.append(prevB);
  nav.append(nextB);
  rail.append(nav);
  host.append(rail);
  const hasCode = steps.some(function (s) {
    return s.code;
  });
  const panel = kitEl("div", "kst-panel" + (hasCode ? "" : " no-code"));
  const prose = kitEl("div", "kst-prose");
  panel.append(prose);
  let codeWrap = null;
  if (hasCode) {
    codeWrap = kitEl("div", "kst-code");
    panel.append(codeWrap);
  }
  host.append(panel);

  let cur = -1;
  function go(i) {
    if (i < 0 || i >= steps.length || i === cur) {
      return;
    }
    cur = i;
    const s = steps[i];
    dots.forEach((d, k) => {
      d.classList.toggle("active", k === i);
      d.classList.toggle("done", k < i);
    });
    prevB.disabled = i === 0;
    nextB.disabled = i === steps.length - 1;
    prose.replaceChildren();
    const label = kitEl("span", "kst-label");
    label.textContent = s.label || "Step " + (i + 1) + " of " + steps.length;
    prose.append(label);
    if (s.title) {
      const title = kitEl("h4");
      title.textContent = String(s.title);
      prose.append(title);
    }
    if (s.body) {
      const body = kitEl("p");
      body.textContent = String(s.body);
      prose.append(body);
    }
    if (codeWrap) {
      codeWrap.replaceChildren();
      if (s.code) {
        const block = kitEl("div", "code-block");
        const head = kitEl("div", "code-head");
        head.append(kitEl("i"));
        const filename = kitEl("span");
        filename.textContent = s.code.filename == null ? "" : String(s.code.filename);
        head.append(filename);
        block.append(head);
        const code = kitEl("pre");
        kitSetHighlightedCode(code, s.code.html);
        block.append(code);
        codeWrap.append(block);
      }
    }
    if (typeof swapIn === "function") {
      swapIn(panel);
    }
  }
  go(0);
  return globalThis.ExplainerKit.stableDriver(host, {
    go,
    count: steps.length,
    current() {
      return cur;
    },
  });
}
