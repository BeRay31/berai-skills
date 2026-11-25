---
name: create-merge-request
description: Create a GitLab merge request or GitHub pull request from committed changes. Trigger on "create an MR", "open a PR", "make a merge request", "create a pull request", or "push and create review".
metadata:
  requires:
    - skill:repo-info
    - skill:capture-review-evidence
---

# Create a Merge Request or Pull Request

Create a review with a description grounded in the complete diff and verification results.

## Use when

The user asks to create an MR or PR, or push changes and open a review. Use `repo-info` for existing review status, CI, logs, and review lists.

## Prerequisites

```bash
git status --short --branch
git remote -v
```

Select the platform from the review's target remote. Use `glab` for GitLab and `gh` for GitHub. Verify authentication with `glab auth status` or `gh auth status` for that platform.

Confirm the source branch, target branch, and target repository. Invoke `repo-info` to check for an existing review of the source branch before creating one. If a review exists, report it rather than creating a duplicate.

## Procedure

1. Review all changes and commit messages against the target branch. Complete the repository's verification checks. Stage only the intended files, commit them using the repository's conventions, and push the source branch when authorized.

   ```bash
   git diff <target>...HEAD
   git log <target>..HEAD
   git push -u origin HEAD
   ```

2. When the diff changes CLI behavior, a TUI, a frontend, or architecture, invoke `capture-review-evidence`. Keep its artifact paths and description-ready snippets. A documentation-only change needs no runtime screenshots. If the prerequisite skill is unavailable, report the missing dependency and any evidence gap.

3. Read [DESCRIPTION.md](DESCRIPTION.md) and write the title and body. Incorporate the relevant evidence beside the change it demonstrates. Store the body outside the repository with `BODY="$(mktemp)"`. Distinguish completed checks from unverified behavior.

4. Create the review with the chosen platform. Specify the confirmed source and target branches.

   ```bash
   # GitLab
   glab mr create --source-branch <source> --target-branch <target> \
     --title "Title" --description "$(cat "$BODY")" --yes

   # GitHub
   gh pr create --head <source> --base <target> \
     --title "Title" --body-file "$BODY"
   ```

5. Invoke `repo-info` to confirm the review URL, source branch, target branch, and head commit. Report the URL and verification results. Retain evidence until the description contains the required snippets and authorized uploads; then use the cleanup procedure from `capture-review-evidence`.

## Creation options

| Option | GitLab | GitHub |
|---|---|---|
| Draft | `--draft` | `--draft` |
| Reviewer | `--reviewer user` | `--reviewer user` |
| Assignee | `--assignee user` | `--assignee user` |
| Labels | `--label label` | `--label label` |
| Commit-derived body | `--fill` | `--fill` |

Prefer the evidence-based description over `--fill`. GitLab `--fill` also enables pushing. GitHub squash, auto-merge, and branch-deletion options belong to `gh pr merge`, not `gh pr create`; merging is a separate user action.

## Verification

Done when the intended commits are pushed, the review targets the confirmed repository and branch, the body covers the complete diff, and missing evidence or unverified behavior is disclosed.
