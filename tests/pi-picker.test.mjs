import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installNavigation, pickerHasEmptySearch } from '../pi/picker-navigation/navigation.mjs';

function component(name, fields = {}) {
  return { constructor: { name }, ...fields };
}

test('only known pickers with exactly empty searches accept navigation', () => {
  for (const value of ['', 'j', ' ', 'query']) {
    assert.equal(pickerHasEmptySearch(component('ModelSelectorComponent', {
      searchInput: { getValue: () => value },
    })), value === '');
  }
  assert.equal(pickerHasEmptySearch(component('Input', { searchInput: { getValue: () => '' } })), false);
  assert.equal(pickerHasEmptySearch(component('SelectList')), true);
  assert.equal(pickerHasEmptySearch(component('TreeSelectorComponent', {
    labelInput: {}, treeList: { getSearchQuery: () => '' },
  })), false);
  const list = component('SessionList', { searchInput: { getValue: () => '' } });
  assert.equal(pickerHasEmptySearch(component('SessionSelectorComponent', { mode: 'list', sessionList: list })), true);
  assert.equal(pickerHasEmptySearch(component('SessionSelectorComponent', { mode: 'rename', sessionList: list })), false);
  assert.equal(pickerHasEmptySearch(component('SettingsList', { searchEnabled: false })), true);
  assert.equal(pickerHasEmptySearch(null), false);
});

test('shared hooks translate keys and restore the original exactly once', () => {
  class TUI {
    focused = component('SelectList');
    getFocusedComponent() { return this.focused; }
    handleTerminalInput(data) { return data; }
  }
  const original = TUI.prototype.handleTerminalInput;
  const first = installNavigation(TUI);
  const second = installNavigation(TUI);
  const tui = new TUI();
  assert.equal(tui.handleTerminalInput('j'), '\x1b[B');
  assert.equal(tui.handleTerminalInput('k'), '\x1b[A');
  assert.equal(tui.handleTerminalInput('x'), 'x');
  tui.focused = component('Input');
  assert.equal(tui.handleTerminalInput('j'), 'j');
  first();
  first();
  assert.notEqual(TUI.prototype.handleTerminalInput, original);
  second();
  assert.equal(TUI.prototype.handleTerminalInput, original);
  assert.throws(() => installNavigation(class Unsupported {}), /unsupported/);
});
