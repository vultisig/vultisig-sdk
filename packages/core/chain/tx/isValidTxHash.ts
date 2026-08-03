import { Chain } from '../Chain'
import { ChainKind, getChainKind } from '../ChainKind'

// Per-chain-kind transaction-hash shape checks. Deliberately conservative: the
// goal is to reject obviously-malformed input (e.g. `nothash`, a truncated hex
// string) *before* any RPC call, not to guarantee the hash exists on-chain.
// Bounds are kept loose enough to admit every well-formed hash the SDK emits.
const HEX_64 = /^[0-9a-fA-F]{64}$/
const HEX_64_PREFIXED = /^0x[0-9a-fA-F]{64}$/
// Base58 alphabet (Bitcoin/IPFS style: excludes 0, O, I, l).
const base58 = (min: number, max: number) => new RegExp(`^[1-9A-HJ-NP-Za-km-z]{${min},${max}}$`)
// TON message hashes are 32 bytes, surfaced as hex or (url-safe) base64.
const TON_BASE64 = /^[A-Za-z0-9+/_-]{43,44}={0,2}$/

const validators: Record<ChainKind, (hash: string) => boolean> = {
  evm: h => HEX_64_PREFIXED.test(h),
  polkadot: h => HEX_64_PREFIXED.test(h),
  bittensor: h => HEX_64_PREFIXED.test(h),
  utxo: h => HEX_64.test(h),
  cosmos: h => HEX_64.test(h),
  ripple: h => HEX_64.test(h),
  tron: h => HEX_64.test(h),
  cardano: h => HEX_64.test(h),
  qbtc: h => HEX_64.test(h),
  // base58-encoded 32-byte digest (~43-44 chars).
  sui: h => base58(40, 48).test(h),
  // base58-encoded 64-byte signature (~87-88 chars).
  solana: h => base58(80, 90).test(h),
  ton: h => HEX_64.test(h) || TON_BASE64.test(h),
}

/**
 * True when `hash` is a plausibly-well-formed transaction hash for `chain`'s
 * chain-kind. A cheap pre-RPC guard — a `false` here means the input is
 * malformed (reject it), a `true` does NOT imply the tx exists.
 */
export function isValidTxHash(chain: Chain, hash: string): boolean {
  if (typeof hash !== 'string') return false
  const trimmed = hash.trim()
  if (trimmed.length === 0) return false
  return validators[getChainKind(chain)](trimmed)
}
