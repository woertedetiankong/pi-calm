/**
 * pi-calm: a quieter, better organised pi transcript.
 *
 * - Adds Codex-style answer formatting guidance to the system prompt.
 * - Re-registers the built-in tools with one-line renderers: status, target and a few
 *   facts per call, folded "Explored" lines for runs of read/grep/find/ls, and output
 *   only when a call fails or the user expands tool output (ctrl+o).
 * - Marks progress notes as quotes and the final answer with a dot (display only).
 *
 * There are no settings: install it and the transcript changes. Short labels such as
 * "120 lines" follow the language of the user's prompts.
 */
import type { AgentToolUpdateCallback, ExtensionAPI, ExtensionContext, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  createBashToolDefinition, createEditToolDefinition, createFindToolDefinition, createGrepToolDefinition,
  createLsToolDefinition, createReadToolDefinition, createWriteToolDefinition, getAgentDir, SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { detectLang, ICONS, type Lang, strings } from "./src/icons.ts";
import { markAssistant } from "./src/marks.ts";
import { SECTION, STYLE_GUIDE } from "./src/prompt.ts";
import { CallRenderer } from "./src/render.ts";
import { type Block, TranscriptIndex } from "./src/transcript.ts";

type AnyTool = ToolDefinition<any, any>;

const FACTORIES: Record<string, (cwd: string, settings: SettingsManager) => AnyTool> = {
  read: (cwd, s) => createReadToolDefinition(cwd, { autoResizeImages: s.getImageAutoResize() }),
  bash: (cwd, s) => createBashToolDefinition(cwd, { commandPrefix: s.getShellCommandPrefix(), shellPath: s.getShellPath() }),
  edit: (cwd) => createEditToolDefinition(cwd),
  write: (cwd) => createWriteToolDefinition(cwd),
  grep: (cwd) => createGrepToolDefinition(cwd),
  find: (cwd) => createFindToolDefinition(cwd),
  ls: (cwd) => createLsToolDefinition(cwd),
};

/** Tools pi does not activate by default; registering an override must not activate them. */
const OFF_BY_DEFAULT = new Set(["grep", "find", "ls"]);

export default function calm(pi: ExtensionAPI) {
  const agentDir = getAgentDir();
  let lang: Lang = (process.env.LC_ALL || process.env.LANG || "").toLowerCase().startsWith("zh") ? "zh" : "en";
  let theme: Theme | undefined;
  let lastCtx: ExtensionContext | undefined;
  let indexed = false;

  const settingsCache = new Map<string, SettingsManager>();
  const settings = (cwd: string) => {
    let s = settingsCache.get(cwd);
    if (!s) settingsCache.set(cwd, (s = SettingsManager.create(cwd, agentDir)));
    return s;
  };

  const index = new TranscriptIndex({ foldAcrossThinking: settings(process.cwd()).getHideThinkingBlock() });
  const renderer = new CallRenderer(() => lang, index);

  /** Build the index from the session on first use, in case rendering starts before session_start. */
  const ensureIndexed = () => {
    if (indexed || !lastCtx) return;
    indexed = true;
    index.rebuild(lastCtx.sessionManager.getBranch());
  };

  // --- tools ---

  const toolCache = new Map<string, AnyTool>();
  const toolFor = (name: string, cwd: string) => {
    const key = `${name}\0${cwd}`;
    let tool = toolCache.get(key);
    if (!tool) toolCache.set(key, (tool = FACTORIES[name]!(cwd, settings(cwd))));
    return tool;
  };

  for (const name of Object.keys(FACTORIES)) {
    const base = toolFor(name, process.cwd());
    pi.registerTool({
      ...base,
      ...(OFF_BY_DEFAULT.has(name) && base.defaultActive === undefined ? { defaultActive: false } : {}),
      renderShell: "self",
      execute(toolCallId: string, params: unknown, signal: AbortSignal | undefined, onUpdate: AgentToolUpdateCallback<any> | undefined, ctx: ExtensionContext) {
        return toolFor(name, ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx as never);
      },
      renderCall(args, t, context) {
        theme = t;
        ensureIndexed();
        return renderer.renderCall(name, args as Record<string, unknown>, t, context);
      },
      renderResult(result, options, t, context) {
        return renderer.renderResult(name, result as never, options.isPartial, t, context);
      },
    } as AnyTool);
  }

  // --- transcript tracking ---

  /** Language of the most recent user message in the session, if any. */
  const langOf = (entries: readonly unknown[]): Lang | undefined => {
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i] as { type?: string; message?: { role?: string; content?: unknown } };
      if (entry.type !== "message" || entry.message?.role !== "user") continue;
      const content = entry.message.content;
      const text = typeof content === "string"
        ? content
        : Array.isArray(content) ? content.map((c: { text?: string }) => c.text ?? "").join(" ") : "";
      const found = detectLang(text);
      if (found) return found;
    }
    return undefined;
  };

  const resetSession = (ctx: ExtensionContext) => {
    lastCtx = ctx;
    index.options.foldAcrossThinking = settings(ctx.cwd).getHideThinkingBlock();
    renderer.reset();
    const branch = ctx.sessionManager.getBranch();
    index.rebuild(branch);
    indexed = true;
    lang = langOf(branch) ?? lang;
    if (ctx.hasUI) theme = ctx.ui.theme;
  };

  pi.on("session_start", (_event, ctx) => resetSession(ctx));
  pi.on("session_tree", (_event, ctx) => resetSession(ctx));
  pi.on("session_compact", (_event, ctx) => resetSession(ctx));

  const onMessage = (message: { role?: string; content?: unknown; timestamp?: number; display?: boolean }) => {
    if (message.role === "assistant" && Array.isArray(message.content)) {
      index.assistant(message.timestamp ?? message, message.content as Block[]);
    } else if (message.role === "custom") {
      if (message.display !== false) index.breakRun();
    } else if (message.role !== "toolResult" && message.role !== "system") {
      index.breakRun();
    }
  };
  pi.on("message_start", (event) => onMessage(event.message as never));
  pi.on("message_update", (event) => onMessage(event.message as never));
  pi.on("message_end", (event) => onMessage(event.message as never));

  // --- progress in the working indicator instead of the transcript ---

  let toolCount = 0;
  pi.on("agent_start", () => {
    toolCount = 0;
  });
  pi.on("tool_execution_start", (event, ctx) => {
    if (event.parentToolCallId) return;
    renderer.started(event.toolCallId, event.toolName, ctx.cwd);
    toolCount++;
    if (ctx.hasUI) {
      const S = strings(lang);
      ctx.ui.setWorkingMessage(`${S.working} · ${S.toolCount(toolCount)}`);
    }
  });
  pi.on("tool_execution_end", (event) => {
    if (!event.parentToolCallId) renderer.ended(event.toolCallId);
  });
  pi.on("agent_end", (_event, ctx) => {
    if (ctx.hasUI) ctx.ui.setWorkingMessage();
  });

  // --- answer formatting ---

  pi.on("before_agent_start", (event) => {
    lang = detectLang(event.prompt) ?? lang;
    event.systemPromptOptions.sections[SECTION] = STYLE_GUIDE;
  });

  pi.registerMarkdownTransformer((markdown, context) => {
    if (context.messageType !== "assistant") return markdown;
    ensureIndexed();
    return markAssistant(markdown, index.kind(markdown), context.isStreaming, theme ? theme.fg("accent", ICONS.final) : ICONS.final);
  });
}
