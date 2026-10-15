# Unified goals screen local fork

## Agreed design

Replace pi-goal-x's individual slash commands with one list-and-detail screen. Alt+G opens it, and `/goals` is the fallback entry command. Keep Ctrl+G assigned to Pi's external editor. The screen replaces the bottom prompt area, like Pi's sessions picker. Wide terminals show two panels; narrow terminals stack them. Browsing is read-only. Lifecycle actions require a separate keypress, and archival requires confirmation.

Creation supports regular and Sisyphus goals, guided by default, with direct creation available in the screen. Goal creation is user-owned. Keep inspection, lifecycle, task, and user-started drafting tools, but don't register `create_goal`. Preserve the goal-file format, scheduler, task tracking, and completion auditor. Put settings and troubleshooting in the screen rather than registering more commands.

## Implementation

Based on the installed npm tarball `pi-goal-x@0.32.3`. Local version: `0.32.3-local.1`.

- `extensions/widgets/goals-screen.ts` renders the goal list and a scrollable detail panel from live snapshots and the existing dashboard model. Short content isn't padded to the height limit, and an empty list has no split-pane divider. Width helpers handle Unicode and ANSI display widths. It has no timer or separate terminal renderer.
- `extensions/goal-commands.ts` registers only `/goals` and Alt+G. It uses inline `ctx.ui.custom()` rather than an overlay, which restores the prompt and its text when closed. The height limit is recalculated on render, capped at 18 lines or half the terminal height, with a five-line minimum clipped to the available rows. The screen dispatches through existing drafting, scheduler, settings, and lifecycle operations. Modal-depth guards prevent Escape in the screen from pausing a goal behind it. Resume, focus/start, and drafting close the screen to return control to execution or discussion.
- Pause aborts a busy turn as well as persisting the paused state. Archive cancellation doesn't change focus. Archival validates focus and the captured goal revision after confirmation, retains the goal when storage rejects the operation, and doesn't report failure as success.
- Model prompts, notifications, and unfocused reminders point to screen actions rather than removed slash commands. The settings menu's Scope row permits switching between project and global settings.

Actions on a selected goal select it as the session focus, except previews, cancelled input, and cancelled archival. Unfocus always operates on the currently focused goal, not the preview. The goal list shows open goals; archived records remain in existing goal storage.

## Activation and rollback

`~/.pi/agent/settings.json` disables extensions from the upstream npm package and loads `./local-packages/pi-goal-x`. Run `/reload` or restart Pi to load the fork in an existing session. Other live sessions need their own reload.

To roll back, remove the local package entry and replace the disabled upstream object with the string `npm:pi-goal-x`, then reload. Existing goals don't require migration in either direction.

The installed npm copy remains unchanged. Compare the fork with it using:

```sh
diff -qr ~/.pi/agent/npm/node_modules/pi-goal-x ~/.pi/agent/local-packages/pi-goal-x
```

When updating upstream, keep a copy of this fork and port its changes deliberately. Don't overwrite it with an npm update. The retained upstream design documents describe upstream interfaces; the local README supersedes their command references.

## Verification

Run from `pi/local-packages/pi-goal-x` in this repository:

```sh
npm test
npm run check
npm run test:integration
```

Verified results:

- 31 local tests pass. Regression tests cover inline placement, resize-dependent height limits, and compact empty and short-content layouts. Coverage includes preview navigation, every action key, detail scrolling, responsive layouts at 1–140 columns and short terminal heights, live snapshots, goal removal, opening without execution, focus/start, pause/abort, resume, guided and direct creation, draft cancellation, revision, unfocus, cancelled archival, revision conflicts, archival failure, non-terminal behavior, and modal cleanup after errors.
- Strict TypeScript checking passes for all extension sources and local tests.
- Pi 1.1.0's actual extension loader accepts the entry point, registers only `/goals` and Alt+G, and retains inspection, lifecycle, task, and drafting tools without registering `create_goal`. Execution-profile tests exclude creation both with and without a focused goal.
- `pi list` resolves both package entries, with upstream extensions filtered out and the local path enabled.

The upstream npm tarball doesn't ship its original test suite or benchmarks. Full upstream regressions weren't run. Provider-backed execution, auditing, and interactive terminal behavior need a manual smoke test. No real goal was created or modified during these checks.

## User-owned creation decision

The owner requested removal of agent goal creation. The direct `create_goal` registration and its execution-profile entries were removed, rather than relying on a model instruction or hiding an otherwise callable tool. Unfocused responses now direct the user to the goals screen. Screen creation and confirmed proposals from user-started guided drafts remain available. This supersedes the original choice to retain all upstream model tools.

Regression tests first failed with creation still registered, then passed after removal. Verification used `npm test` with 31 passing tests, `npm run check`, and `npm run test:integration`. Reload each live Pi session to replace its tool registrations. This removes the extension's creation tool; it isn't a filesystem permission boundary against agents with general file-writing tools.

## Manual smoke test

1. Run `/reload`, type some unsent prompt text, then press Alt+G. Confirm the screen appears in place of the prompt at the bottom, not as a centered overlay. With no open goals, it should occupy only a few lines without a vertical divider. Close it and confirm your unsent text returns. Confirm Ctrl+G still opens the external editor.
2. Browse existing open goals with the arrow keys. Check that browsing doesn't change the `*` focus marker or start work.
3. Resize the terminal and scroll long details with Page Up/Page Down.
4. Press Esc to close the screen. It should leave the goal state unchanged.
5. In a disposable project, use `n` to start guided creation. Confirm the goal only after reviewing the proposal. Use Alt+G, then `p` to pause and resume execution.
6. Cancel an archival confirmation and verify the goal remains open. Archive only a disposable goal when checking successful archival.

## Dependencies

Normal extension execution uses Pi's host-module mapping. Standalone tests
and type checks need the host peer packages available through `node_modules`.
No dependency directory is stored in Git. The check command obtains TypeScript
5.9.3 through npm's exec cache. Verification results above describe work before
this repository migration; the goal suite wasn't rerun during the migration.
