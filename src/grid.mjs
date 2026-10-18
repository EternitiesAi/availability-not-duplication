// cli: node src/grid.mjs --seed <n> --histories <n> --out <file>
// runs 27 cells: slots {20,40,80} x cross {0.10,0.25,0.50} x noise {0.3,0.6,0.9}. cell i runs with seed
// seed + i. refuses to overwrite --out.
import { writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ARM_NAMES } from "./arms.mjs";
import { runAll, bootMeans, BOOT_DRAWS } from "./run.mjs";

export const SLOTS_GRID = [20, 40, 80];
export const CROSS_GRID = [0.1, 0.25, 0.5];
export const NOISE_GRID = [0.3, 0.6, 0.9];

// the cell list, in a fixed order: slots outer, cross middle, noise inner.
export function cellsFor(seed) {
  const cells = [];
  for (const slots of SLOTS_GRID) {
    for (const cross of CROSS_GRID) {
      for (const noise of NOISE_GRID) {
        const index = cells.length;
        cells.push({ index, seed: seed + index, slots, cross, noise });
      }
    }
  }
  return cells;
}

// the decisive contrast per history: the better stage arm's total minus local_only's total, paired on the
// same history. a history missing any of the three is left out. the interval is a bootstrap over histories.
export function bestStageMinusLocal(perHistory) {
  const d = [];
  for (const h of perHistory) {
    const s = h.arms.single_winner.total;
    const t = h.arms.temporal.total;
    const l = h.arms.local_only.total;
    if (s === null || t === null || l === null) continue;
    d.push(Math.max(s, t) - l);
  }
  if (!d.length) return { n: 0, mean: null, ci95: null };
  const mean = d.reduce((a, b) => a + b, 0) / d.length;
  return { n: d.length, mean, ci95: bootMeans(d, "best_stage_minus_local") };
}

export function runGrid(seed, histories) {
  const cells = cellsFor(seed).map((c) => {
    const res = runAll(c.seed, histories, { slots: c.slots, cross: c.cross, noise: c.noise });
    const arms = {};
    for (const name of ARM_NAMES) {
      arms[name] = Object.fromEntries(
        ["total", "transfer", "own", "revision"].map((m) => [m, res.perArm[name][m]]),
      );
    }
    return {
      index: c.index,
      seed: c.seed,
      slots: c.slots,
      cross: c.cross,
      noise: c.noise,
      arms,
      contrasts: {
        best_stage_minus_local: bestStageMinusLocal(res.perHistory),
        temporal_minus_single: res.contrasts["temporal minus single_winner"].total,
      },
    };
  });
  return {
    config: {
      seed,
      histories,
      grid: { slots: SLOTS_GRID, cross: CROSS_GRID, noise: NOISE_GRID },
      cellSeeds: "seed + cell index",
      bootDraws: BOOT_DRAWS,
      arms: ARM_NAMES,
      notes: [
        "best_stage_minus_local is per history max(single_winner, temporal) total minus local_only total, paired.",
        "other cell parameters are the module defaults; only slots, cross and noise vary.",
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

  const result = runGrid(seed, histories);
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
