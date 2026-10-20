// @ts-nocheck
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	getAgentDir,
	getPackageDir,
	hasTrustRequiringProjectResources,
	InteractiveMode,
	ProjectTrustStore,
	SessionManager,
	SettingsManager,
	type CreateAgentSessionRuntimeFactory,
} from "@earendil-works/pi-coding-agent";
import { SessionWidget, showSessionsView } from "./ui.ts";
import { createAutoNamer } from "./naming.mjs";

const HOST_KEY = "__PI_SESSIONS_HOST__";
const INTERACTIVE_MODE_LIFECYCLE_PATCHED = Symbol.for("pi-sessions.interactiveMode.lifecyclePatched");
const SESSION_STOPPED = Symbol("session-stopped");
const INTERACTIVE_MODE_SPINNER_PATCHED = Symbol.for(
	"pi-sessions.interactiveMode.spinnerPatched",
);

type ExtensionAPI = any;
type CommandContext = any;
type Activity = "idle" | "working" | "waiting";
type LiveState = "active" | "suspended" | "starting" | "stopped" | "error";
type WorkingIndicatorOptions = { frames?: string[]; intervalMs?: number };

type LiveSessionRecord = {
	id: string;
	name: string;
	cwd: string;
	state: LiveState;
	activity: Activity;
	sessionFile?: string;
	sessionId?: string;
	createdAt: number;
	lastActivityAt: number;
	status?: string;
	transcript?: string;
	runtime?: any;
	mode?: any;
	adapter?: InteractiveModeAdapter;
	sessionManager?: any;
	context?: CommandContext;
	inheritance?: any;
	started?: boolean;
	runPromise?: Promise<void>;
	expectedStop?: boolean;
	stopPromise?: Promise<void>;
	error?: string;
};

function readFirstMessage(filePath: string | undefined): string {
	if (!filePath) return "";
	try {
		const content = fs.readFileSync(filePath, "utf8");
		for (const line of content.split("\n")) {
			if (!line.trim()) continue;
			try {
				const entry = JSON.parse(line);
				if (entry.type !== "message") continue;
				const msg = entry.message;
				if (!msg || msg.role !== "user") continue;
				const text =
					typeof msg.content === "string"
						? msg.content
						: Array.isArray(msg.content)
							? msg.content
									.filter((p: any) => p.type === "text")
									.map((p: any) => p.text)
									.join(" ")
							: "";
				if (text.trim()) return text.trim().slice(0, 200);
			} catch {}
		}
	} catch {}
	return "";
}

function resolveTranscriptName(
	sessionName?: string,
	sessionFile?: string,
): string {
	return sessionName || readFirstMessage(sessionFile) || "";
}

function sanitizeName(name: string): string {
	return (
		String(name || "")
			.trim()
			.replace(/[^a-zA-Z0-9_.-]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 64) || `session-${Date.now().toString(36)}`
	);
}

let modelResolverPromise: Promise<any> | null = null;
const runtimeInheritanceBySessionManager = new WeakMap<object, any>();

async function loadModelResolver(): Promise<any> {
	modelResolverPromise ??= import(
		pathToFileURL(path.join(getPackageDir(), "dist/core/model-resolver.js"))
			.href
	);
	return await modelResolverPromise;
}

function sameModel(a: any, b: any): boolean {
	return !!a && !!b && a.provider === b.provider && a.id === b.id;
}

function hasExistingMessages(sessionManager: any): boolean {
	return (sessionManager.buildSessionContext?.().messages?.length ?? 0) > 0;
}

function inferThinkingLevel(ctx: CommandContext): string | undefined {
	const branch = ctx.sessionManager?.getBranch?.() ?? [];
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry?.type === "thinking_level_change" && entry.thinkingLevel) {
			return entry.thinkingLevel;
		}
	}
	return undefined;
}

function collectRuntimeInheritance(ctx?: CommandContext): any {
	if (!ctx) return {};
	const promptOptions = ctx.getSystemPromptOptions?.() ?? {};
	const sessionOptions: any = {};
	if (Array.isArray(promptOptions.selectedTools)) {
		sessionOptions.tools = [...promptOptions.selectedTools];
	}
	if (ctx.model) sessionOptions.model = ctx.model;
	const thinkingLevel = inferThinkingLevel(ctx);
	if (thinkingLevel) sessionOptions.thinkingLevel = thinkingLevel;
	return {
		ctx,
		authStorage: ctx.modelRegistry?.authStorage,
		sessionOptions,
	};
}

function safeCollectRuntimeInheritance(ctx?: CommandContext): any {
	try {
		return collectRuntimeInheritance(ctx);
	} catch {
		return {};
	}
}

function createInheritedSettingsManager(
	cwd: string,
	agentDir: string,
	inheritance: any,
): { settingsManager: any; diagnostics: any[] } {
	const diagnostics: any[] = [];
	const sameCwd =
		inheritance?.ctx?.cwd &&
		path.resolve(inheritance.ctx.cwd) === path.resolve(cwd);
	let projectTrusted = true;
	if (sameCwd) {
		projectTrusted = inheritance.ctx.isProjectTrusted?.() ?? true;
	} else if (hasTrustRequiringProjectResources(cwd)) {
		const trustStore = new ProjectTrustStore(agentDir);
		projectTrusted = trustStore.get(cwd) === true;
		if (!projectTrusted) {
			diagnostics.push({
				type: "warning",
				message: `Project resources in session cwd are not trusted: ${cwd}`,
			});
		}
	}
	return {
		settingsManager: SettingsManager.create(cwd, agentDir, { projectTrusted }),
		diagnostics,
	};
}

async function resolveChildSessionOptions(
	services: any,
	sessionManager: any,
	inheritance: any,
): Promise<any> {
	const options: any = { ...(inheritance?.sessionOptions ?? {}) };
	const existing = hasExistingMessages(sessionManager);
	if (existing) {
		delete options.model;
		delete options.thinkingLevel;
	}

	const patterns = services.settingsManager?.getEnabledModels?.();
	if (!patterns?.length) return options;

	const { resolveModelScope } = await loadModelResolver();
	const scopedModels = await resolveModelScope(
		patterns,
		services.modelRegistry,
	);
	if (!scopedModels.length) return options;

	options.scopedModels = scopedModels;
	if (!existing) {
		const inheritedModel = inheritance?.sessionOptions?.model;
		const savedProvider = services.settingsManager?.getDefaultProvider?.();
		const savedModelId = services.settingsManager?.getDefaultModel?.();
		const savedModel =
			savedProvider && savedModelId
				? services.modelRegistry.find(savedProvider, savedModelId)
				: undefined;
		const selected =
			scopedModels.find((scoped: any) =>
				sameModel(scoped.model, inheritedModel),
			) ??
			scopedModels.find((scoped: any) => sameModel(scoped.model, savedModel)) ??
			scopedModels[0];
		options.model = selected.model;
		if (selected.thinkingLevel) options.thinkingLevel = selected.thinkingLevel;
	}

	return options;
}

function asString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

function inferToolPaths(toolName: string, input: any): string[] {
	const paths = new Set<string>();
	if (toolName === "write" || toolName === "edit") {
		const p =
			asString(input?.path) ||
			asString(input?.file_path) ||
			asString(input?.filePath);
		if (p) paths.add(p);
	}
	if (toolName === "bash") {
		const command = asString(input?.command) || "";
		const redir = [...command.matchAll(/(?:>|>>|2>|&>)\s*([^\s;&|]+)/g)].map(
			(m) => m[1],
		);
		for (const p of redir) {
			if (p && !p.startsWith("/dev/")) paths.add(p.replace(/^["']|["']$/g, ""));
		}
		const mutating =
			/\b(rm|mv|cp|touch|mkdir|rmdir|chmod|chown|install|tee|sed\s+-i|perl\s+-i|python\b.*\b(open|write)|node\b.*writeFile)\b/.test(
				command,
			);
		if (mutating) {
			const tokens = command.match(/(?:\.\.?|~|\/)?[\w@%+=:,./-]+/g) || [];
			for (const token of tokens) {
				if (token.includes("/") || token.startsWith("."))
					paths.add(token.replace(/^["']|["']$/g, ""));
			}
			if (paths.size === 0) paths.add(".");
		}
	}
	return [...paths];
}

function needsPermission(
	toolName: string,
	input: any,
	sessionName: string,
): string | null {
	if (toolName === "bash") {
		const command = asString(input?.command) || "";
		if (/\bsudo\b|\brm\s+(-rf?|--recursive|--force)/i.test(command)) {
			return `Dangerous bash command in ${sessionName}: ${command}`;
		}
	}
	return null;
}

function resetExtendedKeyboardModesForHandoff(): void {
	try {
		process.stdout.write("\x1b[<999u\x1b[>4;0m");
	} catch {}
}

function normalizeLockPath(p: string, cwd: string): string | null {
	if (!p || typeof p !== "string") return null;
	if (p.startsWith("~")) return path.join(os.homedir(), p.slice(1));
	return path.resolve(cwd || process.cwd(), p);
}

function pathsConflict(a: string, b: string): boolean {
	const ar = a.endsWith(path.sep) ? a : a + path.sep;
	const br = b.endsWith(path.sep) ? b : b + path.sep;
	return a === b || a.startsWith(br) || b.startsWith(ar);
}

class LockManager {
	locks = new Map<string, { sessionId: string; acquiredAt: number }>();
	heldByToolCall = new Map<string, { sessionId: string; paths: string[] }>();

	acquire(sessionId: string, rawPaths: string[], cwd: string) {
		const paths = [
			...new Set(
				(rawPaths || []).map((p) => normalizeLockPath(p, cwd)).filter(Boolean),
			),
		].sort();
		const conflicts = [];
		for (const p of paths) {
			for (const [held, info] of this.locks.entries()) {
				if (info.sessionId !== sessionId && pathsConflict(p, held)) {
					conflicts.push({ path: p, heldPath: held, by: info.sessionId });
				}
			}
		}
		if (conflicts.length) return { ok: false, conflicts };
		const acquiredAt = Date.now();
		for (const p of paths) this.locks.set(p, { sessionId, acquiredAt });
		return { ok: true, paths };
	}

	release(sessionId: string, rawPaths?: string[]) {
		const wanted = rawPaths?.length ? new Set(rawPaths) : null;
		const released = [];
		if (!wanted) {
			for (const [id, info] of this.heldByToolCall) {
				if (info.sessionId === sessionId) this.heldByToolCall.delete(id);
			}
		}
		for (const [p, info] of this.locks.entries()) {
			if (info.sessionId === sessionId && (!wanted || wanted.has(p))) {
				this.locks.delete(p);
				released.push(p);
			}
		}
		return released;
	}

	releaseByToolCall(toolCallId: string) {
		const held = this.heldByToolCall.get(toolCallId);
		if (!held) return [];
		this.heldByToolCall.delete(toolCallId);
		return this.release(held.sessionId, held.paths);
	}
}

class InteractiveModeAdapter {
	state: "never-started" | "active" | "suspended" | "stopped" = "never-started";
	private terminalGateInstalled = false;
	private originalSetProgress?: any;
	private originalSetTitle?: any;

	constructor(
		readonly id: string,
		readonly runtime: any,
		readonly mode: any,
		private readonly host: PiSessionsHost,
	) {}

	get ui(): any {
		return (this.mode as any).ui;
	}

	installTerminalGate(): void {
		if (this.terminalGateInstalled) return;
		const terminal = this.ui?.terminal;
		if (!terminal) return;
		this.terminalGateInstalled = true;
		this.originalSetProgress = terminal.setProgress?.bind(terminal);
		this.originalSetTitle = terminal.setTitle?.bind(terminal);
		if (this.originalSetProgress) {
			terminal.setProgress = (active: boolean) => {
				if (this.host.activeId === this.id) this.originalSetProgress(active);
			};
		}
		if (this.originalSetTitle) {
			terminal.setTitle = (...args: any[]) => {
				if (this.host.activeId === this.id) this.originalSetTitle(...args);
			};
		}
	}

	async start(): Promise<void> {
		if (this.state !== "never-started") return this.resume();
		this.installTerminalGate();
		this.state = "active";
		await this.mode.init();
		const record = this.host.get(this.id);
		if (record) {
			record.started = true;
			record.state = "active";
			record.runPromise = this.mode.run().catch((error: any) => {
				record.state = record.expectedStop ? "stopped" : "error";
				record.error = String(error?.message || error);
				record.status = record.error;
				this.host.locks.release(record.id);
				this.host.notify();
			});
		} else {
			void this.mode.run();
		}
	}

	suspend(): void {
		if (this.state === "stopped") return;
		try {
			this.mode?.unregisterSignalHandlers?.();
			this.ui?.stop?.();
			resetExtendedKeyboardModesForHandoff();
		} catch {}
		this.state = "suspended";
		const record = this.host.get(this.id);
		if (record && record.state !== "stopped" && record.state !== "error")
			record.state = "suspended";
	}

	resume(): void {
		if (this.state === "stopped") return;
		this.installTerminalGate();
		try {
			this.mode?.registerSignalHandlers?.();
			this.ui?.start?.();
			this.ui?.requestRender?.(true);
		} catch {}
		this.state = "active";
		const record = this.host.get(this.id);
		if (record) record.state = "active";
	}

	async dispose(): Promise<void> {
		this.state = "stopped";
		const ui = this.ui;
		const originalUiStop = ui?.stop?.bind(ui);
		const canTouchTerminal = this.host.activeId === this.id;
		const errors: unknown[] = [];
		try {
			if (ui && originalUiStop && !canTouchTerminal) {
				ui.stop = () => {};
			}
			try { await this.runtime?.session?.abort?.(); } catch (error) { errors.push(error); }
			this.mode?.cancelSessionInput?.();
			// Fullscreen transcript output replaces the renderer and stops stdin.
			// Only the final terminal owner may do that during process exit.
			const exitOutput = canTouchTerminal && this.host.listLive().length === 0 ? undefined : "resume-hint";
			try { this.mode?.stop?.(exitOutput); } catch (error) { errors.push(error); }
			try { await this.runtime?.dispose?.(); } catch (error) { errors.push(error); }
		} finally {
			if (ui && originalUiStop) ui.stop = originalUiStop;
		}
		if (errors.length) throw new AggregateError(errors, "Session cleanup failed");
	}
}

const createRuntime: CreateAgentSessionRuntimeFactory = async ({
	cwd,
	agentDir,
	sessionManager,
	sessionStartEvent,
}) => {
	const host = getHost();
	const activeRecord = host.get(host.activeId);
	let inheritance = runtimeInheritanceBySessionManager.get(sessionManager);
	// Session replacement creates a fresh manager, so recover inheritance from
	// the active runtime without adding metadata to its conversation history.
	if (!inheritance && activeRecord) {
		inheritance =
			activeRecord.inheritance ??
			safeCollectRuntimeInheritance(activeRecord.context);
		runtimeInheritanceBySessionManager.set(sessionManager, inheritance);
		activeRecord.inheritance = inheritance;
	}
	inheritance ??= {};
	const inheritedSettings = createInheritedSettingsManager(
		cwd,
		agentDir,
		inheritance,
	);
	const services = await createAgentSessionServices({
		cwd,
		agentDir,
		authStorage: inheritance.authStorage,
		settingsManager: inheritedSettings.settingsManager,
	});
	services.diagnostics.push(...inheritedSettings.diagnostics);
	let sessionOptions: any = {};
	try {
		sessionOptions = await resolveChildSessionOptions(
			services,
			sessionManager,
			inheritance,
		);
	} catch (error) {
		services.diagnostics.push({
			type: "warning",
			message: `Failed to resolve inherited session options: ${String(error)}`,
		});
	}
	const result = await createAgentSessionFromServices({
		services,
		sessionManager,
		sessionStartEvent,
		...sessionOptions,
	});
	return {
		...result,
		services,
		diagnostics: services.diagnostics,
	};
};

export class PiSessionsHost {
	activeId: string | null = null;
	records = new Map<string, LiveSessionRecord>();
	subscribers = new Set<() => void>();
	locks = new LockManager();
	private transitionTail: Promise<void> = Promise.resolve();
	workingIndicator: WorkingIndicatorOptions | undefined = undefined;
	private recent: string[] = [];
	private ownedModes = new WeakMap<object, LiveSessionRecord>();
	private shutdownPromise?: Promise<void>;
	private exited = false;

	constructor(private readonly exit = (code: number) => process.exit(code)) {}

	adoptMode(mode: any): LiveSessionRecord {
		const existing = this.recordForMode(mode);
		if (existing) {
			this.ownedModes.set(mode, existing);
			return existing;
		}
		const manager = mode.runtimeHost.session.sessionManager;
		const cwd = manager.getCwd?.() || process.cwd();
		const id = `live-${manager.getSessionId()}`;
		const record: LiveSessionRecord = {
			id, name: path.basename(cwd) || "session", cwd,
			state: this.activeId ? "suspended" : "active", activity: "idle",
			createdAt: Date.now(), lastActivityAt: Date.now(),
			sessionManager: manager, sessionId: manager.getSessionId(),
			sessionFile: manager.getSessionFile?.(),
			transcript: resolveTranscriptName(manager.getSessionName?.(), manager.getSessionFile?.()),
			runtime: mode.runtimeHost, mode, started: true,
		};
		record.adapter = new InteractiveModeAdapter(id, record.runtime, mode, this);
		record.adapter.state = record.state;
		this.records.set(id, record);
		if (!this.activeId) {
			this.activeId = id;
			this.recent.push(id);
		}
		record.adapter.installTerminalGate();
		this.ownedModes.set(mode, record);
		return record;
	}

	recordForMode(mode: any): LiveSessionRecord | undefined {
		return this.ownedModes.get(mode) || [...this.records.values()].find(record => record.mode === mode);
	}

	get(id: string | null): LiveSessionRecord | undefined {
		return (
			this.records.get(id) ||
			[...this.records.values()].find((r) => r.name === id)
		);
	}

	subscribe(listener: () => void): () => void {
		this.subscribers.add(listener);
		return () => this.subscribers.delete(listener);
	}

	notify(): void {
		for (const listener of [...this.subscribers]) {
			try {
				listener();
			} catch {}
		}
	}

	publicSession(record: LiveSessionRecord): any {
		return {
			id: record.id,
			sessionId: record.sessionId,
			sessionFile: record.sessionFile,
			name: record.name,
			cwd: record.cwd,
			state: record.state,
			status: record.status || record.state,
			pid: process.pid,
			lastActivityAt: record.lastActivityAt,
			agentStatus: record.activity || "idle",
			transcript: record.transcript || "",
		};
	}

	snapshot(): any {
		return {
			attached: this.activeId,
			updatedAt: Date.now(),
			sessions: this.listLive().map((r) => this.publicSession(r)),
		};
	}

	listLive(): LiveSessionRecord[] {
		return [...this.records.values()].filter(
			(r) => !["stopped", "error"].includes(r.state),
		);
	}

	private updateRecordFromContext(
		record: LiveSessionRecord,
		ctx: CommandContext,
	): LiveSessionRecord {
		record.context = ctx;
		record.cwd = ctx.cwd || record.cwd;
		record.sessionManager = ctx.sessionManager || record.sessionManager;
		record.sessionId = ctx.sessionManager?.getSessionId?.() || record.sessionId;
		record.sessionFile =
			ctx.sessionManager?.getSessionFile?.() || record.sessionFile;
		record.transcript = resolveTranscriptName(
			ctx.sessionManager?.getSessionName?.(),
			record.sessionFile,
		);
		record.lastActivityAt = Date.now();
		this.notify();
		return record;
	}

	findSessionContext(ctx: CommandContext): LiveSessionRecord | undefined {
		const sessionId = ctx.sessionManager?.getSessionId?.();
		const sessionFile = ctx.sessionManager?.getSessionFile?.();
		return [...this.records.values()].find((r) => {
			const manager = r.runtime?.session?.sessionManager || r.sessionManager;
			return (sessionId && manager?.getSessionId?.() === sessionId) ||
				(sessionFile && manager?.getSessionFile?.() === sessionFile) ||
				ctx.sessionManager === r.sessionManager;
		});
	}

	bindSessionContext(ctx: CommandContext): LiveSessionRecord {
		const record = this.findSessionContext(ctx);
		if (!record) throw new Error("Session context is not owned by the live-session host");
		return this.updateRecordFromContext(record, ctx);
	}

	updateActivity(ctx: CommandContext, activity: Activity): void {
		const record = this.bindSessionContext(ctx);
		record.activity = activity;
		record.lastActivityAt = Date.now();
		this.notify();
	}

	currentContextId(ctx: CommandContext): string {
		return this.bindSessionContext(ctx).id;
	}

	async createSessionFromContext(
		ctx: CommandContext,
		cwd: string,
	): Promise<LiveSessionRecord> {
		this.bindSessionContext(ctx);
		const sessionManager = SessionManager.create(cwd, undefined, {});
		return await this.createRecordForSessionManager({
			name: path.basename(cwd || process.cwd()) || "session",
			cwd,
			sessionManager,
			inheritance: safeCollectRuntimeInheritance(ctx),
		});
	}

	async openSavedSessionAsLive(
		sessionPath: string,
		cwdOverride?: string,
		ctx?: CommandContext,
	): Promise<LiveSessionRecord> {
		const existing = [...this.records.values()].find(
			(r) =>
				r.sessionFile === sessionPath &&
				!["stopped", "error"].includes(r.state),
		);
		if (existing) return existing;
		const sessionManager = SessionManager.open(
			sessionPath,
			undefined,
			cwdOverride,
		);
		const cwd = sessionManager.getCwd?.() || cwdOverride || process.cwd();
		const name = sanitizeName(
			sessionManager.getSessionName?.() ||
				path.basename(cwd) ||
				sessionManager.getSessionId?.(),
		);
		return await this.createRecordForSessionManager({
			name,
			cwd,
			sessionManager,
			inheritance: safeCollectRuntimeInheritance(ctx),
		});
	}

	private async createRecordForSessionManager(opts: {
		name: string;
		cwd: string;
		sessionManager: any;
		inheritance?: any;
	}): Promise<LiveSessionRecord> {
		const id = `${sanitizeName(opts.name)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
		const record: LiveSessionRecord = {
			id,
			name: sanitizeName(opts.name),
			cwd: opts.cwd,
			state: "starting",
			activity: "idle",
			sessionManager: opts.sessionManager,
			sessionFile: opts.sessionManager.getSessionFile?.(),
			sessionId: opts.sessionManager.getSessionId?.(),
			createdAt: Date.now(),
			lastActivityAt: Date.now(),
			transcript: resolveTranscriptName(
				opts.sessionManager.getSessionName?.(),
				opts.sessionManager.getSessionFile?.(),
			),
			inheritance: opts.inheritance,
		};
		this.records.set(id, record);
		this.notify();
		if (opts.inheritance) {
			runtimeInheritanceBySessionManager.set(
				opts.sessionManager,
				opts.inheritance,
			);
		}
		try {
			const runtime = await createAgentSessionRuntime(createRuntime, {
				cwd: opts.cwd,
				agentDir: getAgentDir(),
				sessionManager: opts.sessionManager,
				sessionStartEvent: { type: "session_start", reason: "startup" } as any,
			});
			record.runtime = runtime;
			const mode = new InteractiveMode(runtime, {
				migratedProviders: [],
				modelFallbackMessage: runtime.modelFallbackMessage,
				initialMessage: undefined,
				initialImages: [],
				initialMessages: [],
			});
			record.mode = mode;
			record.adapter = new InteractiveModeAdapter(id, runtime, mode, this);
			record.state = "suspended";
			record.transcript = resolveTranscriptName(
				opts.sessionManager.getSessionName?.(),
				opts.sessionManager.getSessionFile?.(),
			);
			this.notify();
			return record;
		} catch (error) {
			await this.disposeRecord(record);
			this.notify();
			throw error;
		}
	}

	private enqueue(action: () => Promise<void>): Promise<void> {
		const result = this.transitionTail.then(action);
		this.transitionTail = result.catch(() => {});
		return result;
	}

	stopSession(nameOrId: string): Promise<void> {
		const record = this.get(nameOrId);
		if (!record) return Promise.reject(new Error("session not found"));
		record.stopPromise ??= this.enqueue(async () => {
			if (this.records.has(record.id)) await this.doStopSession(record);
		});
		return record.stopPromise;
	}

	private async disposeRecord(record: LiveSessionRecord): Promise<unknown[]> {
		const errors: unknown[] = [];
		record.expectedStop = true;
		record.state = "stopped";
		record.status = "stopped";
		if (this.activeId === record.id) {
			try { await record.mode?.ui?.terminal?.drainInput?.(1000); } catch (error) { errors.push(error); }
		}
		try { await record.adapter?.dispose(); } catch (error) { errors.push(error); }
		this.locks.release(record.id);
		this.records.delete(record.id);
		this.recent = this.recent.filter(id => id !== record.id);
		if (this.activeId === record.id) this.activeId = null;
		return errors;
	}

	private async doStopSession(record: LiveSessionRecord): Promise<void> {
		const wasActive = this.activeId === record.id;
		const errors = await this.disposeRecord(record);
		this.notify();
		if (!this.listLive().length) {
			await this.disposeAll(errors);
		} else if (wasActive) {
			const next = this.recent.find(id => this.listLive().some(record => record.id === id)) || this.listLive()[0].id;
			await this.doActivate(this.get(next)!);
		}
		if (errors.length) throw new AggregateError(errors, "Session cleanup failed");
	}

	shutdown(): Promise<void> {
		this.shutdownPromise ??= this.enqueue(() => this.disposeAll());
		return this.shutdownPromise;
	}

	private async disposeAll(errors: unknown[] = []): Promise<void> {
		if (this.exited) return;
		const active = this.get(this.activeId);
		const records = [...this.records.values()].filter(record => record !== active);
		if (active) records.push(active);
		for (const record of records) errors.push(...await this.disposeRecord(record));
		this.subscribers.clear();
		this.exited = true;
		this.exit(errors.length ? 1 : 0);
		if (errors.length) throw new AggregateError(errors, "Session cleanup failed");
	}

	activate(targetIdOrName: string): Promise<void> {
		return this.enqueue(async () => {
			const target = this.get(targetIdOrName);
			if (!target || ["stopped", "error"].includes(target.state))
				throw new Error(`session not found: ${targetIdOrName}`);
			await this.doActivate(target);
		});
	}

	private async doActivate(target: LiveSessionRecord): Promise<void> {
		if (target.id === this.activeId) return;
		const current = this.get(this.activeId);
		current?.adapter?.suspend();
		this.activeId = target.id;
		target.state = "active";
		try {
			if (!target.started) await target.adapter?.start();
			else target.adapter?.resume();
		} catch (error) {
			const errors = [error, ...await this.disposeRecord(target)];
			if (current && this.records.has(current.id) && !current.expectedStop) {
				this.activeId = current.id;
				current.adapter?.resume();
			} else if (this.listLive().length) {
				await this.doActivate(this.listLive()[0]);
			} else {
				await this.disposeAll(errors);
			}
			this.notify();
			if (errors.length > 1) throw new AggregateError(errors, "Session activation failed");
			throw error;
		}
		this.recent = [target.id, ...this.recent.filter(id => id !== target.id)];
		this.notify();
	}

	async activateFromContext(
		ctx: CommandContext,
		targetId: string,
	): Promise<void> {
		this.currentContextId(ctx);
		await this.activate(targetId);
	}
}

function getHost(): PiSessionsHost {
	const g = globalThis as any;
	if (!g[HOST_KEY]) g[HOST_KEY] = new PiSessionsHost();
	if (typeof g[HOST_KEY].adoptMode !== "function")
		throw new Error("Restart Pi to load the new live-session host; the parent-based runtime cannot be migrated with /reload");
	return g[HOST_KEY];
}

export function installSessionLifecycle(host: PiSessionsHost, Mode = InteractiveMode): void {
	const proto = Mode.prototype;
	if (proto[INTERACTIVE_MODE_LIFECYCLE_PATCHED]) return;
	const init = proto.init;
	const shutdown = proto.shutdown;
	const run = proto.run;
	const getUserInput = proto.getUserInput;
	if (typeof run === "function" && typeof getUserInput === "function") {
		proto.getUserInput = function () {
			if (host.recordForMode(this)?.expectedStop) return Promise.reject(SESSION_STOPPED);
			return new Promise((resolve, reject) => {
				const cancel = () => {
					this.onInputCallback = undefined;
					reject(SESSION_STOPPED);
				};
				this.cancelSessionInput = cancel;
				Promise.resolve(getUserInput.call(this)).then(resolve, reject).finally(() => {
					if (this.cancelSessionInput === cancel) this.cancelSessionInput = undefined;
				});
			});
		};
		proto.run = async function (...args: any[]) {
			try {
				return await run.apply(this, args);
			} catch (error) {
				if (error !== SESSION_STOPPED) throw error;
			} finally {
				this.cancelSessionInput = undefined;
			}
		};
	}
	proto.init = async function (...args: any[]) {
		const record = host.adoptMode(this);
		if (record.expectedStop) return;
		return await init.apply(this, args);
	};
	proto.shutdown = async function (options?: any) {
		const record = host.recordForMode(this);
		if (!record) return await shutdown.call(this, options);
		if (options?.fromSignal) return await host.shutdown();
		if (record.expectedStop) return;
		this.shutdownRequested = false;
		await host.stopSession(record.id);
	};
	proto[INTERACTIVE_MODE_LIFECYCLE_PATCHED] = true;
}

function patchInteractiveModeWorkingIndicator(host: PiSessionsHost): void {
	const proto = (InteractiveMode as any)?.prototype;
	if (
		!proto ||
		proto[INTERACTIVE_MODE_SPINNER_PATCHED] ||
		typeof proto.setWorkingIndicator !== "function"
	) {
		return;
	}
	const original = proto.setWorkingIndicator;
	proto.setWorkingIndicator = function (options?: WorkingIndicatorOptions) {
		const source = [...host.records.values()].find((record) => record.mode === this);
		const teardownReset =
			options === undefined &&
			source !== undefined &&
			(source.expectedStop === true ||
				source.state === "stopped" ||
				source.state === "error");
		if (!teardownReset) {
			host.workingIndicator = options;
			host.notify();
		}
		return original.call(this, options);
	};
	proto[INTERACTIVE_MODE_SPINNER_PATCHED] = true;
}

function installWidget(ctx: CommandContext, host: PiSessionsHost): void {
	ctx.ui.setWidget("pi-sessions", (tui: any, theme: any) => {
		const requestRender = () => tui.requestRender();
		const unsubscribe = host.subscribe(requestRender);
		const widget = new SessionWidget(
			theme,
			() => host.snapshot(),
			requestRender,
			() => host.workingIndicator,
		);
		return {
			render: (width: number) => widget.render(width),
			invalidate: () => widget.invalidate(),
			dispose: () => {
				unsubscribe();
				widget.dispose();
			},
		};
	});
}

async function getResumeSessions(): Promise<any[]> {
	const sessions = await SessionManager.listAll();
	return sessions.sort(
		(a: any, b: any) => Number(b.modified) - Number(a.modified),
	);
}

async function openSessions(
	ctx: CommandContext,
	host: PiSessionsHost,
): Promise<void> {
	if (ctx.hasUI === false || (ctx.mode && ctx.mode !== "tui"))
		throw new Error("The session switcher requires interactive Pi");
	let targetToActivate: string | null = null;
	let targetToKill: string | null = null;
	await showSessionsView(ctx, {
		getSessions: async () =>
			host.listLive().filter((record) => record.id !== targetToKill).map((record) => ({
				...host.publicSession(record),
				// /reload preserves the host instance; read native identity independently of its serializer.
				sessionId: record.sessionManager?.getSessionId?.() ?? record.sessionId,
				sessionFile: record.sessionManager?.getSessionFile?.() ?? record.sessionFile,
			})),
		getResumeSessions,
		getAttached: () => host.activeId,
		getCwd: () => ctx.cwd || process.cwd(),
		switchTo: async (id: string) => {
			const target = host.get(id);
			if (!target) throw new Error(`session not found: ${id}`);
			targetToActivate = target.id;
		},
		newSession: async () => {
			const session = await host.createSessionFromContext(
				ctx,
				ctx.cwd || process.cwd(),
			);
			targetToActivate = session.id;
		},
		newSessionInFolder: async (cwd: string) => {
			const session = await host.createSessionFromContext(ctx, cwd);
			targetToActivate = session.id;
		},
		resumeSession: async (sessionPath?: string) => {
			if (!sessionPath) {
				const sessions = await getResumeSessions();
				sessionPath = sessions[0]?.path;
			}
			if (!sessionPath) throw new Error("No saved sessions found");
			const session = await host.openSavedSessionAsLive(
				sessionPath,
				undefined,
				ctx,
			);
			targetToActivate = session.id;
		},
		killSession: async (id: string) => {
			// The active runtime owns the picker, so its teardown must wait for it to close.
			if (id === host.activeId) targetToKill = id;
			else await host.stopSession(id);
		},
		notify: (message: string, type?: "info" | "warning" | "error") =>
			ctx.ui.notify(message, type || "info"),
	});
	if (targetToKill) {
		await host.stopSession(targetToKill);
	}
	if (!targetToActivate || targetToActivate === host.activeId) return;
	await host.activateFromContext(ctx, targetToActivate);
}

export default function (pi: ExtensionAPI) {
	const host = getHost();
	installSessionLifecycle(host);
	patchInteractiveModeWorkingIndicator(host);
	const onLive = (event: string, handler: any) => pi.on(event, (data: any, ctx: CommandContext) => {
		if (ctx.mode !== "tui" || !host.findSessionContext(ctx)) return;
		return handler(data, ctx);
	});

	pi.registerCommand("sessions", {
		description: "Open the pi-sessions switcher",
		handler: async (_args: string, ctx: CommandContext) =>
			openSessions(ctx, host),
	});

	pi.registerShortcut("alt+a", {
		description: "Open sessions switcher",
		handler: async (ctx: CommandContext) => openSessions(ctx, host),
	});

	onLive("session_start", (_event: any, ctx: CommandContext) => {
		host.bindSessionContext(ctx);
		installWidget(ctx, host);
	});

	const nameSession = createAutoNamer();
	pi.on("agent_end", (event: any, ctx: CommandContext) => {
		const record = ctx.mode === "tui" ? host.findSessionContext(ctx) : undefined;
		if (record) host.updateActivity(ctx, "idle");
		if (!event.messages?.length) return;
		const manager = ctx.sessionManager;
		void nameSession(ctx, undefined, event.messages).then((title: string | undefined) => {
			if (title && record && host.get(record.id) === record && record.sessionManager === manager) {
				record.transcript = manager.getSessionName();
				host.notify();
			}
		});
	});

	onLive("agent_start", (_event: any, ctx: CommandContext) => {
		host.updateActivity(ctx, "working");
	});


	onLive("tool_call", async (event: any, ctx: CommandContext) => {
		const record = host.bindSessionContext(ctx);
		const reason = needsPermission(event.toolName, event.input, record.name);
		if (reason) {
			if (record.id !== host.activeId) host.updateActivity(ctx, "waiting");
			const ok = await ctx.ui.confirm("pi-sessions permission", reason, {
				timeout: 60000,
			} as any);
			if (ok && record.id !== host.activeId) {
				record.activity = "working";
				record.lastActivityAt = Date.now();
				host.notify();
			}
			if (!ok)
				return {
					block: true,
					reason: "Denied by pi-sessions permission routing",
				};
		}
		const paths = inferToolPaths(event.toolName, event.input);
		if (!paths.length) return undefined;
		const result = host.locks.acquire(record.id, paths, ctx.cwd || record.cwd);
		if (!result.ok) {
			return {
				block: true,
				reason: `pi-sessions path lock conflict: ${JSON.stringify(result.conflicts)}`,
			};
		}
		host.locks.heldByToolCall.set(event.toolCallId, {
			sessionId: record.id,
			paths: result.paths,
		});
		return undefined;
	});

	onLive("tool_result", async (event: any, ctx: CommandContext) => {
		host.locks.releaseByToolCall(event.toolCallId);
		const record = host.bindSessionContext(ctx);
		if (record.activity === "waiting") {
			record.activity = "working";
			record.lastActivityAt = Date.now();
			host.notify();
		}
		return undefined;
	});

	onLive("session_shutdown", (_event: any, ctx: CommandContext) => {
		const record = host.bindSessionContext(ctx);
		host.locks.release(record.id);
		try {
			ctx.ui.setWidget("pi-sessions", undefined);
		} catch {}
		host.notify();
	});
}
