---
name: slop-slicer
description: >-
  Slice a large change, usually AI-generated, into a stack of small reviewable
  merge requests, then commit each one step by step with every commit checked on
  its own, and open each MR as its milestone completes. Use when a branch or
  working tree has grown too big to review, when the user asks how to split work
  into MRs or PRs, plan stacked MRs, avoid review fatigue, break a feature into
  building blocks or layers, stage commits one at a time, or "do the ritual",
  even if they don't say "stacked".
metadata:
  requires:
    - skill:create-merge-request
    - skill:capture-review-evidence
    - skill:repo-info
    - skill:resolve-merge-conflict
---

# Slop Slicer

Turn one oversized change into a stack of small MRs, each committed in steps that pass the checks on their own.

## Use when

- The working tree or branch holds more than one reviewer can take in at once.
- The user asks how many MRs to make, how to split them, or how to commit "step by step".
- The user says "next step" during a slicing session: continue the ritual below.

```bash
# Size the change, then check one staged commit on its own
scripts/change-size.sh app/plugins/my-plugin
scripts/check-staged.sh -- bash -c 'cd app && yarn tsc && yarn test --watchAll=false'
```

## Rules

- Never commit, push, or open an MR unless the user asks. You stage; the user commits.
- Every commit and every MR passes the project's checks on its own (type check, lint, format, tests).
- The target branch keeps working after each MR merges. Say what users see between MRs.
- Back up the full work before slicing, and keep the backup until the last MR is committed.
- Ask one decision at a time, with pros, cons, and a recommended option.

## Phase 1: Measure

1. Run `scripts/change-size.sh <path>` and show the table: code, tests, mocks, docs.
2. Read the project's review guidance (AGENTS.md, CONTRIBUTING.md) for size limits or commit formats.
3. Compare with recent merged MRs in the same area: their code size is the reviewers' normal load.

## Phase 2: Plan the stack

Pick the slicing axis with the user. Default to the one that gives each MR one thing a reviewer can look at.

| Axis | Each MR is | Fits when |
|---|---|---|
| Building block | One UI part or feature piece, end to end | Product features, pages |
| Layer | Contract, then data, then logic, then UI | Backend work, new APIs |
| Prep, then feature | Shared refactors first, feature after | The change edits shared code |

For each MR, write down in the project's plan file (`PLAN.md` if there is one):

- What it adds, and what is visible after it merges.
- Its files. A file the MR needs only part of gets a **slim version**: labels, types, mocks, tests, and exports cut to what that MR uses.
- Its commits, in dependency order. Default order: types and labels, then data and mocks, then the feature, then exports and docs.
- Its rough code size. Aim for each MR near the area's normal load.

Check the plan for these before the user agrees:

- Something an earlier MR ships that only a later MR uses: an unused prop, a mock fixture, a test mock. Move it to the MR that uses it, or note why it stays.
- A test in an earlier MR that names something from a later MR (a label key, a field). It fails that MR's own check.
- Interim states on the target branch, such as an empty tab or a half-built page.

## Phase 3: Back up

```bash
git stash push --include-untracked -m "<ticket> full work (before slicing)"
git stash apply --quiet 'stash@{0}'
```

The working tree keeps everything. The stash is the copy you rebuild any slice from.

## Phase 4: The commit ritual

Repeat for each commit of the current MR.

1. **Stage exact content.** Use `git add <paths>` for whole files. Never `git add -A`. For a slim version, write it to a temporary file and stage it without touching the working tree:

   ```bash
   git update-index --add --cacheinfo 100644,"$(git hash-object -w /tmp/slim.ts)",src/file.ts
   ```

2. **Check it on its own.** Run the project's checks through `scripts/check-staged.sh -- <command>`. It sets aside everything unstaged and untracked, runs the command, and restores the tree and index exactly. Fix the staged content and rerun until it passes.
3. **Report.** Show the staged files with a one-line reason each, the check results, and a commit message in the repo's format.
4. **Wait.** The user commits and says "next step". Confirm with `git log --oneline -1` before staging the next commit.

When a later MR changes a file an earlier commit already holds a slim version of, stage the next slim version. Don't stage the full working-tree file early.

## Phase 5: Open the MR

When the current MR's commits are all in:

1. Run the project's final review gates if it defines them (for example reviewers, then CodeRabbit, then SonarQube). Report any the user skips.
2. Capture before and after evidence of what this MR makes visible, with `capture-review-evidence`.
3. Create the MR with `create-merge-request`. Show the description and the commands before running anything. Push to the repo's branch convention.
4. Branch the next MR from this MR's branch, and target this branch until it merges.
5. After a merge, rebase the next MR onto the target branch (`resolve-merge-conflict` if it conflicts), then continue Phase 4.

## Gotchas

- `git stash pop` after a `--keep-index` stash conflicts (`UU`, `AA`) whenever a staged file differs from its working-tree version. That is always true for slim versions. Restore with `scripts/check-staged.sh`, or by hand: `git checkout 'stash@{0}' -- .`, `git checkout 'stash@{0}^3' -- .`, then `git read-tree <saved index tree>`.
- Untracked files live in the stash's third parent (`stash@{0}^3`). A file staged with `git update-index` is tracked, so its working-tree version is in `stash@{0}` itself, not `^3`.
- `git stash create` and `git stash store` leave untracked files out. Use `git stash push --include-untracked` for backups.
- Writing a file into a folder the slim tree lacks fails. Create the folder first, or restore with `git checkout`, which creates folders.
- A slim version must still pass the formatter. Check the staged blob, not the working-tree file.
- Labels and translation tests often assert a key from the full work. Point the slim test at a key the slim labels contain.
- A comment written for the full work can be wrong in a slim version: one that names a component the slice doesn't render. Reread comments in slim files.
- The dev server serves the working tree. Screenshots taken during an isolated check show only the staged slice.
