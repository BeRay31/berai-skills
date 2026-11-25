# Writing the Title and Description

Write for a reviewer who has not seen the conversation. They should be able to tell from the title and body alone what changed, why, and how it was verified. Read the full diff against the target branch (`git diff <target>...HEAD`) and every commit message first.

## Orwell's rules

When writing, use the writing rules from Orwell, 1946. These govern prose: docs, PR text, messages. Never touch code or technical terms; swap in everyday words only where precision survives.
1. Never use a metaphor, simile or other figure of speech which you are used to seeing in print.
2. Never use a long word where a short one will do.
3. If it is possible to cut a word out, always cut it out.
4. Never use the passive where you can use the active.
5. Never use a foreign phrase, a scientific word or a jargon word if you can think of an everyday English equivalent.

## Title

- State the outcome in the imperative ("Cache unchanged saves"), under 72 characters.
- Match the prefix and casing of recent titles in the repo (`glab mr list` / `gh pr list`), including ticket ids when they use them.

## Body

1. **Why**: the problem or goal, in one or two sentences. Link a reviewer-accessible issue or ticket when it adds context.
2. **What changed**: a short bullet per logical change, each with the smallest view that makes it clear (see below) and its before/after evidence from `capture-review-evidence` when it changes CLI, TUI, frontend, or architecture. A one-line fix needs no view.
3. **Verification**: the relevant commands run and their results, plus anything left unverified.
4. **Review notes** (optional): where to start reading, risky spots, follow-ups.

Write in terms of the change and its evidence. Translate acceptance criteria into plain language; keep internal execution details (Bead IDs, Task-SME tiers, gates, review waves, run IDs, and diff budgets) in the tracker or handoff rather than the review body. Describe a test's result, not the workflow step that produced it.

Done when every bullet maps to real hunks in the diff, every hunk is covered by a bullet, and no section restates another or reports internal process bookkeeping.

## Views

Pick the smallest view that makes the point, place it next to the bullet it supports, and keep only the calls, files, props, and states that bullet needs. Most descriptions use one view; few need more than two. Both GitLab and GitHub render `diff` and `mermaid` fenced blocks.

- **Diff-shaped tree**, the default when the surrounding shape already exists: a `diff` block of the call tree, component tree, file tree, or control flow, with `+`/`-` only on the lines that change.

  ```diff
   submitForm
     createSession
       persistPrompt
  +    expandSkillMention
       launchAgent
  ```

  ```diff
   src/
   ├── commands/
  +│   └── show-me.ts       # expands the slash command
  -└── transport.ts
  +└── transport/
  +    ├── client.ts
  +    └── stream.ts
  ```

- **Pseudocode or call tree** for new logic or new runtime flow with no prior shape to diff against.
- **Mermaid** (`sequenceDiagram`, `flowchart`) when the point is interaction or data flow between components; an architectural change gets a before/after pair.
- **Whole block** of code only when most of it is new or the reviewer needs the exact target shape.

Use real names from the diff.
