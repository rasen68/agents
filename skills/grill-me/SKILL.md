---
name: grill-me
description: >-
  Interview the user relentlessly about a plan, design, or rough idea until
  every branch of the decision tree is resolved. Use when the user wants to be
  grilled, stress-test a design, or mentions grill-me / grilling.
disable-model-invocation: true
---

# Grill me

Interview the user relentlessly until you reach a shared understanding.
Map this as a **design tree**: every decision branches into the decisions
that hang off it.

Resolve the overlay (`agent-overlay resolve <root>`) and read `CONTEXT.md` if
present so terminology stays consistent. Do not write production code.

## Rounds and frontier

Work the tree in **rounds**. The **frontier** is every decision whose
prerequisites are already settled: the questions you can ask _now_ without
guessing at answers you haven't heard yet. Ask the whole frontier in one round:
number each question and give your recommended answer. Then wait for the user's
answers before the next round.

If the idea is still fuzzy, the first round proposes **2–3 approaches** with
tradeoffs and a recommendation, so later rounds grill a concrete shape.

Format a round like so:

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs,
including multiple choices>

➡️ <your recommended answer>

---

❓ **Q2** - **<question title>**: <question body, might be multiple paragraphs,
including multiple choices>

➡️ <your recommended answer>
```

Each round the user answers reshapes the tree: settled decisions push the
frontier outward and unblock questions that depended on them. Recompute the
frontier and ask the next round. A question whose answer depends on another
question still open in this round belongs to a _later_ round, not this one.

## Facts vs decisions

Finding _facts_ is your job, never the user's. When a question needs a fact
from the environment (filesystem, tools, codebase, docs), look it up yourself
before asking; use a sub-agent only for broad searches. Summarize the facts
that shaped the round above its questions. The _decisions_ are the user's:
put each to them and wait.

## Done

The session is done when the frontier is empty: every branch of the design tree
visited, nothing left silently assumed. Summarize the settled decisions and ask
the user to confirm. Do not act on them until the user confirms and says to
implement. If the build should survive more than one session, suggest
**`/to-spec`**.
