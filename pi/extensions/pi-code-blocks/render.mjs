import { spawnSync } from 'node:child_process';
import { stripVTControlCharacters } from 'node:util';

const MAX_CODE_SIZE = 64 * 1024;
const BACKGROUND = '\x1b[48;2;40;40;40m';

function displayBlock(rendered, width, measureWidth) {
  return rendered.split('\n').map(line => {
    const padding = ' '.repeat(Math.max(0, width - measureWidth(line)));
    // Bat resets styles between tokens. Restore our background after every SGR.
    const shaded = BACKGROUND + line.replace(/\x1b\[[0-9;]*m/g, sgr => sgr + BACKGROUND)
      + padding + '\x1b[0m';
    // Inline code keeps Markdown syntax literal without adding visible fence rows.
    const runs = shaded.match(/`+/g) ?? [];
    const delimiter = '`'.repeat(Math.max(1, ...runs.map(run => run.length + 1)));
    return delimiter + shaded + delimiter;
  }).join('\n');
}

export function renderWithBat(code, language, width) {
  // Code is display data, never shell input. Strip terminal commands before bat.
  const input = stripVTControlCharacters(code).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
  const args = ['--color=always', '--paging=never', '--style=numbers,grid',
    '--wrap=character', `--terminal-width=${width}`, '--tabs=4',
    `--language=${language === 'csharp' ? 'cs' : language || 'txt'}`];
  for (const binary of ['batcat', 'bat']) {
    let result = spawnSync(binary, [...args, '-'], {
      input, encoding: 'utf8', timeout: 250, maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    if (result.error?.code === 'ENOENT') continue;
    // Bat rejects unknown Markdown language names. Still provide its plain layout.
    if (!result.error && result.status !== 0 && language) {
      result = spawnSync(binary, [...args.slice(0, -1), '--language=txt', '-'], {
        input, encoding: 'utf8', timeout: 250, maxBuffer: 1024 * 1024,
        windowsHide: true,
      });
    }
    if (result.error || result.status !== 0) return undefined;
    return result.stdout.replace(/\r?\n$/, '');
  }
  return undefined;
}

export function createTransformer(measureWidth, render = renderWithBat) {
  const cache = new Map();
  return (markdown, context) => {
    if (context.messageType !== 'assistant') return markdown;
    const width = Math.floor(context.availableWidth);
    if (!Number.isFinite(width) || width < 14) return markdown;
    const lines = markdown.split('\n');
    const output = [];
    for (let i = 0; i < lines.length; i++) {
      const open = /^( {0,3})(`{3,}|~{3,})([^\r]*)\r?$/.exec(lines[i]);
      if (!open || (open[2][0] === '`' && open[3].includes('`'))) {
        output.push(lines[i]);
        continue;
      }
      const close = new RegExp(`^ {0,3}${open[2][0]}{${open[2].length},}\\s*$`);
      let end = i + 1;
      while (end < lines.length && !close.test(lines[end])) end++;
      if (end === lines.length) {
        output.push(...lines.slice(i));
        break;
      }
      const original = lines.slice(i, end + 1);
      const code = lines.slice(i + 1, end).map(line => {
        const spaces = /^ */.exec(line)[0].length;
        return line.slice(Math.min(spaces, open[1].length));
      }).join('\n');
      const language = open[3].trim().split(/\s+/)[0];
      let rendered;
      if (code.length <= MAX_CODE_SIZE) {
        const key = JSON.stringify([width, language, code]);
        if (!cache.has(key)) {
          const result = render(code, language, width);
          cache.set(key, result === undefined ? undefined : displayBlock(result, width, measureWidth));
          if (cache.size > 128) cache.delete(cache.keys().next().value);
        }
        rendered = cache.get(key);
      }
      if (rendered === undefined) output.push(...original);
      else output.push('', rendered, '');
      i = end;
    }
    return output.join('\n');
  };
}
