import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class PiInstallTests(unittest.TestCase):
    def test_installs_declared_packages_and_preserves_personal_settings(self):
        self.run_installer(fail=False)

    def test_build_failure_does_not_activate_local_forks(self):
        self.run_installer(fail=True)

    def run_installer(self, fail):
        with tempfile.TemporaryDirectory() as temporary:
            temporary = Path(temporary)
            agent = temporary / 'agent'
            agent.mkdir()
            binary = temporary / 'bin'
            binary.mkdir()
            log = temporary / 'commands'
            for command in ['pi', 'npm']:
                path = binary / command
                path.write_text('#!/bin/sh\n'
                                f'printf "%s\\n" "{command} $*" >> "$COMMAND_LOG"\n'
                                'if [ "$FAIL_BUILD" = 1 ] && [ "$1" = --prefix ] && '
                                '[ "$3" = run ]; then exit 7; fi\n')
                path.chmod(0o755)
            original = {'deviceId': 'private', 'defaultModel': 'personal',
                        'packages': ['npm:unrelated', 'npm:pi-claude-bridge']}
            settings = agent / 'settings.json'
            settings.write_text(json.dumps(original))
            result = subprocess.run(['node', str(ROOT / 'pi/install.mjs')],
                                    cwd=temporary, capture_output=True, text=True,
                                    env={**os.environ, 'PATH': f'{binary}:{os.environ["PATH"]}',
                                         'PI_CODING_AGENT_DIR': str(agent),
                                         'COMMAND_LOG': str(log), 'FAIL_BUILD': str(int(fail))})
            current = json.loads(settings.read_text())
            if fail:
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(current, original)
                return
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(current['deviceId'], 'private')
            self.assertEqual(current['defaultModel'], 'personal')
            self.assertIn('npm:unrelated', current['packages'])
            self.assertIn(str(ROOT / 'pi/local-packages/pi-claude-bridge'), current['packages'])
            defaults = json.loads((ROOT / 'pi/settings.json').read_text())
            expected = [entry if isinstance(entry, str) else entry['source']
                        for entry in defaults['packages']]
            installed = [line.removeprefix('pi install ') for line in log.read_text().splitlines()
                         if line.startswith('pi install ')]
            self.assertEqual(installed, [entry for entry in expected if entry.startswith('npm:')])
            self.assertFalse(list(agent.glob('*.tmp')))


if __name__ == '__main__':
    unittest.main()
