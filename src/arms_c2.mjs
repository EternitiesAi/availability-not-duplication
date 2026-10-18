// packet C2: availability without copying. the stage arms keep the revision-2 world (12 faculties, private
// slots, learned-directory lookups, LOOKUP_CAP asks per query). they add a shared stage store of K items that
// no faculty copies from. this file imports Memory and HALF_RATE from arms.mjs and does not change them.
import { FACULTIES, TICKS, DECAY, BUDGET, LOOKUP_CAP, visibleQueries } from "./world.mjs";
import { mulberry32, streamSeed } from "./rng.mjs";
import { Memory, HALF_RATE } from "./arms.mjs";

export const ARM_C2 = ["stage_single", "stage_temporal", "stage_random", "local_plus", "oracle_stage", "none"];
const STAGE_ARMS = new Set(["stage_single", "stage_temporal", "stage_random", "oracle_stage"]);
const LOOKUP_ARMS = new Set(ARM_C2.filter((n) => n !== "none"));

function groupByTick(list) {
  const out = Array.from({ length: TICKS }, () => []);
  for (const e of list) out[e.tick].push(e);
  return out;
}

// the local directory, copied from arms.mjs: other faculties, most past successful answers first, ties by index.
function rankSources(counts, asker) {
  const others = [];
  for (let f = 0; f < FACULTIES; f++) if (f !== asker) others.push(f);
  return others.sort((a, b) => counts[b] - counts[a] || a - b);
}

// the soonest-queried arrival of each tick (the oracle's choice), as in arms.mjs.
function oracleSchedule(life) {
  const qByKey = new Map(life.queries.map((q) => [q.key, q]));
  const at = new Array(TICKS).fill(null);
  for (const a of life.arrivals) {
    const q = qByKey.get(a.key);
    if (!q || q.truth !== a.value || q.tick <= a.tick) continue;
    if (at[a.tick] === null || q.tick < at[a.tick].q.tick) at[a.tick] = { a, q };
  }
  return at.map((x) => (x ? { key: x.a.key, value: x.a.value } : null));
}

function bidsSorted(list) {
  return [...list].sort((a, b) => b.salience - a.salience);
}

// one run of one arm. K is the extra memory: the stage store's size for the stage arms, or K/12 extra
// private slots per faculty for local_plus. returns:
//   answers[n]     the value returned for query n, or null
//   trace[n]       asks spent on query n (stage read and directory asks together) and where the hit came from:
//                  a faculty index, -2 for the stage, -1 for none
//   maxBank        the largest lookup bank seen
//   facultyKeys    the keys each faculty holds at snapshotTick (end of that tick), so the audit can see
//                  live entries; entries are gone after about 200 ticks, so the end state would be empty
//   facultySlots   each faculty's slot count at the end
export function runArmC2(life, name, { K = 0, snapshotTick = TICKS - 1 } = {}) {
  if (!ARM_C2.includes(name)) throw new Error(`unknown arm: ${name}`);
  if (!Number.isInteger(K) || K < 0) throw new Error(`K must be an integer >= 0: ${K}`);
  if (name === "local_plus" && K % 12 !== 0) throw new Error("local_plus needs K divisible by 12");

  const P = life.params;
  const extra = name === "local_plus" ? K / 12 : 0;
  const mems = Array.from({ length: FACULTIES }, () => new Memory(P.slots + extra));
  // with K = 0 there is no stage at all: no store, no stage read. that is what makes it local_only.
  const stage = STAGE_ARMS.has(name) && K > 0 ? new Memory(K) : null;
  const lookups = LOOKUP_ARMS.has(name);
  const byTick = groupByTick(life.arrivals);
  const qByTick = groupByTick(visibleQueries(life));
  const oracleAt = name === "oracle_stage" && K > 0 ? oracleSchedule(life) : null;
  const rng = mulberry32(streamSeed(life.seed, "random_stage"));
  const latest = new Map();
  const dir = Array.from({ length: FACULTIES }, () => new Array(FACULTIES).fill(0));
  const answers = new Array(life.queries.length).fill(null);
  const trace = new Array(life.queries.length).fill(null);
  let bank = 0;
  let maxBank = 0;
  let recent = null;
  let facultyKeys = null;

  for (let t = 0; t < TICKS; t++) {
    if (t === life.capLoss.fromTick) {
      const f = mems[life.capLoss.faculty];
      f.setSlots(Math.floor(f.slots / 2));
    }
    if (lookups) {
      bank = Math.min(bank + BUDGET, LOOKUP_CAP);
      maxBank = Math.max(maxBank, bank);
    }

    // own observations are the only writes into faculty memory.
    for (const a of byTick[t]) {
      latest.set(a.key, a.value);
      mems[a.observer].setPrimary(a.key, a.value, 1, DECAY);
    }
    if (byTick[t].length) recent = byTick[t];

    // the stage writes into its own store only. the store is never read into a faculty.
    if (stage) {
      if (name === "stage_single") {
        const bids = bidsSorted(byTick[t]);
        if (bids.length) stage.setPrimary(bids[0].key, bids[0].value, 1, DECAY);
      } else if (name === "stage_temporal") {
        const bids = bidsSorted(byTick[t]).slice(0, 2);
        const gainIdx = bids.length === 2 ? t % 2 : 0;
        bids.forEach((b, i) => {
          if (i === gainIdx) stage.setPrimary(b.key, b.value, 1, HALF_RATE);
          else stage.setAlt(b.key, b.value, 1, HALF_RATE);
        });
      } else if (name === "stage_random") {
        const r = rng();
        const pool = byTick[t].length ? byTick[t] : recent ? [recent[recent.length - 1]] : [];
        if (pool.length) {
          const pick = pool[Math.floor(r * pool.length)];
          stage.setPrimary(pick.key, pick.value, 1, DECAY);
        }
      } else if (name === "oracle_stage") {
        const w = oracleAt[t];
        if (w) stage.setPrimary(w.key, w.value, 1, DECAY);
      }
    }

    for (const q of qByTick[t]) {
      let ans = mems[q.asker].lookup(q.key);
      const tr = { asks: 0, hitFrom: -1 };
      if (ans === null && lookups) {
        // a stage read costs one unit and comes first. at most LOOKUP_CAP asks per query in all.
        if (stage && bank >= 1) {
          bank -= 1;
          tr.asks += 1;
          const v = stage.lookup(q.key);
          if (v !== null && v === latest.get(q.key)) {
            ans = v;
            tr.hitFrom = -2;
          }
        }
        if (ans === null) {
          const ranked = rankSources(dir[q.asker], q.asker).slice(0, LOOKUP_CAP - tr.asks);
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
      }
      answers[q.n] = ans;
      trace[q.n] = tr;
    }

    if (t === snapshotTick) facultyKeys = mems.map((m) => m.items.map((i) => i.key));

    for (const m of mems) m.decay();
    if (stage) stage.decay();
  }
  return {
    answers,
    trace,
    maxBank,
    facultyKeys,
    facultySlots: mems.map((m) => m.slots),
  };
}
