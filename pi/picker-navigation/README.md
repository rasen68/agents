# Empty-search picker navigation

`../extensions/picker-navigation.ts` adds `j` (down) and `k` (up) alongside
arrow navigation in Pi pickers whose search is exactly empty. With any search
text present, j/k remain text. Main prompts, input dialogs, session renaming,
and tree label editing are unchanged. To search for a leading j/k, paste the
query rather than typing its first character into an empty picker.

Both main-screen and fullscreen TUI classes are intercepted. The extension
recognizes Pi 1.0.0 picker shapes and pi-parallel-sessions picker shapes;
unknown custom extension screens are deliberately left alone. It uses an
internal terminal-input method because conditional picker bindings are not
available through keybindings.json. Recheck compatibility after upgrading Pi.
Hooks are shared across parallel runtimes and removed on session shutdown.

The extension and this directory are tracked under `pi/` in this repository.
`setup.sh` links them under `~/.pi/agent`, preserving existing real copies.
Run `/reload` after editing. Remove the extension's installed link and reload
to disable. Run `node --test tests/pi-picker.test.mjs` from the repository to
check picker recognition and hook cleanup without starting Pi.
