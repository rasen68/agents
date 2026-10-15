import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { GoalsScreen } from "../extensions/widgets/goals-screen.ts";
import { createGoal } from "../extensions/goal-record.ts";
import { registerGoalCommands } from "../extensions/goal-commands.ts";

const theme = { fg: (_: string, text: string) => text, bold: (text: string) => text } as any;
const first = createGoal({ objective: "First goal 漢字", autoContinue: true, sisyphus: false });
const second = createGoal({ objective: "Second goal", autoContinue: false, sisyphus: false });
second.id = "second";
second.status = "paused";
const snapshot = () => ({ goals: [first, second], focusedGoalId: first.id, ledgerEvents: [], draftActive: false });

function screen(done: (result: any) => void = () => {}, selectedId?: string, height = 24) {
	return new GoalsScreen({ theme, snapshot, done, requestRender() {}, height: () => height, selectedId });
}

test("navigation previews a goal without dispatching an action", () => {
	const results: any[] = [];
	const ui = screen(result => results.push(result));
	ui.render(100);
	ui.handleInput("\x1b[B");
	assert.match(ui.render(100).join("\n"), /Second goal/);
	assert.equal(ui.selectedGoalId, second.id);
	assert.deepEqual(results, []);
});

test("actions carry the selected goal, not the focused goal", () => {
	const results: any[] = [];
	const ui = screen(result => results.push(result), second.id);
	ui.handleInput("p");
	assert.deepEqual(results, [{ action: "pauseResume", goalId: second.id }]);
});

test("Esc and Alt+G close without mutating a goal", () => {
	for (const key of ["\x1b", "\x1bg"]) {
		let result: any = "unset";
		const ui = screen(value => { result = value; });
		ui.handleInput(key);
		assert.equal(result, undefined);
	}
});

test("layout respects narrow widths and short terminal heights", () => {
	for (const width of [1, 20, 40, 60, 80, 100, 140]) {
		for (const height of [5, 12, 24]) {
			const lines = screen(undefined, undefined, height).render(width);
			assert.ok(lines.length <= height);
			for (const line of lines) assert.ok(visibleWidth(line) <= width, `${width}: ${line}`);
		}
	}
});

test("empty goals screen still offers creation and settings", () => {
	const ui = new GoalsScreen({ theme, snapshot: () => ({ goals: [], focusedGoalId: null, ledgerEvents: [], draftActive: false }), done() {}, requestRender() {}, height: () => 24 });
	assert.match(ui.render(80).join("\n"), /No open goals/);
	assert.match(ui.render(80).join("\n"), /n New/);
	assert.match(ui.render(80).join("\n"), /s Settings/);
});

test("empty screen uses only its content height without a split-pane divider", () => {
	const ui = new GoalsScreen({ theme, snapshot: () => ({ goals: [], focusedGoalId: null, ledgerEvents: [], draftActive: false }), done() {}, requestRender() {}, height: () => 50 });
	const lines = ui.render(140);
	assert.ok(lines.length <= 6, `Empty screen occupied ${lines.length} lines`);
	assert.ok(!lines.join("\n").includes("│"));
});

test("short goal details don't pad the screen to the height limit", () => {
	const lines = screen(undefined, undefined, 50).render(140);
	assert.ok(lines.length < 20, `Short goals occupied ${lines.length} lines`);
});

test("all action keys dispatch their named action", () => {
	const keys = { n: "new", f: "focus", p: "pauseResume", e: "revise", u: "unfocus", a: "archive", s: "settings", t: "troubleshoot", c: "cancelDraft", v: "auditor", "?": "help" };
	for (const [key, action] of Object.entries(keys)) {
		let result: any;
		const ui = screen(value => { result = value; });
		ui.handleInput(key);
		assert.equal(result?.action, action, key);
	}
});

test("long details scroll to evidence and preserve terminal width", () => {
	const goal = { ...first, objective: Array.from({ length: 60 }, (_, i) => `Objective line ${i} 漢字`).join("\n"),
		taskList: { tasks: [{ id: "t1", title: "Test", status: "complete" as const, evidence: "Evidence at the end" }], blockCompletion: false, proposedAt: first.createdAt } };
	const ui = new GoalsScreen({ theme, snapshot: () => ({ goals: [goal], focusedGoalId: goal.id, ledgerEvents: [], draftActive: false }), done() {}, requestRender() {}, height: () => 24 });
	assert.ok(!ui.render(100).join("\n").includes("Evidence at the end"));
	ui.handleInput("\x1b[F");
	const lines = ui.render(100);
	assert.match(lines.join("\n"), /Evidence at the end/);
	for (const line of lines) assert.ok(visibleWidth(line) <= 100);
});

test("live snapshots reflect progress and selection recovers after removal", () => {
	let goals = [first, second];
	const ui = new GoalsScreen({ theme, snapshot: () => ({ goals, focusedGoalId: first.id, ledgerEvents: [], draftActive: false }), done() {}, requestRender() {}, height: () => 24 });
	ui.render(100);
	goals = [second];
	ui.render(100);
	assert.equal(ui.selectedGoalId, second.id);
	goals = [{ ...second, objective: "Updated objective" }];
	assert.match(ui.render(100).join("\n"), /Updated objective/);
});

test("only /goals and Alt+G are registered", () => {
	const commands: string[] = [];
	const shortcuts: string[] = [];
	registerGoalCommands({ pi: {
		registerCommand(name: string) { commands.push(name); },
		registerShortcut(key: string) { shortcuts.push(key); },
	} } as any);
	assert.deepEqual(commands, ["goals"]);
	assert.deepEqual(shortcuts, ["alt+g"]);
});
