// cli: node src/run.mjs --seed <n> --histories <n> --out <file>
// refuses to overwrite --out. the json holds no wall-clock fields, so the same args give the same file.
import { writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as W from "./world.mjs";
import { ARM_NAMES, HALF_RATE, runArm } from "./arms.mjs";
import { scoreArm, lifeCounts } from "./measure.mjs";
import { mulberry32, streamSeed } from "./rng.mjs";

export const BOOT_DRAWS = 2000;
const METRICS = ["transfer", "own", "total", "revision", "capLoss"];
const CONTRASTS = [
  ["single_winner", "local_only"], // decisive: a stage arm against local at matched compute
  ["temporal", "local_only"],
  ["temporal", "single_winner"], // secondary: does alternation help?
  ["oracle", "none"], // reference: the ceiling must sit above the floor
];

// percentile bootstrap over histories. one labelled stream per summary, so reruns agree.
export function bootMeans(values, label) {
  const n = values.length;
  const rng = mulberry32(streamSeed(0, `bootstrap:${label}`));
  const means = [];
  for (let d = 0; d < BOOT_DRAWS; d++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += values[Math.floor(rng() * n)];
    means.push(s / n);
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor(0.025 * BOOT_DRAWS)], means[Math.ceil(0.975 * BOOT_DRAWS) - 1]];
}

function summarize(values, label) {
  const xs = values.filter((v) => v !== null);
  if (!xs.length) return { n: 0, mean: null, ci95: null };
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return { n: xs.length, mean, ci95: bootMeans(xs, label) };
}

// paired difference a - b over the histories where both arms have the metric.
function contrast(perHistory, a, b, metric) {
  const d = [];
  for (const h of perHistory) {
    const x = h.arms[a][metric];
    const y = h.arms[b][metric];
    if (x !== null && y !== null) d.push(x - y);
  }
  if (!d.length) return { n: 0, mean: null, ci95: null };
  const mean = d.reduce((s, v) => s + v, 0) / d.length;
  return { n: d.length, mean, ci95: bootMeans(d, `${a}-${b}:${metric}`) };
}

// overrides: { slots, cross, noise }. absent keys take the module defaults and are recorded in config.
export function runAll(seed, histories, overrides = {}) {
  const P = W.resolveParams(overrides);
  const perHistory = [];
  for (let h = 0; h < histories; h++) {
    const hSeed = streamSeed(seed, `history:${h}`);
    const life = W.generateLife(hSeed, P);
    const arms = {};
    for (const name of ARM_NAMES) {
      const { answers } = runArm(life, name);
      arms[name] = scoreArm(life, answers);
    }
    perHistory.push({ index: h, seed: hSeed, counts: lifeCounts(life), arms });
  }

  const perArm = {};
  for (const name of ARM_NAMES) {
    perArm[name] = Object.fromEntries(
      METRICS.map((m) => [m, summarize(perHistory.map((h) => h.arms[name][m]), `${name}:${m}`)]),
    );
  }
  const contrasts = {};
  for (const [a, b] of CONTRASTS) {
    contrasts[`${a} minus ${b}`] = Object.fromEntries(
      ["total", "transfer", "revision"].map((m) => [m, contrast(perHistory, a, b, m)]),
    );
  }

  const config = {
    seed,
    histories,
    faculties: W.FACULTIES,
    ticks: W.TICKS,
    phases: W.PHASES,
    phaseTicks: W.PHASE_TICKS,
    correctionFrom: W.CORRECTION_FROM,
    correctionTo: W.CORRECTION_TO,
    capLossFrom: W.CAP_LOSS_FROM,
    factRate: W.FACT_RATE,
    queryRate: W.QUERY_RATE,
    cross: P.cross,
    correctionRate: W.CORRECTION_RATE,
    salienceNoise: P.noise,
    lateQueryShare: W.LATE_QUERY_SHARE,
    soonWindow: W.SOON_WINDOW,
    slots: P.slots,
    overridden: Object.keys(overrides).filter((k) => overrides[k] !== undefined),
    decay: W.DECAY,
    budget: W.BUDGET,
    lookupCap: W.LOOKUP_CAP,
    halfRate: HALF_RATE,
    bootDraws: BOOT_DRAWS,
    arms: ARM_NAMES,
    notes: [
      "revision 2. histories are independent seeds derived from --seed.",
      "cross share applies to queried facts (only queried facts are cross or own).",
      "temporal writes top two bids at full strength with decay 2*DECAY; gain alternates by tick parity; a gain write replaces the primary, a non-gain write is an alternative used only without a primary.",
      "local_only: budget accrues 1 per tick, carry-over capped at LOOKUP_CAP; a query asks at most LOOKUP_CAP faculties, the top of its directory (past successful answers, ties by index).",
      "random_stage: one arrival per tick drawn uniformly from that tick's arrivals (else the most recent arrival), full strength, salience ignored.",
      "oracle writes the arrival whose current value is queried soonest, on the single-write channel.",
      "every write sets an entry's strength and decay rate; eviction is weakest-first, always-insert.",
      "capability loss halves the memory of one faculty in phase 3 and does not restore it.",
    ],
  };
  return { config, perArm, contrasts, perHistory };
}

export function toJson(obj) {
  return JSON.stringify(obj, null, 2) + "\n";
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

function intArg(name, v, min) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw new Error(`--${name} must be an integer >= ${min}`);
  return n;
}

function numArg(name, v) {
  const n = Number(v);
  if (v === "" || !Number.isFinite(n)) throw new Error(`--${name} must be a number`);
  return n;
}

// the optional overrides. absent flags stay undefined, so the defaults apply.
export function overridesFrom(args) {
  const o = {};
  if (args.slots !== undefined) o.slots = intArg("slots", args.slots, 1);
  if (args.cross !== undefined) o.cross = numArg("cross", args.cross);
  if (args.noise !== undefined) o.noise = numArg("noise", args.noise);
  return o;
}

export function main(argv) {
  const args = parseArgs(argv);
  if (args.out === undefined) throw new Error("--out is required");
  const seed = intArg("seed", args.seed, 0);
  const histories = intArg("histories", args.histories, 1);
  const overrides = overridesFrom(args);
  const out = resolve(args.out);
  if (existsSync(out)) throw new Error(`refusing to overwrite existing file: ${out}`);

  const result = runAll(seed, histories, overrides);
  // flag wx: the write fails if the file appeared after the check above.
  writeFileSync(out, toJson(result), { flag: "wx" });

  const f = (x) => (x === null ? "  n/a" : x.toFixed(3));
  console.log(`wrote ${out}`);
  console.log("arm              transfer  own    total  revision  capLoss");
  for (const name of ARM_NAMES) {
    const a = result.perArm[name];
    console.log(
      `${name.padEnd(16)} ${f(a.transfer.mean)}    ${f(a.own.mean)}  ${f(a.total.mean)}  ${f(a.revision.mean)}     ${f(a.capLoss.mean)}`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
