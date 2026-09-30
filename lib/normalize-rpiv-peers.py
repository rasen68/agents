"""Normalize rpiv manifests to use Pi host modules as peer dependencies."""

import json
import os
from pathlib import Path

agent_dir = Path(os.environ.get('PI_CODING_AGENT_DIR', '~/.pi/agent'))
scope = agent_dir.expanduser() / 'npm/node_modules/@juicesharp'
host_packages = (
    'typebox',
    '@earendil-works/pi-ai',
    '@earendil-works/pi-agent-core',
    '@earendil-works/pi-coding-agent',
    '@earendil-works/pi-tui',
)
for path in sorted(scope.glob('rpiv-*/package.json')):
    manifest = json.loads(path.read_text())
    dependencies = manifest.get('dependencies', {})
    peers = manifest.get('peerDependencies', {})
    changed = False
    for package in host_packages:
        if package in dependencies or package in peers:
            changed |= package in dependencies or peers.get(package) != '*'
            dependencies.pop(package, None)
            peers[package] = '*'
    if changed:
        manifest['peerDependencies'] = peers
        path.write_text(json.dumps(manifest, indent=2) + '\n')
        print(f'Normalized host peers in {manifest["name"]}')
