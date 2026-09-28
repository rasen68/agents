# agents

Setup for working with sandboxed AI agent CLIs with my preferences & personal local context.

## Setup

Install agent CLIs with `install-clis.sh`. `setup.sh` then creates symlinks from the `agents/` checkout to where the CLIs look. Desktop applications also come in `install-desktops.sh` but are otherwise not managed by this project. You'll need `~/.local/bin` in path. You'll need to `sudo apt install bubblewrap` for the sandbox to work.

## Skills & workflows

A global `AGENTS.md` is symlinked to everywhere Claude/Cursor/Codex look and provides my preferences. Skills define a basic workflow of `/init` to establish context, `/grill-me` to brainstorm, `/to-spec` and `/handoff` to create plan documents, and `/spec-review` to review implemented code.

## Project overlays

We store local summaries and context, like what is usually in a project's `AGENTS`/`CLAUDE`/`CONTEXT.md`, in project overlays at `~/.agent-overlays/{basename}-{hash}`. They're managed by the `bin/agent-overlay`, which is invoked by `sandbox` and most relevant skills. You can `/init` in a new repo (make sure not to hit the default version of the skill that some of the CLIs ship with) to set up an overlay with basic context.

## Sandbox

Start the sandbox with `sandbox {claude|cursor|codex}`. You can also `sandbox shell` to act in the sandbox as yourself. Sandboxes are managed using `bubblewrap`/`bwrap` and bind the project (and necessary credential files for contacting model providers) as read-write with anything else the agent might need (toolchains, `agents/` itself, etc.) as read-only. Notably, `git` hooks and config are read-only to prevent malicious hooks. Sandbox homes are at `~/.agent-sandboxes/{basename}-{hash}`.

Note that we do not provide network isolation and that prompt injection is still possible. A prompted injection agent can, at worst, destroy local work and/or create dangerous code that a user might run unsandboxed. To protect against this, it's recommended you do your own command-line development within `sandbox shell`.

The sandbox supplies paths and binaries that are useful to my own development. You can easily modify what it supplies by changing its `bwrap` arguments at the bottom of `bin/sandbox`.
