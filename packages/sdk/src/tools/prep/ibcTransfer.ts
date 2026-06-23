import { bech32 } from '@scure/base'

/**
 * Pure-crypto ICS-20 IBC transfer builder.
 *
 * Builds an UNSIGNED `MsgTransfer` envelope for a native Cosmos cross-chain
 * transfer (move a native asset between two Cosmos chains WITHOUT swapping).
 * Ported from vultisig/mcp-ts `build_ibc_transfer` — the route/channel/HRP
 * tables and the envelope shape are reproduced verbatim; the network IO
 * (account/sequence/block-height LCD fetches) and the price-oracle USD lookup
 * are intentionally NOT ported. Those are side-effecting concerns the caller
 * (mcp-ts / agent-backend) supplies; this function is deterministic and offline.
 *
 * It NEVER signs and NEVER broadcasts. The vault's signing material stays
 * on-device. The output is the exact `unsigned_msgs[0].cosmos_tx` envelope the
 * Vultisig signing client consumes, plus the resolved route metadata.
 *
 * Channel/route resolution mirrors the mcp-ts tool:
 *   - pass `toChainId` alone  → channel reverse-resolved from the route table
 *   - pass `sourceChannel` alone → destination resolved from the channel table
 *   - pass both → cross-validated (mismatch throws)
 *
 * Account-state fields (`accountNumber`, `sequence`) and `timeoutHeight` /
 * `timeoutTimestamp` are caller-supplied — the SDK builder does not reach the
 * network. Omit `accountNumber`/`sequence` and the signing client supplies
 * them; omit timeouts and a timestamp-only default (now + 10min) is used.
 */

// ── channel registry ──────────────────────────────────────────────────────────

type ChannelKey = `${string}/${string}` // `${fromChain}/${channel}`

/** Chain-ID → bech32 HRP, for address validation. */
export const IBC_CHAIN_HRP: Record<string, string> = {
  'phoenix-1': 'terra',
  'columbus-5': 'terra',
  'cosmoshub-4': 'cosmos',
  'osmosis-1': 'osmo',
  'kaiyo-1': 'kujira',
  'neutron-1': 'neutron',
  'axelar-dojo-1': 'axelar',
  'injective-1': 'inj',
  'juno-1': 'juno',
  'stargaze-1': 'stars',
  'noble-1': 'noble',
  'akashnet-2': 'akash',
  'dydx-mainnet-1': 'dydx',
  'stride-1': 'stride',
  celestia: 'celestia',
}

/** Chain-ID → IBC revision number (for timeout_height defaulting). */
export const IBC_CHAIN_REVISION: Record<string, number> = {
  'phoenix-1': 1,
  'columbus-5': 5,
  'cosmoshub-4': 4,
  'osmosis-1': 1,
  'kaiyo-1': 1,
  'neutron-1': 1,
  'axelar-dojo-1': 1,
  'injective-1': 1,
  'juno-1': 1,
  'stargaze-1': 1,
  'noble-1': 1,
  'akashnet-2': 2,
  'dydx-mainnet-1': 1,
  'stride-1': 1,
  celestia: 1,
}

/**
 * (from_chain/source_channel) → dest_chain_id. Only channels in this table are
 * accepted — unknown channels are rejected to prevent funds being sent to a
 * wrong-chain address. Every entry was verified by live LCD client_state probe
 * (2026-05-11 / 2026-05-31) in the mcp-ts source.
 */
export const IBC_CHANNEL_DEST: Record<ChannelKey, string> = {
  // phoenix-1 (Terra) outbound
  'phoenix-1/channel-0': 'cosmoshub-4',
  'phoenix-1/channel-1': 'osmosis-1',
  'phoenix-1/channel-2': 'juno-1',
  'phoenix-1/channel-6': 'axelar-dojo-1',
  'phoenix-1/channel-229': 'neutron-1',
  // columbus-5 (Terra Classic) outbound
  'columbus-5/channel-1': 'osmosis-1',
  // osmosis-1 outbound
  'osmosis-1/channel-0': 'cosmoshub-4',
  'osmosis-1/channel-42': 'juno-1',
  'osmosis-1/channel-750': 'noble-1',
  'osmosis-1/channel-341': 'phoenix-1',
  'osmosis-1/channel-1': 'akashnet-2',
  'osmosis-1/channel-6787': 'dydx-mainnet-1',
  'osmosis-1/channel-208': 'axelar-dojo-1',
  'osmosis-1/channel-259': 'kaiyo-1',
  'osmosis-1/channel-874': 'neutron-1',
  'osmosis-1/channel-122': 'injective-1',
  'osmosis-1/channel-326': 'stride-1',
  'osmosis-1/channel-6994': 'celestia',
  // cosmoshub-4 outbound
  'cosmoshub-4/channel-141': 'osmosis-1',
}

/**
 * Reverse index: (from_chain → to_chain_id) → source_channel. Built once from
 * IBC_CHANNEL_DEST so a caller can request a transfer by naming the destination
 * chain without knowing the channel number. Every pair is unique in the current
 * table; first-write-wins on the (theoretical) duplicate.
 */
const IBC_CHANNEL_BY_ROUTE: Map<string, string> = (() => {
  const m = new Map<string, string>()
  for (const [key, destChain] of Object.entries(IBC_CHANNEL_DEST)) {
    const slashIdx = key.indexOf('/')
    if (slashIdx < 0) continue
    const fromChain = key.slice(0, slashIdx)
    const sourceChannel = key.slice(slashIdx + 1)
    const routeKey = `${fromChain}→${destChain}`
    if (!m.has(routeKey)) m.set(routeKey, sourceChannel)
  }
  return m
})()

/** source_channel for a given (from_chain → to_chain_id) route, or null. */
function resolveSourceChannelByDestChain(fromChain: string, toChainId: string): string | null {
  return IBC_CHANNEL_BY_ROUTE.get(`${fromChain}→${toChainId}`) ?? null
}

/** Supported destination chain-IDs reachable FROM the given source chain. */
export function supportedIbcDestinationsFrom(fromChain: string): string[] {
  return Array.from(IBC_CHANNEL_BY_ROUTE.keys())
    .filter(routeKey => routeKey.startsWith(`${fromChain}→`))
    .map(routeKey => routeKey.split('→')[1]!)
    .sort()
}

// ── chain name aliases ──────────────────────────────────────────────────────

/** Vultisig canonical chain names → IBC chain-IDs. */
const VULTISIG_NAME_TO_CHAIN_ID: Record<string, string> = {
  Cosmos: 'cosmoshub-4',
  Osmosis: 'osmosis-1',
  Terra: 'phoenix-1',
  TerraClassic: 'columbus-5',
  Kujira: 'kaiyo-1',
  Akash: 'akashnet-2',
  Noble: 'noble-1',
  Dydx: 'dydx-mainnet-1',
  MayaChain: 'mayachain-mainnet-v1',
  THORChain: 'thorchain-1',
  Stride: 'stride-1',
}

/**
 * Normalise a chain identifier: accepts both Vultisig canonical names
 * ("Cosmos", "Osmosis") and plain IBC chain-IDs ("cosmoshub-4"). Returns the
 * IBC chain-ID, or the original string when no alias matches.
 */
export function normaliseIbcChainId(input: string): string {
  return VULTISIG_NAME_TO_CHAIN_ID[input] ?? input
}

// ── helpers ─────────────────────────────────────────────────────────────────

/** Minimum plausible nanosecond timestamp (year 2020). */
const MIN_TIMEOUT_NS = BigInt('1577836800000000000')

const CHANNEL_RE = /^channel-\d+$/

/** IBC revision number for a chain-ID, falling back to the integer suffix. */
function chainRevisionNumber(chainId: string): number {
  if (Object.hasOwn(IBC_CHAIN_REVISION, chainId)) return IBC_CHAIN_REVISION[chainId]!
  const idx = chainId.lastIndexOf('-')
  if (idx >= 0) {
    const n = parseInt(chainId.slice(idx + 1), 10)
    if (!Number.isNaN(n)) return n
  }
  return 1
}

/**
 * Classify a bech32 HRP as a validator role (fund safety). A `...valoper` /
 * `...valcons` address is NOT a spendable wallet — funds bank-sent to it are
 * unrecoverable. Returns null for plain account HRPs.
 */
function validatorRoleForHrp(hrp: string): 'operator' | 'consensus' | null {
  const lower = hrp.toLowerCase()
  if (lower.endsWith('valoper')) return 'operator'
  if (lower.endsWith('valcons')) return 'consensus'
  return null
}

/**
 * Validate a bech32 address against an expected HRP. Returns an error string,
 * or null when valid. Rejects validator operator/consensus keys explicitly.
 */
function validateBech32Address(addr: string, expectedHrp: string): string | null {
  let decoded: ReturnType<typeof bech32.decode>
  try {
    // `false` disables the 90-char limit (Cosmos addresses fit, but some
    // 32-byte payload chains can exceed the default at higher prefixes).
    decoded = bech32.decode(addr as `${string}1${string}`, false)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return `malformed bech32 address "${addr}": ${msg}`
  }
  const validatorRole = validatorRoleForHrp(decoded.prefix)
  if (validatorRole !== null) {
    const what = validatorRole === 'operator' ? 'OPERATOR' : 'CONSENSUS'
    return `"${addr}" is a validator ${what} address (not a spendable wallet); funds sent to a validator key are not recoverable`
  }
  if (decoded.prefix !== expectedHrp) {
    return `address prefix "${decoded.prefix}" does not match expected "${expectedHrp}" for this chain`
  }
  let payload: Uint8Array
  try {
    payload = bech32.fromWords(decoded.words)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return `malformed bech32 payload in "${addr}": ${msg}`
  }
  if (payload.length !== 20 && payload.length !== 32) {
    return `unexpected payload length ${payload.length} bytes in "${addr}" (expected 20 or 32)`
  }
  return null
}

/** Validate a "revision_number/block_height" string. Returns error or null. */
function validateTimeoutHeight(s: string): string | null {
  const parts = s.split('/')
  if (parts.length !== 2) return 'must be in format revision_number/block_height'
  const [rev, height] = parts
  if (!/^\d+$/.test(rev!) || !/^\d+$/.test(height!)) {
    return 'revision_number and block_height must be non-negative integers'
  }
  return null
}

// ── public surface ────────────────────────────────────────────────────────────

export const IBC_MSG_TRANSFER_TYPE_URL = '/ibc.applications.transfer.v1.MsgTransfer'

export type PrepareIbcTransferParams = {
  /** Source chain — IBC chain-ID ("phoenix-1") or Vultisig name ("Terra"). */
  fromChain: string
  /** Bech32 sender address. HRP must match `fromChain`. */
  fromAddress: string
  /** Bech32 receiver address on the destination chain. */
  toAddress: string
  /** Token denomination in base units (e.g. "uluna", "uatom", "ibc/<hash>"). */
  denom: string
  /** Transfer amount in base units (positive integer string). */
  amount: string
  /**
   * Destination chain — IBC chain-ID or Vultisig name. ALTERNATIVE to
   * `sourceChannel`. When supplied, the source_channel is reverse-resolved.
   */
  toChainId?: string
  /**
   * IBC source channel ("channel-1"). ALTERNATIVE to `toChainId`. When both are
   * supplied they are cross-validated.
   */
  sourceChannel?: string
  /**
   * IBC timeout block height as "revision_number/block_height". Defaults to
   * "0/0" (timestamp-only timeout) when omitted — this builder does not reach
   * the network to read the destination chain head. Pass a real height to bound
   * the packet by block.
   */
  timeoutHeight?: string
  /**
   * IBC timeout as Unix nanoseconds string. Defaults to now + 10 minutes when
   * omitted. Must be >= year-2020 epoch in ns and in the future.
   */
  timeoutTimestamp?: string
  /** Account number from source-chain auth (caller-fetched). Omit if unknown. */
  accountNumber?: string
  /** Account sequence from source-chain auth (caller-fetched). Omit if unknown. */
  sequence?: string
  /** Optional packet memo, passed through to the destination chain. */
  memo?: string
  /**
   * Override the wall clock for the default timeout. Test-only / determinism
   * hook; defaults to `Date.now()`.
   */
  nowMs?: number
}

export type IbcMsgTransfer = {
  source_port: 'transfer'
  source_channel: string
  token: { denom: string; amount: string }
  sender: string
  receiver: string
  timeout_height: { revision_number: string; revision_height: string }
  timeout_timestamp: string
  memo: string
}

export type IbcCosmosTx = {
  chain_id: string
  msgs: Array<{ msg: string; msg_type_url: string }>
  signer_address: string
  account_number?: string
  sequence?: string
}

export type PrepareIbcTransferResult = {
  /** Resolved source chain-ID. */
  fromChain: string
  /** Resolved destination chain-ID. */
  destChain: string
  /** Resolved IBC source channel. */
  sourceChannel: string
  /** Human-readable route, e.g. "phoenix-1 → osmosis-1 via channel-1". */
  routeDescription: string
  /** The inner ICS-20 MsgTransfer (decoded form). */
  msgTransfer: IbcMsgTransfer
  /** The unsigned cosmos tx envelope consumed by the Vultisig signing client. */
  cosmosTx: IbcCosmosTx
  /** The msg type URL for the packet. */
  msgTypeUrl: typeof IBC_MSG_TRANSFER_TYPE_URL
}

/**
 * Build an UNSIGNED ICS-20 MsgTransfer envelope with channel/route resolution.
 *
 * Pure crypto — deterministic, offline, never signs or broadcasts. The vault's
 * signing material is not touched. Throws (with an actionable message) on any
 * unresolvable route, malformed/wrong-chain address, validator-key recipient,
 * non-positive amount, or malformed timeout.
 *
 * @example
 * ```ts
 * const built = prepareIbcTransfer({
 *   fromChain: 'osmosis-1',
 *   toChainId: 'cosmoshub-4',
 *   fromAddress: 'osmo1...',
 *   toAddress: 'cosmos1...',
 *   denom: 'uosmo',
 *   amount: '1000000',
 * })
 * // built.cosmosTx.msgs[0].msg is the JSON MsgTransfer; sign on-device.
 * ```
 */
export function prepareIbcTransfer(params: PrepareIbcTransferParams): PrepareIbcTransferResult {
  const fromChain = normaliseIbcChainId(params.fromChain.trim())
  const rawSourceChannel = typeof params.sourceChannel === 'string' ? params.sourceChannel.trim() : ''
  const rawToChainId = typeof params.toChainId === 'string' ? normaliseIbcChainId(params.toChainId.trim()) : ''

  if (rawSourceChannel && !CHANNEL_RE.test(rawSourceChannel)) {
    throw new Error(`invalid source_channel "${rawSourceChannel}": must match channel-<integer>`)
  }

  // Resolve (sourceChannel, destChain) from one of the supported branches.
  let sourceChannel: string
  let destChain: string

  if (rawSourceChannel && rawToChainId) {
    const channelKey: ChannelKey = `${fromChain}/${rawSourceChannel}`
    const resolvedDest = IBC_CHANNEL_DEST[channelKey]
    if (!resolvedDest) {
      throw new Error(
        `unknown channel ${rawSourceChannel} on ${fromChain}: supported destinations from ${fromChain}: ${supportedIbcDestinationsFrom(fromChain).join(', ') || '(none)'}`
      )
    }
    if (resolvedDest !== rawToChainId) {
      throw new Error(
        `channel ${rawSourceChannel} on ${fromChain} routes to ${resolvedDest}, NOT ${rawToChainId}. ` +
          `Pass toChainId=${rawToChainId} alone, or omit toChainId and use sourceChannel=${rawSourceChannel} for a transfer to ${resolvedDest}.`
      )
    }
    sourceChannel = rawSourceChannel
    destChain = resolvedDest
  } else if (rawToChainId) {
    const resolved = resolveSourceChannelByDestChain(fromChain, rawToChainId)
    if (!resolved) {
      const supported = supportedIbcDestinationsFrom(fromChain)
      throw new Error(
        supported.length > 0
          ? `no supported IBC channel from ${fromChain} to ${rawToChainId}. Supported destinations from ${fromChain}: ${supported.join(', ')}.`
          : `no supported IBC routes from ${fromChain}. Pick a source chain among: phoenix-1, columbus-5, cosmoshub-4, osmosis-1.`
      )
    }
    sourceChannel = resolved
    destChain = rawToChainId
  } else if (rawSourceChannel) {
    const channelKey: ChannelKey = `${fromChain}/${rawSourceChannel}`
    const resolvedDest = IBC_CHANNEL_DEST[channelKey]
    if (!resolvedDest) {
      throw new Error(
        `unknown channel ${rawSourceChannel} on ${fromChain}: supported destinations from ${fromChain}: ${supportedIbcDestinationsFrom(fromChain).join(', ') || '(none)'}. ` +
          `Tip: pass toChainId=<destination chain ID> and omit sourceChannel.`
      )
    }
    sourceChannel = rawSourceChannel
    destChain = resolvedDest
  } else {
    throw new Error(
      `prepareIbcTransfer requires either sourceChannel OR toChainId. ` +
        `Preferred: pass toChainId=<destination chain ID> and let the builder resolve the channel. ` +
        `Supported destinations from ${fromChain}: ${supportedIbcDestinationsFrom(fromChain).join(', ') || '(none — pick a different source chain)'}.`
    )
  }

  // Validate amount (positive integer string).
  if (!/^\d+$/.test(params.amount)) {
    throw new Error(`invalid amount "${params.amount}": must be a positive integer string (base units)`)
  }
  if (BigInt(params.amount) <= 0n) {
    throw new Error(`invalid amount "${params.amount}": must be positive (non-zero)`)
  }

  if (!params.denom.trim()) {
    throw new Error('denom is required')
  }

  // Validate from_address HRP.
  const fromHrp = IBC_CHAIN_HRP[fromChain]
  if (fromHrp) {
    const err = validateBech32Address(params.fromAddress, fromHrp)
    if (err) {
      throw new Error(`fromAddress HRP mismatch for chain ${fromChain} (expected prefix "${fromHrp}"): ${err}`)
    }
  }

  // Validate to_address HRP.
  const destHrp = IBC_CHAIN_HRP[destChain]
  if (destHrp) {
    const err = validateBech32Address(params.toAddress, destHrp)
    if (err) {
      throw new Error(
        `toAddress HRP mismatch for destination chain ${destChain} via ${sourceChannel} (expected prefix "${destHrp}"): ${err}`
      )
    }
  }

  // Resolve timeout_height (caller-supplied, else timestamp-only "0/0").
  let timeoutHeightStr = params.timeoutHeight?.trim() ?? ''
  if (timeoutHeightStr && timeoutHeightStr !== '0/0') {
    const err = validateTimeoutHeight(timeoutHeightStr)
    if (err) throw new Error(`invalid timeoutHeight "${timeoutHeightStr}": ${err}`)
  }
  if (!timeoutHeightStr) {
    // No network read here — emit revision-aware "0/0" (timestamp-only) so the
    // signing client / caller can fill a real height if it wants block bounds.
    void chainRevisionNumber(destChain)
    timeoutHeightStr = '0/0'
  }

  // Resolve timeout_timestamp (caller-supplied, else now + 10 min in ns).
  const nowMs = params.nowMs ?? Date.now()
  let timeoutTimestampStr = params.timeoutTimestamp?.trim() ?? ''
  if (timeoutTimestampStr) {
    if (!/^\d+$/.test(timeoutTimestampStr)) {
      throw new Error(
        `invalid timeoutTimestamp "${timeoutTimestampStr}": must be a positive integer (Unix nanoseconds)`
      )
    }
    const tsNs = BigInt(timeoutTimestampStr)
    if (tsNs < MIN_TIMEOUT_NS) {
      throw new Error(
        `timeoutTimestamp "${timeoutTimestampStr}" appears to be in seconds or milliseconds, not nanoseconds: value must be >= ${MIN_TIMEOUT_NS.toString()} (year 2020 in ns)`
      )
    }
    if (tsNs <= BigInt(nowMs) * 1_000_000n) {
      throw new Error(
        `timeoutTimestamp "${timeoutTimestampStr}" is already in the past: provide a future nanosecond timestamp`
      )
    }
  } else {
    timeoutTimestampStr = String(BigInt(nowMs + 10 * 60 * 1000) * 1_000_000n)
  }

  const [revStr, heightStr] = timeoutHeightStr.split('/')

  const msgTransfer: IbcMsgTransfer = {
    source_port: 'transfer',
    source_channel: sourceChannel,
    token: { denom: params.denom, amount: params.amount },
    sender: params.fromAddress,
    receiver: params.toAddress,
    timeout_height: { revision_number: revStr!, revision_height: heightStr! },
    timeout_timestamp: timeoutTimestampStr,
    memo: params.memo ?? '',
  }

  const cosmosTx: IbcCosmosTx = {
    chain_id: fromChain,
    msgs: [{ msg: JSON.stringify(msgTransfer), msg_type_url: IBC_MSG_TRANSFER_TYPE_URL }],
    signer_address: params.fromAddress,
  }
  if (params.accountNumber !== undefined) cosmosTx.account_number = params.accountNumber
  if (params.sequence !== undefined) cosmosTx.sequence = params.sequence

  return {
    fromChain,
    destChain,
    sourceChannel,
    routeDescription: `${fromChain} → ${destChain} via ${sourceChannel}`,
    msgTransfer,
    cosmosTx,
    msgTypeUrl: IBC_MSG_TRANSFER_TYPE_URL,
  }
}
