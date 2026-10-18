import { test } from "node:test";
import assert from "node:assert/strict";
import * as W from "../src/world.mjs";
import { runArm } from "../src/arms.mjs";
import { cellsFor, bestStageMinusLocal, SLOTS_GRID, CROSS_GRID, NOISE_GRID } from "../src/grid.mjs";

test("overrides change the life, and the same overrides give the same life", () => {
  const base = W.generateLife(9);
  const over = W.generateLife(9, { cross: 0.5 });
  assert.deepEqual(over, W.generateLife(9, { cross: 0.5 }));
  assert.notDeepEqual(over.queries, base.queries);
  assert.equal(over.params.cross, 0.5);
  assert.equal(base.params.cross, W.CROSS);
});

test("overrides reach the arms: a smaller memory answers differently", () => {
  const small = W.generateLife(9, { slots: 20 });
  assert.equal(small.params.slots, 20);
  assert.equal(small.capLoss.slots, 10);
  const big = W.generateLife(9);
  const a = runArm(small, "single_winner").answers;
  const b = runArm(big, "single_winner").answers;
  assert.notDeepEqual(a, b);
});

test("module defaults are not mutated by override runs", () => {
  W.generateLife(4, { slots: 80, cross: 0.1, noise: 0.9 });
  assert.equal(W.SLOTS, 40);
  assert.equal(W.CROSS, 0.25);
  assert.equal(W.SALIENCE_NOISE, 0.6);
  assert.deepEqual(W.resolveParams({}), { slots: 40, cross: 0.25, noise: 0.6 });
});

test("invalid overrides are refused", () => {
  assert.throws(() => W.resolveParams({ slots: 0 }));
  assert.throws(() => W.resolveParams({ cross: 1.5 }));
  assert.throws(() => W.resolveParams({ noise: -1 }));
});

test("grid: 27 cells over the axes, each with a distinct seed = seed + index", () => {
  const cells = cellsFor(100);
  assert.equal(cells.length, 27);
  assert.equal(new Set(cells.map((c) => c.seed)).size, 27);
  cells.forEach((c, i) => assert.equal(c.seed, 100 + i));
  assert.deepEqual([...new Set(cells.map((c) => c.slots))], SLOTS_GRID);
  assert.deepEqual([...new Set(cells.map((c) => c.cross))], CROSS_GRID);
  assert.deepEqual([...new Set(cells.map((c) => c.noise))], NOISE_GRID);
});

test("paired contrast: each history contributes max(stage) - local from its own row", () => {
  // unpaired pooling would give a different mean here: history 1's local is high, history 2's is low.
  const perHistory = [
    { arms: { single_winner: { total: 0.5 }, temporal: { total: 0.3 }, local_only: { total: 0.2 } } },
    { arms: { single_winner: { total: 0.1 }, temporal: { total: 0.4 }, local_only: { total: 0.6 } } },
  ];
  const c = bestStageMinusLocal(perHistory);
  assert.equal(c.n, 2);
  assert.ok(Math.abs(c.mean - 0.05) < 1e-12); // (0.5 - 0.2 + 0.4 - 0.6) / 2
  assert.ok(c.ci95[0] >= -0.2 - 1e-12 && c.ci95[1] <= 0.3 + 1e-12);
  assert.ok(c.ci95[0] <= c.mean && c.mean <= c.ci95[1]);
});

test("paired contrast: a history missing an arm is left out, not zero-filled", () => {
  const perHistory = [
    { arms: { single_winner: { total: 0.5 }, temporal: { total: 0.3 }, local_only: { total: 0.2 } } },
    { arms: { single_winner: { total: null }, temporal: { total: 0.3 }, local_only: { total: 0.2 } } },
  ];
  const c = bestStageMinusLocal(perHistory);
  assert.equal(c.n, 1);
  assert.ok(Math.abs(c.mean - 0.3) < 1e-12);
});
