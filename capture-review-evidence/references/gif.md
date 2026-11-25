# Terminal GIFs

Use GIF capture for finite terminal behavior when both sides run the same scenario and approved `asciinema` and `agg` tools are available and `asciinema rec --help` lists both `--cols` and `--rows`. For managed employee setup, see [the dated setup note](setup.md).

```bash
<skill-dir>/scripts/evidence -C <repo> gif <name> --size 100x30 -- <finite-command> [args...]
```

The helper defaults to `100x30`. Pass `--size COLSxROWS` to choose another positive size.

The helper retains local before and after casts. Inspect both GIFs and casts for secrets or personal data. Casts stay local and are never uploaded. Upload GIFs only when authorized. If GIF capture is unavailable or the recorder lacks `--cols` or `--rows`, use [CLI text](cli.md) for exact output or exit-code comparisons, or [TUI screenshots](tui.md) for interactive scenarios. Do not install tools automatically.
