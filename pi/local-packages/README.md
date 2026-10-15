# Local Pi packages

These sources are deliberate local forks. Each package retains its upstream
manifest and license. Pi loads them from this checkout rather than overwriting
them during `pi update --extensions`.

## Claude bridge

Based on `pi-claude-bridge` 0.9.1. The fork compiles TypeScript ahead of time,
delays the Claude Agent SDK and MCP server until the first Claude operation,
and imports only the needed Pi modules through a generated `@local/pi-host`
facade. Module boundaries and deferred UI imports are preserved.

The pinned upstream npm registration has `extensions: []`. It installs runtime
dependencies without also loading the upstream factory. Don't remove that
registration without supplying independent dependencies for the fork.

## Build and verify

Use the managed Pi installation with Node >=22.19. Run from the repository:

```sh
node pi/install.mjs
./setup.sh
npm --prefix pi/local-packages test
```

The installer installs the npm declarations in `pi/settings.json`, restores the
pinned build dependency with `npm ci --ignore-scripts`, and builds local sources.
It then reconciles managed package declarations while preserving unrelated
packages, preferences, and device identity. Local package declarations become
absolute checkout paths. It doesn't delete existing host copies.

For an already installed dependency tree, rebuild without installing anything:

```sh
npm --prefix pi/local-packages run build
npm --prefix pi/local-packages test
```

The build uses `PI_CODING_AGENT_DIR` or `~/.pi/agent` to find the managed release
and Pi's installed npm packages. Generated files and dependency links are ignored
by Git. The host facade follows `install/current-version` at load time, including
after an old release is deleted. It uses internal Pi module paths, so rebuild and
test after upgrading Pi, then restart existing sessions.

Verified with Pi 1.2.0 and Node 24.19.0. Checks compare upstream and compiled
registrations, exercise teardown/reload, verify deferred SDK/MCP loading, and
execute an MCP tool through an in-memory transport. They don't send model
requests. Live Claude responses and interactive terminal behavior aren't covered.
The removed todo and questionnaire packages aren't part of this build.
