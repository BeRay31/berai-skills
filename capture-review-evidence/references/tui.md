# TUI Evidence

Use TUI screenshots for interactive terminal scenarios, rendered tables, prompts, and curses interfaces.

```bash
<skill-dir>/scripts/evidence -C <repo> tui <name> -- <command>
<skill-dir>/scripts/evidence -C <repo> tui <name> --keys "Down Down Enter" -- <command>
```

Without `--keys`, `freeze` captures the command's output. With `--keys` (or `--interactive` to capture the first screen), the command runs in an isolated tmux server at `--size 100x30`. The helper sends each tmux key name (`Down`, `Enter`, `C-c`, `Space`, or literal text) and captures the pane. Both images render at the same `--width 900`.

`freeze` ignores reverse video and background colours, so the helper redraws reverse-video highlights as bold underlined cyan. Highlights drawn only with a background colour are still lost; say so under the image when the change is one of those.
