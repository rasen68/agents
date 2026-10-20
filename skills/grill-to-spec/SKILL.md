---
name: interview-to-spec
description: >-
  Interview the user to resolve a plan or design, then write the agreed spec
  to the project overlay. Use for brainstorming or stress-testing work that
  should be captured before implementation.
---

# Grill a design and write its spec

Interview the user about a plan, design, or rough idea until the key decisions
and their dependent branches are resolved. Then synthesize the agreed result
into a spec in the project's overlay. Do not write production code.

## Interview

Resolve the overlay with `agent-overlay resolve <root>` and read its
`AGENTS.md` if present. Consult relevant specs or handoffs and search transcripts
for prior intent when useful. Check legacy context against the repository.
Explore the codebase and documentation to establish facts before asking about
them. Use a subagent only for broad searches.

Map the decisions as a tree. Ask questions in rounds, covering every decision
whose prerequisites are settled. Number each question and include a recommended
answer. If the idea is still fuzzy, start with 2–3 possible approaches, their
tradeoffs, and a recommendation. Do not ask questions whose answers depend on
other unresolved choices until a later round.

Use this format:

```text
❓ **Q1** - **<question title>**: <question and choices>

➡️ <recommended answer>
```

After each response, update the decision tree and ask the next frontier. When
all branches are resolved, summarize the decisions and ask the user to confirm
the summary. If they correct it, continue the interview. Once they confirm,
write the spec in the same workflow without asking them to invoke another skill.

## Write the spec

Use the overlay's vocabulary and inspect relevant code if needed. Identify the
test seams and what each should prove. If the seams are not settled, ask about
them before writing the spec.

Write `<overlay>/plans/<short-name>-spec.md`. Do not write into the project
repository unless the user asks. Keep the spec short and omit empty sections.
Do not include file paths or code snippets, except a small prototype snippet
when it pins a decision more clearly than prose.

Use this template:

```markdown
# <Title>

## Problem

What the user is facing, from their perspective.

## Solution

What changes, from the user's perspective.

## User stories (optional)

Only when actors or flows are non-obvious.

## Decisions

Modules, interfaces, architecture, schemas, API contracts, and clarifications.
Record why when a choice was contested.

## Testing

The agreed seams, what behavior each test proves, and prior art in the codebase.

## Out of scope

## Open questions
```

Announce the spec path when finished. The spec records decisions; it does not
authorize implementation.
