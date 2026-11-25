/* ── Present mode (kit, fixed) ─────────────────────────────────────────
   Fixes over the pre-kit version:
   · enter() anchors to the slide matching the current scroll position
     (P from a scrolled read-view lands on that section, not slide 1)
   · exit() scrolls the page to the current slide's section, so
     exit → re-enter resumes where you left off
   · the URL hash tracks `#s<slide>.<step>` while presenting — reload
     and shared deep-links resume; sessionStorage restores the fragment
     step when re-entering from the matching section
   · per-slide minScale/maxScale, worst-case step-height caching so
     stepped slides never rescale mid-walk
   · on file:// (this kit's primary distribution — a self-contained page
     opened straight off disk), the document's origin is opaque and unique
     per navigation. Chromium's history.replaceState() same-origin check
     is unreliable for opaque origins even when only the fragment changes
     (see https://github.com/whatwg/html/issues/6836) — it can silently
     reject the call and log "Unsafe attempt to load URL ... 'file:' URLs
     are treated as unique security origins", which was leaving next()/
     prev() on a blank slide mid-walk. So on file:// we never touch the
     URL/history during the walk; sessionStorage alone drives resume
   · the slide-entrance fade+blur is a CSS @keyframes animation, not a
     MOTION.animate() call — enough WAAPI .animate() calls across distinct
     .pr-stage elements in one session made Chromium paint a later slide
     fully transparent forever after (computed opacity: 1, nothing drawn) */
function fragSteps(selector) {
  // The first item shows on slide arrival — a slide should never land as
  // Headers over a void. Each press reveals the next item.
  const items = Array.prototype.slice.call(document.querySelectorAll(selector));
  let active = 0;
  items.forEach((el) => {
    el.classList.add("pr-frag");
  });
  return {
    count: Math.max(items.length, 1),
    current() {
      return active;
    },
    go(i) {
      active = i;
      items.forEach(function (el, k) {
        el.classList.toggle("pr-on", k <= i);
      });
    },
  };
}
function clickSteps(selector) {
  const count = document.querySelectorAll(selector).length;
  let active = 0;
  if (!count) {
    throw new Error('clickSteps: selector "' + selector + '" matched no elements');
  }
  return {
    count,
    current() {
      return active;
    },
    go(i) {
      var b = document.querySelectorAll(selector)[i];
      if (b) {
        b.click();
        active = i;
      }
    },
  };
}
function initPresent(slides) {
  const btn = document.querySelector("#presentToggle");
  if (!btn || slides.length === 0) {
    return;
  }
  slides.forEach((slide, index) => {
    if (slide.steps && (!Number.isInteger(slide.steps.count) || slide.steps.count < 1)) {
      throw new Error(
        "initPresent: slide " + (index + 1) + " steps.count must be a positive integer",
      );
    }
  });
  let deck = null,
    hud,
    countEl,
    barEl,
    prevBtn,
    nextBtn,
    hintEl,
    groups = [];
  let adopted = [],
    cur = 0,
    step = 0,
    savedScroll = 0,
    entrySlide = 0,
    hudTimer = null,
    hintTimer = null,
    hintShown = false;
  const STORE_KEY = "explainer-present:" + location.pathname;
  const IS_FILE = location.protocol === "file:";

  function stepCount(s) {
    return s.steps ? s.steps.count : 1;
  }
  // Progress is step-weighted, not slide-weighted: a deck of few slides with
  // Long walkthroughs must still show motion on every beat, or the presenter
  // Loses their place exactly where orientation matters most.
  function totalSteps() {
    let t = 0;
    for (let i = 0; i < slides.length; i++) {
      t += stepCount(slides[i]);
    }
    return t;
  }
  function stepsBefore(n) {
    let t = 0;
    for (let i = 0; i < n; i++) {
      t += stepCount(slides[i]);
    }
    return t;
  }
  function logicalSlideCount() {
    return slides.reduce((n, s) => n + (s.inPlace ? 0 : 1), 0);
  }
  function logicalSlideNumber(n) {
    let total = 0;
    for (let i = 0; i <= n; i++) {
      if (!slides[i].inPlace) {
        total++;
      }
    }
    return total;
  }
  function presenting() {
    return document.body.classList.contains("presenting");
  }

  function exportFrame() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }
  function anchorEl(s) {
    for (let i = 0; i < (s.pick || []).length; i++) {
      const el = document.querySelector(s.pick[i]);
      if (el) {
        return el;
      }
    }
    return null;
  }
  function resetDeck() {
    if (presenting()) {
      return false;
    }
    // build() appends the chrome to the body as siblings of the deck, so
    // dropping only the deck would leave live listeners behind and the next
    // build() would stack a second HUD on top of the orphan.
    [deck, hud, barEl, hintEl].forEach(function (el) {
      if (el) {
        el.remove();
      }
    });
    deck = null;
    hud = null;
    countEl = null;
    barEl = null;
    prevBtn = null;
    nextBtn = null;
    hintEl = null;
    groups = [];
    slides.forEach(function (slide) {
      ["_i", "_slide", "_stage", "_scale", "_maxH", "_maxW", "_naturalW"].forEach(function (key) {
        delete slide[key];
      });
    });
    cur = Math.min(cur, Math.max(0, slides.length - 1));
    step = 0;
    return true;
  }
  let previewSequence = 0;
  function insertPreviewBefore(slide, target) {
    if (
      presenting() ||
      !slide ||
      !Array.isArray(slide.pick) ||
      slide.pick.length === 0 ||
      !target
    ) {
      return "";
    }
    let at = slides.length;
    for (let i = 0; i < slides.length; i++) {
      const anchor = anchorEl(slides[i]);
      if (
        anchor &&
        (anchor === target ||
          target.contains(anchor) ||
          Boolean(target.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_FOLLOWING))
      ) {
        at = i;
        break;
      }
    }
    const token = "studio-section-" + ++previewSequence;
    slide._previewToken = token;
    slides.splice(at, 0, slide);
    resetDeck();
    return token;
  }
  function removePreview(token) {
    if (presenting() || !token) {
      return false;
    }
    const at = slides.findIndex(function (slide) {
      return slide._previewToken === token;
    });
    if (at === -1) {
      return false;
    }
    slides.splice(at, 1);
    resetDeck();
    return true;
  }
  // The slide whose content the reader is looking at: the last slide whose
  // Anchor starts above a reference line 35% down the viewport.
  function slideForScroll() {
    const ref = window.scrollY + window.innerHeight * 0.35;
    let best = 0,
      bestTop = -Infinity;
    slides.forEach((s, i) => {
      var el = anchorEl(s);
      if (!el) {
        return;
      }
      var top = el.getBoundingClientRect().top + window.scrollY;
      if (top <= ref && top > bestTop) {
        best = i;
        bestTop = top;
      }
    });
    return best;
  }
  function parseHash() {
    const m = location.hash.match(/^#s(\d+)(?:\.(\d+))?$/);
    if (!m) {
      return null;
    }
    const sl = Math.min(Math.max(Math.trunc(Number(m[1])) - 1, 0), slides.length - 1);
    return { slide: sl, step: m[2] ? Math.trunc(Number(m[2])) : 0 };
  }
  function persist() {
    // Skip the URL/history entirely on file:// — see the header note.
    if (!IS_FILE) {
      const h = "#s" + (cur + 1) + (step > 0 ? "." + step : "");
      try {
        history.replaceState(null, "", h);
      } catch {}
    }
    try {
      sessionStorage.setItem(STORE_KEY, `${cur}:${step}`);
      sessionStorage.setItem(`${STORE_KEY}:presenting`, "1");
    } catch {}
  }
  function storedPos() {
    try {
      const v = sessionStorage.getItem(STORE_KEY);
      if (!v) {
        return null;
      }
      const p = v.split(":");
      const sl = Math.min(Math.max(Number.parseInt(p[0], 10) || 0, 0), slides.length - 1);
      return { slide: sl, step: Math.trunc(Number(p[1])) || 0 };
    } catch {
      return null;
    }
  }

  function renderProgressTicks() {
    if (!barEl) {
      return;
    }
    Array.prototype.slice.call(barEl.querySelectorAll("b")).forEach((tick) => {
      tick.remove();
    });
    const allSteps = totalSteps();
    for (let tk = 1; tk < slides.length; tk++) {
      if (slides[tk].inPlace) {
        continue;
      }
      const tick = document.createElement("b");
      tick.style.left = `${(stepsBefore(tk) / allSteps) * 100}%`;
      barEl.append(tick);
    }
  }

  function build() {
    deck = document.createElement("div");
    deck.className = "pr-deck";
    deck.tabIndex = -1;
    deck.setAttribute("role", "region");
    deck.setAttribute("aria-label", "Presentation");
    // Continuation chains: a manifest entry with `continues: true` continues
    // The previous slide (a story split across slides to hold the scale
    // Budget). The tag is derived, never hand-authored: part numbers come
    // From the run of flagged entries, so reordering slides can't lie.
    const partOf = slides.map(function (s, i) {
      if (!s.continues) {
        return null;
      }
      var start = i;
      while (start > 0 && slides[start - 1].continues) {
        start--;
      }
      var end = i;
      while (end + 1 < slides.length && slides[end + 1].continues) {
        end++;
      }
      return { n: i - start + 2, total: end - start + 2 };
    });
    // Continuation GROUPS, same chain the part tag is derived from: a run
    // That starts at the first non-continuing slide and swallows every
    // `continues: true` slide after it. Members share one scale (see fit()).
    // A slide with no continuation neighbour is not in a group at all, so
    // Present's geometry for every ordinary deck is untouched.
    groups = new Array(slides.length);
    for (let gi = 0; gi < slides.length;) {
      let gj = gi;
      while (gj + 1 < slides.length && slides[gj + 1].continues) {
        gj++;
      }
      if (gj > gi) {
        const members = [];
        for (let gk = gi; gk <= gj; gk++) {
          members.push(gk);
        }
        for (let gm = gi; gm <= gj; gm++) {
          groups[gm] = members;
        }
      }
      gi = gj + 1;
    }
    slides.forEach((s, i) => {
      s._i = i;
      var sl = document.createElement("section");
      sl.className = "pr-slide";
      sl.tabIndex = -1;
      if (s.layout) {
        sl.dataset.layout = s.layout;
      }
      var stage = document.createElement("div");
      stage.className = "pr-stage";
      if (s.kicker) {
        var k = document.createElement("div");
        k.className = "pr-kicker";
        k.textContent = s.kicker;
        stage.appendChild(k);
        stage.classList.add("has-kicker");
        if (partOf[i] && !s.inPlace) {
          var part = document.createElement("span");
          part.className = "pr-part";
          part.textContent = "part " + partOf[i].n + " of " + partOf[i].total + " · continued";
          k.appendChild(part);
        }
      }
      if (s.title) {
        var t = document.createElement("h2");
        t.className = "pr-title";
        t.textContent = s.title;
        stage.appendChild(t);
      }
      sl.appendChild(stage);
      deck.appendChild(sl);
      s._slide = sl;
      s._stage = stage;
    });
    hud = document.createElement("div");
    hud.className = "pr-hud";
    prevBtn = hudButton("←", "Previous");
    nextBtn = hudButton("→", "Next");
    countEl = document.createElement("span");
    countEl.className = "pr-count";
    hud.append(prevBtn);
    hud.append(countEl);
    hud.append(nextBtn);
    barEl = document.createElement("div");
    barEl.className = "pr-progress";
    barEl.append(document.createElement("i"));
    renderProgressTicks();
    hintEl = document.createElement("div");
    hintEl.className = "pr-hint";
    hintEl.textContent = "F: Fullscreen · Esc: Exit presentation";
    document.body.append(deck);
    document.body.append(hud);
    document.body.append(barEl);
    document.body.append(hintEl);
    prevBtn.addEventListener("click", prev);
    nextBtn.addEventListener("click", nextSlide);
  }
  function hudButton(label, name) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.setAttribute("aria-label", name);
    return b;
  }

  function adopt() {
    slides.forEach((s) => {
      (s.pick || []).forEach(function (sel) {
        var node = document.querySelector(sel);
        if (!node) {
          return;
        }
        adopted.push({ el: node, parent: node.parentNode, next: node.nextSibling });
        s._stage.appendChild(node);
      });
    });
    if (window.__revealAll) {
      window.__revealAll();
    }
  }
  function restore() {
    for (let i = adopted.length - 1; i >= 0; i--) {
      adopted[i].parent.insertBefore(adopted[i].el, adopted[i].next);
    }
    adopted = [];
  }

  function captureStates(visitor) {
    if (presenting() || typeof visitor !== "function") {
      return Promise.resolve(false);
    }
    const run = () => {
      if (deck) {
        resetDeck();
      }
      const sources = slides.map(function (slide) {
        const anchor = anchorEl(slide);
        return anchor && anchor.closest ? anchor.closest("section") : null;
      });
      const previousSteps = slides.map(function (slide) {
        return slide.steps && typeof slide.steps.current === "function" ? slide.steps.current() : 0;
      });
      let exported = 0;
      const cleanup = () => {
        document.body.classList.remove("pr-exporting", "presenting");
        try {
          restore();
        } finally {
          try {
            slides.forEach(function (slide, index) {
              if (slide.steps) {
                slide.steps.go(previousSteps[index]);
              }
            });
          } finally {
            resetDeck();
          }
        }
      };
      const prepareStep = (slide, stepIndex) => {
        slide._maxH = 0;
        slide._maxW = null;
        slide._scale = null;
        measureSteps(slide);
        if (slide.steps) {
          slide.steps.go(stepIndex);
        }
        fit(slide);
      };
      const captureSteps = (slide, slideIndex, count) => {
        const captureStep = (stepIndex) => {
          if (stepIndex >= count) {
            return Promise.resolve();
          }
          const wasMeasuring = window.__kitMeasuring;
          window.__kitMeasuring = true;
          return Promise.resolve()
            .then(() => {
              prepareStep(slide, stepIndex);
              return exportFrame();
            })
            .then(
              (frame) => {
                window.__kitMeasuring = wasMeasuring;
                return frame;
              },
              (error) => {
                window.__kitMeasuring = wasMeasuring;
                throw error;
              },
            )
            .then(() =>
              visitor({
                section: slide._slide,
                stage: slide._stage,
                sourceSection: sources[slideIndex],
                slideIndex,
                stepIndex,
                stepCount: count,
                title: slide.title || "",
                background: getComputedStyle(deck).backgroundColor,
              }),
            )
            .then(() => {
              exported += 1;
              return captureStep(stepIndex + 1);
            });
        };
        return captureStep(0);
      };
      const captureSlides = (slideIndex) => {
        if (slideIndex >= slides.length) {
          return Promise.resolve(exported);
        }
        const slide = slides[slideIndex];
        slides.forEach(function (candidate, index) {
          candidate._slide.classList.toggle("active", index === slideIndex);
          candidate._slide.setAttribute("aria-hidden", index === slideIndex ? "false" : "true");
        });
        const count = stepCount(slide);
        return captureSteps(slide, slideIndex, count).then(() => captureSlides(slideIndex + 1));
      };
      try {
        build();
        adopt();
        document.body.classList.add("presenting", "pr-exporting");
        return captureSlides(0).then(
          (total) => {
            cleanup();
            return total;
          },
          (error) => {
            cleanup();
            throw error;
          },
        );
      } catch (error) {
        cleanup();
        return Promise.reject(error);
      }
    };
    try {
      return run();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  // Scale the stage to fit the viewport. Below the floor the slide keeps
  // The floor scale, anchors to the top, and scrolls vertically instead —
  // The escape hatch for one tall artifact, not licence to cram.
  const MIN_SCALE = 0.6,
    MAX_SCALE = 2.4,
    fitWarnings = new Set();
  function measureSteps(s) {
    // Pre-measure the worst-case step height so stepped slides keep one
    // Scale for the whole walk instead of rescaling on every advance.
    // The flag silences swapIn so the rapid walk can't strand a panel
    // Mid-animation at opacity 0.
    if (!s.steps || (s._maxH && s._maxW)) {
      return;
    }
    const liveRegions = Array.prototype.slice.call(s._stage.querySelectorAll("[aria-live]"));
    const liveValues = liveRegions.map((el) => el.getAttribute("aria-live"));
    liveRegions.forEach((el) => {
      el.setAttribute("aria-live", "off");
    });
    // Export measures each step inside its own measuring window; restoring the
    // previous value keeps that window open for the steps.go and fit() calls
    // that follow, so reveal paths cannot animate into a captured frame.
    const wasMeasuring = window.__kitMeasuring;
    window.__kitMeasuring = true;
    let max = 0,
      maxWidth = null;
    try {
      for (let i = 0; i < s.steps.count; i++) {
        s.steps.go(i);
        max = Math.max(max, s._stage.offsetHeight);
        const width = stageWidthMetrics(s._stage);
        if (!maxWidth || width.width > maxWidth.width) {
          maxWidth = width;
        }
      }
      s._maxH = max;
      s._maxW = maxWidth;
    } finally {
      window.__kitMeasuring = wasMeasuring;
      try {
        // The slide being shown resumes its own step; a group sibling measured
        // Early (see fit()) is left on its overview — show() sets its step when
        // It is actually reached.
        s.steps.go(s === slides[cur] ? step : 0);
      } finally {
        liveRegions.forEach((el, index) => {
          if (liveValues[index] == null) {
            el.removeAttribute("aria-live");
          } else {
            el.setAttribute("aria-live", liveValues[index]);
          }
        });
      }
    }
  }
  function stageWidthMetrics(stage) {
    const stageWidth = Math.max(stage.offsetWidth || 0, 1);
    let left = 0,
      right = Math.max(stageWidth, stage.scrollWidth || 0);
    try {
      const stageRect = stage.getBoundingClientRect();
      const renderedScale = stageRect.width > 0 ? stageRect.width / stageWidth : 1;
      const candidates = new Set(stage.children);
      stage.querySelectorAll("svg,figure,table,pre,[data-zoom]").forEach((el) => {
        candidates.add(el);
      });
      candidates.forEach(function (el) {
        // A node that generates no box has no geometry to contribute, and its
        // empty rect sits at the viewport origin — far to the LEFT of a centred
        // stage, so counting it invents a negative left edge. The chart's
        // collapsed "view data" table (display:none in Present) dragged the
        // measured width from 1100px to 1866px, and every chart slide paid for
        // it with 40% of the viewport (1481px of 2464px at 2560×1440).
        if (el.getClientRects().length === 0) {
          return;
        }
        const rect = el.getBoundingClientRect();
        let x = (rect.left - stageRect.left) / renderedScale;
        let parent = el.parentElement;
        while (parent && parent !== stage) {
          x += parent.scrollLeft || 0;
          parent = parent.parentElement;
        }
        if (!parent) {
          return;
        }
        // scrollWidth reports scrollable overflow, which a clipping box keeps
        // to itself: decorative art that bleeds past an overflow:hidden edge
        // (section's rotated ribbons overflow ~1415px inside a 1024px cover)
        // is invisible, so counting it shrank the whole slide to fit pixels
        // nobody can see. An element that clips is exactly its border box.
        // Auto/scroll still count — that content is reachable, and Present
        // would rather widen the slide than hand the audience a scrollbar.
        const clipsX =
          el instanceof HTMLElement &&
          /^(hidden|clip)$/.test(window.getComputedStyle(el).overflowX);
        const width = Math.max(
          el.offsetWidth || 0,
          clipsX ? 0 : el.scrollWidth || 0,
          rect.width / renderedScale,
        );
        if (!Number.isFinite(x) || !Number.isFinite(width)) {
          return;
        }
        left = Math.min(left, x);
        right = Math.max(right, x + width);
      });
    } catch {}
    return { stageWidth, left, right, width: Math.max(right - left, 1) };
  }
  function slideAvailableSize(slide) {
    let horizontalPadding = 96,
      verticalPadding = 152;
    try {
      const style = window.getComputedStyle(slide);
      const padding = [
        style.paddingLeft,
        style.paddingRight,
        style.paddingTop,
        style.paddingBottom,
      ].map(Number.parseFloat);
      if (padding.every(Number.isFinite)) {
        horizontalPadding = padding[0] + padding[1];
        verticalPadding = padding[2] + padding[3];
      }
    } catch {}
    return {
      height: Math.max(slide.clientHeight - verticalPadding, 1),
      width: Math.max(slide.clientWidth - horizontalPadding, 1),
    };
  }
  function naturalMetrics(s) {
    const available = slideAvailableSize(s._slide);
    const availW = available.width;
    const availH = available.height;
    const width = s._maxW || stageWidthMetrics(s._stage);
    const height = Math.max(s._maxH || s._stage.offsetHeight || 0, 1);
    const widthScale = availW / width.width;
    const heightScale = availH / height;
    const requiredScale = Math.min(widthScale, heightScale);
    return {
      availW,
      availH,
      height,
      width,
      widthScale,
      heightScale,
      requiredScale,
      scale: Math.min(s.maxScale || MAX_SCALE, requiredScale),
    };
  }
  function fittedHorizontal(s, metrics, scale) {
    let outsideStage = Math.max(0, (metrics.width.width - metrics.width.stageWidth) * scale);
    let outsideSlide = Math.max(0, metrics.width.width * scale - metrics.availW);
    let availableWidth = metrics.availW;
    try {
      const stageRect = s._stage.getBoundingClientRect();
      const slideRect = s._slide.getBoundingClientRect();
      const style = window.getComputedStyle(s._slide);
      const availableLeft = slideRect.left + (Number.parseFloat(style.paddingLeft) || 0);
      const availableRight = slideRect.right - (Number.parseFloat(style.paddingRight) || 0);
      const contentLeft = stageRect.left + metrics.width.left * scale;
      const contentRight = stageRect.left + metrics.width.right * scale;
      outsideStage = Math.max(0, stageRect.left - contentLeft, contentRight - stageRect.right);
      outsideSlide = Math.max(0, availableLeft - contentLeft, contentRight - availableRight);
      availableWidth = Math.max(availableRight - availableLeft, 0);
    } catch {}
    return { outsideStage, outsideSlide, availableWidth };
  }
  function fitLabel(s) {
    let title = s.title;
    try {
      title = title || s._stage.querySelector("h1, h2, h3").textContent;
    } catch {}
    title = title ? String(title).replaceAll(/\s+/g, " ").trim() : "";
    return "slide " + (s._i + 1) + (title ? ' "' + title + '"' : "");
  }
  function fitValue(value, places) {
    return Number.isFinite(value) ? value.toFixed(places) : "unknown";
  }
  function warnFit(s, kind, message) {
    try {
      const key = s._i + ":" + kind;
      if (fitWarnings.has(key)) {
        return;
      }
      fitWarnings.add(key);
      if (typeof console !== "undefined" && typeof console.warn === "function") {
        console.warn("[Present] " + fitLabel(s) + ": " + message);
      }
    } catch {}
  }
  function diagnoseFit(s, metrics, floor, scale, horizontal) {
    try {
      if (metrics.requiredScale < floor - 0.001) {
        warnFit(
          s,
          "minimum-scale",
          "measured content " +
            fitValue(metrics.width.width, 0) +
            "×" +
            fitValue(metrics.height, 0) +
            "px in " +
            fitValue(metrics.availW, 0) +
            "×" +
            fitValue(metrics.availH, 0) +
            "px requires scale " +
            fitValue(metrics.requiredScale, 3) +
            ", below minScale " +
            fitValue(floor, 3) +
            '. Lower minScale, use layout: "wide", or split the slide.',
        );
      }
      if (horizontal.outsideStage > 1 || horizontal.outsideSlide > 1) {
        warnFit(
          s,
          "horizontal-overflow",
          "after fitting at scale " +
            fitValue(scale, 3) +
            ", measured content width " +
            fitValue(metrics.width.width * scale, 0) +
            "px exceeds the stage by " +
            fitValue(horizontal.outsideStage, 0) +
            "px and the available slide width " +
            fitValue(horizontal.availableWidth, 0) +
            "px by " +
            fitValue(horizontal.outsideSlide, 0) +
            'px. Reduce fixed/min widths, use layout: "wide", or split the slide; horizontal scrolling is enabled when unavoidable.',
        );
      }
    } catch {}
  }
  // The scale this slide alone would take. Every slide is laid out (the deck
  // Hides inactive slides with visibility/opacity, never display:none), so a
  // Group sibling can be measured before it is ever shown.
  function naturalScale(s) {
    return naturalMetrics(s).scale;
  }
  function minimumScale(s) {
    // Browser presentation can preserve a legibility floor and let an
    // oversized slide scroll. A static exported slide cannot scroll, so it
    // must use the measured fit and keep the complete authored state visible.
    if (document.body.classList.contains("pr-exporting")) {
      return 0;
    }
    const component = Number.parseFloat(
      window.getComputedStyle(s._stage).getPropertyValue("--pr-min-scale"),
    );
    return Math.max(
      s.minScale || MIN_SCALE,
      Number.isFinite(component) ? Math.max(0, Math.min(MAX_SCALE, component)) : 0,
    );
  }
  // Scale-lock: a split diagram is ONE diagram, so its parts may not zoom
  // Relative to each other. Every member of a continuation group is laid out
  // At the smallest scale any member needs, which lands each shared column on
  // The same pixel across the transition (measured before: 0.956 → 1.000, so
  // Every actor column jumped ~26px sideways mid-story). An ungrouped slide
  // Has exactly one member, and then this reduces — term for term — to the
  // Scale it has always taken: Present's frozen geometry is preserved.
  function fit(s) {
    const group = groups[s._i];
    let floor = minimumScale(s);
    // A member's worst-case step height has to exist before its scale can be
    // Read, or the group would agree on a number that changes the moment the
    // Sibling is walked. Cached (and re-measured together after a resize).
    if (group) {
      group.forEach(function (i) {
        measureSteps(slides[i]);
      });
    }
    const metrics = naturalMetrics(s);
    const mine = metrics.scale;
    let scale = mine;
    if (group) {
      group.forEach((i) => {
        scale = Math.min(scale, naturalScale(slides[i]));
        floor = Math.max(floor, minimumScale(slides[i]));
      });
    }
    // Below the floor the slide keeps the floor scale and scrolls instead —
    // Decided per member, since only the member that overruns needs the
    // Escape hatch; the scale the group agreed on is still what it renders at.
    const scrolls = mine < floor;
    if (scale < floor) {
      scale = floor;
    }
    const scrollsX = metrics.widthScale < scale - 0.001;
    s._slide.classList.toggle("pr-scroll", scrolls);
    s._slide.classList.toggle("pr-scroll-x", scrollsX);
    s._slide.tabIndex = scrolls || scrollsX ? 0 : -1;
    s._stage.style.marginLeft =
      scrollsX && metrics.width.left < 0 ? `${-metrics.width.left * scale}px` : "";
    s._stage.style.transformOrigin = scrollsX
      ? scrolls
        ? "top left"
        : "center left"
      : scrolls
        ? "top center"
        : "center center";
    // Transform does not shrink the layout box — collapse the leftover so
    // The scroll height matches what is visually there.
    s._stage.style.marginBottom = scrolls ? `${-(1 - scale) * s._stage.offsetHeight}px` : "";
    s._stage.style.transform = scale === 1 ? "none" : "scale(" + scale + ")";
    let horizontal = fittedHorizontal(s, metrics, scale);
    if (horizontal.outsideSlide > 1 && !scrollsX) {
      s._slide.classList.add("pr-scroll-x");
      s._slide.tabIndex = 0;
      s._stage.style.marginLeft = metrics.width.left < 0 ? `${-metrics.width.left * scale}px` : "";
      s._stage.style.transformOrigin = scrolls ? "top left" : "center left";
      horizontal = fittedHorizontal(s, metrics, scale);
    }
    diagnoseFit(s, metrics, floor, scale, horizontal);
    s._scale = scale;
  }
  function refit() {
    const s = slides[cur];
    requestAnimationFrame(() => {
      fit(s);
      s._slide.scrollTop = 0;
    });
  }

  function hostScore(s, host) {
    let score = s._stage && s._stage.contains(host) ? 4 : 0;
    (s.pick || []).forEach((selector) => {
      var node = null;
      try {
        node = document.querySelector(selector);
      } catch {}
      if (!node) {
        return;
      }
      if (node === host) {
        score = Math.max(score, 4);
      } else if (host.contains(node)) {
        score = Math.max(score, 3);
      } else if (node.contains(host)) {
        score = Math.max(score, 1);
      }
    });
    return score;
  }
  function invalidateComponent(host, count, requestedStep) {
    if (!host) {
      return false;
    }
    const scores = slides.map(function (s) {
      return hostScore(s, host);
    });
    const best = Math.max.apply(Math, scores);
    if (!best) {
      return false;
    }
    const affected = [];
    scores.forEach((score, i) => {
      if (score === best) {
        affected.push(i);
      }
    });
    affected.forEach((i) => {
      var s = slides[i];
      if (s.steps && Number.isInteger(count) && count > 0) {
        s.steps.count = count;
      }
      if (Number.isInteger(requestedStep) && requestedStep >= 0) {
        s._requestedStep = requestedStep;
      }
      s._maxH = 0;
      s._maxW = null;
      s._scale = null;
      var group = groups[i];
      if (group) {
        group.forEach(function (member) {
          slides[member]._scale = null;
        });
      }
    });
    renderProgressTicks();
    if (presenting() && affected.includes(cur)) {
      const current = slides[cur];
      step = Math.min(
        Number.isInteger(requestedStep) && requestedStep >= 0 ? requestedStep : step,
        stepCount(current) - 1,
      );
      if (current.steps) {
        current.steps.go(step);
      }
      delete current._requestedStep;
      syncHud();
      refit();
      persist();
    }
    return true;
  }

  function replaceComponentSteps(host, driver) {
    if (!host || presenting()) {
      return false;
    }
    const scores = slides.map(function (slide) {
      return hostScore(slide, host);
    });
    const best = Math.max.apply(Math, scores);
    if (!best) {
      return false;
    }
    // Same floor initPresent applies to a slide's own driver: a zero or
    // negative count would make totalSteps() invalid and strand the HUD.
    const steps =
      driver &&
      typeof driver.go === "function" &&
      Number.isInteger(driver.count) &&
      driver.count > 0
        ? driver
        : null;
    scores.forEach(function (score, index) {
      if (score !== best) {
        return;
      }
      if (steps) {
        slides[index].steps = steps;
      } else {
        delete slides[index].steps;
      }
      slides[index]._maxH = 0;
      slides[index]._maxW = null;
      slides[index]._scale = null;
    });
    resetDeck();
    return true;
  }

  function syncHud() {
    const s = slides[cur];
    countEl.textContent = `${logicalSlideNumber(cur)} / ${logicalSlideCount()}`;
    barEl.firstChild.style.width = `${((stepsBefore(cur) + step + 1) / totalSteps()) * 100}%`;
    prevBtn.disabled = cur === 0 && step === 0;
    nextBtn.disabled = cur === slides.length - 1 && step === stepCount(s) - 1;
  }
  function show(i, dir, initial) {
    const continuing = !initial && i !== cur && groups[i] && groups[i].includes(cur);
    deck.classList.toggle("pr-continuing", Boolean(continuing));
    cur = i;
    const s = slides[i];
    s._slide.scrollLeft = 0;
    slides.forEach((o, j) => {
      o._slide.classList.toggle("active", j === i);
      o._slide.setAttribute("aria-hidden", j === i ? "false" : "true");
    });
    step = Number.isInteger(s._requestedStep)
      ? Math.min(s._requestedStep, stepCount(s) - 1)
      : dir < 0
        ? stepCount(s) - 1
        : 0;
    delete s._requestedStep;
    if (s.steps) {
      measureSteps(s);
      s.steps.go(step);
    }
    // A plain CSS @keyframes fade+blur, retriggered by a class bounce — not
    // MOTION.animate(). After enough WAAPI .animate() calls land on distinct
    // .pr-stage elements in one session, Chromium can paint a slide fully
    // Transparent forever after (computed opacity reads 1; nothing is
    // Actually drawn) — reproduced with decks of 8+ slides. A plain CSS
    // Animation doesn't hit that path.
    if (!REDUCED_MOTION) {
      s._stage.classList.remove("pr-entering");
      s._stage.getBoundingClientRect();
      s._stage.classList.add("pr-entering");
    }
    syncHud();
    refit();
    persist();
  }
  function nextSlide() {
    const s = slides[cur];
    if (s.steps && step < s.steps.count - 1) {
      step++;
      s.steps.go(step);
      syncHud();
      refit();
      persist();
    } else if (cur < slides.length - 1) {
      show(cur + 1, 1);
    }
  }
  function prev() {
    const s = slides[cur];
    if (s.steps && step > 0) {
      step--;
      s.steps.go(step);
      syncHud();
      refit();
      persist();
    } else if (cur > 0) {
      show(cur - 1, -1);
    }
  }

  function enter(target) {
    if (!deck) {
      build();
    }
    savedScroll = window.scrollY;
    const start =
      target && typeof target.slide === "number"
        ? target
        : (function () {
            var at = slideForScroll(),
              stored = storedPos();
            // Re-entering from the section you exited on: resume its fragment step too.
            // Compare anchors, not indices — when one <section> is split across
            // several slides (SKILL.md's "long section → split across slides"),
            // slideForScroll()'s earliest-wins tie-break always resolves `at` to
            // the FIRST slide of that section, never a later one, so comparing
            // indices directly could never match a `stored.slide` pointing at
            // slide 2+ of that section and silently fell back to slide 1.
            if (stored && anchorEl(slides[stored.slide]) === anchorEl(slides[at])) {
              return stored;
            }
            return { slide: at, step: 0 };
          })();
    if (Number.isInteger(slides[start.slide]._requestedStep)) {
      start.step = slides[start.slide]._requestedStep;
    }
    entrySlide = start.slide;
    adopt();
    document.body.classList.add("presenting");
    btn.textContent = "✕";
    btn.setAttribute("aria-label", "Exit presentation (Esc)");
    show(start.slide, 1, true);
    const s = slides[cur];
    if (s.steps && start.step > 0) {
      step = Math.min(start.step, s.steps.count - 1);
      s.steps.go(step);
      syncHud();
      refit();
      persist();
    }
    deck.focus();
    wakeHud();
    showHint();
    window.dispatchEvent(new CustomEvent("kitpresentchange", { detail: { presenting: true } }));
  }
  function exit() {
    const leftAt = cur;
    hideHint();
    hintShown = false;
    document.body.classList.remove("presenting");
    btn.textContent = "▶";
    btn.setAttribute("aria-label", "Present (P)");
    slides.forEach((s) => {
      s._slide.classList.remove("active");
    });
    restore();
    if (!IS_FILE) {
      try {
        history.replaceState(null, "", location.pathname + location.search);
      } catch {}
    }
    try {
      sessionStorage.removeItem(`${STORE_KEY}:presenting`);
    } catch {}
    if (leftAt === entrySlide) {
      window.scrollTo({ behavior: "instant", top: savedScroll });
    } else {
      // Anchor the page to the slide you left on, so read view and a
      // Future re-enter both resume there.
      const el = anchorEl(slides[leftAt]);
      if (el) {
        window.scrollTo({
          top: el.getBoundingClientRect().top + window.scrollY - 72,
          behavior: "instant",
        });
      }
    }
    window.dispatchEvent(
      new CustomEvent("kitpresentchange", {
        detail: { presenting: false, anchor: anchorEl(slides[leftAt]) },
      }),
    );
  }
  function toggle() {
    if (presenting()) {
      exit();
    } else {
      enter();
    }
  }
  // Fullscreen may be missing (old browser) or policy-disabled (some embeds):
  // FullscreenEnabled is the standard gate, but stays undefined on browsers
  // That never shipped it — treat undefined as "allowed".
  function fsSupported() {
    return (
      Boolean(document.documentElement.requestFullscreen) && document.fullscreenEnabled !== false
    );
  }
  function goFullscreen() {
    if (document.fullscreenElement || !fsSupported()) {
      return;
    }
    const p = document.documentElement.requestFullscreen();
    if (p && p.catch) {
      p.catch(function () {});
    } // Gesture-less resume paths reject; ignore
  }

  function wakeHud() {
    if (!hud) {
      return;
    }
    hud.classList.remove("idle");
    clearTimeout(hudTimer);
    hudTimer = setTimeout(() => {
      hud.classList.add("idle");
    }, 3000);
  }
  // A once-per-session pill surfacing the F = fullscreen binding, which is
  // Otherwise undiscoverable. Reuses the .pr-hud idle-fade pattern; never
  // Shown when already fullscreen, when fullscreen can't work, or once
  // Fullscreen begins.
  function hideHint() {
    if (hintEl) {
      hintEl.classList.add("idle");
    }
    clearTimeout(hintTimer);
  }
  function showHint() {
    if (!hintEl || hintShown || document.fullscreenElement || !fsSupported()) {
      return;
    }
    hintShown = true;
    hintEl.classList.remove("idle");
    hintTimer = setTimeout(hideHint, 3500);
  }

  btn.addEventListener("click", toggle);
  window.addEventListener("kitcomponentchange", (event) => {
    var detail = event && event.detail ? event.detail : {};
    invalidateComponent(detail.host, detail.count, detail.step);
  });
  function invalidateAppearance() {
    slides.forEach(function (s) {
      s._maxH = 0;
      s._maxW = null;
      s._scale = null;
    });
    if (presenting()) {
      refit();
    }
  }
  window.addEventListener("kitappearancechange", invalidateAppearance);
  window.addEventListener("resize", invalidateAppearance);
  window.addEventListener("mousemove", () => {
    if (presenting()) {
      wakeHud();
    }
  });
  document.addEventListener("fullscreenchange", () => {
    if (document.fullscreenElement) {
      hideHint();
    }
  });
  function scrollActiveSlide(e) {
    const slide = slides[cur]._slide;
    if (e.target !== slide && e.target !== deck) {
      return false;
    }
    if (!slide.classList.contains("pr-scroll") && !slide.classList.contains("pr-scroll-x")) {
      return false;
    }
    const maxX = Math.max(0, slide.scrollWidth - slide.clientWidth);
    const maxY = Math.max(0, slide.scrollHeight - slide.clientHeight);
    if (e.key === "ArrowRight" && slide.scrollLeft < maxX - 1) {
      slide.scrollBy({ left: 80, behavior: "smooth" });
      return true;
    }
    if (e.key === "ArrowLeft" && slide.scrollLeft > 1) {
      slide.scrollBy({ left: -80, behavior: "smooth" });
      return true;
    }
    if (e.key === "ArrowDown" && slide.scrollTop < maxY - 1) {
      slide.scrollBy({ top: 80, behavior: "smooth" });
      return true;
    }
    if (e.key === "ArrowUp" && slide.scrollTop > 1) {
      slide.scrollBy({ top: -80, behavior: "smooth" });
      return true;
    }
    return false;
  }
  window.addEventListener("keydown", (e) => {
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) {
      return;
    } // leave browser/OS shortcuts (Cmd+F, Cmd+P, …) alone
    if (document.querySelector(".zoom-overlay.open")) {
      return;
    } // zoom overlay owns the keys
    if (!presenting()) {
      if (e.key === "p" || e.key === "P") {
        toggle();
        e.preventDefault();
      } else if (e.key === "f" || e.key === "F") {
        enter();
        goFullscreen();
        e.preventDefault();
      }
      return;
    }
    if (scrollActiveSlide(e)) {
      e.preventDefault();
      return;
    }
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
      case " ":
      case "PageDown": {
        nextSlide();
        e.preventDefault();
        break;
      }
      case "ArrowLeft":
      case "ArrowUp":
      case "PageUp": {
        prev();
        e.preventDefault();
        break;
      }
      case "Home": {
        show(0, 1);
        e.preventDefault();
        break;
      }
      case "End": {
        show(slides.length - 1, 1);
        e.preventDefault();
        break;
      }
      case "Escape": {
        e.preventDefault();
        e.stopImmediatePropagation();
        exit();
        break;
      }
      case "f":
      case "F": {
        if (document.fullscreenElement) {
          var ex = document.exitFullscreen();
          if (ex && ex.catch) {
            ex.catch(function () {});
          }
        } else {
          goFullscreen();
        }
        break;
      }
      case "p":
      case "P": {
        toggle();
        break;
      }
      default: {
        break;
      }
    }
  });

  // Deep link / reload while presenting: resume from the hash — except on
  // file://, where the hash is never written (see header note), so a
  // Reload instead resumes from the sessionStorage marker + position.
  const fromHash = parseHash();
  if (fromHash) {
    enter(fromHash);
  } else if (IS_FILE) {
    let wasPresenting = false;
    try {
      wasPresenting = sessionStorage.getItem(`${STORE_KEY}:presenting`) === "1";
    } catch {}
    if (wasPresenting) {
      enter(storedPos() || undefined);
    }
  }
  window.addEventListener("hashchange", () => {
    var h = parseHash();
    if (h && !presenting()) {
      enter(h);
    }
  });

  const hiddenSections = new Map();
  window.__present = {
    captureStates,
    exportStateCount: totalSteps,
    setSectionHidden(section, hidden) {
      if (presenting()) {
        return false;
      }
      if (hidden && !hiddenSections.has(section)) {
        const removed = [];
        for (let i = slides.length - 1; i >= 0; i--) {
          const anchor = anchorEl(slides[i]);
          if (anchor && (section === anchor || section.contains(anchor))) {
            removed.unshift(slides.splice(i, 1)[0]);
          }
        }
        hiddenSections.set(section, removed);
      } else if (!hidden && hiddenSections.has(section)) {
        // Indices recorded at removal go stale once another section is hidden
        // or restored in between, so each slide returns by document order.
        hiddenSections.get(section).forEach((slide) => {
          const anchor = anchorEl(slide);
          let at = slides.length;
          if (anchor) {
            const next = slides.findIndex((other) => {
              const candidate = anchorEl(other);
              return Boolean(
                candidate &&
                anchor.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING,
              );
            });
            at = next === -1 ? slides.length : next;
          }
          slides.splice(at, 0, slide);
        });
        hiddenSections.delete(section);
      }
      return resetDeck();
    },
    enter,
    reorderSections(sections) {
      if (presenting()) {
        return false;
      }
      const rank = (slide) => {
        const anchor = anchorEl(slide);
        const index = sections.findIndex(
          (section) => anchor && (section === anchor || section.contains(anchor)),
        );
        return index === -1 ? sections.length : index;
      };
      slides.sort((a, b) => rank(a) - rank(b));
      return resetDeck();
    },
    searchSources() {
      return adopted.map((record) => ({
        node: record.el,
        section: record.el.matches("section") ? record.el : record.parent.closest("section"),
      }));
    },
    enterAt(element) {
      const index = slides.findIndex((slide) => {
        const anchor = anchorEl(slide);
        return anchor && (anchor === element || element.contains(anchor));
      });
      enter(index !== -1 ? { slide: index, step: 0 } : undefined);
    },
    exit,
    next: nextSlide,
    prev,
    show(i) {
      show(i, 1);
    },
    slideForScroll,
    invalidateComponent,
    replaceComponentSteps,
    insertPreviewBefore,
    removePreview,
    state() {
      return {
        presenting: presenting(),
        slide: cur,
        step,
        slides: slides.length,
        scales: slides.map(function (s) {
          return s._scale || null;
        }),
        // continuation groups (scale-locked members), for rigs and gates
        groups: groups.filter(function (g, i) {
          return g && g[0] === i;
        }),
      };
    },
  };
}
