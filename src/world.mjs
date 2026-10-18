// deterministic life generator (DECISION.md revision 1). one life = one seed.
// arms see only the visible view (no usefulness, no truth, no query schedule). the oracle is the
// only arm that reads the query schedule.
import { mulberry32, streamSeed } from "./rng.mjs";

export const FACULTIES = 12; // revision 2: finding who knows a fact is a real problem at 12
export const DAYS_PER_PHASE = 7;
export const TICKS_PER_DAY = 24;
export const PHASES = 3;
export const PHASE_TICKS = DAYS_PER_PHASE * TICKS_PER_DAY; // 168
export const TICKS = PHASES * PHASE_TICKS; // 504

// the life's schedule. ticks are hours; phase 2 holds the correction, phase 3 the capability loss.
export const CORRECTION_FROM = PHASE_TICKS; // phase 2 starts at tick 168
export const CORRECTION_TO = 2 * PHASE_TICKS - 1; // last tick of phase 2
export const CAP_LOSS_FROM = 2 * PHASE_TICKS; // phase 3 starts at tick 336

export const FACT_RATE = 0.5; // chance a faculty observes one fact on a tick
export const QUERY_RATE = 0.12; // chance an observed fact is useful, i.e. later queried
export const CROSS = 0.25; // share of queried facts asked by a different faculty
export const CORRECTION_RATE = 0.3; // share of queried facts whose value is corrected in phase 2
export const SALIENCE_NOISE = 0.6; // half-width of the uniform noise on a 0..1 salience
export const LATE_QUERY_SHARE = 0.6; // share of queries drawn from phases 2-3 (the rest are soon after)
export const SOON_WINDOW = 48; // a soon query lands within this many ticks of its earliest use

export const SLOTS = 40; // per-faculty memory slots
export const DECAY = 0.005; // strength lost per tick by a full-retention item
export const BUDGET = 1; // shared bandwidth units per tick
export const LOOKUP_CAP = 2; // local_only: bank carry-over cap, and the most asks one query may spend

// arms get queries without truth, cross or revision flags.
export function visibleQueries(life) {
  return life.queries.map((q) => ({ n: q.n, tick: q.tick, asker: q.asker, key: q.key }));
}

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// the three overridable parameters, with the module defaults. overrides are passed as values, never
// by mutating the constants above, so a default run and an override run can share a process.
export function resolveParams(overrides = {}) {
  const p = {
    slots: overrides.slots ?? SLOTS,
    cross: overrides.cross ?? CROSS,
    noise: overrides.noise ?? SALIENCE_NOISE,
  };
  if (!Number.isInteger(p.slots) || p.slots < 1) throw new Error(`slots must be an integer >= 1: ${p.slots}`);
  if (!(p.cross >= 0 && p.cross <= 1)) throw new Error(`cross must be in [0,1]: ${p.cross}`);
  if (!(p.noise >= 0)) throw new Error(`noise must be >= 0: ${p.noise}`);
  return p;
}

// one life. events are built in creation order and then stably sorted by tick, so the same seed
// and parameters always yield the same arrays. the resolved parameters ride on the life.
export function generateLife(seed, overrides = {}) {
  const params = resolveParams(overrides);
  const rng = mulberry32(streamSeed(seed, "life"));
  const events = [];
  const facts = [];
  let factIndex = 0;

  const salienceOf = (usefulness) => clamp01(usefulness + (2 * rng() - 1) * params.noise);

  for (let t = 0; t < TICKS; t++) {
    for (let f = 0; f < FACULTIES; f++) {
      if (rng() >= FACT_RATE) continue;
      const queried = rng() < QUERY_RATE;
      const usefulness = queried ? 0.5 + 0.5 * rng() : 0.5 * rng();
      const fact = {
        key: `${seed}:${factIndex++}`,
        observer: f,
        tick: t,
        value: Math.floor(rng() * 10000),
        queried,
        correctedAt: null,
        newValue: null,
      };
      facts.push(fact);
      events.push({ tick: t, observer: f, key: fact.key, value: fact.value, salience: salienceOf(usefulness), kind: "fact" });
    }
  }

  // corrections: a queried fact observed before the correction window may change value in phase 2.
  // the change is itself an observed event at the observer, so every arm can see it.
  for (const fact of facts) {
    if (!fact.queried || fact.tick >= CORRECTION_TO) continue;
    if (rng() >= CORRECTION_RATE) continue;
    const lo = Math.max(CORRECTION_FROM, fact.tick + 1);
    const tc = lo + Math.floor(rng() * (CORRECTION_TO - lo + 1));
    fact.correctedAt = tc;
    fact.newValue = (fact.value + 1 + Math.floor(rng() * 9998)) % 10000;
    events.push({
      tick: tc,
      observer: fact.observer,
      key: fact.key,
      value: fact.newValue,
      salience: salienceOf(0.5 + 0.5 * rng()),
      kind: "correction",
    });
  }

  // queries: each queried fact is asked once, after it is known (and after its correction, if any).
  // a cross query is asked of a different faculty than the observer.
  const queries = [];
  for (const fact of facts) {
    if (!fact.queried) continue;
    const cross = rng() < params.cross;
    let asker = fact.observer;
    if (cross) {
      asker = (fact.observer + 1 + Math.floor(rng() * (FACULTIES - 1))) % FACULTIES;
    }
    const lb = (fact.correctedAt ?? fact.tick) + 1;
    if (lb > TICKS - 1) continue;
    let tick;
    const lo = Math.max(lb, PHASE_TICKS);
    if (rng() < LATE_QUERY_SHARE && lo <= TICKS - 1) {
      tick = lo + Math.floor(rng() * (TICKS - lo));
    } else {
      const hi = Math.min(lb + SOON_WINDOW - 1, TICKS - 1);
      tick = lb + Math.floor(rng() * (hi - lb + 1));
    }
    const corrected = fact.correctedAt !== null;
    queries.push({
      tick,
      asker,
      key: fact.key,
      truth: corrected ? fact.newValue : fact.value,
      cross,
      revision: corrected,
      observer: fact.observer,
    });
  }

  const capLoss = { faculty: Math.floor(rng() * FACULTIES), fromTick: CAP_LOSS_FROM, slots: Math.floor(params.slots / 2) };

  // stable sort: same-tick events keep creation order, which is seeded.
  events.sort((a, b) => a.tick - b.tick);
  queries.sort((a, b) => a.tick - b.tick);
  queries.forEach((q, n) => (q.n = n));

  return { seed, params, arrivals: events, queries, capLoss };
}
