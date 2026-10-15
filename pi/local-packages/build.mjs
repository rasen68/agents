import {
  existsSync, lstatSync, mkdirSync, readdirSync, readFileSync,
  readlinkSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const agent = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi/agent');
const npm = join(agent, 'npm/node_modules');
const version = readFileSync(
  join(agent, 'install/current-version'), 'utf8'
).trim();
const release = join(agent, 'install/releases', version, 'node_modules');
const packages = [
  'pi-claude-bridge',
];
const { build } = await import('esbuild');

function link(target, path) {
  let existing;
  try {
    existing = lstatSync(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (existing) {
    if (!existing.isSymbolicLink()) {
      throw new Error(`Refusing to replace a non-symlink: ${path}`);
    }
    if (readlinkSync(path) === target) return;
    unlinkSync(path);
  }
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path, 'dir');
}

function installedDependency(packageDir, name) {
  let path = packageDir;
  while (true) {
    const candidate = join(path, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    const parent = dirname(path);
    if (parent === path) {
      throw new Error(`Missing installed dependency: ${name}`);
    }
    path = parent;
  }
}

function sourceFiles(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    if (['dist', 'node_modules', '.git'].includes(entry.name)) return [];
    const child = join(path, entry.name);
    if (entry.isDirectory()) return sourceFiles(child);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')
      ? [child] : [];
  });
}

for (const entry of readdirSync(npm, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
  if (entry.name.startsWith('@')) {
    for (const name of readdirSync(join(npm, entry.name))) {
      const qualified = `${entry.name}/${name}`;
      if (packages.includes(qualified)) continue;
      link(join(npm, qualified), join(root, 'node_modules', qualified));
    }
  } else if (!packages.includes(entry.name)) {
    link(join(npm, entry.name), join(root, 'node_modules', entry.name));
  }
}
for (const name of ['pi-ai', 'pi-agent-core', 'pi-coding-agent', 'pi-tui']) {
  const qualified = `@earendil-works/${name}`;
  link(join(release, qualified), join(root, 'node_modules', qualified));
}
link(join(release, 'typebox'), join(root, 'node_modules/typebox'));

// Reuse Pi's loaded modules without importing its complete SDK entry point.
const exports = [
  ['CONFIG_DIR_NAME, getAgentDir', 'config.js'],
  ['buildSessionContext', 'core/session-manager.js'],
  ['compact', 'core/compaction/compaction.js'],
  ['generateBranchSummary', 'core/compaction/branch-summarization.js'],
  ['formatSkillsForPrompt', 'core/skills.js'],
  ['keyHint', 'modes/interactive/components/keybinding-hints.js'],
];
const facade = join(root, 'node_modules/@local/pi-host');
mkdirSync(facade, { recursive: true });
writeFileSync(join(facade, 'package.json'), JSON.stringify({
  name: '@local/pi-host', private: true, type: 'module',
  exports: { '.': { types: './index.d.ts', default: './index.js' } },
}, null, 2) + '\n');
writeFileSync(join(facade, 'index.js'), [
  'import { readFileSync } from "node:fs";',
  'import { homedir } from "node:os";',
  'import { join } from "node:path";',
  'import { pathToFileURL } from "node:url";',
  'const agent = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi/agent");',
  'const install = pathToFileURL(join(agent, "install") + "/");',
  'const version = readFileSync(new URL("current-version", install), "utf8").trim();',
  'if (!/^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/.test(version)) throw new Error("Invalid managed Pi version");',
  'const host = new URL(`releases/${version}/node_modules/@earendil-works/pi-coding-agent/dist/`, install);',
  ...exports.map(([names, path]) =>
    `export const { ${names} } = await import(new URL(${JSON.stringify(path)}, host));`
  ),
].join('\n') + '\n');
writeFileSync(join(facade, 'index.d.ts'),
  'export * from "@earendil-works/pi-coding-agent";\n');
await import(pathToFileURL(join(facade, 'index.js')));

for (const name of packages) {
  const dir = join(root, name);
  const manifestPath = join(dir, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    const target = packages.includes(dependency)
      ? join(root, dependency)
      : installedDependency(join(npm, name), dependency);
    const local = join(dir, 'node_modules', dependency);
    if (existsSync(local) && !lstatSync(local).isSymbolicLink()) continue;
    link(target, local);
  }
  const entries = sourceFiles(dir);
  await build({
    entryPoints: entries,
    outdir: join(dir, 'dist'),
    outbase: dir,
    bundle: false,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    sourcemap: true,
    logLevel: 'warning',
  });
  if (existsSync(join(dir, 'locales'))) {
    link('../locales', join(dir, 'dist/locales'));
  }
  if (manifest.pi?.extensions) {
    manifest.pi.extensions = manifest.pi.extensions.map((path) =>
      path.startsWith('./dist/') ? path :
        `./dist/${path.replace(/^\.\//, '').replace(/\.ts$/, '.js')}`
    );
  }
  if (manifest.exports) {
    for (const [key, path] of Object.entries(manifest.exports)) {
      if (typeof path === 'string' && path.endsWith('.ts')) {
        manifest.exports[key] =
          `./dist/${path.replace(/^\.\//, '').replace(/\.ts$/, '.js')}`;
      }
    }
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  link(dir, join(root, 'node_modules', name));
  console.log(`Built ${name}: ${entries.length} modules`);
}
console.log(`Host module links target Pi ${version}`);
