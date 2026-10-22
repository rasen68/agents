import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { visibleWidth } from '@earendil-works/pi-tui';
import { createTransformer } from './render.mjs';

export default function (pi: ExtensionAPI) {
  pi.registerMarkdownTransformer(createTransformer(visibleWidth));
}
