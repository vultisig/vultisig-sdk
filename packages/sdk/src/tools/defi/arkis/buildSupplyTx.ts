import { encodeFunctionData, erc20Abi, getAddress, isAddress } from 'viem'

import { erc4626WriteAbi, standardAgreementWriteAbi } from './abi'
import { parseArkisTokenAmount } from './parseTokenAmount'

const MAX_UINT128 = (1n << 128n) - 1n
const MAX_UINT256 = (1n << 256n) - 1n

/** Which Arkis supply path the target pool uses. */
export type ArkisPoolKind = 'erc4626_vault' | 'agreement'

/** A single unsigned EVM transaction in the supply sequence. */
export type ArkisUnsignedTx = {
  /** Target contract for this leg. */
  to: `0x${string}`
  /** Native value — always "0" for the supply flow (ERC-20 path). */
  value: '0'
  /** ABI-encoded calldata. */
  data: `0x${string}`
  /** Semantic action: `approve` (step 1) or `deposit` (step 2). */
  action: 'approve' | 'deposit'
  /** Human-readable description of this leg. */
  description: string
}

export type BuildArkisSupplyParams = {
  /** Arkis Agreement or ERC-4626 Vault address on Ethereum. */
  poolAddress: string
  /** ERC-20 token to supply. On ERC-4626 pools this must match `pool.asset()`. */
  tokenAddress: string
  /** Sender / receiver address. Shares (4626) mint back to this address. */
  from: string
  /**
   * Which supply path the pool uses. Resolve on-chain via
   * `resolveArkisPoolKind` (reads `asset()`), or pass explicitly when known.
   */
  poolKind: ArkisPoolKind
  /** Raw base-unit amount (mutually exclusive with `amount` + `decimals`). */
  amountRaw?: bigint
  /** Human-readable amount, e.g. "1500.25" (requires `decimals`). */
  amount?: string
  /** Token decimals — required when `amount` is provided. */
  decimals?: number
  /**
   * Optional affiliate / referrer tag. Arkis supply has NO on-chain affiliate
   * slot, so this is a metadata passthrough only (echoed on the result for the
   * calling consumer). It is INJECTABLE and defaults to undefined (neutral/off)
   * — the SDK is multi-consumer and never hardcodes any consumer identity.
   */
  affiliate?: string
}

export type BuildArkisSupplyResult = {
  protocol: 'Arkis'
  chain: 'Ethereum'
  chainId: '1'
  poolKind: ArkisPoolKind
  poolAddress: `0x${string}`
  tokenAddress: `0x${string}`
  from: `0x${string}`
  receiver: `0x${string}`
  amountRaw: string
  /** Echoed affiliate tag (undefined when not supplied — neutral default). */
  affiliate?: string
  /** Two-leg unsigned sequence: [approve, deposit]. Never signed/broadcast. */
  transactions: [ArkisUnsignedTx, ArkisUnsignedTx]
  instructions: string
}

function requireAddress(label: string, value: string): `0x${string}` {
  if (!isAddress(value, { strict: false })) {
    throw new Error(`invalid "${label}" address: ${value}`)
  }
  return getAddress(value)
}

/**
 * Build the unsigned 2-step Arkis lender supply sequence (ERC-20 approve →
 * ERC-4626 / Agreement deposit) on Ethereum.
 *
 * PURE: this only encodes calldata via viem `encodeFunctionData`. It performs
 * NO network I/O and NEVER signs or broadcasts. The caller is responsible for
 * having resolved the pool kind (see `resolveArkisPoolKind`) and, for ERC-4626
 * pools, for confirming `tokenAddress === pool.asset()`.
 *
 * @example
 * ```ts
 * const built = buildArkisSupplyTx({
 *   poolKind: 'erc4626_vault',
 *   poolAddress: '0x2222…',
 *   tokenAddress: '0xA0b8…', // USDC
 *   from: '0x7099…',
 *   amount: '1500',
 *   decimals: 6,
 * })
 * // built.transactions = [approve, deposit(assets, receiver)]
 * ```
 */
export const buildArkisSupplyTx = (params: BuildArkisSupplyParams): BuildArkisSupplyResult => {
  const from = requireAddress('from', params.from)
  const poolAddress = requireAddress('pool_address', params.poolAddress)
  const tokenAddress = requireAddress('token_address', params.tokenAddress)

  let rawAmount: bigint
  if (params.amountRaw !== undefined) {
    rawAmount = params.amountRaw
  } else {
    if (params.amount === undefined || params.decimals === undefined) {
      throw new Error('provide either `amountRaw`, or both `amount` and `decimals`')
    }
    rawAmount = parseArkisTokenAmount(params.amount, params.decimals)
  }

  if (rawAmount <= 0n) throw new Error('amount must be positive')
  if (rawAmount > MAX_UINT256) throw new Error('amount overflows uint256')
  if (params.poolKind === 'agreement' && rawAmount > MAX_UINT128) {
    throw new Error('amount overflows uint128 required by the Arkis Agreement deposit path')
  }

  const approveData = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [poolAddress, rawAmount],
  })

  const depositData =
    params.poolKind === 'erc4626_vault'
      ? // receiver is fixed to `from` so the scaffold cannot mint shares to an
        // arbitrary third party.
        encodeFunctionData({
          abi: erc4626WriteAbi,
          functionName: 'deposit',
          args: [rawAmount, from],
        })
      : encodeFunctionData({
          abi: standardAgreementWriteAbi,
          functionName: 'deposit',
          args: [rawAmount],
        })

  const approveTx: ArkisUnsignedTx = {
    to: tokenAddress,
    value: '0',
    data: approveData,
    action: 'approve',
    description: 'Approve the token to the selected Arkis pool on Ethereum (step 1 of 2).',
  }

  const depositTx: ArkisUnsignedTx = {
    to: poolAddress,
    value: '0',
    data: depositData,
    action: 'deposit',
    description:
      params.poolKind === 'erc4626_vault'
        ? 'Supply into the Arkis ERC-4626 vault and mint shares back to your own address (step 2 of 2).'
        : 'Supply into the Arkis Agreement via deposit(uint128) (step 2 of 2).',
  }

  return {
    protocol: 'Arkis',
    chain: 'Ethereum',
    chainId: '1',
    poolKind: params.poolKind,
    poolAddress,
    tokenAddress,
    from,
    receiver: from,
    amountRaw: rawAmount.toString(),
    ...(params.affiliate ? { affiliate: params.affiliate } : {}),
    transactions: [approveTx, depositTx],
    instructions:
      'Two-step flow: approve the underlying token to the Arkis pool, then call deposit. Lender-side only on Ethereum — never signs or broadcasts.',
  }
}
