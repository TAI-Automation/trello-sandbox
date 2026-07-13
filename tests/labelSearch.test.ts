import assert from "node:assert/strict";
import test from "node:test";

import { searchLabels } from "../src/labelSearch/fuzzy.js";

const labels = [
  { id: "label-1", idBoard: "board-1", name: "Finance Approval", color: "blue" },
  { id: "label-2", idBoard: "board-1", name: "Operations", color: "green" },
  { id: "label-3", idBoard: "board-1", name: "", color: "red" },
];

test("label search ranks exact matches ahead of partial matches", () => {
  const results = searchLabels(labels, "operations");

  assert.equal(results[0]?.trelloLabelId, "label-2");
  assert.equal(results[0]?.score, 100);
});

test("label search tolerates a keyboard-close typo", () => {
  const results = searchLabels(labels, "finanse");

  assert.equal(results[0]?.trelloLabelId, "label-1");
  assert.equal(results[0]?.matchedReason, "Keyboard-close typo match");
});

test("label search excludes blank labels from a nonblank query", () => {
  const results = searchLabels(labels, "finance");

  assert.equal(
    results.some((result) => result.trelloLabelId === "label-3"),
    false
  );
});
