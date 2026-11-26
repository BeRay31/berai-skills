#!/usr/bin/env bash
# Run checks against the staged snapshot only, then restore the working tree exactly.
# Avoids `git stash pop`, which conflicts whenever a staged file differs from its working-tree version.
set -uo pipefail

usage() {
  cat <<'EOF'
Usage: check-staged.sh [--dry-run] -- <command> [args...]

Sets aside every unstaged change and untracked file, runs <command> against the
staged snapshot, then restores the working tree and the index exactly as they were.

  --dry-run   Show what would be set aside, run nothing.
  -h, --help  Show this help.

The command runs from the repository root. Its exit code is this script's exit code.
If the restore cannot be verified, the stash is kept and the steps to finish by hand
are printed. Nothing is ever dropped unless the restore matches.

Example:
  check-staged.sh -- bash -c 'cd app && yarn tsc && yarn test --watchAll=false'
EOF
}

dry_run=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --dry-run) dry_run=true; shift ;;
    --) shift; break ;;
    *) echo "error: unexpected argument '$1'; put the check command after --" >&2; usage >&2; exit 2 ;;
  esac
done
[[ $# -gt 0 || "$dry_run" == true ]] || { echo "error: no command given after --" >&2; exit 2; }

root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "error: not inside a git repository" >&2; exit 2; }
cd "$root" || exit 2

if [[ -n "$(git diff --name-only --diff-filter=U)" ]]; then
  echo "error: the index has unmerged paths; resolve them first" >&2; exit 2
fi
if git diff --cached --quiet; then
  echo "error: nothing is staged" >&2; exit 2
fi
if git stash list | grep -q 'slop-slicer: isolated check'; then
  echo "error: a previous 'slop-slicer: isolated check' stash exists; restore or drop it first" >&2; exit 2
fi

unstaged=$(git diff --name-only)
untracked=$(git ls-files --others --exclude-standard)
echo "staged:" >&2; git diff --cached --stat >&2
if [[ "$dry_run" == true ]]; then
  echo "would set aside (unstaged):" >&2; printf '  %s\n' $unstaged >&2
  echo "would set aside (untracked):" >&2; printf '  %s\n' $untracked >&2
  exit 0
fi

index_tree=$(git write-tree)
stashed=false
if [[ -n "$unstaged" || -n "$untracked" ]]; then
  git stash push --keep-index --include-untracked --quiet -m "slop-slicer: isolated check" || {
    echo "error: git stash failed; nothing was changed" >&2; exit 2; }
  stashed=true
fi

echo "running: $*" >&2
"$@"
status=$?
echo "check exit code: $status" >&2

[[ "$stashed" == true ]] || exit "$status"

ref='stash@{0}'
# Tracked files as they were in the working tree (this also writes them to the index)
git checkout "$ref" -- . 2>/dev/null
# Files deleted in the working tree but kept in the index come back from --keep-index; delete them again
while IFS= read -r f; do [[ -n "$f" ]] && rm -f -- "$f"; done \
  < <(git diff --name-only --diff-filter=D "$ref^2" "$ref")
# Untracked files, with their modes
if git rev-parse --verify --quiet "$ref^3" >/dev/null; then
  git checkout "$ref^3" -- . 2>/dev/null
fi
git read-tree "$index_tree"

ok=true
git diff --quiet "$ref" -- . || ok=false
if git rev-parse --verify --quiet "$ref^3" >/dev/null; then
  while IFS= read -r f; do
    cmp -s -- "$f" <(git show "$ref^3:$f") || { echo "restore mismatch: $f" >&2; ok=false; }
  done < <(git ls-tree -r --name-only "$ref^3")
fi
[[ "$(git write-tree)" == "$index_tree" ]] || { echo "restore mismatch: index" >&2; ok=false; }

if [[ "$ok" == true ]]; then
  git stash drop --quiet "$ref"
  echo "restored working tree and index" >&2
else
  cat >&2 <<EOF
error: the restore did not match; the stash '$ref' is kept.
Finish by hand:
  git checkout '$ref' -- .
  git checkout '$ref^3' -- .      # untracked files, if any
  git read-tree $index_tree        # the staged snapshot
  git stash drop '$ref'           # only after checking
EOF
  exit 3
fi
exit "$status"
