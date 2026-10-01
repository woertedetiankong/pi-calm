/**
 * Pure helpers that turn a tool call and its result into short display facts.
 * Kept free of theme and TUI types so they can be unit tested.
 */
import { homedir } from "node:os";
import { isAbsolute, relative } from "node:path";
import type { Strings } from "./icons.ts";

export interface ToolResultLike {
  content: ReadonlyArray<{ type: string; text?: string }>;
  details?: unknown;
}

export function textOf(result: ToolResultLike | undefined): string {
  if (!result) return "";
  return result.content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n");
}

export function shortPath(path: string | undefined, cwd: string): string {
  if (!path) return "";
  if (isAbsolute(path)) {
    const rel = relative(cwd, path);
    if (rel && !rel.startsWith("..") && !isAbsolute(rel)) return rel;
    const home = homedir();
    if (path === home || path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`;
  }
  return path;
}

export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Output lines without tool notices such as "[100 matches limit reached]". */
export function contentLines(text: string): string[] {
  return text.split("\n").filter((line) => line.trim() && !/^\[.*\]$/.test(line.trim()));
}

const BASH_STATUS = /^(Command exited with code -?\d+|Command terminated without an exit code|Command timed out.*|Command aborted.*)$/;

/** Bash output with pi's trailing status line removed. */
export function bashOutput(text: string): string[] {
  const lines = text.replace(/\s+$/, "").split("\n");
  while (lines.length && (BASH_STATUS.test(lines[lines.length - 1]!.trim()) || !lines[lines.length - 1]!.trim())) lines.pop();
  return lines;
}

export function exitCode(text: string): string | undefined {
  return /Command exited with code (-?\d+)/.exec(text)?.[1];
}

export function diffStats(diff: string | undefined): { added: number; removed: number } | undefined {
  if (!diff) return undefined;
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added++;
    else if (line.startsWith("-") && !line.startsWith("---")) removed++;
  }
  return { added, removed };
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m${Math.round(s - m * 60)}s`;
}

type Args = Record<string, unknown> | undefined;

function str(args: Args, key: string): string | undefined {
  const value = args?.[key];
  return typeof value === "string" ? value : undefined;
}

/** The main argument shown after the tool name: a path, pattern or command. */
export function target(tool: string, args: Args, cwd: string): string {
  switch (tool) {
    case "read": {
      let text = shortPath(str(args, "path"), cwd);
      const offset = args?.offset;
      const limit = args?.limit;
      // Models often pass offset=1 with a large limit; only a real jump into the file is worth showing.
      if (typeof offset === "number" && offset > 1) {
        text += typeof limit === "number" ? `:${offset}-${offset + limit - 1}` : `:${offset}`;
      }
      return text;
    }
    case "grep": {
      const pattern = str(args, "pattern");
      if (pattern === undefined) return "";
      const where = str(args, "path") ?? str(args, "glob");
      return `"${pattern}"${where ? ` ${shortPath(where, cwd)}` : ""}`;
    }
    case "find": {
      const pattern = str(args, "pattern") ?? "";
      const where = str(args, "path");
      return where ? `${pattern} ${shortPath(where, cwd)}` : pattern;
    }
    case "ls":
      return shortPath(str(args, "path"), cwd) || ".";
    case "bash":
      return oneLine(str(args, "command") ?? "");
    case "edit":
    case "write":
      return shortPath(str(args, "path"), cwd);
    default:
      return "";
  }
}

/** Short facts about a successful result, e.g. "120 lines" or "+4 −1". */
export function successMeta(tool: string, args: Args, result: ToolResultLike, S: Strings): string[] {
  const text = textOf(result);
  switch (tool) {
    case "read": {
      if (result.content.some((c) => c.type === "image")) return [S.image];
      const details = result.details as { truncation?: { truncated?: boolean } } | undefined;
      const meta = [S.lines(contentLines(text).length)];
      if (details?.truncation?.truncated) meta.push(S.truncated);
      return meta;
    }
    case "grep":
      return [S.matches(text.startsWith("No matches found") ? 0 : contentLines(text).length)];
    case "find":
      return [S.files(text.startsWith("No files found") ? 0 : contentLines(text).length)];
    case "ls":
      return [S.entries(contentLines(text).length)];
    case "edit": {
      const stats = diffStats((result.details as { diff?: string } | undefined)?.diff);
      return stats ? [`+${stats.added} −${stats.removed}`] : [];
    }
    case "write": {
      const content = str(args, "content");
      return content === undefined ? [] : [S.lines(content.split("\n").length)];
    }
    default:
      return [];
  }
}

/** Collapsed explanation for a failed call: the lines worth seeing without expanding. */
export function errorTail(tool: string, result: ToolResultLike, max: number): { lines: string[]; hidden: number } {
  const text = textOf(result);
  const lines = tool === "bash" ? bashOutput(text) : text.replace(/\s+$/, "").split("\n");
  if (lines.length <= max) return { lines, hidden: 0 };
  // For commands the end of the output has the error; for other tools the start does.
  return tool === "bash"
    ? { lines: lines.slice(-max), hidden: lines.length - max }
    : { lines: lines.slice(0, max), hidden: lines.length - max };
}

/** "read a.ts, b.ts · grep "x"" for a folded exploration run. */
export function exploreSummary(calls: ReadonlyArray<{ tool: string; target: string }>): string {
  const byTool = new Map<string, string[]>();
  for (const call of calls) {
    const targets = byTool.get(call.tool) ?? [];
    if (call.target && !targets.includes(call.target)) targets.push(call.target);
    byTool.set(call.tool, targets);
  }
  return [...byTool].map(([tool, targets]) => (targets.length ? `${tool} ${targets.join(", ")}` : tool)).join(" · ");
}
