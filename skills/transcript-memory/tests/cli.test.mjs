import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const cli = fileURLToPath(new URL('../scripts/transcript.mjs', import.meta.url));
async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'transcript-cli-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const archive = join(home, 'custom-agent', 'sessions');
  await mkdir(archive, { recursive: true });
  const file = join(archive, 'test.jsonl');
  await writeFile(file, [
    { type: 'session', version: 3, id: 'fixture', cwd: home },
    { type: 'message', id: 'u', parentId: null, timestamp: '2026-10-01T00:00:00Z', message: { role: 'user', content: 'Remember the sandbox' } },
    { type: 'message', id: 'a', parentId: 'u', timestamp: '2026-10-01T00:01:00Z', message: { role: 'toolResult', content: [{ type: 'text', text: 'tool-token' }] } },
  ].map(value => JSON.stringify(value)).join('\n') + '\n');
  const run = (args, env = {}) => spawnSync(process.execPath, [cli, ...args], {
    cwd: home, encoding: 'utf8', env: { ...process.env, HOME: home,
      PI_CODING_AGENT_DIR: join(home, 'custom-agent'), PI_CODING_AGENT_SESSION_DIR: '', PI_SESSION_FILE: '', PI_SESSION_ID: '', ...env },
  });
  return { home, archive, file, run };
}

test('CLI discovers custom agent storage, defaults to current project, and returns JSON', async t => {
  const { run } = await fixture(t);
  const result = run(['search', 'sandbox']);
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.equal(value.total, 1);
  assert.equal(value.results[0].entryId, 'u');
  assert.equal(run(['search', 'tool-token']).status, 0);
  assert.equal(JSON.parse(run(['search', 'tool-token']).stdout).total, 0);
  assert.equal(JSON.parse(run(['search', 'tool-token', '--include-tools']).stdout).total, 1);
});

test('search excludes the current session by default, supports opt-in and repeatable explicit exclusions', async t => {
  const { run, archive, file, home } = await fixture(t);
  for (const id of ['parent', 'history']) {
    await writeFile(join(archive, `${id}.jsonl`), [
      { type: 'session', version: 3, id, cwd: home },
      { type: 'message', id: 'u', parentId: null, timestamp: '2026-10-01T00:00:00Z', message: { role: 'user', content: 'Remember the sandbox' } },
    ].map(entry => JSON.stringify(entry)).join('\n') + '\n');
  }
  const search = (flags = [], env = { PI_SESSION_ID: 'fixture' }) => {
    const result = run(['search', 'sandbox', ...flags], env);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const defaults = search();
  assert.equal(defaults.total, 2);
  assert.deepEqual(defaults.excludedSessionIds, ['fixture']);
  assert.equal(defaults.excludedSessions, 1);
  assert.equal(defaults.coverageIncomplete, false);
  assert.equal(search(['--include-current']).total, 3);
  const explicit = search(['--exclude-session', 'parent', '--exclude-session', 'history']);
  assert.equal(explicit.total, 0);
  assert.deepEqual(new Set(explicit.excludedSessionIds), new Set(['fixture', 'parent', 'history']));
  assert.equal(search(['--include-current', '--exclude-session', 'fixture']).total, 2);
  assert.equal(search(['--exclude-session', 'fixture'], {}).total, 2);
  assert.notEqual(run(['search', '--exclude-session', '']).status, 0);
  const read = run(['read', '--session-file', file, '--entry-id', 'u'], { PI_SESSION_ID: 'fixture' });
  assert.equal(read.status, 0, read.stderr);
  assert.equal(JSON.parse(read.stdout).messages[0].entryId, 'u');
});

test('CLI reads references and rejects invalid flags or missing arguments', async t => {
  const { run, file } = await fixture(t);
  const args = ['read', '--session-file', file, '--session-id', 'fixture', '--entry-id', 'u', '--before', '0', '--after', '0'];
  const result = run(args);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).messages[0].text, 'Remember the sandbox');
  for (const invalid of [[], ['unknown'], ['read'], ['search', '--bogus'], ['search', '--limit', 'nan'], ['search', '--limit', '0'], ['search', '--project', '.', '--all-projects'], ['read', '--session-file', file, '--entry-id', 'u', '--before', '21']]) {
    const result = run(invalid);
    assert.notEqual(result.status, 0, JSON.stringify(invalid));
    assert.equal(result.stdout, '');
    assert.ok(result.stderr.length > 0);
  }
  assert.equal(run(['--help']).status, 0);
});

test('explicit roots restrict discovery; environment and active-session archives are discoverable', async t => {
  const { run, home, archive, file } = await fixture(t);
  const empty = join(home, 'empty');
  await mkdir(empty);
  assert.equal(JSON.parse(run(['search', '--root', empty, '--all-projects']).stdout).total, 0);
  const override = { PI_CODING_AGENT_DIR: empty, PI_CODING_AGENT_SESSION_DIR: archive };
  assert.equal(JSON.parse(run(['search', 'sandbox'], override).stdout).total, 1);
  assert.equal(JSON.parse(run(['search', 'sandbox'], { PI_CODING_AGENT_DIR: empty, PI_SESSION_FILE: file }).stdout).total, 1);
  const missing = run(['search', '--root', join(home, 'missing')]);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /ENOENT/);
  const notDirectory = run(['search', '--root', file]);
  assert.notEqual(notDirectory.status, 0);
  assert.match(notDirectory.stderr, /directory/);
  const denied = run(['read', '--root', empty, '--session-file', file, '--entry-id', 'u']);
  assert.notEqual(denied.status, 0);
  assert.match(denied.stderr, /not in the configured transcript stores/);
});
