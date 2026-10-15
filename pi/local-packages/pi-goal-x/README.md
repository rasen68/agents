# pi-goal-x local fork

This fork of `pi-goal-x@0.32.3` puts goal management in a single screen. Press **Alt+G** or run **`/goals`**. Ctrl+G still opens Pi's external editor.

## Goals screen

The screen replaces the prompt at the bottom of the terminal, like Pi's sessions picker, rather than floating over the conversation. It uses only the space its content needs, up to 18 lines or half the terminal height, with a five-line minimum when the terminal has room. Empty lists show a compact creation hint without a split-pane divider. Wide terminals show a goal list on the left and the selected goal's details on the right. Narrow terminals stack them. The detail panel includes the objective, status, usage, task tree, verification requirements, evidence, and recent activity from the goal ledger.

Browsing the list doesn't focus a goal or start execution. `*` marks the session's focused goal; `>` marks the goal you're previewing.

| Key | Action |
| --- | --- |
| Up / Down | Preview another goal. |
| Page Up / Page Down | Scroll the selected goal's details. |
| Home / End | Jump to the start or end of the details. |
| `n` | Create a regular or Sisyphus goal. Guided planning and confirmation is the default; direct creation is also available. |
| `f` | Focus the selected goal and start its continuation if it is active. Closes the screen. |
| `p` | Pause or resume the selected goal. Resume closes the screen so execution can continue. |
| `e` | Revise the selected goal through guided drafting and confirmation. Closes the screen for discussion. |
| `u` | Unfocus the current goal without closing it. Stops the current turn. |
| `a` | Archive the selected goal after confirmation. This abandons an unfinished goal, not certifies completion. |
| `s` | Open goal settings. The Scope row switches between project and global settings. |
| `v` | Toggle the selected goal's completion auditor. |
| `c` | Cancel the active, unconfirmed draft. |
| `t` | Open troubleshooting: verbose status, health, refresh, recovery, or confirmed storage repair. Reports appear in the transcript. |
| `?` | Show all actions as a selectable menu. |
| Esc / Alt+G | Close the screen without changing the goal. |

Actions that operate on an existing goal select it as the session focus. Cancelling a revision input or archival confirmation leaves focus unchanged. Settings, troubleshooting, and draft cancellation don't select another goal.

## Goal execution

Regular goals describe an outcome and let the agent adapt the plan. Sisyphus goals describe ordered steps and per-step completion criteria. Guided creation lets the agent clarify requirements and propose the objective, tasks, and verification contract. No persistent goal is created until you confirm.

The existing scheduler, persistence, task tools, and independent completion auditor remain in use. Goal creation belongs to the user through the screen's `n` action; no `create_goal` model tool is registered. The agent can inspect and update existing goals with `get_goal`, `update_goal`, and the task tools. During a user-started guided draft, it can propose a goal, but creation still requires your confirmation. The old goal slash commands are intentionally removed; `/goals` is the sole entry command.

The above-editor progress widget remains available. Ctrl+Shift+T expands it, and Ctrl+Shift+A toggles the focused goal's auditor.

## Local setup and verification

Pi loads this directory through `~/.pi/agent/settings.json`. The original npm package remains installed but its extensions are disabled, so npm updates don't replace this fork.

This checkout links `node_modules` to the currently installed Pi release for tests and types. After a Pi upgrade, update that link to the new release if the old one is removed. Pi's extension loader supplies host packages during normal execution.

Run from this directory:

```sh
npm test
npm run check
npm run test:integration
```

The local suite covers screen layout, navigation, lifecycle dispatch, draft creation and cancellation, archival safeguards, and loading through Pi's actual extension loader. The compiler checks all extension sources and local tests. The upstream npm tarball doesn't include its original tests or benchmark runners, so those aren't available here.

See [Local fork notes](docs/local-fork.md) for the agreed design, maintenance details, and rollback.

## License

MIT, retaining the upstream license.
