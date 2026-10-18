// scores an arm's answers against ground truth. labels come from the life, never from an arm.
// a metric is null when the life has no query of that kind; run.mjs leaves nulls out of the means.

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export function scoreArm(life, answers) {
  const rows = life.queries.map((q) => ({ q, ok: answers[q.n] === q.truth ? 1 : 0 }));
  const transfer = mean(rows.filter((r) => r.q.cross).map((r) => r.ok));
  const own = mean(rows.filter((r) => !r.q.cross).map((r) => r.ok));
  const revision = mean(rows.filter((r) => r.q.revision).map((r) => r.ok));
  const capLoss = mean(rows.filter((r) => r.q.tick >= life.capLoss.fromTick).map((r) => r.ok));
  return {
    transfer,
    own,
    total: transfer === null || own === null ? null : (transfer + own) / 2,
    revision,
    capLoss,
  };
}

export function lifeCounts(life) {
  const facts = life.arrivals.filter((a) => a.kind === "fact").length;
  return {
    arrivals: life.arrivals.length,
    facts,
    corrections: life.arrivals.length - facts,
    queries: life.queries.length,
    cross: life.queries.filter((q) => q.cross).length,
    revision: life.queries.filter((q) => q.revision).length,
    capLossQueries: life.queries.filter((q) => q.tick >= life.capLoss.fromTick).length,
  };
}
