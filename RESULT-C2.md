# C2: result (2026-10-18). a shared selected stage pays, when it is big and salience is good

frozen at 07696e2 (FREEZE-C2.json). grid `grid-c2-40000.json` (36 cells x 100 histories, per-history scores stored);
paired contrasts in `analysis-c2-40000.json` (`src/analyze_c2.mjs`). no cell is UNINFORMATIVE (ceilings 0.085-0.205).

## the verdicts by the frozen rule

| | PAYS | NEUTRAL | COSTS |
|---|---|---|---|
| stage (single winner) vs local plus | 5 | 31 | 0 |
| stage (temporal) vs local plus | 0 | 36 | 0 |

- **the selected shared stage pays in 5 of 36 cells, all with the largest stage (K = 48) and accurate salience** (noise
  0.3 in four, 0.6 in one), by +0.051 to +0.078 in total score. it never costs. its advantage grows with the stage's size
  (K 12: -0.017 to +0.009; K 24: up to +0.032; K 48: up to +0.078) and shrinks as salience gets noisy.
- **the temporal stage never pays** and sits below the single winner everywhere; on revision it is worse or equal in
  every cell (-0.027 to +0.003).
- **selection carries the effect:** a random stage is worse than the selected one in all 36 cells (-0.006 to -0.084).

## the predictions, checked

- "the selected stage pays with accurate salience and high crossing": **half right.** it pays with accurate salience, but
  only when the stage is large, and **crossing does not matter** (0.25 and 0.50 give the same verdicts), as in packet C.
- "private slots win with noisy salience": **mostly right in direction, not in verdict.** at noise 0.9 the stage is
  NEUTRAL (+0.003 to +0.027 at K 24-48), never COSTS.
- "temporal does not beat single on revision": **held** (36/36).

## what packets C and C2 say together

- copying broadcast content into every faculty never pays (packet C, 0/27). holding it in a shared, readable store pays
  when the store is big enough and the choice of what goes in is good (C2, 5/36). availability helps; duplication does not.
- the Tsao-style alternation, as built in both worlds, never helps and costs revision.
- toy worlds, one design each. nothing about experience, luna or any live system. all negatives kept.
