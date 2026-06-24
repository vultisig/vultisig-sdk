import { decodeCosmosTx } from './cosmos'
import { decodeEvmTx } from './evm'
import type { ChainFamily, DecodeFromToolResultInput, Envelope } from './types'

const EVM_CHAINS = new Set([
  'ethereum',
  'eth',
  'base',
  'arbitrum',
  'polygon',
  'optimism',
  'bsc',
  'bnb',
  'avalanche',
  'avax',
])

const COSMOS_CHAINS = new Set([
  'cosmos',
  'cosmoshub-4',
  'gaia',
  'osmosis',
  'osmosis-1',
  'terra',
  'phoenix-1',
  'terraclassic',
  'columbus-5',
  'noble',
  'noble-1',
  'dydx',
  'dydx-mainnet-1',
  'akash',
  'akashnet-2',
])

function failed(chain: string, family: ChainFamily | undefined, reason: string): Envelope {
  return {
    chain,
    family: family ?? 'evm',
    kind: 'unknown',
    recipient: '',
    asset: { symbol: '', contract: '', decimals: 0 },
    amount: '',
    spender: '',
    decoded: false,
    decodeError: reason,
  }
}

function asArgsObject(args: DecodeFromToolResultInput['args']): Record<string, unknown> {
  if (!args) return {}
  if (typeof args === 'string') {
    try {
      return JSON.parse(args) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  return args
}

function inferFamily(input: DecodeFromToolResultInput, args: Record<string, unknown>): ChainFamily | undefined {
  if (input.family) return input.family
  const chain = (input.chain ?? (args['chain'] as string) ?? (args['from_chain'] as string) ?? '')
    .toString()
    .toLowerCase()
    .trim()
  if (EVM_CHAINS.has(chain)) return 'evm'
  if (COSMOS_CHAINS.has(chain)) return 'cosmos'
  return undefined
}

/** Strip 0x and decode a hex string to bytes. */
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex
  return Uint8Array.from(Buffer.from(clean, 'hex'))
}

/** Decode base64 to bytes. */
function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(b64, 'base64'))
}

/**
 * Pull the raw tx bytes for the family — from the explicit `payload`, else from
 * the tool-call args (`unsigned_payload` hex for EVM, `cosmos_payload` base64
 * for Cosmos).
 */
function resolvePayload(
  input: DecodeFromToolResultInput,
  family: ChainFamily,
  args: Record<string, unknown>
): Uint8Array | { error: string } {
  if (input.payload !== undefined) {
    if (input.payload instanceof Uint8Array) return input.payload
    const p = input.payload
    return family === 'evm' ? hexToBytes(p) : tryBase64ThenHex(p)
  }
  if (family === 'evm') {
    const hex = args['unsigned_payload']
    if (typeof hex === 'string' && hex.length > 0) return hexToBytes(hex)
    return { error: 'evm: no payload — pass `payload` or args.unsigned_payload (hex)' }
  }
  const b64 = args['cosmos_payload'] ?? args['payload']
  if (typeof b64 === 'string' && b64.length > 0) return tryBase64ThenHex(b64)
  return { error: 'cosmos: no payload — pass `payload` or args.cosmos_payload (base64)' }
}

/** Cosmos payloads are base64 in the wild, but tolerate hex too. */
function tryBase64ThenHex(s: string): Uint8Array {
  if (s.startsWith('0x') || /^[0-9a-fA-F]+$/.test(s)) {
    try {
      return hexToBytes(s)
    } catch {
      /* fall through */
    }
  }
  return base64ToBytes(s)
}

/**
 * THE canonical bytes oracle: decode a pending transaction (EVM RLP calldata or
 * Cosmos proto3 tx bytes) into a chain-agnostic {@link Envelope}.
 *
 * The recipient/amount/asset are lifted from the ON-THE-WIRE bytes — never from
 * caller-supplied args — so every safety surface (isolate hostValidate, CLI
 * WYSIWYS, app decoded-intent card, co-sign gate, migration shadow-diff) reads
 * the same answer for the same tx. Pure crypto: it decodes/parses only; it does
 * NOT judge intent, ground claims, sign, or broadcast.
 *
 * Ported from the Go reference `internal/safety/envelope.go#DecodeFromToolResult`.
 * EVM half delegates to viem (`parseTransaction` + `decodeFunctionData`); Cosmos
 * half to cosmjs-types proto3 decode (TxRaw → TxBody → Any → typed Msg).
 *
 * Like the Go reference, this never throws — decode failures surface as
 * `Envelope{ decoded: false, decodeError }` so callers handle them uniformly.
 *
 * @example
 * ```ts
 * const env = decodeFromToolResult({
 *   family: 'evm',
 *   chain: 'ethereum',
 *   // USDC.transfer(0xRecipient, 1_000_000) wrapped in an unsigned EIP-1559 tx
 *   payload: unsignedTxHex,
 * })
 * // => { recipient: '0xRecipient', amount: '1000000', asset: { contract: 'USDC addr' }, ... }
 * ```
 */
export function decodeFromToolResult(input: DecodeFromToolResultInput): Envelope {
  const args = asArgsObject(input.args)
  const chainHint = (input.chain ?? (args['chain'] as string) ?? '').toString().trim()
  const family = inferFamily(input, args)

  if (!family) {
    return failed(chainHint, undefined, 'cannot determine chain family — pass `family` or a known `chain`')
  }

  const payload = resolvePayload(input, family, args)
  if (!(payload instanceof Uint8Array)) {
    return failed(chainHint, family, payload.error)
  }
  if (payload.length === 0) {
    return failed(chainHint, family, `${family}: empty payload`)
  }

  const env = family === 'evm' ? decodeEvmTx(payload, chainHint) : decodeCosmosTx(payload, chainHint)

  // Fill-only enrichment from args: the asset symbol is not on the wire for
  // native EVM sends / some Cosmos denoms. NEVER touch a bytes-decoded
  // recipient/amount.
  if (env.decoded && env.asset.symbol === '') {
    const sym = firstString(args, ['token', 'token_symbol', 'asset', 'symbol', 'ticker'])
    if (sym && !looksLikeAddress(sym)) env.asset.symbol = sym.toUpperCase()
  }

  return env
}

function firstString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v.length > 0) return v
  }
  return ''
}

function looksLikeAddress(s: string): boolean {
  if (s.length >= 40 && (s.startsWith('0x') || s.startsWith('0X'))) return true
  if (s.length > 30) return true
  return false
}
