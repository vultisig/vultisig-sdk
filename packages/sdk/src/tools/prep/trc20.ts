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

  const amountBig = BigInt(amount)
  if (amountBig <= 0n) {
    throw new Error(`prepareTrc20TransferFromKeys: amount must be greater than zero, got ${amount}`)
  }

  // ABI-encode transfer(address,uint256): recipient word || amount word.
  const parameter = encodeTrc20TransferParam(to, amount)

  return {
    chain: 'Tron',
    action: 'transfer',
    signingMode: 'ecdsa_secp256k1',
    ownerAddress: from,
    contractAddress,
    toAddress: to,
    functionSelector: TRC20_TRANSFER_SELECTOR,
    parameter,
    feeLimitSun: feeLimitSun ?? DEFAULT_FEE_LIMIT_SUN,
    amount,
    ...(memo ? { memo } : {}),
  }
}
