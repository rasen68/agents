import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jiti } from './pi-host.mjs';
const { default: register } = await jiti.import('../pi/extensions/reasoning-shortcuts.ts');

test('reasoning shortcuts step supported levels without wrapping', () => {
  const shortcuts = new Map();
  let current = 'medium';
  register({
    registerShortcut: (key, shortcut) => shortcuts.set(key, shortcut),
    getThinkingLevel: () => current,
    setThinkingLevel: next => { current = next; },
  });
  const ctx = { model: { reasoning: true } };
  shortcuts.get('alt+j').handler(ctx);
  assert.equal(current, 'low');
  shortcuts.get('alt+k').handler(ctx);
  assert.equal(current, 'medium');
  current = 'off';
  shortcuts.get('alt+j').handler(ctx);
  assert.equal(current, 'off');
  for (let i = 0; i < 10; i++) shortcuts.get('alt+k').handler(ctx);
  const maximum = current;
  shortcuts.get('alt+k').handler(ctx);
  assert.equal(current, maximum);
  shortcuts.get('alt+j').handler({});
  assert.equal(current, maximum);
  shortcuts.get('alt+j').handler({ model: { reasoning: false } });
  assert.equal(current, maximum);
});
