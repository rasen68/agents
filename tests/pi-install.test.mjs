import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergePackages } from '../pi/install.mjs';

test('package reconciliation replaces anchors and fork paths while retaining unrelated packages', () => {
  const desired = [
    { source: 'npm:pi-claude-bridge@0.9.1', extensions: [] },
    './local-packages/pi-claude-bridge',
    { source: 'npm:pi-btw', skills: [] },
  ];
  const current = ['npm:other', 'npm:pi-claude-bridge',
    './local-packages/pi-claude-bridge', 'npm:pi-btw'];
  const result = mergePackages(current, desired, '/checkout/pi');
  assert.deepEqual(result, ['npm:other', desired[0],
    '/checkout/pi/local-packages/pi-claude-bridge', desired[2]]);
  assert.deepEqual(mergePackages(result, desired, '/checkout/pi'), result);
});

test('scoped npm identities include the scope, not the pinned version', () => {
  assert.deepEqual(mergePackages(['npm:@scope/pkg@1', 'npm:@other/pkg'],
    ['npm:@scope/pkg@2']), ['npm:@other/pkg', 'npm:@scope/pkg@2']);
});
