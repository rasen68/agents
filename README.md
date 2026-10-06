# agents

Setup for working with sandboxed AI agent CLIs with my preferences & personal local context.

## Setup

Install agent CLIs with `install-clis.sh`. `setup.sh` then creates symlinks from the `agents/` checkout to where the CLIs look. Desktop applications also come in `install-desktops.sh` but are otherwise not managed by this project. You'll need `~/.local/bin` in path. You'll need to `sudo apt install bubblewrap iproute2` for the sandbox to work.

## Skills & workflows

A global `AGENTS.md` is symlinked to everywhere Claude/Cursor/Codex/Pi look and provides my preferences. Skills define a basic workflow of `/init` to establish context, `/grill-me` to brainstorm, `/to-spec` and `/handoff` to create plan documents, and `/spec-review` to review implemented code.

## Project overlays

We store local summaries and context, like what is usually in a project's `AGENTS`/`CLAUDE`/`CONTEXT.md`, in project overlays at `~/.agent-overlays/{basename}-{hash}`. They're managed by the `bin/agent-overlay`, which is invoked by `sandbox` and most relevant skills. You can `/init` in a new repo (make sure not to hit the default version of the skill that some of the CLIs ship with) to set up an overlay with basic context.

## Sandbox

Start the sandbox with `sandbox {claude|cursor|codex|pi}`. You can also `sandbox shell` to act in the sandbox as yourself. Sandboxes are managed using `bubblewrap`/`bwrap` and bind the project (and necessary credential files for contacting model providers) as read-write with anything else the agent might need (toolchains, `agents/` itself, etc.) as read-only. Notably, `git` hooks and config are read-only to prevent malicious hooks. Sandbox homes are at `~/.agent-sandboxes/{basename}-{hash}`.

Each sandbox binds each harness's settings/configs on launch so that they read from your home filesystem's configs.

The sandbox supplies paths and binaries that are useful to my own development. You can easily modify what it supplies by changing its `bwrap` arguments at the bottom of `bin/sandbox`.

## Network isolation

Sandboxes route network connections through a controlled gateway. Agent CLIs can connect to their model providers. Other destinations require temporary approval from the host for a specific host and port. Agents can inspect permissions and blocked attempts; the user grants and revokes access.

Once a destination is approved, agents can run the same scripts and HTTP clients they would use outside the sandbox, without changing their networking code. HTTPS connections keep their normal encryption and certificate checks. Approval covers the whole host and port, including all API paths and methods. Expiry or revocation blocks new connections; existing connections can continue. Custom DNS transports and arbitrary UDP remain blocked.

Run approval commands in a host shell. `NAME` is the sandbox name available to the agent as `AGENT_SANDBOX`. Grant a host and port for normal scripts, or an exact URL and method for requests through `sandbox-http`:

```sh
sandbox-net allow NAME --host api.example.com --port 443 --ttl 10m
sandbox-net allow NAME --url 'https://api.example.com/data' --method GET --ttl 10m --requests 1
```

These grants expire after ten minutes; the URL grant permits one GET request. Each `allow` returns a grant ID you can use to revoke access early:

```sh
sandbox-net revoke NAME GRANT_ID
```

Network isolation works alongside the filesystem sandbox. Agents can still send data to allowed model providers and share files through writable project directories.
