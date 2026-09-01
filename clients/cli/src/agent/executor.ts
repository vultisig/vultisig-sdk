/**
 * Agent Action Executor
 *
 * Per-tool handlers invoked from `dispatchClientSideTool` (client-side tool
 * path) and `signTxFromBuffer` (tx_ready synthesis path) in session.ts.
 * Each handler takes `(toolCallId, input)` and returns a `RecentAction` ready
 * to be flushed into the next outbound `context.recent_actions`.
 */
import type {
  EvmChain,
  ParsedTxReadyEnvelope,
  ParsedTxReadySend,
  ParsedTxReadyThorLpDeposit,
  ParsedTxReadyThorSwapDeposit,
  VaultBase,
  Vultisig,
} from '@vultisig/sdk'
import {
  Chain,
  clampEvmPriorityFee,
  computeEip712Hash,
  getChainKind,
  getEvmRpcUrl,
  knownTokensIndex,
  parseTxReadyEnvelope,
  pollTxStatusUntilFinal,
  resolveChainReference,
  toCanonicalEvmSignature,
  TxReadyParseError,
  VaultError,
  VaultErrorCode,
  Vultisig as VultisigSdk,
} from '@vultisig/sdk'
import { type Address, decodeFunctionData, formatUnits, type Hex, parseAbi, recoverAddress } from 'viem'

import { VaultStateStore } from '../core/VaultStateStore'
import { normalizeAgentError } from './agentErrors'
import {
  assertNoRecentDuplicate,
  type BroadcastIntent,
  type BroadcastReservation,
  computeFingerprint,
  recordBroadcast,
  reserveBroadcast,
} from './broadcastJournal'
import {
  type HlOrderSigningPayload,
  type HlOrderTransport,
  isHlOrderFailure,
  pollHlOrderStatus,
  validateHlSigningPayload,
} from './hlOrder'
import type { RecentAction } from './types'

// EVM chains that use nonce-based transaction ordering
const EVM_CHAINS = new Set<string>([
  'Ethereum',
  'BSC',
  'Polygon',
  'Avalanche',
  'Arbitrum',
  'Optimism',
  'Base',
  'Blast',
  'Zksync',
  'Mantle',
  'CronosChain',
  'Hyperliquid',
  'Sei',
])

const ERC20_TRANSFER_SELECTOR = '0xa9059cbb'
const ERC20_TRANSFER_ABI = parseAbi(['function transfer(address to, uint256 value)'])

/** Decode the recipient and amount that an ERC-20 transfer will actually use. */
function decodeErc20Transfer(calldata: string): { recipient: Address; amount: bigint } | null {
  if (calldata.slice(0, ERC20_TRANSFER_SELECTOR.length).toLowerCase() !== ERC20_TRANSFER_SELECTOR) return null

  try {
    const decoded = decodeFunctionData({
      abi: ERC20_TRANSFER_ABI,
      data: calldata as Hex,
    })
    const [recipient, amount] = decoded.args as readonly [Address, bigint]
    return { recipient, amount }
  } catch {
    throw new Error('Invalid ERC-20 transfer calldata — refusing to sign')
  }
}

type ResolvedTokenIdentity = {
  rawSymbol: string
  displaySymbol: string
  kind: 'native' | 'token' | 'unresolved'
  contract?: string
}

const tokenLabel = (value: unknown): string => (typeof value === 'string' ? value : '')

// Real token symbols stay far below this; longer "symbols" are either spoof
// carriers (an embedded Solana mint is 44 chars) or hostile padding for the
// descriptor regexes below, which backtrack superlinearly on long inputs.
const MAX_TOKEN_SYMBOL_LENGTH = 32
const MAX_TOKEN_LABEL_LENGTH = 512

/** Keep descriptor-shaped, attacker-controlled symbol text out of the consent line. */
function safeTokenSymbol(symbol: string): {
  displaySymbol: string
  suspicious: boolean
} {
  const defaultDisplaySymbol = symbol.match(/^[\p{L}\p{N}][\p{L}\p{N}._+-]{0,31}/u)?.[0] ?? 'token'
  if (symbol.length > MAX_TOKEN_SYMBOL_LENGTH) {
    return { displaySymbol: defaultDisplaySymbol, suspicious: true }
  }
  const suspiciousAt = symbol.search(/0x[0-9a-f]{40}|\([^)]*\bon\b[^)]*\)/iu)
  const candidate = (suspiciousAt < 0 ? symbol : symbol.slice(0, suspiciousAt)).trim()
  const displaySymbol = candidate.match(/^[\p{L}\p{N}][\p{L}\p{N}._+-]*/u)?.[0] ?? 'token'
  if (suspiciousAt < 0 && candidate === displaySymbol) {
    return { displaySymbol, suspicious: false }
  }

  return { displaySymbol, suspicious: true }
}

function unresolvedTokenIdentity(label: unknown): ResolvedTokenIdentity {
  if (typeof label !== 'string' || label.length > MAX_TOKEN_LABEL_LENGTH) {
    return { rawSymbol: '', displaySymbol: '', kind: 'unresolved' }
  }
  const suffixAt = label.lastIndexOf(' (')
  const rawSymbol = (suffixAt > 0 ? label.slice(0, suffixAt) : label).trim()
  return {
    rawSymbol,
    displaySymbol: safeTokenSymbol(rawSymbol).displaySymbol,
    kind: 'unresolved',
  }
}

function untrustedSymbolIdentity(symbol: unknown): ResolvedTokenIdentity {
  const rawSymbol = tokenLabel(symbol)
  return {
    rawSymbol,
    displaySymbol: safeTokenSymbol(rawSymbol).displaySymbol,
    kind: 'unresolved',
  }
}

/** Parse and chain-check mcp-ts's fixed-suffix token descriptor. */
function resolvedTokenIdentity(label: unknown, expectedChain: unknown): ResolvedTokenIdentity {
  const unresolved = unresolvedTokenIdentity(label)
  if (typeof label !== 'string' || label.length > MAX_TOKEN_LABEL_LENGTH) return unresolved
  const match = label.match(/^([\s\S]*) \(([\s\S]*?) on ([^,]+), \d+ dec, source: [^)]+\)$/u)
  if (!match) return unresolved

  const [, rawSymbol, rawAssetId, descriptorChain] = match
  const { displaySymbol, suspicious } = safeTokenSymbol(rawSymbol)
  const parsedChain = resolveChainReference(descriptorChain)
  const routedChain =
    typeof expectedChain === 'string' || typeof expectedChain === 'number'
      ? resolveChainReference(expectedChain)
      : undefined
  if (suspicious || !parsedChain || !routedChain || parsedChain !== routedChain) {
    return { rawSymbol, displaySymbol, kind: 'unresolved' }
  }

  const assetId = rawAssetId.trim()
  if (!assetId) return { rawSymbol, displaySymbol, kind: 'unresolved' }
  if (assetId.toLowerCase() === 'native') return { rawSymbol, displaySymbol, kind: 'native' }
  if (getChainKind(routedChain) === 'evm') {
    if (!/^0x[0-9a-f]{40}$/iu.test(assetId)) return { rawSymbol, displaySymbol, kind: 'unresolved' }
  } else if (!/^[\p{L}\p{N}:._/-]{1,128}$/u.test(assetId)) {
    // Non-EVM asset ids (Solana mints, Cosmos denoms, THOR assets) have no
    // single shape, but none contain whitespace or control characters — and
    // this string is interpolated into the consent line.
    return { rawSymbol, displaySymbol, kind: 'unresolved' }
  }
  return { rawSymbol, displaySymbol, kind: 'token', contract: assetId }
}

function replaceUnsafeSymbol(text: string, identity: ResolvedTokenIdentity): string {
  if (!identity.rawSymbol || identity.rawSymbol === identity.displaySymbol) return text
  return text.split(identity.rawSymbol).join(identity.displaySymbol)
}

/**
 * Anchor only at the END of a trade half: a complete asset label (never a
 * prefix such as USDT inside USDT.e) whose match closes the half. Interior
 * matches are refused — route prose can mention any symbol, and annotating
 * an interior mention would misattribute the contract.
 */
function anchorEnd(text: string, label: string): number {
  if (!label) return -1
  const tokenChar = /[\p{L}\p{N}._+-]/u
  const trimmedLength = text.trimEnd().length
  const index = trimmedLength - label.length
  if (index < 0 || !text.startsWith(label, index)) return -1
  const before = text[index - 1]
  if (before && tokenChar.test(before)) return -1
  return trimmedLength
}

function hasAnchor(text: string, anchors: string[]): boolean {
  return anchors.some(anchor => anchorEnd(text, anchor) >= 0)
}

/** A quote summary must describe exactly one sell-to-buy transition. */
function hasSingleSwapDelimiter(summary: string, labels: Record<string, unknown>): boolean {
  // Ignore arrows embedded in declared symbols: those symbols are sanitized
  // before rendering and therefore are not structural route delimiters.
  const identities = [
    unresolvedTokenIdentity(labels.from_token),
    untrustedSymbolIdentity(labels.from_token_symbol),
    unresolvedTokenIdentity(labels.to_token),
    untrustedSymbolIdentity(labels.to_token_symbol),
  ]
  const structuralSummary = identities.reduce((text, identity) => replaceUnsafeSymbol(text, identity), summary)
  const firstArrow = structuralSummary.indexOf('→')
  return firstArrow >= 0 && structuralSummary.indexOf('→', firstArrow + 1) < 0
}

/** Choose the trade arrow whose halves contain the declared sell/buy labels. */
function splitSwapHead(head: string, sellAnchors: string[], buyAnchors: string[]) {
  let best: { left: string; buy: string; provider: string; score: number } | undefined
  let arrowAt = head.indexOf('→')
  while (arrowAt >= 0) {
    const left = head.slice(0, arrowAt)
    const right = head.slice(arrowAt + 1)
    const viaAt = right.indexOf(' via ')
    const buy = viaAt >= 0 ? right.slice(0, viaAt) : right
    const provider = viaAt >= 0 ? right.slice(viaAt) : ''
    const score = Number(hasAnchor(left, sellAnchors)) + Number(hasAnchor(buy, buyAnchors))
    if (!best || score > best.score) {
      best = { left, buy, provider, score }
    }
    arrowAt = head.indexOf('→', arrowAt + 1)
  }
  return best
}

function terminalAnchorSymbol(anchor: string): string {
  return anchor.trim().match(/[\p{L}\p{N}][\p{L}\p{N}._+-]*$/u)?.[0] ?? ''
}

function discloseSwapSide(side: string, anchors: string[], suffix: string, expectedSymbol?: string): string {
  if (!expectedSymbol) {
    return `${side.trimEnd()} (contract unavailable)${side.slice(side.trimEnd().length)}`
  }
  for (const anchor of anchors) {
    const end = anchorEnd(side, anchor)
    if (end < 0) continue
    const visibleSymbol = terminalAnchorSymbol(anchor)
    if (expectedSymbol && visibleSymbol && visibleSymbol !== expectedSymbol) break
    if (!suffix) return side
    return `${side.slice(0, end)}${suffix}${side.slice(end)}`
  }
  return `${side.trimEnd()} (contract unavailable)${side.slice(side.trimEnd().length)}`
}

/**
 * Add contract truth to each resolved trade half. The sell address comes from
 * the signed approval payload when present, otherwise from a chain-checked
 * label claim. The buy address remains a chain-checked label claim. Unresolved
 * identities fail closed without attaching a concrete contract.
 */
function discloseSwapTokenContracts(
  head: string,
  labels: Record<string, unknown>,
  payload: any,
  sourceChain: Chain
): string {
  // The routed destination lives in `labels.to_chain` (the mcp-ts prep
  // envelope has no top-level `to_chain`). A legacy top-level value may stand
  // in when the label is absent. Preserve an unsupported present label so
  // resolvedTokenIdentity rejects it instead of trusting a contradictory
  // payload fallback; if neither route exists, the descriptor must not
  // authenticate its own chain.
  const destinationChain = Object.hasOwn(labels, 'to_chain')
    ? (labels.to_chain ?? null)
    : typeof payload?.to_chain === 'string' || typeof payload?.to_chain === 'number'
      ? payload.to_chain
      : undefined
  const fromToken = resolvedTokenIdentity(labels.from_token, sourceChain)
  const toToken = resolvedTokenIdentity(labels.to_token, destinationChain)
  const fromSymbol = untrustedSymbolIdentity(labels.from_token_symbol)
  const toSymbol = untrustedSymbolIdentity(labels.to_token_symbol)
  // Mirror the approve-leg signer exactly: signMultiLeg re-parents
  // approvalTxArgs as `txArgs` and clears the sibling tx fields, so the
  // signed approve target is `approvalTxArgs.tx.to` and nothing else.
  // Reading any other nested shape here (the extractNestedTx precedence
  // chain) would let a hostile envelope render one address while the signer
  // broadcasts an approve to another.
  const approvalArgs = payload?.approvalTxArgs
  const rawApprovalTarget = tokenLabel(
    approvalArgs && typeof approvalArgs === 'object' ? approvalArgs.tx?.to : undefined
  )
  const approvalTarget = /^0x[0-9a-f]{40}$/iu.test(rawApprovalTarget) ? rawApprovalTarget : ''

  const symbolIdentities = [fromToken, fromSymbol, toToken, toSymbol]
  const sanitizeText = (value: unknown) =>
    symbolIdentities.reduce((text, identity) => replaceUnsafeSymbol(text, identity), tokenLabel(value))
  const sanitizedHead = sanitizeText(head)
  const sellAnchors = [sanitizeText(labels.amount_in), fromSymbol.displaySymbol, fromToken.displaySymbol].filter(
    Boolean
  )
  const buyAnchors = [sanitizeText(labels.expected_output), toSymbol.displaySymbol, toToken.displaySymbol].filter(
    Boolean
  )

  const approvalMatchesResolvedSellToken =
    fromToken.kind === 'token' &&
    !!fromToken.contract &&
    !!approvalTarget &&
    fromToken.contract.toLowerCase() === approvalTarget.toLowerCase()
  const sellSuffix = payload?.approvalTxArgs
    ? approvalMatchesResolvedSellToken
      ? ` (${approvalTarget})`
      : ' (contract unavailable)'
    : fromToken.kind === 'native'
      ? ''
      : fromToken.kind === 'token' && fromToken.contract
        ? ` (${fromToken.contract})`
        : ' (contract unavailable)'
  const buySuffix =
    toToken.kind === 'native'
      ? ''
      : toToken.kind === 'token' && toToken.contract
        ? ` (${toToken.contract})`
        : ' (contract unavailable)'

  const halves = splitSwapHead(sanitizedHead, sellAnchors, buyAnchors)
  if (!halves) return `${sanitizedHead} (contract unavailable)`
  const sellResolved = fromToken.kind !== 'unresolved'
  const buyResolved = toToken.kind !== 'unresolved'
  const sell = discloseSwapSide(
    halves.left,
    sellAnchors,
    sellResolved ? sellSuffix : '',
    sellResolved ? fromToken.displaySymbol : undefined
  )
  const buy = discloseSwapSide(
    halves.buy,
    buyAnchors,
    buyResolved ? buySuffix : '',
    buyResolved ? toToken.displaySymbol : undefined
  )
  return `${sell}→${buy}${halves.provider}`
}

// `Set<string>.has()` returns a plain boolean, so it never narrows `Chain` down to
// the `EvmChain` union that `getEvmRpcUrl` takes. This predicate keeps membership
// byte-identical to the set above rather than delegating to `isChainOfKind(chain,
// 'evm')`: the canonical chain-kind record also classifies Robinhood as EVM, and
// switching would newly route it through nonce locking, nonce patching and gas
// bumping. That is a money-path change and does not belong in a typing fix.
const isEvmChain = (chain: Chain): chain is EvmChain => EVM_CHAINS.has(chain)

type AccountCoin = {
  chain: Chain
  address: string
  decimals: number
  ticker: string
  id?: string
}

type StoredPayload = {
  payload: any
  coin: AccountCoin
  chain: Chain
  timestamp: number
}

function stripEmbeddedPayloadContract(value: string, disclosedContract: string): string {
  if (!disclosedContract) return value
  const escapedContract = disclosedContract.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const normalizedContract = disclosedContract.toLowerCase()
  return value
    .replace(new RegExp(escapedContract, 'gi'), '')
    .replace(/0x([0-9a-fA-F]{2,8})(?:…|\.{3})([0-9a-fA-F]{2,8})/g, (match, prefix: string, suffix: string) => {
      const normalizedPrefix = `0x${prefix}`.toLowerCase()
      return normalizedContract.startsWith(normalizedPrefix) && normalizedContract.endsWith(suffix.toLowerCase())
        ? ''
        : match
    })
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function formatTokenContractDisclosure(disclosedContract: string): string {
  return disclosedContract ? ` (token contract ${disclosedContract})` : ''
}

export class AgentExecutor {
  private vault: VaultBase
  /** Owning SDK (optional); used for address book backed by app storage */
  private vultisig: Vultisig | undefined
  private pendingPayloads = new Map<string, StoredPayload>()
  /**
   * Buffered legs for a 2-leg mcp-ts execute_* envelope (approve + main).
   * Populated by storeServerTransaction when both `approvalTxArgs` and
   * `txArgs` are present; consumed and cleared by signMultiLeg.
   */
  private pendingLegs: Array<{
    txArgs: any
    parent: any
    kind: 'approve' | 'main'
  }> = []
  private password: string | null = null
  private verbose: boolean
  private stateStore: VaultStateStore | null = null
  /** Held chain lock release functions, keyed by chain name */
  private chainLockReleases = new Map<string, () => Promise<void>>()
  private evmLastBroadcast = new Map<string, number>()
  // When true, bypass the persistent broadcast-journal duplicate guard (the
  // `--force` escape hatch). Off by default: a fresh retry process must refuse
  // to re-broadcast an intent a prior process already sent (double-spend).
  private forceBroadcast = false
  // The owning vault's ecdsa public key — namespaces broadcast-journal
  // fingerprints so two different vaults sending an identical tx don't collide
  // in the single global journal (see BroadcastIntent.owner).
  private readonly vaultPublicKey: string
  private readonly consumedHlOrderRefs = new Set<string>()

  constructor(vault: VaultBase, verbose = false, vaultId?: string, vultisig?: Vultisig) {
    this.vault = vault
    this.verbose = verbose
    this.vultisig = vultisig
    this.vaultPublicKey = vaultId ?? vault.publicKeys?.ecdsa ?? ''
    if (vaultId) {
      this.stateStore = new VaultStateStore(vaultId)
    }
  }

  async retrieveHlOrder(
    transport: HlOrderTransport,
    input: Record<string, unknown>,
    conversationId: string
  ): Promise<HlOrderSigningPayload> {
    const orderRef = typeof input.order_ref === 'string' ? input.order_ref : ''
    if (!/^[0-9a-f-]{16,64}$/i.test(orderRef)) throw new Error('HL_INVALID_ORDER_REFERENCE')
    if (this.consumedHlOrderRefs.has(orderRef)) throw new Error('HL_ORDER_REFERENCE_REPLAYED')
    const payload = await transport.retrieveHlOrderSigningPayload(orderRef, conversationId, this.vaultPublicKey)
    // Retrieval is one-shot server-side. Mark locally consumed before validation/signing too: a malformed
    // or tampered payload must not be retried under the same opaque capability.
    this.consumedHlOrderRefs.add(orderRef)
    await validateHlSigningPayload(
      payload,
      {
        orderRef,
        conversationId,
        publicKey: this.vaultPublicKey,
        digest: typeof input.digest === 'string' ? input.digest : undefined,
      },
      this.vault
    )
    return payload
  }

  async signAndSubmitHlOrder(transport: HlOrderTransport, payload: HlOrderSigningPayload): Promise<RecentAction> {
    return this.runTool('hl_order', async () => {
      if (this.vault.isEncrypted && !(this.vault as any).isUnlocked?.() && this.password) {
        await (this.vault as any).unlock?.(this.password)
      }
      const expectedAddress = await this.vault.address(Chain.Ethereum)
      const signatures = []
      for (const step of payload.steps) {
        const signed = await this.vault.signBytes({
          data: step.digest,
          chain: Chain.Ethereum,
        })
        const canonical = toCanonicalEvmSignature(signed.signature, signed.recovery ?? 0)
        const v = canonical.recovery + 27
        const wireSignature = `0x${canonical.r}${canonical.s}${v.toString(16).padStart(2, '0')}` as `0x${string}`
        const recovered = await recoverAddress({
          hash: step.digest,
          signature: wireSignature,
        })
        if (recovered.toLowerCase() !== expectedAddress.toLowerCase()) {
          throw new Error('HL_SIGNATURE_RECOVERY_MISMATCH')
        }
        signatures.push({
          kind: step.kind,
          digest: step.digest,
          r: `0x${canonical.r}` as `0x${string}`,
          s: `0x${canonical.s}` as `0x${string}`,
          v,
        })
      }
      const params = {
        orderRef: payload.order_ref,
        conversationId: payload.conversation_id,
        publicKey: this.vaultPublicKey,
      }
      const submitted = await transport.submitHlOrder(
        params.orderRef,
        params.conversationId,
        params.publicKey,
        signatures
      )
      const status = await pollHlOrderStatus(transport, params, submitted)
      if (isHlOrderFailure(status)) {
        throw new Error(`HL_ORDER_${status.state.toUpperCase()}: ${status.reason ?? 'venue did not accept the order'}`)
      }
      // Signatures and raw actions travel only over the authenticated direct endpoint. The chat
      // recent_actions channel receives status metadata, never signing material.
      return {
        order_ref: payload.order_ref,
        state: status.state,
        order_id: status.order_id,
        filled_size: status.filled_size,
        average_price: status.average_price,
        reason: status.reason,
      }
    })
  }

  setPassword(password: string): void {
    this.password = password
  }

  /**
   * Whether a password is already held (set at unlock via the keyring/env chain
   * or `--password`). The sign gate consults this so a session unlocked
   * non-interactively doesn't get re-prompted for a secret it already has.
   */
  hasPassword(): boolean {
    return this.password != null
  }

  /** Opt out of the persistent broadcast-journal duplicate guard (`--force`). */
  setForceBroadcast(force: boolean): void {
    this.forceBroadcast = force
  }

  /**
   * Derive the chain-agnostic broadcast intent (fingerprint basis) from a
   * buffered tx_ready payload. Prefers the nested EVM/`tx` shape; falls back to
   * the non-EVM `txArgs.{to,amount,memo}` shape. `overrideTx` lets a multi-leg
   * caller fingerprint a specific leg (e.g. the approve leg's `approvalTxArgs`).
   * Always namespaced by the owning vault (owner) so a shared journal can't
   * cross-match two vaults' transactions.
   */
  private buildBroadcastIntent(payload: any, chain: Chain, overrideTx?: any): BroadcastIntent {
    const source = overrideTx ?? payload
    // `data` is EVM calldata iff the chain is an EVM chain — the single authority
    // that decides whether an empty `"0x"` folds (calldata) or stays literal (a
    // memo on a memo-routed chain, PR #1259). Derived from chain kind, never
    // hardcoded per branch, so a new chain family can't silently reintroduce the
    // memo collision. The nested-tx branch is EVM by construction (extractNestedTx
    // only yields EVM `tx`/`send_tx` shapes); the flat branch is a non-EVM memo —
    // but if an EVM send ever reaches it, its `0x` memo is still calldata, so gate
    // both on the same rule rather than assuming which branch runs.
    const dataIsEvmCalldata = getChainKind(chain) === 'evm'
    const nested = extractNestedTx(source)
    if (nested && (nested.to || nested.value || nested.data)) {
      return {
        owner: this.vaultPublicKey,
        chain: chain.toString(),
        to: nested.to != null ? String(nested.to) : undefined,
        value: nested.value != null ? String(nested.value) : undefined,
        data: nested.data != null ? String(nested.data) : undefined,
        dataIsEvmCalldata,
      }
    }
    const txArgs = source?.txArgs ?? source
    // Non-EVM: the token identity isn't in `to`/`data`, so fold in whatever
    // asset/denom discriminator the envelope carries to avoid conflating two
    // same-amount sends of different assets.
    const asset =
      txArgs?.denom ?? txArgs?.ticker ?? txArgs?.symbol ?? txArgs?.asset ?? txArgs?.coin ?? txArgs?.contract_address
    return {
      owner: this.vaultPublicKey,
      chain: chain.toString(),
      to: txArgs?.to != null ? String(txArgs.to) : undefined,
      value: txArgs?.amount != null ? String(txArgs.amount) : undefined,
      data: txArgs?.memo != null ? String(txArgs.memo) : undefined,
      dataIsEvmCalldata,
      asset: asset != null ? String(asset) : undefined,
    }
  }

  /**
   * Journal a broadcast the instant it lands, computing the fingerprint from the
   * same intent basis the pre-sign duplicate check uses. Called at each signer's
   * broadcast chokepoint (not at signTxFromBuffer's return) so a post-broadcast
   * step that throws — e.g. a multi-leg approve receipt timeout — can't strand an
   * already-broadcast tx unrecorded and let a retry re-send it. Best-effort:
   * never throw back into a completed broadcast.
   */
  private recordBroadcastForTx(serverTxData: any, chain: Chain, txHash: string | undefined): void {
    if (!txHash) return
    try {
      const intent = this.buildBroadcastIntent(serverTxData, chain)
      recordBroadcast(computeFingerprint(intent), String(txHash), chain.toString())
    } catch (err) {
      if (this.verbose) process.stderr.write(`[broadcast-journal] record skipped: ${(err as Error)?.message ?? err}\n`)
    }
  }

  /**
   * Store a server-built transaction (from tx_ready SSE event).
   * This allows sign_tx to find and sign it when the backend requests signing.
   *
   * @returns true when a signable payload was stored; false for MCP errors or missing tx body
   */
  storeServerTransaction(txReadyData: any): boolean {
    if (this.verbose)
      process.stderr.write(
        `[executor] storeServerTransaction called, keys: ${Object.keys(txReadyData || {}).join(',')}\n`
      )
    // mcp-ts execute_swap / execute_contract_call may emit a 2-leg envelope
    // carrying both `approvalTxArgs` (ERC-20 approve) and `txArgs` (the main
    // swap/call). Stash both legs and store a `__multiLeg` marker payload;
    // signTxFromBuffer routes through signMultiLeg, which signs+broadcasts
    // the approve leg, waits for the receipt, then signs+broadcasts the main
    // leg. Mirrors vultiagent's useTransactionFlow (Pattern 3 — see task
    // 080526-sdk-cli-multileg-sequencer.md).
    if (txReadyData?.approvalTxArgs && txReadyData?.txArgs) {
      // Validate both legs resolve to the same chain before buffering. A
      // malformed envelope where approvalTxArgs.chain ≠ txArgs.chain (or
      // either disagrees with the parent) would otherwise be silently
      // coerced to whichever chain signServerTx picks first via its
      // `chain || from_chain || txArgs.chain` precedence — the approve
      // leg would broadcast against the wrong allowance state. Fail
      // closed: reject upfront, never half-broadcast across chains.
      const approvalChain = resolveChainFromTxReady(txReadyData.approvalTxArgs)
      const mainChain = resolveChainFromTxReady(txReadyData.txArgs)
      const parentChain = resolveChainFromTxReady(txReadyData)
      if (
        !approvalChain ||
        !mainChain ||
        approvalChain !== mainChain ||
        (parentChain && parentChain !== approvalChain)
      ) {
        if (this.verbose)
          process.stderr.write(
            `[executor] rejecting multi-leg envelope with inconsistent chain metadata: parent=${parentChain ?? 'unresolved'} approval=${approvalChain ?? 'unresolved'} main=${mainChain ?? 'unresolved'}\n`
          )
        return false
      }
      const chain = approvalChain
      // M3: enforce the "Phase B is EVM-only" comment in code. signMultiLeg
      // assumes EIP-1559 broadcast + receipt semantics via signServerTx +
      // waitForEvmReceipt; non-EVM 2-leg flows are not a real shape on mcp-ts
      // today and would silently misbehave if forced through this path.
      // Reject loudly rather than fall through to the single-leg branch
      // (which would extract main-leg txArgs and silently drop the approve).
      if (!isEvmChain(chain)) {
        if (this.verbose)
          process.stderr.write(
            `[executor] rejecting multi-leg envelope on non-EVM chain ${chain}: signMultiLeg is EVM-only\n`
          )
        return false
      }
      this.pendingLegs = [
        {
          txArgs: txReadyData.approvalTxArgs,
          parent: txReadyData,
          kind: 'approve',
        },
        { txArgs: txReadyData.txArgs, parent: txReadyData, kind: 'main' },
      ]
      this.pendingPayloads.clear()
      this.pendingPayloads.set('latest', {
        payload: { __serverTx: true, __multiLeg: true, ...txReadyData },
        coin: { chain, address: '', decimals: 18, ticker: '' },
        chain,
        timestamp: Date.now(),
      })
      if (this.verbose)
        process.stderr.write(`[executor] stored multi-leg envelope: chain=${chain}, legs=2 (approve, main)\n`)
      return true
    }
    const nestedTx = extractNestedTx(txReadyData)
    if (nestedTx?.status === 'error' || nestedTx?.error) {
      if (this.verbose)
        process.stderr.write(`[executor] skipping error tx_ready: ${nestedTx.error || 'unknown error'}\n`)
      return false
    }

    // Phase D: non-EVM envelopes carry tx fields directly under `txArgs.*`
    // (not under `txArgs.tx`), so `extractNestedTx` returns undefined for
    // them. If we have an envelope with the expected non-EVM shape AND
    // the resolved chain is non-EVM, accept it — signServerTx will
    // dispatch via parseNonEvmEnvelope + vault.send.
    if (!nestedTx && txReadyData && typeof txReadyData === 'object') {
      const txArgs = txReadyData.txArgs
      if (txArgs && typeof txArgs === 'object' && typeof txArgs.to === 'string' && typeof txArgs.amount === 'string') {
        const chain = resolveChainFromTxReady(txReadyData) || Chain.Ethereum
        if (getChainKind(chain) !== 'evm') {
          this.pendingPayloads.clear()
          this.pendingLegs = []
          this.pendingPayloads.set('latest', {
            payload: { __serverTx: true, ...txReadyData },
            coin: { chain, address: '', decimals: 18, ticker: '' },
            chain,
            timestamp: Date.now(),
          })
          if (this.verbose)
            process.stderr.write(
              `[executor] Stored non-EVM server tx for chain ${chain} (kind=${getChainKind(chain)})\n`
            )
          return true
        }
      }
    }

    if (!nestedTx) {
      if (this.verbose)
        process.stderr.write(`[executor] storeServerTransaction: no swap_tx/send_tx/tx/txArgs.tx found in data\n`)
      return false
    }

    const chain = resolveChainFromTxReady(txReadyData) || Chain.Ethereum

    // Clear stale payloads (and any leftover multi-leg legs from a declined
    // 2-leg envelope) before storing the new single-leg server tx
    this.pendingPayloads.clear()
    this.pendingLegs = []
    this.pendingPayloads.set('latest', {
      payload: { __serverTx: true, ...txReadyData },
      coin: { chain, address: '', decimals: 18, ticker: '' },
      chain,
      timestamp: Date.now(),
    })

    if (this.verbose)
      process.stderr.write(
        `[executor] Stored server tx for chain ${chain}, pendingPayloads size=${this.pendingPayloads.size}\n`
      )
    return true
  }

  hasPendingTransaction(): boolean {
    return this.pendingPayloads.has('latest')
  }

  /**
   * Drop the buffered server tx and any staged multi-leg state. Called when
   * the user declines the pre-sign confirmation: the rejected envelope must
   * not linger (a fresh tx_ready always overwrites, but stale legs/payloads
   * would otherwise survive into later turns).
   */
  clearPendingTransaction(): void {
    this.pendingPayloads.clear()
    this.pendingLegs = []
  }

  /**
   * The chain the currently-buffered server tx targets, or null when nothing is
   * buffered. Read alongside {@link getPendingSummary} so a declined signing can
   * report the proposed transaction as a machine-readable surface — a read-safe
   * `agent ask` (no `--yes`) is documented to REPORT the proposed transaction,
   * and a prose summary alone is not something an integrator can branch on.
   */
  getPendingChain(): string | null {
    return this.pendingPayloads.get('latest')?.chain ?? null
  }

  /**
   * If the transaction that will actually be signed carries ERC-20 `transfer`
   * calldata, decode its destination and amount and cross-check them against
   * the producer's declared values. Returns the decoded transfer (authoritative
   * for the summary) when the signed tx is a transfer, or null otherwise.
   *
   * Reads the signed tx via {@link extractNestedTx} — the SAME resolution the
   * signer uses (`swap_tx || send_tx || tx || txArgs.tx`) — not `txArgs.tx`
   * alone: a `send_tx`/`tx`/`swap_tx` envelope, or one carrying both a benign
   * `txArgs.tx` and a malicious higher-precedence key, must not be able to move
   * funds to an address the consent summary never showed. Fails closed —
   * clearing the buffered tx and throwing — on malformed transfer calldata or a
   * producer/calldata recipient or amount mismatch, so a divergent envelope can
   * never be signed. Invoked before the branch-specific summaries below so a
   * transfer cannot be disguised as a swap/contract-call to skip the check.
   */
  private assertConsistentTransfer(p: any): { recipient: Address; amount: bigint } | null {
    const signedTx = extractNestedTx(p)
    const calldata = typeof signedTx?.data === 'string' ? (signedTx.data as string) : ''
    if (calldata === '' || calldata === '0x') return null

    let transfer: { recipient: Address; amount: bigint } | null
    try {
      transfer = decodeErc20Transfer(calldata)
    } catch (error) {
      this.clearPendingTransaction()
      throw error
    }
    if (!transfer) return null

    const producerRecipient = typeof p?.txArgs?.to === 'string' ? (p.txArgs.to as string) : ''
    if (producerRecipient && transfer.recipient.toLowerCase() !== producerRecipient.toLowerCase()) {
      this.clearPendingTransaction()
      throw new Error(
        `ERC-20 recipient mismatch — refusing to sign: txArgs.to ${producerRecipient} does not match calldata destination ${transfer.recipient}`
      )
    }

    const producerAmount = typeof p?.txArgs?.amount === 'string' ? (p.txArgs.amount as string) : ''
    if (producerAmount && /^\d+$/.test(producerAmount) && BigInt(producerAmount) !== transfer.amount) {
      this.clearPendingTransaction()
      throw new Error(
        `ERC-20 amount mismatch — refusing to sign: txArgs.amount ${producerAmount} does not match calldata value ${transfer.amount}`
      )
    }
    return { recipient: transfer.recipient, amount: transfer.amount }
  }

  /**
   * Human-readable one-line summary of the currently-buffered server tx
   * (set by storeServerTransaction), for the pre-sign confirmation prompt.
   * Returns null when nothing is buffered (e.g. sign_typed_data, which has
   * no tx_ready payload — callers fall back to the tool input).
   */
  getPendingSummary(): string | null {
    const stored = this.pendingPayloads.get('latest')
    if (!stored) return null
    const p = stored.payload as any
    const labels = (p?.resolved?.labels ?? {}) as Record<string, string>

    // Fail closed on any signed ERC-20 transfer whose destination diverges from
    // the producer's declared recipient or amount (or whose transfer calldata
    // is malformed) BEFORE rendering any branch-specific summary — a transfer
    // must not be able to hide behind a swap/contract-call head to skip the check.
    const transfer = this.assertConsistentTransfer(p)

    // Design B: Polymarket flat-tx-builder bridge envelopes carry no swap/send
    // token labels, so the generic summaries below degrade to "send ? to ?".
    // Summarize the destination contract + value (and the bundled approval leg)
    // so the confirm gate / `--yes` log always shows what is being signed. Keyed
    // on the bridge's `__buildTx` marker so existing swap/send summaries are
    // untouched. These are always contract calls (approve / wrap calldata).
    if (p?.__buildTx) {
      const action = typeof p?.action === 'string' && p.action ? ` [${p.action}]` : ''
      if (p?.__multiLeg) {
        const wrapTo = (p?.txArgs?.tx?.to as string) || '?'
        return `contract call on ${stored.chain} to ${wrapTo} (+ token approval — 2 transactions)${action}`
      }
      const flat = (p?.tx ?? {}) as Record<string, unknown>
      const to = typeof flat.to === 'string' ? flat.to : '?'
      const valueRaw = typeof flat.value === 'string' ? flat.value : '0'
      const valuePart = valueRaw && valueRaw !== '0' ? ` value ${valueRaw}` : ''
      return `contract call on ${stored.chain} to ${to}${valuePart}${action}`
    }

    const isSwap = !!(p?.approvalTxArgs || p?.swap_tx || labels.quote_summary || labels.to_token_symbol)
    if (isSwap) {
      // quote_summary already embeds the provider ("… via kyber"); only append
      // the provider when we fall back to building the head ourselves.
      const rawQuoteSummary = tokenLabel(labels.quote_summary)
      const quoteSummary = hasSingleSwapDelimiter(rawQuoteSummary, labels) ? rawQuoteSummary : ''
      const usedQuoteSummary = !!quoteSummary
      const amountIn = tokenLabel(labels.amount_in) || tokenLabel(p?.txArgs?.amount) || '?'
      const fromSymbol = tokenLabel(labels.from_token_symbol)
      const sellHead = fromSymbol && !amountIn.endsWith(` ${fromSymbol}`) ? `${amountIn} ${fromSymbol}` : amountIn
      const head = discloseSwapTokenContracts(
        quoteSummary || `swap ${sellHead} → ${tokenLabel(labels.to_token_symbol) || '?'}`,
        labels,
        p,
        stored.chain
      )
      const parts = [head, `on ${stored.chain}`]
      if (!usedQuoteSummary && tokenLabel(labels.provider)) parts.push(`via ${tokenLabel(labels.provider)}`)
      if (p?.__multiLeg) parts.push('(+ token approval — 2 transactions)')
      if (tokenLabel(labels.estimated_fee)) parts.push(`est. fee ${tokenLabel(labels.estimated_fee)}`)
      return parts.join(' ')
    }
    // Name the token contract from the payload that gets signed, not from label
    // text: an EVM token send executes against the signed tx's `to` (the
    // contract, with transfer calldata) while `txArgs.to` is the recipient. A
    // native send has empty calldata and tx.to === recipient, so it gains
    // nothing here. Non-EVM envelopes carry no signable EVM tx and are likewise
    // unchanged. Resolve via `extractNestedTx` so the summary describes the same
    // tx the signer consumes (`swap_tx || send_tx || tx || txArgs.tx`).
    const signedTx = extractNestedTx(p)
    const contractTo = typeof signedTx?.to === 'string' ? (signedTx.to as string) : ''
    const calldata = typeof signedTx?.data === 'string' ? (signedTx.data as string) : ''
    const isContractSend = !!contractTo && calldata !== '' && calldata !== '0x'
    const producerRecipient = typeof p?.txArgs?.to === 'string' ? (p.txArgs.to as string) : ''
    // `transfer.recipient` (decoded + cross-checked above) is the value that will
    // receive funds for an ERC-20 transfer. It therefore owns both the rendered
    // summary and the exact string passed to the confirmation policy; producer
    // labels are fallback text only for native, non-EVM, and non-transfer
    // envelopes.
    const to = transfer?.recipient || producerRecipient || labels.recipient_echo || '?'

    // WYSIWYS: derive the displayed amount from signed calldata, never a producer label. Unknown tokens have no trusted
    // decimals, so show raw base units as unverified rather than a misleading precise number; the recipient was already
    // cross-checked above, so this rendering branch never fails closed.
    if (transfer) {
      return this.renderErc20TransferSummary(transfer.amount, contractTo, stored.chain, to)
    }

    const disclosedContract = isContractSend && contractTo.toLowerCase() !== to.toLowerCase() ? contractTo : ''
    return this.renderLabelSendSummary(p, labels, stored.chain, to, disclosedContract)
  }

  /**
   * Render the send summary from producer labels — the fallback for native,
   * non-EVM, and non-transfer envelopes only (decoded ERC-20 transfers are
   * rendered from calldata by renderErc20TransferSummary above). De-duplicates
   * token/chain/contract details the label may repeat, anchored to the routed
   * chain and the payload-derived contract disclosure.
   */
  private renderLabelSendSummary(
    p: any,
    labels: Record<string, string>,
    chain: Chain,
    to: string,
    disclosedContract: string
  ): string {
    // The signed payload is authoritative. Rich producer labels may repeat its
    // address; remove only exact or matching truncated copies
    // (case-insensitively), clean up an empty parenthetical wrapper, and
    // preserve every other label detail for the existing de-dup logic.
    const amount = stripEmbeddedPayloadContract(labels.resolved_amount ?? p?.txArgs?.amount ?? '?', disclosedContract)
    // Include the asset symbol so a confirmation prompt can never be ambiguous
    // between native and tokens (e.g. "send 100 on Base to …" — ETH? USDC?).
    // token_resolved may be either a bare ticker or a richer label such as
    // "USDC.e on Polygon (0x…)". De-dup against the ticker while preserving
    // the richer chain/contract disclosure as the summary suffix. When the
    // amount already embeds the full label, do not render its details again:
    // omit the suffix if the label positively names the exact routed chain,
    // otherwise append only the routed location so a conflicting or negated
    // chain mention cannot hide it.
    // The label shape is an out-of-repo producer convention, so only remove the
    // first exact "on <routed chain>" fragment and keep any remainder verbatim:
    // an unrecognised shape must never omit either embedded details or the route.
    const tokenLabel = stripEmbeddedPayloadContract(
      (labels.token_resolved || labels.token_symbol || '').trim(),
      disclosedContract
    )
    const symbol = tokenLabel.split(/\s+/, 1)[0]
    const escapedChain = String(chain).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Strip the negation together with the chain ("not on Polygon"): removing
    // only "on <chain>" would leave a dangling "not" in front of the recipient,
    // and the routed location is re-anchored below regardless.
    const routedChainPattern = new RegExp(`(?:^|\\s)(?:not\\s+)?on ${escapedChain}(?=\\s|$)`)
    // Reordered labels put the routed chain after the contract details
    // ("USDC.e (0x…) on Polygon"), so accept the fragment anywhere in the
    // context — but a negated mention ("not on Polygon") must not count.
    const positiveRoutedChainPattern = new RegExp(`(?:^|\\s)(?<!\\bnot\\s+)on ${escapedChain}(?=\\s|$)`)
    const tokenContext = tokenLabel.slice(symbol.length)
    const labelCarriesRoutedChain = positiveRoutedChainPattern.test(tokenContext)
    const tokenDetail = tokenContext.replace(routedChainPattern, '').trim()
    const amountEmbedsTokenLabel = tokenLabel.length > 0 && amount.endsWith(` ${tokenLabel}`)
    const amountWithSymbol =
      symbol && !amount.endsWith(` ${symbol}`) && !amountEmbedsTokenLabel ? `${amount} ${symbol}` : amount
    const tokenDetailSuffix = amountEmbedsTokenLabel || !tokenDetail ? '' : ` ${tokenDetail}`
    const location = amountEmbedsTokenLabel && labelCarriesRoutedChain ? '' : `on ${chain}${tokenDetailSuffix}`
    const contractPart = formatTokenContractDisclosure(disclosedContract)
    return `send ${amountWithSymbol}${location ? ` ${location}` : ''} to ${to}${contractPart}`
  }

  /**
   * Render the consent amount for an ERC-20 transfer from the SIGNED calldata
   * value, never a producer label. Known tokens use trusted decimals/ticker from
   * knownTokensIndex; unknown tokens fall back to raw base units with an explicit
   * unverified marker (the recipient is already cross-checked, so we never fail
   * closed here).
   */
  private renderErc20TransferSummary(amount: bigint, contractTo: string, chain: Chain, to: string): string {
    const known = knownTokensIndex[chain]?.[contractTo.toLowerCase()]
    if (known) {
      const contractPart = contractTo.toLowerCase() !== to.toLowerCase() ? ` (token contract ${contractTo})` : ''
      return `send ${formatUnits(amount, known.decimals)} ${known.ticker} on ${chain} to ${to}${contractPart}`
    }
    return `send ${amount} base units of token ${contractTo} (decimals unverified) on ${chain} to ${to}`
  }

  /**
   * Wrap a per-tool handler body with normalised success/failure → RecentAction
   * conversion. Replaces the legacy executeAction → ActionResult adapter that
   * the dispatch chokepoint used before this refactor.
   */
  private async runTool(toolName: string, body: () => Promise<Record<string, unknown>>): Promise<RecentAction> {
    try {
      const data = await body()
      return { tool: toolName, success: true, data }
    } catch (err: unknown) {
      const { code, message } = normalizeAgentError(err)
      return { tool: toolName, success: false, data: { error: message, code } }
    }
  }

  // ============================================================================
  // Chain & Token Management
  // ============================================================================

  // vault_chain dispatcher — backend shape:
  //   { action: "add" | "remove", chains: [{ chain }] }
  // Discriminator wrapper: routes to addChain / removeChain so the resulting
  // RecentAction is tagged tool: 'vault_chain' (matching what the agent emits)
  // rather than the per-action method's tool name.
  async vaultChain(toolCallId: string, input: Record<string, unknown>): Promise<RecentAction> {
    return this.runTool('vault_chain', async () => {
      const action = input.action as string | undefined
      switch (action) {
        case 'add':
          return this.addChainImpl(input)
        case 'remove':
          return this.removeChainImpl(input)
        default:
          throw new Error(`vault_chain: unknown action: ${action ?? '(missing)'}`)
      }
    })
  }

  // vault_coin dispatcher — backend shape:
  //   { action: "add" | "remove", coins: [{ chain, ticker, contract_address?, ... }] }
  async vaultCoin(toolCallId: string, input: Record<string, unknown>): Promise<RecentAction> {
    return this.runTool('vault_coin', async () => {
      const action = input.action as string | undefined
      switch (action) {
        case 'add':
          return this.addCoinImpl(input)
        case 'remove':
          return this.removeCoinImpl(input)
        default:
          throw new Error(`vault_coin: unknown action: ${action ?? '(missing)'}`)
      }
    })
  }

  // address_book dispatcher — backend shape:
  //   { action: "add" | "remove", entry: { name, chain, address } }
  async addressBook(toolCallId: string, input: Record<string, unknown>): Promise<RecentAction> {
    return this.runTool('address_book', async () => {
      const action = input.action as string | undefined
      switch (action) {
        case 'add':
          return this.addAddressBookImpl(input)
        case 'remove':
          return this.removeAddressBookImpl(input)
        default:
          throw new Error(`address_book: unknown action: ${action ?? '(missing)'}`)
      }
    })
  }

  async addChain(_toolCallId: string, input: Record<string, unknown>): Promise<RecentAction> {
    return this.runTool('add_chain', () => this.addChainImpl(input))
  }

  // Backend `vault_chain { action: "add", chains: [...] }` and legacy
  // single-chain calls both flow through this impl. The public `addChain`
  // wrapper above tags results as `tool: 'add_chain'`; the new `vaultChain`
  // wrapper (above) tags them as `tool: 'vault_chain'`.
  private async addChainImpl(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const chains = params.chains as any[] | undefined
    if (chains && Array.isArray(chains)) {
      const results: { chain: string; address: string }[] = []
      for (const c of chains) {
        const name = typeof c === 'string' ? c : c.chain
        const chain = resolveChain(name)
        if (!chain) throw new Error(`Unknown chain: ${name}`)
        await this.vault.addChain(chain)
        const address = await this.vault.address(chain)
        results.push({ chain: chain.toString(), address })
      }
      return { added: results }
    }

    const chainName = params.chain as string
    const chain = resolveChain(chainName)
    if (!chain) throw new Error(`Unknown chain: ${chainName}`)
    await this.vault.addChain(chain)
    const address = await this.vault.address(chain)
    return { chain: chain.toString(), address, added: true }
  }

  private async removeChainImpl(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const chains = params.chains as any[] | undefined
    if (chains && Array.isArray(chains)) {
      const results: { chain: string }[] = []
      for (const c of chains) {
        const name = typeof c === 'string' ? c : c.chain
        const chain = resolveChain(name)
        if (!chain) throw new Error(`Unknown chain: ${name}`)
        await this.vault.removeChain(chain)
        results.push({ chain: chain.toString() })
      }
      return { removed: results }
    }

    const chainName = params.chain as string
    const chain = resolveChain(chainName)
    if (!chain) throw new Error(`Unknown chain: ${chainName}`)
    await this.vault.removeChain(chain)
    return { chain: chain.toString(), removed: true }
  }

  private async addCoinImpl(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    // Backend sends `coins` (vault_coin); legacy/hand-rolled callers may pass `tokens`.
    const coins = (params.coins as any[] | undefined) ?? (params.tokens as any[] | undefined)
    if (coins && Array.isArray(coins)) {
      const results: { chain: string; symbol: string }[] = []
      for (const t of coins) {
        const chain = resolveChain(t.chain)
        if (!chain) throw new Error(`Unknown chain: ${t.chain}`)
        const symbol = t.ticker || t.symbol || ''
        await this.vault.addToken(chain, {
          id: (t.contract_address || t.contractAddress || '') as string,
          symbol,
          name: (t.name || symbol) as string,
          decimals: t.decimals ?? 18,
          contractAddress: (t.contract_address || t.contractAddress) as string,
          chainId: chain.toString(),
        } as any)
        results.push({ chain: chain.toString(), symbol })
      }
      return { added: results }
    }

    // Single token format
    const chainName = params.chain as string
    const chain = resolveChain(chainName)
    if (!chain) throw new Error(`Unknown chain: ${chainName}`)

    const symbol = (params.ticker || params.symbol) as string
    await this.vault.addToken(chain, {
      id: (params.contract_address || params.contractAddress || '') as string,
      symbol,
      name: (params.name || symbol) as string,
      decimals: (params.decimals as number) ?? 18,
      contractAddress: (params.contract_address || params.contractAddress) as string,
      chainId: chain.toString(),
    } as any)
    return { chain: chain.toString(), symbol, added: true }
  }

  private async removeCoinImpl(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const coins = (params.coins as any[] | undefined) ?? (params.tokens as any[] | undefined)
    if (coins && Array.isArray(coins)) {
      const results: { chain: string; tokenId: string; removed: boolean }[] = []
      for (const t of coins) {
        const chain = resolveChain(t.chain)
        if (!chain) throw new Error(`Unknown chain: ${t.chain}`)
        const tokenId = (t.contract_address || t.contractAddress || t.token_id || t.id) as string
        if (!tokenId) {
          throw new Error(
            `vault_coin remove: missing contract_address for ${t.ticker || t.symbol || 'coin'} on ${t.chain}`
          )
        }
        // Report per-coin what the SDK actually did — a coin that was never
        // tracked must not be reported back to the model as removed.
        const removed = await this.vault.removeToken(chain, tokenId)
        results.push({ chain: chain.toString(), tokenId, removed })
      }
      return { removed: results }
    }

    const chainName = params.chain as string
    const chain = resolveChain(chainName)
    if (!chain) throw new Error(`Unknown chain: ${chainName}`)

    const tokenId = (params.contract_address || params.contractAddress || params.token_id || params.id) as
      | string
      | undefined
    if (!tokenId) {
      throw new Error(`vault_coin remove: missing contract_address for coin on ${chainName}`)
    }
    const removed = await this.vault.removeToken(chain, tokenId)
    return { chain: chain.toString(), removed }
  }

  async removeChain(_toolCallId: string, input: Record<string, unknown>): Promise<RecentAction> {
    return this.runTool('remove_chain', () => this.removeChainImpl(input))
  }

  async addCoin(_toolCallId: string, input: Record<string, unknown>): Promise<RecentAction> {
    return this.runTool('add_coin', () => this.addCoinImpl(input))
  }

  async removeCoin(_toolCallId: string, input: Record<string, unknown>): Promise<RecentAction> {
    return this.runTool('remove_coin', () => this.removeCoinImpl(input))
  }

  // ============================================================================
  // Transaction Signing
  // ============================================================================

  /**
   * Sign and broadcast a transaction previously buffered by
   * {@link storeServerTransaction} via the `tx_ready` SSE channel. Returns
   * a `RecentAction` to be flushed in the next `context.recent_actions`.
   *
   * Replaces the legacy `signTx(action.params)` path: there is no longer an
   * action wrapper, no `keysign_payload` lookup (the buffer always uses
   * the `'latest'` slot), and no SDK-built keysignPayload branch (the live
   * client-side tools no longer produce SDK-built payloads — those went
   * away with `buildSendTx`/`buildSwapTx`).
   */
  async signTxFromBuffer(_toolCallId: string): Promise<RecentAction> {
    return this.runTool('sign_tx', async () => {
      if (this.verbose)
        process.stderr.write(`[sign_tx] pendingPayloads keys: ${[...this.pendingPayloads.keys()].join(', ')}\n`)

      const stored = this.pendingPayloads.get('latest')
      if (!stored) {
        throw new Error('No pending transaction to sign. Build a transaction first.')
      }

      const { payload, chain } = stored

      if (!payload.__serverTx) {
        // Live client-side tool path doesn't produce SDK-built keysign payloads;
        // every signable payload arrives via tx_ready (server-built).
        throw new Error('Pending transaction is not a server-built tx (no __serverTx flag).')
      }

      // F1/F14 double-spend guard. Fingerprint the intent(s) BEFORE any signing
      // and refuse if a prior (or sibling) process already broadcast the same
      // intent recently and it hasn't definitively failed — the persistent
      // journal is what survives the process death that the in-memory
      // `evmLastBroadcast` guard can't. Multi-leg checks BOTH legs so a retry
      // after the approve broadcast (but before the main) can't re-approve.
      // `--force` (setForceBroadcast) bypasses.
      const isMultiLeg = !!payload.__multiLeg
      const primaryIntent = isMultiLeg
        ? this.buildBroadcastIntent(payload, chain, { txArgs: payload.txArgs })
        : this.buildBroadcastIntent(payload, chain)
      const approveIntent = isMultiLeg
        ? this.buildBroadcastIntent(payload, chain, {
            txArgs: payload.approvalTxArgs,
          })
        : undefined
      const primaryFp = computeFingerprint(primaryIntent)
      const approveFp = approveIntent ? computeFingerprint(approveIntent) : undefined
      assertNoRecentDuplicate(primaryIntent, { force: this.forceBroadcast })
      if (approveIntent) assertNoRecentDuplicate(approveIntent, { force: this.forceBroadcast })

      // Atomic reservation (closes the check-then-record TOCTOU): the journal
      // check above only sees COMMITTED broadcasts, so two sibling processes can
      // both pass it before either records. Take an exclusive lock per intent
      // BEFORE signing so exactly one wins; the loser throws
      // ConcurrentBroadcastError (→ DUPLICATE_BROADCAST) and never signs. Held
      // across the whole sign+broadcast+record, released in the finally once the
      // durable journal record has taken over as the guard. `--force` no-ops it.
      const reservations: BroadcastReservation[] = []
      try {
        reservations.push(reserveBroadcast(primaryFp, { force: this.forceBroadcast }))
        if (approveFp) reservations.push(reserveBroadcast(approveFp, { force: this.forceBroadcast }))

        // Multi-leg mcp-ts envelope (approve + main) — dispatched first so it
        // pre-empts the Solana-local-swap and signServerTx fallbacks. Phase B
        // is intentionally EVM-only; if `__multiLeg` is ever set on a non-EVM
        // chain that's a programming error, not a missing branch.
        let result: Record<string, unknown> | undefined
        if (payload.__multiLeg) {
          if (this.pendingLegs.length !== 2) {
            throw new VaultError(
              VaultErrorCode.InvalidConfig,
              `signMultiLeg: expected 2 pending legs, got ${this.pendingLegs.length}`
            )
          }
          result = await this.signMultiLeg(payload, chain, {})
        }

        // Solana swaps: prefer local SDK build (vault.getSwapQuote → prepareSwapTx)
        // since the server-built tx format doesn't match signServerTx's EVM assumptions.
        // Only the quote/prepare phase falls back to signServerTx — once signing starts,
        // failures must propagate to avoid double-submitting a broadcast transaction.
        if (!result && chain === ('Solana' as Chain) && (payload.swap_tx || payload.provider)) {
          try {
            result = await this.buildAndSignSolanaSwapLocally(payload)
          } catch (e: any) {
            if (e._phase === 'prepare') {
              if (this.verbose)
                process.stderr.write(
                  `[sign_tx] Solana local build failed (${e.message}), falling back to signServerTx\n`
                )
            } else {
              throw e
            }
          }
        }
        if (!result) result = await this.signServerTx(payload, chain, {})

        // Journal the single-leg broadcast so a later retry recognises this intent
        // and refuses to double-send. Multi-leg legs are journaled INSIDE
        // signMultiLeg at each leg's broadcast point (so an approve whose 90s
        // receipt-wait times out is still recorded and can't be re-broadcast on
        // retry — audit F14); recording them here would miss that window.
        if (!isMultiLeg && result?.tx_hash) {
          recordBroadcast(primaryFp, String(result.tx_hash), chain.toString())
        }

        if (payload.sequence_id) result.sequence_id = payload.sequence_id
        return result
      } finally {
        // Release AFTER the broadcast has been recorded above: the durable
        // journal record is now the guard, so dropping the in-flight lock can't
        // reopen the double-send window. On a throw (e.g. multi-leg receipt
        // timeout) the leg-level record inside signMultiLeg has already landed.
        for (const reservation of reservations) reservation.release()
      }
    })
  }

  /**
   * Dispatch a server-built tx_ready envelope to the chain-kind-specific
   * signer. EVM stays in `signEvmServerTx` (the existing PR #422 + PR #435
   * code, with EVM nonce/lock plumbing). Non-EVM kinds parse the envelope
   * via `parseNonEvmEnvelope` and route through `vault.send`, which is
   * already chain-agnostic via `VaultBase.prepareSendTx` virtuals.
   *
   * Phase D — see task `100526-sdk-cli-non-evm-signing.md`.
   */
  private async signServerTx(
    serverTxData: any,
    defaultChain: Chain,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const chain = resolveChainFromTxReady(serverTxData) || defaultChain
    const chainKind = getChainKind(chain)

    if (chainKind === 'evm') {
      return this.signEvmServerTx(serverTxData, defaultChain, params)
    }

    return this.signNonEvmServerTx(serverTxData, chain)
  }

  /**
   * Non-EVM signing path: parse the agent's tx_ready envelope through the
   * SDK's canonical discriminated contract and call through. The SDK already
   * handles per-chain prepare/sign/broadcast internally via
   * `VaultBase.prepareSendTx` virtuals — sdk-cli only owns envelope
   * parsing here, not chain-specific signing logic.
   *
   * THORChain / MayaChain MsgDeposit envelopes (msg_type='deposit',
   * to='') are routed through `vault.swap` because the agent's intent
   * is a swap — the memo (`=:CHAIN.ASSET:DEST::v0:slippage`) carries
   * the routing. We parse the memo to reconstruct vault.swap's
   * fromChain / fromSymbol / toChain / toSymbol / amount args. The SDK
   * then builds the MsgDeposit cosmos tx internally. Vultiagent uses an
   * equivalent custom helper (`buildSignBroadcastThorchainLpDeposit`);
   * we reuse the public `vault.swap` surface to avoid expanding the SDK.
   */
  private async signNonEvmServerTx(serverTxData: any, chain: Chain): Promise<Record<string, unknown>> {
    // Unlock vault if encrypted (mirrors signEvmServerTx).
    if (this.vault.isEncrypted && !(this.vault as any).isUnlocked?.()) {
      if (this.password) {
        await (this.vault as any).unlock?.(this.password)
      }
    }

    const txArgs = serverTxData?.txArgs ?? {}

    // Defense-in-depth: the dispatcher resolved `chain` from the outer
    // envelope; cross-check that the inner `txArgs.chain` agrees. A
    // malformed envelope where these disagree could otherwise silently
    // route through the wrong chain-kind signer. Mirror of Phase B's
    // per-leg chain-consistency check (executor.ts:170 in PR #435).
    // Per PR #439 review finding 5.
    if (typeof txArgs.chain === 'string' && txArgs.chain !== chain) {
      throw new VaultError(
        VaultErrorCode.InvalidConfig,
        `signNonEvmServerTx: dispatcher chain '${chain}' disagrees with envelope chain '${txArgs.chain}'`
      )
    }

    const parsed = parseTxReadyForCli(serverTxData, chain, this.vault.getTokens?.(chain) ?? [])
    if (parsed.kind === 'thor-swap-deposit') {
      return this.signThorMsgDepositSwap(parsed)
    }
    if (parsed.kind === 'thor-lp-deposit') {
      return this.signThorMsgDepositLp(parsed)
    }
    if (parsed.kind !== 'send') {
      throw new VaultError(
        VaultErrorCode.InvalidConfig,
        `signNonEvmServerTx: expected a non-EVM send/deposit envelope, got ${parsed.kind}`
      )
    }
    const args = parsed
    if (this.verbose)
      process.stderr.write(
        `[sign_non_evm_server_tx] chain=${chain}, to=${args.to}, amount=${args.amount}${args.symbol ? ` ${args.symbol}` : ''}, memo=${args.memo ? `"${args.memo}"` : '(none)'}\n`
      )

    const result = await this.vault.send({
      chain,
      to: args.to,
      amount: args.amount,
      symbol: args.symbol,
      memo: args.memo,
    })

    if (result.dryRun) {
      throw new VaultError(
        VaultErrorCode.InvalidConfig,
        'signNonEvmServerTx: vault.send unexpectedly returned dryRun result'
      )
    }

    // Clean up pending payloads after successful sign (parity with EVM path).
    this.pendingPayloads.clear()

    const broadcast = result as Extract<typeof result, { dryRun: false }>
    const explorerUrl = VultisigSdk.getTxExplorerUrl(chain, broadcast.txHash)
    return {
      tx_hash: broadcast.txHash,
      chain: chain.toString(),
      status: 'pending',
      explorer_url: explorerUrl,
    }
  }

  /**
   * Sign and broadcast a THORChain / MayaChain MsgDeposit-style swap
   * envelope by reconstructing `vault.swap` args from the memo.
   *
   * The agent emits envelopes shaped:
   *   { txArgs: { chain: 'THORChain', tx_encoding: 'cosmos-msg',
   *               to: '', amount: '<base>', denom: 'rune',
   *               memo: '=:DEST_CHAIN.DEST_ASSET:DEST_ADDR::v0:slippage_bps',
   *               msg_type: 'deposit' } }
   *
   * The memo is THORChain's standard swap memo. We parse out the
   * destination chain + asset, look up the corresponding `Chain` enum,
   * then call `vault.swap` which builds the MsgDeposit internally.
   *
   * The destination encoded in the server-issued memo is forwarded through
   * `vault.swap({ recipient })`. The SDK uses the same recipient both for the
   * destination coin and the THORChain/MayaChain quote request, so an explicit
   * cross-account route cannot be silently replaced with the vault's address.
   * An omitted destination keeps the existing self-swap default.
   */
  private async signThorMsgDepositSwap(parsed: ParsedTxReadyThorSwapDeposit): Promise<Record<string, unknown>> {
    const { amount, chain, fromSymbol, memo, recipient, toChain, toSymbol } = parsed

    if (this.verbose)
      process.stderr.write(
        `[sign_thor_msg_deposit_swap] ${fromSymbol}@${chain} → ${toSymbol}@${toChain}, amount=${amount}, memo='${memo}'\n`
      )

    const result = await this.vault.swap({
      fromChain: chain,
      fromSymbol,
      toChain,
      toSymbol,
      amount,
      ...(recipient && { recipient }),
    })

    if (result.dryRun) {
      throw new VaultError(
        VaultErrorCode.InvalidConfig,
        'signThorMsgDepositSwap: vault.swap unexpectedly returned dryRun result'
      )
    }

    this.pendingPayloads.clear()

    const broadcast = result as Extract<typeof result, { dryRun: false }>
    const explorerUrl = VultisigSdk.getTxExplorerUrl(chain, broadcast.txHash)
    return {
      tx_hash: broadcast.txHash,
      chain: chain.toString(),
      status: 'pending',
      explorer_url: explorerUrl,
    }
  }

  /**
   * Sign and broadcast a THORChain / MayaChain MsgDeposit envelope whose
   * memo is an LP add (`+:POOL[:PAIRED]`) or remove (`-:POOL:BPS[:ASSET]`).
   *
   * The agent emits the same `cosmos-msg / msg_type: deposit` envelope as
   * the swap path; only the memo prefix differs. The memo is opaque
   * pass-through — sdk-cli doesn't parse pool / paired address / bps
   * because the SDK doesn't need to, the on-chain handler does.
   *
   * Uses `vault.signMsgDeposit` which builds a THORChainDeposit cosmos
   * message via the SDK's keysign payload pipeline. Amount is consumed
   * as base units directly (no decimal conversion) since the agent
   * already emits RUNE / CACAO in base units.
   */
  private async signThorMsgDepositLp(parsed: ParsedTxReadyThorLpDeposit): Promise<Record<string, unknown>> {
    const { amountBaseUnits, chain, memo } = parsed

    if (this.verbose)
      process.stderr.write(
        `[sign_thor_msg_deposit_lp] chain=${chain}, memo='${memo}', amountBaseUnits=${amountBaseUnits}\n`
      )

    const result = await this.vault.signMsgDeposit({
      chain,
      amountBaseUnits,
      memo,
    })
    this.pendingPayloads.clear()

    const explorerUrl = VultisigSdk.getTxExplorerUrl(chain, result.txHash)
    return {
      tx_hash: result.txHash,
      chain: chain.toString(),
      status: 'pending',
      explorer_url: explorerUrl,
    }
  }

  /**
   * Sign and broadcast a server-built EVM transaction (raw EVM tx from
   * tx_ready SSE). The SDK raw-envelope helper owns zero-value calldata,
   * gas-limit, and fee mapping; the CLI reconciles its nonce with local state.
   */
  private async signEvmServerTx(
    serverTxData: any,
    defaultChain: Chain,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const swapTx = extractNestedTx(serverTxData)
    if (!swapTx?.to) {
      throw new Error('Server transaction missing required fields (to)')
    }

    // Resolve chain from action params, tx data, or stored default.
    // mcp-ts nests chain / chain_id under txArgs; mcp-go puts them at top level.
    const chainName = (params.chain || serverTxData.chain || serverTxData.from_chain || serverTxData.txArgs?.chain) as
      | string
      | undefined
    const chainId = (serverTxData.chain_id || serverTxData.txArgs?.chain_id || swapTx.chainId) as
      | string
      | number
      | undefined
    let chain = defaultChain
    if (chainName) {
      chain = resolveChain(chainName) || defaultChain
    } else if (chainId) {
      chain = resolveChainId(chainId) || defaultChain
    }

    // Acquire chain lock for the entire prepare→sign→broadcast flow
    await this.acquireEvmLockIfNeeded(chain)

    try {
      const amount = BigInt(swapTx.value || '0')
      const hasCalldata = !!(swapTx.data && swapTx.data !== '0x')

      if (this.verbose)
        process.stderr.write(
          `[sign_server_tx] chain=${chain}, to=${swapTx.to}, value=${swapTx.value}, amount=${amount}, hasCalldata=${hasCalldata}\n`
        )

      // Unlock vault if needed
      if (this.vault.isEncrypted && !(this.vault as any).isUnlocked?.()) {
        if (this.password) {
          await (this.vault as any).unlock?.(this.password)
        }
      }

      const keysignPayload = await this.vault.prepareRawEvmTx({
        chain,
        tx: {
          to: swapTx.to,
          value: swapTx.value ?? 0n,
          data: swapTx.data ?? '0x',
          gasLimit: swapTx.gasLimit ?? swapTx.gas_limit,
          maxFeePerGas: swapTx.maxFeePerGas ?? swapTx.max_fee_per_gas,
          maxPriorityFeePerGas: swapTx.maxPriorityFeePerGas ?? swapTx.max_priority_fee_per_gas,
          nonce: swapTx.nonce,
        },
      })

      // Reconcile a server-provided nonce with locally tracked broadcasts.
      await this.patchEvmNonce(chain, keysignPayload)

      // Refresh the fee envelope immediately before hashing/signing so a raw
      // transaction prepared earlier is not underpriced after base-fee drift.
      await this.patchEvmGas(chain, keysignPayload)

      // Extract message hashes and sign
      const messageHashes = await this.vault.extractMessageHashes(keysignPayload)

      const signature = await this.vault.sign(
        {
          transaction: keysignPayload,
          chain,
          messageHashes,
        },
        {}
      )

      // Broadcast
      const txHash = await this.vault.broadcastTx({
        chain,
        keysignPayload,
        signature,
      })

      // Record nonce and broadcast timestamp — tx is already broadcast
      this.evmLastBroadcast.set(chain.toString(), Date.now())
      try {
        this.recordEvmNonceFromPayload(chain, keysignPayload, messageHashes.length)
      } catch (nonceErr) {
        console.warn(`[nonce] failed to persist nonce for ${chain}:`, nonceErr)
      }
      await this.releaseEvmLock(chain)

      // Clean up all pending payloads after successful sign
      this.pendingPayloads.clear()

      const explorerUrl = VultisigSdk.getTxExplorerUrl(chain, txHash)

      return {
        tx_hash: txHash,
        chain: chain.toString(),
        status: 'pending',
        explorer_url: explorerUrl,
      }
    } catch (err) {
      await this.releaseEvmLock(chain)
      throw err
    }
  }

  /**
   * Sign and broadcast a 2-leg ERC-20 approve + main flow originating from
   * mcp-ts `execute_*` envelopes that carry both `approvalTxArgs` and
   * `txArgs`. Mirrors vultiagent's `useTransactionFlow`: leg 1 (approve) is
   * signed and broadcast first, the receipt is awaited, then leg 2 (main)
   * is signed and broadcast. Fails closed if the approve doesn't confirm
   * — the main leg is NEVER broadcast against a stale or failed allowance.
   *
   * Phase B is intentionally EVM-only; non-EVM 2-leg flows are not a real
   * shape on mcp-ts today (Pattern 1 / Pattern 2 multi-leg flows are split
   * server-side via sequence_id and don't traverse this path).
   */
  private async signMultiLeg(
    _payload: any,
    chain: Chain,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const [approveLeg, mainLeg] = this.pendingLegs

    // H1: outer try/finally guarantees pendingLegs is cleared on ANY throw —
    // signServerTx for either leg, waitForEvmReceipt timeout/revert, or the
    // tx_hash invariant. Without this, an exception during leg-1 broadcast
    // (RPC down, keysign failure) leaves stale 2-leg state behind. The
    // receipt-wait still has its own try/catch below to wrap the error with
    // the approve hash for operator diagnosis.
    try {
      // Synthesize a single-leg envelope from approvalTxArgs by promoting it
      // to txArgs and stripping the multi-leg markers. M2: explicitly nil out
      // sibling tx fields (swap_tx / send_tx / top-level tx) inherited via
      // the parent spread so extractNestedTx's precedence — `swap_tx ||
      // send_tx || tx || txArgs.tx` — can't pick a stale sibling if mcp-ts
      // ever emits a hybrid envelope. signServerTx's extractNestedTx walks
      // the synthesized shape and picks `.txArgs.tx` cleanly.
      const approveEnvelope = {
        ...approveLeg.parent,
        txArgs: approveLeg.txArgs,
        approvalTxArgs: undefined,
        __multiLeg: undefined,
        swap_tx: undefined,
        send_tx: undefined,
        tx: undefined,
      }
      const approveResult = await this.signServerTx(approveEnvelope, chain, params)
      const approveTxHash = approveResult.tx_hash as string | undefined
      if (!approveTxHash) {
        throw new VaultError(VaultErrorCode.BroadcastFailed, 'signMultiLeg: approve leg returned no tx_hash')
      }

      // Journal the approve BEFORE the receipt-wait (audit F14). If waitForEvmReceipt
      // times out or the main leg later throws, this record still stops a retry
      // from re-broadcasting an approve that already hit the chain.
      this.recordBroadcastForTx(approveEnvelope, chain, approveTxHash)

      if (this.verbose)
        process.stderr.write(`[signMultiLeg] approve broadcast: ${approveTxHash}, waiting for receipt...\n`)

      try {
        await this.waitForEvmReceipt(chain, approveTxHash, { timeoutSec: 90 })
      } catch (err: any) {
        // Surface the approve hash so the operator can inspect it on the
        // explorer - a failed wait does NOT mean the approve was lost; it may
        // still confirm later. The main leg is held back regardless.
        // Map to VaultErrorCode.Timeout so normalizeAgentError surfaces a
        // typed timeout to callers and keeps the approve hash in the message
        // for explorer-side diagnosis.
        throw new VaultError(
          VaultErrorCode.Timeout,
          `signMultiLeg: approve leg ${approveTxHash} did not confirm: ${err?.message ?? err}`,
          err instanceof Error ? err : undefined
        )
      }

      if (this.verbose) process.stderr.write(`[signMultiLeg] approve confirmed, broadcasting main leg\n`)

      const mainEnvelope = {
        ...mainLeg.parent,
        txArgs: mainLeg.txArgs,
        approvalTxArgs: undefined,
        __multiLeg: undefined,
        swap_tx: undefined,
        send_tx: undefined,
        tx: undefined,
      }
      const mainResult = await this.signServerTx(mainEnvelope, chain, params)

      // Journal the main leg at its broadcast point too (symmetry with the
      // approve leg; the top-level signTxFromBuffer record skips multi-leg).
      this.recordBroadcastForTx(mainEnvelope, chain, mainResult.tx_hash as string | undefined)

      return {
        tx_hash: mainResult.tx_hash,
        approval_tx_hash: approveTxHash,
        chain: mainResult.chain,
        status: 'pending',
        explorer_url: mainResult.explorer_url,
      }
    } finally {
      // Always clear, success or throw — symmetric with the receipt-wait
      // catch's clear-and-rethrow. A persistent pendingLegs array would
      // confuse future signTxFromBuffer calls and complicate retry flows.
      this.pendingLegs = []
    }
  }

  /**
   * Poll vault.getTxStatus until the EVM tx confirms or the timeout fires.
   * Mirrors VaultBase's private `waitForConfirmation` (used by `vault.swap`
   * for its own approve-before-swap flow) — kept at the executor layer here
   * so we can stub it from unit tests without exposing private SDK methods.
   *
   * Throws on timeout or on receipt status === 'error' (revert). Returns on
   * success.
   */
  private async waitForEvmReceipt(chain: Chain, txHash: string, opts: { timeoutSec: number }): Promise<void> {
    const outcome = await pollTxStatusUntilFinal({
      chain,
      txHash,
      timeoutMs: opts.timeoutSec * 1_000,
      intervalMs: 3_000,
      getTxStatus: params => this.vault.getTxStatus(params),
      shouldRetryError: error => {
        if (error instanceof VaultError && error.code === VaultErrorCode.BroadcastFailed) return false
        return !(error as { message?: string } | undefined)?.message?.includes('reverted')
      },
    })

    if (outcome.result?.status === 'success') return
    if (outcome.result?.status === 'error') {
      throw new VaultError(VaultErrorCode.BroadcastFailed, `approve tx reverted (${txHash})`)
    }

    throw new VaultError(VaultErrorCode.Timeout, `approve tx ${txHash} not confirmed within ${opts.timeoutSec}s`)
  }

  /**
   * Build, sign, and broadcast a Solana swap locally using the SDK's swap flow.
   * Uses swap params from the tx_ready event to call vault.getSwapQuote → prepareSwapTx.
   */
  private async buildAndSignSolanaSwapLocally(serverTxData: any): Promise<Record<string, unknown>> {
    if (serverTxData._phase === 'prepare') {
      throw Object.assign(new Error('tx_ready prepare phase: deferring to server sign path'), {
        _phase: 'prepare',
      })
    }

    const fromChainName = serverTxData.from_chain || serverTxData.chain || 'Solana'
    const toChainName = serverTxData.to_chain as string | undefined
    const fromChain = resolveChain(fromChainName)
    if (!fromChain)
      throw Object.assign(new Error(`Unknown from_chain: ${fromChainName}`), {
        _phase: 'prepare',
      })

    const toChain = toChainName ? resolveChain(toChainName) : fromChain
    if (!toChain)
      throw Object.assign(new Error(`Unknown to_chain: ${toChainName}`), {
        _phase: 'prepare',
      })

    const amountStr = serverTxData.amount as string
    if (!amountStr)
      throw Object.assign(new Error('Missing amount in tx_ready data for local Solana swap build'), {
        _phase: 'prepare',
      })

    const fromToken = serverTxData.from_address as string | undefined
    const toToken = serverTxData.to_address as string | undefined
    const fromDecimals = serverTxData.from_decimals as number | undefined
    if (fromDecimals == null)
      throw Object.assign(new Error('Missing from_decimals in tx_ready data for local Solana swap build'), {
        _phase: 'prepare',
      })

    const fromCoin = { chain: fromChain, token: fromToken || undefined }
    const toCoin = { chain: toChain, token: toToken || undefined }

    let humanAmount: string
    try {
      humanAmount = formatUnits(BigInt(amountStr), fromDecimals)
    } catch {
      throw Object.assign(new Error(`Invalid amount in tx_ready data for local Solana swap build: ${amountStr}`), {
        _phase: 'prepare',
      })
    }

    if (this.verbose)
      process.stderr.write(
        `[solana_local_swap] from=${fromChainName} to=${toChainName || fromChainName} amount=${amountStr} human=${humanAmount}\n`
      )

    // Unlock vault if needed
    if (this.vault.isEncrypted && !(this.vault as any).isUnlocked?.()) {
      if (this.password) {
        await (this.vault as any).unlock?.(this.password)
      }
    }

    // Quote and prepare phase — errors here fall back to signServerTx.
    // Sign/broadcast errors must propagate to avoid double-submission.
    let quote, swapResult
    try {
      quote = await this.vault.getSwapQuote({
        fromCoin: fromCoin as any,
        toCoin: toCoin as any,
        amount: humanAmount,
      })

      swapResult = await this.vault.prepareSwapTx({
        fromCoin: fromCoin as any,
        toCoin: toCoin as any,
        amount: humanAmount,
        swapQuote: quote,
        autoApprove: true,
      })
    } catch (e: any) {
      throw Object.assign(e, { _phase: 'prepare' })
    }

    const payload = swapResult.keysignPayload
    const chain = fromChain

    const messageHashes = await this.vault.extractMessageHashes(payload)

    const signature = await this.vault.sign(
      {
        transaction: payload,
        chain,
        messageHashes,
      },
      {}
    )

    const txHash = await this.vault.broadcastTx({
      chain,
      keysignPayload: payload,
      signature,
    })

    this.pendingPayloads.clear()

    const explorerUrl = VultisigSdk.getTxExplorerUrl(chain, txHash)

    return {
      tx_hash: txHash,
      chain: chain.toString(),
      status: 'pending',
      explorer_url: explorerUrl,
    }
  }

  // ============================================================================
  // EVM Nonce Management
  // ============================================================================

  /**
   * Acquire chain-level file lock if the chain is EVM.
   * Releases any previously held lock first (e.g. from an abandoned build).
   */
  private async acquireEvmLockIfNeeded(chain: Chain): Promise<void> {
    if (!this.stateStore || !isEvmChain(chain)) return

    // Release any stale lock from a previous build that was never signed
    await this.releaseEvmLock(chain)

    const release = await this.stateStore.acquireChainLock(chain)
    this.chainLockReleases.set(chain, release)
    if (this.verbose) process.stderr.write(`[nonce] Acquired lock for ${chain}\n`)
  }

  /**
   * Release the held chain lock (no-op if not held).
   */
  private async releaseEvmLock(chain: Chain): Promise<void> {
    const release = this.chainLockReleases.get(chain)
    if (release) {
      await release()
      this.chainLockReleases.delete(chain)
      if (this.verbose) process.stderr.write(`[nonce] Released lock for ${chain}\n`)
    }
  }

  /**
   * Patch the EVM nonce in a keysign payload if our local state is ahead of on-chain.
   * The payload's blockchainSpecific.ethereumSpecific.nonce was set from RPC during
   * prepareSendTx(). If we have locally-tracked pending txs, we override with a higher value.
   *
   * Also detects evicted txs: if local state claims a higher nonce but there are
   * no pending txs in the mempool (pending == latest), the intermediate txs were
   * dropped and local state is stale.
   */
  private async patchEvmNonce(chain: Chain, payload: any): Promise<void> {
    if (!this.stateStore || !isEvmChain(chain)) return

    const bs = payload.blockchainSpecific
    if (!bs || bs.case !== 'ethereumSpecific') return

    const rpcNonce = bs.value.nonce as bigint
    const nextNonce = this.stateStore.getNextEvmNonce(chain, rpcNonce)

    if (nextNonce !== rpcNonce) {
      // Grace period: if we broadcast recently, the previous tx is likely still in
      // the mempool. Don't reset the nonce — trust the local state.
      //
      // 30s sized to cover the natural latency of LLM-mediated multi-tx flows
      // (turn 1 sign + broadcast + agent-backend round-trip + turn 2 sign typically
      // 20–35s end-to-end). The original 15s assumption — "one Ethereum block,
      // tx is mined or evicted by then" — undersizes for this flow because the
      // RPC's mempool view of a just-broadcast tx isn't necessarily visible via
      // getTransactionCount(pending) for ~30s, even when broadcast went through
      // the same RPC. Tradeoff: a genuinely-evicted tx within the 30s window
      // would cause the next sign to use a stuck nonce instead of recovering;
      // STATE_TTL_MS (10 min) bounds the worst case. See vultisig-sdk#357.
      const lastBroadcast = this.evmLastBroadcast.get(chain.toString()) ?? 0
      if (Date.now() - lastBroadcast < 30_000) {
        if (this.verbose)
          process.stderr.write(
            `[nonce] Keeping local nonce ${nextNonce} for ${chain} (broadcast ${Date.now() - lastBroadcast}ms ago)\n`
          )
        bs.value.nonce = nextNonce
        return
      }

      // Verify there are actually pending txs in the mempool before using a higher nonce.
      // If pending nonce == confirmed nonce, all intermediate txs were evicted.
      const pendingNonce = await this.fetchEvmPendingNonce(chain)
      if (pendingNonce !== null && pendingNonce === rpcNonce) {
        // No pending txs — local state is stale (txs were dropped from mempool)
        if (this.verbose)
          process.stderr.write(
            `[nonce] Stale local state for ${chain}: local=${nextNonce}, on-chain=${rpcNonce}, no pending txs — using on-chain nonce\n`
          )
        this.stateStore.clearEvmState(chain)
        return
      }

      // Safety: if the gap is large (>3) and we couldn't verify pending txs,
      // assume local state is stale rather than risk a large nonce gap
      const nonceGap = nextNonce - rpcNonce
      if (pendingNonce === null && nonceGap > 3n) {
        process.stderr.write(
          `[nonce] Warning: pending nonce was not verified for ${chain}; signing will continue with on-chain nonce ${rpcNonce} because the local gap is ${nonceGap}\n`
        )
        this.stateStore.clearEvmState(chain)
        return
      }

      bs.value.nonce = nextNonce
      if (pendingNonce === null) {
        process.stderr.write(
          `[nonce] Warning: pending nonce was not verified for ${chain}; signing will continue with local nonce ${nextNonce}\n`
        )
      }
      if (this.verbose) process.stderr.write(`[nonce] Patched ${chain} nonce: ${rpcNonce} → ${nextNonce}\n`)
    }
  }

  /**
   * Ensure the keysign payload's maxFeePerGas covers current network base fee.
   * Re-fetches latest base fee from RPC and bumps maxFeePerGas if it's too low.
   * Compensates for gas price drift between build time and sign time.
   */
  private async patchEvmGas(chain: Chain, payload: any): Promise<void> {
    if (!isEvmChain(chain)) return

    const bs = payload.blockchainSpecific
    if (!bs || bs.case !== 'ethereumSpecific') return

    const rpcUrl = getEvmRpcUrl(chain)

    try {
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_getBlockByNumber',
          params: ['latest', false],
          id: 1,
        }),
        signal: AbortSignal.timeout(5000),
      })
      const data = (await res.json()) as any
      if (!res.ok || data?.error || data?.result?.baseFeePerGas === undefined || data?.result?.baseFeePerGas === null) {
        throw new Error(`Failed to fetch current base fee for ${chain}`)
      }
      const baseFee = BigInt(data.result.baseFeePerGas)
      const currentPriorityFee = BigInt(bs.value.priorityFee || '0')
      const currentMaxFee = BigInt(bs.value.maxFeePerGasWei || '0')

      // BSC is the sole EVM chain that signs legacy type-0 transactions in the
      // shared fee mapper. Its priorityFee field is ignored by WalletCore, so
      // preserve the existing gas-price refresh without synthesizing a tip.
      const isEip1559 = chain !== Chain.BSC
      let priorityFee = currentPriorityFee

      if (isEip1559) {
        if (currentPriorityFee > 0n) {
          // Respect builder-supplied tips. The canonical clamp is also the
          // source of hard per-chain floors; only adopt an upward adjustment
          // here so its defensive ceiling cannot clobber an explicit value.
          const clampedPriorityFee = clampEvmPriorityFee(chain, currentPriorityFee)
          priorityFee = clampedPriorityFee > currentPriorityFee ? clampedPriorityFee : currentPriorityFee
        } else {
          let rpcPriorityFee = 0n

          try {
            const priorityRes = await fetch(rpcUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'eth_maxPriorityFeePerGas',
                params: [],
                id: 2,
              }),
              signal: AbortSignal.timeout(5000),
            })
            const priorityData = (await priorityRes.json()) as any
            if (priorityRes.ok && !priorityData?.error && priorityData?.result !== undefined) {
              rpcPriorityFee = BigInt(priorityData.result)
            }
          } catch {
            // Fall back to a base-fee-derived suggestion below. The base fee
            // has already been refreshed successfully, so a failed optional
            // tip RPC must not leave an EIP-1559 transaction at zero tip.
          }

          const fallbackPriorityFee = baseFee > 9n ? baseFee / 10n : 1n
          priorityFee = clampEvmPriorityFee(chain, rpcPriorityFee > 0n ? rpcPriorityFee : fallbackPriorityFee)
        }
      }

      // Minimum maxFeePerGas = baseFee * 2.5 + priorityFee
      // The 2.5x multiplier provides headroom for base fee fluctuations
      // during the MPC signing window (15-60 seconds)
      const minMaxFee = (baseFee * 25n) / 10n + priorityFee
      const patchedMaxFee = currentMaxFee < minMaxFee ? minMaxFee : currentMaxFee

      if (isEip1559 && priorityFee > patchedMaxFee) {
        priorityFee = patchedMaxFee
      }

      if (priorityFee !== currentPriorityFee) {
        bs.value.priorityFee = priorityFee.toString()
        if (this.verbose)
          process.stderr.write(`[gas] Patched ${chain} maxPriorityFeePerGas: ${currentPriorityFee} → ${priorityFee}\n`)
      }

      if (currentMaxFee < patchedMaxFee) {
        bs.value.maxFeePerGasWei = patchedMaxFee.toString()
        if (this.verbose)
          process.stderr.write(
            `[gas] Bumped ${chain} maxFeePerGas: ${currentMaxFee} → ${patchedMaxFee} (baseFee=${baseFee})\n`
          )
      }
    } catch {
      // Non-fatal — keep the original gas estimate
      process.stderr.write(
        `[gas] Warning: gas estimate was not refreshed for ${chain}; signing will continue with the original estimate\n`
      )
    }
  }

  /**
   * Fetch the pending nonce from RPC (eth_getTransactionCount with "pending" tag).
   * Returns null if the RPC call fails (non-fatal).
   */
  private async fetchEvmPendingNonce(chain: Chain): Promise<bigint | null> {
    // The old CLI-local map returned `undefined` for a non-EVM chain and the
    // caller bailed on the falsy URL. The shared resolver has no such escape
    // hatch, so keep the guard explicit: without it a non-EVM chain would POST
    // eth_getTransactionCount at an undefined endpoint.
    if (!isEvmChain(chain)) return null
    const rpcUrl = getEvmRpcUrl(chain)

    try {
      const address = await this.vault.address(chain)
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_getTransactionCount',
          params: [address, 'pending'],
          id: 1,
        }),
        signal: AbortSignal.timeout(5000),
      })
      const data = (await res.json()) as any
      if (!res.ok || data?.error || data?.result === undefined || data?.result === null) {
        return null
      }
      return BigInt(data.result)
    } catch {
      return null
    }
  }

  /**
   * Record the nonce(s) used after a successful broadcast.
   * For approve+swap flows with N message hashes, the highest nonce used is base + N - 1.
   */
  private recordEvmNonceFromPayload(chain: Chain, payload: any, numTxs: number): void {
    if (!this.stateStore || !isEvmChain(chain)) return

    const bs = payload.blockchainSpecific
    if (!bs || bs.case !== 'ethereumSpecific') return

    const baseNonce = bs.value.nonce as bigint
    const highestNonce = baseNonce + BigInt(Math.max(0, numTxs - 1))
    this.stateStore.recordEvmNonce(chain, highestNonce)
    if (this.verbose) process.stderr.write(`[nonce] Recorded ${chain} nonce: ${highestNonce}\n`)
  }

  // ============================================================================
  // EIP-712 Typed Data Signing
  // ============================================================================

  /**
   * Sign EIP-712 typed data. Computes the EIP-712 hash and signs with vault.signBytes().
   * Supports two formats:
   * - Flat: { domain, types, message, primaryType } — single typed data
   * - Payloads array: { payloads: [{id, domain, types, message, primaryType, chain}, ...] }
   *   Used by Polymarket which requires signing both an Order and a ClobAuth.
   */
  async signTypedData(_toolCallId: string, input: Record<string, unknown>): Promise<RecentAction> {
    return this.runTool('sign_typed_data', async () => {
      // Unlock vault once before signing
      if (this.vault.isEncrypted && !(this.vault as any).isUnlocked?.()) {
        if (this.password) {
          await (this.vault as any).unlock?.(this.password)
        }
      }

      // Handle payloads array format (e.g. Polymarket: order + auth)
      const payloads = input.payloads as Array<Record<string, unknown>> | undefined
      if (payloads && Array.isArray(payloads)) {
        if (this.verbose) process.stderr.write(`[sign_typed_data] payloads mode, ${payloads.length} items\n`)
        const signatures: Array<Record<string, unknown>> = []

        for (let i = 0; i < payloads.length; i++) {
          const payload = payloads[i]
          const id = (payload.id || payload.name || 'default') as string
          // Add delay between sequential MPC signing sessions to let VultiServer
          // co-signer release the previous session before starting the next one
          if (i > 0) {
            if (this.verbose) process.stderr.write(`[sign_typed_data] waiting 5s between MPC sessions...\n`)
            await new Promise(r => setTimeout(r, 5000))
          }
          const sig = await this.signSingleTypedData(payload)
          signatures.push({ id, ...sig })
          if (this.verbose) process.stderr.write(`[sign_typed_data] signed payload "${id}"\n`)
        }

        return {
          signatures,
          pm_order_ref: input.pm_order_ref,
          // pm_batch_ref rides along so the backend's batch auto-submit can
          // dispatch submit_deposit_wallet_batch — without it, Polymarket
          // BATCH approvals sign but never auto-submit.
          // Single-order flows omit pm_batch_ref, so this is `undefined` here.
          // That's safe: JSON.stringify (client.ts ships recent_actions as
          // JSON) drops undefined-valued keys, and the backend reads it by
          // value (ar.Data["pm_batch_ref"] → "" when absent) — no consumer
          // does an `in`/hasOwnProperty existence check. Same pattern as
          // pm_order_ref above.
          pm_batch_ref: input.pm_batch_ref,
          auto_submit: !!(input.__pm_auto_submit || input.auto_submit),
        }
      }

      // Flat format: domain, types, message, primaryType at top level
      return this.signSingleTypedData(input)
    })
  }

  /**
   * Sign a single EIP-712 typed data object.
   */
  private async signSingleTypedData(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const domain = params.domain as Record<string, unknown>
    const types = params.types as Record<string, Array<{ name: string; type: string }>>
    const message = params.message as Record<string, unknown>
    const primaryType = (params.primaryType || params.primary_type) as string

    if (!domain || !types || !message || !primaryType) {
      throw new Error('sign_typed_data requires domain, types, message, and primaryType')
    }

    if (this.verbose) process.stderr.write(`[sign_typed_data] primaryType=${primaryType} domain.name=${domain.name}\n`)

    const eip712Hash = computeEip712Hash(domain, types, primaryType, message)
    if (this.verbose) process.stderr.write(`[sign_typed_data] hash=${eip712Hash}\n`)

    // Resolve chain from domain chainId or explicit chain param
    const chainName = params.chain as string | undefined
    const chainId = domain.chainId as number | string | undefined
    let chain: Chain = Chain.Ethereum
    if (chainName) {
      chain = resolveChain(chainName) || Chain.Ethereum
    } else if (chainId) {
      chain = resolveChainId(chainId) || Chain.Ethereum
    }

    const sigResult = await this.vault.signBytes({
      data: eip712Hash,
      chain,
    })

    if (this.verbose)
      process.stderr.write(`[sign_typed_data] signed, format=${sigResult.format}, recovery=${sigResult.recovery}\n`)

    // Canonicalize to low-S (EIP-2) — a high-S signature is malleable and
    // rejected by OpenZeppelin's ECDSA library (which Polymarket's CLOB and
    // most EVM verifiers use). The recovery parity flips with the fold.
    const { r, s, recovery } = toCanonicalEvmSignature(sigResult.signature, sigResult.recovery ?? 0)
    const v = recovery + 27

    // 65-byte Ethereum signature: r (32 bytes) + s (32 bytes) + v (1 byte)
    const ethSignature = '0x' + r + s + v.toString(16).padStart(2, '0')

    // Recover-verify gate: confirm the assembled signature recovers to this
    // vault's own EVM address before returning success. Catches a wrong
    // recovery id, a botched low-S fold, or a digest/keyshare mismatch right
    // here instead of leaving it to surface as an opaque on-chain/CLOB
    // rejection. The EVM address is identical across every EVM chain (same
    // secp256k1 keyshare), so the chain resolved from domain.chainId is fine.
    const expectedAddress = await this.vault.address(chain)
    const recoveredAddress = await recoverAddress({
      hash: eip712Hash as `0x${string}`,
      signature: ethSignature as `0x${string}`,
    })
    if (recoveredAddress.toLowerCase() !== expectedAddress.toLowerCase()) {
      // Deterministic vault-context error, not a transient signing failure:
      // the keyshare that produced this signature does not belong to the
      // vault address the executor expected to sign for (e.g. the wrong vault
      // is loaded into this executor's context). Retrying signs with the same
      // keyshare and fails identically, so the message says so explicitly and
      // names the loaded vault (name + id) rather than leaving a blank failure,
      // so the operator can tell which vault is in context. The
      // SIGNATURE_RECOVERY_MISMATCH prefix stays stable for callers that key off it.
      throw new Error(
        `SIGNATURE_RECOVERY_MISMATCH: wrong vault context for EIP-712 signing — ` +
          `the loaded vault "${this.vault.name}" (id ${this.vault.id}) reports EVM address ` +
          `${expectedAddress} for ${chain}, but the signature recovered to ${recoveredAddress}. ` +
          `The signing keyshare does not belong to the expected vault address. This is a deterministic ` +
          `vault-context error, not a transient signing failure — retrying will not help. ` +
          `Verify the correct vault/keyshare is loaded into the executor context before signing again.`
      )
    }

    if (this.verbose) process.stderr.write(`[sign_typed_data] r=${r.slice(0, 16)}... s=${s.slice(0, 16)}... v=${v}\n`)

    return {
      signature: ethSignature,
      r: '0x' + r,
      s: '0x' + s,
      v,
      recovery,
      hash: eip712Hash,
    }
  }

  // ============================================================================
  // Address Book
  //
  // Live client-side tools — server-side `address_book_*` runs through MCP
  // for read; mutating writes have no local implementation yet.
  // ============================================================================

  async addressBookAdd(_toolCallId: string, input: Record<string, unknown>): Promise<RecentAction> {
    return this.runTool('address_book_add', () => this.addAddressBookImpl(input))
  }

  async addressBookRemove(_toolCallId: string, input: Record<string, unknown>): Promise<RecentAction> {
    return this.runTool('address_book_remove', () => this.removeAddressBookImpl(input))
  }

  // Backend `address_book { action: "add", entry: {...} }` flows through
  // this impl. The public `addressBookAdd` wrapper above tags results as
  // `tool: 'address_book_add'`; the new `addressBook` wrapper tags them as
  // `tool: 'address_book'` (matching the discriminator tool the backend emits).
  private async addAddressBookImpl(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.vultisig) {
      throw new Error(
        'address_book add requires the CLI SDK instance. Ensure AgentConfig.vultisig is set when creating the session.'
      )
    }
    const entry = params.entry as { name?: unknown; chain?: unknown; address?: unknown } | undefined
    if (!entry || typeof entry !== 'object') {
      throw new Error('address_book add: missing entry')
    }
    const chainName = entry.chain as string | undefined
    const chain = chainName ? resolveChain(chainName) : undefined
    if (!chain) throw new Error(`address_book add: unknown chain: ${chainName ?? '(missing)'}`)
    const address = entry.address as string | undefined
    if (!address) throw new Error('address_book add: entry.address is required')
    const name = (entry.name as string | undefined) ?? ''

    await this.vultisig.addAddressBookEntry([
      {
        chain,
        address,
        name,
        source: 'saved',
        dateAdded: Date.now(),
      },
    ])
    return { added: { chain: chain.toString(), address, name } }
  }

  private async removeAddressBookImpl(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.vultisig) {
      throw new Error(
        'address_book remove requires the CLI SDK instance. Ensure AgentConfig.vultisig is set when creating the session.'
      )
    }
    const entry = params.entry as { chain?: unknown; address?: unknown; name?: unknown } | undefined
    if (!entry || typeof entry !== 'object') {
      throw new Error('address_book remove: missing entry')
    }
    const chainName = entry.chain as string | undefined
    const chain = chainName ? resolveChain(chainName) : undefined
    if (!chain) throw new Error(`address_book remove: unknown chain: ${chainName ?? '(missing)'}`)

    // Agent often emits `{chain, name}` without resolving the address itself.
    // Look the entry up by name in the saved book so name-based removal works
    // without forcing the model to call get_address_book first. The SDK
    // dedupes saved entries by (chain, address) only — name is not unique —
    // so refuse ambiguous matches rather than silently deleting the first.
    let address = entry.address as string | undefined
    if (!address) {
      const name = entry.name as string | undefined
      if (!name) {
        throw new Error('address_book remove: entry.address or entry.name is required')
      }
      const book = await this.vultisig.getAddressBook(chain)
      const lower = name.toLowerCase()
      const matches = book.saved.filter(e => e.name.toLowerCase() === lower && e.chain === chain)
      if (matches.length === 0) {
        throw new Error(`address_book remove: no saved entry named "${name}" on ${chainName}`)
      }
      if (matches.length > 1) {
        const addrs = matches.map(m => m.address).join(', ')
        throw new Error(
          `address_book remove: ambiguous name "${name}" on ${chainName} — multiple addresses: ${addrs}. Specify entry.address explicitly.`
        )
      }
      address = matches[0].address
    }

    await this.vultisig.removeAddressBookEntry([{ chain, address }])
    return { removed: { chain: chain.toString(), address } }
  }
}

// ============================================================================
// Helpers
// ============================================================================

/** Resolve a CLI chain name or ID through the SDK's canonical resolver. */
export function resolveChain(name: string): Chain | null {
  return resolveChainReference(name) ?? null
}

/**
 * Try to resolve a Chain from tx_ready SSE data fields.
 */
function resolveChainFromTxReady(txReadyData: any): Chain | null {
  if (txReadyData.chain) {
    const chain = resolveChain(txReadyData.chain)
    if (chain) return chain
  }
  if (txReadyData.from_chain) {
    const chain = resolveChain(txReadyData.from_chain)
    if (chain) return chain
  }
  if (txReadyData.chain_id) {
    const chain = resolveChainId(txReadyData.chain_id)
    if (chain) return chain
  }
  // mcp-ts execute_* envelopes nest chain / chain_id under txArgs.
  if (txReadyData.txArgs?.chain) {
    const chain = resolveChain(txReadyData.txArgs.chain)
    if (chain) return chain
  }
  if (txReadyData.txArgs?.chain_id) {
    const chain = resolveChainId(txReadyData.txArgs.chain_id)
    if (chain) return chain
  }
  const swapTx = extractNestedTx(txReadyData)
  if (swapTx?.chainId) {
    const chain = resolveChainId(swapTx.chainId)
    if (chain) return chain
  }
  return null
}

/**
 * Extract the signable transaction object from a tx_ready envelope.
 *
 * mcp-go (build_*) emits the tx at top level under one of three keys:
 *   - swap_tx   (build_swap_tx output)
 *   - send_tx   (per-chain build_*_send output)
 *   - tx        (build_evm_tx output)
 *
 * mcp-ts (execute_*) wraps the tx one level deeper:
 *   - txArgs.tx (execute_send / execute_contract_call output)
 *
 * Multi-leg mcp-ts envelopes (execute_swap with both `approvalTxArgs`
 * and `txArgs`) are NOT extracted here — they're stashed by
 * storeServerTransaction and routed through signMultiLeg, which
 * synthesizes single-leg envelopes per leg and re-enters this helper.
 */
export function extractNestedTx(txReadyData: any): any {
  return txReadyData?.swap_tx || txReadyData?.send_tx || txReadyData?.tx || txReadyData?.txArgs?.tx
}

/**
 * Argument bag for `vault.send`, parsed from a non-EVM tx_ready envelope.
 */
export type NonEvmSendArgs = Omit<ParsedTxReadySend, 'kind' | 'envelope'>

/**
 * Parse a tx_ready envelope from the agent into `vault.send`-shaped args.
 *
 * mcp-ts emits a uniform shape for execute_send across non-EVM chains:
 *
 *     {
 *       chain: "<Chain>",
 *       resolved: { labels: { token_resolved: "<SYMBOL>", ... } },
 *       txArgs: {
 *         chain: "<Chain>", tx_encoding: "<utxo-psbt|solana-tx|cosmos-msg>",
 *         from: "...", to: "...",
 *         amount: "<base-unit integer string>",
 *         memo: "<optional>",
 *         // chain-specific extras (fee_rate, denom, sequence, ...) ignored
 *         // here — the SDK refreshes them at sign time.
 *       }
 *     }
 *
 * `amount` is ALWAYS a base-unit integer **by contract** — confirmed via
 * live envelope capture across BTC, SOL, and RUNE on 2026-05-10. Native
 * sends use the chain coin's decimals; token sends use the canonical token
 * resolver with vault-configured tokens. We convert to a decimal string
 * before passing to `vault.send`, which re-parses it with the same token
 * metadata. Round-trip is lossless via viem's `formatUnits` / `parseUnits`.
 *
 * **Defensive amount-length bound** (per PR #439 review finding 4): if
 * THORChain or mcp-ts ever returns a 26+ digit amount (10^26 wei = 10^8
 * ETH = ~$300B at current prices; well past any plausible legitimate
 * value), bail rather than try to format. This catches quote-side bugs
 * that would otherwise produce a magnitude-wrong envelope. The bound is
 * deliberately generous — even the largest realistic transfer fits
 * comfortably.
 *
 * Throws `VaultError(NotImplemented)` for chain-kinds Phase D PR 0
 * doesn't yet wire (`ripple`, `tron`). The dispatch caller should
 * never reach those branches today (envelopes for those chains hit the
 * stale-CLI-build error pre-PR-D), but the throw is defensive.
 */
function parseTxReadyForCli(
  serverTxData: unknown,
  defaultChain: Chain,
  tokens: ReturnType<VaultBase['getTokens']> = []
): ParsedTxReadyEnvelope {
  try {
    return parseTxReadyEnvelope(serverTxData, { defaultChain, tokens })
  } catch (error) {
    if (!(error instanceof TxReadyParseError)) throw error
    const code =
      error.code === 'INVALID_AMOUNT'
        ? VaultErrorCode.InvalidAmount
        : error.code === 'UNKNOWN_CHAIN'
          ? VaultErrorCode.UnsupportedChain
          : error.code === 'UNSUPPORTED_DEPOSIT' || error.code === 'UNSUPPORTED_ENVELOPE'
            ? VaultErrorCode.NotImplemented
            : VaultErrorCode.InvalidConfig
    throw new VaultError(code, error.message)
  }
}

export function parseNonEvmEnvelope(
  serverTxData: any,
  chain: Chain,
  tokens: ReturnType<VaultBase['getTokens']> = []
): NonEvmSendArgs {
  if (!serverTxData || typeof serverTxData !== 'object') {
    throw new VaultError(VaultErrorCode.InvalidConfig, 'parseNonEvmEnvelope: envelope missing txArgs')
  }
  const parsed = parseTxReadyForCli(serverTxData, chain, tokens)
  if (parsed.kind !== 'send') {
    throw new VaultError(
      VaultErrorCode.InvalidConfig,
      `parseNonEvmEnvelope: expected send envelope, got ${parsed.kind}`
    )
  }
  const { amount, memo, symbol, to } = parsed
  return { chain: parsed.chain, to, amount, symbol, memo }
}

/**
 * Resolve a Chain from a numeric EVM chain ID.
 */
export function resolveChainId(chainId: string | number): Chain | null {
  return resolveChainReference(chainId) ?? null
}
