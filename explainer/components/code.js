/* Component: code — annotated evidence for a pull request.
   mode:'diff' keeps before and after on one stable surface; walkthrough steps
   change emphasis only, so reviewers never lose their place between hunks. */
function kcdAdjustedData(data, state) {
  const next = {
    ...data,
    layout: state.layout,
    lines: state.lines,
    typeScale: state.typeScale,
  };
  if (state.lines !== "changes") {
    return next;
  }
  const referenced = new Set();
  (data.walkthrough || []).forEach(function (step) {
    (step.lines || []).forEach(function (id) {
      referenced.add(id);
    });
  });
  let hasChange = false;
  function pane(source, side) {
    const lines = (source.lines || []).map(function (line, index) {
      const value = typeof line === "string" ? { text: line } : Object.assign({}, line);
      value.id = value.id || side + "-" + (index + 1);
      value.kind = value.kind || "context";
      value.number = value.number == null ? index + 1 : value.number;
      if (value.kind !== "context") {
        hasChange = true;
      }
      return value;
    });
    const keep = new Set();
    lines.forEach(function (line, index) {
      if (line.kind !== "context" || referenced.has(line.id)) {
        keep.add(index);
        if (index > 0) {
          keep.add(index - 1);
        }
        if (index + 1 < lines.length) {
          keep.add(index + 1);
        }
      }
    });
    const filtered = lines.filter(function (_line, index) {
      return keep.has(index);
    });
    return { ...source, lines: filtered.length ? filtered : lines.slice(0, 1) };
  }
  const before = pane(data.before || {}, "before");
  const after = pane(data.after || {}, "after");
  return hasChange ? { ...next, before, after } : next;
}

const kcdLanguageKeywords = {
  javascript: new Set([
    "as",
    "async",
    "await",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "debugger",
    "default",
    "delete",
    "do",
    "else",
    "export",
    "extends",
    "finally",
    "for",
    "from",
    "function",
    "get",
    "if",
    "import",
    "in",
    "instanceof",
    "interface",
    "let",
    "new",
    "of",
    "return",
    "set",
    "static",
    "super",
    "switch",
    "throw",
    "try",
    "type",
    "typeof",
    "var",
    "void",
    "while",
    "with",
    "yield",
  ]),
  python: new Set([
    "and",
    "as",
    "assert",
    "async",
    "await",
    "break",
    "class",
    "continue",
    "def",
    "del",
    "elif",
    "else",
    "except",
    "finally",
    "for",
    "from",
    "global",
    "if",
    "import",
    "in",
    "is",
    "lambda",
    "nonlocal",
    "not",
    "or",
    "pass",
    "raise",
    "return",
    "try",
    "while",
    "with",
    "yield",
  ]),
  go: new Set([
    "break",
    "case",
    "chan",
    "const",
    "continue",
    "default",
    "defer",
    "else",
    "fallthrough",
    "for",
    "func",
    "go",
    "goto",
    "if",
    "import",
    "interface",
    "map",
    "package",
    "range",
    "return",
    "select",
    "struct",
    "switch",
    "type",
    "var",
  ]),
  json: new Set(),
};

const kcdLanguageLiterals = {
  javascript: new Set(["false", "null", "true", "undefined"]),
  python: new Set(["False", "None", "True"]),
  go: new Set(["false", "nil", "true"]),
  json: new Set(["false", "null", "true"]),
};

function kcdLanguageForFile(file) {
  const clean = String(file || "")
    .split(/[?#]/, 1)[0]
    .toLowerCase();
  const extension = clean.includes(".") ? clean.slice(clean.lastIndexOf(".") + 1) : "";
  if (["js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts"].includes(extension)) {
    return "javascript";
  }
  if (extension === "json" || extension === "jsonc") {
    return "json";
  }
  if (extension === "py" || extension === "pyw") {
    return "python";
  }
  if (extension === "go") {
    return "go";
  }
  return "";
}

function kcdStringEnd(source, start, delimiter) {
  for (let index = start; index <= source.length - delimiter.length; index += 1) {
    if (source.startsWith(delimiter, index)) {
      let escapes = 0;
      for (let back = index - 1; back >= 0 && source[back] === "\\"; back -= 1) {
        escapes += 1;
      }
      if (escapes % 2 === 0) {
        return index + delimiter.length;
      }
    }
  }
  return -1;
}

function kcdScanLine(source, language, state) {
  if (!language) {
    return [{ text: source, type: "" }];
  }
  const tokens = [];
  const push = function (text, type) {
    if (text) {
      tokens.push({ text, type });
    }
  };
  let index = 0;
  while (index < source.length) {
    if (state.blockComment) {
      const end = source.indexOf("*/", index);
      if (end === -1) {
        push(source.slice(index), "comment");
        break;
      }
      push(source.slice(index, end + 2), "comment");
      state.blockComment = false;
      index = end + 2;
      continue;
    }
    if (state.string) {
      const end = kcdStringEnd(source, index, state.string);
      if (end === -1) {
        push(source.slice(index), "string");
        break;
      }
      push(source.slice(index, end), "string");
      state.string = "";
      index = end;
      continue;
    }

    const rest = source.slice(index);
    const whitespace = rest.match(/^\s+/);
    if (whitespace) {
      push(whitespace[0], "");
      index += whitespace[0].length;
      continue;
    }
    if (language === "python" && source[index] === "#") {
      push(rest, "comment");
      break;
    }
    if (language !== "python" && rest.startsWith("//")) {
      push(rest, "comment");
      break;
    }
    if (language !== "python" && rest.startsWith("/*")) {
      const end = source.indexOf("*/", index + 2);
      if (end === -1) {
        push(rest, "comment");
        state.blockComment = true;
        break;
      }
      push(source.slice(index, end + 2), "comment");
      index = end + 2;
      continue;
    }

    let stringPrefix = "";
    let delimiter = "";
    if (language === "python") {
      const match = rest.match(/^(?:[rRuUbBfF]{1,2})?("""|'''|"|')/);
      if (match) {
        stringPrefix = match[0].slice(0, -match[1].length);
        delimiter = match[1];
      }
    } else if (['"', "'", "`"].includes(source[index])) {
      delimiter = source[index];
    }
    if (delimiter) {
      const start = index + stringPrefix.length + delimiter.length;
      const end = kcdStringEnd(source, start, delimiter);
      if (end < 0) {
        push(rest, "string");
        if (
          delimiter.length === 3 ||
          delimiter === "`" ||
          (language === "go" && delimiter === "`")
        ) {
          state.string = delimiter;
        }
        break;
      }
      push(source.slice(index, end), "string");
      index = end;
      continue;
    }

    const number = rest.match(
      /^(?:0[xX][\dA-Fa-f]+|0[bB][01]+|0[oO][0-7]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/,
    );
    if (number) {
      push(number[0], "number");
      index += number[0].length;
      continue;
    }
    const identifier = rest.match(/^[A-Za-z_$][\w$]*/);
    if (identifier) {
      push(identifier[0], "identifier");
      index += identifier[0].length;
      continue;
    }
    push(source[index], "");
    index += 1;
  }

  const keywords = kcdLanguageKeywords[language];
  const literals = kcdLanguageLiterals[language];
  tokens.forEach(function (token, tokenIndex) {
    if (token.type !== "identifier") {
      return;
    }
    if (keywords.has(token.text)) {
      token.type = "keyword";
      return;
    }
    if (literals.has(token.text)) {
      token.type = "literal";
      return;
    }
    const following = tokens.slice(tokenIndex + 1).find(function (candidate) {
      return candidate.text.trim() !== "";
    });
    token.type = following && following.text === "(" ? "function" : "";
  });
  return tokens;
}

function kcdAppendHighlightedSource(element, source, language, state) {
  const fragment = document.createDocumentFragment();
  kcdScanLine(source, language, state).forEach(function (token) {
    if (!token.type) {
      fragment.append(document.createTextNode(token.text));
      return;
    }
    const span = document.createElement("span");
    span.className = "kcd-token kcd-token-" + token.type;
    span.textContent = token.text;
    fragment.append(span);
  });
  element.append(fragment);
}

function kcdAppendFilePath(element, path, language) {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const directory = path.slice(0, separator + 1);
  const filename = path.slice(separator + 1);
  if (directory) {
    const directoryElement = kitEl("span", "kcd-file-directory");
    directoryElement.textContent = directory;
    element.append(directoryElement);
  }
  const filenameElement = kitEl("span", "kcd-file-name");
  filenameElement.textContent = filename;
  element.append(filenameElement);
  if (filename) {
    const dot = kitEl("i", "kcd-file-extension");
    dot.dataset.language = language || "plain";
    dot.setAttribute("aria-hidden", "true");
    element.append(dot);
  }
}

function renderCode(sel, data) {
  const host = kitMount(sel);
  if (!data.__kitAdjusted) {
    const adjustment = globalThis.ExplainerKit.registerAdjustments(host, {
      base: data,
      label: data.ariaLabel || "Annotated code",
      defaults: {
        layout: data.layout || "side-by-side",
        lines: data.lines || "all",
        typeScale: data.typeScale || "standard",
      },
      options: [
        {
          key: "layout",
          label: "Layout",
          type: "choice",
          choices: ["side-by-side", "stacked"],
          choiceLabels: { "side-by-side": "Side by side", stacked: "Stacked" },
        },
        {
          key: "lines",
          label: "Lines",
          type: "choice",
          choices: ["changes", "all"],
          choiceLabels: { changes: "Changes only", all: "All lines" },
        },
        {
          key: "typeScale",
          label: "Text size",
          type: "choice",
          choices: ["standard", "large"],
          choiceLabels: { standard: "Normal", large: "Large" },
        },
      ],
      apply(state) {
        const at = host.__kitPresentDriver ? host.__kitPresentDriver.current() : 0;
        const driver = renderCode(host, {
          ...kcdAdjustedData(host.__kitAdjustments.base, state),
          __kitAdjusted: true,
        });
        driver.go(at);
        return driver;
      },
    });
    data = kcdAdjustedData(adjustment.base, adjustment.state);
  }
  kitValidateTextCaps(host, "renderCode", data);
  const mode = data.mode || "diff";
  if (mode !== "diff") {
    throw new Error('renderCode: mode must be "diff"');
  }
  const before = data.before || {};
  const after = data.after || {};
  const walkthrough = data.walkthrough || [];
  if (!Array.isArray(before.lines) || !Array.isArray(after.lines)) {
    throw new TypeError("renderCode(diff): before.lines and after.lines are required");
  }
  if (
    before.lines.length < 1 ||
    after.lines.length < 1 ||
    before.lines.length > 10 ||
    after.lines.length > 10
  ) {
    throw new Error("renderCode(diff): each pane supports 1-10 lines");
  }
  if (walkthrough.length > 6) {
    throw new Error("renderCode(diff): walkthrough supports at most 6 steps");
  }
  // author-supplied ids key these maps, so a line called "toString" must not
  // arrive already truthy off the prototype
  const lineById = Object.create(null);
  function normalize(pane, side) {
    return pane.lines.map(function (line, index) {
      const value = typeof line === "string" ? { text: line } : line;
      const id = value.id || side + "-" + (index + 1);
      if (lineById[id]) {
        throw new Error('renderCode(diff): line id "' + id + '" is not unique');
      }
      const kind = value.kind || "context";
      if (!["context", "added", "removed", "changed"].includes(kind)) {
        throw new Error('renderCode(diff): line "' + id + '" has an unknown kind');
      }
      const normalized = {
        ...value,
        id,
        kind,
        number: value.number == null ? index + 1 : value.number,
        side,
      };
      lineById[id] = normalized;
      return normalized;
    });
  }
  const panes = [
    {
      side: "before",
      label: before.label || "before",
      file: before.file || "",
      lines: normalize(before, "before"),
    },
    {
      side: "after",
      label: after.label || "after",
      file: after.file || "",
      lines: normalize(after, "after"),
    },
  ];
  walkthrough.forEach(function (step, index) {
    (step.lines || []).forEach(function (id) {
      if (!lineById[id]) {
        throw new Error(
          "renderCode(diff): walkthrough step " +
            (index + 1) +
            ' references unknown line "' +
            id +
            '"',
        );
      }
    });
  });

  host.classList.add("kcd", "kcd-diff");
  host.__kitBase = { kind: "code", mode };
  host.dataset.layout = data.layout || "side-by-side";
  host.dataset.typeScale = data.typeScale || "standard";
  const grid = kitEl("div", "kcd-grid");
  const lineEls = Object.create(null);
  panes.forEach(function (pane) {
    const language = kcdLanguageForFile(pane.file);
    const syntaxState = { blockComment: false, string: "" };
    const panel = kitEl("section", "kcd-pane kcd-" + pane.side);
    panel.setAttribute("aria-label", pane.label + (pane.file ? ": " + pane.file : ""));
    const head = kitEl("header", "kcd-head");
    const label = kitEl("span", "kcd-label");
    label.textContent = pane.label;
    const file = kitEl("code", "kcd-file");
    kcdAppendFilePath(file, pane.file, language);
    head.append(label, file);
    panel.append(head);
    const code = kitEl("div", "kcd-lines");
    pane.lines.forEach(function (line) {
      const row = kitEl("div", "kcd-line kcd-line-" + line.kind);
      row.dataset.line = line.id;
      const sign = kitEl("span", "kcd-sign");
      sign.textContent =
        line.kind === "added"
          ? "+"
          : line.kind === "removed"
            ? "−"
            : line.kind === "changed"
              ? "~"
              : " ";
      const number = kitEl("span", "kcd-line-no");
      number.textContent = line.number;
      const text = kitEl("code", "kcd-source");
      kcdAppendHighlightedSource(
        text,
        line.text == null ? "" : String(line.text),
        language,
        syntaxState,
      );
      row.append(sign, number, text);
      code.append(row);
      lineEls[line.id] = row;
    });
    panel.append(code);
    grid.append(panel);
  });
  host.append(grid);

  const states = [
    {
      title: (data.overview || {}).title || "Read the change →",
      note:
        (data.overview || {}).note ||
        "The full before and after stay visible while each step marks the evidence.",
    },
  ];
  walkthrough.forEach(function (step) {
    states.push({ title: step.title, note: step.note || "", step });
  });
  if (data.completion) {
    states.push({
      title: data.completion.title || "Complete",
      note: data.completion.note || "",
      completion: true,
    });
  }
  const walk = kitEl("div", "kcd-walk");
  const dots = kitEl("div", "kcd-dots");
  const annotation = kitEl("div", "kcd-annotation");
  const title = kitEl("strong");
  const note = kitEl("p");
  annotation.append(title, note);
  annotation.setAttribute("aria-live", "polite");
  walk.append(dots, annotation);
  const dotEls = states.map(function (_state, index) {
    const dot = kitEl("button", "kcd-dot");
    dot.type = "button";
    dot.setAttribute("aria-label", index === 0 ? "Show complete diff" : "Show diff step " + index);
    dot.addEventListener("click", () => go(index));
    dots.append(dot);
    return dot;
  });
  host.append(walk);
  let current = 0;
  function go(index) {
    current = Math.max(0, Math.min(states.length - 1, index));
    const state = states[current];
    const focus = new Set((state.step && state.step.lines) || []);
    const active = focus.size > 0;
    Object.keys(lineEls).forEach(function (id) {
      lineEls[id].classList.toggle("kcd-dim", active && !focus.has(id));
      lineEls[id].classList.toggle("kcd-focus", active && focus.has(id));
    });
    dotEls.forEach(function (dot, dotIndex) {
      dot.classList.toggle("current", dotIndex === current);
      dot.classList.toggle("done", dotIndex < current);
    });
    title.textContent = state.title;
    note.textContent = state.note;
  }
  go(0);
  return globalThis.ExplainerKit.stableDriver(host, {
    count: states.length,
    current: () => current,
    go,
  });
}
