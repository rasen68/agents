import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { TuiMainScreen, TuiAltScreen } from '@earendil-works/pi-tui';
import registerCd from './cd';
import registerReasoning from './reasoning';
import { installNavigation } from './navigation.mjs';

export default function (pi: ExtensionAPI) {
  registerCd(pi);
  registerReasoning(pi);

  const removeMain = installNavigation(TuiMainScreen);
  const removeAlt = installNavigation(TuiAltScreen);
  pi.on('session_shutdown', () => {
    removeMain();
    removeAlt();
  });
}
