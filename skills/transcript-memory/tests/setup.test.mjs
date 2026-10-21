import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, readlink, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const repo = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'memory-setup-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const extension = join(home, '.pi/agent/extensions/transcript-memory');
  await mkdir(join(home, '.pi/agent/extensions'), { recursive: true });
  return { home, extension, run: () => spawnSync('bash', [join(repo, 'setup.sh')], {
    env: { ...process.env, HOME: home }, encoding: 'utf8',
  }) };
}

test('setup installs the skill and removes only its own former extension link', async t => {
  const { home, extension, run } = await fixture(t);
  await symlink(join(repo, 'pi/extensions/transcript-memory'), extension);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  await assert.rejects(lstat(extension), { code: 'ENOENT' });
  assert.equal(await readlink(join(home, '.agents/skills/transcript-memory')), join(repo, 'skills/transcript-memory'));
  assert.equal(run().status, 0);
});

test('setup preserves unrelated extension links and real directories', async t => {
  const { extension, run } = await fixture(t);
  await symlink('/some/owner/extension', extension);
  assert.equal(run().status, 0);
  assert.equal(await readlink(extension), '/some/owner/extension');
  await rm(extension);
  await mkdir(extension);
  assert.equal(run().status, 0);
  assert.ok((await lstat(extension)).isDirectory());
});
