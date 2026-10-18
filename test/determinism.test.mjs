import { test } from "node:test";
import assert from "node:assert/strict";
import { generateLife } from "../src/world.mjs";
import { runArm, ARM_NAMES } from "../src/arms.mjs";
import { runAll } from "../src/run.mjs";

test("the same seed gives the same life, and different seeds differ", () => {
  assert.deepEqual(generateLife(7), generateLife(7));
  assert.notDeepEqual(generateLife(7), generateLife(8));
});

test("every arm gives identical answers and stage logs on a rerun", () => {
  const life = generateLife(3);
  for (const name of ARM_NAMES) {
    assert.deepEqual(runArm(life, name), runArm(life, name), name);
  }
});

test("runAll is deterministic per seed, including the bootstrap intervals", () => {
  assert.deepEqual(runAll(5, 3), runAll(5, 3));
});
