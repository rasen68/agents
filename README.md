# agents

Personal configuration, shared skills, and project context for Claude Code, Cursor, Codex, and Pi.

## Setup

Install agent CLIs with `install-clis.sh`, then run `setup.sh` to link instructions, skills, and `agent-overlay` from this checkout into the locations the CLIs use. Put `~/.local/bin` on your PATH. Desktop applications can be installed with `install-desktops.sh` but aren't otherwise managed here.

Setup preserves existing real files and directories at its destinations. It replaces symlinks.

Pi's portable settings, extensions, and local package sources live in [`pi/`](pi/README.md).
Credentials, sessions, and installed runtimes aren't stored here.

## Skills and workflows

A global `AGENTS.md` supplies my preferences wherever Claude, Cursor, Codex, and Pi look for instructions. Shared skills define a workflow of `/init` to establish context, `/interview-to-spec` to resolve design decisions and write a spec, `/handoff` to create handoff documents, and `/spec-review` to review implemented code.

## Project overlays

Local summaries and context live in project overlays at `~/.agent-overlays/{basename}-{hash}` rather than in each project's checkout. `bin/agent-overlay` manages these directories, and relevant skills invoke it. Run `/init` in a new repo to establish its context. Select this shared skill rather than a CLI's built-in skill with the same name.
