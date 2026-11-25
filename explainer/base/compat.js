/* Base/compat.js — v2 → v3 render-API compatibility shims.
   Injected into every assembled explainer so a v2 source continues to
   render after a one-click studio upgrade, without needing a source edit
   first. Shims are guarded: they only register when the old name is absent
   and the new target is present, so nothing is overwritten if a name is
   ever reused in a later version.

   Renamed functions delegate to the current API, translating any field
   names that changed (e.g. renderBeforeAfter's `aspect` → `title`).
   Dropped functions render the closest equivalent and emit a console.warn
   naming the replacement, so authors can find and migrate the call at their
   own pace.

   Remove this file entirely in v4. */
(function () {
  "use strict";

  function warn(old, hint, retired) {
    console.warn(
      `[explainer compat] \u2018${old}\u2019 was ${
        retired
          ? "removed \u2014 rendering its authored content through the closest compatibility treatment" +
            (hint ? ": " + hint : ".")
          : "renamed \u2014 update your source to silence this: " + hint
      } This shim is removed in v4.`,
    );
  }

  function compatError(name, message) {
    throw new Error(`[explainer compat] ${name}: ${message}`);
  }

  function plain(value) {
    return value == null ? "" : String(value).replaceAll(/<[^>]*>/g, "");
  }

  /* ── renamed: thin delegators to the current API ─────────────────────── */

  if (typeof renderStats === "undefined" && typeof renderChart === "function") {
    window.renderStats = function renderStats(host, data) {
      warn("renderStats", 'renderChart(host, {kind:"stat", items:[...]})');
      return renderChart(host, { kind: "stat", ...data });
    };
  }

  if (typeof renderLedger === "undefined" && typeof renderTable === "function") {
    window.renderLedger = function renderLedger(host, data) {
      warn("renderLedger", 'renderTable(host, {mode:"rows", groups:[...]})');
      return renderTable(host, { mode: "rows", ...data });
    };
  }

  if (typeof renderBeforeAfter === "undefined" && typeof renderTable === "function") {
    window.renderBeforeAfter = function renderBeforeAfter(host, data) {
      warn(
        "renderBeforeAfter",
        'renderTable(host, {mode:"before-after", rows:[{title, before, after}]})',
      );
      const d = { mode: "before-after", ...data };
      if (Array.isArray(d.rows)) {
        /* old API used `aspect`; current uses `title` */
        d.rows = d.rows.map((r) => (r.aspect && !r.title ? { ...r, title: r.aspect } : { ...r }));
      }
      return renderTable(host, d);
    };
  }

  if (typeof renderComparison === "undefined" && typeof renderTable === "function") {
    window.renderComparison = function renderComparison(host, data) {
      warn(
        "renderComparison",
        'renderTable(host, {mode:"compare", left, right, rows:[{concern, left, right}]})',
      );
      return renderTable(host, { mode: "compare", ...data });
    };
  }

  if (typeof renderDotplot === "undefined" && typeof renderTable === "function") {
    window.renderDotplot = function renderDotplot(host, data) {
      warn("renderDotplot", 'renderTable(host, {mode:"rows", ...}) with a dots cell per row');
      return renderTable(host, { mode: "rows", ...data });
    };
  }

  if (typeof renderChips === "undefined" && typeof renderTable === "function") {
    window.renderChips = function renderChips(host, data) {
      warn("renderChips", 'renderTable(host, {mode:"chips", groups:[...]})');
      return renderTable(host, { mode: "chips", ...data });
    };
  }

  if (typeof renderTiles === "undefined" && typeof renderTable === "function") {
    window.renderTiles = function renderTiles(host, data) {
      warn("renderTiles", 'renderTable(host, {mode:"grid", groups:[...]})');
      return renderTable(host, { mode: "grid", ...data });
    };
  }

  if (typeof renderFiletree === "undefined" && typeof renderTree === "function") {
    window.renderFiletree = function renderFiletree(host, data) {
      warn("renderFiletree", 'renderTree(host, {mode:"evolution"|"files", ...})');
      /* The retired renderFiletree consumed `panes` (evolution's shape);
         only a rooted tree belongs in files mode */
      const hasPanes = data && ((data.panes && data.panes.length) || data.before || data.after);
      const mode = hasPanes ? "evolution" : "files";
      return renderTree(host, { mode, ...data });
    };
  }

  if (typeof renderOperatingModel === "undefined" && typeof renderArchitecture === "function") {
    window.renderOperatingModel = function renderOperatingModel(host, data) {
      warn("renderOperatingModel", 'renderArchitecture(host, {preset:"operating-model", ...})');
      return renderArchitecture(host, { preset: "operating-model", ...data });
    };
  }

  /* ── dropped: best-effort renders so the page isn't just empty ─────────
     The shim renders the closest equivalent so authors can still read the
     content while the source is being migrated. A console.warn in each
     names the suggested replacement. ── */

  if (typeof renderContrast === "undefined") {
    window.renderContrast = function renderContrast(host, data) {
      warn("renderContrast", 'use renderTable(host, {mode:"compare", ...})', true);
      if (typeof renderTable !== "function") {
        compatError(
          "renderContrast",
          'requires the table component; keep "contrast" or add "table" to meta.components',
        );
      }
      const cols = (data && (data.cols || [data.a, data.b])) || [];
      const left = cols[0] || {},
        right = cols[1] || {};
      const lp = Array.isArray(left.points) ? left.points : [];
      const rp = Array.isArray(right.points) ? right.points : [];
      const rows = [];
      if (left.body || right.body) {
        rows.push({ concern: "Summary", left: plain(left.body), right: plain(right.body) });
      }
      for (let i = 0; i < Math.max(lp.length, rp.length); i++) {
        rows.push({ concern: String(i + 1), left: plain(lp[i]), right: plain(rp[i]) });
      }
      if (left.foot || right.foot) {
        rows.push({ concern: "Note", left: plain(left.foot), right: plain(right.foot) });
      }
      if (rows.length === 0) {
        compatError("renderContrast", "legacy data has no body, points, or foot content to render");
      }
      function heading(col, fallback) {
        const parts = [plain(col.eyebrow), plain(col.title)].filter(Boolean);
        return parts.join(" · ") || fallback;
      }
      return renderTable(host, {
        leftName: heading(left, "A"),
        mode: "compare",
        rightName: heading(right, "B"),
        rows,
      });
    };
  }

  if (typeof renderVerdict === "undefined") {
    window.renderVerdict = function renderVerdict(host, data) {
      warn("renderVerdict", 'use renderChart(host, {kind:"stat", items:[...]})', true);
      if (typeof renderChart !== "function") {
        compatError(
          "renderVerdict",
          'requires the chart component; keep "verdict" or add "chart" to meta.components',
        );
      }
      data = data || {};
      const details = [];
      const chips = Array.isArray(data.chips) ? data.chips : [];
      chips.forEach((chip) => {
        details.push(plain(chip.k) + (chip.v != null ? ": " + plain(chip.v) : ""));
      });
      if (data.note) {
        details.push(plain(data.note));
      }
      if (!data.verdict && !data.detail && details.length === 0) {
        compatError(
          "renderVerdict",
          "legacy data has no verdict, detail, chips, or note content to render",
        );
      }
      const tone = data.tone === "block" ? "error" : data.tone === "warn" ? "warning" : data.tone;
      return renderChart(host, {
        items: [
          {
            n: plain(data.verdict),
            label: plain(data.detail),
            sub: details.join(" · "),
            tone: tone || "accent",
          },
        ],
        kind: "stat",
      });
    };
  }

  if (typeof renderDuo === "undefined") {
    window.renderDuo = function renderDuo(host, data) {
      warn(
        "renderDuo",
        'replace with authored prose or renderTable(host, {mode:"compare", ...})',
        true,
      );
      const mount = typeof host === "string" ? document.querySelector(host) : host;
      if (!mount) {
        compatError("renderDuo", "component host not found: " + host);
      }
      if (!data || !data.left || !data.right) {
        compatError("renderDuo", "legacy data must include both left and right objects");
      }
      ["left", "right"].forEach((side) => {
        const item = data[side];
        const values = [item.label, item.claim, item.sub];
        if (!values.some((value) => plain(value).trim())) {
          compatError("renderDuo", `${side} must include readable label, claim, or sub content`);
        }
      });
      function build(side, panel) {
        const item = data[side];
        panel.className = "compat-duo-panel";
        panel.dataset.tone = item.tone || (side === "left" ? "neutral" : "accent");
        if (item.label) {
          const label = document.createElement("span");
          label.className = "eyebrow";
          label.textContent = plain(item.label);
          panel.append(label);
        }
        if (item.claim) {
          const claim = document.createElement("h3");
          claim.textContent = plain(item.claim);
          panel.append(claim);
        }
        if (item.sub) {
          const sub = document.createElement("p");
          sub.textContent = plain(item.sub);
          panel.append(sub);
        }
      }
      if (typeof mount.__kitDispose === "function") {
        mount.__kitDispose();
      }
      mount.__kitDispose = null;
      mount.replaceChildren();
      mount.classList.add("compat-duo");
      ["left", "right"].forEach((side) => {
        var panel = document.createElement("div");
        build(side, panel);
        mount.appendChild(panel);
      });
      return mount;
    };
  }
})();
