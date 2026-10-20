# Nav

One personal Pi extension for directory changes, reasoning shortcuts, picker
navigation, and transcript navigation. Loaded automatically from `~/.pi/agent/extensions/nav/index.ts`.
Run `/reload` in an existing Pi session to load it.

- `/cd` changes directory while keeping the conversation.
- `Alt+n` toggles [transcript navigation](transcript.md), using Pi's native
  message rendering. Counted j/k or Up/Down scroll; h/l or Left/Right jump
  between assistant replies. Every open starts at the bottom.
- `Alt+j` decreases the reasoning level and `Alt+k` increases it, within the
  active model's supported levels. Neither wraps at the ends.
- `j` moves down and `k` moves up in recognized pickers when their search is
  exactly empty. With search text present, both keys remain text. Main prompts,
  input dialogs, session renaming, and tree label editing are unchanged. Paste
  a query to search for a leading j/k in an empty picker.

Picker navigation intercepts both main-screen and fullscreen terminal input.
It recognizes Pi and pi-parallel-sessions picker shapes, leaving unknown custom
screens alone. This uses an internal method because conditional picker bindings
aren't available through keybindings.json. Recheck compatibility after Pi upgrades.
Hooks are shared across parallel runtimes and removed on session shutdown.

`setup.sh` links this directory and removes obsolete repository-generated links
for the former `cd`, `reasoning-shortcuts`, and `picker-navigation` extensions.
It preserves real copies. Before adopting `nav` over real copies, move those old
extensions and `~/.pi/agent/picker-navigation` to a backup outside Pi's discovery
paths, then rerun setup. Don't load the old extensions alongside `nav`.

## /cd

```text
/cd /absolute/path
/cd ../another-project
/cd ~/Downloads/program
/cd "path with spaces"
/cd
```

With no argument, `/cd` uses your home directory. Relative paths use the active
agent directory, not the shell directory where Pi originally started. The full
argument is treated as one path; quotes around it are optional. It doesn't
execute shell expansions or support `cd -`.

## Session behavior

Pi 1.1.0 has no public API to change a live session's working directory.
`process.chdir()` alone would leave tools and project resources using the old
workspace. This extension copies the session into a new file with the destination
as its working directory, then uses Pi's supported `switchSession()` API.

The user selected this behavior instead of starting with an empty conversation.
The original session is left untouched. The copy retains all stored entries,
including alternate branches, compaction, and extension state. A final custom
entry points to the selected leaf so reloading doesn't select an abandoned
branch. It also works before the first message, using entries held in memory.

Every directory change creates a new session ID and file in Pi's normal session
storage for the destination. The new header references the source session as its
parent. A cancelled switch removes the unused copy. Switching to the same path
is a no-op. If switching throws, the copy remains available for recovery.

Pi recreates its cwd-bound runtime, including built-in tools, project instructions,
settings, and extensions. Its normal project-trust checks still apply. Extension
resources are restarted just as they are with `/resume`. Session state held only
in an extension's memory, queued messages, and tool activation that isn't persisted
may not survive. The shell that launched Pi is not changed.

## Verification

```bash
node --test pi/extensions/nav/tests.mjs
```

The test runner discovers the current managed Pi install. For another installation,
set `PI_TEST_INSTALL` to its `node_modules` directory.

Tests use the managed Pi installation and cover combined registration and
reversible picker hooks as well as path
validation, unsaved sessions, source preservation, active branches, cancellation,
and fresh-context use. The integration test loads the actual extension through
Pi's resource loader, invokes `/cd` through `session.prompt()`, and checks the
replacement runtime's cwd, project instructions, and relative paths in `bash`,
`read`, `write`, and `edit`. It makes no model calls and uses temporary workspaces.

Manual terminal check, not yet performed:

1. Run `/reload`.
2. Run `/cd /path/to/project` and check the directory in the footer.
3. Run `!pwd` and confirm the destination.
4. Run `/cd ..` and confirm that it resolves from the destination.

## Implementation references

- Installed `docs/extensions.md`: command registration and `withSession()`.
- Installed `docs/sdk.md`: cwd-bound services and runtime replacement.
- Installed `docs/session-format.md`: session headers and tree entries.
- Installed `docs/security.md`: project trust on resource discovery.
- Installed `dist/core/agent-session-runtime.js`: `switchSession()` recreates services
  using the destination session header's cwd.
