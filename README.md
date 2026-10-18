# availability, not duplication

a small, frozen, fully reproducible simulation study by Neurasoft (Eternities Inc.), 2026-10-18. it asks when a shared
"stage" (one selected content made available to every faculty of a mind) beats an ordinary rival that learns whom to
ask, at the same budget. it is a toy world about mechanism. it says nothing about experience or consciousness.

## the finding

- **copying broadcast content into every faculty's memory never paid** (C: 0 of 27 conditions; it cost in 20).
- **a shared, readable, salience-selected store paid when it was large and salience was accurate** (C2: 5 of 36
  conditions, +0.05 to +0.08 in total score; it never cost). its advantage grew with the store's size and shrank with
  noisier salience.
- **selection carries the effect:** a randomly filled stage was worse than the selected one in every condition.
- **alternating two contents on the stage** (inspired by the micro-epoch alternation in Hesse et al. 2026) never helped
  and made revision after a changed fact worse in every condition of both worlds.
- against our own predictions: how much knowledge had to cross between faculties made no difference to any verdict.

## the world

12 faculties, each with a private memory of fixed slots and decaying strengths, each learning facts in its own domain.
a fraction of facts is later needed by a different faculty; nobody knows which in advance; each faculty judges a fact's
importance with noise. a life has three phases (ordinary days, a correction where facts change, a capability loss where
one faculty's memory halves). every arm gets the same budget:

- **C (copying):** the stage writes its chosen item into every faculty's memory, where it competes for slots.
- **C2 (availability):** the stage keeps chosen items in its own store of K items; any faculty can read it for one lookup
  unit. the rival gets the same K slots as extra private memory.
- in both, the rival ("local") learns which faculties answered its past lookups and asks at most 2 per query.
- references: an oracle (knows the future queries) and no sharing at all.

## how it was run

each analysis's rules, seeds, grid and code hashes were written down before it ran (`FREEZE.json`, `FREEZE-C2.json`).
two pilot worlds were tried first and are kept (`smoke-1.json`, `smoke-2.json`): the first let the rival bank unlimited
lookups (it beat the oracle) and evicted the alternating stage's writes on arrival; the second fixed both. those fixes
shaped the world, not the rules. a verdict per condition: PAYS (mean contrast >= +0.05, 95% CI above 0), COSTS (<= -0.05,
CI below 0), else NEUTRAL; contrasts are paired by simulated life (100 per condition).

## reproduce

node 24, no dependencies.

```
node --test test/*.test.mjs
node src/grid.mjs --seed 30000 --histories 100 --out grid.json        # C, ~2 min
node src/analyze_c.mjs grid.json analysis.json
node src/grid_c2.mjs --seed 40000 --histories 100 --out grid-c2.json  # C2
node src/analyze_c2.mjs grid-c2.json analysis-c2.json
```

`RESULT.md` and `RESULT-C2.md` give every cell's verdict, negatives first. MIT license.
