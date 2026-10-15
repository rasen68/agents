import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const managed = process.env.PI_MANAGED_INSTALL_ROOT ?? join(homedir(), '.pi/agent/install');
export const modules = join(managed, 'releases', readFileSync(join(managed, 'current-version'), 'utf8').trim(), 'node_modules');
const require = createRequire(join(modules, 'jiti/package.json'));
const { createJiti } = require('jiti');
export const jiti = createJiti(import.meta.url, {
  alias: Object.fromEntries(['pi-ai', 'pi-coding-agent', 'pi-tui'].map(name => [
    `@earendil-works/${name}`, join(modules, `@earendil-works/${name}/dist/index.js`),
  ])),
});
