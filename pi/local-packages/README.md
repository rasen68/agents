# Local Pi packages

These sources are deliberate local forks. Each package retains its upstream
manifest and license. Pi loads their TypeScript entry points directly from
this checkout. They don't need a compilation step or a shared build dependency.

## Parallel sessions

Based on `pi-parallel-sessions` 0.2.8. The fork retains the local session
lifecycle, naming, saved-session picker, and live-session exclusion changes.
Existing regression tests are included under `pi-parallel-sessions/tests/`.

## Goals and compaction

The `pi-goal-x` 0.32.3 local fork supplies the unified Alt+G goals screen and
`/goals` command. Goal creation is user-owned; the model's `create_goal` tool
isn't registered. Sources, design notes, recovery script, and existing tests
are retained. See `pi-goal-x/docs/local-fork.md` for the fork's decisions.
`pi-codex-compaction` remains an upstream npm package, as in the live setup.

## Install

Run from the repository with Pi and Node on PATH:

```sh
node pi/install.mjs
./setup.sh
```

The installer installs the npm declarations in `pi/settings.json`, then
reconciles managed package declarations while preserving unrelated packages,
preferences, and device identity. Local package declarations become absolute
checkout paths. It doesn't delete existing host copies. The upstream npm
registrations have extensions disabled so Pi doesn't load both implementations.

Existing fork tests are retained for later use. Standalone tests need Pi's host
peer packages available through `node_modules`; normal extension loading uses
Pi's host-module mapping. Dependency directories aren't stored in Git. The
parallel session suite passed during import before the owner requested no further
tests. The imported goal suite wasn't run during this migration. Provider-backed
execution and interactive terminal behavior weren't checked.
