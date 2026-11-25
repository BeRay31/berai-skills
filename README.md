# 909 Labs AI Skills

A collection of skills for coding agents. Each directory has a `SKILL.md` with instructions for a specific task. Skills that need scripts, templates, or reference material keep those files alongside the instructions.

## Skills

| Skill | When to use it |
| --- | --- |
| [argus](argus/SKILL.md) | Search code across repositories, trace pull requests and failing pipelines, and look up issues using the read-only `argus` CLI. |
| [grill-me](grill-me/SKILL.md) | Stress-test a plan one decision at a time. The agent checks the codebase for answers before asking the next question. |
| [ponytail](ponytail/SKILL.md) | Before writing code, look for an existing implementation, standard library feature, or smaller change that solves the problem. |
| [receiving-code-review](receiving-code-review/SKILL.md) | Evaluate review comments against the current change, verify fixes, and draft evidence-backed replies. |
| [using-git-worktrees](using-git-worktrees/SKILL.md) | Find or create an isolated checkout for a task and preserve existing branches and local work. |
| [build-frontend-feature](build-frontend-feature/SKILL.md) | Build a web feature from its entry point to the rendered outcome, using the host’s framework, data flow, and design system. |
| [nir-frontend](nir-frontend/SKILL.md) | Extend the frontend baseline for NIR storefront and staff workflows, including app-specific routing, permissions, and shared `nir-ui` components. Requires `build-frontend-feature`. |
| [build-backend-feature](build-backend-feature/SKILL.md) | Build an endpoint, job, or provider integration in an existing backend. Trace a comparable feature, resolve open decisions, and verify the result through the real entry point and database. |
| [explainer](explainer/SKILL.md) | Turn a technical change or design decision into a standalone interactive HTML presentation. Open Studio to browse and edit existing explainers. |
| [capture-review-evidence](capture-review-evidence/SKILL.md) | Capture the same scenario before and after a CLI, terminal UI, web, or architecture change so reviewers can compare the results. |
| [create-merge-request](create-merge-request/SKILL.md) | Open a GitHub pull request or GitLab merge request with a description based on the diff, review evidence, and verification results. |

## Getting started

Choose a skill from the table and follow its instructions. When copying a skill into your agent’s skills directory, copy the whole folder so its relative paths still work. The merge request workflow also requires the separate `repo-info` skill and an authenticated `gh` or `glab` CLI.

## Build the explainer example from a local checkout

To try the explainer from the repository root, build the bundled example with Python 3.9 or newer, then open `.explainers/hello-kit-explainer.html` in a browser.

```sh
python3 explainer/assemble.py explainer/reference-sources/hello-kit.html
```
