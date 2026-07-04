/**
 * buildAstroportSwap — Astroport router swap on Terra v2 (phoenix-1).
 *
 * Builds an unsigned CosmWasm `wasm_execute` envelope against the Astroport
 * router that swaps `offerAssetDenom` for `askAssetDenom` directly on
 * phoenix-1 — no Skip / Axelar / IBC. Sub-bridge latency for in-chain
 * LUNA ↔ ASTRO / ampLUNA / aUSD / etc.
 *
 * Pure-crypto: quotes (read-only `simulate_swap_operations`) and builds the
 * unsigned execute payload. It NEVER signs or broadcasts — the returned
 * envelope is handed to the Vultisig SDK signing path by the consumer.
 *
 * Two execute shapes are produced depending on the offer asset:
 *
 *   - Native offer (e.g. `uluna`): direct call to the router with
 *       msg = { execute_swap_operations: { operations, minimum_receive, to } }
 *       funds = [{ denom, amount }]
 *
 *   - CW20 offer (e.g. an ASTRO contract address): a `Cw20ReceiveMsg`
 *     envelope through the CW20 contract, which forwards funds to the router.
 *     The inner execute_swap_operations payload is base64-encoded per the
 *     CW20 spec:
 *       contract = CW20_ADDR
 *       msg = { send: { contract: ROUTER, amount, msg: <base64> } }
 *       funds = []
 *
 * Quote step uses the router's `simulate_swap_operations` smart query. That
 * endpoint only returns `{ amount }` — commission/spread are pool-level
 * details the multi-hop router does not expose. We surface what the router
 * returns and derive `minReceive` = quote × (1 − slippage).
 *
 * Route assembly uses `astro_swap` operations exclusively. NativeSwap is a
 * Terra Classic / market-module construct that does not apply on phoenix-1.
 * The router auto-routes through pools; if no route exists the simulate query
 * surfaces a `pair_info ... not found` error cleanly.
 *
 * Ported from mcp-ts `src/tools/swap/astroport-swap.ts`. The Skip-fallback,
 * Blockaid scan-request wrapping, quest-metadata and price-oracle USD
 * derivation are orchestration concerns and stay in the consumer — they are
 * intentionally NOT part of this SDK primitive.
 */
import { bech32 } from '@scure/base'

// Astroport core deployment on phoenix-1, sourced from
// astroport-fi/astroport-changelog/terra-2/phoenix-1/core_phoenix.json.
// Verified on chain: `contract_info.label = "Astroport Router"`. If Astroport
// ever migrates the router, this constant is the single point of update.
export const ASTROPORT_ROUTER = 'terra18plp90j0zd596zt3zdsf0w9vvk5ukwlwzwkksxv9mdu8rscat9sqndk5qz'
export const TERRA_LCD = 'https://terra-lcd.publicnode.com'
export const TERRA_CHAIN_ID = 'phoenix-1'
const TERRA_BECH32_PREFIX = 'terra'
const DEFAULT_SLIPPAGE = 0.01
// Capped at 5% to align with the Skip swap surface floor. Pre-cap 50% would
// let thin-pool swaps slip a user out of meaningful value silently.
const MAX_SLIPPAGE = 0.05
// Generous gas — multi-hop swaps through 2-3 pools fit under 600k. Matches
// Astroport's own frontend default.
const SWAP_GAS = 600_000

type AssetInfo = { native_token: { denom: string } } | { token: { contract_addr: string } }

type AstroSwapOperation = {
  astro_swap: {
    offer_asset_info: AssetInfo
    ask_asset_info: AssetInfo
  }
}

export type BuildAstroportSwapParams = {
  /** Sender address on phoenix-1 (terra1...). The vault-derived signer. */
  fromAddress: string
  /** Offer asset: native bank denom (`uluna`, `factory/...`, `ibc/...`) or CW20 contract address (`terra1...` 32-byte). */
  offerAssetDenom: string
  /** Amount of offer asset in base units (positive integer decimal string). */
  offerAmount: string
  /** Ask asset: native bank denom or CW20 contract address (same shape as `offerAssetDenom`). */
  askAssetDenom: string
  /** Max slippage as a fraction. Default 0.01 (1%), max 0.05 (5%). */
  slippageTolerance?: number
  /** Optional explicit recipient (terra1...). Omit for "send to signer" (safe default). */
  recipientAddress?: string
  /** Override LCD endpoint (defaults to {@link TERRA_LCD}). */
  lcdUrl?: string
}

/** The unsigned wasm_execute envelope returned by {@link buildAstroportSwap}. */
export type AstroportSwapResult = {
  txType: 'wasm_execute'
  chain: 'Terra'
  chainId: typeof TERRA_CHAIN_ID
  fromAddress: string
  contractAddress: string
  /** JSON-stringified CosmWasm execute message. */
  executeMsg: string
  funds: { denom: string; amount: string }[]
  gas: number
  /** Present only when an explicit third-party recipient was supplied. */
  toAddress?: string
  recipientMode: 'self' | 'third_party'
  quote: {
    offerAsset: string
    offerAmount: string
    askAsset: string
    expectedAskAmount: string
    minReceive: string
    slippageTolerance: number
  }
  route: {
    routerContract: string
    operations: AstroSwapOperation[]
  }
}

type SimulateResponse = {
  data?: { amount?: string }
}

function trimRequired(value: string, fieldName: string): string {
  const trimmed = (value ?? '').trim()
  if (!trimmed) {
    throw new Error(`${fieldName} is required`)
  }
  return trimmed
}

/**
 * Validate a phoenix-1 bech32 account/contract address (terra1...). Rejects a
 * malformed address at build time rather than at sign time.
 */
function validateTerraAddress(value: string, fieldName: string): string {
  const trimmed = trimRequired(value, fieldName)

  let decoded: ReturnType<typeof bech32.decode>
  try {
    decoded = bech32.decode(trimmed as `${string}1${string}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`invalid ${fieldName}: malformed bech32 encoding (${message})`)
  }

  if (decoded.prefix !== TERRA_BECH32_PREFIX) {
    throw new Error(`invalid ${fieldName}: expected ${TERRA_BECH32_PREFIX} prefix, got ${decoded.prefix}`)
  }

  let payload: Uint8Array
  try {
    payload = bech32.fromWords(decoded.words)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`invalid ${fieldName}: malformed bech32 data (${message})`)
  }

  // 20 bytes = standard account, 32 bytes = CosmWasm contract address.
  if (payload.length !== 20 && payload.length !== 32) {
    throw new Error(`invalid ${fieldName}: expected 20- or 32-byte payload, got ${payload.length}`)
  }

  // Canonicalize to lowercase. bech32.decode confirmed case-uniformity above, so
  // this is a safe canonical fold. CosmWasm `addr_validate` rejects an uppercase
  // `TERRA1...` (or `to`) with "address not normalized" at execute time; folding
  // here keeps the built `fromAddress` / inner `to` execute-ready, matching the
  // CW20 contract-address normalization in classifyAstroportAsset.
  return trimmed.toLowerCase()
}

/**
 * Classify an asset denom into its Astroport `AssetInfo` shape.
 *   - `native_token` — Cosmos-SDK bank denom (`uluna`, `factory/...`, `ibc/...`)
 *   - `token` — CW20 contract address (a 32-byte `terra1...` bech32)
 *
 * A `terra1...` prefix is an unambiguous signal that the caller intended a
 * bech32 contract address. If the string fails bech32 decode it is rejected
 * loudly (model fabrication) rather than silently treated as a native denom —
 * native phoenix-1 denoms NEVER start with `terra1`.
 *
 * Exported for testing.
 */
export function classifyAstroportAsset(denom: string, fieldName: string): AssetInfo {
  const trimmed = trimRequired(denom, fieldName)

  // bech32 HRP is case-insensitive per BIP-173, so the branch check is too.
  if (trimmed.toLowerCase().startsWith(`${TERRA_BECH32_PREFIX}1`)) {
    let decoded: ReturnType<typeof bech32.decode>
    try {
      decoded = bech32.decode(trimmed as `${string}1${string}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(
        `invalid ${fieldName}: "${trimmed}" has a terra1 prefix but is not valid bech32 (${message}). ` +
          `Resolve the contract address, or pass a native bank denom (uluna, factory/..., ibc/...) instead.`
      )
    }
    if (decoded.prefix !== TERRA_BECH32_PREFIX) {
      throw new Error(`invalid ${fieldName}: expected ${TERRA_BECH32_PREFIX} prefix, got ${decoded.prefix}`)
    }
    const payload = bech32.fromWords(decoded.words)
    if (payload.length === 32) {
      // Canonicalize to lowercase: cosmwasm `addr_validate` rejects
      // `TERRA1...` with "address not normalized". bech32.decode already
      // confirmed case-uniformity, so this is a safe canonical fold.
      return { token: { contract_addr: trimmed.toLowerCase() } }
    }
    if (payload.length === 20) {
      throw new Error(
        `invalid ${fieldName}: "${trimmed}" looks like a user account, not a CW20 contract or native denom`
      )
    }
    throw new Error(`invalid ${fieldName}: unexpected bech32 payload length ${payload.length}`)
  }

  // Native/factory/IBC denom. The LCD is the source of truth (unknown denoms
  // surface a structured "pair_info ... not found" simulate error).
  return { native_token: { denom: trimmed } }
}

function validateAmount(value: string): string {
  const trimmed = trimRequired(value, 'offerAmount')
  if (!/^[0-9]+$/.test(trimmed)) {
    throw new Error(`invalid offerAmount: "${trimmed}" must be a positive integer in base units`)
  }
  if (trimmed === '0' || /^0+$/.test(trimmed)) {
    throw new Error('invalid offerAmount: must be greater than zero')
  }
  return trimmed
}

function validateSlippage(value: number | undefined): number {
  const slip = value ?? DEFAULT_SLIPPAGE
  if (!Number.isFinite(slip) || slip < 0 || slip > MAX_SLIPPAGE) {
    throw new Error(`invalid slippageTolerance: ${slip} (must be in [0, ${MAX_SLIPPAGE}])`)
  }
  return slip
}

/**
 * quote × (1 − slippage), integer-only via bps to avoid float drift on the
 * signed payload. 0.01 → 100 bps; 0 slippage → no haircut.
 *
 * Exported for testing.
 */
export function computeAstroportMinReceive(quoteAmount: string, slippage: number): string {
  const quote = BigInt(quoteAmount)
  const slippageBps = BigInt(Math.round(slippage * 10_000))
  const numerator = quote * (10_000n - slippageBps)
  return (numerator / 10_000n).toString()
}

/**
 * Assemble the unsigned Astroport router operations + execute envelope without
 * the network round-trip. Exposed so callers (and tests) can build the payload
 * deterministically given a quote they already hold.
 *
 * Exported for testing.
 */
export function assembleAstroportSwap(params: BuildAstroportSwapParams, quoteAmount: string): AstroportSwapResult {
  const from = validateTerraAddress(params.fromAddress, 'fromAddress')
  // Only carry an explicit `to` into the inner msg when the caller passes
  // `recipientAddress`. Astroport's router treats a missing `to` as "send to
  // the message sender" — the vault-derived signer, the safe default. Never
  // default `to` to `fromAddress` (a prompt-injected sender could redirect
  // proceeds).
  const explicitRecipient = params.recipientAddress
    ? validateTerraAddress(params.recipientAddress, 'recipientAddress')
    : undefined
  const offerAmount = validateAmount(params.offerAmount)
  const slippage = validateSlippage(params.slippageTolerance)
  if (!/^[0-9]+$/.test(quoteAmount)) {
    throw new Error(`invalid quoteAmount: "${quoteAmount}"`)
  }

  const offerAsset = classifyAstroportAsset(params.offerAssetDenom, 'offerAssetDenom')
  const askAsset = classifyAstroportAsset(params.askAssetDenom, 'askAssetDenom')

  const operations: AstroSwapOperation[] = [
    {
      astro_swap: {
        offer_asset_info: offerAsset,
        ask_asset_info: askAsset,
      },
    },
  ]

  const minReceive = computeAstroportMinReceive(quoteAmount, slippage)

  const executeSwapOperations: {
    operations: AstroSwapOperation[]
    minimum_receive: string
    to?: string
  } = {
    operations,
    minimum_receive: minReceive,
  }
  if (explicitRecipient !== undefined) {
    executeSwapOperations.to = explicitRecipient
  }
  const innerExecute = { execute_swap_operations: executeSwapOperations }

  let contractAddress: string
  let executeMsg: object
  let funds: { denom: string; amount: string }[]

  if ('native_token' in offerAsset) {
    contractAddress = ASTROPORT_ROUTER
    executeMsg = innerExecute
    funds = [{ denom: offerAsset.native_token.denom, amount: offerAmount }]
  } else {
    // CW20 offer: forward funds to the router via Cw20ReceiveMsg. The inner
    // execute_swap_operations payload is base64-encoded per CW20 spec — the
    // router's `Receive` handler decodes and dispatches.
    contractAddress = offerAsset.token.contract_addr
    const innerB64 = Buffer.from(JSON.stringify(innerExecute), 'utf8').toString('base64')
    executeMsg = {
      send: {
        contract: ASTROPORT_ROUTER,
        amount: offerAmount,
        msg: innerB64,
      },
    }
    funds = []
  }

  return {
    txType: 'wasm_execute',
    chain: 'Terra',
    chainId: TERRA_CHAIN_ID,
    fromAddress: from,
    contractAddress,
    executeMsg: JSON.stringify(executeMsg),
    funds,
    gas: SWAP_GAS,
    // Surface the recipient signal at the top level so the approval layer does
    // not have to decode the nested (possibly base64'd) execute_msg.
    ...(explicitRecipient
      ? { toAddress: explicitRecipient, recipientMode: 'third_party' as const }
      : { recipientMode: 'self' as const }),
    quote: {
      offerAsset: params.offerAssetDenom,
      offerAmount,
      askAsset: params.askAssetDenom,
      expectedAskAmount: quoteAmount,
      minReceive,
      slippageTolerance: slippage,
    },
    route: {
      routerContract: ASTROPORT_ROUTER,
      operations,
    },
  }
}

/**
 * Query the Astroport router's `simulate_swap_operations` smart endpoint to
 * obtain the expected ask amount for the given operations. Read-only.
 */
async function querySimulate(lcdUrl: string, operations: AstroSwapOperation[], offerAmount: string): Promise<string> {
  const simulateQuery = JSON.stringify({
    simulate_swap_operations: { offer_amount: offerAmount, operations },
  })
  const simulateB64 = Buffer.from(simulateQuery, 'utf8').toString('base64')
  const url = `${lcdUrl}/cosmwasm/wasm/v1/contract/${ASTROPORT_ROUTER}/smart/${simulateB64}`

  const response = await fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    // Body verbatim — preserve `code`/`message`/`details` for the caller. A
    // missing pool surfaces here as "pair_info ... not found".
    const body = await response.text()
    throw new Error(`HTTP ${response.status}: ${body}`)
  }
  const json = (await response.json()) as SimulateResponse
  const amount = json.data?.amount
  if (!amount || !/^[0-9]+$/.test(amount)) {
    throw new Error(`astroport simulate returned malformed amount: ${JSON.stringify(json)}`)
  }
  return amount
}

/**
 * Build an unsigned Astroport router swap on Terra v2 (phoenix-1).
 *
 * Quotes via the router's read-only `simulate_swap_operations` smart query,
 * then assembles the unsigned `wasm_execute` envelope. Does NOT sign or
 * broadcast.
 *
 * @example
 * ```ts
 * const swap = await buildAstroportSwap({
 *   fromAddress: 'terra1...',
 *   offerAssetDenom: 'uluna',
 *   offerAmount: '1000000',
 *   askAssetDenom: 'terra1...astro-cw20...',
 *   slippageTolerance: 0.01,
 * })
 * // swap.executeMsg is ready to be signed/broadcast by the Vultisig SDK
 * ```
 */
export async function buildAstroportSwap(params: BuildAstroportSwapParams): Promise<AstroportSwapResult> {
  // Validate inputs eagerly so a bad request fails before the network call.
  validateTerraAddress(params.fromAddress, 'fromAddress')
  const offerAmount = validateAmount(params.offerAmount)
  validateSlippage(params.slippageTolerance)

  const offerAsset = classifyAstroportAsset(params.offerAssetDenom, 'offerAssetDenom')
  const askAsset = classifyAstroportAsset(params.askAssetDenom, 'askAssetDenom')
  const operations: AstroSwapOperation[] = [
    {
      astro_swap: {
        offer_asset_info: offerAsset,
        ask_asset_info: askAsset,
      },
    },
  ]

  const lcdUrl = params.lcdUrl ?? TERRA_LCD
  let quoteAmount: string
  try {
    quoteAmount = await querySimulate(lcdUrl, operations, offerAmount)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(
      `astroport simulate_swap_operations failed for ${params.offerAssetDenom} → ${params.askAssetDenom}: ${message}`
    )
  }

  return assembleAstroportSwap(params, quoteAmount)
}
