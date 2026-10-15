import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const { createJiti } = createRequire(import.meta.resolve('@earendil-works/pi-coding-agent'))('jiti');
const jiti = createJiti(import.meta.url);
const { SessionManager } = await jiti.import('@earendil-works/pi-coding-agent');
const { default: register, PiSessionsHost } = await jiti.import('../index.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('reloaded picker excludes live identities even with a retained serializer and stale record metadata', async t => {
  const previousHost = globalThis.__PI_SESSIONS_HOST__;
  const originalList = SessionManager.listAll;
  t.after(() => {
    if (previousHost === undefined) delete globalThis.__PI_SESSIONS_HOST__;
    else globalThis.__PI_SESSIONS_HOST__ = previousHost;
    SessionManager.listAll = originalList;
  });
  const record = (id, nativeId, file, extra = {}) => ({
    id, name: id, cwd: '/work/project', state: 'active',
    sessionManager: {getSessionId: () => nativeId, getSessionFile: () => file},
    ...extra,
  });
  const records = [
    record('__parent__', 'parent-native', '/sessions/parent.jsonl'),
    record('background', 'child-native', '/sessions/child.jsonl', {
      sessionId: 'previous-child', sessionFile: '/sessions/previous-child.jsonl',
    }),
  ];
  globalThis.__PI_SESSIONS_HOST__ = Object.assign(new PiSessionsHost(), {
    records: new Map(records.map(r => [r.id, r])), activeId: '__parent__',
    listLive: () => records,
    bindSessionContext: () => records[0],
    // A host retained across /reload still has its original serializer.
    publicSession: r => ({id: r.id, name: r.name, cwd: r.cwd, state: r.state}),
  });
  SessionManager.listAll = async () => [
    {id: 'parent-native', path: '/sessions/parent.jsonl', cwd: '/work/project', name: 'duplicate parent'},
    {id: 'child-native', path: '/sessions/child.jsonl', cwd: '/work/project', name: 'duplicate background'},
    {id: 'archive', path: '/sessions/archive.jsonl', cwd: '/work/project', name: 'saved archive'},
  ];
  let handler;
  register({registerCommand: (_name, command) => {handler = command.handler;}, registerShortcut: () => {}, on: () => {}});
  await handler('', {
    mode: 'tui', cwd: '/work/project',
    ui: {
      custom: async factory => {
        const view = factory({requestRender: () => {}}, {fg: (_, s) => s}, {}, () => {});
        try {
          await tick();
          const text = view.render(160).join('\n');
          assert.match(text, /saved archive/);
          assert.doesNotMatch(text, /duplicate parent|duplicate background/);
        } finally {
          view.dispose();
        }
      },
    },
  });
});
