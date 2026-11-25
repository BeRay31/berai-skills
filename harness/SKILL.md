---
name: explainer
description: Shape a story, create a standalone interactive HTML explainer, or open Studio to browse and edit existing explainers. Use for shareable narratives, technical changes, architecture decisions, incidents, data flows, and product behavior; route interactive product sketches to /sketch.
argument-hint: '[topic, source, explainer path, "shape story", or "open studio"]'
---

# `/explainer`

Route `$ARGUMENTS` to Studio, the ASCII storytelling designer, `/sketch`, or creation of a standalone interactive HTML explainer.

## Entry gate

When `/explainer` has **no stated task and no supplied content**, do exactly
these first:

1. Read `VERSION` next to this file. This is the only repository read allowed
   before intent selection.
2. Print **Explainer** · v<the exact VERSION value> as the first visible line.
3. Immediately invoke the `AskUser` tool below.

Do not inspect nearby files, search the repository, or assume the user wants a
new explainer before the user selects an intent.

**→ Invoke `AskUser` with:**

1. [question] What would you like to do?
[topic] Explainer intent
[option] Open Studio for existing explainers
[option] Shape the story in ASCII first
[option] Create an explainer from an idea
[option] Build from material I’ll provide

Do not print this as a text menu. After the user chooses:

- **Open Studio for existing explainers** — discover only the explainer HTML
  or source location needed to launch Studio. If an `explainers/` folder exists,
  run Studio against that folder so the Gallery is the first useful surface;
  do not start a new build. If the location is ambiguous, ask for it instead of
  scanning broadly. If `explainers/` does not exist, ask for the location.
  Never inspect or fall back to `sketches/`, the current directory, or any
  other folder.
- **Shape the story in ASCII first** — enter the Storytelling designer below.
  Do not inspect the repository, author a source, or assemble HTML yet. Iterate
  cheaply in the terminal until the user explicitly chooses **Build in Studio**.
- **Create an explainer from an idea** — infer what the request already answers,
  ask once for any missing audience/outcome and minimum supporting material,
  then build the first share. Do not force the ASCII designer after the user
  deliberately chose to create now.
- **Build from material I’ll provide** — ask the user to attach, paste, or name
  the material. Do not mine unrelated repository files for substitute content.
  If it has no conclusion or evidence-carrying arc, offer **Shape in ASCII** or
  **Build a first draft now**; the user owns that choice.

When the invocation already contains an explicit request or supplied material,
follow that stated intent directly. Do not force this bare-entry questionnaire.

### Arguments-first routing

Route explicit arguments before asking anything:

```text
existing page · browse · edit · review · present · upgrade · open Studio
  └─ Studio now; no new-page questions

shape story · storyboard · find the conclusion · organize these notes
  └─ Storytelling designer; no HTML until Build in Studio

create/build/draft now + a clear audience, conclusion, and evidence-bearing arc
  └─ new-page workflow, then Studio

create/build + only a topic or undirected dump
  └─ one AskUser choice: Shape in ASCII (recommended) | Build a first draft now
```

A story is ready enough when the request answers **who must understand it**,
**what they should conclude or decide**, and **which 3–7 evidence-bearing beats
get them there**. Do not demand polish. If those are missing, explain the risk in
one sentence and offer the choice above; never silently turn an expensive HTML
build into story discovery, and never block a user who chooses the first draft.

**Portable by design.** Everything this skill needs lives in
`.factory/skills/explainer/` — copy that one directory into another repo and
it works there too. It writes nothing outside `explainers/` in the host repo
(the assembled output, plus the `explainers/_sources/` content sources you author),
and holds no project-specific content itself.

## How this works: assemble, don't regenerate

You author one small **content source**; a python3 script splices it together
with this skill into a **single self-contained `.html`**.

Read these before writing anything — they are the manual:

- `README.md` (next to this file) — layout, the four content slots, quick reference.
- `references/CONTRACTS.md` — the data contract for every component.
- `references/DESIGN.md` — the design guide: what makes pages look right.
  Read it before building custom devices, forking a style, or contributing.

**Never re-generate what the skill already ships**: design tokens, Present-mode
CSS/JS, zoom overlay, reveal/glossary machinery, component markup, the Motion
library. That boilerplate is assembled by file operations, byte-identical
every time. You write only: topic content (`content` slot), topic devices
(`page-css`), and topic data + the slide manifest (`page-js`).

The output must stay **one self-contained HTML file with zero external runtime
dependencies** — works offline, no CDN, screenshots embedded as base64 data URIs.
The assembler guarantees this as long as you never add `<link>`/`<script src>` tags.

## Version authority

`VERSION` next to this file is the only authoritative skill version. Read it
immediately before making any version claim; never hardcode or infer a version
from prose, filenames, page generations, or prior turns. A bare invocation must
show **Explainer** · v<version> before its intent question as specified by the
entry gate. For explicit requests, do not announce a version unless it is
relevant. The assembler owns version stamps in generated HTML.

## Studio launch invariant

Resolve `<adapter>` before **every** Studio launch: use `droid` in Factory
Droid, use `devin` in Devin, and omit `--agent <adapter>` only in harnesses
without a dedicated adapter. Replace `<adapter>` with the resolved value; never
pass the placeholder literally. This applies to existing pages, Gallery, and
the first share. Never launch Studio without the adapter in Factory Droid or
Devin, and never infer the harness from whichever binaries happen to be
installed. The default `--agent auto` resolves the launching harness from the
process ancestry, so in Devin and Droid the flag only overrides detection.

## Editing an existing page? Studio first, zero questions

When the request points at an **existing explainer** — an assembled `.html`
carrying the `assembled by .factory/skills/explainer` stamp, its content source
under `explainers/_sources/`, or any ask in the family of "browse / edit / tweak /
review / present / upgrade this explainer" — do **not** run the new-page
questionnaire below. Topic, style, and source are already known. If only the
source is named, use its declared `meta.output` (assemble it first only when the
page is missing or stale). Then immediately:

1. Read the page's stamp line (version · style · source path).
2. Launch the studio on it with the required adapter and hand over the URL:
   `python3 .factory/skills/explainer/studio.py <page>.html --agent <adapter>`.
3. Say what the panel offers (direct text edits, appearance, component tweaks and editing,
   top-level visual arrangement, basic shapes, location-aware Notes, and
   one-click upgrade when the page is older than the kit). **Save edits** handles
   supported deterministic changes locally; **Finish** delegates Notes, custom
   visuals, and unsupported work to the agent.

When the ask is **"open / browse Studio"** with no page named, check only the
conventional `explainers/` location. If that folder exists, launch it directly:
`python3 .factory/skills/explainer/studio.py explainers/ --agent <adapter>` —
Gallery opens first with previews, status, Open/Upgrade actions, and the
component-showcase link. If it does not exist or more than one supplied location
could apply, use `AskUser` to request the location instead of searching the
repository broadly.
Do not inspect `sketches/`, fall back to the current directory, or treat
arbitrary HTML as an explainer.

This works on any copy of the page, anywhere: style flips and upgrades use
the stamped source when it's on disk, and otherwise the **source embedded in
every v3 page** — a downloaded or mailed explainer is still fully editable.
For direct content edits ("change this number", "add a beat"), edit the
source the same way: recover it from the page if the original file is gone
(`_reviews/<name>/recovered-source-*.html` after any studio run), then
re-assemble. The interview below is for **new** pages only.

## First steps

For a bare invocation, complete the entry gate above before this workflow. For
an explicit request or supplied material, begin here without the bare-entry
questionnaire.

`/explainer` has one recipe: `meta.recipe = "explainer"`. Do not ask a recipe
question or infer another recipe.

If the request says "sketch", "prototype", "simulate", "demo the experience",
or supplies discovery notes whose selected action is **Experience to sketch**,
stop this workflow and route the user to [`/sketch`](../sketch/SKILL.md). Do not
translate a sketch into slides, load sketch files, or emulate the sketch skill
inside `/explainer`. An explicit discovery action named **Build a quick
presentation with `/explainer`** remains an explainer even when the same notes
also describe an experience.

### Story-readiness gate — before style

For every new explainer, resolve these in order:

```text
1. TOPIC       what this is about / approved material
2. AUDIENCE    who must understand or decide
3. OUTCOME     what they should conclude, decide, or do
4. SOURCES     evidence that can carry the beats
5. STYLE       only after 1–4 are ready enough
```

A topic, question, or event is **not** an outcome. “Explain what happened during
the flash sale” names the subject; “the shorter callback timeout created retry
lock contention, so adding workers will not fix it” is a conclusion. The outcome
must state a changed belief, named decision, or concrete action that the supplied
evidence can support. Do not say “clear story,” set `meta.thesis`, ask look &
feel/screenshots, choose components, or begin authoring until an actual outcome
is recorded.

If topic/material is known but audience or outcome is missing, use a dedicated
`AskUser` call **before** the new-page questions below. Infer 2–3 concise outcome
candidates from the supplied material; never use generic labels or invent a
claim. Then invoke:

1. [question] Who is the primary audience?
[topic] Audience
[option] Leadership or decision-makers
[option] Engineers or operators
[option] Mixed audience
[option] Other — specify the audience

2. [question] After this explainer, what should that audience conclude, decide, or do?
[topic] Story outcome
[option] <specific candidate grounded in the supplied evidence>
[option] <specific alternative grounded in the supplied evidence>
[option] <third candidate, only when evidence supports it>
[option] Help me shape the outcome in ASCII first

Candidate text is the proposed outcome—not “I know it” or an outcome category.
If the user's answer does not contain or select an actual conclusion, decision,
or action, the field is still missing: ask only that question again or enter the
Storytelling designer. Do not proceed on an option label that merely promises a
future answer. If the user explicitly chooses **Build a first draft now**, record
the strongest evidence-supported candidate as a provisional outcome, say so,
and continue; user control still wins.

After intent and the story-readiness gate are settled, use the **AskUser tool**
for remaining new-page questions in one call. Source comes before style:

1. **Source material** — when `/discovery` hands off saved product briefing notes
   and a linked Tech Design Document, treat those explicitly supplied files as the
   complete approved source set. Use the briefing notes as primary product truth
   and the design document only as applicable technical context; do not scan
   `openspec/`, `site/docs/`, or other repository sources unless the user separately
   approves them. Do not ask where the idea is documented again. Ask only whether
   screenshots or UI recordings should be included.

   For every other entry, do not scan repository documentation preemptively.
   Ask exactly two source questions unless the chosen entry path answered one:
   - "What source should I use? Attach or name it, or describe the idea directly."
   - "Do you have any screenshots or UI recordings to include? (Attach them, or say no.)"

2. **Look & feel** — most users don't know what's possible, so show the menu:
   - **Keynote** (default) — big type, one idea per slide, spare text; built to project in a room.
   - **Playful / vivid** — saturated accents, rounded geometry; same honesty rules.
   - **None of these** — ask them to describe what they want, then disambiguate
     (palette? density? formal or lively?) before proceeding.
     Implement a custom look as a new `styles/<name>.css` following the token
     contract at the top of any existing style file.

   Every style ships both themes: dark/light is the reader's runtime choice
   (the page's own ◐ toggle) with `meta.theme` only setting the authored
   default — a style never owns the theme.

   If the user picked nothing and the topic clearly implies a room presentation,
   default to Keynote and say so. If they hesitate between looks, do not make them
   describe design in prose: assemble both variants with `--variants` and let them
   pick in the browser (see "Design variants and the review loop" below).

Keep ordinary entries to those two source questions and discovery handoffs to
the one screenshot question above. A story accepted through the **Storytelling
designer** already answers audience, outcome, and arc; do not ask those again.
For **Create an explainer from an idea**, ask once only for readiness fields the
request did not answer. For explicit requests, infer audience and outline when
they are clear, and ask only for missing information. Read approved or explicitly named
source files before writing, but do not broaden the source set without user
approval. If the user did not provide an output path, use
`explainers/<topic>-explainer.html`.

## Tone and voice — all styles, no exceptions

Explainers are educational documents, not marketing pages. Write in plain, direct
English that a new team member or an external reviewer can follow without context.

- **Banned vocabulary** (check these after the initial share or when the user
  asks for verification; any hit is a defect):
  "revolutionary", "seamless", "effortless", "powerful", "unlock", "leverage",
  "transform", "unprecedented", "cutting-edge", "next-generation", "game-changing",
  "supercharge", "blazing", "magic", "magical", "delightful", "robust". If a sentence
  could appear on a landing page, rewrite it.
- **No theatrical narration.** No rhetorical questions as section openers, no "Imagine a
  world where…", no fake urgency. Start with the fact.
- **Banned rhetoric** — the AI-writerly register. Readers see it everywhere
  now and it turns them off a page immediately; any hit is a defect:
  - dramatic fragment pairs and one-word punch sentences ("Not a projection.
    Verified.", "The result? Speed.");
  - headlines that sell instead of state — a title carries the fact:
    "History restart: 13.4 s day-0 clone" beats "Not a projection. Verified.";
  - borrowed metaphors: "seam", "load-bearing", "north star", "the bones",
    "connective tissue", "villain", "superpower", "secret sauce", "unsung
    hero". A metaphor is allowed only when the visual literally draws it
    (a `table` dot-spectrum drawing a literal spectrum) or the domain already
    owns the word (a "floor" for a measured lower bound).
- **Write for any reader.** Prefer the word a non-native speaker learns first
  ("use", not "leverage"; "start", not "kick off"). If a sentence sounds like
  copywriting, replace it with the number it was dressing up. An explainer
  sells nothing to no one.
- **Concrete before abstract.** What the system does, then why it matters. Prefer
  function names and file paths over invented proper nouns. Numbers beat adjectives:
  "re-runs only the 2 reviewers whose files changed" beats "fast".
- **The register adapts to the style — accuracy never does:**
  - *Keynote*: punchy but truthful. Short declaratives. The headline carries the
    argument; the sub adds one qualifier. If a punchy line overstates, soften the line,
    not the truth.
  - *Playful*: vivid palette, plain words. Playful is a look, not a license to hype.
- When unsure of tone for a sensitive topic (incident, outage, security), ask.

## Storytelling designer — ASCII before HTML

Use this mode when the user selects **Shape the story in ASCII first**, asks for
a storyboard/conclusion, or chooses it at the readiness gate. Also offer it for
raw dumps (logs, scattered notes, half-argued threads): the assembler makes pages
cheap, but a polished page cannot rescue a story with no conclusion or evidence.

**Hard boundary:** do not inspect unapproved files, author a content source,
choose components, or assemble HTML while shaping. ASCII is the cheap thinking
surface; the user decides when it has earned an explainer.

1. Gather only what is missing in one focused `AskUser` call: audience; desired
   conclusion/decision; must-keep evidence or beats. Infer fields already present.
2. Return a compact ASCII story map, not prose analysis:

```text
AUDIENCE  engineers reviewing the change
CONCLUDE  the repo's shape — not a defect — sets the clone floor

START     clone time is 200.9 s
  │       evidence: fetch p90 123 s
  ▼
SUSPECT   1.79M hidden refs look guilty
  │       evidence: four measured refutations
  ▼
TURN      655K commits are the actual floor
  │       evidence: ~460 commits land per day
  ▼
END       choose among three management actions

GAPS      [evidence needed] cost of each action
```

3. Keep 3–7 beats. Every beat names a claim and the evidence that carries it.
   Mark unsupported transitions as `[evidence needed]`; do not invent a padding
   slide or hide the gap behind a component name. Components come after story.
4. Immediately invoke `AskUser`—do not print a menu:

   1. [question] What should happen next?
   [topic] Story readiness
   [option] Build in Studio
   [option] Revise the story
   [option] Add evidence or material
   [option] Stop with the ASCII map

5. **Build in Studio** freezes the current audience, conclusion, beat order, and
   evidence as the authoring contract. Warn once about any marked gap, but build
   if the user confirms; readiness belongs to them. Do not reopen storyline
   questions in **First steps**—ask only unresolved source/style/screenshots.
6. **Revise the story** asks for the exact keep/cut/reorder/reframe change, then
   redraws the whole map. **Add evidence or material** incorporates only what
   the user supplies. Repeat the readiness call after every revision; there is
   no mandatory number of rounds.
7. **Stop with the ASCII map** creates no files. Return the map as the result and
   say `/explainer shape story` can resume it from the conversation.

Skip the designer when a `/discovery` handoff, design doc, ADR, or explicit
request already gives a clear audience, conclusion, and evidence-bearing arc—or
when the user explicitly chooses a first draft now. Roughly right is enough:
once built, the same story remains steerable through Studio Notes, text edits,
component changes, and rebuilds.

## Authoring the content source

Write `explainers/_sources/<topic>.html` with the four slots (worked examples:
`reference-sources/hello-kit.html` (next to this file) for the shape). The
underscore in `_sources/` is deliberate — it's this repo's existing "internal
input, not a page to open" convention (the same one the skill itself used as
`explainers/_kit/` before it moved here); see the FAQ in `README.md` for why
that separation is worth keeping.

**Opening slide contract.** Every new explainer starts with the `section`
component in `mode:'cover'` and one of its supported background patterns. Add
`section` to `meta.components`, make its host the first content section, and
make it the first `initPresent` entry with `layout:'cover'`. Pick a pattern that
fits the subject; do not open a new explainer with a plain `.hero` slide. This
rule applies to new sources, not upgrades of existing explainers. When the
source supplies a presenter name or team, place it in the cover's `details`;
otherwise omit attribution rather than inventing or requiring it.

Start every content source with a visible banner, *before* the four slots, so
opening the raw file in a browser explains itself instead of rendering blank
(copy the one from `reference-sources/hello-kit.html` or any existing source verbatim,
adjusting the two file paths in it):

```html
<p style="font:15px/1.6 -apple-system,sans-serif;max-width:640px;margin:40px auto;padding:18px 22px;border:1px solid #b45309;color:#78350f;background:#fffbeb">
  <strong>Note:</strong> this is an <code>/explainer</code> content source, not a finished page —
  assemble it first (see <code>.factory/skills/explainer/README.md</code>):<br>
  <code>python3 .factory/skills/explainer/assemble.py explainers/_sources/&lt;topic&gt;.html</code>
</p>
```

This is invisible to the assembler (it only extracts what's inside the four
tagged slots below), so it costs nothing and needs no cleanup.

Then the four slots:

- **`meta`** (JSON) — `title`, `recipe:"explainer"`, `output`, `style`
  (keynote/playful), `components` (only what you use), `theme` (optional),
  `thesis` (one line), `slides` (`{kicker, title, point}` per slide—the point is
  the one-line takeaway), `facts`, and `links`. Keep `meta.slides` in sync with
  the `initPresent` manifest.
- **`content`** — semantic sections only. Every section gets an `id`; heads and
  artifacts get their own `id`s so the manifest can pick them. No `<script>` here.
- **`page-css`** — topic-specific devices only. Before writing one, check the
  component library; a bespoke device must still be hairlines + mono microtype + dots.
- **`page-js`** — `window.GLOSSARY`, component render calls, bespoke interactions,
  and `initPresent([...])` last. Component data is not a place for interactive
  HTML strings: `assemble.py` rejects `<button>` and `data-term=` in this slot.
  Put glossary buttons in `content`.

Then assemble and iterate, from the repo root:

```sh
python3 .factory/skills/explainer/assemble.py explainers/_sources/<topic>.html
```

### Automatic copy-cap repair

Every visual string limit is owned by one deterministic registry. Assembly checks
all recognized inline and top-level variable-backed component data before writing
output. A failure reports every `component.copy_limit` together, with renderer,
component, exact authored field path, measured UTF-16 length, limit, complete
value, and rewrite hint.

When assembly reports `component.copy_limit` during a first build, variant,
settle, Studio-triggered rebuild, upgrade, or review application:

1. Edit every named field in the content source in one pass.
2. Preserve facts, identifiers, numbers, ordering, and the intended conclusion.
   Reword semantically, split a field where its component supports that, or choose
   a better-fitting component. Never slice text or add an ellipsis as the fix.
3. Re-run the same assembly command automatically. Do not ask the user to approve
   ordinary meaning-preserving copy repairs.
4. Stop after three repair attempts. If a cap cannot be met without changing
   meaning or dropping evidence, do not assemble or present a stale/broken page:
   show the unresolved fields and use `AskUser` for the content/component trade-off.

Dynamic values that static assembly cannot prove never abort rendering. The page
keeps the full authored value, records a structured `window.__kitDiagnostics`
entry, emits `kitdiagnostic`, logs the exact issue, and displays a fixed
**copy issue** alert above Read and Present modes. Treat that alert as a failed
build: repair the source and reassemble before sharing.

Structural, data, reference, density, numeric, and geometry errors remain fatal;
never auto-fix them by dropping items or changing system meaning.

## Components first, bespoke second

Reach for a standardized component before hand-rolling markup — a documented data
contract produces a good result even on a bad day. From `references/CONTRACTS.md`:

| Need | Component |
|---|---|
| A formal cover or chapter divider | `section` (`mode:'cover'\|'chapter'`; full-bleed patterns with a protected copy field; use Present `layout:'cover'`) |
| Any list/table/grid of ≥5 items | `table` mode `rows` (grouped hairline rows, flags, refs, optional inline dot-spectrum cell) |
| Two subjects over shared concerns | `table` mode `compare` (butterfly map; empty wing = honest absence) |
| Before/after, old/new, cost A/B | `table` mode `before-after` (dim baseline flips to lit subject; text stays under the mode's caps) |
| Scores, maturity, capacity | `table` mode `rows` with a `dots` cell (dots on a qualitative spectrum — never bars, never invented %) |
| A labelled vocabulary or roster | `table` mode `chips` (soft per-chip tone) |
| A vocabulary that needs visual presence | `table` mode `grid` (calmer tile cards, auto-fill) |
| Subjects compared spec by spec | `table` mode `specs` (subjects as columns; one winner cell per row) |
| An org chart or team hierarchy | `tree` mode `org` (boxes and elbow connectors; root largest, shrinks per depth) |
| A repo or information-architecture map | `tree` mode `files` (folder icons, rationale labels, card-grid leaves) |
| Code structure evolving | `tree` mode `evolution` (before/after mono trees with added/moved/removed markers) |
| A measured trend over time | `chart` kind `line` (2px line, direct end labels, crosshair readout) |
| A trend where filled volume helps | `chart` kind `area` (same data as `line`; studio swaps the two with one click) |
| Measured magnitudes to compare | `chart` kind `bars` (thin horizontal bars; accent on the subject only) |
| Before → after, measured per item | `chart` kind `dumbbell` (two dots on a hairline, one shared scale) |
| A measured part-to-whole share | `chart` kind `split` (one gapped bar, labels below — never a pie) |
| A distribution over bins | `chart` kind `histogram` (contiguous columns, peak labeled) |
| Two measured axes, one point per subject | `chart` kind `scatter` (accent + label only the points that matter) |
| Magnitude over a grid (day × hour) | `chart` kind `heatmap` (one hue, more-is-stronger) |
| Exact votes, people, or represented units | `chart` kind `dots` (one visible dot equals `unitSize`; authored parts must sum exactly to `total`) |
| Where things happen in the world | `chart` kind `map` (countries + lon/lat pins; add `geo-world` to `meta.components` — ~95 KB of vendored world geometry, so only when geography carries the story) |
| A count that is the story | `chart` kind `stat` (big animated numerals + tick strip; scale before detail) |
| Where a request's time goes — spans, waits, and the before/after race | `trace` (architecture family via `renderTrace`; add `trace` to `meta.components`; numbered spans + legend, wait hatching, shared-clock replay) |
| Procedure or look-alike code variants | `stepper` (one concept per step; returns `{go,count}` for Present) |
| Sequence / pipeline / gate | `flow` (Left to right or Top to bottom; Key or More text; Full or Follow view) |
| A single dated sequence of milestones | `flow` mode `timeline` (stations positioned by date; shipped/now/planned states) |
| A roadmap across parallel workstreams | `roadmap` (Timeline, Phases, or Workstreams layout; mark `key:true` items for an audience-first default; Normal or Large text; Keep context or Spotlight step; walkthrough copy always remains available in Studio) |
| A PR's exact code evidence | `code` mode `diff` (side-by-side or stacked; Changes only safely keeps adjacent and walkthrough context) |
| How teams work, capabilities evolve, or launch phases qualify | `architecture` `preset:'operating-model'`. Working flow, Responsibilities, Collaboration lanes, Capability progression, or Readiness gates. Author owners, capability states, and gate criteria explicitly. See CONTRACTS. |
| Data moving through labelled or nested system groups, incl. async/event-driven traffic | `architecture` (trust boundaries, containment, queue/topic nodes, live async pulses, anchored walkthrough) |
| Who calls whom, in what order | `sequence` (architecture family: Whole exchange or ≤3-message Guided scenes; Normal or Large text) |
| What the data is, how it relates | `erd` (architecture family: Relationships or Schema detail; Full or Follow view) |
| One request descending through layers — MRs, code paths, request lifecycles | `stack` (architecture family: Names only or With code; Main or All paths; Full or Follow view; `mode:'diff'` gives before/after call structures for refactors) |
| A process that loops back on itself | `loop` (numbered circuit; hover/click reveals a detail panel; optional return arc; returns `{count,go}` for Present) |
| A broad base narrowing to a rare apex | `pyramid` (stacked trapezoids, leader-lined labels, flag dots; returns `{count,go}` for Present) |
| A tiny visible tip over a hidden mass | `iceberg` (faceted crystal above a waterline, sinking rows below; tight text budgets — fragments only) |

Architecture family roster: architecture · trace · sequence · erd · stack —
sharing one walkthrough context and numbered-legend vocabulary. Trace uses a
full-width race board with local focus bands and a shared-clock replay, plus the
same overview/step/completion guide as charts; keep its Present slide kicker-only
so the waterfall owns the room. Sequence, erd, and stack use the family pulse.
For a multi-lane stack, set
optional lane `weight`/`gutter`, author non-tree calls
with frame `caller`, and use walkthrough `routes`/`routeTo` when route focus
differs from `fire`; its fixed map keeps every frame visible and Present puts
the legend plus dots/annotation in one footer row. New sources call
`renderTrace`; `renderChart({kind:'trace'})` remains compatible with existing
v3 drafts only.

Generic architecture maps expose plain-language Studio choices: **Layout**
(`Free`, `Stages`, `Main flow`, `Groups`) and **Text** (`Key only`,
`More detail`). Main flow uses walkthrough evidence; it does not guess which
systems are important.

The same audience-first controls extend to Sequence, ERD, Stack, Flow, Table,
Code, Tree, and compatible Chart kinds. Use `key:true` only where the source
can identify importance explicitly. Without key flags, Studio keeps all facts.

When a chart carries the argument rather than supporting it, author an
`overview`, `{title, note, focus}` walkthrough steps, and an optional
`completion`. The shared guide positively marks the current evidence, keeps a
full narrative visible in Present, and restores the whole chart for the final
conclusion. Legacy `{label, focus}` steps still work.

Compose these primitives first — a documented contract beats a hand-rolled
device on an average day. But run
**the fit test** before settling: if the story's data only fits a component after
deleting facts, stuffing paragraphs into `sub` fields, or reaching for
`table` mode `rows` a third time on one page, that is a component gap, not a
content problem. Design a bespoke device in `page-css`/`page-js` under the
design-language rules below (budget roughly one per page), tell the user it
is bespoke, and propose promoting it into the kit if a second page wants it.
Force-fitting the nearest component is a defect the cold-read critique will
flag — build the right device instead.

`table` mode `rows` deserves its own caution: it is the default for *lists*,
not a home for narrative. Keep each `sub` under ~90 characters; when subs
wrap into paragraphs, split the row, push detail into glossary terms or a
`muted-note`, or switch device (`table` mode `chips` for a vocabulary, `loop`
for a cycle, `chart` kind `stat` when the count is the story).

## Migrating older sources

Every assembled page carries a compatibility layer (`base/compat.js`, removed
in v4) so a source written for a retired component keeps rendering after a
one-click studio upgrade: renamed calls delegate to the current API
(translating renamed fields, e.g. `aspect` → `title`), dropped calls render
the closest equivalent, and every shim logs a `console.warn` naming the
replacement. The shims are a bridge, not a destination — apply this map
whenever you touch an older source (upgrades, reviews, redesigns):

| Old call | New call |
|---|---|
| `renderStats(...)` | `renderChart('#host', {kind:'stat', ...})` |
| `renderLedger(...)` | `renderTable('#host', {mode:'rows', ...})` |
| `renderBeforeAfter(...)` | `renderTable('#host', {mode:'before-after', ...})` — diet the text to the mode's caps (title ≤ 40 chars, before/after ≤ 60) |
| `renderComparison(...)` | `renderTable('#host', {mode:'compare', ...})` |
| `renderDotplot(...)` | `renderTable('#host', {mode:'rows', ...})` with a `dots` cell per row instead of `sub` |
| `renderChips(...)` | `renderTable('#host', {mode:'chips', ...})` |
| `renderTiles(...)` | `renderTable('#host', {mode:'grid', ...})` |
| `renderFiletree(...)` | `renderTree('#host', {mode:'evolution', ...})` (before/after) or `mode:'files'` (a map/IA source with no before/after) |
| `renderFlow(...)` with old data | `renderFlow(...)` — same contract, new visual (a lit pulse rail with anchored gate outcomes). No source change needed. |
| `renderOperatingModel(...)` | `renderArchitecture('#host', {preset:'operating-model', ...})` |
| `renderContrast` / `renderDuo` / `renderVerdict` | no direct successor — rebuild bespoke under the design-language rules, or pick the nearest keeper via the studio's swap picker |

Design-language hard rules for anything bespoke (unchanged from the pre-kit era):
no emoji as iconography; no tinted "cards" holding prose (hairline rules + aside
columns instead); no status pills/badges/chips (`.flag` is the only status grammar);
no progress bars (a `table` `dots` cell instead); no boxed `<table>` element
(`table` mode `rows` or `grid` instead); mark exceptions, not the
default; one accent for the subject, dashed for absent/future; left-aligned text.
Interactive *controls* (play buttons, rails, theme toggles) and live-demo surfaces may
keep borders — machinery is exempt. Stamp every hand-counted dataset with a
`data-stamp` (`counts as of 1 Jul 2026`).

## Progressive disclosure — applies to every section, every arc, every style

The reader should see only what the current moment needs. Cognitive load is the
budget you spend; walls of text and everything-at-once layouts blow it. Rules:

- **One concept per step.** Anything with ≥4 steps or ≥3 look-alike variants
  becomes a `stepper` or a fragment walk — never a dump the reader must diff by
  eye. Explain every named helper the first time it appears.
- **Depth is opt-in, never up-front.** TL;DR `<details>` toggle for "the one
  rule"; glossary `term` buttons for jargon (define once, reference everywhere);
  `muted-note` for caveats below the artifact, not inside it. The main path
  reads clean without opening any of them.
- **In Present mode, fragments pace the reveal.** `table` rows (any mode)
  arrive one keypress at a time (`steps:{count,go}`, the mode's own Present
  driver) so the room reads the row you are talking about, not the whole
  table. Interactive widgets get their own slide with a step driver. **A
  slide should never land already "finished"** — if a step driver's arrival
  state (`i=0`) shows the same thing as its fully-revealed state, shift the
  driver so arrival shows nothing yet (see `references/VERIFICATION.md` §4
  for the exact pattern).
- **Lists get groups; groups get counts.** A 12-row `table` reads as three
  4-row groups with mono headers. Elide honest noise (`… · 9 more, unchanged`)
  instead of showing it.
- **Budgets are hard:** keynote ≤ ~600 visible chars per slide (verifier fails
  >900); a section that reads as a wall next to its neighbours gets split into
  facts/steps or cut. When trimming, cut prose before cutting facts.
- **Text is scaffolding, not the show.** Generated pages drift toward prose;
  fight it mechanically. Default section anatomy: one headline claim, one
  visual or number, at most one qualifier line. A `sec-sub` is one or two
  short sentences (aim ≤ 160 chars in keynote); if it restates what the
  component below already shows, delete it. Cut throat-clearing ("It's worth
  noting", "In order to") and adjectives next to numbers — `200.9 s` needs no
  "slow". The visuals may be lavish; the words stay lean. Depth lives in the
  opt-ins (glossary, TL;DR, `muted-note`, chart table twins), never on the
  surface.
- **One slide, one job.** Before adding a slide, check it doesn't just restate
  a fact a neighbouring slide already made — see `references/VERIFICATION.md`
  §5. Two slides making the same claim is worse than one slide making it well.

## Narrative arcs and recipes for recurring topics

Two topic shapes have default arcs: a refactoring or architecture plan, and a
merge-request walkthrough. The beat-by-beat playbooks are in
`references/NARRATIVE-ARCS.md`. Treat each as a head-start, not a mandate; the
progressive-disclosure rules above bind both.

## Diagrams: big, zoomable, legible

- When the topic has a genuine spatial relationship (threat model, architecture,
  data flow), draw a **real diagram** — not tab-cards, not a bullet list.
- Prefer `architecture` for movement across labelled or nested system groups
  (including async/event-driven traffic — queue/topic nodes, live pulses) —
  its `preset:'operating-model'` explains how teams work through authored stages,
  owners, cadence, and labelled handoffs (see CONTRACTS for the legacy decision shape) — and `flow` for a linear
  sequence or gate; both already meet every rule. For `architecture`
  specifically: keep node `sub` text short (one line, ≤ 30 chars — reword
  instead of relying on wrapping) and never use `·` lists inside fixed cards;
  use separate fields or one plain phrase. Include every labeled edge in at
  least one walkthrough step, and set `width` to 1600-2000 for dense diagrams.
  The component handles edge routing, marker numbering, and zoom automatically —
  see `references/CONTRACTS.md` for the full deterministic rules.
- Bespoke SVGs: viewBox **at least 1000 wide** for a full-width diagram; **no `<text>`
  below 12px** (must render ≥11px at the default 940px content width); empty geometry
  with leader-lined labels outside; labels that sit on a line get a solid
  `--bg`/`--surface` background so the line doesn't slice the text.
- Put `data-zoom` on every diagram `<figure>` — the skill adds a keyboard- and
  touch-accessible expand affordance (full-viewport overlay, wheel-zoom, drag-pan).
  Diagrams carry signal, not echo: don't repeat labels the prose already established.

## Motion

The vendored Motion build drives scroll reveals, staggers, and panel swaps
automatically — you get it by using `.reveal` classes, `swapIn(el)`, and
components. Do not add other animation libraries. Everything falls back to CSS
transitions and honours `prefers-reduced-motion` without any work from you.
(Present mode's slide-entrance transition is deliberately plain CSS, not
Motion — see `README.md`'s "What the skill fixes for free".)

## Scroll mode

The default view — before a reader ever presses `P`. Sections stack in the
`.shell` article column (max 1100px) so prose keeps a comfortable reading
measure, but canvas-family components (architecture/data-flow/sequence/erd,
stack, flow, chart, tree's org mode, table's compare/specs modes, iceberg) break out
of that column and center at up to 1440px — closer to the ~1500-unit canvas
they're authored on, instead of shrinking to fit a 1100px shell. Below
~900px width they stop shrinking further and scroll horizontally instead
(chart, and table's compare/specs modes, share the same floor convention
architecture/flow already had). None of this needs authoring — it's
automatic for every component that opts in. The payoff: a reader who never
presses `P` and screenshots the scroll view now sees something that reads as
intentional, not cramped.

## Present mode

Every explainer ships the skill's Present mode: Studio's labelled **Present**
action or `P` enters on the slide matching your scroll position; `Esc` exits and
anchors the page to the slide you left;
re-entering resumes (fragment step included); `#s<N>` deep-links and reload restore
position; `F` fullscreen; arrows/Space walk fragments then slides. All of that is
fixed in `base/present.js`; your job is only the **manifest**.

Composing `initPresent([...])` — one object per slide, fields
  `{pick, kicker, title, layout: 'wide'|'diagram'|'cover', steps, minScale, maxScale}`:

- **Never map sections to slides 1:1.** A short section → adopt the whole thing. A long
  section → split across slides, giving later slides a synthesized `kicker` so chapter
  context survives. An interactive widget → its own slide with a `steps` driver.
- Three step drivers: `fragSteps(selector)` reveals items one per keypress;
  `clickSteps(selector)` walks existing buttons/dots; or pass `{count, go(i)}` directly
  (components like `stepper`/`flow` return exactly that).
- A `section` component owns the entire slide: pick only its host, set
  `layout:'cover'`, and do not add a second title or kicker in the manifest.
- The first slide of every new explainer is that cover: use a supported
  background pattern and make the section host the first manifest entry.
- **Budget each slide to render at scale ≥ 0.75 on a 1600×900 window.** The skill
  pre-measures stepped slides so they keep one scale for the whole walk; give steppers
  with genuinely variable step heights `minScale: 0.85` so text never resizes mid-walk.
  Present measures oversized descendants as well as the stage, fits Flow on a wide
  stage by default, and warns with the slide, dimensions, required scale, and fix when
  fixed widths or `minScale` make the viewport impossible.
- **When a story must split to hold the budget, mark the continuation.** Add
  `continues: true` to the follow-on manifest entries (kicker `… · continued`) —
  the deck derives a "part N of M · continued" tag from the chain, so reordering
  slides can't misnumber parts. The chain is also a **scale-lock group**: every
  member renders at the smallest scale any member needs, so the shared columns
  land on identical pixels and the picture does not zoom at the transition.
  Numbered-legend components take `numberFrom` so the continuation's numbering
  doesn't restart at 1 (a sequence split after message 3 passes `numberFrom: 4`;
  a stack whose first part handed off once passes `numberFrom: 2`) — and
  `numberFrom > 1` is what turns on the **carry-over device**: lifelines/descent
  rail reaching the canvas top edge with a fade, a quiet `↑ continued · 1-3`
  marker, and recap-toned actor/lane headers.
- Keynote style: aim for ≤ ~600 visible characters per slide.
- Add `.pr-stage` overrides in `page-css` for any bespoke multi-column device, restoring
  its desktop layout inside the deck (browser zoom shrinks the CSS viewport and would
  otherwise collapse it to the mobile layout). Kit components already ship theirs.

## Screenshots

If the topic has a UI surface and the user attached images, confirm the source
path and intended focal area before embedding. Capture at 2x the intended
presentation size, then embed each as a `data:image/png;base64,…` URI
(`base64.b64encode(open(p,'rb').read()).decode()`), in a `.screenshot-frame`
(kit CSS), placed right after the hero text with a one-line
`.screenshot-caption`. No placeholder boxes when there are no screenshots.

Record the original page or asset path as `data-source` on the frame so later
replacement does not depend on memory. The default frame preserves the full
image. For a focal crop without bespoke CSS, set `--screenshot-aspect` and
`--screenshot-object-position` on the frame;
add `data-zoom` so opening it always reveals the complete intrinsic image. The
runtime marks raster images enlarged beyond native size with
`data-upscaled="true"` and reports the dimensions plus a recommended 2x capture.

## Initial share: assemble, then show immediately

The first share must not be blocked by a verification loop. The only required
gate before showing the user is a successful `assemble.py` run.

**Initial-share workflow (non-negotiable):**

1. Assemble the content source. Resolve every `component.copy_limit` through the
   automatic repair loop above before continuing.
2. If assembly succeeds, immediately launch Studio on the assembled page—do
   not ask whether to open it:
   `python3 .factory/skills/explainer/studio.py <assembled-page>.html --agent <adapter>`.
   Return the Studio URL first and the assembled path second. The first useful
   surface is the editable page, not a terminal path; Studio also exposes the
   sibling Gallery and component showcase from the start. Its **Open HTML file**
   action opens the exact assembled file without Studio or review controls. Make
   clear that the local URL is not shareable: send the file or host it.
3. If Studio cannot start, return the assembled local path as a fallback and
   state the exact launch command.
4. Add one quiet iteration hint in that same response:
   **The generated HTML is a first share, not a final artifact.** Say that the
   user can ask for any change in plain language or leave location-aware Notes
   in Studio; "apply my review" brings those edits back here. The Gallery header
   links to `showcase/components.html` so component names are browsable without
   another terminal command. If the look is undecided, offer variants in one
   line (see "Design variants and the review loop"). Also mention that a Note
   can request 2–3 ideas for a slide and bespoke devices remain available.
5. Do not run browser, screenshot, interaction, rendering, subagent, or
   exhaustive static checks before the initial share. Starting Studio is the
   handoff, not a verification pass.

This preserves the “Aha!” moment. The user must be able to work with the result
as soon as assembly succeeds, not after minutes of automated inspection.

## Design variants and the review loop

Most people cannot name the design they want — but they can pick from two
and point at what bothers them. Two skill tools close that loop with nothing
installed beyond python3 (both are stdlib-only, like the assembler).

**Two designs to choose from.** Assemble the same content source once per
style — the content is identical, only the token layer changes:

```sh
python3 .factory/skills/explainer/assemble.py explainers/_sources/<topic>.html --variants keynote,playful
```

Each output lands with a `-<style>` suffix, and the command prints the
ready-to-run comparison line. `--style <name>` does the same for a single
alternate look without touching the source.

**The review loop.** Serve the variants with the Notes overlay (files on
disk are never modified — the overlay is injected per request):

```sh
python3 .factory/skills/explainer/review.py explainers/<topic>-explainer-keynote.html explainers/<topic>-explainer-playful.html
```

The reviewer gets, in their browser:

- **A/B/C flip** with scroll position preserved — flipping in place is the
  fastest way to see what a style actually changes;
- **Notes** — choose **Select & note**, drag a region or click an element,
  and type what should change. Region coordinates are saved relative to the anchor; each
  location-aware Note is anchored by section id, CSS selector, and
  a text snippet so an agent can locate it in the source;
- **design tuner** — live controls for type scale, content spacing within visuals,
  intro and section-summary text width, and
  accent color, recorded per variant;
- **prefer** — records the winning variant (only shown when there are 2+
  files to choose between);
- **finish** — appears once there are pending changes, then itemizes every
  Note, text edit, design setting, component tweak, look, and variant choice.
  Each item can be discarded independently, and **Discard all changes** resets
  the pass. The same screen gives the reviewer the single line to paste to
  their agent, with a copy button and a preview of exactly what the agent
  receives. When handing the loop to a reviewer, point at this button — never
  assume they know what happens after adding notes.

Everything lands in `explainers/_reviews/<name>/review.md` (plus a
machine-readable `review.json`). Re-assembling and refreshing shows the new
version; notes persist across refreshes.

**The studio** (`studio.py`, same arguments) is the review loop plus a
section workspace with a canvas and an inspector of *deterministic* one-click
tweaks — never make a reviewer wait on a model for something a script can do:

- **themes**: Keynote and Playful re-assemble the page from its content source in
  another style (sub-second) and serves it in place;
- **edit text in place**: on the Visual tab, click any text on the slide —
  the title, a paragraph, or a component's labels — and type the replacement
  right where it sits. Enter commits, Escape cancels, and a live counter
  shows the component's length limit while you type. Component text writes
  straight into the component's data; slide prose records the same guarded
  replacement the review bar's **Edit text** mode files in plain Review
  (which keeps that button for the agent handoff). **Save edits** persists
  both through the source and rebuilds locally; **Finish** can still hand
  them to the agent;
- **arrange**: move and resize a visual, or draw a rectangle, ellipse, line,
  arrow, or text label where it belongs — arm the tool, drag to place and
  size the shape, and style the selection from the floating toolbar beside
  it (fill, stroke, duplicate, delete). Double-click a text label to retype
  it in place. A single click in Arrange moves a visual as one object;
  double-click a catalog or safely captured source visual anywhere in Studio to
  preview its editable shapes and text. Selection and untouched previews never
  dirty the document. The first actual part edit commits the portable scene as
  an undoable change. Unsupported custom HTML/SVG remains editable as one object,
  never a partial capture or image fallback.
  Auto-layout, walkthroughs, and semantic component controls stop for that
  visual. **Reset visual** returns to the retained semantic component and
  discards its freeform edits; it does not infer component data from shapes.
  See [the authoring contract](references/CONTRACTS.md#authoring-manifest) for
  persistence and compatibility;
- **appearance**: a separate inspector tab holds style previews and readable
  presets for page text, spacing, line length, background, and accent. The
  **Adyen brand** accent preset uses Malachite (`#0ABF53`) on dark pages and
  Midnight (`#00112C`) on light pages;
- **section order**: drag sections or use the selected section's up/down actions.
  The preview and Present sequence update together; **Save edits** persists the
  order locally. Deleting an original source slide is also a reversible local
  hide, so Studio never rewrites the authored HTML structure;
- **component editor**: select a slide in the left navigation, then click its
  visual to open the right inspector. Layout previews and the selected visual's
  `Calm`, `Normal`, and `Off` motion previews sit beside short, plain-language
  options for layout, items, text, and view. A Full view changes emphasis, not
  the walkthrough copy. Key-only text is the architecture default; the complete
  walkthrough stays available. Calm is quieter/slower, changes preview only
  that component, and reduced-motion remains authoritative. Supported stable
  tweaks become permanent through **Save edits**; **Finish** keeps the agent
  route for unsupported or intentionally delegated changes. **Add Slide** inserts
  curated catalog visuals with placeholder data into a bounded local authoring
  manifest; users can edit, duplicate, delete, and reorder those slides without
  an agent. Every catalog component's visible text edits in place on the slide,
  and so does its structure: hovering a repeated item shows **Duplicate / Move
  up / Move down / Remove** on the item itself, with a dashed **Add item** chip
  after the collection's last item. The inspector reserves itself for what the
  slide cannot show — the aria label under a collapsed **Advanced**, plus the
  same item actions as a compact summary; **Add item** anywhere clones an
  existing typed item (create the first item through the agent when a
  collection starts empty). Architecture and Operating Model add direct canvas
  handles as a shortcut, not as a separate persistence tier;
- **section slides**: a dedicated **Add section** action inserts a live,
  reversible chapter divider before an existing slide. It never replaces or
  hides that slide's content; the original remains the next beat. The picker
  previews all eight background patterns (ribbons, dots, arcs, iso, waves,
  frames, rays, swarm), and existing section slides expose the same pattern
  choice under component editing. The review handoff records the
  insertion separately from swaps and calls out the required Present
  `layout:'cover'` manifest entry;
- **presentation export**: **Export presentation** downloads the coordinated
  Present-mode sequence, including unsaved deterministic edits. Every explicit
  walkthrough state becomes a consecutive slide; decorative motion is frozen at
  that state. Portable text, shapes, lines, arrows, and paths become native
  presentation objects; embedded images remain images. The PPTX is an offline
  interchange file for Google Slides and PowerPoint. Export is read-only and
  local. Present mode is required; never capture the Studio editor layout as a
  fallback. If any visible object has no editable representation, abort before
  downloading instead of flattening, dropping story steps, or creating a partial
  deck;
- **on-page controls** sit beside the relevant slide: **Adjust** opens Studio
  directly at that component's registered controls; Architecture and Operating
  Model then offer **Edit component** for direct canvas editing. **Change visual** opens a
  picker of every kit device
  (small preview, one-line fit, a "view" jump into the gallery) plus a box
  to ask in the reviewer's own words. Either way it adds a Note requesting
  a component change at that exact spot immediately — a request must look like a
  request, never like a click that did nothing;
- **other explainers in this folder**, the preview-first Gallery uses readable
  cards with visible Open/Upgrade actions, status and useful counts; each live
  thumbnail is opaque-origin sandboxed without `allow-same-origin`, and its header
  links to the live component showcase. Each card also opens its exact assembled,
  self-contained HTML without Studio controls. One click opens a sibling page,
  and older pages expose an upgrade action when source is available.

Prefer offering `studio.py` over `review.py` when the reviewer is non-technical
— it is the same loop with more things they can do themselves.

**Studio-to-agent handoff (experimental).** Select the adapter for the harness
that launched Studio. Factory Droid uses `--agent droid`; Devin uses
`--agent devin`. When the flag is omitted, the default `--agent auto` walks the
process ancestry and resolves `droid` or `devin` itself. Studio then owns one
harness-native child session (Droid
JSON-RPC or Devin ACP), created only when work is sent and retired after five
idle minutes. A user pressing **Send to agent**
atomically saves the review, pauses Studio editing across tabs, and queues a
turn directly on that child session. Paused editing is a visible state, not a
silent one: editing controls dim and explain themselves when clicked, while
reading — browsing, Present mode, the theme toggle — stays fully available. Studio—not the launching chat—receives the
session ID and progress events, surfaces them in the browser, and validates the
rebuilt file. There is no stdout event or shell-log polling contract.

The adapter prompt uses only server-derived review, source, skill, and assembled
paths. It tells the child to follow **Applying a review** below, change the
authored source, re-assemble the page in place, verify it, and avoid commits or
unrelated edits. Studio keeps serving its last known-good snapshot while the
file changes, then validates a stable rebuilt-file fingerprint before reloading
the result. **Cancel agent and resume editing** interrupts the active turn and
only unlocks when the assembled file is still unchanged. If an adapter fails,
the review stays saved and locked with an explicit error plus the manual copy
recovery. Never infer a harness from installed binaries: pass its adapter
explicitly. Harnesses without an adapter keep the ordinary copy/paste flow; do
not restore the old log-polling path.

**Upgrading existing explainers.** The source is the asset; re-assembly is
the upgrade. The studio works as a true overlay on any assembled page,
however old — and it reads the page's stamp: when the page was assembled
with an older kit and a source is reachable, the panel opens with an
upgrade card. One click rebuilds the page in place from its own source —
same content and look, current components — after keeping the previous
bytes in the git-ignored `_reviews/` directory. A "reachable" source is the
stamped path when it exists (relative stamps also resolve against the page's
own tree, not just the studio's working directory), a byte-identical authored
source beside the page when the stamp is gone or points at a recovery copy,
or the copy **embedded in every v3 page** (recovered automatically into
`_reviews/`) — so downloaded and mailed
explainers upgrade too. Pages with no stamp or no source at all (pre-v3,
moved) still get the full overlay (Notes, tuner, finish); only style
flips and the upgrade need a source. Swapping old devices for new ones
(a `table` for a `chart`) stays agent work — reviewers can request it in a Note.

**Git hygiene** (teams track explainers in git): the content source in
`explainers/_sources/` is the asset to commit, plus assembled pages if the
team wants them shareable from the repo. Everything under
`explainers/_reviews/` is throwaway (feedback, studio previews) — the tools
drop a self-ignoring `.gitignore` there automatically, so never commit it and
never write anything you'd want to keep into it.

**Applying a review** — when the user says "apply my review" (or pastes the
`Apply the review in …` line the overlay offers them):

When a review includes **Canvas adjustments**, merge each variant/host record
into that architecture component's source `canvasEdits` field. Preserve its
version, layout keys, identities, and stable node/host IDs. Reassemble and verify;
do not translate one layout's positions into every layout or patch generated HTML.

1. Read `review.md`. The verdict picks `meta.style` — and settles the
   files deterministically: run
   `assemble.py <source> --settle <winning-style>` (same `--out` the
   variants run used, if any). It assembles the winner under the page's
   canonical name and deletes the `-<style>` candidate pages — but only
   ones that are provably ours (kit-stamped, matching style and source);
   anything else is kept and the reason printed. Clicking Prefer never
   deletes anything (a browser click must not destroy files); `--settle`
   is where candidates die — before one sneaks into a commit. Never
   hand-delete. Notes are source edits: locate each by its section id and
   text snippet (the CSS selector targets the assembled DOM the source
   produces). Preserve the authored facts, stages, branches, and ordering;
   never simplify the story merely to fit a component. If valid content
   exposes a reusable-component geometry defect, fix that component rather
   than deleting or renaming the evidence.
2. Tuner values are per variant. Small deltas → keep the chosen style as-is.
   Consistent large deltas → create a `styles/<name>.css` from the nearest
   style and adjust its token knobs; that is exactly what the token contract
   at the top of every style file is for.
3. A Note asking for a different device ("try this as a loop") is a
   component swap in the source's page-js — not a reason to hand-edit output.
4. Apply ONLY the notes in the current `review.md` — never a memory of an
   earlier pass. Do not hand-clean `review.json`: on the reviewer's next
   refresh, the overlay sees the rebuilt file, confirms it with a banner,
   and offers them a one-click fresh pass that clears the applied notes.
5. Re-assemble, tell the user to refresh, and leave the server running for
   the next pass.

**The ideas pass — taste on demand.** Most reviewers can't name what would
make a page land harder; they can only feel that it doesn't. Never wait for
them to specify the fix. Run an ideas pass when any of these fire:

- a review contains **Notes requesting ideas or component changes** (the
  one-click ideas action can file "propose stronger treatments here" with
  zero typing);
- the user says anything in the family of "more wow", "make it pop",
  "something feels off", "less boring";
- your own fit test flagged a force-fit while authoring.

For each flagged spot (or the 2-3 weakest beats when the ask is page-wide),
**propose — do not silently apply — up to three treatments**, each with a
one-line why:

1. **Cut for cinema** — delete the sub, let the number or visual stand alone.
   Text is the usual culprit; this is the most common winning move.
2. **Swap the device** — same data, stronger component: `table` rows →
   `loop` for a cycle, `table` rows → `chart` for measured numbers, prose →
   `chart` kind `stat`, a wall of numbers → `chart` kind `dumbbell`, a chart
   → a `walkthrough` chart when it deserves narration. Name the component, so
   the user learns the vocabulary.
3. **Re-rank the hierarchy** — promote the buried number to the claim line,
   demote the qualifier to a `muted-note`.
4. **Go bespoke** — when nothing in the kit fits, pitch a bespoke device in
   one sentence ("a vertical timeline with the outage window shaded") and
   build it in `page-css`/`page-js` under the design-language rules. The kit
   saves ~90% of the tokens on routine beats precisely so a page can afford
   one generated device where it counts — being deterministic by default is
   an economy, not a cage.

Present the options in plain language ("slide 4: this table is doing a
loop's job — swap it?"), apply what the user picks, re-assemble, re-serve.

**Register variants — plain-language A/B.** Style is not the only axis worth
comparing. For a mixed or non-native-English audience, offer a second source
`explainers/_sources/<topic>-plain.html` written in simplified technical
English — same sections, same components, same facts:

- short sentences (aim ≤ 18 words), one clause where possible;
- common words over rare ones ("use", not "utilise"; "start", not "initiate");
- no idioms, no metaphors; keep every number, unit, and identifier exact;
- jargon defined at first use via the glossary.

Assemble both sources and serve them as A/B in `review.py`. The banned
vocabulary and honesty rules bind both registers — "plain" changes rhythm and
word choice, never accuracy.

## Follow-up verification: only after sharing

`references/VERIFICATION.md` is a post-share read-and-reason checklist. Offer
it after the user has opened the explainer, after they give feedback, or when
they explicitly ask for verification. Never run it automatically on the initial
creation turn.

If a post-share check fails, fix the *source* (split a slide, shrink a device,
raise SVG text size) and re-assemble — do not patch the assembled output by hand.

## The synthetic audience review

`references/CRITIQUE.md` defines one cold-read protocol for explainers: a
subagent with zero topic context inspects the rendered page (real rendering is
required) and reports comprehension, evidence, interaction, and aesthetic gaps.

- **After the first Studio handoff:** offer it; do not run it automatically.
  The user sees and steers the first share before a synthetic audience does.
- **During story or design iteration:** after a substantive revision, offer
  "Want a synthetic audience pass on this version?" Never run it silently.
- Route findings per `references/CRITIQUE.md`: source fixes for page-specific
  comprehension gaps, skill fixes (+ `VERSION` decision) for systemic defects,
  and user decision for taste calls.

## Final response

Keep it short and lead with what the user should do next:

- **Open in Studio:** URL first.
- **Conclusion:** the one sentence this explainer is designed to land.
- **Review path:** 2–3 beats to inspect or present.
- **Source artifact:** assembled path, then the editable source path.
- **Iteration:** ask in plain language or leave a Note; "apply my review" brings
  Studio feedback back to the source.

Only mention verification, kit reuse, or git status when the user requested it.

```text
Studio: http://127.0.0.1:7373/review-evidence

Conclusion: stale evidence must block approval until it is refreshed.
Review: invariant → failure path → recovery evidence.
Files: explainers/review-evidence.html · explainers/_sources/review-evidence.html

This is a first share—edit it in Studio or tell me what to change.
```
