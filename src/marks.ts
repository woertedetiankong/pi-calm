import type { TextKind } from "./transcript.ts";

/**
 * Restyle assistant Markdown for display only (the model still sees the original):
 * progress notes become a quote so they read as a dim side-track, and the final
 * answer gets a leading dot so it is easy to find when scrolling back.
 */
export function markAssistant(markdown: string, kind: TextKind | undefined, isStreaming: boolean, dot: string): string {
  if (kind === "progress") return quote(markdown);
  if (kind === "final" && !isStreaming && dot) return withDot(markdown, dot);
  return markdown;
}

function quote(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => (line.trim() ? `> ${line}` : ">"))
    .join("\n");
}

function withDot(markdown: string, dot: string): string {
  const newline = markdown.indexOf("\n");
  const first = newline === -1 ? markdown : markdown.slice(0, newline);
  const rest = newline === -1 ? "" : markdown.slice(newline);
  const heading = /^(#{1,6})\s+(.*)$/.exec(first);
  if (heading) return `${heading[1]} ${dot} ${heading[2]}${rest}`;
  // Lists, code fences, tables, quotes and HTML would change meaning with a prefix.
  if (/^\s*([-*+]\s|\d+[.)]\s|```|~~~|\||>|<)/.test(first)) return markdown;
  return `${dot} ${markdown}`;
}
