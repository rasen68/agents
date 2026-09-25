---
name: to-spec
description: >-
  Turn the current conversation into a spec in the personal overlay
  plans/: no interview, just synthesis of what was already discussed. Use
  after grilling when the build should survive more than one session.
disable-model-invocation: true
---

# To spec

Synthesize the conversation and your codebase understanding into a **spec**.
Do **not** interview the user; write down what is already decided.

## Process

1. Resolve the overlay (`agent-overlay resolve <root>`). Read `CONTEXT.md`
   and use its vocabulary. Explore the codebase if you haven't already.
2. Name the **seams** you will test at: prefer existing ones, the highest
   possible, as few as possible (ideally one). Confirm them with the user if
   they weren't settled in conversation.
3. Write `<overlay>/plans/<short-name>-spec.md` from the template below and
   announce the path. Do not write into the project repo unless asked.

Keep it short. Leave out sections with nothing to say. No file paths or code
snippets; they go stale. Exception: a prototype snippet that pins a decision
more precisely than prose (state machine, schema, type shape), trimmed to the
decision-rich part.

## Template

```markdown
# <Title>

## Problem

What the user is facing, from their perspective.

## Solution

What changes, from the user's perspective.

## User stories (optional)

Only when actors or flows are non-obvious.

1. As a <actor>, I want <feature>, so that <benefit>

## Decisions

Modules, interfaces, architecture, schemas, API contracts, and the
clarifications the user gave. Record why when the choice was contested.

## Testing

The agreed seams, what behavior each test proves, and prior art in the
codebase.

## Out of scope

## Open questions
```
