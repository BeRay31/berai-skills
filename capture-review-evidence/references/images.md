# Checking and Hosting Images

Open every PNG and GIF in `OUT` and confirm each shows the intended state: the right screen, no loading spinner, no error overlay, no secrets or personal data. Retake it if not. Upload only final images:

```bash
<skill-dir>/scripts/evidence -C <repo> upload <name> [<name>...]
```

Use `upload --dry-run` to preview the table with local paths:

```bash
<skill-dir>/scripts/evidence -C <repo> upload --dry-run <name>
```

The helper uploads the GIF pair when GIF evidence exists, otherwise the PNG pair. It never mixes formats across the pair. A missing half becomes `_none_`. Uploads are cached by content. GitHub uploads cannot be deleted, need write access, and fail on GitHub Enterprise Server. Put each table next to the bullet it supports.

Done when every changed CLI, TUI, frontend, or architectural surface has a before/after pair from one shared scenario, every image has been opened and checked, every Mermaid block renders, and any missing half is explained in one line. For a new command, the before half is its `unknown command` output.

Retain the artifacts until the caller has incorporated them. Remove the disposable worktree and captures only when their removal is authorized:

```bash
<skill-dir>/scripts/evidence -C <repo> cleanup
```
