# Post-share verification

This checklist is for after the assembled page has been shown to the user, or
when they explicitly ask for verification. It is not an initial-share gate.
Initial sharing requires only a successful `assemble.py` run, so the user can
open the explainer in Studio immediately.

Nothing here needs `node`, a browser, or any install — every item is a grep, a
read, or arithmetic on text you already have open. Do not use this checklist to
delay the initial local path.

Two categories of bug this checklist used to have to catch are now structural
guarantees instead — the kit fixes them, not the author:

- **Present mode never blanks a slide.** Early versions used
  `history.replaceState()` to track `#s<slide>.<step>` in the URL and
  `MOTION.animate()` for the slide-entrance fade. Both turned out to cause a
  slide to render fully transparent forever after, under real (not
  hypothetical) conditions on `file://` pages — see `base/present.js`'s header
  comment for the specifics. Present mode now never touches the URL on
  `file://`, and the slide-entrance transition is a plain CSS animation. If
  you didn't hand-roll your own slide-transition code, you can't hit this.
- **A step-driven `.play()` (e.g. `chart` kind `stat`'s count-up) always fires
  on the press that's supposed to trigger it**, not silently on arrival or one
  press early. The component guards against Present's internal
  height-pre-measurement pass and against its own scroll-observer firing
  the instant the deck displays. If you use `steps:{count, go}` with a
  component's `.play()`, it just works — you don't need to reason about when
  `go()` gets called internally.

What's left is authoring-level: content and manifest correctness the kit
can't guess for you.

## 1. The assembler already told you about most mechanical errors

Re-read its output. `assemble.py` dies on: missing/malformed `meta` JSON,
unknown `style`, unknown `component`, a `<script>` tag inside the `content`
slot, an unresolved `@inject:` marker, or any recognized inline or top-level
variable-backed component string beyond its visual budget. Copy diagnostics are
aggregated and name every renderer, exact authored path, complete value, measured
UTF-16 length, limit, and rewrite hint. The agent must repair all of them and
rerun assembly automatically. A clean run means these are already handled—do not
re-check them by hand.

If the rendered page shows the fixed **copy issue** alert, dynamic data escaped
static analysis. Treat the page as failed even though Present remains operable:
repair the reported source field and reassemble before sharing.

## 2. Register sweep (grep, no exceptions)

```sh
grep -inE "revolutionary|seamless|effortless|powerful|unlock|leverage|transform|unprecedented|cutting-edge|next-generation|game-changing|supercharge|blazing|magic(al)?|delightful|robust" explainers/_sources/<topic>.html
```

Any hit is a defect — rewrite the sentence. Also scan for emoji outside the
approved glyph set (`◐ ▶ ✕ ✓ ⤢ ⟲ — · ↑ → ↗`); anything else is decoration
posing as iconography.

## 3. Self-containment (grep)

```sh
grep -nE "<link[^>]*href|<script[^>]*\ssrc=" explainers/<topic>-explainer.html
```

Should return nothing except the one vendored Motion `<script>` block the
assembler injects inline (no `src=`). Any `href=`/`src=` pointing outside the
file breaks the "open via `file://`, works offline" contract.

## 4. Manifest ↔ content cross-check (read both, side by side)

For every entry in the `page-js` `initPresent([...])` manifest:

- Every selector in `pick` resolves to content. The assembler checks exact
  literal `#id` selectors in inline manifests; inspect class selectors,
  computed manifests, and other dynamic forms here.
- If the entry has `steps: {count, go}`, walk `go(0)` in your head (or on
  paper): does the arrival state show something coherent, or does it dump
  the *last* fragment's content in front of the reader before they've heard
  the first beat? (This exact bug shipped once — a stat-and-first-row
  table slide that looked "finished" on arrival because the fragment driver
  didn't shift its index to leave step 0 empty.) The fix, if you find one, is
  almost always: shift the driver's index by one and hide everything at
  `i=0`, the way the roster and table-compare slides in a well-built keynote
  do it — grep `f.go(i-1)` in the source for the pattern.
- `meta.slides` (the array in the `meta` JSON slot) should have one entry per
  slide the manifest actually produces, in the same order, with a `title`
  that matches what that slide's `pick`ed content says. Gallery metadata and
  agents inspecting the source depend on this summary staying truthful.

## 5. Duplicate-content pass (read `meta.slides`, top to bottom)

List every slide's `title` + `point`. Flag any two that make essentially the
same claim — this is a comprehension defect a synthetic-audience cold read
would also catch, but you don't need pixels to see it: if slide N's `point`
restates slide N+1's `point` in fewer or worse words, cut one or merge them.
(This happened once between a "what's deterministic" slide and the CI-gate
detail slide that followed it — same three facts, said twice, worse the
first time. Don't repeat a component's specific enumerated facts on an
earlier slide that's supposed to be setting up the *category*, not the list.)

## 6. Glossary and component consistency (grep, exhaustive)

- Every `data-term="X"` in the content has a `X: {t:…, d:…}` entry in
  `window.GLOSSARY`, and every `GLOSSARY` entry is referenced by at least one
  `data-term`. Orphans in either direction are dead weight or a silent no-op
  button.
- Every dynamic or member-style renderer call has a matching component in
  `meta.components`. The assembler checks known direct literal calls and
  dependency expansion; review forms it deliberately cannot prove.
- Every generated or dynamic `id` remains unique. Literal content IDs are
  rejected by the assembler when duplicated.

## 7. Prose and diagram budgets (arithmetic, no rendering needed)

- Strip tags from each slide's picked content and count visible characters.
  Both styles (keynote, playful) are built one-idea-per-slide: flag anything
  over ~600 (the verifier's hard fail line is 900). Over budget → split the
  slide or move detail into a `<details>`/glossary term.
- Any bespoke (non-`flow`-component) SVG: check the `viewBox` width is
  ≥1000 for a full-width diagram, and grep it for `font-size:` values below
  12px. Both are static properties of the markup — no rendering required to
  check them.

## 8. Say what you checked

In your final response to the user, name which of the above you ran and what
you found — don't just say "verified."
