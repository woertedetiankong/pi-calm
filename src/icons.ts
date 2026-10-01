// Single-width characters every terminal font has. No emoji: their width varies
// between terminals and breaks alignment next to CJK text.
export const ICONS = {
  ok: "✓",
  fail: "✗",
  spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  explore: "◇",
  final: "●",
} as const;

export function toolIcon(tool: string): string {
  switch (tool) {
    case "read": return "◇";
    case "grep":
    case "find": return "⌕";
    case "ls": return "▤";
    case "bash": return "❯";
    case "edit":
    case "write": return "✎";
    default: return "";
  }
}

export type Lang = "zh" | "en";

/** Follow the language the user writes in: any CJK ideograph means Chinese. */
export function detectLang(text: string): Lang | undefined {
  if (/[\u4e00-\u9fff]/.test(text)) return "zh";
  if (/[a-z]/i.test(text)) return "en";
  return undefined;
}

const STRINGS = {
  zh: {
    lines: (n: number) => `${n} 行`,
    matches: (n: number) => `${n} 处`,
    files: (n: number) => `${n} 个文件`,
    entries: (n: number) => `${n} 项`,
    truncated: "已截断",
    image: "图片",
    explored: "浏览",
    failed: (n: number) => `${n} 个失败`,
    exit: (code: string) => `exit ${code}`,
    more: (n: number) => `… 还有 ${n} 行`,
    expandHint: "ctrl+o 展开",
    working: "工作中",
    toolCount: (n: number) => `已调用 ${n} 个工具`,
  },
  en: {
    lines: (n: number) => `${n} lines`,
    matches: (n: number) => `${n} matches`,
    files: (n: number) => `${n} files`,
    entries: (n: number) => `${n} entries`,
    truncated: "truncated",
    image: "image",
    explored: "Explored",
    failed: (n: number) => `${n} failed`,
    exit: (code: string) => `exit ${code}`,
    more: (n: number) => `… ${n} more lines`,
    expandHint: "ctrl+o to expand",
    working: "Working",
    toolCount: (n: number) => (n === 1 ? "1 tool" : `${n} tools`),
  },
} as const;

export type Strings = (typeof STRINGS)[Lang];

export function strings(lang: Lang): Strings {
  return STRINGS[lang];
}
