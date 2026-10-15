import { readFileSync, writeFileSync, renameSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(fileURLToPath(import.meta.url));

export function mergePackages(current, desired, packageRoot = root) {
  const portable = desired.map(entry => {
    const source = typeof entry === 'string' ? entry : entry.source;
    const resolved = source.startsWith('./') ? resolve(packageRoot, source) : source;
    return typeof entry === 'string' ? resolved : { ...entry, source: resolved };
  });
  const identity = entry => {
    const source = typeof entry === 'string' ? entry : entry.source;
    if (source.startsWith('npm:')) return source.replace(/@[^/@]+$/, '');
    // Local forks may have previously been registered relative to the agent dir.
    return source.includes('local-packages/') ? source.split('/').at(-1) : source;
  };
  const managed = new Set(portable.map(identity));
  return [...current.filter(entry => !managed.has(identity(entry))), ...portable];
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status}`);
}

export function install() {
  const agent = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi/agent');
  const defaults = JSON.parse(readFileSync(join(root, 'settings.json'), 'utf8'));
  for (const entry of defaults.packages) {
    const source = typeof entry === 'string' ? entry : entry.source;
    if (source.startsWith('npm:')) run('pi', ['install', source]);
  }
  run('npm', ['--prefix', join(root, 'local-packages'), 'ci', '--ignore-scripts']);
  run('npm', ['--prefix', join(root, 'local-packages'), 'run', 'build']);
  mkdirSync(agent, { recursive: true });
  const path = join(agent, 'settings.json');
  let current;
  try {
    current = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    current = { ...defaults };
  }
  current.packages = mergePackages(current.packages ?? [], defaults.packages);
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(current, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) install();
