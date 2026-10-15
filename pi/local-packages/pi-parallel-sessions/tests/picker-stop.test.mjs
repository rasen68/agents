import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const { createJiti } = createRequire(import.meta.resolve('@earendil-works/pi-coding-agent'))('jiti');
const jiti = createJiti(import.meta.url);
const { SessionManager } = await jiti.import('@earendil-works/pi-coding-agent');
const { default: register, PiSessionsHost } = await jiti.import('../index.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));

async function withPicker(t, inspect) {
  const previousHost = globalThis.__PI_SESSIONS_HOST__;
  const originalList = SessionManager.listAll;
  t.after(() => {
    if (previousHost === undefined) delete globalThis.__PI_SESSIONS_HOST__;
    else globalThis.__PI_SESSIONS_HOST__ = previousHost;
    SessionManager.listAll = originalList;
  });
  const records = ['current', 'first', 'second'].map(id => ({
    id, name: id, cwd: '/work/project', state: 'active',
  }));
  const stopped = [];
  const activated = [];
  const host = Object.assign(new PiSessionsHost(), {
    records: new Map(records.map(r => [r.id, r])), activeId: 'current',
    bindSessionContext: () => records[0],
    stopSession: async id => {stopped.push(id); host.records.delete(id);},
    activateFromContext: async (_ctx, id) => activated.push(id),
  });
  globalThis.__PI_SESSIONS_HOST__ = host;
  SessionManager.listAll = async () => [];
  let handler;
  register({registerCommand: (_name, command) => {handler = command.handler;}, registerShortcut: () => {}, on: () => {}});
  await handler('', {
    mode: 'tui', cwd: '/work/project',
    ui: {
      notify: () => {},
      custom: async factory => {
        const view = factory({requestRender: () => {}}, {fg: (_, s) => s}, {}, () => {});
        try {
          await tick();
          await inspect(view, stopped);
        } finally {
          view.dispose();
        }
      },
    },
  });
  return {stopped, activated};
}

test('background stops take effect and disappear while the real picker remains open', async t => {
  await withPicker(t, async (view, stopped) => {
    view.handleInput('d');
    await tick();
    assert.deepEqual(stopped, ['first']);
    assert.deepEqual(view.filteredSessions().map(s => s.id), ['second', 'current']);
    view.handleInput('d');
    await tick();
    assert.deepEqual(stopped, ['first', 'second']);
    assert.deepEqual(view.filteredSessions().map(s => s.id), ['current']);
  });
});

test('current stop removes its row immediately but defers teardown until picker closes', async t => {
  const {stopped, activated} = await withPicker(t, async (view, stopped) => {
    view.handleInput('j');
    view.handleInput('j');
    assert.equal(view.selectedSession().id, 'current');
    view.handleInput('d');
    await tick();
    assert.deepEqual(stopped, []);
    assert.deepEqual(view.filteredSessions().map(s => s.id), ['first', 'second']);
    view.handleInput('\r');
    await tick();
  });
  assert.deepEqual(stopped, ['current']);
  assert.deepEqual(activated, ['second']);
});
