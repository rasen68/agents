import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { TuiMainScreen, TuiAltScreen } from '@earendil-works/pi-tui';
import registerCd from './cd';
import registerReasoning from './reasoning';
import registerTranscript from './transcript';
import { installNavigation } from './navigation.mjs';

export default function (pi: ExtensionAPI) {
  registerCd(pi);
  registerReasoning(pi);
  registerTranscript(pi);

  const removeMain = installNavigation(TuiMainScreen);
  const removeAlt = installNavigation(TuiAltScreen);
  pi.on('session_shutdown', () => {
    removeMain();
    removeAlt();
  });
}
