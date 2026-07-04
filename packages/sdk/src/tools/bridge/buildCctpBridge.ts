/**
 * buildCctpBridge — build the source-chain unsigned transaction sequence
 * for bridging USDC cross-chain via Circle CCTP.
 *
 * Ported from mcp-ts `build_cctp_bridge_usdc`. Pure crypto: encodes the
 * two source-chain calls and returns them as an unsigned 2-tx envelope.
 * NEVER signs or broadcasts.
 *
 *   1. ERC-20 approve: USDC → TokenMessenger (allows the burn)
 *   2. depositForBurn: burn USDC on the source chain. After the burn
 *      confirms, poll Circle for the attestation, then mint on the
 *      destination chain via {@link buildCctpClaim}.
 *
 * Zero slippage — USDC is burned 1:1 on the source chain and minted 1:1
 * on the destination chain.
 */

import { encodeFunctionData, getAddress, isAddress } from 'viem'

import { assertSafeEvmDestination } from '../../utils/dangerousAddresses'
import { type CctpChainConfig, cctpSupportedChains, getCctpChain } from './cctp'

/** USDC has 6 decimals across all CCTP-supported chains. */
const USDC_DECIMALS = 6

/** uint256 max — defense-in-depth overflow clamp. */
const MAX_UINT256 = (1n << 256n) - 1n

const erc20ApproveAbi = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

const tokenMessengerAbi = [
  {
    name: 'depositForBurn',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'destinationDomain', type: 'uint32' },
      { name: 'mintRecipient', type: 'bytes32' },
      { name: 'burnToken', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint64' }],
  },
] as const

/** Parameters for {@link buildCctpBridge}. */
export type BuildCctpBridgeParams = {
  /** Source EVM chain name (one of {@link cctpSupportedChains}). */
  sourceChain: string
  /** Destination EVM chain name (one of {@link cctpSupportedChains}). */
  destinationChain: string
  /** Human-readable USDC amount, e.g. "10" or "10.5" (up to 6 decimals). */
  amount: string
  /**
   * Recipient (mintRecipient) on the destination chain, 0x-prefixed.
   * Defaults to {@link BuildCctpBridgeParams.from} when omitted.
   */
  to?: string
  /**
   * Sender on the source chain, 0x-prefixed. Used as the default `to`
   * when only one is provided (the common "bridge to my own address").
   */
  from?: string
}

/** A single unsigned EVM transaction within a CCTP bridge sequence. */
export type CctpUnsignedTx = {
  /** Target contract address (checksummed). */
  to: `0x${string}`
  /** Wei value — always "0" for CCTP (no native value moved). */
  value: '0'
  /** ABI-encoded calldata. */
  data: `0x${string}`
  /** "approve" | "burn" — which leg of the sequence this is. */
  action: 'approve' | 'burn'
  /** Human-readable description for the signing UI. */
  description: string
}

/** Unsigned CCTP bridge (burn) envelope returned by {@link buildCctpBridge}. */
export type CctpBridgeResult = {
  /** Source chain name. */
  chain: string
  /** Decimal source-chain EVM chain id. */
  chainId: number
  /** Always "cctp". */
  provider: 'cctp'
  fromChain: string
  toChain: string
  fromSymbol: 'USDC'
  toSymbol: 'USDC'
  /** Ordered 2-tx sequence: approve, then burn. Sign sequentially. */
  transactions: CctpUnsignedTx[]
  /** CCTP destination domain (NOT an EVM chain id). */
  destinationDomain: number
  /** Checksummed mintRecipient on the destination chain. */
  recipient: `0x${string}`
  /** Raw 6-decimal burn amount as a string. */
  amountRaw: string
  /** Human-readable burn amount, e.g. "10.5". */
  amountUsdc: string
}

/**
 * parseUsdcAmount converts a human-readable USDC amount (e.g. "10",
 * "10.5") into raw 6-decimal units. Mirrors the Go/mcp-ts side. Exported
 * for unit tests.
 *
 * @throws if the amount is empty, negative, non-numeric, or has more
 * than 6 decimal places.
 */
export const parseUsdcAmount = (s: string): bigint => {
  const trimmed = s.trim()
  if (trimmed === '') {
    throw new Error('empty amount')
  }
  if (trimmed.startsWith('-')) {
    throw new Error('negative amounts not allowed')
  }

  const dotIdx = trimmed.indexOf('.')
  let wholePart: string
  let fracPart: string
  if (dotIdx === -1) {
    wholePart = trimmed
    fracPart = ''
  } else {
    wholePart = trimmed.slice(0, dotIdx)
    fracPart = trimmed.slice(dotIdx + 1)
    if (fracPart.includes('.')) {
      throw new Error(`invalid amount: multiple decimal points in ${s}`)
    }
  }

  if (wholePart === '') {
    wholePart = '0'
  }

  if (fracPart.length > USDC_DECIMALS) {
    throw new Error(`too many decimal places (max ${USDC_DECIMALS} for USDC): ${s}`)
  }

  let wholeInt: bigint
  try {
    wholeInt = BigInt(wholePart)
  } catch {
    throw new Error(`invalid integer part: ${wholePart}`)
  }

  while (fracPart.length < USDC_DECIMALS) {
    fracPart += '0'
  }
  if (fracPart.length > 0 && !/^\d+$/.test(fracPart)) {
    throw new Error(`invalid fractional part: ${fracPart}`)
  }

  const fracInt = fracPart.length > 0 ? BigInt(fracPart) : 0n
  const multiplier = 10n ** BigInt(USDC_DECIMALS)
  return wholeInt * multiplier + fracInt
}

/** Format a raw 6-decimal USDC amount back to a human-readable string. */
export const formatUsdc = (raw: bigint): string => {
  const divisor = 10n ** BigInt(USDC_DECIMALS)
  const whole = raw / divisor
  const frac = raw % divisor
  if (frac === 0n) return whole.toString()
  return `${whole}.${frac.toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '')}`
}

/**
 * Build the bytes32 mintRecipient from a 20-byte EVM address. CCTP's
 * TokenMessenger expects the recipient as a left-zero-padded, 32-byte,
 * right-aligned address.
 */
const addressToBytes32 = (addr: `0x${string}`): `0x${string}` => {
  const stripped = getAddress(addr).slice(2).toLowerCase()
  return `0x${stripped.padStart(64, '0')}` as `0x${string}`
}

/**
 * Build the unsigned source-chain transaction sequence for a CCTP USDC
 * bridge. Returns `{ approve, burn }` calldata wrapped in a canonical
 * envelope. The caller signs each tx sequentially (approve must confirm
 * before the burn).
 *
 * @throws on unsupported chains, identical source/destination, invalid
 * amount, missing/invalid recipient, or a burn-address mintRecipient.
 *
 * @example
 * ```ts
 * const env = buildCctpBridge({
 *   sourceChain: 'Base',
 *   destinationChain: 'Arbitrum',
 *   amount: '10',
 *   from: '0xabc...',
 * })
 * // env.transactions[0].action === 'approve'
 * // env.transactions[1].action === 'burn'
 * ```
 */
export const buildCctpBridge = (params: BuildCctpBridgeParams): CctpBridgeResult => {
  const srcChainName = params.sourceChain.trim()
  const dstChainName = params.destinationChain.trim()

  if (srcChainName === dstChainName) {
    throw new Error('sourceChain and destinationChain must be different')
  }

  const srcCctp: CctpChainConfig | undefined = getCctpChain(srcChainName)
  if (!srcCctp) {
    throw new Error(
      `source chain ${JSON.stringify(srcChainName)} is not supported by CCTP. Supported: ${cctpSupportedChains.join(', ')}`
    )
  }
  const dstCctp: CctpChainConfig | undefined = getCctpChain(dstChainName)
  if (!dstCctp) {
    throw new Error(
      `destination chain ${JSON.stringify(dstChainName)} is not supported by CCTP. Supported: ${cctpSupportedChains.join(', ')}`
    )
  }

  const rawAmount = parseUsdcAmount(params.amount)
  if (rawAmount <= 0n) {
    throw new Error('amount must be positive')
  }
  if (rawAmount > MAX_UINT256) {
    throw new Error('amount overflows uint256')
  }

  // Resolve the mintRecipient. `to` is the destination recipient; `from`
  // is the source sender. Default `to` → `from` for the common
  // "bridge to my own address" case.
  const recipientStr = (params.to ?? params.from ?? '').trim()
  if (!recipientStr) {
    throw new Error('`to` (destination recipient) not specified and no `from` (sender) provided')
  }
  if (!isAddress(recipientStr)) {
    throw new Error(`invalid "to" address: ${recipientStr}`)
  }
  const recipient = getAddress(recipientStr)

  // Fund-safety: the mintRecipient is BURNED on the source chain and minted to
  // this address on the destination. A burn/zero recipient mints USDC to a
  // permanently unspendable address (irrecoverable). Uses the canonical shared
  // EVM burn-list (all 3 addresses incl. `0xdead…942069`) so the set can't
  // drift per call-site again.
  assertSafeEvmDestination(recipient)

  const approveData = encodeFunctionData({
    abi: erc20ApproveAbi,
    functionName: 'approve',
    args: [getAddress(srcCctp.tokenMessenger), rawAmount],
  })

  const mintRecipient = addressToBytes32(recipient)
  const depositData = encodeFunctionData({
    abi: tokenMessengerAbi,
    functionName: 'depositForBurn',
    args: [rawAmount, dstCctp.domain, mintRecipient, getAddress(srcCctp.usdc)],
  })

  return {
    chain: srcChainName,
    chainId: srcCctp.evmChainId,
    provider: 'cctp',
    fromChain: srcChainName,
    toChain: dstChainName,
    fromSymbol: 'USDC',
    toSymbol: 'USDC',
    transactions: [
      {
        to: getAddress(srcCctp.usdc),
        value: '0',
        data: approveData,
        action: 'approve',
        description: `Approve USDC spending by TokenMessenger on ${srcChainName} (step 1 of 2)`,
      },
      {
        to: getAddress(srcCctp.tokenMessenger),
        value: '0',
        data: depositData,
        action: 'burn',
        description: `Burn ${formatUsdc(rawAmount)} USDC via depositForBurn (step 2 of 2). Sign AFTER step 1 confirms.`,
      },
    ],
    destinationDomain: dstCctp.domain,
    recipient,
    amountRaw: rawAmount.toString(),
    amountUsdc: formatUsdc(rawAmount),
  }
}
