import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { InteractiveMode } from '@earendil-works/pi-coding-agent';

const { createJiti } = createRequire(import.meta.resolve('@earendil-works/pi-coding-agent'))('jiti');
const { PiSessionsHost, installSessionLifecycle, default: extension } = await createJiti(import.meta.url).import('../index.ts');

function mode(id, calls) {
  let nativeId = id;
  const sessionManager = {
    getSessionId: () => nativeId, getSessionFile: () => `/saved/${nativeId}.jsonl`,
    getSessionName: () => '', getCwd: () => '/workspace',
  };
  const session = { sessionManager, abort: async () => calls.push(['abort', id]) };
  const runtimeHost = { session, dispose: async () => calls.push(['dispose', id]) };
  return {
    runtimeHost, sessionManager, session, isInitialized: true,
    ui: {
      start: () => calls.push(['start', id]), stop: () => calls.push(['ui-stop', id]),
      requestRender() {}, terminal: {
        setProgress() {}, setTitle() {}, drainInput: async () => calls.push(['drain', id]),
      },
    },
    registerSignalHandlers: () => calls.push(['signals-on', id]),
    unregisterSignalHandlers: () => calls.push(['signals-off', id]),
    stop(exitOutput) { this.unregisterSignalHandlers(); this.ui.stop(); calls.push(['stop', id, exitOutput]); },
    replace(nextId) { nativeId = nextId; },
  };
}

function fixture() {
  const calls = [];
  const host = new PiSessionsHost(code => calls.push(['exit', code]));
  const first = mode('first', calls);
  const initial = host.adoptMode(first);
  return { calls, host, first, initial, add: id => host.adoptMode(mode(id, calls)) };
}

test('initial runtime is an ordinary session and can stop while another session stays active', async () => {
  const {host, calls, initial, add} = fixture();
  const next = add('next');
  await host.activate(next.id);
  calls.length = 0;
  await host.stopSession(initial.id);
  assert.equal(host.activeId, next.id);
  assert.equal(host.get(initial.id), undefined);
  assert.deepEqual(host.listLive().map(r => r.id), [next.id]);
  assert.ok(calls.some(c => c[0] === 'dispose' && c[1] === 'first'));
  assert.ok(!calls.some(c => c[0] === 'ui-stop' || c[0] === 'exit'));
});

test('closing the active session returns to the most recently used remaining session', async () => {
  const {host, initial, add} = fixture();
  const second = add('second');
  const third = add('third');
  await host.activate(second.id);
  await host.activate(initial.id);
  await host.activate(third.id);
  await host.stopSession(third.id);
  assert.equal(host.activeId, initial.id);
  await host.stopSession(initial.id);
  assert.equal(host.activeId, second.id);
});

test('double Ctrl+C from a parallel session exits the app and disposes every session', async () => {
  const calls = [];
  const host = new PiSessionsHost(code => calls.push(['exit', code]));
  class NativeMode {
    constructor(id) { Object.assign(this, mode(id, calls)); }
    async init() { calls.push(['init', this.sessionManager.getSessionId()]); }
    async shutdown() { assert.fail('native process exit must not run'); }
  }
  installSessionLifecycle(host, NativeMode);
  const first = new NativeMode('first');
  await first.init();
  const initial = host.get(host.activeId);
  const second = new NativeMode('second');
  await second.init();
  const next = host.listLive().find(r => r.mode === second);
  await host.activate(next.id);
  second.lastSigintTime = 0;
  second.clearEditor = () => calls.push(['clear', 'second']);
  InteractiveMode.prototype.handleCtrlC.call(second);
  assert.ok(calls.some(c => c[0] === 'clear'));
  assert.equal(host.listLive().length, 2);
  assert.ok(!calls.some(c => c[0] === 'exit'));
  InteractiveMode.prototype.handleCtrlC.call(second);
  await host.shutdown();
  assert.equal(host.activeId, null);
  assert.equal(host.get(initial.id), undefined);
  assert.equal(host.listLive().length, 0);
  assert.deepEqual(calls.filter(c => c[0] === 'dispose'), [['dispose', 'first'], ['dispose', 'second']]);
  await first.shutdown();
  assert.deepEqual(calls.filter(c => c[0] === 'exit'), [['exit', 0]]);
});

test('closing a mode ends its pending native input loop without leaving an editor callback', async () => {
  const calls = [];
  const host = new PiSessionsHost(() => {});
  class NativeMode {
    constructor(id) { Object.assign(this, mode(id, calls)); }
    async init() {}
    async shutdown() { assert.fail('native shutdown'); }
    async run() {
      await this.init();
      while (true) await this.getUserInput();
    }
    getUserInput() { return new Promise(resolve => { this.onInputCallback = resolve; }); }
  }
  installSessionLifecycle(host, NativeMode);
  const first = new NativeMode('first');
  const running = first.run();
  await new Promise(resolve => setImmediate(resolve));
  const initial = host.get(host.activeId);
  await host.stopSession(initial.id);
  assert.equal(first.onInputCallback, undefined);
  const result = await Promise.race([running.then(() => 'stopped'), new Promise(resolve => setTimeout(() => resolve('pending'), 100))]);
  assert.equal(result, 'stopped');
});

test('signal shutdown disposes every session, stopping the active terminal last', async () => {
  const {host, calls, initial, add} = fixture();
  const second = add('second');
  await host.activate(second.id);
  calls.length = 0;
  await host.shutdown();
  assert.deepEqual(calls.filter(c => ['dispose', 'ui-stop', 'exit'].includes(c[0])), [
    ['dispose', 'first'], ['ui-stop', 'second'], ['dispose', 'second'], ['exit', 0],
  ]);
  assert.equal(host.get(initial.id), undefined);
  assert.equal(host.listLive().length, 0);
});

test('concurrent close and signal requests dispose each runtime only once', async () => {
  const {host, calls, initial, add} = fixture();
  const next = add('next');
  await host.activate(next.id);
  await Promise.all([host.stopSession(initial.id), host.stopSession(initial.id), host.shutdown()]);
  assert.deepEqual(calls.filter(c => c[0] === 'dispose'), [['dispose', 'first'], ['dispose', 'next']]);
  assert.deepEqual(calls.filter(c => c[0] === 'exit'), [['exit', 0]]);
});

test('context binding follows replacement identities without attributing background events to the active session', async () => {
  const {host, first, initial, add} = fixture();
  const next = add('next');
  await host.activate(next.id);
  first.replace('replacement');
  const record = host.bindSessionContext({ cwd: '/workspace', sessionManager: first.sessionManager });
  assert.equal(record.id, initial.id);
  assert.equal(record.sessionId, 'replacement');
  assert.equal(host.activeId, next.id);
});

test('stopping a session releases its path locks and tool-call tracking', async () => {
  const {host, initial, add} = fixture();
  add('next');
  const {paths} = host.locks.acquire(initial.id, ['file'], '/workspace');
  host.locks.heldByToolCall.set('tool-call', {sessionId: initial.id, paths});
  await host.stopSession(initial.id);
  assert.equal(host.locks.locks.size, 0);
  assert.equal(host.locks.heldByToolCall.size, 0);
});

test('RPC lifecycle events do not require an InteractiveMode or create a live terminal session', () => {
  const handlers = new Map();
  extension({ registerCommand() {}, registerShortcut() {}, on: (event, handler) => handlers.set(event, handler) });
  const ctx = { mode: 'rpc', sessionManager: {getSessionId: () => 'rpc'}, ui: {setWidget() {assert.fail('RPC widget');}} };
  assert.doesNotThrow(() => handlers.get('session_start')({}, ctx));
  assert.doesNotThrow(() => handlers.get('agent_start')({}, ctx));
  assert.doesNotThrow(() => handlers.get('agent_end')({}, ctx));
  assert.doesNotThrow(() => handlers.get('session_shutdown')({}, ctx));
});

test('a concurrent final close and signal shutdown exits only once', async () => {
  const {host, calls, initial} = fixture();
  await Promise.all([host.stopSession(initial.id), host.shutdown()]);
  assert.deepEqual(calls.filter(c => c[0] === 'dispose'), [['dispose', 'first']]);
  assert.deepEqual(calls.filter(c => c[0] === 'exit'), [['exit', 0]]);
});

test('shutdown attempts every cleanup even when one session abort fails', async () => {
  const {host, calls, first, add} = fixture();
  const next = add('next');
  await host.activate(next.id);
  first.runtimeHost.session.abort = async () => { throw new Error('abort failed'); };
  await assert.rejects(host.shutdown(), /cleanup/i);
  assert.deepEqual(calls.filter(c => c[0] === 'dispose'), [['dispose', 'first'], ['dispose', 'next']]);
  assert.equal(host.listLive().length, 0);
  assert.deepEqual(calls.filter(c => c[0] === 'exit'), [['exit', 1]]);
});

test('reloading an old parent-based host requests a restart instead of partially replacing its lifecycle', () => {
  const previous = globalThis.__PI_SESSIONS_HOST__;
  try {
    globalThis.__PI_SESSIONS_HOST__ = { records: new Map() };
    assert.throws(() => extension({}), /restart Pi/i);
  } finally {
    globalThis.__PI_SESSIONS_HOST__ = previous;
  }
});

test('failed runtime creation does not leave a phantom live session', async () => {
  const {host, first, initial} = fixture();
  const directory = mkdtempSync(path.join(tmpdir(), 'pi-host-create-'));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = directory;
  try {
    await assert.rejects(host.createSessionFromContext({ sessionManager: first.sessionManager }, path.join(directory, 'missing')));
    assert.deepEqual(host.listLive().map(r => r.id), [initial.id]);
    assert.equal(host.activeId, initial.id);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(directory, {recursive: true, force: true});
  }
});

test('failed activation restores the previous terminal and disposes the failed runtime', async () => {
  const {host, calls, initial, add} = fixture();
  const next = add('broken');
  next.started = false;
  next.adapter.start = async () => { throw new Error('initialization failed'); };
  await assert.rejects(host.activate(next.id), /initialization failed/);
  assert.equal(host.activeId, initial.id);
  assert.equal(host.get(next.id), undefined);
  assert.ok(calls.some(c => c[0] === 'dispose' && c[1] === 'broken'));
  assert.ok(calls.some(c => c[0] === 'start' && c[1] === 'first'));
});

test('closing an inactive fullscreen session suppresses native transcript renderer replacement', async () => {
  const {host, calls, initial, add} = fixture();
  const next = add('next');
  await host.activate(next.id);
  await host.stopSession(initial.id);
  assert.deepEqual(calls.find(c => c[0] === 'stop' && c[1] === 'first'), ['stop', 'first', 'resume-hint']);
});

test('closing the last session drains the terminal, disposes its runtime, and exits once', async () => {
  const {host, calls, initial} = fixture();
  await host.stopSession(initial.id);
  assert.equal(host.activeId, null);
  assert.equal(host.listLive().length, 0);
  assert.deepEqual(calls.filter(c => ['drain', 'dispose', 'exit'].includes(c[0])), [
    ['drain', 'first'], ['dispose', 'first'], ['exit', 0],
  ]);
});
