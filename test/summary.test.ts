import assert from "node:assert/strict";
import { homedir } from "node:os";
import { test } from "node:test";
import { strings } from "../src/icons.ts";
import { bashOutput, diffStats, errorTail, exitCode, exploreSummary, formatDuration, shortPath, successMeta, target } from "../src/summary.ts";

const S = strings("en");
const res = (text: string, details?: unknown) => ({ content: [{ type: "text", text }], details });

test("paths are shown relative to cwd or home", () => {
  assert.equal(shortPath("/repo/src/a.ts", "/repo"), "src/a.ts");
  assert.equal(shortPath(`${homedir()}/x/y.ts`, "/repo"), "~/x/y.ts");
  assert.equal(shortPath("src/a.ts", "/repo"), "src/a.ts");
});

test("targets", () => {
  assert.equal(target("read", { path: "/r/a.ts", offset: 10, limit: 5 }, "/r"), "a.ts:10-14");
  assert.equal(target("read", { path: "/r/a.ts", offset: 1, limit: 200 }, "/r"), "a.ts");
  assert.equal(target("grep", { pattern: "foo", path: "src" }, "/r"), '"foo" src');
  assert.equal(target("bash", { command: "npm   test\n  --watch" }, "/r"), "npm test --watch");
  assert.equal(target("ls", {}, "/r"), ".");
  assert.equal(target("read", undefined, "/r"), "");
});

test("success facts", () => {
  assert.deepEqual(successMeta("read", {}, res("a\nb\nc"), S), ["3 lines"]);
  assert.deepEqual(successMeta("grep", {}, res("No matches found"), S), ["0 matches"]);
  assert.deepEqual(successMeta("grep", {}, res("a.ts:1: x\nb.ts:2: y\n\n[100 matches limit reached]"), S), ["2 matches"]);
  assert.deepEqual(successMeta("find", {}, res("No files found matching pattern"), S), ["0 files"]);
  assert.deepEqual(successMeta("edit", {}, res("ok", { diff: "--- a\n+++ b\n-x\n+y\n+z" }), S), ["+2 −1"]);
  assert.deepEqual(successMeta("write", { content: "a\nb" }, res("ok"), S), ["2 lines"]);
});

test("bash output and status", () => {
  const text = "line1\nline2\n\nCommand exited with code 2";
  assert.deepEqual(bashOutput(text), ["line1", "line2"]);
  assert.equal(exitCode(text), "2");
  assert.equal(exitCode("fine"), undefined);
});

test("error tail keeps the end of bash output and the start of other errors", () => {
  const bash = res(`${Array.from({ length: 10 }, (_, i) => `l${i}`).join("\n")}\n\nCommand exited with code 1`);
  assert.deepEqual(errorTail("bash", bash, 3), { lines: ["l7", "l8", "l9"], hidden: 7 });
  assert.deepEqual(errorTail("edit", res("Could not find text\nmore\nmore\nmore"), 2), { lines: ["Could not find text", "more"], hidden: 2 });
});

test("helpers", () => {
  assert.deepEqual(diffStats(undefined), undefined);
  assert.equal(formatDuration(320), "0.3s");
  assert.equal(formatDuration(3200), "3.2s");
  assert.equal(formatDuration(72_000), "1m12s");
  assert.equal(
    exploreSummary([{ tool: "read", target: "a.ts" }, { tool: "grep", target: '"x"' }, { tool: "read", target: "b.ts" }, { tool: "read", target: "a.ts" }]),
    'read a.ts, b.ts · grep "x"',
  );
});

test("language follows the user's writing", async () => {
  const { detectLang } = await import("../src/icons.ts");
  assert.equal(detectLang("帮我看看这个测试"), "zh");
  assert.equal(detectLang("fix the test in src/a.ts"), "en");
  assert.equal(detectLang("/tmp 123"), "en");
  assert.equal(detectLang("123 !!"), undefined);
});
