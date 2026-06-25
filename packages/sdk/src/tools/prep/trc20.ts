import { encodeTrc20TransferParam, tronBase58ToEvmHex } from '../../abi/tron'

/**
 * `transfer(address,uint256)` — the TRC-20 transfer function signature. The
 * on-device signer hashes this string itself (keccak256 → 4-byte selector) and
 * ABI-concatenates it with `parameter`, so we emit the SIGNATURE STRING here,
 * NOT the pre-hashed 4-byte selector.
 */
export const TRC20_TRANSFER_SELECTOR = 'transfer(address,uint256)' as const

export type PrepareTrc20TransferFromKeysParams = {
  /** TRC-20 contract address (base58, T...). e.g. USDT = TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t */
  contractAddress: string
  /** Sender TRON address (base58, T...). */
  from: string
  /** Destination TRON address (base58, T...). */
  to: string
  /** Amount in token base units (integer string). */
  amount: string
  /** Optional memo (THORChain swap memo, exchange deposit memo). Maps to the TRON proto `data` field. */
  memo?: string
  /**
   * Energy/bandwidth cost ceiling for the TriggerSmartContract, in SUN.
   * Defaults to 100 TRX (100_000_000 SUN), matching the mcp-ts builder.
   */
  feeLimitSun?: string
}

/**
 * An unsigned TRC-20 transfer descriptor. Pure calldata — the on-device signer
 * fills in the chain-specific fields (block header, ref-block, expiration, gas)
 * at signing time and produces the TransferTRC20Contract / TriggerSmartContract.
 *
 * This object carries NO signing material and NO network state.
 */
export type UnsignedTrc20Transfer = {
  chain: 'Tron'
  action: 'transfer'
  signingMode: 'ecdsa_secp256k1'
  /** Sender (owner) base58 address. */
  ownerAddress: string
  /** TRC-20 contract base58 address. */
  contractAddress: string
  /** Recipient base58 address. */
  toAddress: string
  /** `transfer(address,uint256)` signature string (client hashes it). */
  functionSelector: typeof TRC20_TRANSFER_SELECTOR
  /** ABI-encoded params: 32-byte recipient word || 32-byte amount word (128 hex chars, no 0x, no selector). */
  parameter: string
  /** Energy/bandwidth ceiling in SUN. */
  feeLimitSun: string
  /** Amount in token base units. */
  amount: string
  /** Optional memo (maps to proto `data`). */
  memo?: string
}

const DEFAULT_FEE_LIMIT_SUN = '100000000' // 100 TRX

/**
 * Vault-free, pure-crypto builder for an unsigned TRON TRC-20 transfer.
 *
 * Ported from the mcp-ts `build_trc20_transfer` tool so the SDK is the single
 * source of truth for TRC-20 calldata. It ABI-encodes `transfer(address,uint256)`
 * and returns an {@link UnsignedTrc20Transfer} descriptor. It NEVER signs and
 * NEVER broadcasts — `vault.sign` stays on-device; the signer fills in the live
 * chain-specific fields and produces the final TransferTRC20Contract.
 *
 * Unlike `prepareSendTxFromKeys`, this requires NO vault identity and NO RPC: a
 * TRC-20 `parameter` is a deterministic function of `(to, amount)` alone. The
 * recipient/contract/owner addresses are validated as TRON base58check (a bad
 * checksum throws rather than silently misrouting funds).
 *
 * @example
 * ```ts
 * const tx = prepareTrc20TransferFromKeys({
 *   contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', // USDT
 *   from: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
 *   to: 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH',
 *   amount: '1000000', // 1 USDT (6 decimals)
 * })
 * // tx.parameter → 64-char recipient word + 64-char amount word
 * ```
 */
export const prepareTrc20TransferFromKeys = (params: PrepareTrc20TransferFromKeysParams): UnsignedTrc20Transfer => {
  const { contractAddress, from, to, amount, memo, feeLimitSun } = params

  // Validate every address as TRON base58check up-front (throws on bad
  // checksum / wrong prefix / wrong length). This is the fund-safety gate:
  // a typoed-but-decodable address must surface as an error, not a misroute.
  tronBase58ToEvmHex(contractAddress)
  tronBase58ToEvmHex(from)
  // encodeTrc20TransferParam re-validates `to` via tronBase58ToEvmHex.

  // Fund-safety / WYSIWYS: `amount` MUST be a plain non-negative decimal
  // integer string. `BigInt()` is far too permissive for a value-bearing
  // field — it happily parses "0x10" (→16), "0b1010" (→10), "0o17" (→15),
  // "+1000" and whitespace-padded " 1000000 ". Each of those would encode a
  // DIFFERENT (or confusingly-represented) base-unit amount while the raw,
  // un-normalized string leaked into `tx.amount`, so a confirm UI bound to
  // `tx.amount` could display one thing while the calldata moves another.
  // Reject anything that isn't `^[0-9]+$` and echo the CANONICAL decimal of
  // exactly what we encoded, so displayed amount === encoded amount always.
  if (!/^[0-9]+$/.test(amount)) {
    throw new Error(
      `prepareTrc20TransferFromKeys: amount must be a plain decimal integer string (base units), got ${JSON.stringify(amount)}`
    )
  }
  const amountBig = BigInt(amount)
  if (amountBig <= 0n) {
    throw new Error(`prepareTrc20TransferFromKeys: amount must be greater than zero, got ${amount}`)
  }
  const canonicalAmount = amountBig.toString()

  // feeLimitSun is the energy/bandwidth cost ceiling in SUN — it bounds how
  // much TRX the signer may burn on this trigger. It is value-adjacent, so
  // apply the same plain-decimal + positive guard (reject "0x..", "-1", "" …).
  let canonicalFeeLimit = DEFAULT_FEE_LIMIT_SUN
  if (feeLimitSun !== undefined) {
    if (!/^[0-9]+$/.test(feeLimitSun)) {
      throw new Error(
        `prepareTrc20TransferFromKeys: feeLimitSun must be a plain decimal integer string (SUN), got ${JSON.stringify(feeLimitSun)}`
      )
    }
    const feeBig = BigInt(feeLimitSun)
    if (feeBig <= 0n) {
      throw new Error(`prepareTrc20TransferFromKeys: feeLimitSun must be greater than zero, got ${feeLimitSun}`)
    }
    canonicalFeeLimit = feeBig.toString()
  }

  // ABI-encode transfer(address,uint256): recipient word || amount word.
  const parameter = encodeTrc20TransferParam(to, canonicalAmount)

  return {
    chain: 'Tron',
    action: 'transfer',
    signingMode: 'ecdsa_secp256k1',
    ownerAddress: from,
    contractAddress,
    toAddress: to,
    functionSelector: TRC20_TRANSFER_SELECTOR,
    parameter,
    feeLimitSun: canonicalFeeLimit,
    // Echo the canonical decimal (not the raw input) so the descriptor's
    // displayed amount is byte-identical to what the calldata encodes.
    amount: canonicalAmount,
    ...(memo ? { memo } : {}),
  }
}
