import { test } from "node:test";
import assert from "node:assert/strict";
import { generateLife } from "../src/world.mjs";
import { runArm } from "../src/arms.mjs";
import { runArmC2, ARM_C2 } from "../src/arms_c2.mjs";
import { runAllC2 } from "../src/run_c2.mjs";
import { cellsC2, bestStageMinusLocalPlus } from "../src/grid_c2.mjs";

// a hand-built life: one fact at tick 0, three queries at tick 1, so the lookup bank is exactly known.
function handLife() {
  return {
    seed: 1,
    params: { slots: 40, cross: 0.25, noise: 0.6 },
    capLoss: { faculty: 0, fromTick: 504, slots: 20 },
    arrivals: [{ tick: 0, observer: 0, key: "a", value: 5, salience: 0.9, kind: "fact" }],
    queries: [
      { n: 0, tick: 1, asker: 3, key: "a", truth: 5 },
      { n: 1, tick: 1, asker: 4, key: "zz", truth: 1 },
      { n: 2, tick: 1, asker: 5, key: "a", truth: 5 },
    ],
  };
}

test("stage arms never write into faculty memory: every held key was observed by that faculty", () => {
  for (const seed of [5, 6]) {
    const life = generateLife(seed);
    const observerOf = new Map(life.arrivals.map((a) => [a.key, a.observer]));
    for (const name of ["stage_single", "stage_temporal", "stage_random", "oracle_stage"]) {
      const { facultyKeys } = runArmC2(life, name, { K: 24, snapshotTick: 150 });
      const held = facultyKeys.reduce((n, keys) => n + keys.length, 0);
      assert.ok(held > 0, `${name}: the audit saw no entries`);
      facultyKeys.forEach((keys, f) => {
        for (const k of keys) assert.equal(observerOf.get(k), f, `${name} faculty ${f} holds ${k}`);
      });
    }
  }
});

test("stage arms do copy nothing into faculties, but do write the stage (constructed: stage holds the key)", () => {
  // the hand life: the stage holds key a after tick 0, yet faculties 3..5 hold nothing for it.
  const { facultyKeys } = runArmC2(handLife(), "stage_single", { K: 12, snapshotTick: 1 });
  assert.deepEqual(facultyKeys[3], []);
  assert.deepEqual(facultyKeys[5], []);
  assert.deepEqual(facultyKeys[0], ["a"]);
});

test("local_plus slot arithmetic: each faculty gets K/12 more slots; capability loss halves that total", () => {
  const life = generateLife(9);
  const { facultySlots, facultyKeys } = runArmC2(life, "local_plus", { K: 24 });
  const L = life.capLoss.faculty;
  facultySlots.forEach((s, f) => assert.equal(s, f === L ? Math.floor((40 + 2) / 2) : 42));
  assert.ok(facultyKeys.every((k) => k.length <= 42));
  assert.throws(() => runArmC2(life, "local_plus", { K: 10 }), /divisible by 12/);
});

test("a stage read costs one lookup unit: with the bank spent, no further asks are possible", () => {
  const { answers, trace, maxBank } = runArmC2(handLife(), "stage_single", { K: 12 });
  assert.equal(answers[0], 5); // stage hit: current value
  assert.deepEqual(trace[0], { asks: 1, hitFrom: -2 });
  assert.deepEqual(trace[1], { asks: 1, hitFrom: -1 }); // stage read missed; the second unit has no directory to spend on
  assert.equal(answers[1], null);
  assert.deepEqual(trace[2], { asks: 0, hitFrom: -1 }); // bank empty: no stage read, no directory ask
  assert.equal(answers[2], null);
  assert.equal(maxBank, 2);
});

test("K = 0 is exactly local_only, for every stage arm and for local_plus", () => {
  for (const seed of [1, 2, 3]) {
    const life = generateLife(seed);
    const ref = runArm(life, "local_only");
    for (const name of ["stage_single", "stage_temporal", "stage_random", "oracle_stage", "local_plus"]) {
      const r = runArmC2(life, name, { K: 0 });
      assert.deepEqual(r.answers, ref.answers, `${name} answers`);
      assert.deepEqual(r.trace, ref.trace, `${name} trace`);
      assert.equal(r.maxBank, ref.maxBank, `${name} bank`);
    }
  }
});

test("LOOKUP_CAP is honored by every lookup arm, with the stage read counted", () => {
  const life = generateLife(7);
  for (const name of ARM_C2) {
    const r = runArmC2(life, name, { K: 24 });
    assert.ok(r.maxBank <= 2, `${name} bank ${r.maxBank}`);
    for (const tr of r.trace) assert.ok(tr.asks <= 2, `${name} asks ${tr.asks}`);
  }
});

test("determinism: every C2 arm, and a small runAllC2, give identical output on a rerun", () => {
  const life = generateLife(11);
  for (const name of ARM_C2) {
    assert.deepEqual(runArmC2(life, name, { K: 12 }), runArmC2(life, name, { K: 12 }), name);
  }
  assert.deepEqual(runAllC2(4, 3, {}, 24), runAllC2(4, 3, {}, 24));
});

test("grid_c2: 36 cells, distinct seeds seed + index, K values as specified", () => {
  const cells = cellsC2(50);
  assert.equal(cells.length, 36);
  assert.equal(new Set(cells.map((c) => c.seed)).size, 36);
  cells.forEach((c, i) => assert.equal(c.seed, 50 + i));
  assert.deepEqual([...new Set(cells.map((c) => c.K))], [12, 24, 48]);
});

test("paired contrast: best of the two selected stages minus local_plus, per history", () => {
  const perHistory = [
    { arms: { stage_single: { total: 0.5 }, stage_temporal: { total: 0.3 }, local_plus: { total: 0.2 } } },
    { arms: { stage_single: { total: 0.1 }, stage_temporal: { total: 0.4 }, local_plus: { total: 0.6 } } },
  ];
  const c = bestStageMinusLocalPlus(perHistory);
  assert.equal(c.n, 2);
  assert.ok(Math.abs(c.mean - 0.05) < 1e-12); // (0.5 - 0.2 + 0.4 - 0.6) / 2
  assert.ok(c.ci95[0] <= c.mean && c.mean <= c.ci95[1]);
});
