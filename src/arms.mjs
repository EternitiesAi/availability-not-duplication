// the arms and two references. each runs one life, tick by tick, and returns the answer to every query.
// arms read only the visible view: arrivals (with the observer's noisy salience) and queries without
// their truth. the oracle is the one exception: it reads the future queries, by design.
import { FACULTIES, TICKS, DECAY, BUDGET, LOOKUP_CAP, visibleQueries } from "./world.mjs";
import { mulberry32, streamSeed } from "./rng.mjs";

export const ARM_NAMES = ["single_winner", "temporal", "local_only", "random_stage", "oracle", "none"];
// temporal's half retention: full initial strength, twice the decay rate, so it is not evicted on arrival.
export const HALF_RATE = 2 * DECAY;

// one faculty's private memory. an entry is primary (the reading the faculty acts on) or alt (the
// other reading, kept but used only while no primary exists). every write sets the entry's strength
// and decay rate. when full, a new entry evicts the weakest (lowest current strength, then oldest).
export class Memory {
  constructor(slots) {
    this.slots = slots;
    this.items = [];
    this.seq = 0;
  }

  weakest() {
    let w = null;
    for (const it of this.items) {
      if (w === null || it.strength < w.strength || (it.strength === w.strength && it.seq < w.seq)) w = it;
    }
    return w;
  }

  insert(key, value, strength, rate, alt) {
    const item = { key, value, strength, rate, alt, seq: this.seq++ };
    if (this.items.length >= this.slots) {
      const w = this.weakest();
      if (w !== null) this.items.splice(this.items.indexOf(w), 1);
    }
    this.items.push(item);
  }

  find(key, alt) {
    return this.items.find((i) => i.key === key && i.alt === alt) ?? null;
  }

  overwrite(item, value, strength, rate) {
    item.value = value;
    item.strength = strength;
    item.rate = rate;
    item.seq = this.seq++;
  }

  // the acted-on reading (own observation, or a gain-marked stage write). replaces the primary value
  // and drops any alternative for the key, which is now superseded.
  setPrimary(key, value, strength, rate) {
    const p = this.find(key, false);
    if (p) {
      this.overwrite(p, value, strength, rate);
      this.items = this.items.filter((i) => !(i.key === key && i.alt));
      return;
    }
    this.insert(key, value, strength, rate, false);
  }

  // the other reading (a non-gain stage write). kept, not acted on.
  setAlt(key, value, strength, rate) {
    const a = this.find(key, true);
    if (a) this.overwrite(a, value, strength, rate);
    else this.insert(key, value, strength, rate, true);
  }

  lookup(key) {
    const p = this.find(key, false) ?? this.find(key, true);
    return p ? p.value : null;
  }

  decay() {
    for (const it of this.items) it.strength -= it.rate;
    this.items = this.items.filter((it) => it.strength > 1e-9);
  }

  setSlots(n) {
    this.slots = n;
    while (this.items.length > n) {
      const w = this.weakest();
      this.items.splice(this.items.indexOf(w), 1);
    }
  }
}

function groupByTick(list) {
  const out = Array.from({ length: TICKS }, () => []);
  for (const e of list) out[e.tick].push(e);
  return out;
}

// the oracle writes, each tick, the arrival whose current value is queried soonest after it. a
// selection ceiling on the same one-write channel, not an absolute ceiling (eviction still applies).
function oracleSchedule(life) {
  const qByKey = new Map(life.queries.map((q) => [q.key, q]));
  const at = new Array(TICKS).fill(null);
  for (const a of life.arrivals) {
    const q = qByKey.get(a.key);
    if (!q || q.truth !== a.value || q.tick <= a.tick) continue;
    if (at[a.tick] === null || q.tick < at[a.tick].q.tick) at[a.tick] = { a, q };
  }
  return at.map((x) => (x ? { key: x.a.key, value: x.a.value, strength: 1, rate: DECAY, gain: true } : null));
}

function bidsSorted(list) {
  // stable sort: equal salience keeps creation order, so the seeded life decides ties.
  return [...list].sort((a, b) => b.salience - a.salience);
}

// stage writes for one tick. each spec is written to every faculty.
function stageWrites(name, t, ctx) {
  if (name === "single_winner") {
    const bids = bidsSorted(ctx.byTick[t]);
    if (!bids.length) return [];
    const b = bids[0];
    return [{ key: b.key, value: b.value, strength: 1, rate: DECAY, gain: true, fromSeed: ctx.seed }];
  }
  if (name === "temporal") {
    // the top two bids alternate on the stage. both are written at full strength with half retention
    // (twice the decay). the gain marker sits on the top bid on even ticks and on the second on odd
    // ticks; with one bid, it always holds.
    const bids = bidsSorted(ctx.byTick[t]).slice(0, 2);
    const gainIdx = bids.length === 2 ? t % 2 : 0;
    return bids.map((b, i) => ({
      key: b.key,
      value: b.value,
      strength: 1,
      rate: HALF_RATE,
      gain: i === gainIdx,
      fromSeed: ctx.seed,
    }));
  }
  if (name === "random_stage") {
    // availability without selection: one arrival, drawn uniformly. the draw is consumed every tick,
    // so the stream does not depend on whether the tick had arrivals. salience is never read.
    const r = ctx.rng();
    const pool = ctx.byTick[t].length ? ctx.byTick[t] : ctx.recent ? [ctx.recent[ctx.recent.length - 1]] : [];
    if (!pool.length) return [];
    const pick = pool[Math.floor(r * pool.length)];
    return [{ key: pick.key, value: pick.value, strength: 1, rate: DECAY, gain: true, fromSeed: ctx.seed }];
  }
  if (name === "oracle") {
    const w = ctx.oracleAt[t];
    return w ? [{ ...w, fromSeed: ctx.seed }] : [];
  }
  return [];
}

// the local arm's directory: other faculties, most past successful answers first, ties by index.
function rankSources(counts, asker) {
  const others = [];
  for (let f = 0; f < FACULTIES; f++) if (f !== asker) others.push(f);
  return others.sort((a, b) => counts[b] - counts[a] || a - b);
}

// run one life under one arm. returns:
//   answers[n]  the value returned for query n, or null
//   stageLog    every broadcast write (for the tests and the audit)
//   trace[n]    local_only only: asks spent on query n, and the faculty that answered (-1 if none)
//   maxBank     local_only only: the largest lookup bank seen
export function runArm(life, name) {
  if (!ARM_NAMES.includes(name)) throw new Error(`unknown arm: ${name}`);
  const mems = Array.from({ length: FACULTIES }, () => new Memory(life.params.slots));
  const byTick = groupByTick(life.arrivals);
  const qByTick = groupByTick(visibleQueries(life));
  const ctx = {
    seed: life.seed,
    byTick,
    recent: null,
    rng: mulberry32(streamSeed(life.seed, "random_stage")),
    oracleAt: name === "oracle" ? oracleSchedule(life) : null,
  };
  const latest = new Map(); // the newest value observed for each key so far: what "non-stale" means
  const dir = Array.from({ length: FACULTIES }, () => new Array(FACULTIES).fill(0));
  const answers = new Array(life.queries.length).fill(null);
  const trace = new Array(life.queries.length).fill(null);
  const stageLog = [];
  let bank = 0;
  let maxBank = 0;

  for (let t = 0; t < TICKS; t++) {
    if (t === life.capLoss.fromTick) mems[life.capLoss.faculty].setSlots(life.capLoss.slots);
    if (name === "local_only") {
      bank = Math.min(bank + BUDGET, LOOKUP_CAP);
      maxBank = Math.max(maxBank, bank);
    }

    for (const a of byTick[t]) {
      latest.set(a.key, a.value);
      mems[a.observer].setPrimary(a.key, a.value, 1, DECAY);
    }
    if (byTick[t].length) ctx.recent = byTick[t];

    for (const w of stageWrites(name, t, ctx)) {
      stageLog.push({ tick: t, key: w.key, strength: w.strength, rate: w.rate, gain: w.gain, fromSeed: w.fromSeed });
      for (const m of mems) {
        if (w.gain) m.setPrimary(w.key, w.value, w.strength, w.rate);
        else m.setAlt(w.key, w.value, w.strength, w.rate);
      }
    }

    for (const q of qByTick[t]) {
      let ans = mems[q.asker].lookup(q.key);
      const tr = { asks: 0, hitFrom: -1 };
      if (ans === null && name === "local_only") {
        // at most LOOKUP_CAP asks, to the top of the asker's directory. a hit counts only if the source
        // holds the newest value observed so far; it then strengthens that directory entry.
        const ranked = rankSources(dir[q.asker], q.asker).slice(0, LOOKUP_CAP);
        for (const src of ranked) {
          if (bank < 1) break;
          bank -= 1;
          tr.asks += 1;
          const v = mems[src].lookup(q.key);
          if (v !== null && v === latest.get(q.key)) {
            ans = v;
            tr.hitFrom = src;
            dir[q.asker][src] += 1;
            break;
          }
        }
      }
      answers[q.n] = ans;
      trace[q.n] = tr;
    }

    for (const m of mems) m.decay();
  }
  return { answers, stageLog, trace, maxBank };
}
