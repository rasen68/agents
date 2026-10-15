# Pi configuration

`../setup.sh` copies settings and keybinding defaults into `~/.pi/agent` only
when those files don't exist. Pi can update its own copies without modifying
this checkout. Existing settings, authentication, device identity, and sessions
stay local. Model names are personal defaults and require a provider that offers
them. Choose another model in `/model` if necessary.

Extensions and supporting directories are linked by setup. Existing real files
and directories are preserved, as with the rest of setup. To adopt a repository
version over an existing local copy, move the local copy to a backup outside
Pi's discovery paths, then rerun setup. Don't leave extension backups under
`extensions/`, where Pi would load them too.

`../install-clis.sh` installs the npm packages in `settings.json` and registers
the local forks from this checkout. To update just those package declarations,
run `node pi/install.mjs` with Pi and Node on PATH. See
[`local-packages/README.md`](local-packages/README.md) for the retained forks.

The Claude bridge isn't configured. Credentials, device IDs, runtime binaries,
and generated dependency directories remain outside Git.
