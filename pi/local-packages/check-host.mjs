import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = dirname(fileURLToPath(import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'pi-host-test-'));
const modules = {
  'config.js': ['CONFIG_DIR_NAME', 'getAgentDir'],
  'core/session-manager.js': ['buildSessionContext'],
  'core/compaction/compaction.js': ['compact'],
  'core/compaction/branch-summarization.js': ['generateBranchSummary'],
  'core/skills.js': ['formatSkillsForPrompt'],
  'modes/interactive/components/keybinding-hints.js': ['keyHint'],
};
try {
  const facade = join(temporary, 'local-packages/node_modules/@local/pi-host/index.js');
  mkdirSync(dirname(facade), { recursive: true });
  writeFileSync(join(dirname(facade), 'package.json'), '{"type":"module"}');
  writeFileSync(facade, readFileSync(join(root, 'node_modules/@local/pi-host/index.js')));
  for (const version of ['test-old', 'test-new']) {
    const host = join(temporary, 'install/releases', version, 'node_modules/@earendil-works/pi-coding-agent');
    mkdirSync(host, { recursive: true });
    writeFileSync(join(host, 'package.json'), '{"type":"module"}');
    for (const [path, names] of Object.entries(modules)) {
      const target = join(host, 'dist', path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, names.map(name => `export const ${name} = ${JSON.stringify(version)};`).join('\n'));
    }
    writeFileSync(join(temporary, 'install/current-version'), version + '\n');
    const output = execFileSync(process.execPath, ['--input-type=module', '-e',
      `const host = await import(${JSON.stringify(pathToFileURL(facade).href)}); console.log(JSON.stringify(host));`
    ], { encoding: 'utf8', env: { ...process.env, PI_CODING_AGENT_DIR: temporary } });
    const exports = JSON.parse(output);
    assert.equal(Object.keys(exports).length, 7);
    assert.ok(Object.values(exports).every(value => value === version));
    if (version === 'test-old') rmSync(join(temporary, 'install/releases', version), { recursive: true });
  }
  console.log('PASS: host facade follows managed version changes after the old release is removed');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
