# Pi configuration

`../setup.sh` copies settings and keybinding defaults into `~/.pi/agent` only
when those files don't exist. Pi can update its own copies without modifying
this checkout. Existing settings, authentication, device identity, and sessions
stay local. Model names are personal defaults and require a provider that offers
them. Choose another model in `/model` if necessary.

The [`nav` extension](extensions/nav/README.md) combines `/cd`, reasoning-level
shortcuts, empty-search picker navigation, and an Alt+N transcript viewer.
Use counted j/k or Up/Down to scroll, and h/l or Left/Right to jump between
assistant replies. Alt+N returns to the prompt; every open starts at the bottom.
Setup removes obsolete links for the three former extensions only when they
point into this checkout.

The [`pi-code-blocks` extension](extensions/pi-code-blocks/README.md) renders
assistant code fences with `batcat` or `bat` syntax colors, line numbers, and
borders. It also hides `.md` edit previews, diffs, and write contents, leaving
only the tool label and path. Errors remain visible; other file types are unchanged.
Requires Pi 1.3.0 or later.

The [`transcript-memory` extension](extensions/transcript-memory/README.md) adds
`transcript_search` and `transcript_read` for bounded historical retrieval.
The parallel-sessions fork records searchable topic history after completed
answers while preserving manual titles. Existing transcripts are searchable
without a model-based backfill.

Extensions and supporting directories are linked by setup. Existing real files
and directories are preserved, as with the rest of setup. To adopt a repository
version over an existing local copy, move the local copy to a backup outside
Pi's discovery paths, then rerun setup. Don't leave extension backups under
`extensions/`, where Pi would load them too.

`../install-clis.sh` installs the npm packages in `settings.json` and registers
the local forks from this checkout. To update just those package declarations,
run `node pi/install.mjs` with Pi and Node on PATH. See
[`local-packages/README.md`](local-packages/README.md) for the retained forks.
