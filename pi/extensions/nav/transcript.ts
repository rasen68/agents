import { AssistantMessageComponent } from '@earendil-works/pi-coding-agent';
import type { ExtensionAPI, Theme } from '@earendil-works/pi-coding-agent';
import { Container, matchesKey, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import type { Component, TUI } from '@earendil-works/pi-tui';

type Layout = { width: number; lines: string[]; replies: number[] };

// Pi 1.3 mounts document[header, resources, chat] first in both TUI modes.
// There is no public transcript-component accessor; don't reconstruct messages
// and lose the active renderers, expansion state, or Markdown transformers.
function transcriptComponents(tui: TUI): Component[] {
  const document = tui.children[0];
  if (!(document instanceof Container) || document.children.length !== 3
    || !document.children.every(child => child instanceof Container)) {
    throw new Error('Transcript navigation: unsupported Pi transcript layout.');
  }
  return [document.children[0], document.children[1],
    ...(document.children[2] as Container).children];
}

function isReply(component: Component): boolean {
  if (!(component instanceof AssistantMessageComponent)) return false;
  // Pi keeps the source message here, but doesn't expose a public getter.
  const message = (component as unknown as {
    lastMessage?: { content: { type: string; text?: string }[] };
  }).lastMessage;
  return message?.content.some(part => part.type === 'text' && !!part.text?.trim()) ?? false;
}

class TranscriptViewer implements Component {
  private layout?: Layout;
  private offset?: number;
  private count = '';

  constructor(
    private readonly components: Component[],
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly done: () => void,
  ) {
    const viewportTop = (tui as TUI & { viewportTop?: number }).viewportTop;
    // Regular mode renders the document and prompt as one terminal-owned stream.
    this.offset = viewportTop ?? Math.max(0,
      tui.children.reduce((height, child) => height + child.render(tui.terminal.columns).length, 0)
      - tui.terminal.rows);
  }

  invalidate() {
    this.layout = undefined;
  }

  private getLayout(width: number): Layout {
    if (this.layout?.width === width) return this.layout;
    const lines: string[] = [];
    const replies: number[] = [];
    for (const component of this.components) {
      const rendered = component.render(width);
      if (isReply(component) && rendered.length) replies.push(lines.length);
      lines.push(...rendered);
    }
    this.layout = { width, lines, replies };
    return this.layout;
  }

  handleInput(data: string) {
    if (matchesKey(data, 'alt+n') || matchesKey(data, 'escape')) {
      this.done();
      return;
    }
    if (/^[0-9]$/.test(data)) {
      this.count = String(Math.min(1_000_000, Number(this.count + data)));
      this.tui.requestRender();
      return;
    }

    const amount = Math.max(1, Number(this.count) || 1);
    this.count = '';
    const layout = this.layout;
    if (!layout) return;
    const offset = this.offset ?? 0;
    if (data === 'j' || matchesKey(data, 'down')) this.offset = offset + amount;
    else if (data === 'k' || matchesKey(data, 'up')) this.offset = offset - amount;
    else if (data === 'h' || matchesKey(data, 'left')) {
      const previous = layout.replies.filter(line => line < offset);
      this.offset = previous[Math.max(0, previous.length - amount)] ?? offset;
    } else if (data === 'l' || matchesKey(data, 'right')) {
      const next = layout.replies.filter(line => line > offset);
      this.offset = next[Math.min(next.length - 1, amount - 1)] ?? offset;
    }
    this.offset = Math.max(0, Math.min(layout.lines.length - 1, this.offset ?? offset));
    this.tui.requestRender();
  }

  render(width: number): string[] {
    const height = Math.max(1, this.tui.terminal.rows);
    const layout = this.getLayout(width);
    const pageSize = Math.max(0, height - 1);
    // Preserve the live viewport on entry, including the space below the transcript.
    this.offset ??= 0;
    this.offset = Math.max(0, Math.min(layout.lines.length - 1, this.offset));
    const fill = (text: string) => {
      const clipped = truncateToWidth(text, width);
      return clipped + ' '.repeat(Math.max(0, width - visibleWidth(clipped)));
    };
    const body = layout.lines.slice(this.offset, this.offset + pageSize).map(fill);
    while (body.length < pageSize) body.push(fill(''));
    const first = layout.lines.length ? this.offset + 1 : 0;
    const footer = fill(this.theme.fg('muted',
      ` ${first}-${Math.min(this.offset + pageSize, layout.lines.length)} / ${layout.lines.length}`
      + (this.count ? `  count: ${this.count}` : '  j/k: scroll  h/l: replies')
      + '  Alt+N: prompt'));
    return [...body, footer];
  }
}

export default function registerTranscript(pi: ExtensionAPI) {
  pi.registerShortcut('alt+n', {
    description: 'Navigate the transcript',
    handler: async ctx => {
      if (ctx.mode !== 'tui') return;
      try {
        await ctx.ui.custom<void>((tui, theme, _keys, done) =>
          new TranscriptViewer(transcriptComponents(tui), tui, theme, () => done()), {
          overlay: true,
          overlayOptions: { width: '100%', maxHeight: '100%', anchor: 'top-left', margin: 0 },
        });
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error');
      }
    },
  });
}
