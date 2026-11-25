#!/usr/bin/env bash
# shellcheck disable=SC2016 # Child-shell text and literal arguments are intentional.
set -euo pipefail

EVIDENCE="$(cd "$(dirname "$0")" && pwd)/evidence"
WORK="$(mktemp -d)"
EMPTY_HOME="$WORK/empty-home"
mkdir -p "$EMPTY_HOME"
trap 'if [ -d "$WORK/repo" ]; then (cd "$WORK/repo" && "$EVIDENCE" cleanup >/dev/null 2>&1) || true; fi; rm -rf "$WORK"' EXIT
FAILED=0

check() {
    local what="$1"
    shift
    if "$@" >/dev/null 2>&1; then
        echo "ok   $what"
    else
        echo "FAIL $what"
        FAILED=1
    fi
}

# shellcheck disable=SC2329 # Called through check.
gif_outputs_unchanged() {
    local name="$1" suffix
    for suffix in before.cast after.cast before.gif after.gif; do
        cmp -s "$WORK/seed-$name/$suffix" "$OUT/$name.$suffix" || return 1
    done
}

seed_gif_outputs() {
    local name="$1" suffix
    mkdir -p "$WORK/seed-$name"
    for suffix in before.cast after.cast before.gif after.gif; do
        printf 'seed:%s\n' "$suffix" >"$OUT/$name.$suffix"
        cp "$OUT/$name.$suffix" "$WORK/seed-$name/$suffix"
    done
}

# shellcheck disable=SC2329 # Called through check.
no_gif_temp() {
    ! compgen -G "$STATE/.gif.*" >/dev/null
}

# shellcheck disable=SC2329 # Called through check.
verify_cast() {
    python3 - "$1" "$2" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as cast:
    header = json.loads(cast.readline())
    events = [json.loads(line) for line in cast]
output = "".join(event[2] for event in events if event[1] == "o")
output = output.replace("\r\n", "\n").replace("\r", "\n").strip()
expected = json.dumps({
    "args": ["two words", "$value", "line one\nline two", "apostrophe'arg", ""],
    "columns": "72",
    "lines": "18",
    "marker": sys.argv[2],
    "term": "xterm-256color",
    "timezone": "UTC",
}, sort_keys=True)
assert header["width"] == 72 and header["height"] == 18, header
assert output == expected + "\ndiagnostic", output
PY
}

git init --quiet --bare -b main "$WORK/origin.git"
git clone --quiet "$WORK/origin.git" "$WORK/repo" 2>/dev/null
cd "$WORK/repo"
git config user.email test@example.com
git config user.name test
cat >scenario.py <<'PY'
import json
import os
import sys

print(json.dumps({
    "args": sys.argv[1:],
    "columns": os.environ["COLUMNS"],
    "lines": os.environ["LINES"],
    "marker": open("marker", encoding="utf-8").read().strip(),
    "term": os.environ["TERM"],
    "timezone": os.environ["TZ"],
}, sort_keys=True), flush=True)
sys.stderr.write("diagnostic\n")
PY
printf 'before\n' >marker
git add .
git commit --quiet -m before
git push --quiet origin main 2>/dev/null
git remote set-head origin --auto >/dev/null
git checkout --quiet -b feature
printf 'after\n' >marker
git commit --quiet -am after
"$EVIDENCE" init >"$WORK/init.txt"
OUT="$(sed -n 's/^OUT=//p' "$WORK/init.txt")"
STATE="$(dirname "$OUT")"
DASH="$(command -v dash)" || { echo "FAIL dash is required for POSIX shell coverage"; exit 1; }
mkdir "$WORK/dash-shim"
cat >"$WORK/dash-shim/sh" <<'SH'
#!/bin/sh
printf 'called\n' >>"$POSIX_SH_MARKER"
exec "$POSIX_SH_DASH" "$@"
SH
chmod +x "$WORK/dash-shim/sh"

if PATH="$WORK/dash-shim:$PATH" POSIX_SH_DASH="$DASH" POSIX_SH_MARKER="$WORK/sh-invocations" \
    "$EVIDENCE" gif finite --size 72x18 -- python3 scenario.py 'two words' '$value' \
    $'line one\nline two' "apostrophe'arg" '' >"$WORK/finite.paths" 2>"$WORK/finite.err"; then
    check "real capture retains both casts and GIFs" test -s "$OUT/finite.before.cast" -a -s "$OUT/finite.after.cast" -a -s "$OUT/finite.before.gif" -a -s "$OUT/finite.after.gif"
    check "real capture leaves no temporary GIF directory" no_gif_temp
    check "before cast records expected command output and dimensions" verify_cast "$OUT/finite.before.cast" before
    check "after cast records expected command output and dimensions" verify_cast "$OUT/finite.after.cast" after
    check "real capture runs both commands through the dash shim" test "$(/usr/bin/grep -c '^called$' "$WORK/sh-invocations")" -ge 2
    check "success prints both final GIF paths" bash -c '[ "$(grep -c "\.gif$" "$1")" = 2 ]' _ "$WORK/finite.paths"
else
    echo "FAIL real finite capture"
    cat "$WORK/finite.err" >&2
    FAILED=1
fi

mkdir -p "$WORK/no-asciinema" "$WORK/no-agg"
for tool in git mkdir rm; do
    ln -sf "$(command -v "$tool")" "$WORK/no-asciinema/$tool"
    ln -sf "$(command -v "$tool")" "$WORK/no-agg/$tool"
done
ln -sf "$(command -v agg)" "$WORK/no-asciinema/agg"
ln -sf "$(command -v asciinema)" "$WORK/no-agg/asciinema"
seed_gif_outputs missing-asciinema
if HOME="$EMPTY_HOME" PATH="$WORK/no-asciinema" /bin/bash "$EVIDENCE" gif missing-asciinema -- printf x >"$WORK/missing-asciinema.out" 2>"$WORK/missing-asciinema.err"; then
    echo "FAIL missing asciinema exits nonzero"
    FAILED=1
else
    check "missing asciinema names the tool" grep -Fxq 'evidence: missing required tool: asciinema' "$WORK/missing-asciinema.err"
    check "missing asciinema preserves prior casts and GIFs" gif_outputs_unchanged missing-asciinema
fi
seed_gif_outputs missing-agg
if HOME="$EMPTY_HOME" PATH="$WORK/no-agg" /bin/bash "$EVIDENCE" gif missing-agg -- printf x >"$WORK/missing-agg.out" 2>"$WORK/missing-agg.err"; then
    echo "FAIL missing agg exits nonzero"
    FAILED=1
else
    check "missing agg names the tool" grep -Fxq 'evidence: missing required tool: agg' "$WORK/missing-agg.err"
    check "missing agg preserves prior casts and GIFs" gif_outputs_unchanged missing-agg
fi
"$EVIDENCE" cli existing -- printf 'existing cli works\n' >/dev/null
check "existing cli remains usable" test -s "$OUT/existing.md"

STUBS="$WORK/stubs"
mkdir -p "$STUBS"
cat >"$STUBS/asciinema" <<'SH'
#!/usr/bin/env bash
if [ "${1:-}" = rec ] && [ "${2:-}" = --help ]; then
    [ -z "${GIF_HELP_MARKER:-}" ] || printf 'help\n' >>"$GIF_HELP_MARKER"
    case "${GIF_HELP_MODE:-valid}" in
        fail) exit 13 ;;
        unsupported) printf 'Usage: asciinema rec --window-size-only\n' ;;
        *) printf 'Usage: asciinema rec --cols COLS --rows ROWS\n' ;;
    esac
    exit 0
fi
cast="${@: -1}"
case "$cast" in *before.cast) side=before ;; *after.cast) side=after ;; *) exit 90 ;; esac
if [ -n "${GIF_STUB_MARKER:-}" ]; then printf 'called\n' >>"$GIF_STUB_MARKER"; fi
[ "${GIF_RECORD_FAIL_SIDE:-}" != "$side" ] || exit 11
printf '{"version":2,"width":100,"height":30}\n[0,"o","stub"]\n' >"$cast"
SH
cat >"$STUBS/agg" <<'SH'
#!/usr/bin/env bash
gif="$2"
case "$gif" in *before.gif) side=before ;; *after.gif) side=after ;; *) exit 90 ;; esac
[ "${GIF_RENDER_FAIL_SIDE:-}" != "$side" ] || exit 12
printf 'GIF89a' >"$gif"
SH
chmod +x "$STUBS/asciinema" "$STUBS/agg"

TOOL_HOME="$WORK/tool-home"
MINIMAL_PATH="$WORK/minimal-path"
mkdir -p "$TOOL_HOME/.cargo/bin" "$MINIMAL_PATH"
for tool in bash env git mkdir mktemp mv rm; do
    ln -sf "$(command -v "$tool")" "$MINIMAL_PATH/$tool"
done
ln -sf "$STUBS/asciinema" "$TOOL_HOME/.cargo/bin/asciinema"
ln -sf "$STUBS/agg" "$TOOL_HOME/.cargo/bin/agg"
if HOME="$TOOL_HOME" PATH="$MINIMAL_PATH" "$EVIDENCE" gif cargo-tools -- printf x >"$WORK/cargo-tools.out" 2>"$WORK/cargo-tools.err"; then
    check "gif resolves tools from HOME cargo bin" test -s "$OUT/cargo-tools.before.gif" -a -s "$OUT/cargo-tools.after.gif"
else
    echo "FAIL gif resolves tools from HOME cargo bin"
    cat "$WORK/cargo-tools.err" >&2
    FAILED=1
fi

if PATH="$WORK/stubs:$PATH" GIF_STUB_MARKER="$WORK/invalid-called" "$EVIDENCE" gif invalid --size 0x18 -- printf x >"$WORK/invalid.out" 2>"$WORK/invalid.err"; then
    echo "FAIL zero dimension is rejected"
    FAILED=1
else
    check "invalid dimensions fail before capture" test ! -e "$WORK/invalid-called"
fi

for mode in unsupported fail; do
    name="help-$mode"
    seed_gif_outputs "$name"
    if PATH="$STUBS:$PATH" GIF_HELP_MODE="$mode" GIF_HELP_MARKER="$WORK/$name.help" \
        GIF_STUB_MARKER="$WORK/$name.record" "$EVIDENCE" gif "$name" -- printf x \
        >"$WORK/$name.out" 2>"$WORK/$name.err"; then
        echo "FAIL $name recorder preflight exits nonzero"
        FAILED=1
    else
        check "$name probes recorder help" test -s "$WORK/$name.help"
        check "$name rejects before recording" test ! -e "$WORK/$name.record"
        check "$name explains required sizing options" bash -c 'grep -q -- "--cols" "$1" && grep -q -- "--rows" "$1" && grep -q "compatible recorder" "$1"' _ "$WORK/$name.err"
        check "$name preserves prior casts and GIFs" gif_outputs_unchanged "$name"
    fi
done

for side in before after; do
    name="record-$side"
    if PATH="$STUBS:$PATH" GIF_RECORD_FAIL_SIDE="$side" "$EVIDENCE" gif "$name" -- printf x >"$WORK/$name.out" 2>"$WORK/$name.err"; then
        echo "FAIL $side recorder failure exits nonzero"
        FAILED=1
    else
        check "$side recorder error names stage and side" grep -q "$side recording" "$WORK/$name.err"
        check "$side recorder failure prints no GIF path" bash -c '! grep -q "\.gif$" "$1"' _ "$WORK/$name.out"
        check "$side recorder failure publishes no GIF" test ! -e "$OUT/$name.before.gif" -a ! -e "$OUT/$name.after.gif"
        check "$side recorder failure leaves no temporary GIF directory" no_gif_temp
    fi
done
for side in before after; do
    name="render-$side"
    if PATH="$STUBS:$PATH" GIF_RENDER_FAIL_SIDE="$side" "$EVIDENCE" gif "$name" -- printf x >"$WORK/$name.out" 2>"$WORK/$name.err"; then
        echo "FAIL $side renderer failure exits nonzero"
        FAILED=1
    else
        check "$side renderer error names stage and side" grep -q "$side rendering" "$WORK/$name.err"
        check "$side renderer failure prints no GIF path" bash -c '! grep -q "\.gif$" "$1"' _ "$WORK/$name.out"
        check "$side renderer failure publishes no GIF" test ! -e "$OUT/$name.before.gif" -a ! -e "$OUT/$name.after.gif"
        check "$side renderer failure leaves no temporary GIF directory" no_gif_temp
    fi
done

PATH="$STUBS:$PATH" "$EVIDENCE" gif stale -- printf x >"$WORK/stale.paths"
check "successful stub capture creates a GIF pair" test -s "$OUT/stale.before.gif" -a -s "$OUT/stale.after.gif"
check "successful stub capture leaves no temporary GIF directory" no_gif_temp
if PATH="$STUBS:$PATH" GIF_RENDER_FAIL_SIDE=after "$EVIDENCE" gif stale -- printf x >"$WORK/stale-fail.out" 2>"$WORK/stale-fail.err"; then
    echo "FAIL stale-pair rerun exits nonzero"
    FAILED=1
else
    check "failed rerun names after rendering" grep -q 'after rendering' "$WORK/stale-fail.err"
    check "failed rerun removes the old GIF pair" test ! -e "$OUT/stale.before.gif" -a ! -e "$OUT/stale.after.gif"
    check "failed rerun leaves no temporary GIF directory" no_gif_temp
fi

mkdir -p "$WORK/mv-fail"
printf '#!/bin/sh\nexit 1\n' >"$WORK/mv-fail/mv"
chmod +x "$WORK/mv-fail/mv"
if PATH="$WORK/mv-fail:$STUBS:$PATH" "$EVIDENCE" gif publish-fail -- printf x >"$WORK/publish-fail.out" 2>"$WORK/publish-fail.err"; then
    echo "FAIL publication failure exits nonzero"
    FAILED=1
else
    check "publication failure leaves no temporary GIF directory" no_gif_temp
fi

printf 'PNG' >"$OUT/finite.before.png"
printf 'PNG' >"$OUT/finite.after.png"
"$EVIDENCE" upload --dry-run finite >"$WORK/gif-table.md"
check "GIF selection takes precedence over same-name PNGs" bash -c 'grep -q "$1/finite.before.gif" "$2" && grep -q "$1/finite.after.gif" "$2" && ! grep -q "\.png" "$2"' _ "$OUT" "$WORK/gif-table.md"
printf 'PNG' >"$OUT/pngonly.before.png"
"$EVIDENCE" upload --dry-run pngonly >"$WORK/png-table.md"
check "PNG-only evidence keeps its missing-half cell" bash -c 'grep -q "$1/pngonly.before.png" "$2" && grep -q "_none_" "$2" && ! grep -q "\.gif" "$2"' _ "$OUT" "$WORK/png-table.md"
printf 'GIF89a' >"$OUT/mixed.before.gif"
printf 'PNG' >"$OUT/mixed.after.png"
"$EVIDENCE" upload --dry-run mixed >"$WORK/mixed-table.md"
check "upload does not mix formats across sides" bash -c 'grep -q "$1/mixed.before.gif" "$2" && grep -q "_none_" "$2" && ! grep -q "mixed.after.png" "$2"' _ "$OUT" "$WORK/mixed-table.md"

printf 'PNG' >"$OUT/stale.before.png"
printf 'PNG' >"$OUT/stale.after.png"
"$EVIDENCE" upload --dry-run stale >"$WORK/stale-table.md"
check "failed rerun cannot select stale GIFs" bash -c 'grep -q "$1/stale.before.png" "$2" && ! grep -q "\.gif" "$2"' _ "$OUT" "$WORK/stale-table.md"

git remote set-url origin git@github.com:owner/repo.git
mkdir -p "$WORK/gh"
cat >"$WORK/gh/gh" <<'SH'
#!/usr/bin/env bash
if [[ "$*" == *uploads.github.com* ]]; then
    printf '%s\n' "$*" >>"$GH_STUB_LOG"
    printf 'https://github.com/user-attachments/assets/test\n'
else
    printf '42\n'
fi
SH
chmod +x "$WORK/gh/gh"
GH_STUB_LOG="$WORK/gh.log" PATH="$WORK/gh:$PATH" "$EVIDENCE" upload finite >"$WORK/github-table.md"
GH_STUB_LOG="$WORK/gh.log" PATH="$WORK/gh:$PATH" "$EVIDENCE" upload finite >"$WORK/github-repeat.md"
check "GitHub GIF uploads use image/gif and GIF filenames" bash -c 'grep -q "content_type=image/gif" "$1" && grep -q "finite.before.gif" "$1" && grep -q "finite.after.gif" "$1"' _ "$WORK/gh.log"
check "repeated GitHub upload uses the content cache" bash -c '[ "$(grep -c uploads.github.com "$1")" = 2 ]' _ "$WORK/gh.log"

[ -z "${EVIDENCE_TEST_KEEP:-}" ] || cp "$OUT"/finite.before.cast "$OUT"/finite.after.cast "$OUT"/finite.before.gif "$OUT"/finite.after.gif "$EVIDENCE_TEST_KEEP"/
[ "$FAILED" = 0 ] && echo "all GIF evidence checks passed"
exit "$FAILED"
