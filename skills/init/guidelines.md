# Overlay content guidelines

## `AGENTS.md` — operator manual for agents

**Purpose:** How to work in this repo day to day. Factual, short, actionable.

**Include:**

- One-line what the project is
- Pointer that this is a **personal overlay** + absolute path to the real project
- Layout map (important dirs/packages only)
- Run / build / test commands (copy-pasteable)
- Agent notes: test strategy, dangerous areas, “ask before X”, WIP modules
- Where plans live (`plans/` in this overlay)

**Exclude:**

- Global style prefs already in `~/.agents/AGENTS.md` (quotes, TDD philosophy, comment rules) — at most one line “follow global personal profile”
- Long domain glossaries (that’s `CONTEXT.md`)
- Implementation plans or feature specs (that’s `plans/`)
- Marketing fluff or tutorial essays

**Length:** aim under ~80 lines. Link to files instead of pasting large snippets.

---

## `CONTEXT.md` — domain vocabulary

**Purpose:** Shared language so agents and you use the same terms (reduces verbose guessing).

**Include:**

- Product one-liner
- Table or bullets: **Term → meaning** (ubiquitous language)
- Important commands / user-visible verbs if they are domain terms
- Key invariants, timing, or protocol quirks that affect design
- Good **test seams** (public boundaries)
- Explicit **out of scope** / non-goals for the project as a whole

**Exclude:**

- Setup instructions (AGENTS.md)
- Coding style
- Ephemeral TODO lists (use `plans/` or code TODOs)
- Every internal function name — only concepts people/agents must share

**Length:** as long as the domain needs; prefer a dense glossary over prose.

---

## `rules/` — optional sharp edges

Use when a convention is easy to violate and is **local to this project** (e.g. “PTY timing tests are integration-only”). Keep each file tiny. Otherwise fold into AGENTS.md.

---

## Overlay identity

Use `agent-overlay init <root>` to derive the path-hash directory.
Each canonical root has its own overlay; do not create `workspace.json`.
Leave legacy mapping files untouched. They are ignored by the helper.

---

## Quality bar

- Infer from the codebase; don’t ask the user to restate what’s in README
- Prefer accurate incomplete docs over confident wrong docs
- After first generation, later `/init` runs should refresh commands/layout and keep hand-tuned glossary entries when still valid
