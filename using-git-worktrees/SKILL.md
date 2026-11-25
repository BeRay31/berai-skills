---
name: using-git-worktrees
description: Set up, locate, verify, or retire an isolated Git checkout for feature work. Use for parallel branches or when a task needs a clean starting commit while another checkout has work in progress.
---

# Use a Git worktree

## Locate the checkout

Run from the target repository. The following commands identify the checkout root, its private Git directory and common Git directory, the registered paths and branches, and local changes.

```sh
git rev-parse --show-toplevel
git rev-parse --path-format=absolute --git-dir --git-common-dir
git worktree list --porcelain
git status --short --branch --untracked-files=all
```

Match the root to its worktree record. A linked checkout has separate private and common Git directories. A `detached` record identifies a checkout by commit. If the intended branch is already registered, inspect that checkout’s status and HEAD. Reuse it when it belongs to this task. If another task owns it, select a distinct branch from the intended base. Preserve dirty tracked files, staged edits, and untracked files in their original checkout. A new worktree starts with committed files; if the request depends on local edits, settle how to include those changes with the owner.

## Create and verify

Use the host’s worktree facility when it manages workspace creation. For plain Git, choose an unused destination consistent with the repository layout. Prefer a sibling directory when an in-repo location would be unignored. For a new branch, resolve the agreed base to a commit before creating it. Set `base_ref`, `branch`, and `destination` to the intended values for this task.

```sh
base_commit=$(git rev-parse --verify --end-of-options "${base_ref}^{commit}") &&
  git worktree add -b "$branch" "$destination" "$base_commit"
```

For an existing branch with no registered checkout, record its tip and use `git worktree add "$destination" "$branch"`. If Git reports a collision, re-read the registrations, including locked or prunable records, and inspect the destination. Reuse an appropriate checkout or choose a free path or branch. Leave force, branch resets, and removal out of collision handling.

```sh
git -C "$destination" rev-parse --show-toplevel
git -C "$destination" branch --show-current
git -C "$destination" rev-parse --verify HEAD
git -C "$destination" status --short --branch --untracked-files=all
```

Compare path and branch with the intended checkout. For a fresh checkout, compare HEAD with the captured base or existing branch tip. For reuse, account for commits and edits already present. Run project setup and relevant baseline checks from that directory when the task needs them. Report the path, branch or detached HEAD, and starting commit.

## Retire an authorized checkout

From a different checkout, re-read its registration and inspect its HEAD, branch, status, and any ignored local files worth preserving. Confirm that commits remain reachable from a retained ref, especially for detached work. Preserve or hand off local work before cleanup. For an ordinary clean linked checkout approved for removal, use `git worktree remove "$destination"` and verify its registration disappeared. Branch deletion is a separate action. Use the owning platform's lifecycle controls for a managed checkout.
