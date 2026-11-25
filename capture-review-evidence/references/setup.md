# Setup

## As of 2026-11

### Set up employee-laptop tools

This setup uses Homebrew for Rust, Cargo, and Python, then installs
`asciinema` in a dedicated virtual environment. The venv keeps it out of the
system Python package set.

These command-local flags prevent Homebrew from auto-updating, upgrading the
named formulae, or running cleanup for this command. Homebrew may still
install or change dependencies.

```bash
HOMEBREW_NO_AUTO_UPDATE=1 \
HOMEBREW_NO_INSTALL_UPGRADE=1 \
HOMEBREW_NO_INSTALL_CLEANUP=1 \
  brew install rust python@3.13

brew --prefix
RUST_PREFIX="$(brew --prefix rust)"
"$RUST_PREFIX/bin/cargo" --version
"$RUST_PREFIX/bin/rustc" --version
```

Create the venv and install `asciinema` from Adyen's internal PyPI:

```bash
VENV="$HOME/.local/share/capture-review-evidence/venv"
"$(brew --prefix python@3.13)/bin/python3.13" -m venv "$VENV"
PIP_CONFIG_FILE=/dev/null PIP_EXTRA_INDEX_URL= "$VENV/bin/python" -m pip install \
  --index-url https://artifacts-cache.is.adyen.com/artifactory/api/pypi/adyen-global-pypi-virtual/simple \
  'asciinema==2.4.0'
export PATH="$VENV/bin:$(brew --prefix rust)/bin:$HOME/.cargo/bin:$PATH"
asciinema --version
```

The version check should print `asciinema 2.4.0`. For this command only,
`PIP_CONFIG_FILE=/dev/null` disables pip configuration files, and the empty
`PIP_EXTRA_INDEX_URL` clears the environment override. The explicit internal
index remains the only index. This does not edit package-source settings or
add credentials. Preserve any managed certificate and authentication setup;
do not disable TLS verification.

To keep these tools on `PATH` in future zsh sessions, add this line to
`~/.zshrc` once:

```bash
export PATH="$HOME/.local/share/capture-review-evidence/venv/bin:$(brew --prefix rust)/bin:$HOME/.cargo/bin:$PATH"
```

### `agg` renderer availability

The asciinema `agg` renderer release `1.9.0` is not available in the configured
internal Cargo registry, `artifacts-is-adyen-com`. That registry has an unrelated
`agg` `0.1.0` Anti-Grain
Geometry package. Do not install it. Do not use `cargo install agg` or an
external source fallback. GIF capture needs an approved internal artifact or
mirror.

If an approved renderer is already installed, these commands check its path
and reported version. They do not verify its source:

```bash
command -v agg
agg --version
```

Until the approved artifact is available, use the CLI or TUI evidence paths
above when GIF capture is unavailable.

### Local GIF smoke test

Run this only when an approved `agg` is on `PATH`. The cast and GIF remain in a
temporary directory; the commands do not upload them.

```bash
(
  set -e
  OUT="$(mktemp -d "${TMPDIR:-/tmp}/capture-review-evidence.XXXXXX")"
  asciinema rec --cols 72 --rows 12 -q \
    -c 'printf "capture-review-evidence smoke\n"; sleep 0.2; printf "done\n"' \
    "$OUT/smoke.cast"
  agg "$OUT/smoke.cast" "$OUT/smoke.gif"
  printf 'Local smoke artifacts: %s\n' "$OUT"
)
```
