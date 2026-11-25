---
name: capture-review-evidence
description: Capture matched before/after evidence for CLI, terminal UI, frontend, or architecture changes. Trigger on "capture review evidence", "before/after screenshots", "demonstrate this behavior change", or requests to add evidence to an existing MR or PR.
metadata:
  requires: []
---

# Capture Review Evidence

Capture reproducible before/after artifacts and description-ready snippets for changed behavior.

## Use when

The user asks to demonstrate a change, prepare evidence for a review, or update an existing review with evidence. Review creation is handled by the caller's selected publication workflow.

## Procedure

```bash
<skill-dir>/scripts/evidence help
<skill-dir>/scripts/evidence -C <repo> init --target <target-branch>
<skill-dir>/scripts/evidence -C <repo> help <command>
```

`<skill-dir>` is the absolute skill directory reported by the skill tool. Every helper invocation starts with that path. Pass `-C <repo>` instead of changing directories. Do not assign the helper path to a shell variable, add environment-variable prefixes, or run it through `bash`. Use `help <command>` for command details instead of reading the helper source.

Classify the diff and choose a shared scenario for each changed behavior, including affected error and edge paths. Run captures from the review checkout. Compare the merge-base worktree with the current checkout using the same inputs, environment, and dimensions. Pass `--setup` only when both trees need the same build or install command.

Inspect every text diff, image, and local cast. Confirm the intended state and remove secrets or personal data before sharing. Render and inspect each Mermaid block. Return the artifact directory, scenario commands, and description-ready snippets. Explain missing evidence and capture limits.

If a tool timeout backgrounds a helper command, wait for its output instead of running it again. Write scenario scripts into `OUT` with the file-write tool, not shell heredocs. Upload and cleanup only when authorized.

## Surfaces

| Changed surface | Reference |
|---|---|
| CLI output, flags, exit codes, errors | [CLI](references/cli.md) |
| Finite terminal behavior | [Terminal GIFs](references/gif.md) |
| Terminal UI | [TUI](references/tui.md) |
| Web frontend | [Frontend](references/web.md) |
| Architecture | [Architecture](references/architecture.md) |
| Checking, uploading, and cleanup | [Images](references/images.md) |
| Managed employee setup | [Setup](references/setup.md) |

## Setup

See [the dated setup and availability note](references/setup.md). If GIF tools are unavailable or the recorder lacks `--cols` or `--rows`, use CLI text or TUI evidence.
