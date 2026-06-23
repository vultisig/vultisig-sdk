import { type Address, decodeFunctionData, getAddress, type Hex, parseAbi, parseTransaction } from 'viem'

import type { Envelope } from './types'

/**
 * EIP-155 numeric chain id (decimal string) -> the symbolic chain id the
 * policy layer compares against (matches recipes' `evm.AllEVMChainConfigs`
 * `cfg.ID`, mirrored from the Go reference `evmChainIDToSymbol`).
 *
 * Without this, a typed tx to Base would surface `chain: "8453"` and the
 * downstream policy `chainsMatch("base", "8453")` would return false → a
 * spurious BLOCK on every legitimate typed-EVM transaction. We resolve the
 * on-wire numeric id back to the symbol so the safety layer can match it.
 */
const EVM_CHAIN_ID_TO_SYMBOL: Record<string, string> = {
  '1': 'ethereum',
  '10': 'optimism',
  '25': 'cronos',
  '56': 'bsc',
  '137': 'polygon',
  '324': 'zksync',
  '5000': 'mantle',
  '8453': 'base',
  '42161': 'arbitrum',
  '43114': 'avalanche',
  '81457': 'blast',
}

/**
 * Minimal ERC-20 / multicall ABI for the function selectors the safety
 * surfaces actually need to see through. We decode `transfer`/`approve` to lift
 * the true recipient + amount out of the calldata (where `tx.to` is the token
 * contract, NOT the recipient), and `multicall` to recurse into the inner
 * calls of an aggregator/router batch.
 */
const DECODE_ABI = parseAbi([
  'function transfer(address to, uint256 value)',
  'function transferFrom(address from, address to, uint256 value)',
  'function approve(address spender, uint256 value)',
  'function multicall(bytes[] data)',
])

/**
 * Decode the inner calls of an ERC-20 / router batch, returning the first
 * recognised transfer (the dominant value-moving call). Recurses one level into
 * `multicall(bytes[])`. Returns null when nothing recognised.
 */
function decodeErc20Like(data: Hex): {
  kind: Envelope['kind']
  recipient: string
  amount: string
  spender: string
  contractIsToken: boolean
} | null {
  if (data.length < 10) return null // need at least a 4-byte selector
  let decoded: { functionName: string; args: readonly unknown[] }
  try {
    decoded = decodeFunctionData({ abi: DECODE_ABI, data }) as {
      functionName: string
      args: readonly unknown[]
    }
  } catch {
    return null
  }

  switch (decoded.functionName) {
    case 'transfer': {
      const [to, value] = decoded.args as [Address, bigint]
      return {
        kind: 'transfer',
        recipient: getAddress(to),
        amount: value.toString(),
        spender: '',
        contractIsToken: true,
      }
    }
    case 'transferFrom': {
      const [, to, value] = decoded.args as [Address, Address, bigint]
      return {
        kind: 'transfer',
        recipient: getAddress(to),
        amount: value.toString(),
        spender: '',
        contractIsToken: true,
      }
    }
    case 'approve': {
      const [spender, value] = decoded.args as [Address, bigint]
      return {
        kind: 'approve',
        recipient: '',
        amount: value.toString(),
        spender: getAddress(spender),
        contractIsToken: true,
      }
    }
    case 'multicall': {
      const [calls] = decoded.args as [readonly Hex[]]
      for (const call of calls) {
        const inner = decodeErc20Like(call)
        if (inner) return inner
      }
      return { kind: 'contractCall', recipient: '', amount: '', spender: '', contractIsToken: false }
    }
    default:
      return null
  }
}

/**
 * Decode an unsigned EVM transaction (EIP-2718 typed or legacy RLP) into an
 * Envelope. The recipient/amount come from the encoded bytes — the calldata for
 * token transfers, or `tx.to`/`tx.value` for native sends — never from
 * caller-supplied args.
 *
 * Mirrors the Go reference `populateFromEVMTx`: typed txs carry the chain id on
 * the wire (resolved into `Envelope.chain`); legacy txs do not, so the caller's
 * chain hint stands.
 */
export function decodeEvmTx(bytes: Uint8Array, chainHint: string): Envelope {
  const hex = `0x${Buffer.from(bytes).toString('hex')}` as Hex

  let tx: ReturnType<typeof parseTransaction>
  try {
    tx = parseTransaction(hex)
  } catch (err) {
    return {
      chain: chainHint,
      family: 'evm',
      kind: 'unknown',
      recipient: '',
      asset: { symbol: '', contract: '', decimals: 0 },
      amount: '',
      spender: '',
      decoded: false,
      decodeError: `evm: parse tx failed: ${(err as Error).message}`,
    }
  }

  // Typed txs (EIP-1559/2930) carry an authoritative chain id on the wire, so
  // we resolve it to the symbolic chain name (8453 -> "base") for the policy to
  // match against the user's claimed chain. Legacy txs (type-0) — even EIP-155
  // ones where viem exposes a `chainId` — are NOT authoritative on the wire in
  // the same way, so the caller's `chainHint` stands. This mirrors the Go
  // reference `populateFromEVMTx`, which only overrides chain for DynamicFeeTx
  // /AccessListTx and runs the numeric id through `evmChainIDToSymbol` (falling
  // back to the raw numeric string only when the id is not in the map).
  const isTyped = tx.type === 'eip1559' || tx.type === 'eip2930'
  let chain = chainHint
  if (isTyped && typeof tx.chainId === 'number' && tx.chainId > 0) {
    const numeric = String(tx.chainId)
    chain = EVM_CHAIN_ID_TO_SYMBOL[numeric] ?? numeric
  }

  const env: Envelope = {
    chain,
    family: 'evm',
    kind: 'unknown',
    recipient: tx.to ? getAddress(tx.to) : '',
    asset: { symbol: '', contract: '', decimals: 0 },
    amount: tx.value !== undefined && tx.value > 0n ? tx.value.toString() : '',
    spender: '',
    decoded: true,
    decodeError: '',
  }

  const data = (tx.data ?? '0x') as Hex
  if (data === '0x' || data.length < 10) {
    // Plain native value transfer: tx.to is the recipient, tx.value the amount.
    env.kind = env.amount !== '' ? 'transfer' : 'unknown'
    return env
  }

  // There is calldata — dispatch on the 4-byte selector via the decode ABI.
  const inner = decodeErc20Like(data)
  if (!inner) {
    // Unrecognised contract call: tx.to (the contract) is the right comparison
    // target; recipient stays the contract address.
    env.kind = 'contractCall'
    return env
  }

  if (inner.contractIsToken) {
    // tx.to is the token contract; lift the real recipient/amount from calldata.
    env.asset.contract = tx.to ? getAddress(tx.to) : ''
  }
  env.kind = inner.kind
  if (inner.kind === 'approve') {
    // An approval has no value recipient — the meaningful target is the spender.
    env.recipient = ''
  } else if (inner.recipient) {
    env.recipient = inner.recipient
  }
  if (inner.amount) env.amount = inner.amount
  if (inner.spender) env.spender = inner.spender
  return env
}
