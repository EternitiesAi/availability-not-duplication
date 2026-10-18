import { test } from "node:test";
import assert from "node:assert/strict";
import { generateLife, DECAY, LOOKUP_CAP } from "../src/world.mjs";
import { runArm, Memory, ARM_NAMES, HALF_RATE } from "../src/arms.mjs";
import { scoreArm } from "../src/measure.mjs";
import { runAll } from "../src/run.mjs";

test("smoke: oracle total >= none total, and every arm number is in [0,1]", () => {
  const res = runAll(1, 10);
  assert.ok(res.perArm.oracle.total.mean >= res.perArm.none.total.mean);
  for (const name of ARM_NAMES) {
    for (const metric of ["transfer", "own", "total", "revision", "capLoss"]) {
      const s = res.perArm[name][metric];
      if (s.mean === null) continue;
      assert.ok(s.mean >= 0 && s.mean <= 1, `${name} ${metric} = ${s.mean}`);
      assert.ok(s.ci95[0] >= 0 && s.ci95[1] <= 1, `${name} ${metric} ci`);
    }
  }
});

test("local_only transfers through a directory hit: a cross query answered from another faculty", () => {
  let hits = 0;
  for (let seed = 1; seed <= 5; seed++) {
    const life = generateLife(seed * 1000 + 17);
    const { answers, trace } = runArm(life, "local_only");
    for (const q of life.queries) {
      if (q.cross && trace[q.n].hitFrom >= 0 && answers[q.n] === q.truth) hits++;
    }
  }
  assert.ok(hits > 0, "no cross query was answered by a directory hit");
});

test("local_only honors LOOKUP_CAP: no query asks more than the cap, and the bank never exceeds it", () => {
  for (const seed of [2, 4, 6]) {
    const life = generateLife(seed);
    const { trace, maxBank } = runArm(life, "local_only");
    assert.ok(maxBank <= LOOKUP_CAP, `bank ${maxBank}`);
    for (const tr of trace) assert.ok(tr.asks <= LOOKUP_CAP, `asks ${tr.asks}`);
  }
});

test("random_stage never uses salience (constructed: flat salience gives the same run)", () => {
  const life = generateLife(41);
  const flat = { ...life, arrivals: life.arrivals.map((a) => ({ ...a, salience: 0.5 })) };
  assert.deepEqual(runArm(flat, "random_stage"), runArm(life, "random_stage"));
  assert.ok(runArm(life, "random_stage").stageLog.length > 0);
});

test("a stage write can evict an own fact (constructed)", () => {
  const m = new Memory(2);
  m.setPrimary("own-old", 1, 1, DECAY);
  m.setPrimary("own-new", 2, 1, DECAY);
  m.setPrimary("stage", 3, 1, DECAY); // full: the weakest (oldest own) goes
  assert.equal(m.lookup("own-old"), null);
  assert.equal(m.lookup("own-new"), 2);
  assert.equal(m.lookup("stage"), 3);
});

test("a temporal half write is not evicted on arrival when the slots hold weaker items (constructed)", () => {
  const m = new Memory(2);
  m.setPrimary("a", 1, 0.6, DECAY);
  m.setPrimary("b", 2, 0.7, DECAY);
  m.setAlt("half", 9, 1, HALF_RATE); // full strength on arrival, so it beats both weaker items
  assert.equal(m.lookup("half"), 9);
  assert.equal(m.lookup("a"), null); // the weakest is the one evicted
  assert.equal(m.lookup("b"), 2);
});

test("the yoked arm is gone: no donor life, no cross-life writes", () => {
  assert.ok(!ARM_NAMES.includes("yoked"));
  assert.ok(ARM_NAMES.includes("random_stage"));
});

test("temporal's half retention decays twice as fast (unit)", () => {
  const m = new Memory(5);
  m.setPrimary("full", 1, 1, DECAY);
  m.setAlt("half", 2, 1, HALF_RATE);
  const full = m.find("full", false);
  const half = m.find("half", true);
  const [f0, h0] = [full.strength, half.strength];
  m.decay();
  const fullDrop = f0 - full.strength;
  const halfDrop = h0 - half.strength;
  assert.ok(Math.abs(fullDrop - DECAY) < 1e-12);
  assert.ok(Math.abs(halfDrop - 2 * DECAY) < 1e-12);
  assert.ok(Math.abs(halfDrop / fullDrop - 2) < 1e-9);
});

test("temporal writes at full strength; one gained write per two-bid tick", () => {
  const life = generateLife(21);
  const { stageLog } = runArm(life, "temporal");
  const byTick = new Map();
  for (const w of stageLog) {
    if (!byTick.has(w.tick)) byTick.set(w.tick, []);
    byTick.get(w.tick).push(w);
  }
  let checked = 0;
  for (const [tick, ws] of byTick) {
    if (ws.length !== 2) continue;
    checked++;
    assert.equal(ws.filter((w) => w.gain).length, 1, `tick ${tick}`);
    assert.ok(ws.every((w) => w.strength === 1 && w.rate === HALF_RATE), `tick ${tick}`);
  }
  assert.ok(checked > 0);
});

test("scoring uses the truth only where it should: a correct answer scores 1 on its class", () => {
  const life = generateLife(31);
  const answers = life.queries.map((q) => q.truth);
  const s = scoreArm(life, answers);
  assert.equal(s.transfer, 1);
  assert.equal(s.own, 1);
  assert.equal(s.total, 1);
});
