import assert from "node:assert/strict";
import { test } from "node:test";
import { TranscriptIndex } from "../src/transcript.ts";

const call = (id: string, name: string) => ({ type: "toolCall", id, name });
const text = (t: string) => ({ type: "text", text: t });
const thinking = (t: string) => ({ type: "thinking", thinking: t });

test("consecutive exploration calls across messages fold into one run", () => {
  const index = new TranscriptIndex({ foldAcrossThinking: false });
  index.assistant(1, [call("a", "read"), call("b", "grep")]);
  index.assistant(2, [call("c", "ls")]);
  assert.deepEqual(index.group("a"), ["a", "b", "c"]);
  assert.equal(index.group("c"), index.group("a"));
});

test("text, non-exploration calls and user messages break a run", () => {
  const index = new TranscriptIndex({ foldAcrossThinking: false });
  index.assistant(1, [call("a", "read"), call("b", "bash"), call("c", "read")]);
  index.assistant(2, [text("Now the config"), call("d", "read")]);
  index.breakRun();
  index.assistant(3, [call("e", "read")]);
  assert.deepEqual(index.group("a"), ["a"]);
  assert.equal(index.group("b"), undefined);
  assert.deepEqual(index.group("c"), ["c"]);
  assert.deepEqual(index.group("d"), ["d"]);
  assert.deepEqual(index.group("e"), ["e"]);
});

test("visible thinking breaks a run unless thinking is hidden", () => {
  const shown = new TranscriptIndex({ foldAcrossThinking: false });
  shown.assistant(1, [call("a", "read")]);
  shown.assistant(2, [thinking("hmm"), call("b", "read")]);
  assert.deepEqual(shown.group("b"), ["b"]);

  const hidden = new TranscriptIndex({ foldAcrossThinking: true });
  hidden.assistant(1, [call("a", "read")]);
  hidden.assistant(2, [thinking("hmm"), call("b", "read")]);
  assert.deepEqual(hidden.group("b"), ["a", "b"]);
});

test("streaming updates of one message are idempotent", () => {
  const index = new TranscriptIndex({ foldAcrossThinking: false });
  index.assistant(1, [call("a", "read")]);
  index.assistant(2, [call("b", "read")]);
  index.assistant(2, [call("b", "read"), call("c", "find")]);
  index.assistant(2, [call("b", "read"), call("c", "find")]);
  assert.deepEqual(index.group("a"), ["a", "b", "c"]);
});

test("text is progress when its message calls tools, final otherwise", () => {
  const index = new TranscriptIndex({ foldAcrossThinking: false });
  index.assistant(1, [text("Looking at tests"), call("a", "bash")]);
  index.assistant(2, [text("  All fixed.  ")]);
  assert.equal(index.kind("Looking at tests"), "progress");
  assert.equal(index.kind("All fixed."), "final");
  assert.equal(index.kind("unknown"), undefined);
});

test("rebuild from session entries", () => {
  const index = new TranscriptIndex({ foldAcrossThinking: false });
  index.rebuild([
    { type: "message", id: "1", message: { role: "user", content: "hi" } },
    { type: "message", id: "2", message: { role: "assistant", content: [call("a", "read")] } },
    { type: "message", id: "3", message: { role: "toolResult", content: [] } },
    { type: "custom_message", id: "4", display: false },
    { type: "message", id: "5", message: { role: "assistant", content: [call("b", "grep")] } },
    { type: "custom_message", id: "6", display: true },
    { type: "message", id: "7", message: { role: "assistant", content: [call("c", "grep")] } },
  ]);
  assert.deepEqual(index.group("a"), ["a", "b"]);
  assert.deepEqual(index.group("c"), ["c"]);
});
