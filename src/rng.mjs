// all randomness in this packet goes through here. no Math.random anywhere.
import { createHash } from "node:crypto";

// mulberry32: small seeded prng, floats in [0,1).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// separate streams per purpose, so adding a history or a bootstrap draw does not shift the lives.
export function streamSeed(seed, label) {
  return createHash("sha256").update(`${seed}:${label}`).digest().readUInt32BE(0);
}
