import assert from "node:assert/strict";
import { test } from "node:test";
import { markAssistant } from "../src/marks.ts";

test("progress notes become quotes", () => {
  assert.equal(markAssistant("Checking tests\n\nthen config", "progress", true, "●"), "> Checking tests\n>\n> then config");
});

test("final answer gets a dot once streaming ends", () => {
  assert.equal(markAssistant("Fixed it.", "final", true, "●"), "Fixed it.");
  assert.equal(markAssistant("Fixed it.\n- a", "final", false, "●"), "● Fixed it.\n- a");
  assert.equal(markAssistant("## Summary\ntext", "final", false, "●"), "## ● Summary\ntext");
  assert.equal(markAssistant("- a\n- b", "final", false, "●"), "- a\n- b");
  assert.equal(markAssistant("```ts\nx\n```", "final", false, "●"), "```ts\nx\n```");
  assert.equal(markAssistant("Fixed.", "final", false, ""), "Fixed.");
  assert.equal(markAssistant("Fixed.", undefined, false, "●"), "Fixed.");
});
