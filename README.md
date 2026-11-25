# 909 Labs AI Skills

A collection of skills for coding agents. Each directory has a `SKILL.md` with instructions for a specific task. Skills that need scripts, templates, or reference material keep those files alongside the instructions.

## Install the skills from GitHub

Run these commands from any directory. Agent Marketplace downloads the skills from [909labs/ai-skills on GitHub](https://github.com/909labs/ai-skills). A personal install makes them available across your projects.

### 1. Sign in to GitHub

Install Git and the [GitHub CLI](https://cli.github.com/) (`gh`). Check which GitHub account is active.

```sh
gh auth status --hostname github.com
```

If you need to sign in, use an account with read access to the repository.

```sh
gh auth login --hostname github.com --git-protocol https --web
```

Let Git use that login for HTTPS downloads, then check repository access.

```sh
gh auth setup-git --hostname github.com
gh repo view 909labs/ai-skills
```

Continue when the repository details appear. If access fails, check the active account and ask a repository owner for read access.

### 2. Choose your coding agents

Follow the [Agent Marketplace installation instructions](https://agent-marketplace.io/), then run `agent-marketplace --version` to check the installation. On first use, run the following command and select the coding agents you use. If you have already configured your agents, skip to step 3.

```sh
agent-marketplace init
```

### 3. Install all published skills

List the skills available on the remote `main` branch, install them for your user account, then check the result. Use the HTTPS clone URL ending in `.git` so the download uses the GitHub login from step 1.

```sh
agent-marketplace list --kind skill --from https://github.com/909labs/ai-skills.git --ref main
agent-marketplace install --from https://github.com/909labs/ai-skills.git --ref main --scope user
agent-marketplace status
```

In the status report, look for the skills from `909labs/ai-skills` and the agents you selected. The live list shows what you can install today. The table below describes the skills in this checkout.

### 4. Try a skill

Open a fresh session in one of your selected agents and send this message.

> Use the grill-me skill to help me plan a feature.

The agent should ask one question at a time and give its recommended answer.

## Skills

| Skill | When to use it |
| --- | --- |
| [argus](argus/SKILL.md) | Search code across repositories, trace pull requests and failing pipelines, and look up issues using the read-only `argus` CLI. |
| [grill-me](grill-me/SKILL.md) | Stress-test a plan one decision at a time. The agent checks the codebase for answers before asking the next question. |
| [ponytail](ponytail/SKILL.md) | Before writing code, look for an existing implementation, standard library feature, or smaller change that solves the problem. |
| [receiving-code-review](receiving-code-review/SKILL.md) | Evaluate review comments against the current change, verify fixes, and draft evidence-backed replies. |
| [using-git-worktrees](using-git-worktrees/SKILL.md) | Find or create an isolated checkout for a task and preserve existing branches and local work. |
| [build-frontend-feature](build-frontend-feature/SKILL.md) | Build a web feature from its entry point to the rendered outcome, using the host’s framework, data flow, and design system. |
| [nir-release](nir-release/SKILL.md) | Publish a NiR GitHub Release, verify API migrations when applicable, guide staging testing, and promote the approved version to production. |
| [nir-frontend](nir-frontend/SKILL.md) | Extend the frontend baseline for NIR storefront and staff workflows, including app-specific routing, permissions, and shared `nir-ui` components. Requires `build-frontend-feature`. |
| [build-backend-feature](build-backend-feature/SKILL.md) | Build an endpoint, job, or provider integration in an existing backend. Trace a comparable feature, resolve open decisions, and verify the result through the real entry point and database. |
| [explainer](explainer/SKILL.md) | Turn a technical change or design decision into a standalone interactive HTML presentation. Open Studio to browse and edit existing explainers. |
| [capture-review-evidence](capture-review-evidence/SKILL.md) | Capture the same scenario before and after a CLI, terminal UI, web, or architecture change so reviewers can compare the results. |
| [create-merge-request](create-merge-request/SKILL.md) | Open a GitHub pull request or GitLab merge request with a description based on the diff, review evidence, and verification results. Requires `capture-review-evidence`, the separate `repo-info` skill, and an authenticated `gh` (GitHub) or `glab` (GitLab). |

## Build the explainer example from a local checkout

To try the explainer from the repository root, build the bundled example with Python 3.9 or newer, then open `.explainers/hello-kit-explainer.html` in a browser.

```sh
python3 explainer/assemble.py explainer/reference-sources/hello-kit.html
```
