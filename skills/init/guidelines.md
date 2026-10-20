# Overlay content guidelines

## Durable instructions

Keep `AGENTS.md` short. Record project-specific constraints that aren't obvious
from the repository, such as live-install boundaries, unsafe operations, or
special environment requirements. Point to repository documentation for layout
and ordinary run/build/test commands instead of copying it.

Follow the shared personal profile without duplicating its preferences. Use
`rules/` only when a non-obvious local constraint needs a separate explanation.
Do not create empty scaffolding or require future agents to maintain an index.

## Memory and artifacts

Use transcripts for historical decisions, research, corrections, and verification.
In Pi, search them with `transcript_search` and read bounded context with
`transcript_read`. Confirm current facts against the repository.

Write specs or documentation when requested. Keep handoffs short and limited
to unfinished work. Save reusable scripts under `scripts/` with necessary usage
instructions. Do not generate routine `CONTEXT.md`, `CHANGES.md`, decision logs,
or research recaps. Existing memory files need no routine refresh.

## Overlay identity

Use `agent-overlay init <root>` to derive the path-hash directory. Each canonical
root has its own overlay. Do not create `workspace.json`; leave ignored legacy
mapping files alone. Do not infer identity from a basename.
