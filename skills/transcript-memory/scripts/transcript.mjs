#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { TranscriptStore } from './store.mjs';

const HELP = `Usage:
  node transcript.mjs search ["literal terms"] [options]
  node transcript.mjs read --session-file PATH --entry-id ID [options]

Search options:
  --project PATH       Search this project instead of the current Git root/cwd
  --all-projects       Search across projects
  --from ISO --to ISO  Inclusive date/time bounds; date-only means midnight UTC
  --limit N            Results per page (1..20, default 10)
  --offset N           Pagination offset (0..10000, default 0)
  --exclude-session ID Exclude an exact session ID (repeatable)
  --include-current    Include PI_SESSION_ID, excluded from search by default

Read options:
  --session-id ID      Verify the session identity returned by search
  --branch-leaf-id ID  Select a descendant at a fork; never merges branches
  --before N          Preceding messages (0..20, default 2)
  --after N           Following messages (0..20, default 2)
  --max-chars N       Text budget (500..16000, default 8000)
  --text-offset N     Continue the anchor's text at this character offset

Common options:
  --include-tools     Include tool calls/results and direct shell traffic
  --root PATH         Search only these archive roots (repeatable)
  --help              Show this help

Outputs bounded JSON. Default content is user/assistant prose, titles and topics.
Reasoning, system prompts, images and arbitrary extension metadata are excluded.
Without --root, discovers the agent sessions directory, environment session-dir
and the active PI_SESSION_FILE directory. Use --root for other custom archives.
`;

const string = { type: 'string' };
const common = {
  help: { type: 'boolean' },
  'include-tools': { type: 'boolean' },
  root: { type: 'string', multiple: true },
};
const options = {
  search: { ...common, project: string, 'all-projects': { type: 'boolean' },
    from: string, to: string, limit: string, offset: string,
    'exclude-session': { type: 'string', multiple: true }, 'include-current': { type: 'boolean' } },
  read: { ...common, 'session-file': string, 'session-id': string, 'entry-id': string,
    'branch-leaf-id': string, before: string, after: string, 'max-chars': string, 'text-offset': string },
};
const ranges = { limit: [1, 20], offset: [0, 10000], before: [0, 20], after: [0, 20],
  'max-chars': [500, 16000], 'text-offset': [0, Number.MAX_SAFE_INTEGER] };
const camelCase = name => name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
const expandHome = path => path === '~' ? homedir() : path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === '--help' || command === '-h') { console.log(HELP); return; }
  if (!options[command]) throw new Error('Expected search or read. Use --help for usage.');
  const { values, positionals } = parseArgs({ args, options: options[command], allowPositionals: true });
  if (values.help) { console.log(HELP); return; }
  if (positionals.length > (command === 'search' ? 1 : 0)) throw new Error('Unexpected positional arguments; quote search terms together.');
  if (values.project && values['all-projects']) throw new Error('Choose --project or --all-projects, not both.');
  if (command === 'read' && (!values['session-file'] || !values['entry-id'])) throw new Error('Read requires --session-file and --entry-id.');
  const params = {};
  for (const [name, value] of Object.entries(values)) {
    if (name === 'root' || name === 'help') continue;
    if (ranges[name]) {
      const [min, max] = ranges[name];
      const number = Number(value);
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < min || number > max) {
        throw new Error(`--${name} must be an integer in ${min}..${max}`);
      }
      params[camelCase(name)] = number;
    } else params[camelCase(name)] = value;
  }
  if (params.excludeSession?.some(id => !id.trim())) throw new Error('--exclude-session must not be empty');
  if (params.project) params.project = expandHome(params.project);
  if (params.sessionFile) params.sessionFile = expandHome(params.sessionFile);
  if (command === 'search') params.query = positionals[0] || '';
  const agentDir = expandHome(process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi', 'agent'));
  const roots = values.root || [
    join(agentDir, 'sessions'),
    process.env.PI_CODING_AGENT_SESSION_DIR,
    process.env.PI_SESSION_FILE && dirname(process.env.PI_SESSION_FILE),
  ].filter(Boolean);
  if (roots.some(root => !root.trim())) throw new Error('--root must not be empty');
  const context = { roots: roots.map(root => resolve(expandHome(root))), cwd: process.cwd(),
    currentSessionId: process.env.PI_SESSION_ID };
  if (values.root) {
    for (const root of context.roots) {
      if (!(await stat(root)).isDirectory()) throw new Error(`Archive root must be a directory: ${root}`);
    }
  }
  const store = new TranscriptStore();
  console.log(JSON.stringify(await store[command](params, context)));
}

main().catch(error => {
  console.error(`transcript-memory: ${error.message}`);
  process.exitCode = 1;
});
