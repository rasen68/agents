import { randomUUID } from "node:crypto";
import { statSync, writeFileSync, unlinkSync } from "node:fs";
import { SessionManager, type ExtensionContext, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { resolve } from "node:path";

export function resolveDirectory(args: string, cwd: string): string {
  let path = args.trim();
  if (path.length >= 2 && ((path.startsWith('"') && path.endsWith('"')) || (path.startsWith("'") && path.endsWith("'")))) {
    path = path.slice(1, -1);
  }
  if (!path || path === "~") path = homedir();
  else if (path.startsWith("~/")) path = resolve(homedir(), path.slice(2));
  const directory = resolve(cwd, path);
  if (!statSync(directory).isDirectory()) throw new Error(`Not a directory: ${directory}`);
  return directory;
}

export function copySession(source: ExtensionContext["sessionManager"], directory: string, sessionDir?: string): string {
  const destination = SessionManager.create(directory, sessionDir);
  const file = destination.getSessionFile()!;
  const header = { ...destination.getHeader()!, parentSession: source.getSessionFile() };
  // Opening a file selects its last entry. Anchor it to the current leaf, which
  // may differ from the last stored entry after navigating the conversation tree.
  const anchor = {
    type: "custom",
    id: randomUUID(),
    parentId: source.getLeafId(),
    timestamp: new Date().toISOString(),
    customType: "pi-cd",
    data: { previousCwd: source.getCwd() },
  };
  const entries = [header, ...source.getEntries(), anchor];
  writeFileSync(file, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n", { flag: "wx", mode: 0o600 });
  return file;
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("cd", {
    description: "Change working directory while keeping the conversation. Defaults to home.",
    handler: async (args, ctx) => {
      await ctx.waitForIdle();
      let directory: string;
      let file: string;
      try {
        directory = resolveDirectory(args, ctx.cwd);
        if (directory === ctx.cwd) {
          ctx.ui.notify(`Working directory: ${directory}`, "info");
          return;
        }
        file = copySession(ctx.sessionManager, directory);
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
        return;
      }
      const result = await ctx.switchSession(file, {
        withSession: async (fresh) => {
          fresh.ui.notify(`Working directory: ${directory}`, "info");
        },
      });
      if (result.cancelled) {
        unlinkSync(file);
        ctx.ui.notify("Directory change cancelled.", "info");
      }
    },
  });
}
