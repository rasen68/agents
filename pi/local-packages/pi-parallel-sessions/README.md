# pi-sessions

`pi-sessions` turns one Pi process into an in-process live-session multiplexer.

Multiple Pi sessions can stay alive concurrently. Exactly one session owns the terminal at a time. Switching away stops only the inactive TUI, with its agent runtime still running in background.

![pi-sessions switcher UI](screenshot.png)

## Install

```bash
pi install npm:pi-parallel-sessions
```

Or install directly from GitHub:

```bash
pi install git:github.com/liushihao456/pi-sessions
```

## Command

Only one slash command is exposed:

- `/sessions` — open the session switcher.

Shortcut:

- `Alt-A` — open the same session switcher without typing `/sessions`.

The switcher creates, resumes, switches, and stops sessions. `/quit` also closes
the current session.

## Combined switcher (local fork)

Alt-A and `/sessions` list live sessions first, preserving their status ordering,
then saved sessions newest first. Saved sessions belong to the current working
directory or its subdirectories. Sessions already live in this Pi process are
excluded from the saved section by native session ID or session file. The picker
reads identity directly from live session managers so exclusions also work after
`/reload` retains a host instance. Live
sessions remain visible regardless of directory. Saved history loads once each
time the picker opens; live status refreshes while it is open. Native `/resume`
is unchanged.

The saved section initially shows at most five sessions, followed by `...` when
more exist. Moving down from the fifth saved session expands the list and selects
the sixth. The ellipsis isn't selectable and Enter doesn't expand the list.
Expansion persists until the picker closes or the search query changes.

## Switcher keys

- `j` / `k`, `↑` / `↓`, or `Ctrl-P` / `Ctrl-N` move selection.
- `/` starts fuzzy search across both sections, preserving live-first ordering.
  While searching, typing edits the query and arrow keys or Ctrl-P/Ctrl-N move
  selection. Letter shortcuts are disabled. Esc clears search and returns to
  normal navigation; a second Esc closes the picker.
- `n` creates a session in the current folder and switches to it.
- `Enter` switches to a selected live session or resumes a saved session as a
  live session.
- `Ctrl-O` opens the folder explorer; selecting a folder creates a session there.
- `Ctrl-R` opens the separate searchable saved-session picker with the same
  directory scope and live-session exclusions.
- `d` or `Ctrl-K` stops any selected live session, including the initial one.
  Saved history is retained. Saved sessions aren't running and cannot be stopped.
  Closing the active session switches to the most recently used remaining one;
  closing the last live session exits Pi.
- `Esc` closes the switcher outside search mode.

### Regression tests

With Pi's peer packages available locally, run from this package directory:

```bash
node --test tests/*.test.mjs
```

The tests use Pi's installed Jiti loader and real TUI input components. They
cover directory scope, duplicate exclusions, ordering, navigation, resume and
switch dispatch, search, refresh selection, error handling, scrolling, and
terminal-width limits, the five-row saved preview with scroll-to-expand, and
live-session exclusions across extension reloads with stale host metadata.
Lifecycle regressions also cover initial-session disposal, native quit routing,
most-recently-used fallback, concurrent shutdown, pending input, replacement
identities, lock cleanup, initialization failures, and fullscreen teardown.
The personal overlay has a real-Pi PTY regression runner for terminal handoff,
quit, history preservation/resume, fullscreen, replacement/reload, and signals.
Provider-backed generation still needs a manual check.

## Automatic topics and titles (local fork)

After each successful completed text answer, this fork asks `openai/gpt-6-luna`
to keep the current topic or supply a new 3–6-word label when the subject changes.
It supplies the latest user message, capped at 4,000 characters, and the answer,
capped at 6,000 characters. Tool output and reasoning are excluded. Aborted,
failed, truncated, and intermediate tool-call responses do not trigger naming.

Requests run in the background, serialized per session, with a 15-second deadline
and a 128-token output cap. They use Pi's model registry and credentials without
changing the main agent's model. Missing models, invalid output, and provider
failures do not interrupt the agent. Usage is recorded in the session.

Topic changes and completion checkpoints are stored as `pi.transcript-topic`
custom entries outside model context, anchored to user/answer entry IDs. They
survive reloads and are searchable through the transcript-memory skill's CLI.
There is no archive-wide topic backfill.

Automatically managed display titles follow topic changes in the picker and
widget. Manual titles are never overwritten, including renames made during a
pending request. Existing titles without recorded automatic provenance are
preserved as manual. Topic tracking continues independently of manual titles.

This is a local fork of npm `pi-parallel-sessions@0.2.8`. Pi settings disable
that upstream extension and load this directory instead. No build is needed.
To roll back, remove the local package entry and replace the disabled upstream
object with `"npm:pi-parallel-sessions@0.2.8"`, then restart Pi.

## Runtime model

```text
Pi process
  └─ pi-sessions host
      ├─ session A: AgentSessionRuntime + InteractiveMode
      ├─ session B: AgentSessionRuntime + InteractiveMode
      └─ session C: AgentSessionRuntime + InteractiveMode
```

All sessions use real native `InteractiveMode` instances. The host adopts Pi's
initial runtime into the same registry and lifecycle as newly created sessions.
There's no protected parent entry or permanent fallback conversation. Switching
pauses terminal input/rendering for the inactive mode, not its agent runtime.

`/quit`, Ctrl-D on an empty editor, and native double-Ctrl-C exit actions close
only that session. Normal generation interrupts keep their native behavior.
The host exits when the last live session closes. SIGTERM and SIGHUP shut down
all sessions and then exit the process. Session shutdown releases runtime
resources, terminal handlers, and path locks without deleting saved history.

Restart Pi once to load this architecture. An already running parent-based
host cannot be converted with `/reload`. After the restart, normal extension
reloads preserve the host and its live sessions. This integration uses Pi's
internal InteractiveMode lifecycle and should be rechecked after Pi upgrades.

## Path locks

All live sessions share one in-process lock manager. Before write/edit/mutating shell tools run, `pi-sessions` checks for conflicting path locks and blocks conflicting writes.

This prevents two live sessions from editing the same path tree at once.
