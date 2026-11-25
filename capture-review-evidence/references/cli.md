# CLI Evidence

Use CLI text for exact output and exit-code comparisons.

```bash
<skill-dir>/scripts/evidence -C <repo> cli <name> -- <command> <args>
```

The helper runs the command in both trees, captures stdout and stderr, and replaces both tree paths with `<repo>`. The Markdown output puts the command line above the diff, wrapped in `<details>` past 30 lines. Paste it next to the bullet it supports, trimming context lines that do not help. Pin remaining nondeterminism (fixtures, seeds) in the command itself. The script warns when output is identical; that means the scenario misses the change. Use `bash -c '…'` after `--` for pipes or stdin.
