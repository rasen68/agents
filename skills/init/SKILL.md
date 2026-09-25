---
name: init
description: >-
  Create or refresh a local project overlay under ~/.agent-overlays/,
  with path-hash identity and personal project context.
disable-model-invocation: true
---

# Init project overlay

Write personal context outside the project, in `~/.agent-overlays/`.
Invoking this skill authorizes overlay creation and refresh, not project
code edits. Do not create project instruction files unless asked.

1. Determine the absolute project root. Run
   `agent-overlay init <root>` to create or reuse its path-hash overlay.
   Names combine the sanitized basename and the first 12 SHA-256 digits
   of the canonical absolute root. Worktrees get distinct overlays.
   If the helper is absent from PATH, resolve `~/.agents/AGENTS.md` and
   run the adjacent `bin/agent-overlay` in that checkout.
2. Read existing overlay files and explore the project read-only: README,
   manifests, layout, build/test commands, domain terms, and testing seams.
   Prefer discovery over questions; ask only for material missing facts.
3. Follow [guidelines.md](guidelines.md) to write or refresh `AGENTS.md`,
   `CONTEXT.md`, optional `rules/`, and a short `plans/README.md`. Preserve
   user content. Legacy `workspace.json` files are inert. Match shared
   preferences from `~/.agents/AGENTS.md` without duplicating them.
4. Report the overlay path and what changed. Do not make a commit or add
   symlinks to retired overlay locations. Overlays have no Git lifecycle.

Never infer identity from a basename; use the path-hash helper.
Do not hardcode a tooling checkout path or store overlays inside it.
