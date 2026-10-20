# Transcript navigation

Press **Alt+N** to navigate the transcript using the same message components
that Pi displays when you scroll up. Every open starts at the bottom. Press
**Alt+N** again, or Escape, to return to the prompt without changing your draft.

| Key | Action |
| --- | --- |
| `j` / Down | Scroll down one line |
| `k` / Up | Scroll up one line |
| `h` / Left | Jump to the previous assistant message |
| `l` / Right | Jump to the next assistant message |
| Digits followed by a movement | Repeat it, such as `15j`, `8k`, or `3h` |

Uses the mounted transcript's native colors, spacing, tool blocks, Markdown
transformers, and current thinking/expansion settings. There are no replacement
message headers, compact tool summaries, or grey panel background. A single dim
status line shows position and navigation keys. Each assistant message with
visible text is a reply jump target, including updates before tool calls.

The viewer captures the mounted transcript components when opened. It doesn't
reconstruct session history, change message settings, or edit your draft. Close
and reopen to refresh the component list. What's available matches Pi's current
transcript, including its treatment of compaction and streaming.

Requires Pi 1.3.0. Pi has no public transcript-component accessor, so the extension
reads the mounted document/chat structure and assistant message metadata. If the
structure changes, it reports an unsupported-layout error instead of rebuilding
a different-looking transcript.

Transcript navigation is part of the `nav` extension. Setup links its directory
into `~/.pi/agent/extensions/nav`. Run `/reload` in existing sessions.
