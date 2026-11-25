# Narrative arcs for recurring topics

Two topic shapes come up often enough to have a default arc. Treat each as a
head-start, not a mandate — compress or reorder when the topic calls for it.
The progressive-disclosure rules in `SKILL.md` bind both arcs: each numbered
beat is one slide-sized idea, revealed via fragments — never an all-at-once
dashboard. Interactive product experiences belong to [`/sketch`](../../sketch/).

## Refactoring / architecture plan

For "we are restructuring X" (often born from an `openspec/` change or a large
plan the agent is following). The reader needs the high level, the ins and outs,
and **how the code evolves** — not a restatement of the plan document.

1. **Hero** — the one-line outcome, plus a TL;DR toggle with "the one rule" and
   "what is unchanged" so the detail stays opt-in.
2. **The problem** — what is tangled today, concretely (a claim slide).
3. **The rule** — the single organizing principle, named plainly (claim slide).
4. **The shape** — `tree` mode `evolution`, before → after. This is the
   centerpiece: mark only what moves, elide unchanged noise, annotate
   destination paths on moved nodes. Prefer it over bespoke box-and-arrow
   SVGs for structure — boxes hide names, trees show them.
5. **Anatomy** — the rule applied to one unit (`stepper`, one concept per step).
6. **Migration path** — phases and gates as a `flow` diagram (or `flow` mode
   `timeline` when phases have real dates); dashed/future styling for phases
   not started, and a `data-stamp` for where things stand today.
7. **Walkthrough: adding the next thing** — the payoff. Work backwards from a
   concrete goal ("starting tomorrow, how do I add Templates?"), `stepper`, ending
   in a small mental-model `table` mode `rows` (the few invariants × where each lives).
8. **Guardrails** — how the structure is kept from drifting (deterministic lint vs
   judged review), as a short `table` mode `rows`.

Narrative principles: concrete before abstract (show the diff for one real
example, then one line of why); keep the same worked example across steps;
name things by what they do.

## Explain this merge request

For "walk me through this MR" — agent-authored MRs span many files and read as
intimidating; the explainer's job is **review ROI**: what this is, what to review
first, in what order, and where the risk sits. Pull facts from the MR itself
(description, linked issues, acceptance criteria, diffstat) — never invent them.

1. **Hero** — what the MR does in one sentence; `data-stamp` the scale honestly
   ("34 files · +2.1k −800 · MR !123 · issue #45"); link the MR and issues in
   `meta.links`.
2. **Problem → solution** — one claim slide each, or a single `table` mode
   `before-after` (what was broken · what this change does about it).
3. **What changed, by area** — grouped `table` mode `rows`, one group per
   domain/layer, one row per cohesive change (not per file). Flag exceptions
   only: `gap` for risky, `next` for new surface, `progress` for follow-up
   planned.
4. **The review path** — the centerpiece: a numbered `table` mode `rows`
   (`numbered:true`) in recommended review order. Each row: what to read, why
   it's at this position, and what to check there ("start here — the
   invariant everything else leans on", "then the handler — mechanical,
   skim", "last: generated files, verify by regenerating"). Honest ordering
   beats completeness; say explicitly what can be skimmed and why.
5. **Acceptance criteria** — `table` mode `rows` mapping each criterion to
   where the diff satisfies it and where it's tested; `progress`/`gap` flags
   for anything partial. An unmet criterion stated plainly beats one hidden.
6. **How the code evolves** — `tree` mode `evolution` with markers when the MR
   moves structure; skip when it doesn't (don't force it).
7. **Risks & what to poke at** — short `table` mode `rows`: the review's
   attack surface (concurrency, migrations, authz), each with a one-line "how
   to convince yourself".

Put the MR/issue refs in `meta.links` and the review order in `meta.slides`
points so Gallery metadata and agents inspecting the source see the intended
review path without parsing the assembled HTML.
