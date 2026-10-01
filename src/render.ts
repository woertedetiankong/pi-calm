/**
 * One-line renderers for the built-in tools.
 *
 * Each tool row renders a header line (status, icon, name, target, facts) and a body
 * that is empty unless the call failed or the user expanded tool output (ctrl+o).
 * Components are lazy: they read shared state at render time, so a row can change
 * when a neighbour finishes (folded exploration) or when the spinner ticks.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { renderDiff } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { ICONS, type Lang, strings, toolIcon } from "./icons.ts";
import {
  bashOutput, errorTail, exitCode, exploreSummary, formatDuration, oneLine, successMeta, target, textOf,
  type ToolResultLike,
} from "./summary.ts";
import type { TranscriptIndex } from "./transcript.ts";

export interface CallState {
  tool: string;
  args: Record<string, unknown> | undefined;
  cwd: string;
  result?: ToolResultLike;
  done: boolean;
  isError: boolean;
  expanded: boolean;
  startedAt?: number;
  endedAt?: number;
  invalidate?: () => void;
}

const ERROR_TAIL_LINES = 6;
const INDENT = "    ";
const SPINNER_MS = 100;

class Lazy implements Component {
  private readonly draw: (width: number) => string[];
  constructor(draw: (width: number) => string[]) {
    this.draw = draw;
  }
  render(width: number): string[] {
    return this.draw(width);
  }
  invalidate(): void {}
}

export class CallRenderer {
  readonly calls = new Map<string, CallState>();
  private readonly running = new Set<string>();
  private ticker: ReturnType<typeof setInterval> | undefined;

  private readonly lang: () => Lang;
  private readonly index: TranscriptIndex;

  constructor(lang: () => Lang, index: TranscriptIndex) {
    this.lang = lang;
    this.index = index;
  }

  reset(): void {
    this.calls.clear();
    this.running.clear();
    this.syncTicker();
  }

  private state(id: string, tool: string, cwd: string): CallState {
    let state = this.calls.get(id);
    if (!state) {
      state = { tool, args: undefined, cwd, done: false, isError: false, expanded: false };
      this.calls.set(id, state);
    }
    return state;
  }

  // --- live timing, fed from tool_execution_* events ---

  started(id: string, tool: string, cwd: string): void {
    const state = this.state(id, tool, cwd);
    state.startedAt ??= Date.now();
    this.running.add(id);
    this.syncTicker();
  }

  ended(id: string): void {
    const state = this.calls.get(id);
    if (state) state.endedAt ??= Date.now();
    this.running.delete(id);
    this.syncTicker();
    this.redrawGroupOf(id);
  }

  private syncTicker(): void {
    if (this.running.size && !this.ticker) {
      this.ticker = setInterval(() => this.tick(), SPINNER_MS);
      this.ticker.unref?.();
    } else if (!this.running.size && this.ticker) {
      clearInterval(this.ticker);
      this.ticker = undefined;
    }
  }

  private tick(): void {
    const rows = new Set<string>();
    for (const id of this.running) rows.add(this.visibleRow(id));
    for (const id of rows) this.calls.get(id)?.invalidate?.();
  }

  /** The row that displays this call: its own, or the leader of its folded run. */
  private visibleRow(id: string): string {
    const group = this.foldedGroup(id);
    return group ? group[0]! : id;
  }

  private redrawGroupOf(id: string): void {
    const row = this.visibleRow(id);
    if (row !== id) this.calls.get(row)?.invalidate?.();
  }

  private foldedGroup(id: string): readonly string[] | undefined {
    if (this.calls.get(id)?.expanded) return undefined;
    const group = this.index.group(id);
    return group && group.length > 1 ? group : undefined;
  }

  // --- tool definition hooks ---

  renderCall(
    tool: string,
    args: Record<string, unknown>,
    theme: Theme,
    context: { toolCallId: string; cwd: string; expanded: boolean; invalidate: () => void },
  ): Component {
    const state = this.state(context.toolCallId, tool, context.cwd);
    state.args = args;
    state.cwd = context.cwd;
    state.expanded = context.expanded;
    state.invalidate = context.invalidate;
    const id = context.toolCallId;
    return new Lazy((width) => this.header(id, theme, width));
  }

  renderResult(
    tool: string,
    result: ToolResultLike,
    isPartial: boolean,
    theme: Theme,
    context: { toolCallId: string; cwd: string; expanded: boolean; isError: boolean; invalidate: () => void },
  ): Component {
    const state = this.state(context.toolCallId, tool, context.cwd);
    const wasDone = state.done;
    state.result = result;
    state.isError = context.isError;
    state.expanded = context.expanded;
    state.done = !isPartial;
    if (state.done && !wasDone) this.redrawGroupOf(context.toolCallId);
    const id = context.toolCallId;
    return new Lazy((width) => this.body(id, theme, width));
  }

  // --- drawing ---

  private status(state: { done: boolean; isError: boolean }, theme: Theme): string {
    if (!state.done) {
      const frame = ICONS.spinner[Math.floor(Date.now() / SPINNER_MS) % ICONS.spinner.length]!;
      return theme.fg("accent", frame);
    }
    return state.isError ? theme.fg("error", ICONS.fail) : theme.fg("success", ICONS.ok);
  }

  private header(id: string, theme: Theme, width: number): string[] {
    const state = this.calls.get(id);
    if (!state) return [];
    const group = this.foldedGroup(id);
    if (group) return group[0] === id ? [truncateToWidth(this.groupLine(group, theme), width)] : [];
    return [truncateToWidth(this.callLine(state, theme), width)];
  }

  private callLine(state: CallState, theme: Theme): string {
    const S = strings(this.lang());
    const parts = [this.status(state, theme)];
    const icon = toolIcon(state.tool);
    if (icon) parts.push(theme.fg("muted", icon));
    parts.push(theme.fg("toolTitle", theme.bold(state.tool)));
    const what = target(state.tool, state.args, state.cwd);
    if (what) parts.push(theme.fg("accent", what));
    let line = parts.join(" ");

    const meta: string[] = [];
    let tail = "";
    if (!state.done) {
      if (state.startedAt) meta.push(formatDuration(Date.now() - state.startedAt));
      if (state.tool === "bash" && state.result) {
        const last = bashOutput(textOf(state.result)).at(-1);
        if (last) tail = oneLine(last);
      }
    } else if (state.isError) {
      const text = textOf(state.result);
      if (state.tool === "bash") {
        if (state.startedAt && state.endedAt) meta.push(formatDuration(state.endedAt - state.startedAt));
        const code = exitCode(text);
        const status = code ? S.exit(code) : oneLine(text.trim().split("\n").at(-1) ?? "");
        line += theme.fg("dim", meta.map((m) => ` · ${m}`).join("")) + theme.fg("error", ` · ${status}`);
        return line;
      }
      // Non-bash errors show their first line as the body, so the header stays plain.
    } else if (state.result) {
      if (state.tool === "bash" && state.startedAt && state.endedAt) meta.push(formatDuration(state.endedAt - state.startedAt));
      meta.push(...successMeta(state.tool, state.args, state.result, S));
    }

    if (meta.length) line += theme.fg("dim", meta.map((m) => ` · ${m}`).join(""));
    if (tail) line += theme.fg("dim", `  ${tail}`);
    return line;
  }

  private groupLine(group: readonly string[], theme: Theme): string {
    const S = strings(this.lang());
    const members = group.map((id) => this.calls.get(id)).filter((s): s is CallState => s !== undefined);
    const done = members.every((m) => m.done);
    const failed = members.filter((m) => m.done && m.isError).length;
    const status = this.status({ done, isError: failed > 0 }, theme);
    const parts = [status, theme.fg("muted", ICONS.explore)];
    parts.push(theme.fg("toolTitle", theme.bold(S.explored)));
    let line = parts.join(" ");
    line += theme.fg("dim", " · ") + theme.fg("accent", exploreSummary(members.map((m) => ({ tool: m.tool, target: target(m.tool, m.args, m.cwd) }))));
    if (failed) line += theme.fg("error", ` · ${S.failed(failed)}`);
    return line;
  }

  private body(id: string, theme: Theme, width: number): string[] {
    const state = this.calls.get(id);
    if (!state?.result || !state.done) return [];
    if (this.foldedGroup(id)) return [];
    const inner = Math.max(10, width - INDENT.length);

    if (state.expanded) return this.expandedBody(state, theme, inner);
    if (!state.isError) return [];

    const S = strings(this.lang());
    const { lines, hidden } = errorTail(state.tool, state.result, ERROR_TAIL_LINES);
    const out = lines.map((line) => INDENT + truncateToWidth(theme.fg(state.tool === "bash" ? "toolOutput" : "error", line), inner));
    if (hidden) out.push(INDENT + theme.fg("muted", `${S.more(hidden)} · ${S.expandHint}`));
    return out;
  }

  private expandedBody(state: CallState, theme: Theme, inner: number): string[] {
    const result = state.result!;
    let lines: string[];
    if (state.tool === "edit" && !state.isError && (result.details as { diff?: string } | undefined)?.diff) {
      lines = renderDiff((result.details as { diff: string }).diff).split("\n");
    } else {
      let raw: string[];
      if (state.tool === "write" && !state.isError && typeof state.args?.content === "string") raw = state.args.content.split("\n");
      else if (state.tool === "bash") raw = bashOutput(textOf(result));
      else raw = textOf(result).replace(/\s+$/, "").split("\n");
      const color = state.isError && state.tool !== "bash" ? "error" : "toolOutput";
      lines = raw.map((line) => theme.fg(color, line));
    }
    return lines.flatMap((line) => wrapTextWithAnsi(line, inner).map((l) => INDENT + l));
  }
}
