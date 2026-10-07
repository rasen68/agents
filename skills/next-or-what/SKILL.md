---
name: next-or-what
description: >-
  Figure out the next step that you can do and do it, or ask the user for guidance
disable-model-invocation: true
---

# Next or what

Based on existing work, planning, specs, etc. figure out what the next thing to do
is, and do it. If you can't figure it out, ask.

## Process

Resolve the overlay with `agent-overlay resolve <root>` and read its `AGENTS.md`
and `CONTEXT.md` if present. If nothing is there, it's the wrong place for this skill.
There will likely be a `plans/` folder with `.md` files containing specs and research
notes. Based on that, determine what the user's goal is, if possible. Likely, it
will be clearly written in a spec. Attempt to determine the next logical step that
can be taken on in one agentic session (including subagents). If it is clear,
implement it.

## What to do if it isn't clear

If you can't figure out the user's goal, say clearly in a few plain sentences what
you could figure out, and ask. If you can't figure out the next logical step from
the spec/plans, state clearly what you know and ask.

## When done

Create a report about what you finished for the user, using the `/unslop` skill. Don't load it until you're done. Update the overlay with what you complete, including `CONTEXT.md`, the relevant plans, etc.
