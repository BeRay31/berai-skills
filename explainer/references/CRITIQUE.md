# The synthetic audience review

The `VERIFICATION.md` checklist proves mechanics — no console errors, no
overflow, every slide walks. Neither can judge whether a stranger *understands*
the page, whether the pacing lands, or whether a slide feels empty, crowded, or
cheap. A cold reader can. This file is the protocol for running one: hand it to a
subagent that has **no context about the topic** and let it judge from rendered
pixels.

Findings this loop has caught that assertions could not: a Present-mode entry
that skipped the title slide, a payoff caption outshining unreached beats, two
gate rules that read as logically redundant, load-bearing jargon defined
nowhere, a stamp animation stranding content invisible, and table-monotone
sections that needed new components.

This review needs a subagent that can actually render the page in a browser —
it is inherently a rendering-dependent check, unlike the rest of
`VERIFICATION.md`. Skip it (and say so to the user) when nothing in the
environment can screenshot a browser.

## When to run it

- **After an explainer is first shared** — offer it after the user has opened
  the assembled page. Never delay the initial local path for a cold-read review.
- **While iterating with the user** — after a substantive story or design turn,
  offer it: *"Want me to run a synthetic audience pass on this version?"* Do not
  run it silently on every turn (it costs a full subagent run); do keep offering,
  because taste regressions creep in exactly during iteration.

## How to run it

Spawn one general-purpose subagent per page. Fill the two placeholders and use
this brief verbatim as the core of the prompt:

---

You are a design-savvy engineer doing a COLD READ of an interactive HTML
explainer. You have NO context about what it describes — that's the point:
judge whether the page alone teaches you what happened, and how it feels.
**{MODE}** <!-- both styles (keynote, playful): "This is a deck meant to be
projected and talked over in a room — spend most of your effort in Present
mode." -->

File: **{FILE}** (self-contained; open via `file://`).

How to inspect (render in a browser at 1440x900):

- Load at 1440×900. Run `window.__revealAll()`, then screenshot the full page
  section by section and READ it.
- Toggle the theme (`#themeToggle`); screenshot 2–3 sections in the other theme.
- Exercise the interactions: stepper dots (`.kst-dot`), glossary terms
  (`.term`), any animated device.
- Present mode: press `p`, then ArrowRight through EVERY slide and fragment
  (`window.__present.state()` tells you where you are), screenshotting the
  states that matter — including each slide's arrival state.
- Zoom: `window.__zoom.open(0)`, screenshot, Esc.
- Save screenshots to a scratch directory and LOOK at them with the Read tool —
  judge from pixels, not from the DOM.

Report:

1. **COMPREHENSION** (most important): in your own words, what is this page
   about — what problem, what solution, what should the audience remember?
   Then list everything you could NOT figure out from the page alone
   (jargon, missing beats, logical gaps), each with the slide/section where
   you got lost.
2. **AESTHETICS & PERCEPTION**, per area with severity (high/med/low):
   typography and hierarchy; spacing and rhythm; color and contrast in both
   themes; diagram legibility; Present pacing (slides crowded or empty on
   arrival, anticlimaxes); anything broken, misaligned, or cheap-looking.
3. **STORYTELLING & COMPONENT GAPS**: where does the page feel flat or
   table-heavy? If a different visual would help the reader find or interpret
   the evidence, name it, say where it would go, and describe what
   data they'd take.
4. **TOP IMPROVEMENTS**: ranked, max 8, must-fix vs nice-to-have, each with an
   exact location.

Be tough but fair — specific observations with locations, not generic advice.

---

## Acting on the findings

- **Comprehension gaps** → fix the *source*: glossary terms for jargon, a
  clause for logical stalls, a named protagonist in the hero. Never assume the
  reader lives in this repo.
- **Systemic defects** (anything a second page would also hit) → fix the
  *skill*, make the `VERSION` decision for the whole branch once, re-assemble
  every output.
- **Component proposals** → adopt only on convergence or clear reuse; one page
  wanting a device is a bespoke `page-css` job, two pages wanting it is a
  component.
- **Taste calls** you disagree with → surface them to the user with the
  critic's reasoning; don't silently apply or silently drop.
- Re-run the VERIFICATION.md checklist after applying fixes; re-run the
  critique only when the changes were structural.

The division of labor mirrors the systems these pages tend to describe:
VERIFICATION.md is the deterministic gate, the synthetic audience is the
non-deterministic reviewer — you want both signatures before shipping.
