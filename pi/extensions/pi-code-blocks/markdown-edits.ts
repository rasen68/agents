import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Box, Container, Text } from '@earendil-works/pi-tui';

function isMarkdown(args: { path?: unknown }) {
  return typeof args?.path === 'string' && /\.md$/i.test(args.path);
}

export default function registerMarkdownEdits(pi: ExtensionAPI) {
  pi.registerToolRenderer((toolName, next) => {
    const original = next();
    if ((toolName !== 'edit' && toolName !== 'write') || !original) return original;

    return {
      ...original,
      renderCall(args, theme, context) {
        if (!isMarkdown(args)) return original.renderCall!(args, theme, context);

        const header = new Text(
          `${theme.fg('toolTitle', theme.bold(toolName))} ${theme.fg('accent', args.path)}`,
          0, 0,
        );
        if (original.renderShell !== 'self') return header;

        const background = context.isError ? 'toolErrorBg'
          : context.isPartial ? 'toolPendingBg' : 'toolSuccessBg';
        const block = new Box(context.outputPad, 1, text => theme.bg(background, text));
        block.addChild(header);
        return block;
      },
      renderResult(result, options, theme, context) {
        if (!isMarkdown(context.args)) {
          return original.renderResult!(result, options, theme, context);
        }

        if (context.isError) {
          const message = result.content.filter(item => item.type === 'text')
            .map(item => item.text).join('\n');
          return new Text(theme.fg('error', message), context.outputPad, 0);
        }
        return new Container();
      },
    };
  });
}
