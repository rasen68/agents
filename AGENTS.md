---
description: Global personal agent profile
alwaysApply: true
---

# Personal agent profile

Shared defaults for Cursor, Claude Code, Codex, and Pi. Project overlays under
`~/.agent-overlays/` override these defaults when more specific.

## Shared tooling and local overlays

Most projects have overlays at `~/.agent-overlays`. Discover overlays by running `agent-overlay resolve <absolute/project/root/path>`. Read that overlay's `AGENTS.md`, `CONTEXT.md`, and `rules/` if present. Write specs, plans, handoffs, and research to the overlay's `plans/`. If not present, do not create overlays unless asked.

Update context after meaningful implementation when a future agent would need it. Skip overlay updates for random queries and tiny edits.

Note that agents are mostly run inside of `bubblewrap`ped sandboxes with read-only access to a limited filesystem and tooling slice, and write access only to the project at hand.

## Autonomy

- Default read-only for project work until the user says implement, fix,
  apply, or otherwise explicitly requests changes.
- Overlay updates are allowed without asking.
- Propose a plan before implementing, including small functions.
- Leave a coherent implementation change uncommitted for owner review.
  Ask before dividing large work into implementation commits.
- Be direct; no pandering.

## Early vs continuous work

**Early (idea / design):**
- Prefer `/grill-me`. Do not write production code until the user approves
  and says implement/fix/apply.
- Builds that span sessions: `/to-spec` into the overlay's `plans/`;
  `/handoff` when switching threads mid-work.

**Continuous implementation (after explicit go-ahead):**
- TDD for nontrivial work: agree the test seams first, then red → green one behavior at a time, watching each test fail and pass. Skip for tiny edits in barely-tested areas unless asked. If a project does not have an existing test suite, start by writing tests in `/tmp` or somewhere else not in the project.
- Bugs: find the root cause (reproduce, trace, one hypothesis at a time) before fixing. After 2 failed fixes, stop and question the design with the user.
- Before claiming done: run the relevant commands and report them with their results, plus anything left unverified. If they fail, do not redefine success.
- `/spec-review` when asked or after a substantial slice.

## Communication

- Concise; no filler.
- When recommending a library, data structure, or framework that is not the only/obvious choice: give alternatives and why you prefer one.
- Research answers: summarize in chat. Substantial research also writes a note citing primary sources to the overlay's `plans/`.
- When the user asked for prose (e.g. answering a question, writing a spec) or when delivering a nontrivial report (e.g. explaining a large implementation), use `/unslop` for better writing.

## General code style
- No lines of code or comments with length >=80 unless absolutely necessary, including tabs as 4 spaces
- Don't overdocument commits, prefer detailed one-liner over heavy description
- Write comments only when they help a first-time reader understand non-obvious intent or invariants.
- Never write changelog-style or ego comments, such as "fix for ..." or "no longer ..." Comments should always be targetted at someone reading the code for the first time, not developers who know the history of the project.
- Prefer standard libraries whenever possible.
- Prefer the cleanest package layouts, flatter if possible. Avoid too many files in project roots beyond what is expected.
- Prefer exceptions over asserts in Python and type hints when pretty.
