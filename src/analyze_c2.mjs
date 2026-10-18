// the frozen analysis of FREEZE-C2.json, read from the grid's stored per-history scores.
// node src/analyze_c2.mjs grid-c2-40000.json analysis-c2-40000.json
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const [gridPath, outPath] = process.argv.slice(2);
if (existsSync(outPath)) throw new Error("refusing to overwrite " + outPath);
const grid = JSON.parse(readFileSync(gridPath, "utf8"));

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
  return { mean: diffs.reduce((x, y) => x + y, 0) / n, ci95: [means[Math.floor(0.025 * B)], means[Math.floor(0.975 * B)]] };
}

const verdict = (c) => (c.mean >= 0.05 && c.ci95[0] > 0 ? "PAYS" : c.mean <= -0.05 && c.ci95[1] < 0 ? "COSTS" : "NEUTRAL");

const out = [];
for (const cell of grid.cells) {
  const H = cell.perHistory;
  const d = (a, b, k = "total") => H.map((h) => h.arms[a][k] - h.arms[b][k]);
  const s = pairedCI(d("stage_single", "local_plus"), 1000 + cell.index);
  const t = pairedCI(d("stage_temporal", "local_plus"), 2000 + cell.index);
  const ceil = pairedCI(d("oracle_stage", "none"), 3000 + cell.index);
  out.push({
    index: cell.index, K: cell.K, slots: cell.slots, cross: cell.cross, noise: cell.noise,
    single_minus_local_plus: { ...s, verdict: verdict(s) },
    temporal_minus_local_plus: { ...t, verdict: verdict(t) },
    temporal_minus_single_revision: pairedCI(d("stage_temporal", "stage_single", "revision"), 4000 + cell.index),
    random_minus_single_total: pairedCI(d("stage_random", "stage_single"), 5000 + cell.index),
    ceiling_oracle_minus_none: ceil, uninformative: ceil.mean < 0.05,
  });
}
writeFileSync(outPath, JSON.stringify({ grid: gridPath, cells: out }, null, 2) + "\n");
for (const c of out) {
  const f = (x) => x.mean.toFixed(3);
  console.log(`K ${c.K} slots ${c.slots} cross ${c.cross} noise ${c.noise} | single ${f(c.single_minus_local_plus)} ${c.single_minus_local_plus.verdict} | temporal ${f(c.temporal_minus_local_plus)} ${c.temporal_minus_local_plus.verdict} | t-s rev ${f(c.temporal_minus_single_revision)} | rand-s ${f(c.random_minus_single_total)} | ceil ${f(c.ceiling_oracle_minus_none)}${c.uninformative ? " UNINF" : ""}`);
}
