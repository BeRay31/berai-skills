---
name: resolve-merge-conflict
description: Resolve merge conflicts on a GitLab MR using glab CLI — check out the branch, rebase onto the target, resolve conflicts with AI judgment, and push back. Trigger on "resolve merge conflict", "fix conflicted MR", or "unblock MR conflicts".
---

Rebase a conflicted GitLab MR onto its target, resolve conflicts where intent is clear, push back, and post a result comment.

Use when: user provides an MR URL or IID and asks to resolve merge conflicts.

## Requirements

- `glab` installed and authenticated: `glab auth status`

## Workflow

### Step 1 — Fetch MR details

```bash
# By IID (current repo)
glab mr view <iid> --output json

# By full URL
glab mr view <mr-url> --output json
```

Extract `source_branch` and `target_branch` from the output.

### Step 2 — Check out the branch

```bash
glab mr checkout <iid>
```

### Step 3 — Rebase onto target

```bash
git fetch origin <target_branch>
git rebase origin/<target_branch>
```

If the rebase exits cleanly, skip to step 6.

### Step 4 — Identify conflicted files

```bash
git diff --name-only --diff-filter=U
```

### Step 5 — Resolve conflicts

For each conflicted file, inspect the conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`).

Resolve using judgment:
- **Accept ours** — our changes are correct; incoming changes are superseded.
- **Accept theirs** — target branch has the correct version.
- **Merge both** — both sides contribute changes that can coexist.

Stop and post a comment if:
- The conflict involves complex business logic with unclear intent.
- Resolving incorrectly would silently break behaviour.
- Both sides have substantially different implementations of the same thing.

After editing each file:

```bash
git add <file>
GIT_EDITOR=true git rebase --continue
```

Repeat until the rebase completes.

### Step 6 — Push

```bash
git push origin HEAD:<source_branch> --force-with-lease
```

### Step 7 — Post result

On success:

```bash
glab mr note create <iid> --message "Rebased !<iid> onto \`<target_branch>\` and resolved all conflicts.

Files resolved:
- \`<file>\`: <how it was resolved>"
```

If conflicts were too ambiguous:

```bash
glab mr note create <iid> --message "Rebase onto \`<target_branch>\` has conflicts requiring human judgment in:
- \`<file>\`: <why it is ambiguous>

Please resolve manually."
```

## Safety rules

1. Never force-push without `--force-with-lease`.
2. Defer to a human when a conflict is ambiguous.
3. Never commit secrets or sensitive data.
4. Always post a result comment on the MR.
