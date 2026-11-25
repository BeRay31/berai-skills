# DESIGN.md — the explainer kit's design guide

The taste that makes assembled pages look the way they do, written down so it
travels with the kit. If you are building a custom device in page-css/
page-js, contributing a component, or forking a style, read this first: when
something "technically works" but feels off, the reason is usually a rule on
this page. CONTRACTS.md holds the data contracts; this holds the judgment.

## Against AI slop

The kit's single strongest commitment: assembled pages must not look or read
like default AI output. The tells, and the kit's answer to each:

- **Fat rounded rectangles everywhere** → the corner diet. Cards and panels
  6px; large framing surfaces (canvases) 12px; groups 8px; legends/popovers
  8px. Round stays only where the shape *means something*: dots, number
  badges, rings, chips-as-labels, floating chrome pills. A queue node is a
  crisp card with slat glyphs — the glyph carries "buffer," not a 999px pill.
- **Slide text.** Use a heading the reader can find when scanning. Put a
  caption beside the evidence it explains. Follow the
  [plain-language instructions](../SKILL.md#plain-language) for both styles.
- **Walls of text on slides** → the text diet, enforced as code. Every
  component caps its strings hard and THROWS on violation (labels ~20–36
  chars, notes ~28–40, four code lines max, six walkthrough steps max).
  Truncation hides the problem; throwing returns it to the author, who is
  the only one who can fix it well.
- **Label soup on diagrams** → numbered markers + a legend. Edge and change
  labels live in the key below the canvas (hover cross-highlights both
  directions); the canvas keeps only numbers. Sequence diagrams number in
  authored order — time is the reading order — everything else numbers in
  spatial reading order.
- **Decoration pretending to be information** → every visual element must
  carry meaning. Hatching means waiting. Dashing means async. Strikethrough
  means killed. A tone is a role, not a mood.

## The shared visual language (learn once, read everywhere)

- **Solid = sync = blocks. Dashed = async = fires-and-continues.** This holds
  from architecture edges to sequence messages to stack frames. In motion:
  sync blocks the pulse; async forks it — simultaneous heads ARE the
  concurrency/contention picture.
- **The pulse** (bright head + fading trail traveling real geometry) is the
  family's soul. Topic arrival broadcasts to all unfiltered legs at once;
  queue arrival alternates legs (competing consumers); filtered legs skip
  beats. Replay-style animation renders time as time.
- **Guards are first-class**: early exits render as warn-toned stubs exiting
  the flow (⤴) — half of what makes code paths hard to explain is what
  bounces, so it gets shape, not a footnote.
- **Side effects land as chips**: `write` in success tone, `kill` struck in
  error tone, neutral otherwise. An audience should count what got touched
  without reading.
- **Walkthroughs everywhere**: steps with `fire`, progress dots, `{count,go}`
  into Present. Outside a step, ambient motion idles quietly; during a step,
  the fired elements own the stage and everything else dims (~0.3).
- **Code context cards** anchor abstractions to files: path bar with dimmed
  directories, bright filename, extension-toned dot; ≤4 mono lines, one hot
  line. In diffs, the changed path segment tints error-side/success-side.

## Themes, styles, motion

- **Dark and light belong to the viewer, never to a style.** Styles are
  voices (keynote: projector-grade restraint; playful: personality within
  the same bones); `[data-theme]` handling lives in the base layer and every
  style must pass both themes. Present mode and fullscreen are equally
  style-independent.
- **Motion is purposeful or absent.** Every animation answers "what does this
  movement mean?" — travel means flow direction, fork means concurrency,
  fill means elapsed time, count-up means accumulation. `prefers-reduced-motion`
  yields a fully static, fully legible page — never a broken one. The pulse
  family follows the page-level motion control (calm/normal/off), not
  per-component switches.
- **Typography is generous.** Apple-keynote scale: big display lines, tight
  letter-spacing on headlines, prose at a reading measure (~66ch), microtype
  (eyebrows, stamps, mono badges) deliberately small and uppercase. Squeezed
  type reads as broken — the scroll-mode breakout exists precisely so
  canvases never shrink type below legibility (≥920px internal floor, then
  scroll inside the artifact).

## Layout truths (paid for in bugs)

- **Center wide artifacts with margin math, not transforms** — finished
  reveal animations keep their WAAPI transform composited and silently
  shadow stylesheet transforms. `margin-left: calc((100% - min(1440px,
  calc(100vw - 48px))) / 2)` centers in both regimes and no animation can
  touch it.
- **Every scroll-mode-only rule is scoped `body:not(.presenting)`** —
  Present's per-component overrides reset margins but not width/transform,
  so unscoped rules leak into the deck. A structural test enforces the scope;
  keep it green, don't argue with it.
- **Prose keeps its column; canvases break out.** The article measure is for
  reading; the 1440px breakout is for diagrams. Forcing width on small
  components (pyramid, loop, stepper) reads as sparse — breakout is opt-in
  per component, not a default.
- **Content-box percentages resolve against the shell** — the whole centering
  scheme assumes every ancestor up to `.shell` stays horizontally symmetric.
  Keep it that way.
- **A component may only read a token every style defines**, plus
  `base/base.css` and the properties its own layer sets. `base/app-shell.css`
  never reaches an assembled page, so its tokens are not yours. An undefined
  `var()` drops the whole declaration with nothing in the console — that is how
  a light-theme band once shipped solid black. `stylelint` fails the build now;
  believe it over the CSS that looks right.

## Presentation diagrams

- **Content spacing belongs inside the visual.** Consume
  `--content-space-scale` for meaningful row gaps, group separation, and padding;
  keep `1` identical to the default design. Geometry renderers use
  `ExplainerKit.contentSpacing()` and `observeContentSpacing(host, refresh)` to
  rebuild nodes and connectors together, preserving their current walkthrough.
  Do not stretch text, alter chart values, or move geographic coordinates.
  Check Compact and Airy in both Studio and Present.
- **One stable surface before pagination.** Keep a normal-sized story on one
  geometry and let walkthrough steps change emphasis only. Sequence uses one
  surface through six messages; stack keeps every frame visible. Split only
  after testing the real target viewport, and keep shared columns, title,
  logical slide count, and scale fixed across an in-place continuation.
- **Present is a composition, not a shrink fallback.** Give wide diagrams the
  viewport, remove duplicated subtitle/control bands, and place numbered
  legend plus walkthrough context in one fixed footer. A `0.75` scale or a
  scroll bar is evidence to redesign the composition; projector text should
  land near `0.9` scale or better.
- **Routes need owned space.** Reserve gutters for cross-lane traffic and give
  sibling sync/async routes separate ports and tracks. Arrowheads stay attached
  to their paths; numbered markers sit on the routes they describe. Never let a
  connector cross an unrelated card or infer a caller when the author knows it.
- **Measure in one coordinate system.** HTML frames are measured in screen
  coordinates; SVG overlays receive points transformed through the SVG's
  inverse screen CTM. Recompute after Present enter/exit, fullscreen, resize,
  and display changes—never reuse coordinates from a previous layout.
- **Comparison focus stays local.** A before/after race gets one focus range per
  side, not a global slab joining unrelated intervals. Replay keeps each final
  endpoint visible (`elapsed / total`) and states the outcome in concrete terms.

## Product surfaces

Studio and Gallery are tools, not editorial landing pages. Use neutral sans
hierarchy, readable metadata, explicit 44px actions, textual status, and direct
copy (`Loading explainers`, `Couldn't load explainers`). Avoid display serifs,
tracked-eyebrow soup, theatrical metaphors, invisible card actions, and tiny
metadata—the preview and the user's files already provide the personality.

## Maintenance boundaries

The shipped kit has no package install step. Python entry points use the standard
library, browser code uses platform APIs, and third-party browser code is vendored
under `vendor/`. Development linters may use the pinned repository toolchain;
their packages must never become runtime imports in `skills/explainer/`.

Assembly order is an implementation detail, not a component API. Shared browser
helpers live on the kit runtime namespace created by `components/_core.js`.
Components call that namespace explicitly so each source file can be linted and
understood on its own. New component capabilities belong on the same adapter
instead of another `window.__kit*` registry or element property.

Review owns the saved review schema and all persistence. Studio uses
`window.__RVAPI.store` for sections, order, swaps, and canvas edits; it must not
mutate Review's state object. Keep additions to that store task-oriented so a
schema migration or save policy changes in one place.

Treat a duplicate selector in one stylesheet as a design error unless its scopes
are meaningfully different. Edit the owning rule instead of appending a repair at
the bottom of the file. The per-file migration budgets in `stylelint.config.mjs`
freeze existing debt; lower a budget whenever consolidation removes a duplicate.
Generated showcase HTML is output: edit its source and reassemble it rather than
patching the generated file.

## Content voice for showcase and examples

Generic, vendor-free, believable: checkout authorizations, order/payment
schemas, fat-handler refactors. Real product decks stay out of the repo. A
showcase slide teaches the component's vocabulary in one glance — if the
example needs a paragraph of setup, the example is wrong.

## How the kit evolves

Explainers are created once, then rebuilt on the fly through the studio —
so the kit prefers a small roster of excellent components over a museum of
adequate ones. Reinvent rather than accrete; retire with a compat alias
rather than break; and when a "new component" request arrives, first ask
whether it's a kind or mode of an existing one (chart kinds, table modes,
architecture family members) — the roster earns a new seat only when the
visual language is genuinely new. Mock cheaply in scratch space before
building for real; taste decisions are cheapest at the prototype.
