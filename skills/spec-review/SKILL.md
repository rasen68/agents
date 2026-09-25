---
name: spec-review
description: >-
  Two-axis review of a diff: Spec (faithfulness to the originating spec or
  request) vs Standards (personal and project conventions). Use when the user
  asks for a spec review, or after a substantial implementation slice.
disable-model-invocation: true
---

# Spec review

Review changes since the base the user names (commit, branch, etc.). If none
is given, use the merge-base with the default branch plus uncommitted work.

## Axes (keep separate)

### Spec

- Source: the overlay's `plans/` spec or handoff, issue text, or
  requirements stated in conversation
- Missing or partial requirements, scope creep, wrong behavior

If no spec exists, say so and review Standards only.

### Standards

- Project `AGENTS.md`, `.cursor/rules/`, overlay `CONTEXT.md` and `rules/`
- Personal defaults in `~/.agents/AGENTS.md`
- Judgment-call smells: naming, duplication, feature envy, data clumps,
  primitive obsession, speculative generality, shotgun surgery
- Skip what tooling already enforces

## Report format

```markdown
## Spec
- ...

## Standards
- ...

## Summary
Spec: N findings (worst: …). Standards: N findings (worst: …).
```

Do not merge axes into one ranked list. Cite concrete files and hunks.
