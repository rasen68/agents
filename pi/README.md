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

Checks that don't make model requests:

```sh
python3 -B -m unittest discover -s tests -p 'test_pi*.py' -v
```
