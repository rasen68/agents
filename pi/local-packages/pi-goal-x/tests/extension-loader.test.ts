import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadExtensions } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";

test("Pi's actual loader accepts the fork and retains model tools", async () => {
	const entry = fileURLToPath(new URL("../extensions/goal.ts", import.meta.url));
	const result = await loadExtensions([entry], fileURLToPath(new URL("..", import.meta.url)));
	assert.deepEqual(result.errors, []);
	assert.equal(result.extensions.length, 1);
	const extension = result.extensions[0]!;
	assert.deepEqual([...extension.commands.keys()], ["goals"]);
	assert.deepEqual([...extension.shortcuts.keys()], ["alt+g"]);
	assert.equal(extension.tools.has("create_goal"), false, "goal creation belongs to the user interface");
	for (const name of ["get_goal", "update_goal", "set_goal_tasks", "update_goal_task", "propose_goal_draft"]) {
		assert.ok(extension.tools.has(name), name);
	}
});
