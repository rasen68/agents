import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class PiSetupTests(unittest.TestCase):
    def run_setup(self, home):
        subprocess.run(['bash', str(ROOT / 'setup.sh')], check=True,
                       env={**os.environ, 'HOME': str(home)}, capture_output=True)

    def test_seeds_portable_config_without_linking_mutable_settings(self):
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary)
            self.run_setup(home)
            agent = home / '.pi/agent'
            for name in ['settings.json', 'keybindings.json']:
                self.assertEqual(json.loads((agent / name).read_text()),
                                 json.loads((ROOT / 'pi' / name).read_text()))
                self.assertFalse((agent / name).is_symlink())
            settings = json.loads((agent / 'settings.json').read_text())
            self.assertNotIn('deviceId', settings)
            self.assertNotIn('lastChangelogVersion', settings)

    def test_preserves_existing_config_on_repeated_setup(self):
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary)
            agent = home / '.pi/agent'
            agent.mkdir(parents=True)
            for name in ['settings.json', 'keybindings.json']:
                (agent / name).write_text('{"personal": true}\n')
            self.run_setup(home)
            self.run_setup(home)
            for name in ['settings.json', 'keybindings.json']:
                self.assertEqual((agent / name).read_text(), '{"personal": true}\n')


if __name__ == '__main__':
    unittest.main()
