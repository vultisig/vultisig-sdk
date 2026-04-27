/**
 * TronGrid REST helpers (RN-safe).
 *
 * TronGrid is a REST API — each call is a POST with a JSON body and returns
 * JSON. We don't use `tronweb` here because its barrel import pulls in
 * `ws`/`node-fetch`/`elliptic` and breaks Hermes at module init.
 *
 * All functions take an explicit `apiUrl` (the gateway root, e.g.
 * `https://api.trongrid.io`) so consumers keep control of key gating and
 * rate-limit configuration.
 */

import bs58check from 'bs58check'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TronBlockRefs = {
  /** Raw block number. */
  blockNumber: number
  /** Block header timestamp (ms). */
  blockTimestamp: number
  /** `ref_block_bytes` — last 2 bytes of `blockNumber`, big-endian. */
  refBlockBytes: Uint8Array
  /** `ref_block_hash` — bytes 8..16 of the block id hash. */
  refBlockHash: Uint8Array
  /** Raw block id hex string (from `blockID`). */
  blockIdHex: string
}

export type TronAccountInfo = {
  /** Raw base58check address (back from the gateway — matches input). */
  address: string
  /** Balance in SUN. `0n` when the account has never been funded. */
  balance: bigint
  /** Free bandwidth available, in bytes. */
  freeNetUsed: number
  freeNetLimit: number
  /** Energy currently available (for TRC-20 calls). */
  energyUsed: number
  energyLimit: number
}

export type BroadcastResult = {
  /** Gateway-assigned transaction id (hex). */
  txid?: string
  /** Gateway `result` flag for pre-broadcast validation. */
  result?: boolean
  /** Gateway `code` — `SUCCESS` on accept, otherwise an error class. */
  code?: string
  /** Human-readable message (hex-encoded on some gateways). */
  message?: string
  /**
   * TronGrid bare-error shape (capital `E`) — returned for inputs the gateway
   * fails to even parse (e.g. malformed hex). Not paired with `result`/`code`.
   * Lowercase variant included for defensive coverage of mirror gateways.
   */
  Error?: string
  error?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  if (clean.length % 2 !== 0) throw new Error(`invalid hex length: ${clean.length}`)
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16)
  }
  return out
}

/**
 * Default per-request timeout (ms). TronGrid free-tier occasionally hangs on
 * `triggerconstantcontract` / `getnowblock` for 30+ seconds — without a
 * timeout, a fast-vault sign flow blocks indefinitely on the broadcast leg.
 */
const POST_JSON_TIMEOUT_MS = 15_000

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  // Hermes-compatible timeout: `AbortSignal.timeout()` is Node 17.3+ and not
  // available on older RN/Hermes runtimes. Build the same behaviour with
  // AbortController + setTimeout, and forward the caller's abort if any.
  const controller = new AbortController()
  const onExternalAbort = () => controller.abort(signal?.reason)
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason)
    else signal.addEventListener('abort', onExternalAbort, { once: true })
  }
  const timeoutId = setTimeout(() => controller.abort(new Error(`postJson timeout after ${POST_JSON_TIMEOUT_MS}ms: ${url}`)), POST_JSON_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    })
    if (!res.ok) {
      const preview = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status} ${res.statusText} from ${url}: ${preview.slice(0, 200)}`)
    }
    return (await res.json()) as T
  } finally {
    clearTimeout(timeoutId)
    if (signal) signal.removeEventListener('abort', onExternalAbort)
  }
}

// ---------------------------------------------------------------------------
// Block refs
// ---------------------------------------------------------------------------

type RawNowBlockResponse = {
  blockID: string
  block_header: {
    raw_data: {
      number: number
      timestamp: number
    }
  }
  // TronGrid bare-error envelope (see RawAccountResponse for full rationale).
  // Without this guard, `res.block_header.raw_data` throws a TypeError that
  // doesn't carry the gateway's actual error message — masking outages and
  // surfacing as confusing stack traces in production.
  Error?: string
  error?: string
}

/**
 * Fetch the latest block from TronGrid and return the `ref_block_*` fields
 * already formatted for `buildTronSendTx` / `buildTrc20TransferTx`.
 */
export async function getTronBlockRefs(apiUrl: string, signal?: AbortSignal): Promise<TronBlockRefs> {
  const res = await postJson<RawNowBlockResponse>(`${apiUrl.replace(/\/$/, '')}/wallet/getnowblock`, {}, signal)
  // Mirror the defensive shape from `getTronAccount` / `broadcastTronTx`:
  // capital-`E` `Error` is the bare-error envelope TronGrid returns when it
  // cannot even parse the request; lowercase covers mirror gateways.
  const tronError = res.Error ?? res.error
  if (tronError) {
    throw new Error(`getTronBlockRefs failed: ${tronError}`)
  }
  if (!res.block_header?.raw_data) {
    throw new Error(`getTronBlockRefs: response missing block_header.raw_data: ${JSON.stringify(res).slice(0, 200)}`)
  }
  const blockNumber = res.block_header.raw_data.number
  const blockTimestamp = res.block_header.raw_data.timestamp
  const blockIdHex = res.blockID

  // ref_block_bytes is the low 2 bytes of the block height. Masking with
  // 0xffff first and using unsigned right shift keeps the high byte correct
  // even if the block height ever exceeds 2^31 (currently it's ~76M, but the
  // protocol has no upper bound).
  const refBlockBytes = new Uint8Array(2)
  const low16 = blockNumber & 0xffff
  refBlockBytes[0] = (low16 >>> 8) & 0xff
  refBlockBytes[1] = low16 & 0xff

  // `ref_block_hash` is bytes 8..16 of the block id.
  if (blockIdHex.length < 32) {
    throw new Error(`blockID too short: ${blockIdHex.length}`)
  }
  const refBlockHash = hexToBytes(blockIdHex.substring(16, 32))

  return { blockNumber, blockTimestamp, refBlockBytes, refBlockHash, blockIdHex }
}

// ---------------------------------------------------------------------------
// Account info
// ---------------------------------------------------------------------------

type RawAccountResponse = {
  address?: string
  balance?: number | string
  // TronGrid sometimes returns `{Error: "..."}` (capital E) on HTTP 200 for
  // gateway-side rejections. Mirror gateways occasionally use lowercase.
  // Without a check here, the helper treats those responses as a never-funded
  // account and returns `balance: 0n` — masking outages and surfacing as
  // "user has no funds" in the UI.
  Error?: string
  error?: string
}

type RawAccountResourceResponse = {
  freeNetUsed?: number
  freeNetLimit?: number
  EnergyUsed?: number
  EnergyLimit?: number
  // Same defensive shape as RawAccountResponse — see comment above.
  Error?: string
  error?: string
}

/**
 * Fetch account balance + bandwidth/energy resources for a Tron address.
 * Safe to call on a never-funded address (returns zeroes for the
 * `getaccount` body, which legitimately lacks `balance`). Throws when
 * TronGrid surfaces a bare-error envelope on either call.
 */
export async function getTronAccount(address: string, apiUrl: string, signal?: AbortSignal): Promise<TronAccountInfo> {
  const base = apiUrl.replace(/\/$/, '')
  const [acct, res] = await Promise.all([
    postJson<RawAccountResponse>(`${base}/wallet/getaccount`, { address, visible: true }, signal),
    postJson<RawAccountResourceResponse>(`${base}/wallet/getaccountresource`, { address, visible: true }, signal),
  ])
  // Defensive parsing: never-funded accounts return `{}` (no `Error`, no
  // `balance`) — that's expected and yields zeroes. A bare-error shape is a
  // gateway-side rejection (rate limit, malformed input, internal error)
  // that must NOT silently degrade to "balance 0".
  const acctErr = acct.Error ?? acct.error
  if (acctErr) {
    throw new Error(`getTronAccount/getaccount failed: ${acctErr}`)
  }
  const resErr = res.Error ?? res.error
  if (resErr) {
    throw new Error(`getTronAccount/getaccountresource failed: ${resErr}`)
  }
  return {
    address,
    balance: acct.balance != null ? BigInt(acct.balance) : 0n,
    freeNetUsed: res.freeNetUsed ?? 0,
    freeNetLimit: res.freeNetLimit ?? 0,
    energyUsed: res.EnergyUsed ?? 0,
    energyLimit: res.EnergyLimit ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Energy estimation (TRC-20)
// ---------------------------------------------------------------------------

export type EstimateTrc20EnergyOptions = {
  tokenAddress: string
  from: string
  to: string
  amount: bigint
}

type RawEnergyEstimate = {
  result?: { result?: boolean; message?: string }
  energy_required?: number
  energy_used?: number
  // TronGrid emits a bare `{Error: "..."}` (capital E) on inputs it can't even
  // parse — e.g. malformed hex or invalid contract address. Some mirror
  // gateways use lowercase `error`. Either shape signals upstream rejection,
  // and silently returning `0` would let the caller broadcast the underlying
  // tx with no fee budget.
  Error?: string
  error?: string
}

/**
 * Estimate the energy cost of a TRC-20 transfer via
 * `/wallet/triggerconstantcontract`. Returns a conservative upper bound
 * (`energy_required` when present, else `energy_used`).
 */
export async function estimateTrc20Energy(
  opts: EstimateTrc20EnergyOptions,
  apiUrl: string,
  signal?: AbortSignal
): Promise<number> {
  // Build parameter hex without proto encoding — TronGrid's endpoint expects
  // raw ABI-encoded `transfer(address,uint256)` args (64 hex chars),
  // WITHOUT the 4-byte selector because `function_selector` conveys it.
  //
  // Format: [32-byte address left-padded][32-byte amount big-endian].
  //
  // We accept `to` as a Tron base58 address and strip the 0x41 prefix here.
  // The endpoint accepts both `Txxx` and `41xxx` styles as owner/contract
  // but the parameter payload must be 32-byte left-padded.

  const bs58checkMod = bs58check as unknown as { decode?: (s: string) => Uint8Array } & {
    default?: { decode: (s: string) => Uint8Array }
  }
  const decode = bs58checkMod.decode ?? bs58checkMod.default?.decode
  if (!decode) throw new Error('bs58check.decode unavailable')
  const raw = decode(opts.to)
  if (raw.length !== 21 || raw[0] !== 0x41) {
    throw new Error(`invalid tron address: ${opts.to}`)
  }
  const addrHex = Array.from(raw.subarray(1))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  const paddedAddr = '0'.repeat(64 - addrHex.length) + addrHex

  let v = opts.amount
  if (v < 0n) throw new Error(`amount must be non-negative`)
  const amtBytes: string[] = []
  for (let i = 0; i < 32; i++) {
    amtBytes.unshift(
      Number(v & 0xffn)
        .toString(16)
        .padStart(2, '0')
    )
    v >>= 8n
  }
  const parameter = paddedAddr + amtBytes.join('')

  const res = await postJson<RawEnergyEstimate>(
    `${apiUrl.replace(/\/$/, '')}/wallet/triggerconstantcontract`,
    {
      owner_address: opts.from,
      contract_address: opts.tokenAddress,
      function_selector: 'transfer(address,uint256)',
      parameter,
      visible: true,
    },
    signal
  )
  // Mirror broadcastTronTx defensive parsing: TronGrid sometimes emits
  // `{Error: "..."}` / `{error: "..."}` with no `result` envelope. Returning
  // `0` for these would let the caller send a TRC-20 transfer with zero
  // energy budget, which TronGrid then drops at broadcast time — wasted
  // bandwidth and a confusing UX. Throw so the caller surfaces the failure.
  const tronError = res.Error ?? res.error
  if (tronError) {
    throw new Error(`triggerconstantcontract failed: ${tronError}`)
  }
  if (res.result && res.result.result === false) {
    const msg = res.result.message ?? 'unknown'
    throw new Error(`triggerconstantcontract failed: ${msg}`)
  }
  return res.energy_required ?? res.energy_used ?? 0
}

// ---------------------------------------------------------------------------
// Broadcast
// ---------------------------------------------------------------------------

/**
 * Broadcast a signed transaction (hex-encoded by `TronTxBuilderResult.finalize`).
 * Throws if TronGrid rejects it pre-propagation (`result=false` or
 * `code != SUCCESS`).
 */
export async function broadcastTronTx(
  signedTxHex: string,
  apiUrl: string,
  signal?: AbortSignal
): Promise<BroadcastResult> {
  const res = await postJson<BroadcastResult>(
    `${apiUrl.replace(/\/$/, '')}/wallet/broadcasthex`,
    { transaction: signedTxHex },
    signal
  )
  // TronGrid returns a bare `{Error: "..."}` (capital `E`, no `result`, no
  // `code`) for inputs it can't even parse — e.g. malformed hex. Treat that
  // shape as a failure too. Some mirror gateways use lowercase `error`.
  const tronError = res.Error ?? res.error
  if (tronError || res.result === false || (res.code && res.code !== 'SUCCESS')) {
    const msg = tronError ?? res.message ?? res.code ?? 'unknown'
    throw new Error(`tron broadcast failed: ${msg}`)
  }
  return res
}
