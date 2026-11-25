/* Studio-only capture of the data passed to an authored component renderer.
   It is injected immediately before a page's own script, so it never ships in
   exported explainers. The WeakMap intentionally follows live hosts: no
   document scan, retained data, or mutation observer is needed. */
(function installExplainerComponentCapture(root) {
  "use strict";
  const captured = new WeakMap();
  const kinds = {
    renderRoadmap: "roadmap",
    renderArchitecture: "architecture",
    renderSequence: "sequence",
    renderErd: "erd",
    renderStack: "stack",
    renderTrace: "trace",
    renderChart: "chart",
    renderFlow: "flow",
    renderTable: "table",
    renderTree: "tree",
    renderLoop: "loop",
    renderStepper: "stepper",
    renderCode: "code",
    renderIceberg: "iceberg",
    renderPyramid: "pyramid",
  };
  let depth = 0;

  function plain(value) {
    if (value == null || ["string", "number", "boolean"].includes(typeof value)) {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map(plain);
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new TypeError("Component data must be plain JSON");
    }
    const result = {};
    Object.entries(value).forEach(function ([key, child]) {
      if (key !== "__proto__" && key !== "constructor" && key !== "prototype") {
        result[key] = plain(child);
      }
    });
    return result;
  }

  Object.entries(kinds).forEach(function ([name, kind]) {
    const renderer = root[name];
    if (typeof renderer !== "function" || renderer.__studioCaptureWrapped) {
      return;
    }
    function wrapped(host, data, ...rest) {
      const outer = depth === 0;
      const target =
        typeof host === "string"
          ? document.querySelector(host)
          : host instanceof Element
            ? host
            : null;
      depth += 1;
      try {
        const result = Reflect.apply(renderer, this, [host, data, ...rest]);
        if (outer && target) {
          try {
            const safeData = plain(data || {});
            const component = {
              kind:
                kind === "architecture" && safeData.preset === "operating-model"
                  ? "operating-model"
                  : kind,
              data: safeData,
            };
            if (
              safeData.canvasEdits &&
              ["architecture", "operating-model"].includes(component.kind)
            ) {
              component.canvas = safeData.canvasEdits;
              delete safeData.canvasEdits;
            }
            captured.set(target, component);
          } catch {
            // A renderer can accept richer objects; simply do not offer a
            // duplicate when its input is not safe authored JSON.
          }
        }
        return result;
      } finally {
        depth -= 1;
      }
    }
    wrapped.__studioCaptureWrapped = true;
    root[name] = wrapped;
  });

  root.ExplainerComponentCapture = Object.freeze({
    get(host) {
      const value = captured.get(host);
      return value ? plain(value) : null;
    },
  });
})(globalThis);
