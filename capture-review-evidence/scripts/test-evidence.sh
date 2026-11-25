#!/usr/bin/env bash
# End-to-end test for scripts/evidence on a disposable repository with a
# before/after change to a CLI, a curses TUI, a static web page, and a
# Mermaid body. Uploads run with --dry-run only. Set EVIDENCE_TEST_KEEP=<dir>
# to copy the captured images and Markdown there for inspection.
# shellcheck disable=SC2016 # Backticks and $0/$1 in bash -c are literal on purpose.
set -euo pipefail

EVIDENCE="$(cd "$(dirname "$0")" && pwd)/evidence"
SKILL_DIR="$(cd "$(dirname "$EVIDENCE")/.." && pwd)"
WORK="$(mktemp -d)"
trap '(cd "$WORK/repo" 2>/dev/null && "$EVIDENCE" cleanup >/dev/null 2>&1); rm -rf "$WORK"' EXIT
FAILED=0

# shellcheck disable=SC2329 # Called through check.
contains_all() {
    local file="$1" needle
    shift
    for needle in "$@"; do grep -Fq -- "$needle" "$file" || return 1; done
}
check() {  # check <description> <command...>
    local what="$1"; shift
    if "$@" >/dev/null 2>&1; then echo "ok   $what"; else echo "FAIL $what"; FAILED=1; fi
}
png_width() { python3 -c 'import struct, sys; print(struct.unpack(">I", open(sys.argv[1], "rb").read()[16:20])[0])' "$1"; }
# shellcheck disable=SC2329 # Called through check.
same_width() { [ "$(png_width "$1")" = "$(png_width "$2")" ]; }
commit() { git -c user.email=test@example.com -c user.name=test commit --quiet -am "$1"; }

mkdir -p "$WORK/help"
for topic in cli gif tui web; do
    (cd "$WORK" && "$EVIDENCE" help "$topic") >"$WORK/help/$topic.txt"
done
(cd "$WORK" && "$EVIDENCE" help) >"$WORK/help/overview.txt"
check "help works outside a git repository" test -s "$WORK/help/overview.txt"
check "cli help names output files" contains_all "$WORK/help/cli.txt" NAME.md NAME.before.txt NAME.after.txt
check "gif help names output files" contains_all "$WORK/help/gif.txt" NAME.before.cast NAME.after.cast NAME.before.gif NAME.after.gif
check "tui help names output files" contains_all "$WORK/help/tui.txt" NAME.before.png NAME.after.png
check "web help names output files" contains_all "$WORK/help/web.txt" NAME.before.png NAME.after.png
for topic in cli gif tui web; do
    check "$topic help documents environment, waits, and exit status" contains_all "$WORK/help/$topic.txt" "Pinned" "Wait:" "Exit status"
done
check "overview documents OUT, paths, -C, and exit codes" contains_all "$WORK/help/overview.txt" OUT paths '-C <repo>' 'Exit codes'
check "skill says to wait on backgrounded commands" grep -Fq "wait for its output instead of running it again" "$SKILL_DIR/SKILL.md"
check "skill uses the file-write tool for scenario scripts" grep -Fq 'Write scenario scripts into `OUT` with the file-write tool, not shell heredocs.' "$SKILL_DIR/SKILL.md"

check_docs() {
    python3 - "$SKILL_DIR" <<'PY'
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
files = [root / "SKILL.md", *sorted((root / "references").glob("*.md"))]
failed = False
if not (root / "references" / "cli.md").is_file():
    print("missing reference: references/cli.md")
    failed = True

invocation = re.compile(
    r"\S*scripts/evidence|\$\{?EV\}?|\bEV\s*=|"
    r"(?:^|\s)evidence\s+(?:help|init|cli|gif|tui|web|mermaid|upload|paths|cleanup)\b"
)
forbidden = {
    "cd before helper": re.compile(r"\bcd\b[^\n]*&&[^\n]*(?:scripts/evidence|\$EV|\bevidence\s+)"),
    "EV variable": re.compile(r"\bEV\s*=|\$\{?EV\}?"),
    "environment prefix": re.compile(
        r"(?:^|\s)(?:[A-Z_][A-Z0-9_]*=(?:\"[^\"]*\"|'[^']*'|[^\s]+)\s+)+"
        r"(?:\S*/)?evidence\b"
    ),
    "bash helper": re.compile(r"\bbash\s+\S*evidence\b"),
}
for path in files:
    in_code = False
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        stripped = line.lstrip()
        if stripped.startswith("```"):
            in_code = not in_code
            continue
        if not invocation.search(line):
            continue
        for label, pattern in forbidden.items():
            if pattern.search(line):
                print(f"{path.relative_to(root)}:{number}: {label}: {line}")
                failed = True
        if in_code and not stripped.startswith("<skill-dir>/scripts/evidence"):
            print(f"{path.relative_to(root)}:{number}: code invocation must start with "
                  f"<skill-dir>/scripts/evidence: {line}")
            failed = True
if failed:
    raise SystemExit(1)
PY
}
if check_docs >"$WORK/docs-check.txt" 2>&1; then
    echo "ok   docs use one absolute invocation form"
else
    cat "$WORK/docs-check.txt"
    echo "FAIL docs use one absolute invocation form"
    FAILED=1
fi
if [ -f "$SKILL_DIR/references/cli.md" ]; then
    check "SKILL.md and CLI reference fit 4000 bytes" bash -c \
        '[ "$(( $(wc -c <"$1") + $(wc -c <"$2") ))" -le 4000 ]' _ \
        "$SKILL_DIR/SKILL.md" "$SKILL_DIR/references/cli.md"
else
    echo "FAIL SKILL.md and CLI reference fit 4000 bytes"
    FAILED=1
fi

git init --quiet --bare -b main "$WORK/origin.git"
git clone --quiet "$WORK/origin.git" "$WORK/repo" 2>/dev/null
cd "$WORK/repo"
cat >tool.py <<'EOF'
import curses, os, sys
ITEMS = ["alpha", "beta", "gamma"]
TITLE = "Pick one:"
def menu(s):
    curses.curs_set(0); i = 0
    while True:
        s.erase(); s.addstr(0, 0, TITLE, curses.A_BOLD)
        for n, it in enumerate(ITEMS):
            s.addstr(n + 2, 2, ("> " if n == i else "  ") + it, curses.A_REVERSE if n == i else 0)
        s.refresh(); k = s.getch()
        if k == curses.KEY_DOWN: i = min(i + 1, len(ITEMS) - 1)
        elif k == curses.KEY_UP: i = max(i - 1, 0)
cmd = sys.argv[1:]
if cmd == ["greet"]: print("hello"); sys.exit(0)
if cmd == ["where"]: print(os.getcwd()); sys.exit(0)
if cmd == ["menu"]: curses.wrapper(menu)
print("error: unknown command", file=sys.stderr); sys.exit(2)
EOF
echo '<html><body><h1 id="t">Dashboard</h1><button>Save</button></body></html>' >index.html
git add . && commit before
git push --quiet origin main 2>/dev/null
git remote set-head origin --auto >/dev/null
git checkout --quiet -b feature
perl -0pi -e 's/print\("hello"\)/print("hello, world")/; s/"gamma"\]/"gamma", "delta"]/; s/Pick one:/Pick a letter:/;
    s/(print\("error)/if cmd == ["bye"]: print("bye"); sys.exit(0)\n$1/' tool.py
echo '<html><body style="background:#eef"><h1 id="t">Dashboard</h1><p>3 alerts</p><button>Save</button></body></html>' >index.html
commit after

"$EVIDENCE" init --setup 'test -f tool.py' >"$WORK/init.txt" 2>"$WORK/init.err"
OUT="$(sed -n 's/^OUT=//p' "$WORK/init.txt")"
BEFORE="$(sed -n 's/^BEFORE=//p' "$WORK/init.txt")"
BASE="$(git rev-parse main)"
check "init detects origin/main as the base" grep -q 'merge-base with origin/main' "$WORK/init.txt"
check "init creates the before worktree at the base" test "$(git -C "$BEFORE" rev-parse HEAD)" = "$(git rev-parse main)"
check "init setup prints a before-side finish time" grep -Eq '^evidence: \[before\] setup finished in [0-9]+s$' "$WORK/init.err"
check "init setup prints an after-side finish time" grep -Eq '^evidence: \[after\] setup finished in [0-9]+s$' "$WORK/init.err"
WORKTREE_COUNT="$(git worktree list | wc -l | tr -d ' ')"
"$EVIDENCE" init >"$WORK/reinit.txt" 2>"$WORK/reinit.err"
check "second init reports the reused worktree" grep -Fxq "evidence: reusing before worktree $BEFORE at $BASE" "$WORK/reinit.err"
check "second init does not add a worktree" test "$(git worktree list | wc -l | tr -d ' ')" = "$WORKTREE_COUNT"
check "init is idempotent" "$EVIDENCE" init
check "re-init keeps the same worktree" grep -q "BEFORE=$BEFORE" <("$EVIDENCE" paths)
check "global -C paths works outside the checkout" bash -c \
    'cd "$1" && "$2" -C "$3" paths >"$4" && cmp -s "$5" "$4"' _ \
    "$WORK" "$EVIDENCE" "$WORK/repo" "$WORK/c-paths.txt" "$WORK/init.txt"
if "$EVIDENCE" -C "$WORK/missing-repository" paths >"$WORK/bad-c.out" 2>"$WORK/bad-c.err"; then
    echo "FAIL -C rejects a missing directory"
    FAILED=1
else
    check "-C names a missing directory" grep -Fq "$WORK/missing-repository" "$WORK/bad-c.err"
fi

"$EVIDENCE" cli greet -- python3 tool.py greet >/dev/null
"$EVIDENCE" cli bye -- python3 tool.py bye >/dev/null
"$EVIDENCE" cli where -- python3 tool.py where >/dev/null 2>"$WORK/where.err"
check "cli diff shows the changed line" grep -qx -- '+hello, world' "$OUT/greet.md"
check "cli diff shows the new command's exit codes" grep -qx -- '-exit 2' "$OUT/bye.md"
check "cli puts the command line above the diff" grep -qx '`python3 tool.py bye`' "$OUT/bye.md"
check "cli replaces tree paths with <repo>" grep -qx '<repo>' "$OUT/where.after.txt"
check "cli reports unchanged output" grep -q 'Output is unchanged' "$OUT/where.md"
check "cli warns about unchanged output" grep -q 'identical' "$WORK/where.err"

"$EVIDENCE" tui greet -- python3 tool.py greet >/dev/null
"$EVIDENCE" tui menu --keys "Down Down Down" -- python3 tool.py menu >/dev/null
check "tui writes the non-interactive pair" test -s "$OUT/greet.before.png" -a -s "$OUT/greet.after.png"
check "tui writes the interactive pair" test -s "$OUT/menu.before.png" -a -s "$OUT/menu.after.png"
check "tui pair has equal widths" same_width "$OUT/menu.before.png" "$OUT/menu.after.png"
check "tui leaves no tmux server running" bash -c '! tmux -L create-review-evidence has-session 2>/dev/null'

"$EVIDENCE" web home --serve 'exec python3 -m http.server {port} --bind 127.0.0.1' --selector '#t' >/dev/null
check "web writes the pair" test -s "$OUT/home.before.png" -a -s "$OUT/home.after.png"
check "web pair has the viewport width" test "$(png_width "$OUT/home.after.png")" = 1280
check "web stops the server" bash -c '! pgrep -f "http.server .* --bind 127.0.0.1" >/dev/null'

cat >"$WORK/body.md" <<'EOF'
```mermaid
flowchart LR
  cli[CLI] --> sync[sync.Run]
```

```mermaid
flowchart LR
  cli[CLI] --> plan[sync.Plan] --> apply[sync.Apply]
```
EOF
printf '```mermaid\nflowchart LR\n  a --> \n```\n' >"$WORK/broken.md"
"$EVIDENCE" mermaid "$WORK/body.md" >/dev/null
check "mermaid renders every block" test -s "$OUT/mermaid-1.png" -a -s "$OUT/mermaid-2.png"
check "mermaid fails on a broken block" bash -c '! "$0" mermaid "$1"' "$EVIDENCE" "$WORK/broken.md"

"$EVIDENCE" upload --dry-run menu home >"$WORK/table.md"
check "upload prints a Before | After table" grep -qx '| Before | After |' "$WORK/table.md"
check "upload prints one row per pair" test "$(grep -c '^| !\[' "$WORK/table.md")" = 2
check "upload rejects unknown names" bash -c '! "$0" upload --dry-run missing' "$EVIDENCE"

[ -z "${EVIDENCE_TEST_KEEP:-}" ] || cp "$OUT"/*.png "$OUT"/*.md "$EVIDENCE_TEST_KEEP"/
"$EVIDENCE" cleanup >/dev/null
check "cleanup removes the before worktree" test ! -e "$BEFORE"
check "cleanup removes the captures" test ! -e "$OUT"
check "cleanup unregisters the worktree" test "$(git worktree list | wc -l | tr -d ' ')" = 1

[ "$FAILED" = 0 ] && echo "all evidence checks passed"
exit "$FAILED"
