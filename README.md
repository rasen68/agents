# agents

Setup for working with sandboxed AI agent CLIs with my preferences & personal local context.

## Setup

Install agent CLIs with `install-clis.sh`. `setup.sh` then creates symlinks from the `agents/` checkout to where the CLIs look. Desktop applications also come in `install-desktops.sh` but are otherwise not managed by this project. You'll need `~/.local/bin` in path. You'll need to `sudo apt install bubblewrap` for the sandbox to work.

## Skills & workflows

A global `AGENTS.md` is symlinked to everywhere Claude/Cursor/Codex/Pi look and provides my preferences. Skills define a basic workflow of `/init` to establish context, `/grill-me` to brainstorm, `/to-spec` and `/handoff` to create plan documents, and `/spec-review` to review implemented code.

## Project overlays

We store local summaries and context, like what is usually in a project's `AGENTS`/`CLAUDE`/`CONTEXT.md`, in project overlays at `~/.agent-overlays/{basename}-{hash}`. They're managed by the `bin/agent-overlay`, which is invoked by `sandbox` and most relevant skills. You can `/init` in a new repo (make sure not to hit the default version of the skill that some of the CLIs ship with) to set up an overlay with basic context.

## Sandbox

Start the sandbox with `sandbox {claude|cursor|codex|pi}`. You can also `sandbox shell` to act in the sandbox as yourself. Sandboxes are managed using `bubblewrap`/`bwrap` and bind the project (and necessary credential files for contacting model providers) as read-write with anything else the agent might need (toolchains, `agents/` itself, etc.) as read-only. Notably, `git` hooks and config are read-only to prevent malicious hooks. Sandbox homes are at `~/.agent-sandboxes/{basename}-{hash}`.

Each sandbox binds each harness's settings/configs on launch so that they read from your home filesystem's configs.

The sandbox supplies paths and binaries that are useful to my own development. You can easily modify what it supplies by changing its `bwrap` arguments at the bottom of `bin/sandbox`.

## Network isolation

New sandboxes run in a private network namespace. Direct TCP, UDP, and DNS
access to the host or internet is blocked. A host gateway exposes one Unix
request socket at `/run/agent-network.sock`; its separate administration
socket and session policy are hidden from the sandbox. Stop and relaunch
existing sandboxes to use this policy.

The launcher starts and stops the gateway with the sandbox. A second session
with the same name is refused. Grants live only in memory and disappear on
restart. Runtime sockets are under `~/.local/state/agent-network/NAME`, or
`AGENT_NETWORK_ROOT` if set in the host shell. That directory must be owned
by you, mode 700, without symlinks or overlap with writable project, Git,
state, or overlay mounts. Use the same root for the launcher and host CLI.
Run `./setup.sh` to add the new `sandbox-net` and `sandbox-http` commands to
`~/.local/bin`; inside a sandbox they are available directly from tooling.

### Provider transport

A loopback proxy relays CONNECT tunnels through the gateway. The launcher
sets uppercase and lowercase HTTP(S)/ALL proxy variables, clears NO_PROXY,
and enables Node's environment proxy support with `NODE_USE_ENV_PROXY=1`.
Clients must support these variables; clients that ignore them fail closed.
TLS stays end to end. Provider-side search can work through the provider API;
local URL fetches and MCP connections still need permitted transport.

Default exact hosts on port 443 are:

| Harness | Hosts |
| --- | --- |
| Codex | `api.openai.com`, `chatgpt.com`, `auth.openai.com` |
| Claude | `api.anthropic.com`, `platform.claude.com` |
| Cursor | `api2.cursor.sh`, `api5.cursor.sh` |
| Pi and shell | None; specify the provider explicitly |

Add an exact custom provider at launch with repeatable
`--provider-host HOST`, for example:

```sh
sandbox pi --provider-host api.anthropic.com
```

No wildcards, private provider addresses, or alternate provider ports are
allowed. Login, telemetry, updates, additional Cursor endpoints, and custom
providers can need other hosts. Add only the required host; inspect
`sandbox-net denied NAME` for denied CONNECT attempts. An allowed provider
host permits arbitrary opaque traffic to that host, including calls from
agent tools. CONNECT cannot restrict methods, paths, or bodies. Provider
tunnels are broader exceptions than the scoped requests below.

### Scoped HTTP requests

From a host shell, grant a finite number of requests with an expiry:

```sh
sandbox-net allow NAME --url 'https://example.com/api?q=1' --method POST --ttl 10m --requests 1
sandbox-net list NAME
sandbox-net denied NAME
sandbox-net revoke NAME GRANT_ID
```

Inside the running sandbox, `echo "$AGENT_SANDBOX"` gives NAME. The agent
can then run:

```sh
sandbox-http POST 'https://example.com/api?q=1' --body-file payload.json --header 'Content-Type: application/json' --output response.json
```

The grant matches the normalized scheme, exact host and port, method, path,
and query. It does not constrain request body or ordinary header contents.
`--path-prefix` also admits descendants at a slash boundary; `--any-query`
admits any query on the allowed path. `--allow-private` explicitly permits
loopback, private, link-local, and other non-public addresses. Without it,
any non-public DNS answer rejects the request. DNS answers are resolved once
per request and the actual TCP connection uses those checked addresses.
HTTPS verifies certificates and hostnames. Redirects are returned without
following them and need a separate grant. Ambiguous paths, credentials in
URLs, URL fragments, and HTTP framing/Host overrides are rejected.

TTL accepts seconds or suffixes `s`, `m`, and `h`. Grant counts are consumed
atomically before an upstream attempt, including failed connections.
Revocation and expiry affect new attempts; they cannot recall bytes already
sent by an authorized request. Bodies and responses are limited to 16 MiB,
with a 30-second upstream socket timeout. The client prints the HTTP status
on stderr, writes response bytes to stdout or `--output`, and exits nonzero
for gateway failures or HTTP status 400 and above. Denied-request history is
in memory and retains the last 100 entries; URLs may contain sensitive query
values, so avoid putting secrets in URLs.

These grants support individual HTTP(S) requests through `sandbox-http`.
They do not provide general package-manager, Git, SSH, WebSocket, streaming,
or arbitrary TCP/UDP access. Run necessary installs or other unsupported
operations from the host. Filesystem Unix sockets in other deliberately
mounted host directories remain a separate capability; review such mounts
before exposing local services. Network isolation does not prevent sharing
data through writable host files or sending it to allowed provider hosts.

Proxy behavior references: [Claude network configuration](https://code.claude.com/docs/en/network-config),
[Cursor network configuration](https://prod.cursor.com/docs/enterprise/network-configuration),
and [Node environment proxy support](https://nodejs.org/api/cli.html#node_use_env_proxy1).

Verification on this checkout covered real Bubblewrap direct-network denial,
hidden administration sockets, live grant/revoke/restart behavior, concurrent
request counts, TTL, private destinations, DNS pinning, redirects, headers,
provider relay bytes, duplicate launches, and SIGTERM cleanup. Codex 0.160.0
completed an authenticated model turn through the isolated proxy. Claude's
installed OAuth session was expired and could not refresh even with its
token host permitted, so live Claude inference remains unverified. Pi's installed HTTP dispatcher reached the Anthropic API through the proxy
and received the expected unauthenticated HTTP 401. Cursor and Pi model turns,
provider-side search, and interactive Ctrl-C were not exercised.
