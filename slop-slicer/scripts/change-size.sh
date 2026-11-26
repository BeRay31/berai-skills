#!/usr/bin/env bash
# Size a change by kind (code, tests, mocks, docs), counting committed, staged, unstaged and untracked work.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: change-size.sh [--base <ref>] [<pathspec>...]

Prints a Markdown table of added and removed lines per kind, comparing the working
tree (including untracked files) with <ref>.

  --base <ref>  Compare against this ref. Default: merge base with origin/HEAD,
                falling back to origin/main.
  -h, --help    Show this help.

Kinds, first match wins:
  Tests   *.test.* *.spec.* *_test.go, or a path with /test/ /tests/ /__tests__/
  Mocks   a path with /mocks/ /mock/ /__mocks__/ /fixtures/ /testdata/
  Docs    *.md *.mdx
  Code    everything else

Example:
  change-size.sh app/plugins/my-plugin
EOF
}

base=""
paths=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --base) base="${2:?--base needs a ref}"; shift 2 ;;
    *) paths+=("$1"); shift ;;
  esac
done
[[ ${#paths[@]} -gt 0 ]] || paths=(.)

cd "$(git rev-parse --show-toplevel)"
if [[ -z "$base" ]]; then
  upstream=$(git rev-parse --abbrev-ref origin/HEAD 2>/dev/null || echo origin/main)
  base=$(git merge-base "$upstream" HEAD)
fi

{
  git diff --numstat "$base" -- "${paths[@]}"
  git ls-files --others --exclude-standard -- "${paths[@]}" | while IFS= read -r f; do
    printf '%s\t0\t%s\n' "$(wc -l < "$f" | tr -d ' ')" "$f"
  done
} | awk -F'\t' -v base="$base" '
  $1 == "-" { next }
  {
    k = "Code"
    if ($3 ~ /\.(test|spec)\.[^\/]+$|_test\.go$|\/(test|tests|__tests__)\//) k = "Tests"
    else if ($3 ~ /\/(mocks?|__mocks__|fixtures|testdata)\//) k = "Mocks"
    else if ($3 ~ /\.mdx?$/) k = "Docs"
    a[k] += $1; d[k] += $2; n[k]++; ta += $1; td += $2; tn++
  }
  END {
    printf "Compared with %s\n\n| Kind | Files | Added | Removed |\n|---|---|---|---|\n", substr(base, 1, 12)
    split("Code Tests Mocks Docs", order, " ")
    for (i = 1; i <= 4; i++) { k = order[i]; if (n[k]) printf "| %s | %d | +%d | -%d |\n", k, n[k], a[k], d[k] }
    printf "| **Total** | **%d** | **+%d** | **-%d** |\n", tn, ta, td
  }'
