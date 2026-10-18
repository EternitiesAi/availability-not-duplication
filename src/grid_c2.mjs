// cli: node src/grid_c2.mjs --seed <n> --histories <n> --out <file>
// 36 cells: K {12,24,48} x slots {40,80} x cross {0.25,0.50} x noise {0.3,0.6,0.9}. cell i runs with seed + i.
// stores per-history total, transfer, own and revision for every arm, so paired contrasts can be recomputed.
// refuses to overwrite --out.
import { writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { BOOT_DRAWS, bootMeans } from "./run.mjs";
import { ARM_C2 } from "./arms_c2.mjs";
import { runAllC2, METRICS_C2 } from "./run_c2.mjs";

export const K_GRID = [12, 24, 48];
export const SLOTS_GRID_C2 = [40, 80];
export const CROSS_GRID_C2 = [0.25, 0.5];
export const NOISE_GRID_C2 = [0.3, 0.6, 0.9];

export function cellsC2(seed) {
  const cells = [];
  for (const K of K_GRID) {
    for (const slots of SLOTS_GRID_C2) {
      for (const cross of CROSS_GRID_C2) {
        for (const noise of NOISE_GRID_C2) {
          const index = cells.length;
          cells.push({ index, seed: seed + index, K, slots, cross, noise });
        }
      }
    }
  }
  return cells;
}

// per history: the better of the two selected stages minus local_plus, on total. paired on the same history;
// a history missing any of the three is left out. the interval is a bootstrap over histories.
export function bestStageMinusLocalPlus(perHistory) {
  const d = [];
  for (const h of perHistory) {
    const s = h.arms.stage_single.total;
    const t = h.arms.stage_temporal.total;
    const l = h.arms.local_plus.total;
    if (s === null || t === null || l === null) continue;
    d.push(Math.max(s, t) - l);
  }
  if (!d.length) return { n: 0, mean: null, ci95: null };
  const mean = d.reduce((a, b) => a + b, 0) / d.length;
  return { n: d.length, mean, ci95: bootMeans(d, "c2:best_stage_minus_local_plus") };
}

export function runGridC2(seed, histories) {
  const cells = cellsC2(seed).map((c) => {
    const res = runAllC2(c.seed, histories, { slots: c.slots, cross: c.cross, noise: c.noise }, c.K);
    return {
      index: c.index,
      seed: c.seed,
      K: c.K,
      slots: c.slots,
      cross: c.cross,
      noise: c.noise,
      perArm: Object.fromEntries(
        ARM_C2.map((name) => [
          name,
          Object.fromEntries(METRICS_C2.map((m) => [m, res.perArm[name][m]])),
        ]),
      ),
      perHistory: res.perHistory.map((h) => ({
        index: h.index,
        arms: Object.fromEntries(
          ARM_C2.map((name) => [name, Object.fromEntries(METRICS_C2.map((m) => [m, h.arms[name][m]]))]),
        ),
      })),
      contrasts: { best_stage_minus_local_plus: bestStageMinusLocalPlus(res.perHistory) },
    };
  });
  return {
    config: {
      seed,
      histories,
      grid: { K: K_GRID, slots: SLOTS_GRID_C2, cross: CROSS_GRID_C2, noise: NOISE_GRID_C2 },
      cellSeeds: "seed + cell index",
      bootDraws: BOOT_DRAWS,
      arms: ARM_C2,
      notes: [
        "stage writes are free (as packet C's stage writes); lookups cost one unit each, including the stage read.",
        "the stage read comes first on an own-memory miss; the directory gets LOOKUP_CAP minus the asks already spent.",
        "stage_temporal uses packet C's gain and alternative rule; a stale primary keeps answering until a gain write replaces it.",
        "capability loss halves one faculty's private memory; the stage store is not a faculty and is not halved.",
      ],
    },
    cells,
  };
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    const v = argv[i + 1];
    if (!k || !k.startsWith("--") || v === undefined) throw new Error(`bad argument: ${k}`);
    o[k.slice(2)] = v;
  }
  return o;
}

export function main(argv) {
  const args = parseArgs(argv);
  if (args.out === undefined) throw new Error("--out is required");
  const seed = Number(args.seed);
  const histories = Number(args.histories);
  if (!Number.isInteger(seed) || seed < 0) throw new Error("--seed must be an integer >= 0");
  if (!Number.isInteger(histories) || histories < 1) throw new Error("--histories must be an integer >= 1");
  const out = resolve(args.out);
  if (existsSync(out)) throw new Error(`refusing to overwrite existing file: ${out}`);

  const result = runGridC2(seed, histories);
  writeFileSync(out, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  console.log(`wrote ${out} (${result.cells.length} cells)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
