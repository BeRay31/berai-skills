/* Studio-only sample gallery. The data is deliberately fictional and small:
   it demonstrates each renderer's shape without pretending to be authored
   evidence from the open explainer. */
(function installStudioSamples(root) {
  const samples = {
    roadmap: {
      layout: "timeline",
      periods: [
        { label: "Now", start: "2027-01-01", end: "2027-03-01" },
        { label: "Next", start: "2027-03-01", end: "2027-05-01" },
      ],
      lanes: [
        {
          id: "product",
          label: "Product",
          items: [
            { id: "pilot", label: "Pilot", start: "2027-01-15", end: "2027-02-15", state: "now" },
          ],
        },
        {
          id: "platform",
          label: "Platform",
          items: [
            {
              id: "handoff",
              label: "Handoff",
              start: "2027-03-10",
              end: "2027-04-10",
              state: "planned",
            },
          ],
        },
      ],
      walkthrough: [
        {
          title: "Pilot first",
          note: "The pilot creates the evidence for the next handoff.",
          items: ["pilot"],
        },
      ],
    },
    architecture: {
      layout: "free",
      width: 1000,
      height: 440,
      groups: [
        { id: "client", label: "Client", x: 20, y: 20, w: 300, h: 380, style: "dashed" },
        {
          id: "service",
          label: "Service",
          x: 360,
          y: 20,
          w: 300,
          h: 380,
          tone: "accent",
          style: "solid",
        },
        { id: "store", label: "Storage", x: 700, y: 20, w: 280, h: 380, style: "dotted" },
      ],
      nodes: [
        { id: "screen", group: "client", x: 70, y: 150, w: 200, h: 72, title: "Web screen" },
        { id: "api", group: "service", x: 410, y: 150, w: 200, h: 72, title: "Request API" },
        { id: "db", group: "store", x: 740, y: 150, w: 200, h: 72, title: "Record store" },
      ],
      edges: [
        { id: "submit", from: "screen", to: "api", label: "submit" },
        { id: "save", from: "api", to: "db", label: "save", tone: "success" },
      ],
      steps: [
        {
          title: "Cross the boundary",
          body: "The screen sends one request to the service, then saves the result.",
          nodes: ["screen", "api", "db"],
          edges: ["submit", "save"],
        },
      ],
    },
    sequence: {
      actors: [
        { id: "web", label: "Web", kind: "service" },
        { id: "api", label: "API", kind: "service", tone: "accent" },
        { id: "queue", label: "Queue", kind: "queue", tone: "success" },
      ],
      messages: [
        { id: "request", from: "web", to: "api", label: "submit", kind: "sync", key: true },
        { id: "enqueue", from: "api", to: "queue", label: "enqueue", kind: "async" },
        { id: "reply", from: "api", to: "web", label: "accepted", kind: "return" },
      ],
      walkthrough: [
        {
          title: "Accept and queue",
          note: "The API acknowledges the request after enqueueing work.",
          fire: ["request", "enqueue", "reply"],
        },
      ],
    },
    erd: {
      entities: [
        {
          id: "account",
          label: "Account",
          tone: "accent",
          attrs: [{ name: "account_id", key: "pk" }, { name: "name" }],
        },
        {
          id: "task",
          label: "Task",
          attrs: [
            { name: "task_id", key: "pk" },
            { name: "account_id", key: "fk" },
          ],
        },
        {
          id: "event",
          label: "Event",
          attrs: [
            { name: "event_id", key: "pk" },
            { name: "task_id", key: "fk" },
          ],
        },
      ],
      relations: [
        { id: "owns", from: "account", to: "task", label: "owns", card: "1:N" },
        { id: "records", from: "task", to: "event", label: "records", card: "1:N" },
      ],
      walkthrough: [
        { title: "Account owns tasks", note: "Each account can own many tasks.", fire: ["owns"] },
      ],
    },
    "operating-model": {
      preset: "operating-model",
      stages: [
        {
          id: "request",
          title: "Receive",
          body: "Capture the request",
          owner: "Program lead",
          cadence: "Weekly triage",
          tone: "accent",
        },
        {
          id: "check",
          title: "Check",
          body: "Validate the evidence",
          owner: "Delivery team",
          cadence: "Before planning",
        },
        {
          id: "route",
          title: "Route",
          body: "Assign the next action",
          owner: "Workstream lead",
          cadence: "Each handoff",
          tone: "success",
        },
      ],
      handoffs: [
        { id: "to-check", from: "request", to: "check", label: "validate" },
        { id: "to-route", from: "check", to: "route", label: "assign" },
      ],
      steps: [
        {
          title: "Move validated work",
          body: "A request is checked before the next owner receives it.",
          nodes: ["request", "check", "route"],
          edges: ["to-check", "to-route"],
        },
      ],
    },
    chart: {
      kind: "bars",
      items: [
        { label: "North", value: 42, tone: "accent" },
        { label: "Central", value: 31, tone: "context" },
        { label: "South", value: 18, tone: "context" },
      ],
    },
    flow: {
      items: [
        { type: "station", when: "01", label: "Receive", sub: "capture request", kind: "accent" },
        { type: "station", when: "02", label: "Check", sub: "validate fields", kind: "success" },
        {
          type: "gate",
          when: "03",
          label: "Ready?",
          kind: "warning",
          outcomes: [
            { text: "route", tone: "ok" },
            { text: "return", tone: "bad" },
          ],
        },
        { type: "station", when: "04", label: "Finish", sub: "record result", kind: "violet" },
      ],
      walkthrough: [
        {
          title: "Check before routing",
          note: "Only validated requests continue to the final step.",
        },
      ],
    },
  };

  const tableRows = {
    mode: "rows",
    groups: [
      {
        label: "Sample",
        rows: [
          { title: "Input", sub: "bounded request", key: true },
          { title: "Check", sub: "validation result" },
          { title: "Outcome", sub: "recorded handoff" },
        ],
      },
    ],
  };
  Object.assign(samples, {
    "table-rows": tableRows,
    "table-before-after": {
      mode: "before-after",
      rows: [
        { title: "Old path", before: "manual handoff", after: "tracked handoff" },
        { title: "Old signal", before: "late notice", after: "early check" },
      ],
    },
    "table-compare": {
      mode: "compare",
      leftName: "Now",
      rightName: "Next",
      rows: [
        { concern: "Signal", left: "late", right: "early" },
        { concern: "Owner", left: "shared", right: "named" },
      ],
    },
    "table-grid": {
      mode: "grid",
      groups: [
        {
          label: "Sample",
          rows: [
            { title: "Plan", sub: "set direction" },
            { title: "Check", sub: "test evidence" },
          ],
        },
      ],
    },
    "table-chips": {
      mode: "chips",
      groups: [
        {
          label: "Sample",
          rows: [
            { title: "Owner", tone: "accent" },
            { title: "Signal", tone: "success" },
          ],
        },
      ],
    },
    "table-specs": {
      mode: "specs",
      subjects: ["Now", "Next"],
      groups: [
        {
          label: "Sample",
          rows: [
            { label: "Handoff", values: ["shared", "named"], winner: 1 },
            { label: "Signal", values: ["late", "early"], winner: 1 },
          ],
        },
      ],
    },
    "tree-org": {
      mode: "org",
      root: {
        id: "team",
        label: "Delivery",
        children: [
          { id: "product", label: "Product" },
          { id: "platform", label: "Platform" },
        ],
      },
    },
    "tree-files": {
      mode: "files",
      root: {
        id: "root",
        label: "Explainer",
        children: [
          { id: "source", label: "Source", rationale: "editable" },
          { id: "output", label: "Output", rationale: "shareable" },
        ],
      },
    },
    "tree-evolution": {
      mode: "evolution",
      panes: [
        {
          label: "Before",
          tree: [{ name: "old-path/", children: [{ name: "manual.js", kind: "removed" }] }],
        },
        {
          label: "After",
          tree: [{ name: "new-path/", children: [{ name: "tracked.js", kind: "added" }] }],
        },
      ],
    },
    loop: {
      stages: [
        { label: "Receive", kind: "human" },
        { label: "Check", kind: "gate" },
        { label: "Learn", kind: "agent" },
      ],
      return: { label: "repeat" },
    },
    stepper: {
      steps: [
        { title: "Receive", body: "Capture the request." },
        { title: "Check", body: "Validate the evidence." },
        { title: "Decide", body: "Choose the next action." },
      ],
    },
    "flow-timeline": {
      mode: "timeline",
      items: [
        { when: "Jan", label: "Plan", sub: "set direction" },
        { when: "Feb", label: "Check", sub: "test evidence" },
        { when: "Mar", label: "Share", sub: "show result" },
      ],
    },
    code: {
      mode: "diff",
      before: {
        file: "old.js",
        lines: [
          { id: "a", text: "return pending", kind: "removed" },
          { id: "b", text: "notify()", kind: "context" },
        ],
      },
      after: {
        file: "new.js",
        lines: [
          { id: "c", text: "return ready", kind: "added" },
          { id: "b2", text: "notify()", kind: "context" },
        ],
      },
    },
    stack: {
      mode: "journey",
      lanes: [
        {
          id: "request",
          label: "Request",
          frames: [{ id: "receive", fn: "receive", depth: 0, label: "Receive" }],
        },
        {
          id: "service",
          label: "Service",
          frames: [{ id: "check", fn: "check", depth: 0, label: "Check" }],
        },
      ],
      returnPath: { from: "check", to: "receive", label: "Result" },
      journey: [
        { id: "start", label: "Start", frame: "receive" },
        { id: "done", label: "Done", frame: "check" },
      ],
    },
    "stack-diff": {
      mode: "diff",
      before: {
        lanes: [
          {
            id: "old",
            label: "Old path",
            frames: [{ id: "old-check", fn: "check", depth: 0, label: "Check" }],
          },
        ],
      },
      after: {
        lanes: [
          {
            id: "new",
            label: "New path",
            frames: [{ id: "new-check", fn: "check", depth: 0, label: "Check" }],
          },
        ],
      },
    },
    "chart-bars": {
      kind: "bars",
      items: [
        { label: "One", value: 42 },
        { label: "Two", value: 27 },
      ],
    },
    "chart-line": {
      kind: "line",
      x: ["Jan", "Feb", "Mar"],
      series: [{ label: "Signal", values: [12, 18, 16] }],
    },
    "chart-split": {
      kind: "split",
      parts: [
        { label: "Kept", value: 7 },
        { label: "Changed", value: 3 },
      ],
    },
    "chart-dumbbell": {
      kind: "dumbbell",
      items: [
        { label: "Latency", before: 40, after: 22 },
        { label: "Errors", before: 12, after: 5 },
      ],
    },
    "chart-histogram": {
      kind: "histogram",
      bins: [
        { label: "Low", value: 3 },
        { label: "Mid", value: 7 },
        { label: "High", value: 2 },
      ],
    },
    "chart-heatmap": {
      kind: "heatmap",
      rows: ["Mon", "Tue"],
      cols: ["AM", "PM"],
      values: [
        [2, 5],
        [4, 1],
      ],
    },
    "chart-dots": {
      kind: "dots",
      total: 10,
      unitSize: 1,
      parts: [
        { label: "Kept", value: 6 },
        { label: "Changed", value: 4 },
      ],
      columns: 5,
    },
    "chart-scatter": {
      kind: "scatter",
      points: [
        { label: "A", x: 1, y: 4 },
        { label: "B", x: 3, y: 2 },
        { label: "C", x: 5, y: 6 },
      ],
    },
    "chart-map": {
      kind: "map",
      pins: [
        { label: "North", lat: 52, lon: 5, value: 42 },
        { label: "South", lat: 40, lon: -74, value: 27 },
      ],
    },
    "chart-stat": {
      kind: "stat",
      items: [
        { n: "42", label: "sample requests", sub: "illustrative" },
        { n: "7", label: "handoffs", sub: "illustrative" },
      ],
    },
    "architecture-trace": {
      kind: "trace",
      spans: [
        { id: "request", label: "Request", start: 0, dur: 48, lane: "request", kind: "work" },
        { id: "check", label: "Check", start: 12, dur: 20, lane: "request", kind: "wait" },
      ],
    },
    iceberg: {
      above: [{ title: "Visible", lines: ["one clear signal"] }],
      below: [["supporting detail"], ["open question"]],
      punch: "The visible result sits on hidden work.",
    },
    pyramid: {
      layers: [
        { name: "Decision", tone: "accent" },
        { name: "Evidence", tone: "success" },
        { name: "Inputs", tone: "violet" },
      ],
    },
  });

  function render(host, key) {
    if (!host || typeof host.append !== "function") {
      throw new TypeError("studioSamples.render(host, key) expects a host element");
    }
    if (!Object.hasOwn(samples, key)) {
      throw new TypeError('studioSamples: unknown sample "' + key + '"');
    }
    // Callers provide a fresh host when switching visual families.
    const data = structuredClone(samples[key]);
    const fn = {
      roadmap: root.renderRoadmap,
      architecture: root.renderArchitecture,
      sequence: root.renderSequence,
      erd: root.renderErd,
      "operating-model": root.renderArchitecture,
      chart: root.renderChart,
      flow: root.renderFlow,
      "table-rows": root.renderTable,
      "table-before-after": root.renderTable,
      "table-compare": root.renderTable,
      "table-grid": root.renderTable,
      "table-chips": root.renderTable,
      "table-specs": root.renderTable,
      "tree-org": root.renderTree,
      "tree-files": root.renderTree,
      "tree-evolution": root.renderTree,
      loop: root.renderLoop,
      stepper: root.renderStepper,
      "flow-timeline": root.renderFlow,
      code: root.renderCode,
      stack: root.renderStack,
      "stack-diff": root.renderStack,
      "chart-bars": root.renderChart,
      "chart-line": root.renderChart,
      "chart-split": root.renderChart,
      "chart-dumbbell": root.renderChart,
      "chart-histogram": root.renderChart,
      "chart-heatmap": root.renderChart,
      "chart-dots": root.renderChart,
      "chart-scatter": root.renderChart,
      "chart-map": root.renderChart,
      "chart-stat": root.renderChart,
      "architecture-trace": root.renderTrace,
      iceberg: root.renderIceberg,
      pyramid: root.renderPyramid,
    }[key];
    const renderData = key.startsWith("table-") ? { ...data, mode: key.slice(6) } : data;
    if (key.startsWith("tree-")) {
      renderData.mode = key.slice(5);
    }
    if (typeof fn !== "function") {
      throw new TypeError('studioSamples: renderer unavailable for "' + key + '"');
    }
    return fn(host, renderData);
  }

  /* The gallery is also the source of truth for deterministic slide insertion.
     Keep this deliberately small: callers receive JSON-shaped data only, never
     renderer functions or live sample objects they could accidentally mutate. */
  const KINDS = {
    roadmap: "roadmap",
    architecture: "architecture",
    "operating-model": "operating-model",
    sequence: "sequence",
    erd: "erd",
    stack: "stack",
    "stack-diff": "stack",
    "architecture-trace": "trace",
    chart: "chart",
    "chart-bars": "chart",
    "chart-line": "chart",
    "chart-split": "chart",
    "chart-dumbbell": "chart",
    "chart-histogram": "chart",
    "chart-heatmap": "chart",
    "chart-dots": "chart",
    "chart-scatter": "chart",
    "chart-map": "chart",
    "chart-stat": "chart",
    flow: "flow",
    "flow-timeline": "flow",
    "table-rows": "table",
    "table-before-after": "table",
    "table-compare": "table",
    "table-grid": "table",
    "table-chips": "table",
    "table-specs": "table",
    "tree-org": "tree",
    "tree-files": "tree",
    "tree-evolution": "tree",
    loop: "loop",
    stepper: "stepper",
    code: "code",
    iceberg: "iceberg",
    pyramid: "pyramid",
  };

  function safeClone(value) {
    if (
      value == null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map(safeClone);
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new TypeError("studioSamples only clones plain data");
    }
    const copy = {};
    Object.entries(value).forEach(function ([key, child]) {
      if (key !== "__proto__" && key !== "constructor" && key !== "prototype") {
        copy[key] = safeClone(child);
      }
    });
    return copy;
  }

  function describe(key) {
    if (!Object.hasOwn(samples, key) || !Object.hasOwn(KINDS, key)) {
      throw new TypeError('studioSamples: unknown sample "' + key + '"');
    }
    const data = safeClone(samples[key]);
    if (key.startsWith("table-")) {
      data.mode = key.slice(6);
    }
    if (key.startsWith("tree-")) {
      data.mode = key.slice(5);
    }
    return { visual: key, kind: KINDS[key], data };
  }

  root.ExplainerKit = root.ExplainerKit || {};
  root.ExplainerKit.studioSamples = {
    render,
    clone(key) {
      return describe(key).data;
    },
    describe,
  };
})(globalThis);
