const searchable = new Set([
  'ModelSelectorComponent', 'OAuthSelectorComponent', 'ThinkingSelectorComponent',
  'ScopedModelsSelectorComponent', 'SessionList', 'ResourceList', 'FileExplorer',
]);
const unfiltered = new Set([
  'SelectList', 'ExtensionSelectorComponent', 'UserMessageList',
  'TrustSelectorComponent',
]);

// These are Pi 1.0.0's picker fields, not a generic search through component
// children: a hidden search field must never turn a text dialog into a picker.
export function pickerHasEmptySearch(component) {
  if (!component) return false;
  const name = component.constructor?.name;
  if (searchable.has(name)) return component.searchInput?.getValue() === '';
  if (unfiltered.has(name)) return true;
  switch (name) {
    case 'SessionSelectorComponent':
      return component.mode === 'list' && pickerHasEmptySearch(component.sessionList);
    case 'ConfigSelectorComponent':
      return pickerHasEmptySearch(component.resourceList);
    case 'TreeSelectorComponent':
      return !component.labelInput && component.treeList?.getSearchQuery() === '';
    case 'TreeList':
      return component.getSearchQuery() === '';
    case 'SettingsSelectorComponent':
    case 'WarningSettingsSubmenu':
      return pickerHasEmptySearch(component.settingsList);
    case 'SettingsList':
      return component.submenuComponent
        ? pickerHasEmptySearch(component.submenuComponent)
        : component.searchEnabled === false || component.searchInput?.getValue() === '';
    case 'ThemeSubmenu':
      return pickerHasEmptySearch(component.inputComponent);
    case 'ThemeSelectorComponent':
    case 'ShowImagesSelectorComponent':
      return pickerHasEmptySearch(component.selectList);
    case 'UserMessageSelectorComponent':
      return pickerHasEmptySearch(component.messageList);
    case 'SessionsView':
      if (component.folderExplorer) return pickerHasEmptySearch(component.folderExplorer);
      if (component.resumePicker) return pickerHasEmptySearch(component.resumePicker);
      return component.filterInput?.getValue() === '';
    case 'ResumeSessionPicker':
      return component.filterInput?.getValue() === '';
    default:
      return false;
  }
}

const hookKey = Symbol.for('rui.pi.picker-navigation');

// The public focus getter identifies the active picker, but Pi has no public
// conditional-picker-keybinding hook. Keep this internal interception reversible
// and shared across extension reloads and parallel session runtimes.
export function installNavigation(TUI) {
  const prototype = TUI.prototype;
  let hook = prototype[hookKey];
  if (!hook) {
    const original = prototype.handleTerminalInput;
    if (typeof original !== 'function') throw new Error('Picker navigation: unsupported Pi TUI version');
    const wrapped = function (data) {
      if ((data === 'j' || data === 'k') && pickerHasEmptySearch(this.getFocusedComponent())) {
        data = data === 'j' ? '\x1b[B' : '\x1b[A';
      }
      return original.call(this, data);
    };
    hook = { original, wrapped, users: 0 };
    prototype[hookKey] = hook;
    prototype.handleTerminalInput = wrapped;
  }
  hook.users++;
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    if (--hook.users === 0) {
      if (prototype.handleTerminalInput === hook.wrapped) prototype.handleTerminalInput = hook.original;
      delete prototype[hookKey];
    }
  };
}
