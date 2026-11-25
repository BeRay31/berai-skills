/* ExplainerComponentEditor is Studio's bounded, deterministic editor for
   component data. It intentionally edits the same JSON-shaped data for every
   curated component instead of maintaining one bespoke form per renderer.

   Public API:
   - describe(visual) -> {visual, kind, data} from the curated sample catalog.
   - canEdit(component) -> whether the component has editable JSON data.
   - validate(component) -> {valid, errors}; never mutates its argument.
   - mount({container, component, onChange, toast, skipPath}) -> {destroy,
     component, setComponent}. onChange receives a safe cloned component and
     validation.
   - cloneForInsert(value, rootData) -> a safe copy with rebased ids and
     rewritten internal references, ready to splice into a collection.
   - canRemoveItem(item, rootData) -> false when another field still refers to
     the item's id.
   - move(list, from, to) -> reorder one collection entry in place.
   - itemSummary(value, index) -> the one-line name a collapsed row shows.
   - maxItems -> the per-collection cap shared by every mount point.

   Studio's Visual panel stopped mounting this editor for lens-covered
   components (B2.5): their text edits in place on the slide, and the panel
   renders its own compact collection rows through the exported helpers
   above. Non-covered components keep the full form. skipPath(path, value)
   remains the documented mount seam for any caller that still wants a
   covered field demoted instead of the whole form replaced: a skipped
   primitive is simply not rendered; a skipped array is a collection whose
   items are fully covered, so it collapses to a summary line
   ("4 items — edit on the slide") while keeping its
   Add/Duplicate/Move/Remove controls reachable.

   The editor is deliberately not a JSON textarea. Objects expose their
   primitive leaves, arrays expose clone/add/remove/reorder controls, and
   unknown keys remain untouched. Rendering is bounded so an accidental large
   captured payload cannot turn the Studio inspector into an unresponsive
   document. */
(function installExplainerComponentEditor(root) {
  const MAX_DEPTH = 6;
  const MAX_ITEMS = 24;
  const MAX_NODES = 320;
  const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);
  const ID_KEYS = new Set(["id", "uid"]);
  const REFERENCE_KEYS = new Set([
    "from",
    "to",
    "parent",
    "ref",
    "refs",
    "group",
    "groups",
    "node",
    "nodes",
    "edge",
    "edges",
    "frame",
    "frames",
    "lane",
    "lanes",
    "actor",
    "actors",
    "fire",
    "caller",
    "callers",
    "spans",
    "series",
    "dependson",
    "dependencies",
    "items",
  ]);

  function isIdentityKey(key) {
    return ID_KEYS.has(String(key).toLowerCase());
  }

  function isReferenceKey(key) {
    const normalized = String(key).toLowerCase();
    return REFERENCE_KEYS.has(normalized);
  }

  function isPrimitive(value) {
    return value == null || ["string", "number", "boolean"].includes(typeof value);
  }

  function isPlainObject(value) {
    return Boolean(value) && Object.getPrototypeOf(value) === Object.prototype;
  }

  function copy(value, depth, state) {
    depth ||= 0;
    state ||= { nodes: 0 };
    state.nodes += 1;
    if (depth > 64 || state.nodes > 20_000) {
      throw new TypeError("Component data is too large or deeply nested to edit safely.");
    }
    if (isPrimitive(value)) {
      if (typeof value === "number" && !Number.isFinite(value)) {
        throw new TypeError("Component numbers must be finite.");
      }
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((child) => copy(child, depth + 1, state));
    }
    if (!isPlainObject(value)) {
      throw new TypeError("Component editor accepts plain JSON data only");
    }
    const result = {};
    Object.entries(value).forEach(function ([key, child]) {
      if (!BLOCKED_KEYS.has(key)) {
        result[key] = copy(child, depth + 1, state);
      }
    });
    return result;
  }

  function cloneComponent(component) {
    if (!component || typeof component !== "object") {
      throw new TypeError("Component editor needs {visual, kind, data}");
    }
    return {
      ...copy(component),
      visual: String(component.visual || ""),
      kind: String(component.kind || ""),
      data: copy(component.data == null ? {} : component.data),
    };
  }

  function create(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text != null) {
      node.textContent = String(text);
    }
    return node;
  }

  function button(label, className, action) {
    const node = create("button", className, label);
    node.type = "button";
    node.addEventListener("click", action);
    return node;
  }

  function humanize(value) {
    return String(value)
      .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replaceAll(/[-_]+/g, " ")
      .replaceAll(/\s+/g, " ")
      .trim()
      .replace(/^./, function (character) {
        return character.toUpperCase();
      });
  }

  function setAt(object, path, value) {
    if (!path.length) {
      return;
    }
    let target = object;
    path.slice(0, -1).forEach(function (key) {
      if (
        !target ||
        typeof target !== "object" ||
        !target[key] ||
        typeof target[key] !== "object"
      ) {
        throw new TypeError("That component field is no longer editable.");
      }
      target = target[key];
    });
    target[path.at(-1)] = value;
  }

  function primitiveType(value) {
    if (value === null) {
      return "null";
    }
    return typeof value;
  }

  function itemSummary(value, index) {
    if (isPrimitive(value)) {
      if (value === null || value === "") {
        return "Item " + (index + 1);
      }
      const text = String(value);
      return text.length > 42 ? text.slice(0, 39) + "…" : text;
    }
    const preferred = ["title", "label", "name", "text", "id"];
    for (const key of preferred) {
      const candidate = value[key];
      if (isPrimitive(candidate) && String(candidate || "").trim()) {
        const text = String(candidate);
        return text.length > 42 ? text.slice(0, 39) + "…" : text;
      }
    }
    return "Item " + (index + 1);
  }

  function collectIds(value, ids) {
    if (Array.isArray(value)) {
      value.forEach(function (item) {
        collectIds(item, ids);
      });
      return;
    }
    if (!isPlainObject(value)) {
      return;
    }
    Object.entries(value).forEach(function ([key, child]) {
      if (isIdentityKey(key) && isPrimitive(child) && child != null) {
        if (!ids.has(key)) {
          ids.set(key, new Set());
        }
        ids.get(key).add(String(child));
      }
      collectIds(child, ids);
    });
  }

  function nextId(value, key, used) {
    const base = value == null || value === "" ? key : String(value);
    if (typeof value === "number") {
      let candidate = Number(value) + 1;
      if (!Number.isSafeInteger(candidate)) {
        throw new TypeError("Numeric IDs must be safe integers to duplicate.");
      }
      while (used.has(String(candidate))) {
        candidate += 1;
        if (!Number.isSafeInteger(candidate)) {
          throw new TypeError("No safe numeric ID is available for this duplicate.");
        }
      }
      used.add(String(candidate));
      return candidate;
    }
    let candidate = base + "-copy";
    let index = 2;
    while (used.has(candidate)) {
      candidate = base + "-copy-" + index;
      index += 1;
    }
    used.add(candidate);
    return candidate;
  }

  function cloneForInsert(value, rootData) {
    const result = copy(value);
    const siblingIds = new Map();
    const replacements = new Map();
    collectIds(rootData, siblingIds);
    rebaseIds(result, siblingIds, replacements);
    rewriteReferences(result, replacements);
    return result;
  }

  function rebaseIds(value, siblingIds, replacements) {
    if (Array.isArray(value)) {
      value.forEach(function (item) {
        rebaseIds(item, siblingIds, replacements);
      });
      return;
    }
    if (!isPlainObject(value)) {
      return;
    }
    Object.entries(value).forEach(function ([key, child]) {
      if (isIdentityKey(key) && isPrimitive(child) && child != null) {
        const used = siblingIds.get(key) || new Set();
        const next = nextId(child, key, used);
        value[key] = next;
        siblingIds.set(key, used);
        const oldValue = String(child);
        if (!replacements.has(oldValue)) {
          replacements.set(oldValue, new Set());
        }
        replacements.get(oldValue).add(next);
      }
      rebaseIds(child, siblingIds, replacements);
    });
  }

  function rewriteReferences(value, replacements, key = "") {
    if (isPrimitive(value)) {
      const replacement = isReferenceKey(key) && replacements.get(String(value));
      return replacement && replacement.size === 1 ? replacement.values().next().value : value;
    }
    if (Array.isArray(value)) {
      value.forEach(function (item, index) {
        value[index] = rewriteReferences(item, replacements, key);
      });
      return value;
    }
    if (!isPlainObject(value)) {
      return value;
    }
    Object.entries(value).forEach(function ([childKey, child]) {
      if (!isIdentityKey(childKey)) {
        value[childKey] = rewriteReferences(child, replacements, childKey);
      }
    });
    return value;
  }

  function move(list, from, to) {
    if (to < 0 || to >= list.length || from === to) {
      return false;
    }
    const item = list.splice(from, 1)[0];
    list.splice(to, 0, item);
    return true;
  }

  function identityValues(value, result) {
    if (Array.isArray(value)) {
      value.forEach(function (item) {
        identityValues(item, result);
      });
      return;
    }
    if (!isPlainObject(value)) {
      return;
    }
    Object.entries(value).forEach(function ([key, child]) {
      if (isIdentityKey(key) && isPrimitive(child) && child != null) {
        result.add(String(child));
      }
      identityValues(child, result);
    });
  }

  function hasExternalReference(value, excluded, ids, key = "") {
    if (value === excluded) {
      return false;
    }
    if (isPrimitive(value)) {
      return isReferenceKey(key) && ids.has(String(value));
    }
    if (Array.isArray(value)) {
      return value.some(function (item) {
        return hasExternalReference(item, excluded, ids, key);
      });
    }
    if (!isPlainObject(value)) {
      return false;
    }
    return Object.entries(value).some(function ([childKey, child]) {
      return !isIdentityKey(childKey) && hasExternalReference(child, excluded, ids, childKey);
    });
  }

  function canRemoveItem(item, rootData) {
    const ids = new Set();
    identityValues(item, ids);
    return !ids.size || !hasExternalReference(rootData, item, ids);
  }

  function validationFor(component) {
    const errors = [];
    function inspect(value) {
      if (Array.isArray(value)) {
        value.forEach(inspect);
      } else if (isPlainObject(value)) {
        Object.entries(value).forEach(function ([key, child]) {
          if (!BLOCKED_KEYS.has(key)) {
            inspect(child);
          }
        });
      } else if (!isPrimitive(value)) {
        errors.push("Component data must contain only JSON values.");
      }
    }
    try {
      const safe = cloneComponent(component);
      inspect(safe.data);
    } catch (error) {
      errors.push(error.message);
    }
    return { valid: errors.length === 0, errors };
  }

  function validate(component) {
    return validationFor(component);
  }

  function canEdit(component) {
    try {
      return validationFor(component).valid;
    } catch {
      return false;
    }
  }

  function controlFor(value, path, target, commit) {
    const type = primitiveType(value);
    if (type === "boolean") {
      const control = create("input", "ece-check");
      control.type = "checkbox";
      control.checked = value;
      control.addEventListener("change", function () {
        commit(function () {
          setAt(target, path, control.checked);
        });
      });
      return control;
    }
    if (type === "number") {
      const control = create("input", "ece-control");
      control.type = "number";
      control.step = "any";
      control.value = String(value);
      control.addEventListener("change", function () {
        if (!control.validity.valid || control.value === "") {
          control.value = String(value);
          return;
        }
        const next = Number(control.value);
        if (!Number.isFinite(next)) {
          control.value = String(value);
          return;
        }
        commit(function () {
          setAt(target, path, next);
        });
      });
      return control;
    }
    if (type === "null") {
      const control = create("select", "ece-control");
      [
        ["null", "None"],
        ["string", "Text"],
        ["number", "Number"],
        ["boolean", "True / false"],
      ].forEach(function ([optionValue, label]) {
        const option = create("option", "", label);
        option.value = optionValue;
        control.append(option);
      });
      control.addEventListener("change", function () {
        const next =
          control.value === "string"
            ? ""
            : control.value === "number"
              ? 0
              : control.value === "boolean"
                ? false
                : null;
        commit(function () {
          setAt(target, path, next);
        }, true);
      });
      return control;
    }
    const control = create("textarea", "ece-control");
    const text = String(value);
    control.rows = text.includes("\n") || text.length > 120 ? 3 : 1;
    control.value = text;
    control.addEventListener("change", function () {
      commit(function () {
        setAt(target, path, control.value);
      });
    });
    return control;
  }

  function renderPrimitive(container, label, value, path, target, commit) {
    const field = create("label", "ece-field");
    field.append(create("span", "ece-label", label));
    field.append(controlFor(value, path, target, commit));
    container.append(field);
  }

  function renderValue(container, label, value, path, context) {
    const { target, commit, toast, depth, state, skipPath } = context;
    if (state.nodes >= MAX_NODES) {
      container.append(
        create("p", "ece-muted", "More fields are hidden to keep the editor responsive."),
      );
      return;
    }
    state.nodes += 1;
    if (isPrimitive(value)) {
      if (skipPath && skipPath(path, value)) {
        return; // inline editing owns this field on the slide.
      }
      renderPrimitive(container, label, value, path, target, commit);
      return;
    }
    if (depth >= MAX_DEPTH) {
      container.append(create("p", "ece-muted", label + " has deeper data hidden."));
      return;
    }
    if (Array.isArray(value)) {
      renderArray(container, label, value, path, context);
      return;
    }
    if (isPlainObject(value)) {
      renderObject(container, label, value, path, context);
      return;
    }
    toast("Some component data could not be shown.");
  }

  function renderObject(container, label, value, path, context) {
    const section = create("fieldset", "ece-object");
    if (path.length) {
      section.append(create("legend", "", label));
    } else {
      section.classList.add("ece-root-object");
      section.append(create("h4", "ece-title", label));
    }
    const entries = Object.entries(value).filter(function ([key]) {
      return !BLOCKED_KEYS.has(key);
    });
    let rendered = 0;
    let skipped = 0;
    for (const [key, child] of entries) {
      if (context.skipPath && isPrimitive(child) && context.skipPath(path.concat(key), child)) {
        skipped += 1; // inline editing owns this field on the slide.
        continue;
      }
      renderValue(section, humanize(key), child, path.concat(key), {
        ...context,
        depth: context.depth + 1,
      });
      rendered += 1;
      if (context.state.nodes >= MAX_NODES) {
        break;
      }
    }
    if (!rendered) {
      section.append(
        create(
          "p",
          "ece-empty",
          skipped
            ? "This item's text is edited on the slide; only its other fields appear here."
            : "No editable fields yet.",
        ),
      );
    }
    container.append(section);
  }

  /* The per-item action row: Duplicate / Move up / Move down / Remove. Both
     the expanded per-item details and a collapsed covered collection keep
     these reachable, so covered items can still be reordered from the panel
     while their text moves to the slide. */
  function itemActions(value, itemValue, index, label, context) {
    const { commit, toast, rootData } = context;
    const actions = create("div", "ece-actions");
    const duplicate = button("Duplicate", "ece-icon", function () {
      if (value.length >= MAX_ITEMS) {
        toast(label + " is limited to " + MAX_ITEMS + " items in Studio.");
        return;
      }
      commit(function () {
        value.splice(index + 1, 0, cloneForInsert(itemValue, rootData));
      }, true);
    });
    const up = button("Move up", "ece-icon", function () {
      if (index > 0) {
        commit(function () {
          move(value, index, index - 1);
        }, true);
      }
    });
    up.disabled = index === 0;
    const down = button("Move down", "ece-icon", function () {
      if (index < value.length - 1) {
        commit(function () {
          move(value, index, index + 1);
        }, true);
      }
    });
    down.disabled = index === value.length - 1;
    const remove = button("Remove", "ece-icon ece-danger", function () {
      if (!canRemoveItem(itemValue, rootData)) {
        toast("This item is kept because another field refers to its id.");
        return;
      }
      commit(function () {
        value.splice(index, 1);
      }, true);
    });
    remove.disabled = !canRemoveItem(itemValue, rootData);
    remove.title = remove.disabled ? "Another field refers to this item's id" : "Remove this item";
    actions.append(duplicate, up, down, remove);
    return actions;
  }

  function renderArray(container, label, value, path, context) {
    const { commit, toast, rootData, templates, expanded, skipPath } = context;
    // A collection skipPath() covers is one whose items are fully editable on
    // the slide: it collapses to a summary line instead of expanding per-item
    // fields, while every item keeps its Duplicate/Move/Remove controls.
    const covered = Boolean(skipPath && skipPath(path, value));
    const templateKey = JSON.stringify(path);
    if (value.length) {
      templates.set(templateKey, copy(value.at(-1)));
    }
    const section = create("details", "ece-list");
    const sectionKey = "list:" + templateKey;
    section.open = expanded.has(sectionKey);
    section.addEventListener("toggle", function () {
      if (section.open) {
        expanded.add(sectionKey);
      } else {
        expanded.delete(sectionKey);
      }
    });
    const heading = create("summary", "ece-list-heading");
    heading.append(create("h4", "", label + " (" + value.length + ")"));
    section.append(heading);
    const toolbar = create("div", "ece-list-toolbar");
    const add = button("Add item", "ece-button", function () {
      if (value.length >= MAX_ITEMS) {
        toast(label + " is limited to " + MAX_ITEMS + " items in Studio.");
        return;
      }
      if (!templates.has(templateKey)) {
        toast("Ask the agent to create the first item so this collection has a typed template.");
        return;
      }
      const template = value.length ? value.at(-1) : templates.get(templateKey);
      commit(function () {
        value.push(cloneForInsert(template, rootData));
      }, true);
    });
    add.disabled = value.length >= MAX_ITEMS || !templates.has(templateKey);
    add.title = templates.has(templateKey)
      ? "Clone an existing item, then edit its fields"
      : "Ask the agent to create the first item for this empty collection";
    toolbar.append(add);
    section.append(toolbar);
    if (!value.length) {
      section.append(
        create(
          "p",
          "ece-empty",
          templates.has(templateKey)
            ? "Add clones the last item's fields so you can rebuild this collection."
            : "No item template yet. Ask the agent to create the first item; then you can add and edit more locally.",
        ),
      );
    } else if (covered) {
      section.append(
        create(
          "p",
          "ece-empty",
          value.length +
            (value.length === 1 ? " item — edit on the slide" : " items — edit on the slide"),
        ),
      );
    }
    value.slice(0, MAX_ITEMS).forEach(function (itemValue, index) {
      if (covered) {
        const row = create("div", "ece-compact-item");
        const head = create("div", "ece-compact-head");
        head.append(create("span", "ece-compact-name", itemSummary(itemValue, index)));
        row.append(head);
        row.append(itemActions(value, itemValue, index, label, context));
        section.append(row);
        return;
      }
      const item = create("details", "ece-list-item");
      const itemKey = "item:" + JSON.stringify(path.concat(index));
      item.open = expanded.has(itemKey);
      item.addEventListener("toggle", function () {
        if (item.open) {
          expanded.add(itemKey);
        } else {
          expanded.delete(itemKey);
        }
      });
      item.append(create("summary", "", itemSummary(itemValue, index)));
      item.append(itemActions(value, itemValue, index, label, context));
      renderValue(item, "Details", itemValue, path.concat(index), {
        ...context,
        depth: context.depth + 1,
      });
      section.append(item);
    });
    if (value.length > MAX_ITEMS) {
      section.append(
        create(
          "p",
          "ece-muted",
          "Showing the first " + MAX_ITEMS + " items; remaining data is preserved.",
        ),
      );
    }
    container.append(section);
  }

  function describe(visual) {
    const samples = root.ExplainerKit && root.ExplainerKit.studioSamples;
    if (!samples || typeof samples.describe !== "function") {
      throw new Error("Studio samples must load before the component editor.");
    }
    return samples.describe(visual);
  }

  /* Expansion state outlives a mount: every valid edit remounts the editor
     (renderPanel rebuilds it), so open sections must persist here or
     collapse after each edit. Both mounts share the state on purpose —
     they edit the same component's collections. */
  const expanded = new Set();

  function mount(options) {
    if (!options || !options.container || typeof options.container.replaceChildren !== "function") {
      throw new TypeError("Component editor mount needs a container element.");
    }
    let component = cloneComponent(options.component);
    const toast = typeof options.toast === "function" ? options.toast : function () {};
    const onChange = typeof options.onChange === "function" ? options.onChange : function () {};
    const skipPath = typeof options.skipPath === "function" ? options.skipPath : null;
    let disposed = false;
    let status = null;
    const templates = options.templates instanceof Map ? options.templates : new Map();

    function commit(mutator, rerenderAfter) {
      if (disposed) {
        return;
      }
      const previous = cloneComponent(component);
      try {
        mutator();
        const validation = validate(component);
        if (status) {
          status.textContent = validation.valid ? "Ready to save" : validation.errors[0];
          status.classList.toggle("ece-invalid", !validation.valid);
        }
        onChange(cloneComponent(component), validation);
        if (rerenderAfter) {
          render();
        }
      } catch (error) {
        component = previous;
        toast("Change was not applied: " + error.message);
        render();
      }
    }

    function render() {
      if (disposed) {
        return;
      }
      const form = create("form", "ece-editor");
      form.noValidate = true;
      form.addEventListener("submit", function (event) {
        event.preventDefault();
      });
      form.append(
        create("h3", "ece-title", humanize(component.visual || component.kind || "Component")),
      );
      const validation = validate(component);
      status = create("p", validation.valid ? "ece-status" : "ece-status ece-invalid");
      status.textContent = validation.valid ? "Ready to save" : validation.errors[0];
      form.append(status);
      renderValue(form, "Content", component.data, [], {
        target: component.data,
        commit,
        toast,
        rootData: component.data,
        templates,
        expanded,
        skipPath,
        depth: 0,
        state: { nodes: 0 },
      });
      options.container.replaceChildren(form);
    }

    render();
    return {
      destroy() {
        disposed = true;
        options.container.replaceChildren();
      },
      get component() {
        return cloneComponent(component);
      },
      setComponent(next) {
        component = cloneComponent(next);
        render();
      },
    };
  }

  root.ExplainerComponentEditor = {
    mount,
    canEdit,
    validate,
    describe,
    // The collection helpers Studio's Visual panel reuses for covered
    // components (see the header): their rows commit through the same
    // clone → mutate → validate → update/rollback sequence as the form.
    cloneForInsert,
    canRemoveItem,
    move,
    itemSummary,
    maxItems: MAX_ITEMS,
  };
})(globalThis);
