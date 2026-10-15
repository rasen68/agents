import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { test, after } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const managedRoot = process.env.PI_MANAGED_INSTALL_ROOT ?? join(homedir(), ".pi/agent/install");
const install = process.env.PI_TEST_INSTALL ?? join(managedRoot, "releases", readFileSync(join(managedRoot, "current-version"), "utf8").trim(), "node_modules");
const require = createRequire(`${install}/jiti/package.json`);
const { createJiti } = require("jiti");
const jiti = createJiti(import.meta.url, {
  alias: { "@earendil-works/pi-coding-agent": `${install}/@earendil-works/pi-coding-agent/dist/index.js` },
});
const cd = await jiti.import("./index.ts");
const { SessionManager, createAgentSessionServices, createAgentSessionFromServices, createAgentSessionRuntime } = await import(`${install}/@earendil-works/pi-coding-agent/dist/index.js`);
const root = mkdtempSync(join(tmpdir(), "pi-cd-test-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
after(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  rmSync(root, { recursive: true, force: true });
});
const target = join(root, "space dir");
mkdirSync(target);
writeFileSync(join(root, "file"), "not a directory");

test("resolves relative, absolute, quoted and home paths without running shell code", () => {
  assert.equal(cd.resolveDirectory("space dir", root), target);
  assert.equal(cd.resolveDirectory(target, root), target);
  assert.equal(cd.resolveDirectory('"space dir"', root), target);
  assert.equal(cd.resolveDirectory("'space dir'", root), target);
  assert.equal(cd.resolveDirectory("~", root), homedir());
  assert.equal(cd.resolveDirectory("", root), homedir());
  assert.throws(() => cd.resolveDirectory("missing", root));
  assert.throws(() => cd.resolveDirectory("file", root), /directory/);
  assert.throws(() => cd.resolveDirectory("$(touch injected)", root));
});

test("copies the full tree while retaining the selected branch and leaving the source untouched", () => {
  const source = SessionManager.create(root, join(root, "sessions"));
  const selected = source.appendMessage({ role: "user", content: "keep this", timestamp: Date.now() });
  source.appendMessage({ role: "user", content: "abandoned branch", timestamp: Date.now() });
  source.branch(selected);
  const before = readFileSync(source.getSessionFile(), "utf8");
  const file = cd.copySession(source, target, join(root, "copies"));
  const copy = SessionManager.open(file);
  assert.equal(copy.getCwd(), target);
  assert.notEqual(copy.getSessionId(), source.getSessionId());
  assert.equal(copy.getHeader().parentSession, source.getSessionFile());
  assert.equal(copy.getLeafEntry().parentId, selected);
  assert.deepEqual(copy.getEntries().slice(0, -1), source.getEntries());
  assert.deepEqual(copy.buildSessionProjection().messages, source.buildSessionProjection().messages);
  assert.equal(readFileSync(source.getSessionFile(), "utf8"), before);
  assert.equal(source.getLeafId(), selected);
});

test("copies an empty, unsaved session without losing its setup entries", () => {
  const source = SessionManager.create(root, join(root, "unsaved"));
  source.appendCustomEntry("setup", { value: 42 });
  assert.equal(existsSync(source.getSessionFile()), false);
  const copy = SessionManager.open(cd.copySession(source, target, join(root, "copies")));
  assert.deepEqual(copy.getEntries().slice(0, -1), source.getEntries());
  assert.equal(existsSync(source.getSessionFile()), false);
});

function commandContext(switchSession) {
  const notifications = [];
  let idle = false;
  let handler;
  cd.default({ registerCommand(name, command) {
    assert.equal(name, "cd");
    handler = command.handler;
  } });
  const ctx = {
    cwd: root,
    sessionManager: SessionManager.inMemory(root),
    ui: { notify: (...args) => notifications.push(args) },
    waitForIdle: async () => { idle = true; },
    switchSession: async (file, options) => {
      assert.equal(idle, true);
      return switchSession(file, options, notifications);
    },
  };
  return { handler, ctx, notifications };
}

test("switches using a fresh context, and rejects invalid paths without switching", async () => {
  let switched = 0;
  const { handler, ctx, notifications } = commandContext(async (file, options, messages) => {
    switched++;
    assert.equal(SessionManager.open(file).getCwd(), target);
    await options.withSession({ ui: { notify: (...args) => messages.push(args) } });
    ctx.ui.notify = () => { throw new Error("stale context used"); };
    return { cancelled: false };
  });
  await handler("file", ctx);
  assert.equal(switched, 0);
  assert.equal(notifications.at(-1)[1], "error");
  await handler("space dir", ctx);
  assert.equal(switched, 1);
  assert.deepEqual(notifications.at(-1), [`Working directory: ${target}`, "info"]);
});

test("removes the copied session when switching is cancelled", async () => {
  let copy;
  const { handler, ctx } = commandContext(async (file) => {
    copy = file;
    assert.equal(existsSync(file), true);
    return { cancelled: true };
  });
  await handler("space dir", ctx);
  assert.equal(existsSync(copy), false);
});

test("changing to the same directory does not create a session", async () => {
  const { handler, ctx } = commandContext(async () => { throw new Error("unexpected switch"); });
  await handler(".", ctx);
});

test("real pi runtime changes cwd, bash, read and project instructions without a model call", async () => {
  writeFileSync(join(target, "AGENTS.md"), "PI_CD_DESTINATION_INSTRUCTIONS\n");
  writeFileSync(join(target, "marker.txt"), "destination file\n");
  const agentDir = join(root, "integration-agent");
  const factory = async ({ cwd, sessionManager, sessionStartEvent }) => {
    const services = await createAgentSessionServices({
      cwd, agentDir,
      resourceLoaderOptions: { additionalExtensionPaths: [fileURLToPath(new URL("./index.ts", import.meta.url))] },
    });
    return { ...await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent }), services, diagnostics: services.diagnostics };
  };
  const source = SessionManager.inMemory(root);
  source.appendMessage({ role: "user", content: "remember the conversation", timestamp: Date.now() });
  const runtime = await createAgentSessionRuntime(factory, { cwd: root, agentDir, sessionManager: source });
  const bind = async () => {
    await runtime.session.bindExtensions({
      commandContextActions: { waitForIdle: () => runtime.session.waitForIdle(), switchSession: (file, options) => runtime.switchSession(file, options) },
    });
  };
  runtime.setRebindSession(bind);
  try {
    await bind();
    await runtime.session.prompt(`/cd ${target}`);
    assert.equal(runtime.cwd, target);
    assert.equal(runtime.session.sessionManager.getCwd(), target);
    assert.match(runtime.session.systemPrompt, /PI_CD_DESTINATION_INSTRUCTIONS/);
    assert.ok(runtime.session.messages.some((message) => message.role === "user" && message.content === "remember the conversation"));
    const ctx = runtime.session.createReplacedSessionContext();
    const bash = await runtime.session.getToolDefinition("bash").execute("test-bash", { command: "pwd" }, undefined, undefined, ctx);
    assert.equal(bash.content[0].text.trim(), target);
    const read = await runtime.session.getToolDefinition("read").execute("test-read", { path: "marker.txt" }, undefined, undefined, ctx);
    assert.match(read.content[0].text, /destination file/);
    await runtime.session.getToolDefinition("write").execute("test-write", { path: "created.txt", content: "before" }, undefined, undefined, ctx);
    await runtime.session.getToolDefinition("edit").execute("test-edit", { path: "created.txt", edits: [{ oldText: "before", newText: "after" }] }, undefined, undefined, ctx);
    assert.equal(readFileSync(join(target, "created.txt"), "utf8"), "after");
    assert.equal(existsSync(join(root, "created.txt")), false);
  } finally {
    await runtime.dispose();
  }
});
