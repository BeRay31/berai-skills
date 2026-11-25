/* ── Kit app: theme · reveals · glossary ──────────────────────────────
   Motion (vendored, window.Motion) drives reveals and swaps when the
   user allows animation; the CSS classes in base.css are the fallback,
   so the page degrades gracefully if Motion ever fails to parse. */
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const MOTION = !REDUCED_MOTION && window.Motion ? window.Motion : null;

/* Theme */
(function () {
  let saved = null;
  try {
    saved = localStorage.getItem("explainer-theme");
  } catch {}
  if (saved === "light" || saved === "dark") {
    document.documentElement.dataset.theme = saved;
  }
  document.querySelector("#themeToggle").addEventListener("click", () => {
    var h = document.documentElement;
    h.dataset.theme = h.dataset.theme === "light" ? "dark" : "light";
    try {
      localStorage.setItem("explainer-theme", h.dataset.theme);
    } catch {}
  });
})();

/* Scroll reveal — Motion when available, CSS transition otherwise */
(function () {
  const els = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
  if (REDUCED_MOTION) {
    els.forEach((el) => {
      el.classList.add("is-visible");
    });
    return;
  }
  const obs = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) {
          return;
        }
        obs.unobserve(e.target);
        revealNow(e.target);
      });
    },
    { threshold: 0.08 },
  );
  els.forEach((el) => {
    obs.observe(el);
  });
  function delayOf(el) {
    const m = el.className.match(/reveal-delay-(\d)/);
    return m ? Math.trunc(Number(m[1])) * 0.07 : 0;
  }
  function revealNow(el) {
    if (MOTION) {
      el.style.transition = "none"; // Hand control to Motion
      el.classList.add("is-visible");
      MOTION.animate(
        el,
        { opacity: [0, 1], transform: ["translateY(46px)", "translateY(0px)"] },
        { delay: delayOf(el), duration: 0.9, ease: [0.16, 1, 0.3, 1] },
      );
    } else {
      el.classList.add("is-visible");
    }
  }
  window.__revealAll = function __revealAll() {
    // Present mode adopts nodes mid-scroll
    els.forEach((el) => {
      obs.unobserve(el);
      el.style.transition = "none";
      el.style.opacity = "";
      el.style.transform = "";
      el.classList.add("is-visible");
    });
  };
})();

/* Panel swap — retrigger entry animation on a detail panel.
   Race-proof: rapid successive swaps (Present-mode step measuring, fast
   clicking) stop the previous run and always clear inline styles at the
   end, so content can never be stranded invisible mid-animation. */
const swapInLive = new WeakMap();
function swapIn(el) {
  if (REDUCED_MOTION || window.__kitMeasuring) {
    return;
  }
  if (MOTION) {
    const prev = swapInLive.get(el);
    if (prev) {
      try {
        prev.forEach((c) => {
          c.stop();
        });
      } catch {}
    }
    const targets = el.children.length ? Array.prototype.slice.call(el.children) : [el];
    targets.forEach((t) => {
      t.style.opacity = "";
      t.style.transform = "";
    });
    const controls = targets.map(function (t, i) {
      return MOTION.animate(
        t,
        { opacity: [0, 1], transform: ["translateY(7px)", "translateY(0px)"] },
        { duration: 0.32, delay: i * 0.04, ease: [0.16, 1, 0.3, 1] },
      );
    });
    swapInLive.set(el, controls);
    setTimeout(
      () => {
        if (swapInLive.get(el) !== controls) {
          return;
        }
        targets.forEach(function (t) {
          t.style.opacity = "";
          t.style.transform = "";
        });
        swapInLive.delete(el);
      },
      32 + targets.length * 40 + 320,
    );
  } else {
    el.classList.remove("swap");
    el.getBoundingClientRect();
    el.classList.add("swap");
  }
}

/* Glossary — page defines window.GLOSSARY = { key: {t, d} } */
const glossPop = document.querySelector("#glossPop");
let glossOpenFor = null;
function openGloss(btn) {
  const g = (window.GLOSSARY || {})[btn.dataset.term];
  if (!g) {
    return;
  }
  glossPop.querySelector(".gloss-pop-term").textContent = g.t;
  glossPop.querySelector(".gloss-pop-body").innerHTML = g.d;
  glossPop.classList.add("open");
  glossOpenFor = btn;
  btn.setAttribute("aria-expanded", "true");
  const r = btn.getBoundingClientRect();
  const pw = glossPop.offsetWidth,
    ph = glossPop.offsetHeight;
  let left = window.scrollX + r.left + r.width / 2 - pw / 2;
  left = Math.max(
    window.scrollX + 12,
    Math.min(left, window.scrollX + document.documentElement.clientWidth - pw - 12),
  );
  let top = window.scrollY + r.bottom + 10;
  if (r.bottom + ph + 16 > window.innerHeight) {
    top = window.scrollY + r.top - ph - 10;
  }
  glossPop.style.left = `${left}px`;
  glossPop.style.top = `${top}px`;
}
function closeGloss() {
  if (!glossOpenFor) {
    return;
  }
  glossPop.classList.remove("open");
  glossOpenFor.setAttribute("aria-expanded", "false");
  glossOpenFor = null;
}
document.addEventListener("click", (e) => {
  var btn = e.target.closest(".term");
  if (btn) {
    e.preventDefault();
    if (glossOpenFor === btn) {
      closeGloss();
    } else {
      openGloss(btn);
    }
    return;
  }
  if (glossOpenFor && !glossPop.contains(e.target)) {
    closeGloss();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeGloss();
  }
});
window.addEventListener(
  "scroll",
  () => {
    if (glossOpenFor && !document.body.classList.contains("presenting")) {
      closeGloss();
    }
  },
  { passive: true },
);

(function () {
  const warnedAt = new WeakMap();

  function isVectorImage(img) {
    const source = img.currentSrc || img.getAttribute("src") || "";
    return /^data:image\/svg\+xml(?:[;,]|$)/i.test(source) || /\.svgz?(?:[?#]|$)/i.test(source);
  }

  function auditImage(img) {
    if (!img.complete || !img.naturalWidth || !img.naturalHeight) {
      return;
    }
    if (isVectorImage(img)) {
      delete img.dataset.upscaled;
      warnedAt.delete(img);
      return;
    }
    const rect = img.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }
    const upscaled = rect.width > img.naturalWidth + 0.5 || rect.height > img.naturalHeight + 0.5;
    if (!upscaled) {
      delete img.dataset.upscaled;
      warnedAt.delete(img);
      return;
    }
    img.dataset.upscaled = "true";
    const renderedW = Math.round(rect.width);
    const renderedH = Math.round(rect.height);
    const bucketW = Math.round(renderedW / 50) * 50;
    const bucketH = Math.round(renderedH / 50) * 50;
    const signature = `${bucketW}x${bucketH}:${img.naturalWidth}x${img.naturalHeight}`;
    if (warnedAt.get(img) === signature) {
      return;
    }
    warnedAt.set(img, signature);
    const images = Array.prototype.slice.call(document.images);
    const imageNumber = images.indexOf(img) + 1;
    const captureW = Math.ceil(rect.width * 2);
    const captureH = Math.ceil(rect.height * 2);
    console.warn(
      `[explainer] Raster image ${imageNumber} is upscaled from ${img.naturalWidth}×${img.naturalHeight}px to ${renderedW}×${renderedH}px. Replace it with a higher-resolution source; prefer a ${captureW}×${captureH}px (2x) capture for presentation. Find it in Studio/review with [data-upscaled="true"].`,
    );
  }

  function auditImages() {
    Array.prototype.forEach.call(document.images, auditImage);
  }

  function scheduleAudit() {
    requestAnimationFrame(auditImages);
  }

  function scheduleImageAudit(img) {
    requestAnimationFrame(() => {
      auditImage(img);
    });
  }

  let imageResizeObserver = null;
  if (typeof ResizeObserver === "function") {
    imageResizeObserver = new ResizeObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.target.isConnected === false) {
          imageResizeObserver.unobserve(entry.target);
          return;
        }
        scheduleImageAudit(entry.target);
      });
    });
  }

  function watchImage(img) {
    if (img.closest && img.closest(".zoom-overlay")) {
      return;
    }
    if (imageResizeObserver) {
      imageResizeObserver.observe(img);
    }
    if (img.complete) {
      scheduleImageAudit(img);
    }
  }

  document.addEventListener(
    "load",
    (e) => {
      if (e.target && e.target.tagName === "IMG") {
        watchImage(e.target);
      }
    },
    true,
  );
  window.addEventListener("load", scheduleAudit);
  window.addEventListener("resize", scheduleAudit);
  window.addEventListener("kitpresentchange", scheduleAudit);
  Array.prototype.forEach.call(document.images, watchImage);
})();
