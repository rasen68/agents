import assert from "node:assert/strict";
import test from "node:test";
import type { GoalRecord } from "../extensions/goal-record.ts";
import { ALL_REGISTERED_GOAL_TOOLS, applicableGoalTools, GOAL_WORK_TOOL_NAMES } from "../extensions/goal-tool-names.ts";

test("goal creation is absent from every execution tool profile", () => {
	assert.ok(!ALL_REGISTERED_GOAL_TOOLS.includes("create_goal" as never));
	assert.ok(!GOAL_WORK_TOOL_NAMES.includes("create_goal" as never));
	assert.deepEqual(applicableGoalTools(null, true), ["get_goal"]);
	for (const status of ["active", "paused", "blocked", "budget_limited", "complete"] as const) {
		const goal = { status, taskList: { tasks: [{ id: "task-1" }] } } as GoalRecord;
		for (const tasksEnabled of [false, true]) {
			assert.ok(!applicableGoalTools(goal, tasksEnabled).includes("create_goal"), status);
		}
	}
});
