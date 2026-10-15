import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { registerGoalCommands } from "../extensions/goal-commands.ts";
import { createGoal } from "../extensions/goal-record.ts";
import { hasActiveDraft } from "../extensions/goal-drafting.ts";

function harness(t: any, actions: any[], options: { focused?: boolean; busy?: boolean; confirmed?: boolean; onConfirm?: (core: any) => void; archiveFails?: boolean; mode?: string; select?: string | string[]; editor?: string } = {}) {
	const cwd = mkdtempSync(path.join(tmpdir(), "goals-screen-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	const goal = createGoal({ objective: "Test goal", autoContinue: true, sisyphus: false });
	const events: string[] = [];
	const notices: string[] = [];
	let handler: any;
	let sequence = 0;
	const core: any = {
		pi: { registerCommand(_: string, config: any) { handler = config.handler; }, registerShortcut() {}, sendUserMessage() { events.push("draft"); }, appendEntry() {} },
		goalsById: new Map([[goal.id, goal]]), focusedGoalId: options.focused === false ? null : goal.id,
		state: { goal: options.focused === false ? null : goal }, goalModalDepth: 0,
		enterGoalModal() { this.goalModalDepth++; }, exitGoalModal() { this.goalModalDepth--; },
		updateUI() {}, reconcileFocusedGoalFromDisk() {}, syncGoalPromptFromDisk() {},
		openGoals() { return [...this.goalsById.values()].filter((g: any) => g.status !== "complete"); },
		goalForDisplay() { return this.state.goal; },
		focusedOperationToken(id: string) { return { goalId: id, revision: sequence }; },
		isFocusedOperationCurrent(token: any) { return this.focusedGoalId === token.goalId && sequence === token.revision; },
		setFocusedGoalId(id: string | null) { if (this.focusedGoalId !== id) sequence++; this.focusedGoalId = id; this.state.goal = this.goalsById.get(id) ?? null; events.push(id ? "focus" : "unfocus"); },
		armFocusedContinuation() { events.push("start"); },
		pauseActiveGoal() { this.state.goal.status = "paused"; this.state.goal.autoContinue = false; events.push("pause"); },
		scheduler: { resume() { goal.status = "active"; goal.autoContinue = true; events.push("resume"); return true; } },
		goalService: { appendEvents() {} },
		archiveCurrentGoal() { events.push("archive"); if (options.archiveFails) return null; this.goalsById.delete(goal.id); return goal; },
		setGoal(value: any) { this.state.goal = value; this.focusedGoalId = value?.id ?? null; },
		toggleGoalAuditor() { events.push("auditor"); },
		clearContinuationState() {}, clearActiveAccounting() {}, installDraftingToolProfile() {}, installGoalToolProfile() {},
		replaceGoal() { events.push("create"); },
		runtime: { getCheckpointGoalId() { return null; }, setCheckpoint() {}, clearPostCompactReminder() {}, markTurnStopped() {} },
	};
	const ctx: any = {
		cwd, mode: options.mode ?? "tui", hasUI: true, isIdle: () => !options.busy,
		sessionManager: { getSessionId: () => "test-session" }, abort() { events.push("abort"); },
		ui: {
			async custom() { const action = actions.shift(); return action ? { goalId: goal.id, ...action } : undefined; },
			async confirm() { options.onConfirm?.(core); return options.confirmed ?? true; },
			async select() { return Array.isArray(options.select) ? options.select.shift() : options.select; }, async editor() { return options.editor; },
			notify(message: string) { notices.push(message); },
		},
	};
	registerGoalCommands(core);
	return { run: () => handler("", ctx), core, ctx, goal, events, notices };
}

test("opening and closing the screen doesn't change focus or start work", async t => {
	const h = harness(t, []);
	await h.run();
	assert.deepEqual(h.events, []);
	assert.equal(h.core.goalModalDepth, 0);
});

test("goals screen replaces the prompt with a bounded inline component", async t => {
	const h = harness(t, []);
	let rows = 60;
	let component: any;
	h.ctx.ui.custom = async (factory: any, options: any) => {
		assert.ok(!options?.overlay, "Goals screen must not float above the transcript");
		component = factory({ terminal: { get rows() { return rows; } }, requestRender() {} },
			{ fg: (_: string, text: string) => text }, { matches: () => false }, () => {});
		return undefined;
	};
	await h.run();
	h.goal.objective = Array.from({ length: 60 }, (_, i) => `Objective line ${i}`).join("\n");
	assert.ok(component.render(100).length <= 18);
	rows = 20;
	assert.ok(component.render(100).length <= 10);
	rows = 5;
	assert.ok(component.render(100).length <= 5);
});

test("focus explicitly starts the selected goal and closes the screen", async t => {
	const h = harness(t, [{ action: "focus" }], { focused: false });
	await h.run();
	assert.deepEqual(h.events, ["focus", "start"]);
	assert.equal(h.core.goalModalDepth, 0);
});

test("pause stops an active turn as well as updating goal status", async t => {
	const h = harness(t, [{ action: "pauseResume" }], { busy: true });
	await h.run();
	assert.equal(h.goal.status, "paused");
	assert.ok(h.events.includes("abort"));
});

test("resume runs only on an explicit action", async t => {
	const h = harness(t, [{ action: "pauseResume" }]);
	h.goal.status = "paused";
	h.goal.autoContinue = false;
	await h.run();
	assert.ok(h.events.includes("resume"));
});

test("cancelling archive preserves focus and the goal", async t => {
	const h = harness(t, [{ action: "archive" }], { focused: false, confirmed: false });
	await h.run();
	assert.deepEqual(h.events, []);
	assert.equal(h.core.focusedGoalId, null);
	assert.ok(h.core.goalsById.has(h.goal.id));
});

test("confirmed archive works when no goal was focused", async t => {
	const h = harness(t, [{ action: "archive" }], { focused: false });
	await h.run();
	assert.deepEqual(h.events, ["focus", "archive"]);
	assert.equal(h.core.focusedGoalId, null);
	assert.equal(h.core.goalsById.size, 0);
});

test("archive rejects goal revisions changed during confirmation", async t => {
	const h = harness(t, [{ action: "archive" }], { onConfirm(core) { const goal = core.openGoals()[0]; core.goalsById.set(goal.id, { ...goal, revision: goal.revision + 1 }); } });
	await h.run();
	assert.ok(!h.events.includes("archive"));
	assert.match(h.notices.join("\n"), /changed while confirming/);
});

test("archive failure leaves the goal open", async t => {
	const h = harness(t, [{ action: "archive" }], { archiveFails: true });
	await h.run();
	assert.ok(h.core.goalsById.has(h.goal.id));
	assert.equal(h.core.state.goal, h.goal);
	assert.match(h.notices.join("\n"), /Archival failed/);
});

test("cancelling revision doesn't change focus", async t => {
	const h = harness(t, [{ action: "revise" }], { focused: false });
	await h.run();
	assert.deepEqual(h.events, []);
});

test("guided creation starts a draft without creating a persistent goal", async t => {
	const h = harness(t, [{ action: "new" }], { select: ["Regular", "Guided planning and confirmation"], editor: "Add export" });
	await h.run();
	assert.deepEqual(h.events, ["draft"]);
	assert.ok(hasActiveDraft(h.core));
	assert.equal(h.core.goalModalDepth, 0);
});

test("direct creation remains available inside the screen", async t => {
	const h = harness(t, [{ action: "new" }], { select: ["Regular", "Direct (start immediately)"], editor: "Add export" });
	await h.run();
	assert.deepEqual(h.events, ["create"]);
});

test("cancelling new-goal input creates nothing", async t => {
	const h = harness(t, [{ action: "new" }], { select: ["Regular", "Guided planning and confirmation"] });
	await h.run();
	assert.deepEqual(h.events, []);
});

test("explicit revision opens drafting for the selected goal", async t => {
	const h = harness(t, [{ action: "revise" }], { focused: false, editor: "Remove token budget" });
	await h.run();
	assert.deepEqual(h.events, ["focus", "draft"]);
	assert.ok(hasActiveDraft(h.core));
});

test("cancel-draft action restores the execution profile", async t => {
	const h = harness(t, [{ action: "new" }], { select: ["Regular", "Guided planning and confirmation"], editor: "Add export" });
	await h.run();
	assert.ok(hasActiveDraft(h.core));
	h.ctx.ui.custom = async () => { h.ctx.ui.custom = async () => undefined; return { action: "cancelDraft" }; };
	await h.run();
	assert.equal(hasActiveDraft(h.core), false);
});

test("unfocus leaves the goal open and stops active execution", async t => {
	const h = harness(t, [{ action: "unfocus" }], { busy: true });
	await h.run();
	assert.equal(h.core.focusedGoalId, null);
	assert.ok(h.core.goalsById.has(h.goal.id));
	assert.ok(h.events.includes("abort"));
});

test("action failures release the modal guard so the screen can reopen", async t => {
	const h = harness(t, [{ action: "focus" }]);
	h.core.armFocusedContinuation = () => { throw new Error("dispatch failed"); };
	await assert.rejects(h.run(), /dispatch failed/);
	assert.equal(h.core.goalModalDepth, 0);
	await h.run();
});

test("nonterminal mode reports goals without attempting custom UI", async t => {
	const h = harness(t, [{ action: "focus" }], { mode: "rpc", focused: false });
	await h.run();
	assert.deepEqual(h.events, []);
	assert.match(h.notices.join("\n"), /terminal session/);
});
