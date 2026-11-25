# Architecture Evidence

Draw a before and an after Mermaid diagram (`flowchart` for structure and dependencies, `sequenceDiagram` for runtime interaction) with the same node ids and layout direction, so the two read as a pair. Keep only the components the change touches and their direct neighbours. Mark changes with classes.

````markdown
**Before**

```mermaid
flowchart LR
  cli[CLI] --> sync[sync.Run]
  sync --> fs[(filesystem)]
  class sync removed
  classDef removed stroke:#d33,stroke-width:2px,stroke-dasharray:4
```

**After**

```mermaid
flowchart LR
  cli[CLI] --> planner[sync.Plan]
  planner --> applier[sync.Apply]
  applier --> fs[(filesystem)]
  class planner,applier added
  classDef added stroke:#2a2,stroke-width:2px
```
````

After writing the description, render each block and inspect the images:

```bash
<skill-dir>/scripts/evidence -C <repo> mermaid <file>
```
