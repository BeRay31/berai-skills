# 909 Labs AI Skills

A collection of skills for coding agents. Each directory has a `SKILL.md` with instructions for a specific task. Skills that need scripts, templates, or reference material keep those files alongside the instructions.

## Skills

| Skill | When to use it |
| --- | --- |
| [grill-me](grill-me/SKILL.md) | Stress-test a plan one decision at a time. The agent checks the codebase for answers before asking the next question. |
| [ponytail](ponytail/SKILL.md) | Before writing code, look for an existing implementation, standard library feature, or smaller change that solves the problem. |
| [frontend-design](frontend-design/SKILL.md) | Build or style a web interface with deliberate choices about typography, layout, color, and motion. |
| [explainer](harness/SKILL.md) | Turn a technical change or design decision into a standalone interactive HTML presentation. Open Studio to browse and edit existing explainers. |
| [capture-review-evidence](capture-review-evidence/SKILL.md) | Capture the same scenario before and after a CLI, terminal UI, web, or architecture change so reviewers can compare the results. |
| [create-merge-request](create-merge-request/SKILL.md) | Open a GitHub pull request or GitLab merge request with a description based on the diff, review evidence, and verification results. |

## Getting started

Choose a skill from the table and follow its instructions. When copying a skill into your agent’s skills directory, copy the whole folder so its relative paths still work. The `harness/` folder declares its skill name as `explainer`. The merge request workflow also requires the separate `repo-info` skill and an authenticated `gh` or `glab` CLI.

To try the explainer from the repository root, build the bundled example with Python 3.9 or newer, then open the output file in a browser.

```sh
python3 harness/assemble.py harness/reference-sources/hello-kit.html --out /tmp/hello-kit-explainer.html
```
