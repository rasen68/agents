import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const forks = dirname(fileURLToPath(import.meta.url));
const agent = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi/agent');
const version = readFileSync(
  join(agent, 'install/current-version'), 'utf8'
).trim();
const release = join(agent, 'install/releases', version);
const host = join(release, 'node_modules/@earendil-works/pi-coding-agent');
const { loadExtensions } = await import(
  pathToFileURL(join(host, 'dist/core/extensions/loader.js'))
);
const npm = join(agent, 'npm/node_modules');
const packages = [
  ['pi-claude-bridge', 'src/index.ts'],
];

function snapshot(result) {
  assert.deepEqual(result.errors, []);
  return {
    extensions: result.extensions.map((extension) => ({
      tools: [...extension.tools].map(([name, tool]) => ({
        name,
        label: tool.definition.label,
        description: tool.definition.description,
        parameters: tool.definition.parameters,
        promptSnippet: tool.definition.promptSnippet,
        promptGuidelines: tool.definition.promptGuidelines,
      })),
      commands: [...extension.commands.keys()],
      handlers: [...extension.handlers].map(([name, handlers]) => [
        name, handlers.length,
      ]),
      flags: [...extension.flags.keys()],
      shortcuts: [...extension.shortcuts.keys()],
    })),
    providers: result.runtime.pendingProviderRegistrations.map(
      ({ name, config }) => ({ name, models: config.models })
    ),
  };
}

const sourcePaths = packages.map(([name, entry]) => join(npm, name, entry));
const forkPaths = packages.map(([name, entry]) =>
  join(forks, name, 'dist', entry.replace(/\.ts$/, '.js'))
);
for (const path of forkPaths) {
  assert.ok(existsSync(path), `Missing compiled fork: ${path}`);
}
const original = await loadExtensions(sourcePaths, process.cwd());
const expected = snapshot(original);
for (const handler of original.extensions[0].handlers
  .get('session_shutdown') ?? []) {
  await handler({ type: 'session_shutdown' }, {});
}
original.runtime.invalidate();
const compiled = await loadExtensions(forkPaths, process.cwd());
assert.deepEqual(snapshot(compiled), expected);
console.log('PASS: tools, commands, handlers, schemas, and models match');

const { createRequire } = await import('node:module');
const require = createRequire(pathToFileURL(forkPaths[0]));
const sdk = require('@anthropic-ai/claude-agent-sdk');
assert.equal(typeof sdk.query, 'function');
console.log('PASS: real Claude SDK loads on demand without a request');

const { __test } = await import(pathToFileURL(forkPaths[0]));
const queryCtx = {
  pendingResults: new Map([
    ['probe', { content: [{ type: 'text', text: 'mock result' }] }],
  ]),
  pendingToolCalls: new Map(),
};
assert.equal(__test.buildMcpServers([], queryCtx), undefined);
const servers = __test.buildMcpServers([{
  name: 'probe', description: 'Smoke test', parameters: {
    type: 'object', properties: { text: { type: 'string' } },
  },
}], queryCtx);
const server = Object.values(servers)[0];
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require(
  '@modelcontextprotocol/sdk/inMemory.js'
);
const [clientTransport, serverTransport] =
  InMemoryTransport.createLinkedPair();
const client = new Client({ name: 'pi-startup-test', version: '1.0.0' });
await server.instance.connect(serverTransport);
await client.connect(clientTransport);
const listed = await client.listTools();
assert.equal(listed.tools[0].name, 'probe');
assert.deepEqual(listed.tools[0].inputSchema.properties,
                 { text: { type: 'string' } });
const called = await client.callTool({
  name: 'probe', arguments: { text: 'hello' },
  _meta: { 'claudecode/toolUseId': 'probe' },
});
assert.equal(called.content[0].text, 'mock result');
await client.close();
await server.instance.close();
console.log('PASS: deferred MCP server lists and executes a bridged tool');

for (const handler of compiled.extensions[0].handlers
  .get('session_shutdown') ?? []) {
  await handler({ type: 'session_shutdown' }, {});
}
compiled.runtime.invalidate();
const reloaded = await loadExtensions(forkPaths, process.cwd());
assert.deepEqual(snapshot(reloaded), expected);
console.log('PASS: extension teardown and reload preserve registrations');
process.exit(0);
