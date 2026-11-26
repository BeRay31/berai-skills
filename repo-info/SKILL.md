---
name: repo-info
description: Inspect GitLab or GitHub review status, CI pipelines or workflow runs, failed jobs, logs, and review lists. Trigger on "MR status", "PR status", "check CI", "find failed jobs", "show job logs", or "list open reviews".
metadata:
  requires: []
---

# Repository Information

Inspect reviews and CI on GitLab or GitHub using the platform's authenticated CLI.

## Use when

The user asks for existing review details, mergeability, pipeline or workflow status, job logs, or review lists. Use `create-merge-request` to create a review.

## Platform and authentication

```bash
git remote -v
# GitLab
glab auth status
# GitHub
gh auth status
```

Identify the requested repository and select its platform. Run only that platform's authentication check. Confirm the GitLab namespace/project or GitHub owner/repo from the remote. When outside a checkout, use the explicit repository identifier supplied by the user.

## Review status

```bash
# Current branch review
# GitLab
glab mr view
# GitHub
gh pr view

# Specific review: state, mergeability, source, target, and head commit
# GitLab
glab mr view <iid> --output json --jq '{iid, state, detailed_merge_status, source_branch, target_branch, sha, web_url, head_pipeline}'
# GitHub
gh pr view <number> --json number,state,mergeable,headRefName,baseRefName,headRefOid,url,statusCheckRollup
```

Use `--repo <namespace/project>` with `glab` or `--repo <owner/repo>` with `gh` when the checkout does not identify the requested repository. Report unknown or pending mergeability as unknown or pending.

## GitLab pipelines and logs

```bash
# Pipeline associated with the review's current head
glab mr view <iid> --output json --jq '{sha, pipeline: .head_pipeline}'

# Jobs for a known pipeline, then a specific job's trace
glab api 'projects/:id/pipelines/<pipeline-id>/jobs' --paginate \
  | jq -r '.[] | "\(.id) \(.name) \(.status)"'
glab api 'projects/:id/jobs/<job-id>/trace'
```

Use the failed-job helper to traverse parent and child pipelines:

```bash
bash <this skill's directory>/scripts/find_failed_jobs_for_mr.sh <iid>
glab ci trace <job-id> | tail -n 1000
```

Run the helper from the requested repository's checkout. A trace tail is partial output; fetch the full trace when the failure is outside that window. Inspect logs locally and redact credentials or personal data before sharing them.

When the branch has no MR, query branch pipelines directly. Replace both placeholders with the confirmed project path and branch; `first: 3` is a recent sample, not complete history.

```bash
glab api graphql -f query='
query {
  project(fullPath: "PROJECT_PATH") {
    pipelines(ref: "BRANCH_NAME", first: 3) {
      nodes {
        id
        status
        createdAt
        jobs(first: 20) { nodes { name status } }
      }
    }
  }
}'
```

The embedded job list is capped at 20. Use the paginated jobs endpoint for a complete pipeline job list. A null project indicates a wrong path or unavailable access, not an empty pipeline history.

## GitHub workflow runs and logs

```bash
# Review checks and exact head commit
gh pr view <number> --json headRefOid,headRefName,statusCheckRollup

# Recent runs for that exact head, not a newer branch commit
gh run list --commit <head-sha> --limit 10 \
  --json databaseId,headSha,name,status,conclusion,url

# Run details and job logs
gh run view <run-id>
gh run view <run-id> --log-failed
gh run view --job <job-id> --log

# Checks reported for the head commit
gh api 'repos/{owner}/{repo}/commits/<head-sha>/check-runs' --paginate \
  --jq '.check_runs[] | {name, status, conclusion}'
```

For a branch without a PR, use `gh run list --branch <branch> --limit 10`. A limited run list is a recent sample. Workflow runs and commit checks are different views; report which one the result covers.

## Open reviews

```bash
# Open reviews for an author; open is the default
# GitLab
glab mr list --author=<username> --output=json
# GitHub
gh pr list --author=<username> --limit 30 \
  --json number,title,url,headRefName

# Filter by label
# GitLab
glab mr list --author=<username> --label="ready,review" --output=json
# GitHub
gh pr list --author=<username> --label="ready,review" \
  --json number,title,url
```

Outside a checkout, supply `--repo` or use the authenticated API for the intended scope:

```bash
# Current user's open GitLab MRs across projects
glab api 'merge_requests?state=opened&scope=created_by_me' --paginate
# Open GitHub PRs by author in a specified repository
gh api -X GET search/issues \
  -f q='repo:<owner>/<repo> is:pr is:open author:<username>' --paginate
```

State list limits and paginate when the user requests a complete list.

## Troubleshooting

- For GitLab MR details, use `--output json --jq`, not GitHub's `--json` or template flags.
- GitLab MR lists use `--output=json`; use `--closed` or `--merged` for those states rather than `--state=opened`.
- GitHub JSON commands require explicit field names after `--json`.
- Empty REST pipeline results do not prove no pipeline exists. Check the confirmed branch through GraphQL and distinguish permission or API errors from empty results.
- GitLab REST project placeholders accept a numeric project ID or a URL-encoded namespace/project. The `:id` shorthand resolves from the repository context.
- Stop on authentication failures and request authentication rather than changing credentials or hosts.

## Verification

Done when the result identifies the repository, review or branch, and relevant head commit or pipeline/run ID. Distinguish completed, pending, failed, missing, and inaccessible data; disclose truncated lists and logs.
