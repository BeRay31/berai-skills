# Usage Recipes

Full command surface and per-provider examples. Read this when you need a flag or a less-common command. For trigger and loop, see `SKILL.md`.

## Preflight

```bash
argus config path
argus config list
argus config show <remote-name>
```

If the config lives elsewhere, set `ARGUS_CONFIG=/path/to/config.yaml`. Run
`argus config init` or `argus config edit` for guided remote setup and secure
token storage. `argus config show <remote-name>` shows persisted fields only.
At runtime argus checks a configured `token_env` env var and secure-store entry
first, then implicit provider env vars where supported (`GITHUB_TOKEN`,
`GITLAB_TOKEN`, `YOUTRACK_TOKEN`), then provider auth where supported:
host-scoped `gh auth token` for GitHub, host-scoped `glab config get token` for
GitLab, and Azure DefaultAzureCredential / `az login` for Azure DevOps.

## Discovery

```bash
argus <azdo-remote-name> orgs
argus <github-remote-name> orgs
argus <gitlab-remote-name> groups --grep "^platform" --take 25
argus <azdo-remote-name> repos
argus <azdo-remote-name> repos <project>
argus <github-remote-name> repos
argus <gitlab-remote-name> repos --grep "^platform/" --take 25
argus <gitlab-remote-name> repos <group> --skip 25 --take 25
```

GitLab `repos`/`groups` default to `--take 50`, support `--grep`/`--skip`, cap at `--take 500`, and surface a truncation notice when results overflow.

## Code Search

```bash
argus code search "<query>" --take 30
argus <azdo-remote-name> code search "<query>" --project <project> --repo <repo>
argus <github-remote-name> code search "<query>" --repo <repo>
argus <gitlab-remote-name> code search "<query>" --repo <group/project>
```

Global `argus code search` targets every enabled remote and rejects `--project` or `--repo`.

## Code Grep

```bash
argus <azdo-remote-name> code grep <project> <repo> ".*" --output-mode files_with_matches --path <dir>
argus <github-remote-name> code grep <repo> ".*" --output-mode files_with_matches --path <dir>
argus <gitlab-remote-name> code grep <group/project> ".*" --output-mode files_with_matches --path <dir>

argus <azdo-remote-name> code grep <project> <repo> "<regex>" --path <path> --glob "<glob>" --context-lines 2
argus <github-remote-name> code grep <repo> "<regex>" --path <path> --glob "<glob>" --context-lines 2
argus <gitlab-remote-name> code grep <group/project> "<regex>" --path <path> --glob "<glob>" --context-lines 2
```

All grep variants also accept `--branch`, `--from-line`/`--to-line`, `--reverse`, `--case-sensitive`, and `--no-clone` (skip local clone and fetch via provider APIs — good for one-off scans across many repos). `--output-mode` is one of `content` (default), `files_with_matches`, or `count`.

## Pull Requests / Merge Requests

```bash
argus prs search "<query>" --status active --exclude-drafts
argus <azdo-remote-name> prs search "<query>" --project <project> --repo <repo> --status active
argus <github-remote-name> prs search "<query>" --repo <repo> --creator <user>
argus <gitlab-remote-name> prs search "<query>" --repo <group/project> --date-from 2025-01-01

argus <azdo-remote-name> prs list <project> <repo> --status active,completed --take 25
argus <github-remote-name> prs list <repo> --status active,completed
argus <gitlab-remote-name> prs list <group/project> --status active,completed

argus <azdo-remote-name> prs get <project> <repo> <id>
argus <github-remote-name> prs get <repo> <id>
argus <gitlab-remote-name> prs get <group/project> <id>

argus <azdo-remote-name> prs threads <project> <repo> <id>
argus <github-remote-name> prs threads <repo> <id>
argus <gitlab-remote-name> prs threads <group/project> <id>
```

`prs search`/`prs list` accept `--status active|completed|abandoned`, `--creator`, `--date-from`, `--date-to`, `--skip`, `--take`, `--exclude-drafts`, and `--include-labels`.

## Pipelines

```bash
# List the pipeline plus any downstream pipelines.
# GitLab traverses child pipelines via /bridges; GitHub and Azure DevOps return only the root.
argus <azdo-remote-name> pipelines list <project> <id>
argus <github-remote-name> pipelines list <repo> <id>
argus <gitlab-remote-name> pipelines list <group/project> <id>

# Filter downstream pipelines.
argus <gitlab-remote-name> pipelines list <group/project> <id> --status failed,running
argus <gitlab-remote-name> pipelines list <group/project> <id> --grep "^checkout" --max-depth 2
argus <gitlab-remote-name> pipelines list <group/project> <id> --skip 20 --take 50
```

`pipelines list` accepts:

- `--grep <regex>` — case-insensitive regex matched against the combined `project`, `name`, `ref`, `status`, and `source` fields.
- `--status <csv>` — comma-separated list of `created, waiting_for_resource, preparing, pending, running, success, failed, canceled, skipped, manual, scheduled`.
- `--skip`, `--take` — pagination. Default take is 20, capped at 500.
- `--max-depth` (gitlab only, default 0 = unlimited)

Output is a token-optimised DAG: one `@` line per pipeline, then `#stage` headers and `*job` lines with inline `<needs` and `>> downstream` markers. Full grammar lives in `references/pipelines-format.md`. The payload closes with `returned_count` / `total_count`; truncation is signalled via `partial: true` + a warning line and `EXIT_PARTIAL`. `has_more` is intentionally omitted.

## Pipeline Logs

```bash
argus <azdo-remote-name> pipelines grep <project> <id> "ERROR|Exception" --output-mode logs_with_matches
argus <github-remote-name> pipelines grep <repo> <id> "ERROR|Exception"
argus <gitlab-remote-name> pipelines grep <group/project> <id> "ERROR|Exception"
argus <azdo-remote-name> pipelines grep <project> <id> ".*" --log-id <log_id> --from-line <n>

# Error analysis: show the newest hits first so truncation drops older ones.
argus <github-remote-name> pipelines grep <repo> <id> "error|Exception|Traceback" --reverse
```

`<id>` is the pipeline, run, or build ID — not a job or log ID. To drill into one job, call `pipelines list` to find the pipeline ID first, then use `--log-id <job-or-log-id>` on `pipelines grep`.

## Stories / Issues

```bash
argus <azdo-remote-name> stories get <project> <id>
argus <github-remote-name> stories get <repo> <id>
argus <gitlab-remote-name> stories get <group/project> <id>
argus <youtrack-remote-name> stories get <issue-id>

argus <azdo-remote-name> stories search <project> --query "<text>" --state <state> --type <type>
argus <github-remote-name> stories search <repo> --query "<text>"
argus <gitlab-remote-name> stories search <group/project> --query "<text>"
argus <youtrack-remote-name> stories search --query "<text>" --state <name> --type <name> --assigned-to <user>

argus <azdo-remote-name> stories mine <project>
argus <github-remote-name> stories mine <repo>
argus <gitlab-remote-name> stories mine <group/project>
argus <youtrack-remote-name> stories mine --include-closed
```

`stories search` accepts `--area` (not on YouTrack), `--type`, `--state`, `--assigned-to`, `--skip`, `--take`.

## Output, Parallelism, and Cache

```bash
argus code search "<query>" --format json
argus <github-remote-name> code grep <repo> "<regex>" --format json
argus cache clean --remote <remote-name>   # or --remote all

export GITHUB_GREP_ENABLE_PARALLEL=true
export GITHUB_GREP_MAX_WORKERS=8
```

If rate-limited or slow, lower `GITHUB_GREP_MAX_WORKERS` or unset `GITHUB_GREP_ENABLE_PARALLEL`.
