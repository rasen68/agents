import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { TranscriptStore } from '../scripts/store.mjs';

async function fixture(t, extra = []) {
  const root = await mkdtemp(join(tmpdir(), 'transcript-memory-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'session.jsonl');
  const message = (id, parentId, role, content) => ({
    type: 'message', id, parentId, timestamp: '2026-10-01T12:00:00Z',
    message: { role, content },
  });
  const entries = [
    { type: 'session', version: 3, id: 'session', cwd: root },
    message('user', null, 'user', 'Discuss sandbox design'),
    message('mixed', 'user', 'assistant', [
      { type: 'text', text: 'Use explicit mounts' },
      { type: 'toolCall', name: 'write', arguments: { content: 'call-only-token' } },
      { type: 'thinking', thinking: 'private-reasoning-token' },
    ]),
    message('result', 'mixed', 'toolResult', [{ type: 'text', text: 'result-only-token' }]),
    message('call', 'result', 'assistant', [
      { type: 'toolCall', name: 'bash', arguments: { command: 'call-only-token' } },
    ]),
    message('shell', 'call', 'bashExecution', ''),
    message('answer', 'shell', 'assistant', [{ type: 'text', text: 'Final sandbox proposal' }]),
    message('correction', 'answer', 'user', 'No agent-specific commands'),
    ...extra,
  ];
  entries.find(entry => entry.id === 'shell').message.command = 'shell-only-token';
  entries.find(entry => entry.id === 'shell').message.output = 'shell output';
  await writeFile(file, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
  return { root, file, store: new TranscriptStore(), context: { roots: [root], cwd: root }, message };
}

test('search defaults to prose and keeps only the prose of mixed assistant messages', async t => {
  const { store, context } = await fixture(t);
  for (const query of ['call-only-token', 'result-only-token', 'shell-only-token']) {
    assert.equal((await store.search({ query }, context)).total, 0, query);
  }
  const result = await store.search({ query: 'explicit mounts' }, context);
  assert.equal(result.total, 1);
  assert.equal(result.results[0].text, 'Use explicit mounts');
});

test('tool traffic is opt-in; reasoning remains excluded in both modes', async t => {
  const { store, context } = await fixture(t);
  for (const query of ['call-only-token', 'result-only-token', 'shell-only-token']) {
    assert.ok((await store.search({ query, includeTools: true }, context)).total > 0, query);
  }
  for (const includeTools of [false, true]) {
    assert.equal((await store.search({ query: 'private-reasoning-token', includeTools }, context)).total, 0);
  }
});

test('read counts prose neighbors, not tool traffic, and does not leak mixed calls', async t => {
  const { store, context, file } = await fixture(t);
  const result = await store.read({ sessionFile: file, entryId: 'answer', before: 2, after: 1 }, context);
  assert.deepEqual(result.messages.map(message => message.entryId), ['user', 'mixed', 'answer', 'correction']);
  assert.equal(result.messages[1].text, 'Use explicit mounts');
});

test('read can opt into tool traffic, including tool-only anchors', async t => {
  const { store, context, file } = await fixture(t);
  await assert.rejects(store.read({ sessionFile: file, entryId: 'result' }, context), /include.tools/i);
  const result = await store.read({ sessionFile: file, entryId: 'result', includeTools: true }, context);
  assert.ok(result.messages.some(message => message.text.includes('result-only-token')));
});

test('filtered reads stop at forks even when children are tool-only', async t => {
  const { store, context, file, message } = await fixture(t);
  await appendFile(file, JSON.stringify(message('other-call', 'answer', 'assistant', [
    { type: 'toolCall', name: 'bash', arguments: { command: 'other-branch-token' } },
  ])) + '\n');
  await appendFile(file, JSON.stringify(message('other-answer', 'other-call', 'assistant', 'Other branch')) + '\n');
  const result = await store.read({ sessionFile: file, entryId: 'answer', before: 0 }, context);
  assert.deepEqual(result.messages.map(message => message.entryId), ['answer']);
  assert.equal(result.continuationChoices.length, 2);
  assert.ok(!JSON.stringify(result).includes('other-branch-token'));
  const selected = await store.read({ sessionFile: file, entryId: 'answer', before: 0, branchLeafId: 'other-answer' }, context);
  assert.deepEqual(selected.messages.map(message => message.entryId), ['answer', 'other-answer']);
  await assert.rejects(store.read({ sessionFile: file, entryId: 'correction', branchLeafId: 'other-answer' }, context), /not a descendant/);
});

test('forward reads skip tool entries while counting visible messages', async t => {
  const { store, context, file } = await fixture(t);
  const result = await store.read({ sessionFile: file, entryId: 'mixed', before: 0, after: 2 }, context);
  assert.deepEqual(result.messages.map(message => message.entryId), ['mixed', 'answer', 'correction']);
});

test('titles and anchored topics remain searchable without exposing tool text', async t => {
  const { store, context, file } = await fixture(t, [
    { type: 'session_info', id: 'title', parentId: 'correction', name: 'Historical policy discussion' },
    { type: 'custom', id: 'topic', parentId: 'title', customType: 'pi.transcript-topic',
      data: { title: 'Explicit permission design', answerId: 'mixed', changed: true } },
  ]);
  const title = await store.search({ query: 'historical policy' }, context);
  assert.equal(title.results[0].kind, 'title');
  const topic = await store.search({ query: 'permission design' }, context);
  assert.equal(topic.results[0].entryId, 'mixed');
  assert.equal(topic.results[0].text, 'Use explicit mounts');
  const read = await store.read({ sessionFile: file, entryId: 'mixed', before: 0, after: 0 }, context);
  assert.equal(read.topic, 'Explicit permission design');
});

test('legacy references, malformed-source warnings, and cache refresh survive', async t => {
  const { store, context, root } = await fixture(t);
  const legacy = join(root, 'legacy.jsonl');
  await writeFile(legacy, [
    { type: 'session', id: 'legacy', cwd: root },
    { type: 'message', timestamp: '2026-10-01T00:00:00Z', message: { role: 'user', content: 'legacy-token' } },
  ].map(value => JSON.stringify(value)).join('\n') + '\n');
  const found = await store.search({ query: 'legacy-token' }, context);
  assert.equal(found.results[0].entryId, 'legacy-line-2');
  const read = await store.read({ sessionFile: legacy, entryId: 'legacy-line-2' }, context);
  assert.equal(read.messages[0].text, 'legacy-token');
  await appendFile(legacy, '{incomplete\n');
  const malformed = await store.search({ query: 'legacy-token' }, context);
  assert.equal(malformed.total, 1);
  assert.equal(malformed.coverageIncomplete, true);
  assert.ok(malformed.warnings.some(warning => warning.includes('line 3')));
  await rm(legacy);
  assert.equal((await store.search({ query: 'legacy-token' }, context)).total, 0);
});

test('project scope and inclusive dates do not change with prose filtering', async t => {
  const { store, context, root } = await fixture(t);
  assert.equal((await store.search({ query: 'sandbox', project: join(root, 'other') }, context)).total, 0);
  assert.equal((await store.search({ query: 'sandbox', allProjects: true }, context)).total, 2);
  assert.equal((await store.search({ query: 'sandbox', to: '2026-10-01T11:59:59Z' }, context)).total, 0);
  assert.equal((await store.search({ query: 'sandbox', from: '2026-10-01T12:00:00Z', to: '2026-10-01T12:00:00Z' }, context)).total, 2);
  await assert.rejects(store.search({ from: 'invalid' }, context), /Invalid date range/);
});

test('read redistributes spare budget and completes short neighbors without starving long ones', async t => {
  const { store, context, file, message } = await fixture(t);
  await appendFile(file, [
    message('long-anchor', 'correction', 'assistant', 'a'.repeat(10000)),
    message('short', 'long-anchor', 'user', 'short'),
    message('long-following', 'short', 'assistant', 'b'.repeat(10000)),
  ].map(entry => JSON.stringify(entry)).join('\n') + '\n');
  const result = await store.read({ sessionFile: file, entryId: 'long-anchor', before: 1, after: 2, maxChars: 16000 }, context);
  assert.deepEqual(result.messages.map(message => message.entryId), ['correction', 'long-anchor', 'short', 'long-following']);
  assert.equal(result.messages.reduce((sum, message) => sum + message.text.length, 0), 16000);
  assert.equal(result.messages[0].nextTextOffset, null);
  assert.equal(result.messages[2].text, 'short');
  assert.ok(result.messages[1].text.length > 7000);
  assert.ok(result.messages[3].text.length > 7000);
  assert.ok(Math.abs(result.messages[1].text.length - result.messages[3].text.length) <= 1);
});

test('the smallest budget gives all 41 requested messages text and respects offset lengths', async t => {
  const { store, context, file, message } = await fixture(t);
  const chain = Array.from({ length: 41 }, (_, index) => message(`entry-${index}`,
    index ? `entry-${index - 1}` : 'correction', index % 2 ? 'user' : 'assistant', 'x'.repeat(1000)));
  await appendFile(file, chain.map(entry => JSON.stringify(entry)).join('\n') + '\n');
  const params = { sessionFile: file, entryId: 'entry-20', before: 20, after: 20, maxChars: 500 };
  const result = await store.read(params, context);
  assert.equal(result.messages.length, 41);
  assert.ok(result.messages.every(message => message.text.length > 0));
  assert.equal(result.messages.reduce((sum, message) => sum + message.text.length, 0), 500);
  assert.equal(result.truncatedEntries.length, 41);
  const offset = await store.read({ ...params, textOffset: 999 }, context);
  assert.equal(offset.messages[20].text, 'x');
  assert.equal(offset.messages[20].nextTextOffset, null);
  assert.equal(offset.messages.reduce((sum, message) => sum + message.text.length, 0), 500);
});

test('read records every clipped entry and distinguishes text completeness from branch coverage', async t => {
  const { store, context, file, message } = await fixture(t);
  await appendFile(file, [
    message('long-a', 'correction', 'assistant', 'a'.repeat(600)),
    message('long-b', 'long-a', 'user', 'b'.repeat(600)),
    message('fork', 'long-a', 'user', 'Other branch'),
  ].map(entry => JSON.stringify(entry)).join('\n') + '\n');
  const params = { sessionFile: file, entryId: 'long-a', before: 0, after: 1, branchLeafId: 'long-b' };
  const clipped = await store.read({ ...params, maxChars: 500 }, context);
  assert.equal(clipped.textComplete, false);
  assert.deepEqual(clipped.truncatedEntries, ['long-a', 'long-b']);
  assert.equal(clipped.nextEntryId, null);
  assert.deepEqual(clipped.messages.map(message => message.nextTextOffset), [250, 250]);
  const complete = await store.read({ ...params, maxChars: 1200 }, context);
  assert.equal(complete.textComplete, true);
  assert.deepEqual(complete.truncatedEntries, []);
  const continued = await store.read({ ...params, after: 0, textOffset: 250, maxChars: 500 }, context);
  assert.equal(continued.messages[0].text.length, 350);
  assert.equal(continued.messages[0].textOffset, 250);
  assert.equal(continued.textComplete, true);
  const fork = await store.read({ sessionFile: file, entryId: 'long-a', before: 0, after: 1 }, context);
  assert.equal(fork.textComplete, true);
  assert.equal(fork.continuationChoices.length, 2);
});

test('bounded search pagination, read continuation, and session identity checks survive', async t => {
  const { store, context, file, message } = await fixture(t);
  await appendFile(file, JSON.stringify(message('long', 'correction', 'user', 'z'.repeat(18000))) + '\n');
  const search = await store.search({ limit: 1 }, context);
  assert.equal(search.results.length, 1);
  assert.equal(search.nextOffset, 1);
  const read = await store.read({ sessionFile: file, entryId: 'long', before: 0, after: 0, maxChars: 500 }, context);
  assert.equal(read.messages[0].text.length, 500);
  assert.equal(read.messages[0].nextTextOffset, 500);
  const next = await store.read({ sessionFile: file, entryId: 'long', before: 0, after: 0, maxChars: 500, textOffset: 500 }, context);
  assert.equal(next.messages[0].textOffset, 500);
  await assert.rejects(store.read({ sessionFile: file, sessionId: 'wrong', entryId: 'user' }, context), /identity changed/);
});
