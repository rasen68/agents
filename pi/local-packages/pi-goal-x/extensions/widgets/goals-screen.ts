import type { Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, type KeyId } from "@earendil-works/pi-tui";
import type { GoalRecord } from "../goal-record.ts";
import type { GoalLedgerEvent } from "../goal-ledger.ts";
import { deriveGoalDashboardModel } from "./goal-dashboard-model.ts";

export type GoalsAction = "new" | "focus" | "pauseResume" | "revise" | "unfocus" | "archive" | "settings" | "troubleshoot" | "cancelDraft" | "auditor" | "help";
export interface GoalsScreenResult { action: GoalsAction; goalId?: string }
export interface GoalsSnapshot {
	goals: GoalRecord[];
	focusedGoalId: string | null;
	ledgerEvents: GoalLedgerEvent[];
	draftActive: boolean;
	tasksDisabled?: boolean;
}
interface GoalsScreenOptions {
	theme: Theme;
	snapshot: () => GoalsSnapshot;
	done: (result: GoalsScreenResult | undefined) => void;
	requestRender: () => void;
	height: () => number;
	selectedId?: string;
	matchesAction?: (data: string, action: "tui.select.up" | "tui.select.down" | "tui.select.cancel") => boolean;
}

const ACTION_KEYS: Record<string, GoalsAction> = {
	n: "new", f: "focus", p: "pauseResume", e: "revise", u: "unfocus", a: "archive",
	s: "settings", t: "troubleshoot", c: "cancelDraft", v: "auditor", "?": "help",
};
const clean = (text: string) => text.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");

export class GoalsScreen {
	private options: GoalsScreenOptions;
	selectedGoalId: string | undefined;
	private detailOffset = 0;
	private maxDetailOffset = 0;
	private pageSize = 10;

	constructor(options: GoalsScreenOptions) {
		this.options = options;
		const state = options.snapshot();
		this.selectedGoalId = options.selectedId ?? state.focusedGoalId ?? state.goals[0]?.id;
	}

	handleInput(data: string): void {
		const configured = this.options.matchesAction;
		if (matchesKey(data, "escape") || matchesKey(data, "alt+g") || configured?.(data, "tui.select.cancel")) {
			this.options.done(undefined);
			return;
		}
		const goals = this.options.snapshot().goals;
		let index = Math.max(0, goals.findIndex(goal => goal.id === this.selectedGoalId));
		if (matchesKey(data, "up") || configured?.(data, "tui.select.up")) {
			index = Math.max(0, index - 1);
		} else if (matchesKey(data, "down") || configured?.(data, "tui.select.down")) {
			index = Math.min(goals.length - 1, index + 1);
		} else if (matchesKey(data, "pageUp")) {
			this.detailOffset = Math.max(0, this.detailOffset - this.pageSize);
		} else if (matchesKey(data, "pageDown")) {
			this.detailOffset = Math.min(this.maxDetailOffset, this.detailOffset + this.pageSize);
		} else if (matchesKey(data, "home")) {
			this.detailOffset = 0;
		} else if (matchesKey(data, "end")) {
			this.detailOffset = this.maxDetailOffset;
		} else {
			const key = Object.keys(ACTION_KEYS).find(key => matchesKey(data, key as KeyId));
			if (key) this.options.done({ action: ACTION_KEYS[key]!, goalId: this.selectedGoalId });
			return;
		}
		if (goals[index]?.id !== this.selectedGoalId) {
			this.selectedGoalId = goals[index]?.id;
			this.detailOffset = 0;
		}
		this.options.requestRender();
	}

	private details(goal: GoalRecord | undefined, state: GoalsSnapshot, width: number): string[] {
		if (!goal) return wrapTextWithAnsi("No open goals. Press n to draft a new goal, or s for settings.", width);
		const model = deriveGoalDashboardModel(goal, {
			focused: goal.id === state.focusedGoalId, otherOpenGoals: state.goals.length - 1,
			ledgerEvents: state.ledgerEvents, tasksDisabled: state.tasksDisabled,
		})!;
		const lines: string[] = [
			`${model.status.label} · ${model.focused ? "Focused" : "Not focused"} · ${goal.sisyphus ? "Sisyphus" : "Regular"}`,
			`Auditor: ${model.auditorEnabled ? "on" : "off"} · ${model.usage.footerBits || "No usage yet"}`,
		];
		if (model.status.reason) lines.push(`Reason: ${model.status.reason}`);
		if (model.status.suggestedAction) lines.push(`Next: ${model.status.suggestedAction}`);
		if (model.budget) lines.push(`Budget: ${model.budget.used}/${model.budget.total} tokens`);
		lines.push("", "Objective", goal.objective);
		if (model.taskProgress) lines.push("", `Tasks · ${model.taskProgress.completed}/${model.taskProgress.total}`);
		for (const task of model.taskTree) {
			const mark = task.status === "complete" ? "✓" : task.status === "skipped" ? "~" : task.isCurrent ? ">" : "·";
			const indent = "  ".repeat(Math.min(task.depth, 8));
			lines.push(`${indent}${mark} ${task.id} ${task.title}`);
			if (task.verificationContract) lines.push(`${indent}  Verify: ${task.verificationContract}`);
			if (task.evidence) lines.push(`${indent}  Evidence: ${task.evidence}`);
		}
		if (model.goalVerificationContract) lines.push("", "Verification", model.goalVerificationContract);
		if (model.recentActivity.length) lines.push("", "Recent activity", ...model.recentActivity.map(item => item.text));
		if (model.filePath) lines.push("", `File: ${model.filePath}`);
		return lines.flatMap(line => wrapTextWithAnsi(clean(line), Math.max(1, width)));
	}

	render(width: number): string[] {
		const w = Math.max(1, width);
		const height = Math.max(1, this.options.height());
		const state = this.options.snapshot();
		if (!state.goals.some(goal => goal.id === this.selectedGoalId)) {
			this.selectedGoalId = state.goals[0]?.id;
			this.detailOffset = 0;
		}
		const goal = state.goals.find(item => item.id === this.selectedGoalId);
		const theme = this.options.theme;
		const header = theme.fg("accent", `Goals · ${state.goals.length} open${state.draftActive ? " · Draft active" : ""}`);
		const footer = wrapTextWithAnsi("n New  f Focus  p Pause/resume  e Revise  u Unfocus  a Archive  s Settings  ? All actions", w);
		const hints = wrapTextWithAnsi("↑↓ Goals  PgUp/PgDn Details  Esc/Alt+G Close", w);
		const footerLines = [...footer, ...hints];
		const reserved = Math.min(footerLines.length, Math.max(0, height - 3));
		const rows = Math.max(0, height - 2 - reserved);
		const wide = w >= 90 && state.goals.length > 0;
		const listWidth = wide ? Math.min(36, Math.floor(w * 0.32)) : w;
		const detailWidth = wide ? w - listWidth - 3 : w;
		const listRows = wide ? rows : state.goals.length ? Math.min(4, Math.max(1, Math.floor(rows / 3))) : 0;
		const selectedIndex = Math.max(0, state.goals.findIndex(item => item.id === this.selectedGoalId));
		const listStart = Math.max(0, selectedIndex - listRows + 1);
		const list = state.goals.slice(listStart, listStart + listRows).map(item => {
			const title = deriveGoalDashboardModel(item, { focused: item.id === state.focusedGoalId, otherOpenGoals: 0 })!.title;
			const text = clean(`${item.id === this.selectedGoalId ? ">" : " "} ${item.id === state.focusedGoalId ? "*" : " "} ${title} · ${item.status}`);
			return item.id === this.selectedGoalId ? theme.fg("accent", text) : text;
		});
		const details = this.details(goal, state, detailWidth);
		const detailRows = wide ? rows : Math.max(0, rows - listRows);
		this.pageSize = Math.max(1, detailRows);
		this.maxDetailOffset = Math.max(0, details.length - detailRows);
		this.detailOffset = Math.min(this.detailOffset, this.maxDetailOffset);
		const visible = details.slice(this.detailOffset, this.detailOffset + detailRows);
		const body: string[] = [];
		if (wide) {
			for (let i = 0; i < Math.max(list.length, visible.length); i++) {
				const left = truncateToWidth(list[i] ?? "", listWidth);
				body.push(left + " ".repeat(Math.max(0, listWidth - visibleWidth(left))) + theme.fg("border", " │ ") + (visible[i] ?? ""));
			}
		} else {
			body.push(...list, ...visible);
		}
		return [header, theme.fg("border", "─".repeat(w)), ...body, ...footerLines.slice(0, reserved)]
			.slice(0, height).map(line => truncateToWidth(line, w));
	}

	invalidate(): void {}
}
