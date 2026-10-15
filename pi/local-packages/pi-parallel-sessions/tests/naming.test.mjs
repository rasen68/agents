import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAutoNamer } from '../naming.mjs';

const answer = (text, stopReason = 'stop') => ({ role: 'assistant', stopReason, content: [{ type: 'text', text }] });
function fixture() {
  let name = '';
  const requests = [];
  const manager = { getSessionName: () => name, appendSessionInfo: title => { name = title; } };
  const ctx = { sessionManager: manager, modelRegistry: {
    find: () => ({ id: 'gpt-6-luna' }),
    streamSimple: (_model, context) => {
      requests.push(context);
      return { result: async () => ({ stopReason: 'stop', content: [{ type: 'text', text: 'Pi configuration portability' }] }) };
    },
  } };
  return { ctx, requests, getName: () => name };
}

test('title request includes exact Pi identity and the completed exchange', async () => {
  const { ctx, requests } = fixture();
  await createAutoNamer()(ctx, 'How can I reproduce my personal pi config?', [answer('Your Pi coding agent configuration includes extensions and skills.')]);
  assert.equal(requests.length, 1);
  assert.ok(requests[0].systemPrompt.includes('This conversation takes place in Pi, a coding agent harness that is configurable with extensions and skills.'));
  assert.deepEqual(JSON.parse(requests[0].messages[0].content), {
    userMessage: 'How can I reproduce my personal pi config?',
    assistantAnswer: 'Your Pi coding agent configuration includes extensions and skills.',
  });
});

test('user and answer have separate budgets; tools and reasoning stay excluded', async () => {
  const { ctx, requests } = fixture();
  await createAutoNamer()(ctx, 'u'.repeat(9000), [
    { role: 'toolResult', content: [{ type: 'text', text: 'SECRET TOOL DATA' }] },
    { ...answer('a'.repeat(9000)), content: [{ type: 'thinking', thinking: 'SECRET REASONING' }, { type: 'text', text: 'a'.repeat(9000) }] },
  ]);
  const content = requests[0].messages[0].content;
  const exchange = JSON.parse(content);
  assert.equal(exchange.userMessage.length, 4000);
  assert.equal(exchange.assistantAnswer.length, 6000);
  assert.ok(!content.includes('SECRET'));
});

test('incomplete and failed turns do not consume the first eligible naming attempt', async () => {
  const { ctx, requests } = fixture();
  const namer = createAutoNamer();
  for (const messages of [[], [answer('partial', 'aborted')], [answer('failure', 'error')], [answer('truncated', 'length')], [answer('')],
    [answer('intermediate'), answer('failure', 'error')],
    [{ ...answer('Checking files'), content: [{ type: 'text', text: 'Checking files' }, { type: 'toolCall', id: 'call', name: 'read', arguments: {} }] }],
  ]) {
    await namer(ctx, 'Configure Pi', messages);
  }
  assert.equal(requests.length, 0);
  await namer(ctx, 'Configure Pi', [answer('Use a versioned configuration repository.')]);
  assert.equal(requests.length, 1);
});

test('duplicate completions do not start another request while a title is pending', async () => {
  const { ctx, requests, getName } = fixture();
  let finish;
  ctx.modelRegistry.streamSimple = (_model, context) => {
    requests.push(context);
    return { result: () => new Promise(resolve => { finish = resolve; }) };
  };
  const namer = createAutoNamer();
  const first = namer(ctx, 'Configure Pi', [answer('Use Git.')]);
  await namer(ctx, 'Configure Pi', [answer('Use Git.')]);
  assert.equal(requests.length, 1);
  const otherManager = { getSessionName: () => '', appendSessionInfo: () => assert.fail('wrong session') };
  ctx.sessionManager = otherManager;
  finish({ stopReason: 'stop', content: [{ type: 'text', text: 'Pi configuration portability' }] });
  await first;
  assert.equal(getName(), 'Pi configuration portability');
});
