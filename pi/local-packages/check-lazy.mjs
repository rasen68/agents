import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const resolved = [];
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes('pi-claude-bridge/dist/')) {
      resolved.push(specifier);
    }
    return nextResolve(specifier, context);
  },
});
const entry = join(root, 'pi-claude-bridge/dist/src/index.js');
await import(pathToFileURL(entry));
assert.ok(!resolved.includes('@anthropic-ai/claude-agent-sdk'),
          'Claude SDK must not load at startup');
assert.ok(!resolved.includes('./mcp-server.js'),
          'Claude MCP server must not load at startup');
hook.deregister();
console.log('PASS: Claude SDK and MCP stay unloaded at startup');
