# C: result (2026-10-18). in this world the stage never pays

frozen at c0becfe (FREEZE.json). grid `grid-30000.json`, 27 cells x 100 histories; the frozen paired contrasts in
`analysis-30000.json` (`src/analyze_c.mjs` re-ran every cell exactly and checked each arm's mean against the grid).

## the verdicts by the frozen rule (PAYS: contrast >= +0.05 with CI > 0; COSTS: <= -0.05 with CI < 0)

| | PAYS | NEUTRAL | COSTS |
|---|---|---|---|
| single winner vs local only | 0 | 7 | 20 |
| temporal selection vs local only | 0 | 4 | 23 |

- **no cell, no arm: a shared stage never beats the ordinary rival** that learns whom to ask, at matched bandwidth. the
  best cells (memory 80 slots, accurate salience) reach +0.03 for the single winner, inside NEUTRAL.
- the 9 cells with 20 slots are UNINFORMATIVE (their ceiling, oracle minus none, is under 0.05): memory there is too scarce
  for any sharing to show. even setting them aside, the stage COSTS in 11 of the 18 informative cells (single winner) and
  in 14 (temporal).

## the predictions, checked

- "stage arms pay only with ample memory, high crossing and accurate salience": **the direction holds, the payoff does
  not.** the stage does best with ample memory and accurate salience, but never reaches +0.05. **crossing barely matters**
  (within 0.01 across 0.10-0.50), against the prediction: the score weights transfer and own accuracy equally, and the
  stage's cost to own memory dominates.
- "temporal beats single winner on revision": **falsified.** temporal is worse on revision in all 27 cells (-0.01 to
  -0.09). keeping the alternative represented at half retention did not help when a fact changed; it cost memory.
- selection matters: a random stage is worse than the salience-chosen one in every cell (-0.02 to -0.13). so what the
  stage carries is not nothing; it is outweighed.

## what it means, and what it does not

- in a world where a broadcast must be written into every receiver's memory, availability costs more than it gives, and
  a faculty that learns whom to ask wins. the Tsao-style alternation, as built here, is the worse of the two stages.
- this is one toy world. the defining choice is that broadcast content occupies receivers' memory. a world where the
  stage holds content that every faculty can read without storing it (availability without copying) is a different
  theory claim and a new freeze; it is not tested here.
- nothing here is about experience, luna or any live system. the negatives are kept, as the house keeps them.
