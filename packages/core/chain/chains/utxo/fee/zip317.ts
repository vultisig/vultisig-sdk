import { bigIntMax } from '@vultisig/lib-utils/bigint/bigIntMax'
import { bigIntSum } from '@vultisig/lib-utils/bigint/bigIntSum'

/**
 * ZIP-317 conventional fee for a transparent-only Zcash transaction.
 * Nodes relay zero "unpaid actions" by default, so any tx paying less is
 * rejected at broadcast with "tx unpaid action limit exceeded".
 * Canonical implementation — consumers (extension dApp guard, SDK send
 * builder) should derive their floors from here.
 * https://zips.z.cash/zip-0317
 */
export const zcashMarginalFee = 5000n
export const zcashGraceActions = 2n
/** Serialized size of a signed transparent P2PKH input (ZIP-317 §3.1). */
const p2pkhInputSize = 148n
const inputActionSize = 150n
const outputActionSize = 34n
/** Serialized tx_out size of a P2PKH output: 8 value + 1 scriptLen + 25 script. */
const p2pkhOutputSize = 34n

type CeilDivInput = {
  value: bigint
  divisor: bigint
}

/** Ceiling division for bigints: smallest n such that n * divisor >= value. */
export const ceilDiv = ({ value, divisor }: CeilDivInput): bigint => (value + divisor - 1n) / divisor

type GetZcashConventionalFeeInput = {
  /** Transparent P2PKH inputs; sized at 148 bytes each per ZIP-317. */
  inputCount: number
  /** Serialized size of each tx_out in bytes (value + script length + script). */
  outputSizes: bigint[]
}

/**
 * Minimum fee the Zcash network relays for a transparent tx of the given
 * shape: 5,000 zats per logical action with a two-action grace window, where
 * logical actions = max(ceil(tx_in bytes / 150), ceil(tx_out bytes / 34)).
 */
export const getZcashConventionalFee = ({ inputCount, outputSizes }: GetZcashConventionalFeeInput): bigint => {
  const inputActions = ceilDiv({
    value: BigInt(inputCount) * p2pkhInputSize,
    divisor: inputActionSize,
  })
  const outputActions = ceilDiv({
    value: bigIntSum(outputSizes),
    divisor: outputActionSize,
  })
  const logicalActions = bigIntMax(inputActions, outputActions)

  return zcashMarginalFee * bigIntMax(zcashGraceActions, logicalActions)
}

/**
 * Serialized tx_out size of an OP_RETURN output carrying `memo`:
 * 8 value + scriptLen CompactSize + script (OP_RETURN + push opcode(s) + data).
 * WalletCore's planner sizes this output as a flat ~34 bytes regardless of
 * memo length, so longer memos make its plan undercount ZIP-317 actions.
 * Models the push-opcode (direct / PUSHDATA1 / PUSHDATA2 / PUSHDATA4) and the
 * script-length CompactSize so long memos are not undercharged.
 */
export const getZcashOpReturnOutputSize = (memo: string): bigint => {
  const dataSize = BigInt(new TextEncoder().encode(memo).length)

  // OP_RETURN (1 byte) + push opcode bytes for `dataSize`.
  const pushOverhead = dataSize <= 75n ? 2n : dataSize <= 0xffn ? 3n : dataSize <= 0xffffn ? 4n : 6n
  const scriptSize = pushOverhead + dataSize

  // CompactSize encoding of the script length prefix.
  const scriptLengthSize = scriptSize < 0xfdn ? 1n : scriptSize <= 0xffffn ? 3n : scriptSize <= 0xffffffffn ? 5n : 9n

  return 8n + scriptLengthSize + scriptSize
}

type GetZcashTransparentOutputSizesInput = {
  /** Change amount; a second P2PKH output is only present when this is positive. */
  change: bigint
  /** OP_RETURN memo, if any. */
  memo: string | undefined
}

/**
 * Serialized tx_out sizes for a transparent Zcash send: recipient P2PKH,
 * optional change P2PKH, and an optional OP_RETURN memo. Feed into
 * {@link getZcashConventionalFee} to size the conventional fee by real bytes.
 */
export const getZcashTransparentOutputSizes = ({ change, memo }: GetZcashTransparentOutputSizesInput): bigint[] => {
  const sizes = [p2pkhOutputSize]
  if (change > 0n) sizes.push(p2pkhOutputSize)
  if (memo) sizes.push(getZcashOpReturnOutputSize(memo))

  return sizes
}
