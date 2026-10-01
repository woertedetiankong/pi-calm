/**
 * Tracks the shape of the visible transcript so renderers can make decisions that
 * depend on neighbours: which exploration calls fold into one line, and whether a
 * block of assistant text is a progress note or the final answer.
 *
 * Renderers only see one tool call or one Markdown string at a time, so this index
 * is fed from message events while live and rebuilt from the session branch on load.
 */

export const EXPLORE_TOOLS: ReadonlySet<string> = new Set(["read", "grep", "find", "ls"]);

export interface Block {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
}

export type TextKind = "progress" | "final";

export interface IndexOptions {
  /** Hidden thinking only shows a one-line label, so exploration may fold across it. */
  foldAcrossThinking: boolean;
}

export class TranscriptIndex {
  private readonly groupOf = new Map<string, string[]>();
  private readonly textKind = new Map<string, TextKind>();
  private open: string[] | undefined;
  private current: { key: unknown; open: string[] | undefined } | undefined;

  readonly options: IndexOptions;

  constructor(options: IndexOptions) {
    this.options = options;
  }

  reset(): void {
    this.groupOf.clear();
    this.textKind.clear();
    this.open = undefined;
    this.current = undefined;
  }

  /** Something visible that is not part of an exploration run (user message, summary, ...). */
  breakRun(): void {
    this.open = undefined;
    this.current = undefined;
  }

  /**
   * Record an assistant message. Safe to call repeatedly with the growing content of
   * the same streaming message: each call replays it from the state at its start.
   */
  assistant(key: unknown, content: readonly Block[]): void {
    if (this.current?.key !== key) this.current = { key, open: this.open };
    let open = this.current?.open;
    const hasToolCall = content.some((b) => b.type === "toolCall");

    for (const block of content) {
      if (block.type === "text") {
        const text = block.text?.trim();
        if (!text) continue;
        this.textKind.set(text, hasToolCall ? "progress" : "final");
        open = undefined;
      } else if (block.type === "thinking") {
        if (block.thinking?.trim() && !this.options.foldAcrossThinking) open = undefined;
      } else if (block.type === "toolCall" && block.id) {
        if (!EXPLORE_TOOLS.has(block.name ?? "")) {
          open = undefined;
          continue;
        }
        const existing = this.groupOf.get(block.id);
        if (existing) {
          open = existing;
          continue;
        }
        open ??= [];
        open.push(block.id);
        this.groupOf.set(block.id, open);
      }
    }
    this.open = open;
  }

  /** Members of the exploration run containing this call, in transcript order. */
  group(toolCallId: string): readonly string[] | undefined {
    return this.groupOf.get(toolCallId);
  }

  kind(text: string): TextKind | undefined {
    return this.textKind.get(text.trim());
  }

  /** Rebuild from persisted session entries (oldest first). */
  rebuild(entries: readonly unknown[]): void {
    this.reset();
    for (const raw of entries) {
      const entry = raw as { type?: string; id?: string; display?: boolean; message?: { role?: string; content?: unknown } };
      if (entry.type === "message") {
        const role = entry.message?.role;
        if (role === "assistant" && Array.isArray(entry.message?.content)) {
          this.assistant(entry.id, entry.message.content as Block[]);
        } else if (role !== "toolResult" && role !== "system") {
          this.breakRun();
        }
      } else if (entry.type === "custom_message") {
        if (entry.display !== false) this.breakRun();
      } else if (entry.type === "compaction" || entry.type === "branch_summary") {
        this.breakRun();
      }
    }
  }
}
