import { bytesToHex } from 'viem'

// Linear congruential generator (Numerical Recipes constants) seeded with the
// golden-ratio word. Deterministic across runs, so the same send reserves the
// same amount twice running, and aperiodic over any length we ask it for.
const lcgSeed = 0x9e3779b9
const lcgMultiplier = 1_664_525
const lcgIncrement = 1_013_904_223

/**
 * Stand-in bytes for the serialized transaction handed to the `GasPriceOracle`
 * predeploy's `getL1Fee(bytes)`, which has to price a transaction that does not
 * exist yet — the amount being priced is itself derived from the answer.
 *
 * The bytes are deliberately incompressible. From Fjord onwards the oracle
 * charges for the FastLZ-compressed size of what it is handed, so a *periodic*
 * payload prices far below what a real transaction costs: a plain counter wraps
 * every 256 bytes and every window after the first lap is a back reference, at
 * which point the quote stops growing with size at all.
 *
 * This stream repeats no 3-byte window — FastLZ's shortest encodable match —
 * through its first 3,652 bytes, which covers every probe the callers build
 * (a 160-byte envelope plus calldata, the largest being a ~3 KB swap router
 * call). Past that the birthday bound makes isolated repeats inevitable in any
 * uniformly distributed stream, and they are harmless: a lone 3-byte match
 * costs more to encode as a back reference than it saves, so FastLZ does not
 * take it. Measured against the live oracles, this stream prices identically to
 * crypto-random bytes at 1–4 KB and 0.01% *above* them at 8–16 KB — it never
 * quotes below the incompressible ideal.
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
