import { getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';

export default function (pi: ExtensionAPI) {
  function step(ctx: ExtensionContext, direction: -1 | 1) {
    if (!ctx.model?.reasoning) return;
    const levels = getSupportedThinkingLevels(ctx.model);
    const current = levels.indexOf(pi.getThinkingLevel());
    if (current < 0) return;
    const next = levels[current + direction];
    if (next !== undefined) pi.setThinkingLevel(next);
  }

  pi.registerShortcut('alt+j', {
    description: 'Decrease reasoning level',
    handler: (ctx) => step(ctx, -1),
  });
  pi.registerShortcut('alt+k', {
    description: 'Increase reasoning level',
    handler: (ctx) => step(ctx, 1),
  });
}
