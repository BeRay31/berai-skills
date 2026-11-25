(function () {
  "use strict";
  const kit = globalThis.ExplainerKit || {};
  globalThis.ExplainerKit = kit;
  const factories = new Map();

  /**
   * Register a trusted, component-owned canvas editor. Loaded only by Studio.
   * A factory receives a host and returns null when it does not own that host.
   * Factories and adapters must not modify the host during discovery.
   *
   * Studio owns selection, bounded undo/redo, persistence and session lifetime.
   * Adapters own editable targets, fields, commands, constraints, gap semantics,
   * DOM decoration and coordinate conversion. Studio never inspects their data.
   *
   * @param {string} kind Stable editor identity, also used by the trusted server codec.
   * @param {(host: HTMLElement) => Object|null} factory Produces an adapter with:
   * - version: positive integer identifying the serialized record contract.
   * - availability(): null when editable, otherwise a user-facing reason.
   * - snapshot()/authoredSnapshot(): detached, JSON-serializable full records.
   * - historyKey(): stable layout or component scope, independent of DOM instances.
   * - validate(record): throw before any mutation for an invalid record.
   * - apply(record, {history}): validate and atomically render. With history=true,
   *   restore only historyKey()'s scope, retaining edits in unrelated layouts.
   * - describeChanges(record): concise plain text for Review, never HTML.
   * - help/resetLabel: optional editing guidance and scoped reset action label.
   * - createSession(context): return {refresh, renderInspector, dispose}.
   *
   * A session uses context.host, selection()/select(value), commit(record),
   * preview(record), snapshot(), button(label, action, disabled), element(tag,
   * className, text), dialog(label), refreshInspector(), and toast(message).
   * dialog returns a Studio-themed dialog shell; the adapter owns its placement,
   * focus and disposal. Only commit records history and saves. preview is transient
   * and must be cancelled on dispose.
   * Selection is editor-owned serializable UI state, never part of saved data.
   * refresh reacquires DOM targets after renders using stable authored IDs.
   * dispose is idempotent and removes all injected DOM/listeners, releases pointer
   * capture, and restores original attributes. No listeners survive the session.
   *
   * Adoption: add components/<kind>.editor.js and .editor.css, and a trusted
   * components/<kind_with_underscores>_editor.py codec. Review's CANVAS_EDIT_CODECS
   * allowlist is also Studio's asset manifest. Review advertises supported record
   * versions through the server boot capabilities; browser registration alone
   * never grants permission to save arbitrary data or execute a schema.
   * Existing geometry records remain version 1; no migration is implied by this API.
   */
  kit.registerCanvasEditor = function registerCanvasEditor(kind, factory) {
    if (typeof kind !== "string" || !kind || typeof factory !== "function") {
      throw new Error("Canvas editor registration needs a kind and factory");
    }
    factories.set(kind, factory);
  };
  kit.canvasEditor = function canvasEditor(host) {
    if (!host) {
      return null;
    }
    for (const [kind, factory] of factories) {
      const adapter = factory(host);
      if (adapter) {
        const methods = [
          "availability",
          "snapshot",
          "authoredSnapshot",
          "historyKey",
          "validate",
          "apply",
          "describeChanges",
          "createSession",
        ];
        if (
          !Number.isInteger(adapter.version) ||
          adapter.version < 1 ||
          methods.some((name) => typeof adapter[name] !== "function")
        ) {
          throw new Error("Invalid canvas editor contract: " + kind);
        }
        return { ...adapter, kind };
      }
    }
    return null;
  };
  kit.createCanvasEditing = function createCanvasEditing({
    store,
    renderPanel,
    toast,
    prepare,
    notify,
  }) {
    const history = new WeakMap();
    let active = null;
    function element(tag, className, text) {
      const node = document.createElement(tag);
      if (className) {
        node.className = className;
      }
      if (text != null) {
        node.textContent = text;
      }
      return node;
    }
    function dialog(label) {
      const node = element("div", "st-canvas-popover");
      node.setAttribute("role", "dialog");
      node.setAttribute("aria-label", label);
      node.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") {
          event.stopPropagation();
        }
      });
      return node;
    }
    function button(label, action, disabled = false) {
      const node = element("button", "st-editor-button", label);
      node.type = "button";
      node.disabled = disabled;
      node.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        action();
      });
      return node;
    }
    function historyFor(host, adapter) {
      let scopes = history.get(host);
      if (!scopes) {
        scopes = new Map();
        history.set(host, scopes);
      }
      const key = adapter.kind + ":" + adapter.version + ":" + adapter.historyKey();
      if (!scopes.has(key)) {
        scopes.set(key, { undo: [], redo: [] });
      }
      return scopes.get(key);
    }
    function persist(host, adapter) {
      const result = store.setCanvasEdits(host.id, adapter.snapshot(), adapter.authoredSnapshot());
      notify(host);
      return result;
    }
    function commit(host, adapter, record, options = {}) {
      const before = adapter.snapshot();
      try {
        adapter.validate(record);
        adapter.apply(structuredClone(record), options);
        const after = adapter.snapshot();
        if (JSON.stringify(before) === JSON.stringify(after)) {
          return true;
        }
        const scope = historyFor(host, adapter);
        scope.undo.push(before);
        if (scope.undo.length > 40) {
          scope.undo.shift();
        }
        scope.redo = [];
        persist(host, adapter);
        if (active && active.host === host) {
          active.selection = null;
          active.session.refresh();
        }
        renderPanel();
        return true;
      } catch (error) {
        toast(error.message || "Could not apply this edit", true);
        return false;
      }
    }
    function undo(host, adapter, redo = false) {
      const scope = historyFor(host, adapter);
      const source = redo ? scope.redo : scope.undo;
      const target = redo ? scope.undo : scope.redo;
      if (!source.length) {
        return;
      }
      const before = adapter.snapshot();
      const previous = source.at(-1);
      try {
        adapter.validate(previous);
        adapter.apply(structuredClone(previous), { history: true });
        source.pop();
        target.push(before);
        persist(host, adapter);
        refresh(host);
        renderPanel();
      } catch (error) {
        toast(error.message || "Could not restore this edit", true);
      }
    }
    function stop() {
      const previous = active;
      active = null;
      if (previous && previous.session) {
        previous.session.dispose();
      }
    }
    function refresh(host) {
      if (!active || active.host !== host) {
        return;
      }
      const current = kit.canvasEditor(host);
      if (
        !current ||
        current.kind !== active.adapter.kind ||
        current.version !== active.adapter.version ||
        current.availability()
      ) {
        stop();
        return;
      }
      const scope = active.adapter.historyKey();
      if (scope !== active.scope) {
        active.selection = null;
        active.scope = scope;
      }
      active.session.refresh();
    }
    function start(host, adapter) {
      stop();
      if (adapter.availability() || (prepare && !prepare())) {
        return;
      }
      const session = {
        host,
        adapter,
        scope: adapter.historyKey(),
        selection: null,
        session: null,
      };
      active = session;
      const context = {
        host,
        element,
        button,
        dialog,
        toast,
        snapshot: () => adapter.snapshot(),
        selection: () => session.selection,
        select(value) {
          session.selection = value;
          renderPanel();
        },
        refreshInspector: renderPanel,
        commit: (record) => commit(host, adapter, record),
        preview(record) {
          adapter.validate(record);
          adapter.apply(record, { preview: true });
        },
        stop() {
          stop();
          renderPanel();
        },
      };
      try {
        session.session = adapter.createSession(context);
        session.session.refresh();
      } catch (error) {
        if (session.session) {
          session.session.dispose();
        }
        active = null;
        toast(error.message || "Could not start canvas editing", true);
      }
    }
    function controls(host) {
      const adapter = kit.canvasEditor(host);
      if (!adapter || !host.id || !store) {
        return null;
      }
      const current = active && active.host === host;
      const reason = adapter.availability();
      const box = element("div", "st-canvas-controls");
      const toggle = button(
        current ? "Done editing" : "Edit component",
        () => {
          if (current) {
            stop();
          } else {
            start(host, adapter);
          }
          renderPanel();
        },
        Boolean(reason),
      );
      toggle.title = "Edit this component directly on the slide";
      toggle.classList.add("st-canvas-toggle");
      toggle.setAttribute("aria-pressed", String(Boolean(current)));
      box.append(
        toggle,
        element(
          "p",
          "st-control-help",
          reason || adapter.help || "Select an editable target on the canvas.",
        ),
      );
      if (!reason) {
        const scope = historyFor(host, adapter);
        const actions = element("div", "st-canvas-actions");
        actions.append(
          button("Undo", () => undo(host, adapter), !scope.undo.length),
          button("Redo", () => undo(host, adapter, true), !scope.redo.length),
          button(adapter.resetLabel || "Reset edits", () =>
            commit(host, adapter, adapter.authoredSnapshot(), { history: true }),
          ),
        );
        box.append(actions);
      }
      if (current) {
        const inspector = active.session.renderInspector();
        if (inspector) {
          box.append(inspector);
        }
      }
      return box;
    }
    function restore(host, record) {
      const adapter = kit.canvasEditor(host);
      if (!adapter) {
        return false;
      }
      try {
        adapter.validate(record);
        adapter.apply(structuredClone(record));
        refresh(host);
        return true;
      } catch (error) {
        toast("Saved canvas edits were kept but could not be applied: " + error.message, true);
        return false;
      }
    }
    function discard(id) {
      const host = document.querySelector("#" + CSS.escape(id));
      const adapter = kit.canvasEditor(host);
      if (!adapter || !restore(host, adapter.authoredSnapshot())) {
        return false;
      }
      history.delete(host);
      renderPanel();
      return true;
    }
    document.addEventListener("kitcanvasrender", (event) => refresh(event.target));
    window.addEventListener("kitpresentchange", stop);
    window.addEventListener("kitstudiosectionchange", stop);
    document.addEventListener(
      "keydown",
      (event) => {
        if (!active || event.target.closest("input,textarea,select,[contenteditable]")) {
          return;
        }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
          event.preventDefault();
          event.stopImmediatePropagation();
          undo(active.host, active.adapter, event.shiftKey);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopImmediatePropagation();
          stop();
          renderPanel();
        }
      },
      true,
    );
    document.addEventListener(
      "click",
      (event) => {
        if (active && event.target.closest("#rv-root,.st-navigation,[role=tab]")) {
          stop();
          renderPanel();
        }
      },
      true,
    );
    return { controls, stop, restore, discard };
  };
})();
