// the frozen analysis of FREEZE.json: re-runs each grid cell exactly (deterministic, the grid's own seeds and
// overrides), checks the per-arm means match grid-30000.json, and computes the paired contrasts the freeze names.
// node src/analyze_c.mjs grid-30000.json analysis-30000.json
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { runAll } from "./run.mjs";

const [gridPath, outPath] = process.argv.slice(2);
if (existsSync(outPath)) throw new Error("refusing to overwrite " + outPath);
const grid = JSON.parse(readFileSync(gridPath, "utf8"));
const H = grid.config.histories;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pairedCI(diffs, seed) {
  const r = rng(seed), n = diffs.length, B = 4000, means = [];
  for (let b = 0; b < B; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += diffs[Math.floor(r() * n)];
    means.push(s / n);
  }
  means.sort((x, y) => x - y);
  const mean = diffs.reduce((x, y) => x + y, 0) / n;
  return { mean, ci95: [means[Math.floor(0.025 * B)], means[Math.floor(0.975 * B)]] };
}

function verdict(c) {
  if (c.mean >= 0.05 && c.ci95[0] > 0) return "PAYS";
  if (c.mean <= -0.05 && c.ci95[1] < 0) return "COSTS";
  return "NEUTRAL";
}

const out = [];
for (const cell of grid.cells) {
  const o = { slots: cell.slots, cross: cell.cross, noise: cell.noise };
  const res = runAll(cell.seed, H, o);
  for (const arm of Object.keys(cell.arms)) {
    const m = res.perHistory.reduce((s, h) => s + h.arms[arm].total, 0) / H;
    if (Math.abs(m - cell.arms[arm].total.mean) > 1e-12) throw new Error(`cell ${cell.index} ${arm}: rerun differs from the grid`);
  }
  const d = (a, b, k = "total") => res.perHistory.map((h) => h.arms[a][k] - h.arms[b][k]);
  const sw = pairedCI(d("single_winner", "local_only"), 1000 + cell.index);
  const tp = pairedCI(d("temporal", "local_only"), 2000 + cell.index);
  const ceiling = pairedCI(d("oracle", "none"), 3000 + cell.index);
  out.push({
    index: cell.index, ...o,
    single_minus_local: { ...sw, verdict: verdict(sw) },
    temporal_minus_local: { ...tp, verdict: verdict(tp) },
    temporal_minus_single_total: pairedCI(d("temporal", "single_winner"), 4000 + cell.index),
    temporal_minus_single_revision: pairedCI(d("temporal", "single_winner", "revision"), 5000 + cell.index),
    random_minus_single_total: pairedCI(d("random_stage", "single_winner"), 6000 + cell.index),
    ceiling_oracle_minus_none: ceiling,
    uninformative: ceiling.mean < 0.05,
  });
}
writeFileSync(outPath, JSON.stringify({ grid: gridPath, histories: H, cells: out }, null, 2) + "\n");
for (const c of out) {
  console.log(`slots ${c.slots} cross ${c.cross} noise ${c.noise} | single-local ${c.single_minus_local.mean.toFixed(3)} ${c.single_minus_local.verdict} | temporal-local ${c.temporal_minus_local.mean.toFixed(3)} ${c.temporal_minus_local.verdict} | temp-single rev ${c.temporal_minus_single_revision.mean.toFixed(3)} | random-single ${c.random_minus_single_total.mean.toFixed(3)} | ceiling ${c.ceiling_oracle_minus_none.mean.toFixed(3)}${c.uninformative ? " UNINFORMATIVE" : ""}`);
}
