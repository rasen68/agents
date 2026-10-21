# agents

Personal configuration, shared skills, and project context for Claude Code, Cursor, Codex, and Pi.

## Setup

Install agent CLIs with `install-clis.sh`, then run `setup.sh` to link instructions, skills, and `agent-overlay` from this checkout into the locations the CLIs use. Put `~/.local/bin` on your PATH. Desktop applications can be installed with `install-desktops.sh` but aren't otherwise managed here.

Setup preserves existing real files and directories at its destinations. It replaces symlinks.

Pi's portable settings, extensions, and local package sources live in [`pi/`](pi/README.md).  Credentials, sessions, and installed runtimes aren't stored here.

## Skills and workflows

A global `AGENTS.md` supplies my preferences wherever Claude, Cursor, Codex, and Pi look for instructions. Shared skills define a workflow of `/init` to establish context, `/interview-to-spec` to resolve design decisions and write a spec, `/handoff` to create handoff documents, and `/spec-review` to review implemented code.

The [`transcript-memory` skill](skills/transcript-memory/README.md) retrieves prior Pi conversations and decisions through a bundled CLI. It loads on demand, defaults to conversation prose, and includes tool traffic only when requested.

## Project overlays

Durable project instructions and requested artifacts live in overlays at `~/.agent-overlays/{basename}-{hash}` rather than in each project's checkout. Historical decisions and research stay in transcripts, without routine summary files. `bin/agent-overlay` manages overlay directories, and relevant skills invoke it. Run `/init` in a new repo to establish its context. Select this shared skill rather than a CLI's built-in skill with the same name.
