# Component data contracts

Every component is a render function: it takes a host selector and a plain data
object, and builds the markup for you. Fill in the data; do not hand-roll the
HTML. Fields documented as rich text may accept passive inline formatting such
as `<code>` or `<em>`, but never interactive markup. In particular, do not put
`<button>` or `data-term` markup in `page-js` component data; `assemble.py`
rejects it deterministically. Glossary buttons belong in the content slot.

Declare the components an explainer uses in its `meta.components` array — the
assembler splices in only those CSS/JS partials.

Host element pattern (in the `content` slot):

```html
<div id="myTable"></div>
```

Render call (in the `page-js` slot):

```js
renderTable('#myTable', { ... });
```

## Authoring manifest

Studio may append one optional inert source slot:

```html
<script type="application/json" data-slot="authoring">
{"version":2,"text":[],"tokens":{},"components":{},"shapes":[],"slides":[],"sourceSlides":[],"order":[]}
</script>
```

This is a compact override and composition layer, not a second deck DSL.
`text` holds selector-scoped, before-guarded replacements; `tokens` holds only
the supported semantic appearance controls; `components` holds stable host
settings and normalized frames; `shapes` holds normalized `rect`, `ellipse`,
`line`, `arrow`, `text`, bounded path, and group objects; `slides` holds bounded Studio-authored
component instances; `sourceSlides` records reversible visibility; and `order`
records the shared source/authored slide sequence. Rectangle-like objects use `x/y/width/height`; lines and
arrows use `x1/y1/x2/y2`. Coordinates are `0..1` relative to the slide so later
presentation export does not depend on browser pixels.

Each authored slide is `{id, before, title, component}`. A component has an
allowlisted `kind`, JSON `data`, optional `settings` and normalized `frame`, and
an optional trusted `canvas` record for Architecture or Operating Model. The
same edit on a component authored in the original source is stored in that
component's override as `canvas: {kind, record}` because its kind is not part of
the stable host identity. Both forms pass through the component's existing
trusted canvas codec. A source component override may also hold allowlisted
`kind` plus plain JSON `data`; this is how the same Content editor updates an
existing catalog visual without serializing its rendered DOM. The catalog
supplies placeholder data when a slide is inserted. Every captured catalog
component uses the same bounded editor for primitive values and repeatable
collections, while original and inserted slides share local delete/reorder
behavior.

Version 2 adds freeform component ownership and grouped portable shapes. Read
version 1 through explicit migration without changing its visual meaning; write
version 2 on save. Do not preserve the version 1 label while adding detached
state: older sanitizers drop unknown fields and would lose the freeform scene.
Upgrade the kit before editing a version 2 source with an older Studio. The
Architecture and Operating Model canvas-record versions are separate protocols.

### Direct visual editing

Every supported Studio visual is directly editable outside Present mode.
Double-click a catalog or safely captured source visual to preview its portable
shapes and text. Arrange is read-only until an edit: a single click moves the
visual as one object, while a double-click enters its parts.
The preview is transient until the first actual edit. Unsupported custom or
agent-authored HTML/SVG remains movable and resizable as one object. There is no
raster fallback or partial capture.

Capture appends shapes to the existing `shapes` collection and records
`detached: {root: "<group-id>"}` on the component record: either an entry in
`components` for a source visual, or `slides[n].component` for an inserted one.
Retain the original semantic `kind`, `data`, `settings`, and `canvas` where
present. Parent-group references and the detached root must resolve to the same
slide. IDs are unique; geometry is finite; group ancestry, paths, shape counts,
and text are bounded and validated. Rebase IDs, parent references, and the root
when duplicating a freeform scene.

The detached root owns the replacement appearance. Suppress the original visual
and its semantic controls, stop its walkthrough, and release its runtime
resources. Do not run the semantic renderer over edited shapes. Shapes keep
normalized geometry for responsive placement; text remains text and paths remain
vectors. No DOM, executable HTML, or renderer closures belong in the manifest.
This portable representation is also the presentation-export seam. Studio
exports text, rectangles, ellipses, lines, arrows, and bounded paths as native
objects that survive PPTX import into Google Slides. Group records retain
ownership in the manifest but do not make their child objects opaque in the
exported file. Embedded images remain single movable image objects.

PPTX export requires the coordinated Present-mode order and reads the preview
manifest without saving either. Every explicit walkthrough state becomes a
consecutive slide; motion between states is frozen at the authored state instead
of being translated into brittle PowerPoint animation. Capture must apply the
effective Present-stage transform to HTML type, spacing, and borders as well as
geometry. Static state slides retain the walkthrough annotation but omit dots
and controls that no longer have an interactive action. Temporarily adopting
Present-mode content and placing each state on a fixed 16:9 capture surface must
be fully reversed in a `finally` boundary. Do not write authoring state, call an
export endpoint, retain slide DOM changes, or fall back to the Studio/editor layout.
If Present-mode capture is unavailable or produces no states, abort before
download. If capture, image embedding, object
limits, or PPTX generation fails, abort the whole download and identify the
first affected slide. Never silently omit, flatten, or publish a partial object.
Treat successful Google Slides import with independently editable objects and
the complete walkthrough sequence as the acceptance gate; PowerPoint and
LibreOffice checks are secondary compatibility evidence.

Build and validate the complete capture before showing its transient preview.
Commit it with the first shape mutation, as one undoable change; selecting it or
leaving Arrange untouched must not dirty the document. **Reset visual** removes
its detached replacement and returns to the retained semantic component,
discarding freeform edits. It is not a shapes-to-component inference step.
Capture and reset use the same local Save, stale-tab, agent-lock, and atomic
rebuild boundaries as other edits.

Register custom visuals through the component capture contract when direct part
editing is required. Arbitrary HTML/SVG is not automatically a portable
component.

### Semantic content and saving

**Add item** clones an existing item's fields and assigns new IDs. The open
inspector retains that template if the last item is removed. An initially empty
collection has no typed template; ask the agent to create its first item before
adding more locally. Fields deeper than six levels, items beyond the first 24,
and fields beyond the 320-field display budget stay preserved but are not shown.

**Save edits** validates this manifest, writes the source atomically, rebuilds to
a temporary output, and swaps the assembled file only after success. It rejects
stale tabs and agent-locked reviews. Notes and requests that require judgment
never enter this manifest; they remain in the explicit review handoff. A source
slide is only copied locally when Studio captured one component safely. The copy
uses captured visual data, not every source text override or decoration; review
it before saving. On a multi-visual slide, select and edit each captured component
in place rather than guessing what a slide-level duplicate should contain.

Flag objects, used across components: `{kind: 'done'|'progress'|'next'|'gap', label: 'also in CI'}`.

## Layout previews and older explainers

Layout changes compose the same authored data for a different reading task.
Content spacing changes internal gaps and padding; it never changes chart values,
time scales, or the meaning of a relationship. Explicitly positioned system maps
retain their authored coordinates.

These controls register from existing component data. An older explainer gains
them when Studio **Upgrade** rebuilds it with the current kit; no new source
fields are required. Existing defaults remain the starting view. In current
Studio, **Save edits** persists a supported layout choice in the authoring
manifest and rebuilds before distribution; **Finish** remains available when
the change should be delegated.

| Component | Optional source field and choices | Alternate reading task |
| --- | --- | --- |
| Section | `layout: 'split'` / `'centered'` | Opening title or centered chapter statement |
| Iceberg | `layout: 'iceberg'` / `'briefing'` | A cutaway of the work below the waterline |
| Pyramid | `layout: 'pyramid'` / `'ladder'` | Read each level while retaining apex/base order |
| Loop | `layout: 'circuit'` / `'briefing'` | Discuss each stage with its feedback return |
| Stepper | `layout: 'focused'` / `'overview'` | Keep the process visible beside the selected step |
| Org tree | `layout: 'chart'` / `'outline'` | Read teams and their reporting depth |
| File tree | `layout: 'map'` / `'list'` | Scan paths as an indented list |
| Evolution tree | `layout: 'parallel'` / `'revisions'` | Read authored revisions in sequence |
| Before/after table | `layout: 'changes'` / `'parallel'` | Compare aligned old/new states |
| Comparison table | `layout: 'sides'` / `'criteria'` | Read both answers by criterion |
| Specification table | `layout: 'ledger'` / `'sections'` | Read labeled values within authored groups |
| Chart, except trace | `layout: 'chart'` / `'briefing'` | Item rails, unit rows, row strips, a lead metric, or a plot with exact readings |
| Sequence | `layout: 'exchange'` / `'briefing'` | Read messages in sender-to-receiver order |
| Stack | `layout: 'diagram'` / `'briefing'` | Read lane outlines, or paired frame changes in diff mode |
| Single trace | `layout: 'timing'` / `'briefing'` | Read span evidence on a common clock |
| Flow, including timeline | `layout: 'across'` / `'down'` | Read stages or dated events with their outcomes |

**Baking a review's Studio settings.** Each `@#host|setting` line in a review
maps to one exact source field on that component's render call — apply it
directly, no component research needed:

| Review setting | Source field |
| --- | --- |
| `Layout: <choice>` | `layout: '<choice>'` (per the table above) |
| `Background pattern: <name>` | `pattern: '<name>'` (Section) |
| `Text: key` / `Text: more` | `detail: 'key'` / `'more'` |
| `View: full` / `View: follow` | `view: 'full'` / `'follow'` |
| `Motion: calm` / `normal` / `off` | `__kitMotionPreset: 'calm'` / `'normal'` / `'off'` (Section, Flow, Big Stat, architecture family) |

The first value is the existing default. Table `mode`, chart `kind`, and tree
`mode` still select their documented data contracts; layouts do not convert
between incompatible schemas. Existing roadmap, architecture, and code choices
are documented in their component sections below.

For maintainers: reuse `registerAdjustments`, `stableDriver`, and the spacing
helpers in `components/_core.js`. A choice may provide `choiceDescriptions`
alongside `choiceLabels` for Studio's audience hint. Keep compatibility handling
local to the component that owns the retired value.

## Visual text limits

`components/text-caps.json` is the sole authority for visual string budgets
across every component. The limits use JavaScript UTF-16 units. `plain` fields
count every authored character; `passive-inline` fields count only text visible
after the component's strict allowlist handles `<code>`, `<em>`, `<strong>`,
`<b>`, `<i>`, and `<br>`. Disallowed markup remains visible and counts.

Assembly validates all recognized inline and top-level variable-backed component
data before writing output. It aggregates every overage into one
`component.copy_limit` failure naming renderer, component, materialized source
path, measured length, limit, complete value, and rewrite hint. The agent must
rewrite those source fields semantically and rerun assembly; tooling never slices
or adds ellipses to make authored copy pass.

Dynamic values that conservative static analysis cannot prove use the same
registry at runtime. They never throw or block later renderers, `initPresent`, or
zoom. The full value remains intact while the page emits a structured diagnostic,
marks the host, logs the exact issue, and displays a fixed **copy issue** alert
above Read and Present. That alert means the page is not share-ready.

This policy applies only to field-level string limits. Required data, item and
line counts, numeric ranges, references, routing, overlap, and other structural
or geometry contracts remain fatal; never "repair" them by dropping content.

Screenshot frames are a shared HTML primitive rather than a renderer. Record the
original page or asset path in `data-source` for later replacement. The default
keeps the image's intrinsic aspect ratio. Opt into a focal crop with
`--screenshot-aspect` and `--screenshot-object-position`; add `data-zoom` so the
overlay still opens the complete intrinsic image rather than the crop.

```html
<figure class="screenshot-frame" data-zoom data-source="sketches/maturity-score.html"
        style="--screenshot-aspect:16/9;--screenshot-object-position:50% 28%">
  <img src="data:image/png;base64,…" alt="Maturity stages">
</figure>
```

Raster images that render above their native dimensions receive
`data-upscaled="true"` and an actionable console warning. Capture presentation
screenshots at 2x the intended display size. SVG images are excluded.

---

## section

A full-frame cover or chapter divider for formal presentations. It reserves a
quiet copy field on the left and renders one of eight theme-token patterns on
the right; it is decorative structure, not a data chart. The component returns
`{count:1, go}` so entering the Present slide replays its restrained reveal.
Every new explainer uses this component in `mode:'cover'` for its first slide;
existing sources remain compatible without retrofitting. Use `details` for a
presenter name or team only when the source supplies that attribution.

```js
var section = renderSection('#host', {
  mode: 'chapter',                 // chapter (default) | cover
  pattern: 'ribbons',              // ribbons | dots | arcs | iso
                                   // | waves | frames | rays | swarm
  kicker: 'PLATFORM\nROADMAP 2027', // optional; newline makes at most 3 lines
  number: '02',                    // optional chapter marker
  title: 'Make the migration boring',
  sub: 'One shared path from pilot to default.',
  details: ['Heitor Lessa', 'Principal Engineer'], // optional, at most 4
  ariaLabel: 'Roadmap chapter: make the migration boring',
});
// Present: {pick:['#host'], layout:'cover', steps:section}
```

Pick only the host on a cover slide; do not add a manifest title or kicker.
`dots` here is a decorative background pattern. Use `chart` kind `dots` when
each mark represents a number, vote, person, or other exact unit.

**Patterns.** `ribbons` is the loud one: filled, rotated blades in the accent.
`dots` is the quietest. The other six are wireframe fields — 1px SVG geometry
where exactly one element carries `--accent` and the rest are neutral mixes, so
each holds its reading on a dark or light ground:

| pattern | geometry | reach for it when |
| --- | --- | --- |
| `arcs` | concentric quarter sweeps off the lower right, crossed by a sparser counter family | the default chapter break |
| `iso` | five isometric planes on vertical struts, one faintly tinted | the chapter is about layers or a stack |
| `waves` | seven phase-shifted signal traces | the chapter is about flow or throughput |
| `frames` | six frames receding to an off-centre vanishing point, corners railed | the chapter is about depth or nesting |
| `rays` | a sixteen-ray fan whose vanishing point sits outside the frame | you want direction without curvature |
| `swarm` | 760 seeded motes swept onto three logarithmic arms, stated by three hairline guide arcs | the chapter is about volume, scale, or analytics |

Every wireframe field draws on with `stroke-dashoffset` and is fully static
under reduced motion. `swarm` is the only stochastic one; its field is seeded,
so it renders identically on every load. Two constraints govern any new field:
build its bulk from the accent mix rather than the neutral counter tone, which
disappears on a light ground, and keep nested shapes stroke-only, because
stacked translucent fills sum into a slab.

`grid` and `contours` were retired in kit v3.4.0. A source or saved review that
still names one renders the closest survivor (`grid` → `iso`,
`contours` → `arcs`) and prints a console warning naming the replacement.

In Studio, section insertion is deliberately separate from visual replacement:
**Add section** previews a new chapter divider before an existing slide and
keeps that slide unchanged as the next beat. Pattern changes are deterministic
component editing. Applying the review adds the new host, `renderSection` call,
`section` dependency, and `layout:'cover'` manifest entry to the source.

## roadmap

Parallel workstreams on one dated horizon. Unlike `flow` mode `timeline`, a
roadmap keeps multiple lanes visible together, shows temporal spans and
milestones, and may draw cross-lane dependencies. All-work views keep their geometry while walkthrough steps change emphasis.
In Present, Timelines with more than ten items use a stable two-lane frame;
**Show full timeline** restores the complete map and its cross-lane routes.
Phases presents one period at a time, with up to four commitments per page and a persistent horizon navigator.
Key-commitment views temporarily reveal supporting items for the active step.

```js
var roadmap = renderRoadmap("#host", {
  layout: "timeline", // optional: timeline (default) | phases | workstreams
  items: "key", // optional: key | all; falls back to all without key flags
  typeScale: "large", // optional: standard | large
  view: "follow", // optional: follow (default) | full
  showDependencies: true, // optional: hide routes/references without deleting them
  walkthroughText: true, // backward compatible; false hides only the guide copy
  periods: [
    { label: "Q1", start: "2027-01-01", end: "2027-04-01" },
    { label: "Q2", start: "2027-04-01", end: "2027-07-01" },
  ],
  today: "2027-03-10",
  lanes: [
    {
      id: "platform",
      label: "Platform",
      sub: "shared foundations",
      items: [
        {
          id: "contract",
          label: "Stable contract",
          start: "2027-01-10",
          end: "2027-03-15",
          state: "done",
          key: true,
        },
        {
          id: "default",
          label: "Default path",
          start: "2027-03-15",
          end: "2027-06-20",
          state: "now",
        },
      ],
    },
    {
      id: "teams",
      label: "Teams",
      items: [
        { id: "pilot", label: "Pilot cohort", at: "2027-02-15", state: "done" },
        {
          id: "waves",
          label: "Migration waves",
          start: "2027-03-20",
          end: "2027-06-15",
          state: "planned",
        },
      ],
    },
  ],
  dependencies: [{ from: "contract", to: "waves" }],
  walkthrough: [
    {
      title: "Foundations first",
      note: "The stable contract unlocks migration waves.",
      items: ["contract", "waves"],
      dependencies: [0],
    },
  ],
});
```

Limits: 1–5 lanes, 2–8 ordered non-overlapping periods, 1–7 items per lane
(24 total), 12 dependencies, and 6
walkthrough steps. A span needs `start` and `end`; a milestone uses `at`.
All item dates must sit inside the period range. States are `done`, `now`,
`planned`, or `risk`. Dependencies and walkthrough references are fatal when
they name unknown ids. The return value is `{count,current,go}`.

`typeScale` is optional and accepts `standard` or `large`; an unknown value is
fatal.

| Preset               | Initiative     | Lane     | Period / lane sub | Key     | Walk title | Walk note |
| -------------------- | -------------- | -------- | ----------------- | ------- | ---------- | --------- |
| `standard`           | 20 units / 560 | 22 units | 16 units          | 0.9rem  | 0.9rem     | 0.85rem   |
| `large`              | 32 units / 650 | 28 units | 20 units          | 1.05rem | 1.05rem    | 1rem      |

`standard` fits the complete composition; `large` preserves the back-of-room
treatment and is the default. Timeline item titles render at 7/8 of the
preset size, with separate lane-heading spacing, so labels do not form a solid
text column. Studio exposes these as **Text size** →
**Normal** / **Large**. There is no free slider: arbitrary sizes can invalidate
deterministic label placement and create collisions.

`layout` defaults to `timeline`. **Timeline** gives every commitment a labelled
row and uses a shared date axis for spans and milestones. `timeScale` defaults
to `adaptive`: when at least 80% of six or more authored commitments finish in
the first half of the horizon, the renderer rounds that window to the next
month and gives it 72% of the plot. At least 45 days must remain to compress.
The later horizon remains visible with a marked scale break and a date-range
explanation; bar lengths are comparable only within each part of the axis.
`timeScale: "calendar"` keeps a uniform scale as an explicit source option.
Studio uses the automatic default and does not expose a separate date-axis
spacing control. Content density changes content geometry, not the date scale.
Older saved scale selections remain replayable.
Layout and walkthrough changes use the same
authored date distribution, so focusing a step cannot move the axis. Period labels allow
up to 32 UTF-16 units: they sit in separate captions and phase headings rather
than inside narrow date-axis cells. Item titles retain their 28-unit limit for
Timeline label geometry. Period and month
markers make dates comparable; month markers are omitted beyond 550 days.
**Phases** is a phase briefing: one authored period, up to four commitments per
page, quieter metadata, and a persistent phase navigator. Spanning work appears
in every overlapping period as **Continues**; milestones belong to their dated
period (including the final horizon boundary). Gap-only work remains in the
preceding phase, labeled **Between phases**. Counts distinguish the current
selection from all authored commitments. **Notes & dependencies** reveals source
detail; **Complete list** opens a bounded inspection view. Overview returns to
the first phase. Spotlight steps bring a relevant page into view and mark other
phases containing highlighted work. No phase goal or priority is inferred.
**Workstreams** keeps ownership primary and orders each lane's commitments by
start date. Phase grouping does not imply a finish-to-start dependency.

`items` accepts `key` or `all`. With `key:true` flags, key mode shows exactly
those commitments in overview. A walkthrough temporarily reveals non-key items
named by the active step, its lanes, or its dependency endpoints, with a visible
supporting-item count. Returning to overview removes that temporary context.
Without key flags, authored `key` safely falls back to all; Studio disables that
choice and explains why. Studio labels both choices with their authored counts.

`view` accepts `follow` (default) or `full`. Studio calls these **Spotlight step**
and **Keep context** under **Walkthrough emphasis**. The former dims unrelated
work during a step; the latter keeps equal emphasis. Neither removes guide text.
Changing layout, item scope, or text size preserves the current step.

`showDependencies` defaults to `true`. Setting it to `false` hides dependency
routes and references without changing the data or walkthrough relationships.
`walkthroughText` remains backward compatible: `false` hides only guide copy,
not dots, step count, progression, or the returned driver. Studio does not expose
this older toggle.

Timeline spans use 10-unit rails (14 for active work), with exact start/end
positions; milestones use diamonds. Status uses success, accent, neutral, and
warning tones. Lane headings own an indented label tree; every child branch
uses the same status tone and planned branches are dashed like their spans.
Each timeline item exposes its status, date range, and incoming dependencies in
its accessible name. Dependencies stay quiet until emphasized by a
walkthrough. An at-risk summary reports authored risk items and dates without
inferring a critical path or a recommendation.

Timeline notes are available in a disclosure in reading and Studio views. Phases
keeps notes behind **Notes & dependencies**; Workstreams shows notes inline. Present keeps the chart, scope/risk summary,
and walkthrough in the frame; Timeline also retains its status key. Timeline leads with the chart in Present; narration, selection scope, risk names
and dates, and the status key sit below it. Repeated phase captions are omitted
only when month-axis labels are present. A visible uneven-scale notice remains
beside compressed timelines. Primary labels, dates, and workstream headings
respond to the selected type preset. **Content spacing** changes Timeline row
and lane separation plus Phases/Workstreams internal padding and row height.
It reads `--content-space-scale`; dates, x-axis geometry, and type presets are
unchanged. Live changes preserve the walkthrough and invalidate Present fit.

## code

Annotated before/after source evidence for a pull request. Both panes stay in
place throughout the walkthrough; steps focus line ids without replacing or
collapsing the surrounding hunk.

```js
var diff = renderCode('#host', {
  mode: 'diff',
  layout: 'side-by-side', // optional: side-by-side (default) | stacked
  lines: 'all',           // optional: all (default) | changes
  typeScale: 'standard',  // optional: standard (default) | large
  before: {label:'before', file:'router.ts', lines:[
    {id:'old-guard', number:41, kind:'removed', text:'if (!policy) return allow();'},
    {id:'old-call', number:42, kind:'context', text:'return dispatch(event);'},
  ]},
  after: {label:'after', file:'router.ts', lines:[
    {id:'new-guard', number:41, kind:'added', text:'if (!policy) return deny("missing policy");'},
    {id:'new-call', number:42, kind:'context', text:'return dispatch(event);'},
  ]},
  walkthrough: [
    {title:'Fail closed', note:'The missing-policy branch now denies explicitly.', lines:['old-guard','new-guard']},
  ],
});
```

Each pane supports 1–10 lines; walkthrough supports at most 6 steps. A line
may be a string or `{id, number, kind, text}` where kind is `context`, `added`,
`removed`, or `changed`. Explicit ids must be unique across both panes and
every walkthrough id must exist. The return value is `{count,current,go}`.

Studio exposes **Layout**, **Lines**, and **Text size**. **Changes only** keeps
changed lines, walkthrough-referenced lines, and one adjacent context line on
each side. If the source has no changed lines, it safely keeps the full hunk.

## table

The one tabular device: one data shape (groups of rows), six modes sharing one
hairline weight. All text renders via `textContent` except `title`/`sub`-style
fields, which allow only `<code>`, `<em>`, `<strong>`, `<b>`, `<i>`, and `<br>`
with no attributes. Other markup is inert text; glossary buttons remain in the
content slot.

```js
renderTable('#host', {
  mode: 'rows',                          // rows | before-after | compare | grid | chips | specs
  ariaLabel: 'Rollout status by track',  // optional — sets role="group" + aria-label on the host
  numbered: true,                        // rows only: 01… numbers per row
  legend: [{kind:'progress', label:'partially in place'}],   // rows only, optional
  groups: [{
    label: 'Now · 2',                    // optional group header
    kind: 'progress',                    // optional colored dot on the header
    rows: [{
      title: 'Short name',               // required (or `label` — either works)
      key: true,                          // optional: eligible for Key items
      sub: 'One-line description',       // optional
      tone: 'accent',                    // optional: accent|violet|success|warning|error
      flag: {kind:'done', label:'also in CI'},   // rows only, optional
      ref: 'Epic #25',                   // rows only, optional right-aligned mono ref
      dots: {value: 78, ends:['not started','strong']},  // rows only: an inline dot-spectrum;
                                                           // combines with `sub`
    }],
  }],
});
```

`rows` is the ledger baseline: grouped hairline rows, an optional row `tone`
(a small glowing dot ahead of the title), and a `dots` cell — the dotplot
spectrum folded into the row. `dots.ends` (a `[start, end]` label pair) is
required — the component throws `renderTable: dots.ends is required` without it.

A spectrum row may carry a `sub`, which sits under the title so a score can
show its reason. Those words go in a fixed-width label column, so every track
starts at the same x and equal values land at the same pixel. Do not use a
spectrum for a value the source states only in words: four initiatives all
reported as "medium" are four identical positions, and inventing 45 against 62
fabricates precision the evidence does not have.

`grid` (calmer tiles-DNA auto-fill cards) and `chips` (chips-DNA soft pills,
`tone` sets both the dot and the chip tint) reuse the same `groups`/`rows`
shape as `rows`.

`compare` is the butterfly map — its own shape, not `groups`:

```js
renderTable('#host', {
  mode: 'compare',
  leftName: 'No spec', rightName: 'OpenSpec', mid: 'Same outcome — how reliably?',
  rows: [{
    concern: 'Plan before code',        // required, center column
    left: 'if you ask, each time',      // omit → "— not covered"
    right: '<code>opsx:plan</code>, by default',
    subject: true,                      // optional: accent row — the page's subject
    note: 'where /merge-check sits',    // optional line under the concern
  }],
});
```

`specs` is the chip-launch spec-comparison strip — subjects as columns, one
winner cell per row:

```js
renderTable('#host', {
  mode: 'specs',
  subjects: ['Baseline', 'Cached', 'Cached + parallel'],
  groups: [{label:'CI pipeline', rows: [
    {label:'Build time', values:['4m 40s','2m 10s','48s'], winner: 2},  // winner: index into values
  ]}],
});
```

Every row's `values.length` must equal `subjects.length`, or the component
throws `renderTable(specs): row "…" has N value(s) but there are M subject(s)`.
`winner` (an index into `values`) wears the accent — color and a soft glow
alone, never bold; a dash (`—` or empty) renders as dim "not covered".

`before-after` is the reinvented flip — its own shape (`rows`, not `groups`),
one line per row: dim BEFORE text flips to lit AFTER text on reveal, leaving a
struck ghost of the claim it replaced:

```js
renderTable('#host', {
  mode: 'before-after',
  rows: [{
    title: 'Code review',                                     // ≤ 40 chars, or the component throws
    before: 'a human skims the diff, approves by habit',       // ≤ 60 chars, or the component throws
    after:  'adversarial review proves the diff correct',      // ≤ 60 chars, or the component throws
    flag: {kind:'done', label:'enforced'},                     // optional
  }],
});
```

The text diet is enforced, not suggested: a `title` over 40 characters throws
`renderTable(before-after): title exceeds 40 chars`; a `before`/`after` over
60 characters throws `renderTable(before-after): before exceeds 60 chars` (or
`after exceeds …`). Diet the claim to fit — this mode is one line, not a
paragraph.

Studio options register automatically: `rows` offers **Composition: Briefing \|
Detailed ledger**. Briefing turns each row into a stage-readable title and
measurement card, removes repeated references, and derives visible group counts;
the detailed ledger retains the authored evidence. `grid`/`chips` offer their
compatible layout choices. Rows marked `key:true` enable **Items: Key items \|
All items**; non-ledger modes with `sub` enable **Text: Key only \| More
detail**; and
`before-after` offers a **Show end state** toggle. Choosing Key items without
any key flags safely keeps all rows. Every
mode returns a Present driver: `rows`/`grid`/`chips`/`compare`/`specs` share
`{count, go}` (`specs` also fires a one-time winner-cell pop on genuine
reveal — a Present step or the read-view stagger, never the silent initial
mount); `before-after` returns `{count, go}` where `go(i)` flips rows `< i`.

Present scales the family's type up, and the group label is scoped to `.kt`
rather than to a mode, so a new mode inherits the floor instead of shipping
without one. Three modes once did: a section name that read at 0.93rem in `rows`
stayed at 0.62rem in `grid`, `chips`, and `specs`, which reached the audience at
under 10px. When adding a mode, measure its smallest text in Present rather than
in the scrolling read — the fit scale is a multiplier the read view never applies.

## tree

One hierarchy device, three renderings behind one call. All three return a
depth- or row-based Present driver `{count, go[, play]}`.

```js
// org — boxes-and-elbow-connectors; root largest, shrinks per depth
renderTree('#host', {
  mode: 'org',
  direction: 'down',                    // optional: down (default) | across
  detail: 'more',                       // optional: more (default) | key
  ariaLabel: 'Product org chart',
  root: {
    label: 'Mara Chen', sub: 'Founder & CEO',
    tone: 'accent',                     // optional: accent|success|warning|violet
    children: [
      {label: 'Sam Okafor', sub: 'VP Engineering', tone: 'accent', children: [ /* … */ ]},
    ],
  },
});
```

Depths beyond 3 (the `root` is depth 0) collapse behind a `+N more` pill that
expands on click; more than 5 siblings at one level wrap into balanced rows
rather than overflowing one line.

Studio exposes **Direction** for org trees, **Layout** for file trees, and
**Text** when `sub` or `note` detail exists. Key text removes only those
secondary fields; labels and hierarchy always remain.

```js
// files — the flagship "map" look: folder icons, rationale labels, card-grid leaves
renderTree('#host', {
  mode: 'files',
  layout: 'map',                        // optional: map (default) | list
  detail: 'more',                       // optional: more (default) | key
  ariaLabel: 'repository information architecture',
  root: {
    label: 'growth-service/', sub: 'checkout experiments platform', kind: 'folder',
    children: [
      {label: 'README.md', kind: 'file', note: 'ENTRY POINT'},
      {label: 'src/', kind: 'folder', note: 'RUNTIME', children: [ /* … */ ]},
    ],
  },
});
```

`kind` (`'folder'`|`'file'`) is optional — a node with a non-empty `children`
is inferred as a folder. A group whose children are all leaves renders as a
card grid (name + rationale `note`) automatically; **Layout: List** flips the
whole tree to a plain indented mono list with the same data.

```js
// evolution — filetree's dense before/after tree, ported verbatim
renderTree('#host', {
  mode: 'evolution',
  panes: [
    {label: 'payments/ — before', tree: [
      {name: 'gateway.go', mark: 'moved', note: '→ providers/gateway.go'},
      {name: 'legacy_stub.go', mark: 'removed', note: 'dead since v2'},
    ]},
    {label: 'after', accent: true, sub: 'provider-per-folder', tree: [
      {name: 'providers/', children: [{name: 'stripe.go', mark: 'added'}]},
    ]},
  ],
  legend: true,        // default; pass false to hide
  icons: false,         // optional: adds folder/file glyphs
});
```

Node contract: `{name, mark?: 'added'|'moved'|'removed', note?, children?,
columns?}` — directories are inferred from `children` or a trailing `/`.
`columns: true` renders that node's children as a leaf card grid (the same
device as `files`' automatic leaf grid). Plain nodes read as unchanged; mark
exceptions only.

## chart

Charts for *measured numbers* — animated, glowing marks on honest geometry,
eleven kinds behind one contract. Marks animate on arrival: lines draw
themselves in and the end-dot pops, bars slide in staggered, and every
headline numeral counts up. Accent-toned marks carry a soft
glow; a single-series line gets a gradient wash. `prefers-reduced-motion`
turns the animation off and keeps the geometry — the richness is visual
only, and the text around a chart stays plain. Every SVG data-chart kind (not
`stat`) ships hover tooltips (keyboard focus shows the same readout),
a `view data` table twin, a legend when two or more series are present, and a
Present driver `{count, go}` that reveals items one keypress at a time.
Adds `data-zoom` unless `zoom:false`.

Pick the kind by the data's job — and first check the form is a chart at all:
**one current number is `kind:'stat'`, not a one-bar chart**.

| Job | Kind |
|---|---|
| Trend over time | `line` |
| Trend where the filled volume helps the read | `area` (same data as `line`; every series gets a gradient wash — the studio can swap line ↔ area with one click) |
| Compare magnitudes | `bars` (horizontal, values at the tips) |
| Before → after per item | `dumbbell` |
| Part-to-whole share | `split` (one gapped bar, labels below) |
| A distribution over bins | `histogram` (contiguous columns, peak labeled) |
| Two measured axes, point per subject | `scatter` (`x` and `y` must be non-negative; label the points that matter and use context gray for the rest) |
| Magnitude over a grid (day × hour, service × region) | `heatmap` (one hue, more-is-stronger, ramp legend) |
| Exact votes, people, or represented units | `dots` (one countable mark per `unitSize`; parts must sum to `total`) |
| Where things happen in the world | `map` (highlighted countries + lon/lat pins on a quiet world; needs `geo-world` in `meta.components`) |
| A count that is the story | `stat` (big animated numerals, folded in from the retired `stat` component; scale before detail) |

**Color grammar is emphasis, never categorical.** The kit deliberately has no
multi-hue categorical theme (accent + violet fails colorblind-separation
checks in three of the four styles — validated, not eyeballed). The subject
series/bar wears `tone:'accent'`; everything else defaults to `'context'`
(recessive gray); identity comes from direct labels and the legend. Status
tones (`success`/`warning`/`error`) are allowed only when the color *means*
status. Two subjects that both deserve emphasis → two small charts, not two
hues. Cap: 3 series on `line`, ≤6 parts on `split`.

```js
// line — trend; series[0] defaults to accent, the rest to context gray
var api = renderChart('#host', {
  kind: 'line', unit: 's',
  itemMode: 'all',        // optional: all (default) | key
  view: 'follow',          // optional: follow (default) | full
  labels: 'all',           // optional: all (default) | key
  ariaLabel: 'fetch p90 over 7 days',
  x: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],
  series: [
    {label:'humans', key:true, values:[92,101,123,110,96,44,41]},         // accent
    {label:'automation', values:[130,128,131,127,129,126,128], tone:'context'},
  ],
  baseline: 'zero',        // default; 'data' bases the axis on the data range
});

Studio keeps Line ↔ Area as the only chart-type swap. Compatible row/series
charts with explicit `key:true` items also expose **Items** and **Labels**;
numeric-index walkthroughs keep the full set because filtering would change
their meaning. **Full** keeps every mark equally visible while walkthrough
copy advances; **Follow** applies the authored focus.

// bars — magnitudes; put the accent on the subject, not on every bar
renderChart('#host', {
  kind: 'bars', unit: 's',
  items: [
    {label:'full clone',        value: 200.9},                   // context gray
    {label:'partial clone',     value: 91},
    {label:'shallow --depth 1', value: 33, tone:'accent'},       // the subject
  ],
});

// dumbbell — before → after per item, one shared unit and scale
renderChart('#host', {
  kind: 'dumbbell', unit: 'K refs',
  beforeLabel: 'April', afterLabel: 'August',
  items: [
    {label:'pipeline refs', before: 257.9, after: 0.5},
    {label:'MR heads',      before: 11.7,  after: 2.3},
  ],
});

// split — part-to-whole; values summing to ~100 render as percentages
renderChart('#host', {
  kind: 'split',
  parts: [
    {label:'history',          value: 87, tone:'accent'},
    {label:"today's snapshot", value: 13},
  ],
});

// area — same contract as line; use when the filled volume helps the read
renderChart('#host', {kind: 'area', unit: 'GB', x: [...], series: [...]});

// histogram — a distribution; the peak bin gets the one direct label
renderChart('#host', {
  kind: 'histogram', unit: 'fetches', xLabel: 'duration',
  bins: [
    {label:'<15 s', value: 18432}, {label:'15–30 s', value: 9210},
    {label:'30–60 s', value: 4988}, {label:'1–2 m', value: 1502},
  ],
});

// scatter — two measured axes; label and accent only the points that matter
renderChart('#host', {
  kind: 'scatter', unit: 's', xUnit: 'GB',
  xLabel: 'repository size', yLabel: 'clone time',
  points: [
    {x: 5.8, y: 200.9, label: 'adyen-main', tone: 'accent'},
    {x: 1.1, y: 41},                                   // context gray
  ],
});

// heatmap — magnitude over a grid; one hue, more-is-stronger, ramp legend
renderChart('#host', {
  kind: 'heatmap', unit: 'fetches',
  rows: ['Mon','Tue','Wed'], cols: ['00','04','08','12','16','20'],
  values: [[9800,1200,3400,4100,3900,2200], [ ... ], [ ... ]],
});

// dots — exact representation, not a decorative texture. The authored
// values must sum to total and each value must divide evenly by unitSize.
renderChart('#host', {
  kind: 'dots', total: 100, unitSize: 1, columns: 20,
  parts: [
    {label:'In favor', value:72, tone:'accent'},
    {label:'Other votes', value:28, tone:'context'},
  ],
});

// map — where things happen in the world. Requires "geo-world" in
// meta.components (it pulls chart in automatically): ~95 KB of vendored,
// pre-projected Natural Earth countries — pay it only when geography
// carries the story. The world renders as quiet context; regions
// (countries by ISO alpha-3 code or name) and pins (lon/lat markers with
// a radar ring) wear the tones. dx/dy nudge a small country's label clear.
renderChart('#host', {
  kind: 'map', unit: 's',
  regions: [
    {id:'NLD', label:'Amsterdam', value: 13.4, tone:'accent', dy: -14},
    {id:'BRA', label:'São Paulo', value: 41.0},
    {id:'AUS', label:'Sydney',    value: 55.2},
  ],
  pins: [ {lon: 4.9, lat: 52.37, label: 'origin', tone: 'success'} ],
});

// stat — big-number roll-call: two or three huge numerals that give scale
// before the detail arrives. Use where the count *is* the story ("1 floor ·
// 14 scoped · 3 checks"); pair it with a `table` mode:'rows' that then
// walks the detail. A numeric `n` may include a suffix/unit (`585M`, `200.9 s`);
// the number counts while that suffix remains fixed. A non-numeric string
// ("~0s") renders as-is without the count-up. `ticks` is an integer from 0
// to 24. Keep `label` and `sub` plain text; glossary buttons belong in the
// content slot, never in component data.
var stats = renderChart('#host', {
  kind: 'stat',
  items: [
    {n: 1,  label: 'non-bypassable floor', sub: 'security-reviewer, every change', tone: 'accent'},
    {n: 14, label: 'scoped reviewers', sub: 'join by the files you touched', ticks: 14},
    {n: 3,  label: 'gate checks', tone: 'success'},
  ],
});
// Present: fire the count-up as a fragment — steps: {count: 2, go: i => i > 0 && stats.play()}
```

Mounted stats register a host-scoped Studio **Component Tweaks** accordion with
`calm` / `normal` / `off` motion. `normal` keeps the standard count and tick
arrival; `calm` shortens the count with a tighter, quieter tick stagger and
reduced glow; `off` shows final numbers and ticks immediately. Changing it
previews and replays only that stat outside Present mode. The operating-system
reduced-motion preference always takes precedence.

Trace belongs to the architecture family; use `renderTrace` and the contract
under [trace](#trace). `renderChart('#host', {kind:'trace', ...})` remains a
compatibility path for existing v3 drafts.

**Walkthrough steps** — any kind accepts `walkthrough`, turning the chart
into an architecture-style guided read. `overview` teaches how to read the
whole chart; each step positively marks its focus while the rest dims; optional
`completion` restores the full chart and states the conclusion. Line and area
steps also get a highlight band over the selected x-range. Legacy
`{label, focus}` steps remain accepted, but `{title, note, focus}` carries more
signal. Read view provides progress dots plus Previous/Next; Present hides those
buttons because the deck arrows own navigation while retaining the narrative
and progress. Use this when the chart *is* the story and deserves narration.

```js
var api = renderChart('#host', {
  kind: 'line', ...,
  overview: {
    title: 'Read the week as two regimes',
    note: 'Weekdays establish the baseline; the weekend shows the changed system.',
  },
  walkthrough: [
    {title:'Weekday baseline', note:'Humans hover near two minutes.', focus:{x:[0,4]}},
    {title:'The fix lands', note:'Friday night separates the two regimes.', focus:{x:4}},
    {title:'Weekend result', note:'Human p90 falls by more than half.', focus:{x:[5,6], series:'humans'}},
  ],
  completion: {
    title: 'The improvement holds',
    note: 'Restore the complete chart and state the evidence-backed payoff.',
  },
});
// focus by kind:  line / area {x: i | [a,b], series:'label'}
//                 bars / dumbbell / stat {item: i | 'label'}
//                 split {part: i | 'label'}
//                 histogram {item: i | 'bin label'}
//                 scatter {item: i | 'point label'}
//                 heatmap {item: i | 'row label'}   (focuses a row)
//                 dots {part: i | 'part label'}
//                 map {item: i | 'ISO/region/pin label'}  (i over regions, then pins)
//                 trace {lane:'name'} | {span:'id'} | {replay:true} (fires
//                       the replay sweep instead of focusing/dimming)
// api.count/api.go drive the walk from the Present manifest as usual.
```

Honesty rules the component enforces or expects: `bars` and `split` are always
zero-based; `line` defaults to a zero baseline (`baseline:'data'` is for
trends where zero is meaningless — say so in a `muted-note`); one axis only;
values keep their real units via `unit` or per-item `display` overrides
(`display:'200.9 s'` wins over formatting). Stamp hand-collected numbers with
a `data-stamp` outside the component, as everywhere else. `trace` is
inherently zero-based (trace-zero is the axis origin) — there is no
`baseline` option to misuse.

## stepper

One concept per step: numbered dots, prev/next, prose left / code right.
Labels, titles, bodies, and filenames are plain text. Pre-highlighted code accepts
only `<span>` elements with `y-key`, `y-str`, `y-num`, `y-bool`, or `y-com`.
Requires 1–6 steps. Per step: `label` ≤32 chars, `title` ≤40, `body` ≤180,
code filename ≤64, and code ≤4 lines. Returns `{go(i), count}` — drive it
from a Present slide with `steps:{count:api.count, go:function(i){api.go(i)}}`
or `clickSteps('#host .kst-dot')`.

```js
var api = renderStepper('#host', {
  steps: [{
    label: 'Step 01 · You',              // optional mono eyebrow
    title: 'Describe the next fix',
    body:  'A sentence or two…',
    code:  {filename:'.factory/droids/python-reviewer.md',
            html:'<span class="y-key">name</span>: python-reviewer'},  // optional, pre-highlighted
  }],
});
```

## flow

Generated journey/gate SVG, built on the same pulse-engine idea as
`architecture`/`data-flow` (a bright head + fading tail scrubbed along the
edge's own geometry). Cards occupy a content lane above the transit rail and
connect to it with short stems; the rail never runs through a card. A diamond
gate's branch legs light once the pulse reaches it. The canvas is zoomable and
the default 1200-wide layout keeps that reading floor on narrow viewports.

Flow accepts 1–6 items. Per item: `when` ≤22 chars, `label` ≤24, up to two
`sub`/`subs` lines of ≤30 chars, and up to two outcomes of ≤24 chars. Fixed
card subcopy must not use `·` lists; use separate `subs` entries or rewrite it
as one phrase. The shared text-limit registry validates these fields during
assembly; dynamic overages report loudly and continue rendering.
Gate outcomes render as compact result rows attached to one shared branch
spine. The result zone chooses the side that keeps it inside the logical canvas;
success/error tone belongs to each terminal arm and row, while the shared
decision spine keeps the gate's accent. Placement is planned across all gates
before rendering. If adjacent outcome zones cannot fit without intersecting,
Flow throws `gate outcome zones overlap at this width`; pass a larger `width`
rather than accepting a misleading overlap.
Pass `width` (for example `1500`) when five or six stages need more routing
space. Read view keeps that authored logical width and owns horizontal scrolling;
Present gives Flow a wide stage and fits the complete rail before using horizontal
scrolling as a last-resort escape hatch. Present warns when fixed widths or
`minScale` make the standard viewport impossible. `width` supports at most 4800
logical pixels. Item fields are plain text; `caption` uses the table
contract's strict passive inline-formatting allowlist.
Returns `{count, go(i)}` so a Present slide can light it up step by step.

Studio exposes **Layout**, **Text**, and **View**. **Stage briefing** and
**Event briefing** are vertical readings with the authored outcomes and dates.
The event briefing preserves source order; vertical gaps do not represent elapsed
time. Key text removes only
secondary `sub`/`subs` and non-timeline `when` copy. Full keeps every station
lit; Follow retains the authored reveal progression.

```js
var flow = renderFlow('#host', {
  layout: 'across', // optional: across (default) | down, including timeline mode
  detail: 'more',   // optional: more (default) | key
  view: 'follow',   // optional: follow (default) | full
  ariaLabel: '/merge-check at a glance',
  caption: 'every merge answers — did a <b>real review</b> run on <b>exactly this code</b>?',
  items: [
    {type:'station', kind:'accent', when:'AS YOU ITERATE', label:'/merge-check',
     cmd:true, loop:true, subs:['you run it', 'changed files only']},
    {type:'station', kind:'warn', when:'BEFORE YOU MERGE', label:'One full review',
     subs:['adversarial review + outcome', 'saved as an attestation']},
    {type:'gate', when:'AT THE MERGE', label:'A rule, not an AI',
     sub:'a deterministic fact-check',
     outcomes:[{tone:'ok', text:'✓ still current'}, {tone:'bad', text:'✕ out of date'}]},
    {type:'station', kind:'ok', check:true, sub:'merge'},
  ],
});
// Present slide: { pick:['#host'], layout:'diagram', steps:{count:flow.count, go:flow.go} }
```

**`mode:'timeline'`** — an additive variant: stations position by date
instead of by even spacing, and the dates sit on the axis under the track.
Reach for it when a handful of dated events form one sequence. For parallel
workstreams, dependencies, or more than six commitments, use `roadmap`.

```js
renderFlow('#host', {
  mode: 'timeline',
  today: 'Q3 25',                        // optional; only drawn when positions are truly proportional
  items: [
    {label:'table ships',    state:'shipped', at:'Q1 25', sub:'six modes, one contract'},
    {label:'pulse engine',   state:'now',     at:'Q3 25', sub:'async edges, live traffic'},
    {label:'next diet pass', state:'planned', at:'Q4 25', sub:'no candidates yet'},
  ],
});
```

`at` accepts `Q1 25`-style quarter labels or anything `Date.parse`
understands. If any station's `at` fails to parse, or every value is
identical, positions fall back to equal spacing rather than half-placing a
timeline — and `today` (which needs the same proportional axis) is skipped
too. `state` (`'shipped'|'now'|'planned'`) styles the marker and title:
`shipped` fills green, `now` fills accent and breathes once lit, `planned`
stays a hollow dashed marker with dim text — the future stays humble. A
`type:'gate'` has no date of its own; when the surrounding stations form a
proportional timeline, it is interpolated between its nearest dated neighbours
so item order and rail direction stay true.

Bespoke SVG diagrams are still allowed for genuinely spatial topics (threat
models, architecture). Rules when you draw your own: viewBox at least 1000 wide
for a full-width diagram, **no `<text>` below 12px**, empty geometry with
leader-lined labels, and put `data-zoom` on the wrapper `<figure>` so the kit
adds the expand affordance automatically.

## architecture

Studio disables domain layouts that exceed their supported domain or label budgets.
Long request journeys with two to four top-level boundaries read down each boundary
before crossing to the next, preserving branch routes outside intermediate boxes.

A grouped technical system map for tracing data through components, APIs,
compute, storage, trust boundaries, and asynchronous traffic. Dashed labelled
boundaries make containment explicit, including nested groups such as
"Compute" inside "API". Nodes use readable system type; `look:'sketch'` adds
subtly irregular corners and softer depth without switching to a handwritten
font. Connectors automatically anchor to separate node ports and use orthogonal
routes with quiet outer rails for return paths.

The component includes an optional walkthrough panel. `go(0)` shows the complete
overview; each later step dims the map and highlights the named nodes, edges, and
groups. With no steps the map stays static and no empty controls or walkthrough
panel render. Returns `{count, go, current}`.

```js
var architecture = renderArchitecture('#host', {
  width: 1600,
  height: 560,
  layout: 'free',                    // free | stages | main-flow | groups
  detail: 'minimal',                  // minimal | contextual
  look: 'sketch',                    // sketch | clean
  ariaLabel: 'A browser mutation crosses the API boundary and reaches storage',
  groups: [
    {id:'client', label:'Untrusted · browser', x:20, y:20, w:560, h:520, style:'dashed'},
    {id:'server', label:'Trusted · server', x:620, y:20, w:960, h:520, tone:'success', style:'solid'},
    {id:'api', parent:'server', label:'API', x:660, y:70, w:400, h:300, tone:'accent', style:'dashed'},
    {id:'compute', parent:'server', label:'Compute', x:1110, y:70, w:430, h:300, tone:'violet', style:'dashed'},
    {id:'storage', parent:'server', label:'Storage', x:660, y:395, w:880, h:120, style:'dotted'},
  ],
  nodes: [
    {id:'ui', group:'client', x:60, y:115, w:190, h:88, eyebrow:'Client', title:'Browser UI', sub:'Nuxt / Vue'},
    {id:'outbox', group:'client', x:380, y:115, w:190, h:88, title:'Local outbox', sub:'SQLite', tone:'accent'},
    {id:'gateway', group:'api', x:700, y:115, w:300, h:88, eyebrow:'Endpoint', title:'POST /sync/push', tone:'success'},
    {id:'authz', group:'api', x:700, y:245, w:300, h:88, title:'Authorization', sub:'identity + policy'},
    {id:'worker', group:'compute', x:1160, y:245, w:300, h:88, title:'Conflict resolver', sub:'validate · dedupe'},
    {id:'db', group:'storage', x:740, y:440, w:250, h:58, title:'PostgreSQL'},
    {id:'audit', group:'storage', x:1160, y:440, w:250, h:58, title:'Audit log'},
  ],
  edges: [
    {id:'local', from:'ui', to:'outbox', label:'field edit'},
    {id:'push', from:'outbox', to:'gateway', label:'push event', tone:'accent'},
    {id:'authorize', from:'gateway', to:'authz', tone:'warning'},
    {id:'resolve', from:'authz', to:'worker', tone:'success'},
    {id:'persist', from:'worker', to:'db', tone:'success'},
    {id:'record', from:'worker', to:'audit', tone:'success'},
  ],
  overview: {
    title: 'Walk the data flow →',
    body: 'Trace one mutation across the client, API, compute, and storage groups.',
  },
  steps: [
    {title:'1 · Edit locally', body:'The UI writes to the local outbox.', nodes:['ui','outbox'], edges:['local'], groups:['client']},
    {title:'2 · Cross the boundary', body:'The push enters the trusted API.', nodes:['outbox','gateway'], edges:['push'], groups:['client','server','api']},
    {title:'3 · Enforce and resolve', body:'Identity, policy, and conflict checks run server-side.', nodes:['authz','worker'], edges:['authorize','resolve'], groups:['api','compute']},
    {title:'4 · Persist evidence', body:'State and the audit record are stored.', nodes:['db','audit'], edges:['persist','record'], groups:['storage']},
  ],
});
// Present slide: {pick:['#host'], layout:'wide', minScale:0.6,
//                 steps:{count:architecture.count, go:architecture.go}}
```

`detail:'minimal'` is the default. It keeps every boundary, node, connector,
filter, edge label, walkthrough step, and walkthrough paragraph while hiding
node eyebrows and subtitles plus group subtitles. `detail:'contextual'` adds
that secondary copy. Both stay visually flat without the canvas dot field or
decorative shadows. Studio exposes this as **Text: Key only | More detail**.

Groups without an authored `tone` receive stable colors in group order; nested
groups inherit their parent color, and untoned nodes inherit their group color.
An explicit group or node `tone` still wins. Group parent chains must be
acyclic.

`layout:'free'` keeps authored geometry (**System map**). `layout:'stages'`
places systems in domain columns, falling back to dependency depth when domains
are absent (**Domain detail**). `layout:'main-flow'` keeps systems and connections
named by walkthrough steps (**Request journey**); it does not infer a critical
path or invent gating relationships. `layout:'groups'` aggregates connections by
owning domain and retains concrete member names (**Domain overview**).

**Direct canvas adjustments.** System architecture supports optional
`canvasEdits: {version:1, layouts:{[layout]:{nodes:{[nodeId]:{x,y,w,h,identity}}}}}`.
Coordinates are fractions of the layout's intrinsic canvas, not viewport pixels.
Identity is the exact `title || id`, `group || ''`, and `kind || ''`, joined by `|`.
Renderers apply edits after layout and before routing connections. Missing nodes
or identity mismatches retain automatic geometry and surface a skipped count.
Stable node and host IDs are required to retain edits across rebuilds.

Studio saves records directly in the authoring manifest (under the source
component or authored slide's `canvas` envelope); it is not a patch to generated
HTML. Discard restores the authored record. Undo and redo are per layout, limited
to 40 actions, and last for the open session. Move/resize does not change node
membership, edge endpoints, or graph semantics. The same trusted canvas boundary
is used by Architecture and Operating Model; individual icons and manual arrow
routing remain agent work.

### Async edges, queue/topic nodes, and `fire`

Every edge is `sync` (a solid stroke) by default. `edge.kind:'async'` draws a
dashed stroke and carries a traveling pulse — a bright dot with an 18px
fading tail, scrubbed along the edge's own geometry so it follows every bend
exactly. Outside a walkthrough step (the overview, or an inactive step) async
edges run a coordinated producer/consumer simulation instead of looping
independently:

- `node.kind:'queue'` hands each arrival to exactly one outgoing edge,
  alternating across arrivals — competing consumers.
- `node.kind:'topic'` (the default for any node with more than one outgoing
  async edge) broadcasts — every outgoing edge fires together.
- `edge.filter` (a short predicate string, **≤ 24 characters**; recognized
  inline literals fail assembly, while dynamic overages warn rather than aborting
  the deck) thins one leg of a topic's broadcast: it skips 1–2 beats other legs
  take, rendered as a small funnel glyph + mono
  text at the edge's midpoint.

`queue`/`topic` nodes also carry their own visual: a stacked-slats glyph on
the node's left edge (parallel bars read "buffer", the same three bars fanned
12° read "fan-out") and a pill radius.

A walkthrough `step.fire: ['edgeId', ...]` is separate from all of the
above — a one-shot pulse travel (600–900ms) the moment that step activates,
independent of the edge's sync/async kind and of whether the edge is
currently active or dimmed. It is skipped only when the edge is already
continuously live (a fire on top of that would just fight the same
animation for nothing).

### The `operating-model` preset

For programs and ways of working, supply `stages` (2–5 entries) and explicit
`handoffs`. Each stage requires a stable `id` and `title`; optional `owner`,
`cadence`, and `body` describe accountability, rhythm, and supporting context.
Optional `decider` names the decision authority and `partners` names contributors.
Each handoff requires a unique `id`, known `from`/`to` stage IDs, and a `label`;
`kind: 'feedback'` identifies a return of learning. Optional `acceptance` explains
when the receiving owner can accept the handoff (shown with More context).
Multiple incoming/outgoing handoffs are supported; array order is reading order,
not an inferred dependency. This is a responsibility map, not a RACI matrix. No relationships or owners
are inferred. Keep titles short enough for the room.

| Layout | Reading task | Required data |
| --- | --- | --- |
| `flow`, Working flow | Follow activities and outgoing handoffs | Existing stages and handoffs |
| `roles`, Responsibilities | Compare owners, decisions, and cadence | Existing stages and handoffs |
| `lanes`, Collaboration lanes | Follow work across owner boundaries | An explicit `owner` on every stage |
| `progression`, Capability progression | Compare capability states across program phases | Explicit states for every capability in every phase |
| `gates`, Readiness gates | Review the evidence required to advance | 2–4 phases with an explicit gate between each adjacent pair |

`flow` remains the default. Lanes group equal owner strings, keep stage-array
reading order, and draw only authored handoffs. Numbered connectors refer to a
handoff key. Non-adjacent connections use a separate route below the lanes;
`kind: 'feedback'` distinguishes a return path. Lanes do not infer a RACI matrix,
a schedule, or decision branches from prose.

For capability progression, the existing stages become phase columns. Supply
`progression.states`, 2–5 definitions with unique `id`, `label`, and explicit
`tone` from `neutral`, `accent`, `violet`, `success`, or `warning`. Supply
`progression.capabilities`, 2–8 entries with unique `id`, `label`, and a `states`
map keyed by stage ID. Every capability needs a known state in every phase;
missing values and unknown IDs throw rather than implying progress. For example,
`states: {define: 'planned', deliver: 'ready', operate: 'proven'}` uses authored
stage and state IDs, not reserved names.

Capability order stays fixed across phases. Each cell names both the capability
and its state; colour is not the only signal. Solid state fills choose black or
white text for contrast and refresh after theme or palette changes. Optional
`progression.horizons` contains up to four `{from, to, label, owner}` bands over
consecutive phase columns. `owner` is optional, explicit accountability for the
whole horizon, and stays visible in both detail modes. The generic handoff
principle is not shown in this view.

Optional `progression.caption` distinguishes target states from observed status.
No duration, completion status, or monotonic improvement is inferred. Progression
walks through every phase in stage-array order, using its title and body. It
focuses one phase at a time and highlights its incoming adjacent handoff. Only
forward adjacent handoffs appear as arrows and in the key. Feedback and other
connections remain in the source for the other layouts, without unused key items
or feedback-only steps in progression.

For gates, supply exactly one forward handoff between each adjacent pair of
phases. Each handoff needs `criteria`, an array of 1–4 objects with a required
`label` and optional `evidence`, plus an explicit `approver`. Optional `hold`
states what happens when the criteria are not met. Optional stage `audience`
names who has access in that phase. The last phase uses its `body`, `cadence`,
and `decider` to describe ongoing operation, rather than inventing another gate.
Criteria are requirements, not live completion statuses. No phase advances on a
timer or because a reviewer clicked Next.

`detail: 'minimal'` keeps ownership and handoffs visible. Gate criterion labels,
approvers, and hold conditions remain visible in both detail modes;
`'contextual'` adds evidence descriptions and supporting stage prose. Unsupported
layout choices explain their missing data instead of inventing it. Older models
keep their existing `flow` or `roles` layout without new required fields.

Changing operating-model layouts restarts at the overview, so Next begins at
step 01. Context changes keep the current position. Present honours the reset
instead of restoring a step from the previous layout. Outside progression,
authored steps name stage IDs through `nodes` and handoff IDs through `edges` or
`fire`, with at most six steps. A gate-focused step names its handoff; a
phase-focused step names its stage. Cover every phase and transition in a
complete explanatory walkthrough.
Handoffs are static direction indicators, not animated runtime traffic. The
showcase has separate collaboration and launch-readiness examples.

The legacy shape below remains supported for decision-centered models.

`preset: 'operating-model'` selects a purpose-built architecture-family
renderer: policy sits on a rail above, inputs and outcomes occupy separate
columns, the decision is the visual center, and optional audit/review stays
out of band below. The open stage has reserved connector lanes and no giant
enclosing system box. It keeps architecture's zoom, pulses, walkthrough API,
node/edge ids, and Present driver, so existing authored steps still work.

```js
var operatingModel = renderArchitecture('#host', {
  preset: 'operating-model',
  ariaLabel: 'Policy and inputs feed a routing decision; accepted work fans out downstream and an async edge carries outcomes to audit',
  policy: [
    {eyebrow:'Policy', title:'Delivery guarantee', sub:'at-least-once'},
  ],
  inputs: [
    {eyebrow:'Product input', title:'Order schema', sub:'v3 event contract', tone:'accent'},
  ],
  decision: {eyebrow:'Control plane', title:'Event router', sub:'evaluate · route · dedupe'},
  outputs: [
    {eyebrow:'Downstream', title:'Fulfillment queue', sub:'accepted orders'},
  ],
  audit: {eyebrow:'Post-operation', title:'Routing audit', sub:'sampled review of drops'},
});
// Present slide: {pick:['#host'], layout:'wide', minScale:0.6,
//                 steps:{count:operatingModel.count, go:operatingModel.go}}
```

`decision.title` is required. `policy`, `inputs`, and `outputs` are required
arrays: **1–3** policy cards, **1–4** inputs, and **1–4** outputs. Those caps
protect the connector lanes and are structural errors when exceeded; text-cap
issues use the normal Studio repair path and never disable Present at runtime.
`audit` is optional and becomes the one async edge in the preset — outcomes
flow back out of band from the decision, not on the main accepted-work path.
The preset is skipped entirely (never merged) the moment explicit
`groups`/`nodes`/`edges` are also present, so authoring never has to
reconcile the two.

### Deterministic rules — read before authoring

These rules are enforced by the component or are hard-won lessons from
production use. Following them deterministically produces a clean diagram
without manual fiddling.

**Canvas and width.** The diagram fills its container width (no `max-width`
cap). Set `width` to the viewBox units you need for layout (1600-2000 for
dense diagrams) — the SVG scales to fit. Do not try to constrain the render
width; the component handles responsiveness.

**Coordinates.** Groups and nodes require `x`, `y`, `w`, and `h`; nested
groups still use absolute coordinates and name their parent with `parent`.
Node centres should sit inside their declared group. Reserve at least 50
viewBox units below a group's top edge for its label before placing nodes.

**Node text — reword, don't wrap.** Fixed node boxes budget `eyebrow` ≤20
visible chars, rendered `title` ≤30, and `sub` ≤30. Assembly rejects recognized
inline literal overages with the renderer, exact authored field path, value,
length, limit, and suggested fix. Dynamic forms remain runtime-only: the browser
logs a console error and keeps the diagram rendering, using the node's
ellipsis/wrapping fallback instead of aborting Present. Reword rather
than relying on clipping. Use `size:'small'` for dense surfaces with five or more
endpoints and increase `width` to give narrow nodes breathing room; on narrow
screens the component keeps a 1200px reading floor and owns scrolling.

**Group labels.** Fixed font size with ellipsis truncation — all groups show
the same label size regardless of width. Long group labels truncate, so keep
them short.

**Edges and routing.** Edges reference node IDs and accept `tone`, `label`,
`labelDx`, `labelDy`, `dashed`, `fromSide`, `toSide`, `kind:'async'`,
`filter`, and `route:'straight'|'curve'`. The default (no `route` specified)
is an orthogonal connector with rounded joins. Connections sharing a node side
receive separate ports, while right-to-left return paths use a quiet outer rail
instead of cutting back through the map. Use `route:'curve'` for a cubic Bezier,
`route:'straight'` for a direct line, or `via:[{x,y},...]` for manual waypoints.
`fromSlot` and `toSlot` (`0.1`–`0.9`) optionally pin the position along an
authored side; otherwise shared ports spread automatically.

**Edge labels = numbered markers + legend.** Edge `label` text renders as a
small numbered circle on the arrow, with a wrapping HTML legend below the
canvas mapping each number to its label. This avoids cramming text onto short
arrows in dense diagrams. Markers follow the first occurrence of each edge in the authored walkthrough
(`steps[].edges`, then `steps[].fire`); remaining edges keep source order.
Numbers stay stable across layout and spacing changes. `labelDx`/`labelDy` nudge
the marker position. You do not need to number edges yourself — the component
handles it.

**Marker collision avoidance.** The component samples several positions along
the actual straight, waypoint, or Bezier route. It rejects positions inside an
unrelated node's padded bounds or within 32 viewBox units of an earlier marker,
then tries small cardinal offsets as a fallback. Endpoint nodes are excluded from
this collision check because the route begins and ends at their boundaries.

**Tight gaps.** For edges shorter than 90 viewBox units, each sampled marker is
automatically offset perpendicular to the edge so it sits in open space. Long
edges try t=0.3 first (closer to the source) before the other collision-free
candidates, avoiding the middle of the canvas when possible.

**Walkthrough steps.** Every labeled edge **must** appear in at least one
step's `edges` array. Unknown node, edge, group, or fired-edge references and
labeled edges orphaned from all steps throw before rendering. Step titles may
include an ordinal prefix (`"1 · Author the contract"`)
for your own reference; the component strips it before display so it doesn't
collide with the numbered edge markers. The progress dots serve as the step
ordinal.

**Zoom.** The expand button clones the canvas container (HTML nodes + both SVG
layers), so the zoomed view shows the complete diagram, not just the arrows.
This is handled automatically by `data-zoom`.

Use `architecture` when containment and movement are both part of the
explanation — including the `operating-model` preset for a fixed
policy/decision/downstream topology — and `flow` when only the sequence
matters.

`architecture` has four siblings, documented next: `trace` (where request
time goes), `sequence` (who calls whom, in what order), `erd` (what the data
is, how it relates), and `stack` (one request descending through layers).
Roster: `architecture` · `trace` · `sequence` · `erd` · `stack`. All five are
the same family — shared walkthrough context (`go(0)` overview, named focus,
and a `{count, go}` Present driver). Sequence and stack retain numbered
markers; ERD uses an optional relationship reference without generated numbers.
Sequence, ERD, and stack use the family pulse;
trace uses its clock-driven replay. `prefers-reduced-motion` leaves every
member fully static. `stack` also trades the shared SVG `kdf-canvas`
coordinate system for plain HTML flow, so it reflows to mobile width instead
of floor-and-scroll.

## trace

An architecture-family waterfall for where a request's time goes. Work and
wait spans share one clock and group into service or actor lanes; `compare`
stacks two sides into a before/after race. Use `renderTrace` and include
`trace` in `meta.components`; its architecture/chart dependencies load only
for pages that request Trace. The host stamps `ktrace` and
`host.__kitBase.kind === 'trace'` for Studio detection.

```js
var trace = renderTrace('#host', {
  width: 1400,
  unit: 'ms',
  ariaLabel: 'checkout authorization: serial vs parallel',
  compare: {
    before: {label: 'serial', spans: [
      {id:'edge', label:'edge terminate', lane:'edge', start:0, dur:6},
      {id:'wait', label:'pool wait', lane:'api', start:6, dur:340,
       kind:'wait', note:'conn pool · 5 cap'},
      {id:'validate', label:'api validate', lane:'api', start:346, dur:32},
    ]},
    after: {label: 'parallel', spans: [
      {id:'edge', label:'edge terminate', lane:'edge', start:0, dur:6},
      {id:'validate', label:'api validate', lane:'api', start:6, dur:32},
    ]},
  },
  overview: {
    title: 'Compare the same six spans',
    note: 'Numbers match spans across both traces. Hatching is wait time.',
  },
  walkthrough: [
    {title:'Pool wait, then validation', note:'Serial waits 340 ms for a connection before validation.', focus:{spans:['wait','validate']}},
    {title:'Replay on one clock', note:'Replay both traces against the same clock.', focus:{replay:true}},
  ],
  completion: {
    title: 'Parallel finishes 58% faster',
    note: 'The complete race cuts 663 ms to 278 ms.',
  },
});
// Present slide: {kicker:'Authorization trace', pick:['#host'], layout:'wide',
//                 minScale:0.9, steps:{count:trace.count, go:trace.go}}
```

`spans` (single trace) and `compare` (the race) are mutually exclusive. A race
uses exactly `compare.before` and `compare.after`; both sides share the
`after` side's lane order, followed by any before-only lane. Matching span IDs
receive the same compact marker number on both sides. Span labels leave the
canvas and appear once in the numbered `kdf-legend` below it; hovering a legend
item highlights every matching span on both sides. Walkthrough focus marks the
matching legend entries and dims the rest. Legacy `{label, focus}` steps remain
accepted, but `{title, note, focus}` is preferred. Dedicated Trace uses the same
guided state model as charts: an explicit overview, Previous/Next navigation in
read view, accessible current/done progress, and an optional completion that
clears focus, finishes any replay, restores the full waterfall, and states the
conclusion.

Wait spans (`kind:'wait'`) stay hatched. Each race side gets its own quiet focus
band, derived only from matched spans on that side; a serial 558–663 ms range
never merges with a parallel 218–278 ms range. Unmatched spans remain legible at
context weight, while focused spans add a 2px outline, filled number marker, and
duration.

Replay uses one elapsed-time clock for the cursor, partial span fills, and both
TOTAL counters, so they cannot drift. During replay each total keeps its endpoint
(`62 / 663 ms`); the faster side freezes while the slower continues, and the
cursor carries the elapsed time. Completion states the outcome directly, such as
`385 ms saved · 58% faster`. `focus:{replay:true}` clears focus and starts the
sweep. Reduced motion renders the completed static trace and hides replay motion.

Caps: 1–12 spans per trace, ≤5 distinct lanes (name ≤16 chars), span `label`
≤24 chars, `note` ≤28 chars, race-side `label` ≤14 chars, and ≤3 overlapping
sub-rows per lane. `dur` must be > 0; `start` must be >= 0; only `work` and
`wait` are valid kinds. Invalid walkthrough lane/span references throw.

Trace uses an authored width around 1400, the 1440px architecture scroll
breakout, and a near-full-width Present stage capped at 1600px. Its dedicated
waterfall uses taller rows and bars in Present, and the slide should normally be
kicker-only so duplicate prose does not shrink the visual. The numbered legend
and walkthrough share one fixed footer; Present hides component Previous/Next
controls, and an authored replay step owns replay instead of a floating play
button. An optional completion may follow it.
Comparison traces expose **Composition: Timing | Outcome summary**. Timing keeps
the synchronized waterfalls. Outcome summary derives the before/after totals,
their end-to-end difference (faster, slower, or unchanged), a wait the after
side actually removed or shortened, and overlap evidence from the same authored
spans so an audience can read the result without decoding the time axis.
Legend items support pointer and keyboard cross-highlighting. The data-table twin,
tooltips, wait hatching, reduced-motion state, and host disposal remain.
`renderChart('#host', {kind:'trace', ...})` stays supported for existing v3 drafts
with its original chart chrome and replay button; new sources must call
`renderTrace`.

## sequence

Who calls whom, in what order. Vertical lifelines (one per actor, left→right
in array order), time flows down, messages are horizontal arrows read top to
bottom — the array order **is** the time order.

```js
var seq = renderSequence('#host', {
  view: 'full',                       // optional: full (default) | parts
  messageMode: 'all',                 // optional: all (default) | key
  typeScale: 'standard',              // optional: standard (default) | large
  actors: [                         // 2..6, left→right in array order
    {id:'web', label:'Checkout', sub:'web app', kind:'service', tone:'accent'},
    {id:'api', label:'Payments API', sub:'service', kind:'service'},
    {id:'psp', label:'PSP', sub:'card network', kind:'service', tone:'violet'},
    {id:'events', label:'Order events', sub:'fan-out topic', kind:'topic', tone:'success'},
    // kind: 'actor' (person glyph) | 'service' (default, plain card) |
    // 'queue' | 'topic' (the kdf slats glyph: parallel bars vs fanned 12°) |
    // 'store' (cylinder)
  ],
  messages: [                       // 1..10, top→bottom in array order = time order
    {id:'m1', from:'web', to:'api', label:'POST /payments', kind:'sync', key:true},
    {id:'m2', from:'api', to:'psp', label:'authorize', kind:'async'},
    {id:'m3', from:'psp', to:'api', label:'auth result', kind:'return'},
    {id:'m4', from:'api', to:'api', label:'persist attempt'},          // self-message: loopback arc
    {id:'m5', from:'api', to:'events', label:'payment.authorized', kind:'async',
     filter:'region = EU'},        // only valid when the TARGET actor is kind queue/topic
  ],
  ariaLabel: 'Checkout authorization sequence across web, api, psp, and an events topic',
  walkthrough: [                    // optional, ≤ 6 steps
    {title:'The ask', note:'The web app asks the API to start a payment.', fire:['m1']},
    {title:'Authorization', note:'The API asks the PSP to authorize, and gets a result back.', fire:['m2','m3']},
    {title:'Persist', note:'The API records the attempt locally.', fire:['m4']},
    {title:'Publish', note:'The authorized event reaches the topic.', fire:['m5']},
  ],
});
// Present slide: {pick:['#host'], layout:'wide', minScale:0.8,
//                 steps:{count:seq.count, go:seq.go}}
```

**Kind semantics mirror `architecture`'s edges exactly**, plus a distinct
arrowhead per kind so the three read apart on sight even in a static
screenshot: `sync` (default) draws a solid line with a filled triangle
arrowhead; `async` draws a dashed line with an open arrowhead and is the kind
that carries the ambient pulse; `return` draws a thin dashed muted line with
an open arrowhead. A self-message (`from === to`) draws a small loopback arc
out and back on the lifeline's right instead of a horizontal line.

**Activation.** The instant a message fires — from a walkthrough step's
`fire` or the ambient loop — the receiving actor's lifeline grows a slim
rounded activation bar at that row for the fire's duration. During an active
walkthrough step, every actor touched by a fired message highlights; the
rest dim (the same focus/dim opacity `architecture` uses for its nodes).
There is no separate `nodes`/`edges` step field to author — the touched
actors are computed from `fire` automatically.

**Filter.** `filter` (≤ 24 chars, a fragment like `'region = EU'`, not a
sentence) reuses `architecture`'s funnel glyph + mono microtype, and is only
legal when the *target* actor is `kind:'queue'` or `kind:'topic'` — the
component throws otherwise. In the ambient loop a filtered message skips 1-2
beats between fires (`architecture`'s producer/consumer filter cadence, in
miniature).

**Single surface first.** A sequence with 1–4 messages keeps the spacious
row rhythm. Five or six messages automatically use wider actor columns and
a tighter row rhythm so the full conversation remains on one stable set of
lifelines. In Present, the numbered legend and walkthrough dots/annotation
share one compact footer; component Next/Reset controls are hidden because
the deck arrows own navigation. Steps only change emphasis—actor positions,
message geometry, footer position, and scale stay fixed.

**Numbered legend.** Every message gets a numbered circle marker at its
arrow's start, **numbered 1..N in array order** — time order already *is*
reading order. Markers are never spatially re-sorted. Labels live in the `kdf-legend` key below the canvas; no
label text renders on the canvas itself.

**Large-sequence continuation.** Seven to ten messages may still need a
split after browser testing at the target Present viewport. Use parts of at
most four messages so every part keeps the same spacious geometry. Keep actor
order identical, pass `numberFrom` (positive integer, default 1) so markers
and legend do not restart, and set `continues:true` plus `inPlace:true` on the
later manifest entry. The continued part's lifelines arrive from the canvas top and
its actor headers use a recap tone. Present keeps one logical slide count,
suppresses part/transition chrome, and scale-locks the chain so shared
columns land on the same pixels.

Studio exposes **Composition: Whole exchange \| Guided scenes** and **Text size:
Normal \| Large**. Guided scenes use groups of at most three messages, keep
numbering continuous, and preserve the narrative step as the audience moves
between scenes.

**Ambient.** With no walkthrough step active, messages pulse one at a time in
array order, brief pause, repeat — a linear walk, not `architecture`'s
branching producer/consumer cascade (queue/topic fan-out doesn't apply to a
single ordered conversation). Reduced motion / `MOTION` unavailable: no
ambient loop runs at all — the diagram is fully static, arrows/markers/legend
still legible; an explicit walkthrough `fire` still gives a brief, static
acknowledgement.

Budgets and structural limits. String fields are assembly-owned by the shared
registry; counts and other structural Sequence errors still throw
`architecture sequence: …`:

| Field | Cap |
|---|---|
| `actors` | 2..6 |
| `messages` | 1..10 |
| actor `label` | ≤ 16 chars; no `·` lists |
| actor `sub` | ≤ 18 chars; no `·` lists |
| message `label` | ≤ 28 chars |
| `filter` | ≤ 24 chars |
| `walkthrough` | ≤ 6 steps |

Unknown `from`/`to` actor ids throw. `filter` on a message whose target
actor isn't `queue`/`topic` throws.

When a sequence has a walkthrough, every message must appear in at least one
step's `fire` list, including self-calls and return messages. A step may cover
several messages, and later steps may revisit them. Keep first appearances in
message order. A sequence without a walkthrough remains a valid overview.

Missing coverage or an unknown `fire` id throws before mounting or changing
layouts. The error names the missing or unknown message ids. This applies to
Whole exchange, Guided scenes, and Message briefing. Existing sources with
partial walkthroughs must add the omitted messages before rebuilding; do not
invent steps or silently append them at runtime.

## erd

The walkthrough description leads the audience view. Generated relation numbers
are omitted. **Relationship details** retains endpoint names, authored verbs,
and cardinalities, with hover and keyboard focus highlighting the corresponding
connector. It starts collapsed for guided diagrams and open when no walkthrough
is authored.

What the data is, and how it relates. Entity cards with a header band and
attribute rows, connected by crow's-foot relationships.

```js
var erd = renderErd('#host', {
  fields: 'all',                     // optional: all (default) | key
  layout: 'schema',                  // optional: schema (default) | relationships
  view: 'follow',                    // optional: follow (default) | full
  entities: [                       // 2..10
    {id:'customer', label:'Customer', tone:'accent',
     attrs: [                       // 0..5 per entity
       {name:'customer_id', key:'pk'},
       {name:'email'},
       {name:'region', type:'text'},   // type optional, muted, right-aligned, ≤ 10 chars
     ]},
    {id:'order', label:'Order', attrs:[{name:'order_id', key:'pk'}, {name:'customer_id', key:'fk'}]},
  ],
  relations: [                      // 1..10
    {id:'r1', from:'customer', to:'order', label:'places', card:'1:0..N'},
    // card sides ∈ {1, 0..1, N, 0..N} joined by ':' (M accepted as an alias
    // for N). Default '1:N'.
  ],
  ariaLabel: 'Entity relationship diagram of customer and order',
  walkthrough: [ {title:'Customer places orders', note:'One customer can place many orders.', fire:['r1']} ],
});
// Present slide: {pick:['#host'], layout:'wide', minScale:0.55,
//                 steps:{count:erd.count, go:erd.go}}
```

**Entity cards** reuse `architecture`'s card chrome (radius, border, shadow,
tone tint) so the family resemblance is unmistakable, with a header band
(label, tone-tinted) over attribute rows. `key:'pk'` draws a small key glyph,
`key:'fk'` a small link glyph; `type` renders muted and right-aligned.

Studio exposes **Fields: All fields \| Key fields**, **Composition:
Relationships \| Schema detail**, and **View** for auto-positioned entities.
Schema detail is the default. Relationships removes attribute inventory and places
up to four entities on a single readable relationship line. Schema detail uses
entity tables with fields and routed relations. Explicit coordinates remain
authoritative. Full keeps every entity and relation at equal emphasis while
walkthrough copy advances.

**Layout.** Entities auto-grid on a 1500-wide canvas. Models through six
entities use 2-3 columns. Models with 7-10 entities read left to right by
dependency: a table sits one column right of every table it references (the
"one" side of each relation is the parent), columns stack their tables and
centre on the tallest, and each table must mark 1-3 attributes with
`present:true` so Present shows the key rows only. Explicit `x`, `y`, `w`,
`h` (mirrors `architecture`'s node fields) wins for that entity; overlapping
or off-canvas coordinates throw.

**Relations** route as orthogonal connectors with rounded corners,
deliberately not `architecture`'s curved Bezier routing, so a data model
reads distinctly from a system map, and end in crow's-foot cardinality
glyphs: a bar means `1`, a circle + bar means `0..1`, a crow's-foot means `N`
(`M` is accepted as an alias), and a circle + crow's-foot means `0..N`.
`card` is parsed as `"<from-side>:<to-side>"`; anything outside the
documented tokens throws. On the dependency-ordered board a relation leaves
the parent's `pk` row and enters the child's `fk` row (the one named like the
parent's key, else the first named after the parent), travelling the column
gutters and a free corridor between cards when it crosses a column. Hovering
a relation or lighting it in a walkthrough shows its `label` on the line and
tints the two key rows it joins.

**Relationship reference.** Each entry names both endpoint entities, the authored
`label` (a verb, ≤ 20 chars), and cardinality. Entries retain relation array order
and highlight their connector on hover or keyboard focus. Generated numbered
markers are omitted; the reference is available in **Relationship details** below
the walkthrough.

**Animation.** The pulse travels from the `1` (or `0..1`) side toward the
many side; for an `N:M` relation (both sides many) it defaults `from`→`to`,
same direction as an ordinary edge. Ambient: relations take turns pulsing in
array order, pause, repeat. A walkthrough step's `fire` pulses those
relations and spotlights their connected entities (computed from `fire`,
same as `sequence` — no separate `nodes`/`edges` step field), dimming the
rest. Reduced motion: static, same rule as `sequence`.

Budgets and structural limits. String fields use the shared registry; counts,
cardinality, references, and geometry still throw `architecture erd: …`:

| Field | Cap |
|---|---|
| `entities` | 2..10 |
| attrs per entity | ≤ 5 |
| `relations` | 1..10 |
| entity `label` | ≤ 22 chars |
| attr `name` | ≤ 18 chars |
| attr `type` | ≤ 10 chars |
| relation `label` | ≤ 20 chars |
| `walkthrough` | ≤ 6 steps |

Unknown entity ids in a relation throw. An invalid `card` token throws. A
walkthrough `fire` id that doesn't match any relation id is a
`console.warn`, not a throw.

## stack

One request descending through layers — MRs, code paths, request
lifecycles. Two or more lanes (e.g. edge/api/service/store) form a fixed
wide map and fall back to vertical flow on mobile; frames inside each lane
nest by `depth` into a compact rail. Guards mark early exits, side effects
land as chips, and an optional code context card shows the file behind a
frame.

```js
var stack = renderStack('#host', {
  detail: 'code',                             // optional: code (default) | names
  path: 'all',                                // optional: all (default) | main
  view: 'follow',                             // optional: follow (default) | full
  ariaLabel: 'A request descends from edge through two guards to service and store',
  lanes: [                                    // 1..4, map order
    {id:'edge', label:'EDGE', sub:'terminates the request', weight:.8,
     frames: [                                // 1..8 per lane, ≤18 total
       {id:'e1', depth:0, fn:'handleRequest()', note:'TLS terminated here'},
       {id:'e2', depth:1, fn:'routeToApi()', kind:'async',
        chips:[{label:'trace.start', kind:'plain'}]},
     ]},
    {id:'api', label:'API', sub:'validates, dispatches', weight:1.4, handoff:{label:'HTTP crosses the wire'},
     frames: [
       {id:'a1', depth:0, caller:'e2', fn:'do_POST()', file:'api/handlers.py',
        code:['def do_POST(req):', '    if not req.authed:', '        return 401', '    ...'], hot:1},
       {id:'a2', depth:1, fn:'authGuard()', guard:'401 unauthenticated'},
       {id:'a3', depth:1, fn:'rateLimitGuard()', guard:'429 over budget'},
       {id:'a4', depth:1, fn:'dispatch()'},
     ]},
    {id:'svc', label:'SERVICE', sub:'business logic', weight:1.3, handoff:{label:'validated request'},
     frames: [
       {id:'s1', depth:0, fn:'processOrder()', chips:[{label:'orders.write', kind:'write'}]},
       {id:'s2', depth:1, fn:'notify()', kind:'async'},
       {id:'s3', depth:1, fn:'reserveStock()', kind:'async'},
     ]},
    {id:'store', label:'STORE', sub:'persistence', weight:1, gutter:40, handoff:{label:'commit'},
     frames: [ {id:'d1', depth:0, fn:'commit()', chips:[{label:'staging.tmp', kind:'kill'}]} ]},
  ],
  walkthrough: [                              // ≤6 steps; show defaults to
                                               // the last fired frame with code
    {title:'1 · Two guards', note:'Auth and rate-limit can both bounce the request before it dispatches.', fire:['a1','a2','a3'], routeTo:['a2','a3'], show:'a1'},
    {title:'2 · Fan-out', note:'processOrder notifies and reserves stock concurrently — both fire together.', fire:['s1','s2','s3'], routes:[{from:'s1',to:'s2'},{from:'s1',to:'s3'}]},
  ],
});
// Present slide: {pick:['#host'], layout:'wide', minScale:0.9,
//                 steps:{count:stack.count, go:stack.go}}
```

**Fixed map.** A flow stack with two or more lanes stamps `kstk-map`. At
wide widths it uses one grid in scroll and Present mode: 24px base gaps,
the authored lane order, and inline columns derived from `lane.weight`
(numeric 0.5..3, default 1). `lane.gutter` (numeric 24..64) reserves that
many additional pixels before its lane beyond the base gap; use it for a
busy reverse-call track. Map lanes are unboxed vertical regions separated
by one quiet solid rule. Handoff banners, lane collapsing, the unwind rail,
and async ambient frame glow are absent; all frames remain visible in the
overview and every step. Below the wide breakpoint the lanes return to
vertical flow.

Studio exposes **Calls: Main calls | All calls** and **View**. Main calls
retains the primary lane entry, guard exits, explicit handoff sources, and every
walkthrough-referenced frame while removing code and secondary decoration. All
calls restores the complete frame map. Full prevents walkthrough lane collapse
and dimming while the guide copy continues. Diff mode exposes Detail and View;
journey mode exposes Progression and View.

**Frame `kind`.** Every frame is `sync` (default) — a solid connector from
its caller and a solid frame border. `kind:'async'` draws a dashed
connector, a dashed frame border, and an auto `async` tag (derived, never
authored). Solid = blocks, dashed = fires-and-continues: the family's
shared grammar, here carried by the line itself rather than by timing.

**Structure is painted once; only emphasis moves.** Every connector — one
per frame that has a caller — is drawn as soon as its geometry is known and
stays at a resting tone. The default caller is the nearest preceding frame
at a smaller depth; a lane's first frame falls back to `handoff.from`, then
the previous lane's last frame. Set `frame.caller:'frameId'` explicitly for
reverse calls, fan-out, or any call that differs from that inferred tree.
No route appears, disappears, or redraws because of a step.

At wide map widths, forward cross-lane calls leave the caller's right edge
and enter the callee's left edge on straight or orthogonal routes. Reverse
calls leave the caller's left edge, take a dedicated vertical return track
in its gutter, and enter the callee's right edge with a final left-pointing
segment. Outgoing cross-lane siblings get distinct source ports and tracks
at least 12 local units apart. Same-lane calls keep a compact orthogonal
depth rail. Routes do not cross non-endpoint frames or guards. Marker heads
are small open chevrons: accent/solid for sync, violet/dashed for async.

`fire` controls frame focus. Route focus can be authored independently with
`routes:[{from:'a',to:'b'}]` or the shorthand `routeTo:['b']`; when neither
field is present, routes arriving at fired frames retain the compatibility
behavior. Authored routes must match the target frame's caller. Ambient (no
active step) passes attention over the same fixed picture. Reduced motion /
`MOTION` unavailable / motion `off` leaves the complete structure static
and legible.

**Continuation (`numberFrom`).** A descent split across slides passes
`numberFrom` (positive integer, default 1) so the handoff legend continues
the earlier part's numbering instead of restarting — pair it with the
manifest's `continues: true` tag. `numberFrom > 1` also turns on the
carry-over device: the first frame's route comes down from the **canvas top
edge**, fading in there, a quiet `↑ continued · 1` marker names the range
already covered, and the lane heads render in a recap tone.

**Code context card.** `file` (≤ 40 chars) + `code` (≤ 4 lines, each ≤ 64
chars) render a calldiff-style card: a path bar — directories dimmed, the
filename bright, an extension dot colored by a fixed `py`/`js`/`css`/
`html`/`md`/other tone map — above the code lines, with `hot` (a `code`
index) marking one accent-ruled, tinted line. `code` requires `file`; the
component throws otherwise. In a walkthrough, the active step's `show`
frame (default: the last id in that step's `fire` that carries code) opens
its card and every other card closes — sliding in scroll mode, instant in
Present (where a closed card is absent, not a clipped empty box); in scroll
mode, clicking any frame with code toggles its own card. Reduced motion
turns the slide into an instant toggle — nothing else changes.

**Guards.** `guard` (≤ 32 chars) renders an early-exit stub immediately
after its frame, in warning tone with a ⤴ glyph — deliberately loud,
never demoted alongside chips (see below).

**Chips.** `chips` (≤ 3 per frame) render as small pills after the `fn`
line: `write` (success tone), `kill` (error tone, struck through), `plain`
(neutral, the default when `kind` is omitted). Below ~500px of the frame's
own container width (a CSS container query, not a viewport breakpoint)
chips wrap onto their own line under `fn` instead of clipping.

**Handoffs and the numbered legend.** `lane.handoff` (conventionally never
the first lane, since nothing hands off *into* it) is auto-numbered 1..N in
lane order. Each compact number sits directly on the corresponding incoming
cross-lane route, normally the route to that lane's first frame, and moves
with it on every relayout. The old full-width banner is hidden; the same
numbers remain in the `kdf-legend` key below the canvas, with the shared
`sequence`/`erd` markup and hover behavior. When the stack mixes sync and
async frames, one unnumbered legend entry auto-appends to decode the
solid/dashed convention. During a step, the legend and in-canvas markers
light the handoffs for touched lanes and dim the rest.

**Present composition.** A map keeps the same lane grid, spacing, frames,
and route geometry as its wide scroll view; it never collapses lanes or
uses `kstk-tight`. The host puts the full-width canvas first, followed by
one compact footer row: numbered legend on the left, walkthrough dots and
annotation on the right. Component Next/Reset controls are hidden because
the deck arrows own navigation. Compose the slide by picking only the host
and synthesizing its kicker/title in the manifest; use a floor near
`minScale:0.9`. Present measures the worst walkthrough step once, so scale
and geometry stay fixed from overview through every step.

**Depth rail.** Frames nest by `depth` (0..3) into a flame-graph-style
tree — each lane reconstructs the tree from its flat, depth-tagged frame
array (a run of same-depth frames become siblings, the parent of each is
the nearest preceding frame with a strictly smaller depth), so depth need
not be contiguous or start at 0. A vertical rail runs the height of each
nested group; a short elbow connects each child to it, dashed for an async
child. Non-map flow retains the dashed unwind rail and ambient return pass;
the fixed multi-lane map hides both the rail and async ambient glow.

Budgets and structural limits. String fields use the shared registry; counts,
references, code-line counts, and geometry still throw `architecture stack: …`:

| Field | Cap |
|---|---|
| `lanes` | 1..4 |
| frames per lane | 1..8 |
| frames total | ≤ 18 |
| lane `label` | ≤ 22 chars |
| lane `sub` | ≤ 28 chars |
| lane `weight` | numeric 0.5..3; default 1 |
| lane `gutter` | numeric 24..64 when set |
| frame `fn` | ≤ 36 chars |
| frame `note` | ≤ 40 chars |
| frame `file` | ≤ 40 chars |
| `code` | ≤ 4 lines × ≤ 64 chars, requires `file` |
| `chips` per frame | ≤ 3 |
| chip `label` | ≤ 22 chars |
| `guard` | ≤ 32 chars |
| `walkthrough` | ≤ 6 steps |

`depth` outside 0..3, lane weight/gutter outside their numeric ranges, a
chip `kind` outside `write`/`kill`/`plain`, a frame `kind` outside
`sync`/`async`, `code` without `file`, an unknown explicit `caller`, and a
walkthrough `show`, `routes`, or `routeTo` reference that is unknown or does
not identify a real caller→callee route all throw. An orphan `fire` id
(matches no frame) remains a `console.warn` for compatibility.

### stack — mode:'journey'

Use journey mode when the audience needs the request lifecycle rather than the
complete call tree. It places 2-7 ordered outcomes on one horizontal spine,
keeps their lane boundaries visible, and closes the lifecycle with an explicit
return path.

```js
var journey = renderStack('#host', {
  mode: 'journey',
  progression: 'overview', // optional: overview (default) | build
  lanes: stackLanes,
  journey: [
    {id:'receive', frame:'e1', label:'Request received'},
    {id:'guards', frames:['a2', 'a3'], label:'Guards cleared'},
    {id:'commit', frame:'d1', label:'Order committed'},
  ],
  returnPath: {from:'d1', to:'e1', label:'201 response'},
  walkthrough: [
    {title:'1 · Request reaches the edge', note:'The edge starts its trace.', fire:['e1']},
  ],
});
```

Each stop needs a unique id, a label of at most 28 characters, and either one
`frame` or 1-4 `frames` from one lane. Derived guards and effects stay attached
to that outcome. The required `returnPath` names known frames and a label of at
most 32 characters. `overview` keeps all outcomes visible; `build` reveals
them in order. Studio exposes this as **Progression: Overview | Build path**.

### stack — mode:'diff'

The refactor story: "this call moved from `review.py` into `assemble.py`,
these two were extracted, that one died." Two panes, `before` → `after`,
built on the same `kstkBuildFrame` seam the base mode uses — panes reuse
`kstk-lane`/`kstk-frame`/`kstk-chip`/`kstk-guard`/`kstk-code-card` chrome
exactly; only the diff decoration (badges, move ribbons, a path-bar diff, a
rename pill) is new.

```js
var diff = renderStack('#host', {
  mode: 'diff',                                // absent/'flow' = the base
                                                 // contract above, untouched
  ariaLabel: 'A fat order handler split into validate, payments, and audit service modules',
  before: {                                     // lanes: exactly the base
    label: 'v1',                                // contract shape, same caps
    lanes: [ /* ... */ ],                       // per side; label ≤ 14 chars
  },
  after: {
    label: 'v2',
    lanes: [ /* ... */ ],                       // an after frame may add `was`
  },
  walkthrough: [                                // ≤ 6 steps; fire references
    {title:'1 · Split begins', note:'…', fire:['h2','h3']},  // change ids
  ],                                             // (the SAME frame id used on
});                                              // whichever side(s) it exists)
// Present slide: {pick:['#host'], layout:'wide', minScale:0.5,
//                 steps:{count:diff.count, go:diff.go}}
```

**The change model** is derived by matching a frame `id` across `before`
and `after` — never a hand-authored flag, with one documented exception
(`was`, below):

| Present in | Condition | State | Visual |
|---|---|---|---|
| both sides | same `file`, same lane id, same `depth` | **unchanged** | muted (permanently, not just off-step), no badge |
| both sides | different `file`, lane, or `depth` | **moved** | numbered badge (accent), a move ribbon |
| `after` only | — | **added** | numbered badge (success), success left-rule |
| `before` only | — | **removed** | numbered badge (error), error left-rule, struck `fn`, stays visible in the before pane |
| `after` frame carries `was:'oldFn'` | any of the above | **+renamed** | violet badge, `oldFn → fn` pill — composable with any other state |

Every non-unchanged frame becomes a numbered **change**, 1..N: after-pane
frames (added + moved/renamed) number first, in after-pane reading order;
removed-only frames number last, in before-pane reading order. A `moved`
and/or `renamed` id (present on both sides) shares its number across both
panes — the same badge appears twice, once per pane. Changes are what
walkthrough `fire` references (frame ids, exactly like the base contract)
and what the `kdf-legend` key below the panes lists: number + a short label
(`'moved · fn'`, `'added · fn'`, `'renamed · fn'`, `'moved+renamed · fn'`,
`'removed · fn'`).

**Move ribbons.** An SVG overlay spanning the pane gutter draws a gentle
cubic curve from a `moved`/`renamed` frame's before-pane position to its
after-pane position — accent tone, violet when renamed. A fired change
sends the shared pulse head along its ribbon before→after and lights the
destination frame (`kdfMakePulse`/`kdfPulseFire`, the same pulse engine
`sequence`/`erd` use, reused as-is). Ambient (no active step): ribbons take
turns, one at a time, same `kdfAmbientCycle` walk as the rest of the family.
Reduced motion / motion preset `'off'`: the pulse engine's own static
fallback applies — no travel, same family precedent. Ribbons only exist for
`moved`/`renamed` frames (present on both sides); `added`/`removed` frames
have one position and route no ribbon — firing one just lights it directly.

**Path-bar diff.** When a `moved` frame's `file` differs between sides,
BOTH panes show a standalone path bar for it (independent of any code
card — a moved frame need not carry `code`): the segment that actually
differs (directory, filename, or both) renders error-tinted on the before
side and success-tinted on the after side; a segment that matches stays
dimmed. A frame that changed lane/depth but kept the same `file` shows no
path highlight — the ribbon alone carries that story.

**Layout.** Panes sit side by side (before left) above ~900px of the
canvas's own container width; below it they stack vertically (before on
top) and the ribbon layer hides — the numbered badges, shared across both
panes, carry the before↔after correspondence instead. `chips` wrap under
the `fn` line below ~500px of a frame's own container width, same rule as
the base contract. Present mode applies the base contract's reduction
ladder per pane (a moved frame can sit in a different lane on each side, so
"touched" is computed for each), and the changes legend tracks the step the
same way — the numbers it fires light in their own change tone, the rest
dim.

Budgets and structural limits. String fields use the shared registry; diff
shape, counts, and semantics still throw `architecture stack: …`:

| Field | Cap |
|---|---|
| `before.lanes` / `after.lanes` | same as the base contract's `lanes`, applied independently per side (1..4 lanes, 1..8 frames per lane, ≤ 18 frames total, every per-frame cap) |
| `before.label` / `after.label` | ≤ 14 chars |
| after frame `was` | ≤ 36 chars |
| changes (non-unchanged frames) | 1..10 |
| `walkthrough` | ≤ 6 steps |

A `mode` value other than `'diff'`/`'flow'`/absent throws. `was` on a
`before` frame throws (it is an after-only field). An orphan walkthrough
`fire` id — unknown, or a valid id whose state is `unchanged` — is a
`console.warn`, same family convention as an orphan `fire` id elsewhere.

## loop

A closed process circuit — the showpiece for a workflow that feeds back into
itself (a dev loop, a review cycle). Numbered nodes ride a spine, `kind` tints
the ring, hovering or clicking a node reveals a detail panel below, and an
optional return arc makes the loop literally close. Use this over `stepper`
when the stages form a *journey that loops*, not a linear list; use `stepper`
when each step is a standalone concept with optional code. Requires 1–6 stages.
All loop fields are plain text. Caps: `num` ≤4 chars, `label`/`tag` ≤24,
`eyebrow` ≤32, `title` ≤40, `body` ≤180, legend labels ≤24, and return label
≤48. Returns
`{count, go(i), current}` so a Present slide walks it stage by stage.

```js
var loop = renderLoop('#host', {
  legend: [{kind:'human', label:'human'},
           {kind:'agent', label:'agent'},
           {kind:'both',  label:'human + agent'}],   // optional
  return: {label:'/retro continuously improves our workflow'}, // optional closing arc
  stages: [{
    num: '01',                          // optional (defaults to index+1, zero-padded)
    kind: 'human',                      // human | agent | both | gate | future — tints the ring
    label: '/opsx:explore',             // node caption (accepts inline HTML)
    tag: 'human · SOTA',                // optional mono sub-caption under the node
    eyebrow: 'Stage 01 · human',        // optional detail-panel eyebrow (defaults to "Stage <num>")
    title: '/opsx:explore',             // detail-panel heading
    body: 'A thinking stance…',         // detail-panel prose (accepts inline HTML)
  }],
});
// Present slide: { pick:['#host'], minScale:0.85, steps:{count:loop.count, go:loop.go} }
```

## pyramid

A layered test/maturity pyramid: 1–6 stacked trapezoids with leader-lined
labels and per-layer flag dots. Layers are apex-first; the base carries the
accent. Caps: name ≤20 chars, count ≤18, flag label ≤18. Zoomable. Reveals
base → apex. Use where the *shape* is the point; prefer `table` mode `rows` for
a plain list of tiers. Returns `{count, go(i)}` for Present.

```js
var pyr = renderPyramid('#host', {
  ariaLabel: 'Test pyramid: broad unit base narrowing to fuzz at the apex',
  layers: [                              // apex-first; last entry is the accented base
    {name:'Fuzz · Property', count:'2 Go files',  flag:{tone:'warning', label:'LOCAL'}},
    {name:'E2E + A11y',      count:'26 specs',     flag:{tone:'accent',  label:'CI NEXT'}},
    {name:'Integration',     count:'11 files',     flag:{tone:'success', label:'IN CI'}},
    {name:'Unit tests',      count:'117 files',    flag:{tone:'success', label:'IN CI'}},
  ],
});
// Present slide: { pick:['#host'], steps:{count:pyr.count, go:pyr.go} }
```

Flag tones: `success | accent | warning | error | violet`.

## iceberg

The WOW device for a topic whose visible tip is tiny next to the mass below the
waterline — risks or complexity that are perceived only at the surface and
routinely underestimated. A faceted crystal sits above a shimmering line,
scaled up so it is unmistakably the star of the diagram; up to two flanking
callouts frame the exposed tip with a leader line each; rows of concerns sink
into graduated darkness on a glass panel below, ending in an italic "unknown
unknowns" line. The crystal chrome is fixed (a self-contained illustrative
ocean palette, identical in either theme); every text field is data-driven and
zoomable. One per page — it is a punch, not a workhorse.

```js
renderIceberg('#host', {
  ariaLabel: 'A fictional museum exhibition: the visitor experience above, preparation below',
  stamp: 'WHAT VISITORS SEE',
  above: [
    {side: 'left', title: 'Opening day', lines: ['doors open', 'visitors arrive']},
    {side: 'right', title: 'The exhibition', lines: ['objects on display', 'stories to explore']},
  ],
  below: [
    ['Research and selection', 'Loans and insurance'],
    ['Conservation checks', 'Transport and handling'],
    ['Lighting and labels', 'Access and staff training'],
  ],
  punch: 'a day out rests on months of preparation',
  bottom: 'Fictional museum example',
});
```

**Budgets and structural limits.** String fields use the shared registry and
never abort rendering; callout/line/row/cell counts remain fatal because the SVG
has fixed anchors:

| Field | Cap |
|---|---|
| `above` | at most 2 callouts |
| `above[].title` | ≤ 22 chars |
| `above[].lines` | at most 2 lines, each ≤ 26 chars |
| `below` | at most 4 rows |
| each `below` row | at most 2 cells, each ≤ 34 chars (three-column rows are gone) |
| `punch` | ≤ 44 chars |
| `bottom` | ≤ 60 chars |
| `stamp` | ≤ 48 chars |

A caption or row that only fits after trimming to these caps is doing its job:
this device carries a fragment, never a paragraph. Reach for `table` mode
`rows` instead when the content needs full sentences.
