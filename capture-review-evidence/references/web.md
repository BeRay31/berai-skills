# Frontend Evidence

Use frontend screenshots for pages, components, and styles. Use the same route and interaction on both sides.

```bash
<skill-dir>/scripts/evidence -C <repo> web <name> --serve '<dev server command using {port} or $PORT>' --path /<route> --selector '<css>'
<skill-dir>/scripts/evidence -C <repo> web <name> --before-url http://localhost:<p1> --after-url http://localhost:<p2> --path /<route>
```

Add `--full-page` for long pages. Use `--wait-ms` for animations and a second capture with `--viewport 390x844` when the change is responsive.

Use the URL form when the servers need more than one command to start.

When the changed state needs interaction (an open modal, a filled form, a hover), drive both sides through the same steps with the Playwright MCP server or a short Playwright script, and screenshot the changed element (`locator.screenshot()`) rather than the whole page. Save the images into `OUT` so `upload` picks them up.
