# `/explainer`

A self-contained, portable skill for shaping stories and building interactive
HTML explainers. Interactive product sketches live in [`/sketch`](../sketch/).
Everything needed lives in this directory — copy `.factory/skills/explainer/`
into any repo and it works. No npm install, no network: the assembler is
stdlib-only Python (**Python 3.9 or newer** — check with `python3 --version`),
and third-party browser libraries are pinned and vendored locally. Assembled
explainers inline Motion; Studio also loads PptxGenJS for offline export.
The pinned PptxGenJS 4.0.1 bundle carries the two serializer fixes from upstream
[PR #1458](https://github.com/gitbrent/PptxGenJS/pull/1458) so generated decks do
not declare phantom slide masters or invalid notes-master placeholders.

**The contract: modular source, monolithic output.** You author one small
content source in the *target* repo (e.g. `explainers/_sources/<topic>.html`);
`assemble.py` splices it together with this skill into a **single
self-contained `.html`** — inline CSS + JS, vendored animation library, zero
external runtime dependencies. (Screenshots are embedded as base64 data URIs
too, but `assemble.py` doesn't do that conversion — you base64-encode them
yourself before writing the content slot; see SKILL.md's "Screenshots"
section. The assembler only splices already-authored slots together, it
never rewrites assets.) The file works offline and can be shared as-is.

The one recipe, `recipe:"explainer"`, organizes a narrative with slides and
Present mode into one self-contained interactive HTML file. Requests for a
clickable fake-product experience belong to `/sketch`, which owns its own shell,
components, assembler, and safety contract.

The skill holds no project-specific content: everything it produces goes to
`explainers/` in the host repo, which stays a plain output directory (plus
the `explainers/_sources/` content sources you author) — nothing from the
skill itself lives there. Dropping this folder into another repo and pointing
`assemble.py` at a new content source is the whole port.

See `SKILL.md` for the full authoring workflow (the four slots, tone rules,
narrative arcs, Present-mode composition, verification). This file is the
map of what lives where.

**Existing explainer?** Studio's **Upgrade** rebuilds from its original or embedded
source and adds the current component controls. Layout and Content spacing
previews need no model call. Apply the review and rebuild before sharing the HTML;
upgrading alone does not apply pending feedback. See the
[layout field reference](references/CONTRACTS.md#layout-previews-and-older-explainers)
when baking a selected composition into the source.

**Need to edit individual parts?** Double-click the visual, or open **Arrange**
and double-click it there. Studio exposes supported catalog and captured visuals
as editable shapes and text without changing the source until the first edit;
see the [authoring contract](references/CONTRACTS.md#direct-visual-editing) for
its freeform editing, reset, and portability boundaries.

## Entry behavior

A bare `/explainer` reads the adjacent `VERSION`, shows
`Explainer · v<version>`, then starts an `AskUser` intent choice before any
other content discovery:

- **Open Studio for existing explainers** — open the `explainers/` Gallery or a
  named page immediately; never run a new-page interview first.
- **Shape the story in ASCII first** — iterate audience, conclusion, evidence,
  and 3–7 beats without creating files until the user chooses to build.
- **Create an explainer from an idea** — ask once for missing readiness fields,
  then assemble and open the first share in Studio.
- **Build from material I’ll provide** — use only named/pasted material and let
  the user choose ASCII shaping or a first draft when its arc is unclear.

An explicit task or supplied material bypasses this bare-entry choice and
continues with that stated intent. New explainers still resolve audience and a
concrete conclusion/decision/action before source/style questions; a topic or
event description alone does not satisfy the outcome.

## Layout

```text
.factory/skills/explainer/
├── SKILL.md              the authoring workflow — read this first
├── README.md             this file — layout and quick reference
├── references/
│   ├── CONTRACTS.md      data contracts for every component
│   ├── CRITIQUE.md       the synthetic-audience review protocol (cold-read critique)
│   ├── DESIGN.md         the design guide — read before custom devices, style forks, or contributing
│   └── VERIFICATION.md   the verification checklist — agent-driven, nothing installed
├── VERSION               skill version, stamped into every assembled page
├── assemble.py           python3 (stdlib) assembler: source → .html
├── review.py             python3 (stdlib) review server: Notes, A/B flip, design tuner
├── review/               review UI plus the small Studio persistence boundary (store.js)
├── studio.py             review.py + deterministic panel: themes and component editing
├── studio/               the studio panel's UI as editable files (studio.css, studio.js)
├── template.html         page skeleton with @inject markers
├── styles/               one token file per look & feel
│   ├── keynote.css       big type, one idea per slide (default)
│   └── playful.css       vivid accents, rounded geometry
├── base/
│   ├── base.css          shared substrate (shell, hero, flags, glossary, code…)
│   ├── present.css       Present-mode deck chrome
│   ├── zoom.css          diagram-zoom overlay
│   ├── app.js            theme · Motion reveals (CSS fallback) · glossary
│   ├── present.js        Present mode with scroll↔slide anchoring + resume
│   └── zoom.js           click-to-expand, wheel-zoom, drag-pan for [data-zoom]
├── components/           flat data-driven partials (see references/CONTRACTS.md)
│   ├── _core.js          explicit dependency-free runtime shared by component files
│   ├── text-caps.json    canonical visual string budgets for assembly + runtime diagnostics
│   ├── geo-world.js      vendored world geometry for chart kind `map` (opt-in; ~95 KB)
│   ├── architecture.js   system maps plus the purpose-built operating-model stage
│   ├── data-flow.js      shared pulse-engine infra for the architecture family
│   └── …                 narrative, section, table, tree, chart, stepper, flow,
│                         roadmap, code, loop, iceberg, pyramid, and more
├── vendor/
│   ├── motion-12.23.26.min.js   pinned Motion (motion.dev) UMD build
│   ├── pptxgenjs-4.0.1.bundle.js pinned browser build with upstream PR #1458 backported
│   ├── pptxgenjs-4.0.1.LICENSE.txt upstream MIT license
│   └── make-geo-world.mjs        regenerates components/geo-world.js (build-time only)
├── reference-sources/
│   ├── hello-kit.html           explainer source, all four slots
│   └── component-showcase.html  source for the showcase (assemble to refresh)
├── showcase/
│   └── components.html          pre-assembled: every component with sample data (open in a browser)
```

## Authoring workflow (quick reference — SKILL.md has the full version)

1. Write one content source, e.g. `explainers/_sources/<topic>.html`, with a
   visible banner (so opening it raw in a browser explains itself instead of
   rendering blank) followed by the four slots:

```html
<p style="font:15px/1.6 -apple-system,sans-serif;max-width:640px;margin:40px auto;padding:18px 22px;border:1px solid #b45309;color:#78350f;background:#fffbeb">
  <strong>Note:</strong> this is an <code>/explainer</code> content source, not a finished page —
  assemble it first (see <code>.factory/skills/explainer/README.md</code>):<br>
  <code>python3 .factory/skills/explainer/assemble.py explainers/_sources/&lt;topic&gt;.html</code>
</p>

<script type="application/json" data-slot="meta">
{
  "title":  "Example topic — a keynote explainer",
  "recipe": "explainer",
  "style":  "keynote",
  "theme":  "dark",
  "components": ["section", "flow", "table"],
  "output": "explainers/example-topic-keynote-explainer.html",
  "thesis": "One-line thesis for the deck",
  "slides": [{"kicker":"01 · The loop", "title":"…", "point":"one-line takeaway"}],
  "facts":  ["key fact"],
  "links":  [{"label":"Epic #25", "href":"https://…"}]
}
</script>

<template data-slot="content">
  <!-- sections only; no <script> here -->
</template>

<style data-slot="page-css">
  /* topic-specific devices only — the skill already ships everything shared */
</style>

<script data-slot="page-js">
  // GLOSSARY, component render calls, custom interactions, initPresent([...])
</script>
```

For a clickable product simulation, stop and use `/sketch`; its source schema,
components, safety disclosure, and assembler are intentionally separate.

Every new explainer opens with a `section` component in `mode:'cover'`, using
one of its supported background patterns. The section host is the first content
section and the first Present manifest entry with `layout:'cover'`.

1. Assemble (from the repo root):

```sh
python3 .factory/skills/explainer/assemble.py explainers/_sources/<topic>.html
```

This writes the self-contained `.html` and prints how much of the page came from the skill vs
was authored — the reuse win, measured.

1. Open Studio immediately after assembly and return its local URL first. The
   editable page is the handoff; return the `.html` path only if Studio cannot
   start. Do not delay the first share for verification or critique. Remind the
   user that they can ask for changes in plain language or leave Notes in Studio.

1. Verify or critique after sharing — offer `references/VERIFICATION.md` or
   `references/CRITIQUE.md` once the user has opened the page, requests a
   check, or asks for stakeholder-ready review.

## Variants and the review loop

Two flags and one tool turn "which design do you want?" into a browser choice
— no Node, no npm, nothing beyond the same python3 the assembler uses:

```sh
# Two designs from one source (outputs get a -<style> suffix):
python3 .factory/skills/explainer/assemble.py explainers/_sources/<topic>.html --variants keynote,playful

# serve them with the review overlay — A/B flip, location-aware Notes,
# live design tuner (type scale, content spacing, text width, accent, and the
# Adyen brand preset), winner pick:
python3 .factory/skills/explainer/review.py explainers/<topic>-explainer-keynote.html explainers/<topic>-explainer-playful.html
```

`review.py` never modifies the files it serves — the overlay is injected per
request. Feedback lands in `explainers/_reviews/<name>/review.md`, anchored by
section, selector, and text snippet, so the reviewer can finish with one
sentence to their agent: *"Apply the review in explainers/_reviews/<name>/review.md"*.
Re-assemble and refresh to see the next iteration; notes persist.
`--style <name>` assembles a single alternate look without editing the source.
See SKILL.md's "Design variants and the review loop" for how to apply a review.

**The studio** is the same loop with deterministic one-click tweaks on top —
things that shouldn't cost a model round-trip:

```sh
python3 .factory/skills/explainer/studio.py explainers/<topic>-explainer.html
```

A left-edge panel adds **look flips** (one click re-assembles the page from
its content source in another style, sub-second, previews cached in the
ignored `_reviews/` dir) and **component editing**: one accordion per adjustable
component, with its own motion preview and registered choices (for example, a
chart can keep key items or labels, while architecture-family components can
change layout, detail, and Full/Follow behavior, and a roadmap can switch
between Timeline, Phases, and Workstreams). Every catalog component uses the
same bounded **Content** editor for values and repeatable items. **Edit component**
adds direct canvas handles for Architecture and Operating Model. **Change
visual** opens the component picker. **Arrange** adds editable rectangles,
ellipses, lines, arrows, and text
labels. Click a visual to move it as one object; double-click a supported catalog
or captured visual to expose editable shapes and text. This preview stays
transient until the first edit. Automatic layouts, walkthroughs, and semantic
controls pause once freeform editing begins. **Reset visual** returns to the
retained component and discards its freeform edits. Unsupported custom visuals
remain editable as one object. **Save edits**
writes supported text, appearance, component-setting, slide, and composition
changes into the authored source, rebuilds locally, and needs no agent. **Finish**
remains the path for Notes, custom visual work, and changes without a deterministic
editor. The panel's UI lives
in `studio/studio.css` + `studio/studio.js` as plain editable files, re-read
on every request — edit, refresh, done.

**Add item** clones an existing item's fields. If a collection starts empty,
ask the agent to create its first item so the editor has a typed template.

Saved changes use one optional, versioned `authoring` JSON slot in the content
source. Manifest version 2 stores guarded text replacements, semantic appearance tokens,
component settings and normalized frames, grouped native shapes, and bounded authored
slide instances, source-slide visibility/order, and captured component data.
**Add slide** inserts any catalog visual with illustrative placeholder data
locally; it does not need an agent. Original and Studio-authored slides can be
edited, deleted, and reordered before saving, while safely captured visuals can
be duplicated. Every catalog visual uses the same Content editor; renderer-specific
canvas handles are shortcuts over that common baseline. The original component
data remains authoritative until Studio records an edited copy or a detached
replacement. This compact scene layer is what **Export presentation**
translates. Export requires the coordinated Present-mode sequence and turns each
explicit walkthrough state into a consecutive slide. It maps portable text,
shapes, lines, arrows, and paths to native presentation objects without changing
the manifest. Studio never falls back to capturing its editor layout when
Present mode is unavailable. Embedded images remain movable images. Unsupported
content stops the whole export before download rather than becoming a flattened,
incomplete, or partial deck. Studio remains a local, single-user editor; the PPTX
is the Google Slides and PowerPoint handoff. Export resolves Present's fitted
scale into native text, spacing, and border metrics, keeps a small text-box
reserve for importer font differences, and removes interactive walkthrough
controls while retaining each state's static annotation as a native presentation
card. Deeply nested hierarchy components remain bounded by object and text
limits while preserving their editable tree structure. Oversized Present states
fit fully onto the static slide instead of inheriting browser-only scrolling,
visually empty SVG paths are omitted, and horizontally scrolling code wraps so
no source text is hidden in the static handoff. One-sided CSS borders become
native line segments, preserving editable tree and flow connectors instead of
turning them into boxes. SVG fill and stroke opacity remains attached to native
shapes, including a representative translucent fallback for gradients. Animated
stat counters settle on their authored values before every state is captured.
Loop and stepper detail swaps also settle before capture, preventing an
in-progress browser animation from becoming an empty static panel.
Contextual free-form architecture exports omit the duplicate reading-view
reference list so the editable diagram can claim the 16:9 canvas. Section
patterns keep their native geometry while export omits the browser-only
translucent gradient veil that presentation importers would flatten to an opaque
rectangle. Centered section slides replace that veil with a native quiet zone
between the pattern and copy, keeping active pattern marks out of the text.
Exported architecture uses a compact single-row legend and annotation
card so the editable diagram claims more of the 16:9 canvas. Left-aligned text
boxes fit their rendered text plus a small importer reserve instead of extending
to the edge of their original browser container.

Section slides are a separate Studio action, not a component swap. **Add
section** inserts a reversible chapter divider before the chosen slide and keeps
that slide's content intact as the next beat. The picker previews all eight
background patterns (ribbons, dots, arcs, iso, waves, frames, rays, swarm);
existing section slides expose the same pattern choice under component editing.
Section insertion remains a review handoff; ordinary catalog slides are authored
locally. A source component captured from a kit renderer can be edited in place;
a source slide with one captured component can also seed a new local slide. The
copy starts from the captured visual data, not every source text override or
decoration. Multi-visual slides are edited one selected component at a time.

Gallery thumbnails run in opaque-origin `sandbox="allow-scripts"` iframes without
`allow-same-origin`. Preview failures use a source-window, opaque-origin, per-frame
channel message instead of granting the Gallery DOM access to explainer content.
The full Studio page remains the trusted overlay architecture described below.

The studio is a true overlay: it works on any assembled explainer, whenever
and however it was built. Pages stamped with an older kit get an upgrade
card. When the current kit still supports the authored style, one click rebuilds the
page from its own source with the same content and look. When that style has been
removed, Studio asks the reviewer to choose a current style before rebuilding. If the
source predates current component copy limits, the strict attempt explains the conflict
and offers a second, explicit upgrade that keeps the existing copy for later revision. That
compatibility path also normalizes supported legacy component forms so an old flow or
stepper cannot abort the page script and disable later diagrams or Present mode.
Compatibility upgrades carry `copy=legacy-compatible` in their provenance stamp. The
resulting copy-issues control lists each field, its current text, overage, and rewrite hint.
**Show in explainer** reveals the relevant component state. **Add fixes to Notes** puts the
cleanup into the normal review handoff. A reviewer may instead request an exception for one
field; the handoff carries the exact copy, measured length, limit, and required visual check.
All paths keep the previous file in `_reviews/`.

## What to commit, what to ignore

For teams tracking explainers in git:

- **Commit** `explainers/_sources/` — the content source is the real asset —
  and the assembled `.html` pages if you want them shareable from the repo.
- **Ignore** `explainers/_reviews/` — review feedback, studio style previews,
  and other throwaway working files live there. The tools handle this for
  you: they drop a self-ignoring `.gitignore` (`*`) into `_reviews/` on first
  run, so nothing in it ever shows up as untracked noise.

## What the skill fixes for free

- **Present mode keeps your place.** `P` from a scrolled read-view enters on the
  slide for that section (not slide 1). `Esc` anchors the page to the slide you
  left on, so re-entering resumes. On a server-hosted page the URL hash tracks
  `#s<slide>.<step>` while presenting, so reload and shared deep-links land
  back on the same slide. On `file://` — this skill's primary distribution —
  the hash is left alone instead: Chromium's `history.replaceState()`
  same-origin check is unreliable for opaque `file:` origins even on
  fragment-only changes, and was intermittently blanking the active slide
  mid-walk. sessionStorage drives resume there (and always restores the
  fragment step). The slide-entrance transition is a plain CSS `@keyframes`
  animation rather than a JS-driven one, for the same reason (enough
  WAAPI `.animate()` calls in one Present session could corrupt Chromium's
  paint of a later slide). Ships fixed in `base/present.js`; never re-generate it.
- **Diagrams are big and zoomable.** Anything with `data-zoom` gets an expand
  affordance opening a full-viewport overlay: wheel-zoom around the cursor,
  drag-pan, pinch, `+`/`−`/`0`/arrows on the keyboard, `Esc` to close. Works
  inside Present mode too. Screenshot crops reopen as the complete intrinsic
  image. The `flow` component generates journey/gate SVGs on a 1200-wide canvas
  with no text under 15px and receives a wide fit-to-stage Present layout;
  custom SVGs must keep text ≥12px.
- **Guided charts carry a full argument.** An overview teaches the visual, each
  `{title, note, focus}` step positively marks its evidence, and optional
  completion restores the whole chart for the conclusion. Read view has its own
  navigation; Present keeps the narrative and lets deck arrows own traversal.
- **Copy limits cannot break Present.** One registry validates recognized
  component copy before assembly writes output and reports all overages together.
  The agent rewrites those exact source fields and reruns automatically. Dynamic
  values render intact with a structured diagnostic and fixed authoring alert;
  no field-level string cap throws or silently truncates content.
- **Presentation catches weak media and impossible bounds.** Raster images
  enlarged above native size are marked and reported with a recommended 2x
  capture. Present measures oversized descendants, warns when `minScale` or
  fixed widths cannot fit, and enables scrolling only as an escape hatch.
- **Modern animation with an honest fallback.** The vendored Motion build powers
  scroll reveals, staggers, and panel swaps. If Motion is unavailable (or
  `prefers-reduced-motion` is set), the same classes fall back to CSS
  transitions — the page never depends on it.
- **Both themes, every style.** A fixed theme toggle ships on every page;
  choices persist in localStorage.

## Register (applies to every style)

Explainers are educational documents, not marketing pages. Never use
"revolutionary", "seamless", "effortless", "powerful", "unlock", "leverage",
"transform", "unprecedented", "cutting-edge", "next-generation", "game-changing",
"supercharge", "blazing", "magic". State facts; let the reader be impressed by
the content, not the adjectives. Keynote may be punchy, Playful stays plain —
neither may trade accuracy for effect.

## Versioning

A change to any skill file needs a `VERSION` decision, and one merge request
advances it by a single semantic step: decide the step for the whole branch,
write it once, and keep it across later commits. Every assembled page carries a
stamp comment (`assembled by .factory/skills/explainer v… · style=… ·
components=[…] · source=…`) identifying exactly what produced it.
`VERSION` is the sole authority: an agent must read it immediately before
stating a skill version and otherwise should not announce one. Never infer or
hardcode a version from this README, filenames, generated pages, or prior turns.

## Worked example

`reference-sources/hello-kit.html` is a tiny but complete content source demonstrating all
four slots, three components, a flow diagram, and a Present manifest. Assemble it:

```sh
python3 .factory/skills/explainer/assemble.py .factory/skills/explainer/reference-sources/hello-kit.html --out /tmp/hello-kit-explainer.html
```

## Component showcase

`showcase/components.html` is a pre-assembled, self-contained page that
renders every kit component with sample data. Open it in a browser to see
what's available before authoring your first explainer. To refresh it after
component changes:

```sh
python3 .factory/skills/explainer/assemble.py .factory/skills/explainer/reference-sources/component-showcase.html --out .factory/skills/explainer/showcase/components.html
```

## FAQ

**Why not just write the final HTML directly?** Because it isn't a small
edit away from your content — it's your content plus ~90% injected
boilerplate (design tokens, Present mode, zoom, glossary machinery, the
vendored animation library). Hand-editing it means every future fix to that
shared machinery (there have already been three real Present-mode bugs found
and fixed this way) has to be manually reapplied to every explainer that
copied it, instead of landing automatically on the next `assemble.py` run.

**Why does iterating on the source cost less?** It's the ~10% that's
actually yours — one keynote source runs about 24KB against a 170KB
assembled output. A diff against the source is pure content signal; a diff
against the assembled file is mostly re-injected boilerplate noise (and
churns completely on every `VERSION` bump, even with zero content changes).
Changing `style`, `components`, or `theme` and re-running `assemble.py` is
also cheaper than retyping content into a new template by hand.

**Why does the source live in `explainers/_sources/` and not `explainers/src/`?**
Both say "this is input, not output" to a developer, but `_sources` also says
it plainly to the ~100 other people who'll browse `explainers/` without
knowing that convention — and it's not a new pattern here: the skill itself
was `explainers/_kit/` for months before it became `.factory/skills/explainer/`.
Reusing an underscore prefix that already means "internal, don't open this
directly" in this exact repo costs nothing to learn twice.

**Why can't I open the source and preview it?** By design — it's missing
the entire runtime (CSS, Present mode, zoom, glossary) that makes it a page,
which is exactly the part the skill contributes at assembly time. Every
source now starts with a banner explaining this if you open it by mistake;
to actually preview, assemble it (or reopen the last assembled output while
iterating on content that doesn't change structure).
