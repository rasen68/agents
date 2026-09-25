---
name: handoff
description: >-
  Compact the current session into a handoff document so a new chat or
  agent can continue. Use when the user asks for a handoff, is switching
  threads, or ending a long session mid-work.
disable-model-invocation: true
---

# Handoff

Write `<overlay>/plans/handoff-<short-name>.md` (resolve the overlay with
`agent-overlay resolve <root>`), or a path the user names. If a handoff for
the same work already exists, update it instead of creating another.

## Include

- Goal and current status
- Spec path; link it rather than restating its decisions
- Decisions made since the spec, or all decisions if there is none
- Files touched / in progress
- Next concrete steps
- Commands to run
- Risks / known bugs
- What not to redo

Keep it short enough to paste into a new chat as `@path`.
