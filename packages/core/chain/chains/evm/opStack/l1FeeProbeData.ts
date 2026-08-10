import { bytesToHex } from 'viem'

// Xorshift-free linear congruential generator (Numerical Recipes constants),
// seeded with the golden-ratio word. Deterministic across runs, which keeps the
// reserve reproducible, and non-repeating over any length we ask it for.
const lcgSeed = 0x9e3779b9
const lcgMultiplier = 1_664_525
const lcgIncrement = 1_013_904_223

/**
 * Stand-in bytes for the serialized transaction handed to the `GasPriceOracle`
 * predeploy's `getL1Fee(bytes)`, which has to price a transaction that does not
 * exist yet — the amount being priced is itself derived from the answer.
 *
 * The bytes are deliberately incompressible. From Fjord onwards the oracle
 * charges for the FastLZ-compressed size of what it is handed, so any repeating
 * pattern prices below what a real transaction costs: a plain counter wraps
 * every 256 bytes and the repeat compresses away, halving the reserve on a long
 * payload. This stream repeats no 3-byte window, which is the shortest match
 * FastLZ can encode.
 */
export const l1FeeProbeData = (size: number): `0x${string}` => {
  const bytes = new Uint8Array(Math.max(0, size))

  let state = lcgSeed
  for (let i = 0; i < bytes.length; i++) {
    state = (Math.imul(state, lcgMultiplier) + lcgIncrement) >>> 0
    bytes[i] = (state >>> 24) & 0xff
  }

  return bytesToHex(bytes)
}
