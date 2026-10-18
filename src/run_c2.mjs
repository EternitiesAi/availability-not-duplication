// packet C2 runner: one cell of the C2 grid. reuses the world, the scorer and the bootstrap of packet C.
import { generateLife, resolveParams } from "./world.mjs";
import { ARM_C2, runArmC2 } from "./arms_c2.mjs";
import { scoreArm } from "./measure.mjs";
import { bootMeans } from "./run.mjs";
import { streamSeed } from "./rng.mjs";

export const METRICS_C2 = ["total", "transfer", "own", "revision"];

function summarize(values, label) {
  const xs = values.filter((v) => v !== null);
  if (!xs.length) return { n: 0, mean: null, ci95: null };
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return { n: xs.length, mean, ci95: bootMeans(xs, label) };
}

// overrides: { slots, cross, noise } as in packet C. K: the extra memory every C2 arm gets.
export function runAllC2(seed, histories, overrides = {}, K = 0) {
  const P = resolveParams(overrides);
  const perHistory = [];
  for (let h = 0; h < histories; h++) {
    const hSeed = streamSeed(seed, `history:${h}`);
    const life = generateLife(hSeed, P);
    const arms = {};
    for (const name of ARM_C2) {
      const { answers } = runArmC2(life, name, { K });
      const s = scoreArm(life, answers);
      arms[name] = Object.fromEntries(METRICS_C2.map((m) => [m, s[m]]));
    }
    perHistory.push({ index: h, seed: hSeed, arms });
  }
  const perArm = {};
  for (const name of ARM_C2) {
    perArm[name] = Object.fromEntries(
      METRICS_C2.map((m) => [m, summarize(perHistory.map((h) => h.arms[name][m]), `c2:${name}:${m}`)]),
    );
  }
  return { config: { seed, histories, K, params: P }, perArm, perHistory };
}
