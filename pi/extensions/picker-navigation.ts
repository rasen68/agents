import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { TuiMainScreen, TuiAltScreen } from '@earendil-works/pi-tui';
import { installNavigation } from '../picker-navigation/navigation.mjs';

export default function (pi: ExtensionAPI) {
  const removeMain = installNavigation(TuiMainScreen);
  const removeAlt = installNavigation(TuiAltScreen);
  pi.on('session_shutdown', () => {
    removeMain();
    removeAlt();
  });
}
