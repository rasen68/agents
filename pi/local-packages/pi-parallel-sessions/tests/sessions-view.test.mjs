import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const { createJiti } = createRequire(import.meta.resolve('@earendil-works/pi-coding-agent'))('jiti');
const { visibleWidth } = await import('@earendil-works/pi-tui');
const jiti = createJiti(import.meta.url);
const { SessionsView } = await jiti.import('../ui.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));
const live = (id, extra = {}) => ({ id, name: id, cwd: '/work/project', state: 'running', ...extra });
const saved = (id, cwd = '/work/project', extra = {}) => ({ id, name: id, path: `/sessions/${id}.jsonl`, cwd, modified: new Date(0), ...extra });
async function fixture(t, overrides = {}) {
  const calls = [];
  const actions = {
    getSessions: async () => [live('__parent__'), live('busy', {agentStatus: 'working'})],
    getResumeSessions: async () => [], getAttached: () => '__parent__', getCwd: () => '/work/project',
    switchTo: async id => calls.push(['switch', id]),
    resumeSession: async file => calls.push(['resume', file]),
    killSession: async id => calls.push(['kill', id]),
    newSession: async () => calls.push(['new']), newSessionInFolder: async () => {},
    notify: (...args) => calls.push(['notify', ...args]), ...overrides,
  };
  const view = new SessionsView({ fg: (_, s) => s, bg: (_, s) => s }, () => calls.push(['close']), actions, () => {});
  t.after(() => view.dispose());
  await tick();
  return {view, calls, text: () => view.render(160).join('\n')};
}

test('saved section includes directory descendants, excludes live identities and siblings, newest first', async t => {
  const {text} = await fixture(t, {
    getSessions: async () => [live('__parent__', {sessionId: 'parent-saved'}), live('busy', {sessionFile: '/sessions/live-file.jsonl'})],
    getResumeSessions: async () => [saved('old'), saved('new', '/work/project/sub', {modified: new Date(100)}), saved('outside', '/work/project-other'), saved('parent-saved'), saved('live-file')],
  });
  const rendered = text();
  assert.match(rendered, /Saved sessions/);
  assert.ok(rendered.indexOf('new') < rendered.indexOf('old'));
  assert.doesNotMatch(rendered, /outside|parent-saved|live-file/);
  assert.ok(rendered.indexOf('(current)') < rendered.indexOf('Saved sessions'));
});

test('Enter switches live rows and resumes saved rows; stop never affects saved rows', async t => {
  const {view, calls} = await fixture(t, {getResumeSessions: async () => [saved('archive')]});
  view.handleInput('j');
  view.handleInput('j');
  view.handleInput('d');
  assert.equal(calls.some(c => c[0] === 'kill'), false);
  view.handleInput('\r');
  await tick();
  assert.deepEqual(calls.filter(c => c[0] === 'resume'), [['resume', '/sessions/archive.jsonl']]);
  const second = await fixture(t);
  second.view.handleInput('\r');
  await tick();
  assert.deepEqual(second.calls[0], ['switch', 'busy']);
});

test('stop dispatches for the initial live session just like any other session', async t => {
  const {view, calls} = await fixture(t, {
    getSessions: async () => [live('__parent__')],
  });
  view.handleInput('d');
  await tick();
  assert.deepEqual(calls, [['kill', '__parent__']]);
});

test('stop refreshes the list and allows repeated deletion through the empty state', async t => {
  let rows = [live('a'), live('b')];
  const {view, calls, text} = await fixture(t, {
    getSessions: async () => rows,
    killSession: async id => {
      calls.push(['kill', id]);
      rows = rows.filter(row => row.id !== id);
    },
  });
  view.handleInput('d');
  await tick();
  assert.deepEqual(calls, [['kill', 'a']]);
  assert.equal(view.selectedSession().id, 'b');
  assert.doesNotMatch(text(), /› a/);
  view.handleInput('\x0b');
  await tick();
  assert.deepEqual(calls, [['kill', 'a'], ['kill', 'b']]);
  assert.match(text(), /No sessions/);
  view.handleInput('\x1b');
  assert.deepEqual(calls.at(-1), ['close']);
});

test('failed stop leaves the picker open and reports the error', async t => {
  const {view, calls} = await fixture(t, {
    killSession: async () => {throw new Error('cannot stop');},
  });
  view.handleInput('d');
  await tick();
  assert.deepEqual(calls, [['notify', 'Error: cannot stop', 'error']]);
  assert.equal(view.selectedSession().id, 'busy');
});

test('slash search filters both sections without triggering letter shortcuts; Escape clears it', async t => {
  const {view, text, calls} = await fixture(t, {
    getSessions: async () => [live('__parent__', {transcript: 'needle live'}), live('busy', {transcript: 'zzz'})],
    getResumeSessions: async () => [saved('needle saved'), saved('other')],
  });
  view.handleInput('/');
  view.handleInput('needle');
  assert.match(text(), /needle live/);
  assert.match(text(), /needle saved/);
  assert.doesNotMatch(text(), /zzz|other/);
  assert.equal(calls.length, 0);
  view.handleInput('\x1b');
  assert.match(text(), /zzz/);
  assert.equal(calls.length, 0);
  view.handleInput('\x1b');
  assert.deepEqual(calls, [['close']]);
});

test('live ordering and selected saved identity survive status refreshes', async t => {
  let rows = [live('__parent__'), live('a'), live('b', {agentStatus: 'working'})];
  const {view, calls} = await fixture(t, {
    getSessions: async () => rows,
    getResumeSessions: async () => [saved('archive')],
  });
  assert.deepEqual(view.filteredSessions().map(s => s.id), ['b', 'a', '__parent__', 'saved:/sessions/archive.jsonl']);
  view.handleInput('j');
  assert.equal(view.selectedSession().id, 'a');
  rows = [live('__parent__'), live('a', {agentStatus: 'working'}), live('b')];
  await view.refresh();
  assert.equal(view.selectedSession().id, 'a');
  view.handleInput('j');
  view.handleInput('j');
  view.handleInput('j');
  rows.push(live('c'));
  await view.refresh();
  view.handleInput('\r');
  await tick();
  assert.deepEqual(calls[0], ['resume', '/sessions/archive.jsonl']);
});

test('saved-load and resume failures leave the live picker usable', async t => {
  const failedLoad = await fixture(t, {getResumeSessions: async () => {throw new Error('disk unavailable');}});
  assert.match(failedLoad.text(), /Live sessions/);
  assert.match(failedLoad.text(), /Saved sessions unavailable: Error: disk unavailable/);
  failedLoad.view.handleInput('\r');
  await tick();
  assert.deepEqual(failedLoad.calls[0], ['switch', 'busy']);
  const failedResume = await fixture(t, {
    getResumeSessions: async () => [saved('broken')],
    resumeSession: async () => {throw new Error('cannot resume');},
  });
  failedResume.view.handleInput('j');
  failedResume.view.handleInput('j');
  failedResume.view.handleInput('\r');
  await tick();
  assert.deepEqual(failedResume.calls, [['notify', 'Error: cannot resume', 'error']]);
});

test('scrolling reaches saved rows and rendering fits narrow and wide terminals', async t => {
  const {view, calls} = await fixture(t, {
    getResumeSessions: async () => Array.from({length: 30}, (_, i) => saved(`session-${i}`, '/work/project/sub', {name: `会話 ${i}`})),
  });
  for (let i = 0; i < 50; i++) view.handleInput('j');
  assert.equal(view.selectedSession().savedPath, '/sessions/session-29.jsonl');
  for (const width of [1, 10, 40, 80, 160]) {
    assert.ok(view.render(width).every(line => visibleWidth(line) <= width));
    view.handleInput('/');
    assert.ok(view.render(width).every(line => visibleWidth(line) <= width));
    view.handleInput('\x1b');
  }
  view.handleInput('n');
  await tick();
  assert.deepEqual(calls[0], ['new']);
});

test('saved preview shows five rows and expands only when moving past the fifth', async t => {
  const {view, text, calls} = await fixture(t, {
    getResumeSessions: async () => Array.from({length: 8}, (_, i) => saved(`archive-${i}`)),
  });
  assert.match(text(), /archive-4/);
  assert.doesNotMatch(text(), /archive-5|archive-6|archive-7/);
  assert.match(text(), /\.\.\./);
  for (let i = 0; i < 6; i++) view.handleInput('j');
  assert.equal(view.selectedSession().name, 'archive-4');
  assert.doesNotMatch(text(), /archive-5/);
  view.handleInput('j');
  assert.equal(view.selectedSession().name, 'archive-5');
  assert.match(text(), /archive-7/);
  assert.doesNotMatch(text(), /\.\.\./);
  view.handleInput('k');
  assert.match(text(), /archive-7/);
  view.handleInput('\r');
  await tick();
  assert.deepEqual(calls[0], ['resume', '/sessions/archive-4.jsonl']);
});

test('no ellipsis for five saved rows; changing search restores the preview limit', async t => {
  const small = await fixture(t, {
    getResumeSessions: async () => Array.from({length: 5}, (_, i) => saved(`archive-${i}`)),
  });
  assert.doesNotMatch(small.text(), /\.\.\./);
  const {view, text} = await fixture(t, {
    getResumeSessions: async () => Array.from({length: 8}, (_, i) => saved(`archive-${i}`)),
  });
  for (let i = 0; i < 8; i++) view.handleInput('j');
  view.handleInput('/');
  view.handleInput('archive');
  assert.match(text(), /\.\.\./);
  assert.doesNotMatch(text(), /archive-5/);
  view.handleInput('\x1b');
  assert.match(text(), /\.\.\./);
});
