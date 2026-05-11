/**
 * Agent Action Executor
 *
 * Per-tool handlers invoked from `dispatchClientSideTool` (client-side tool
 * path) and `signTxFromBuffer` (tx_ready synthesis path) in session.ts.
 * Each handler takes `(toolCallId, input)` and returns a `RecentAction` ready
 * to be flushed into the next outbound `context.recent_actions`.
 */
import { getChainKind } from '@vultisig/core-chain/ChainKind'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import type { VaultBase, Vultisig } from '@vultisig/sdk'
import { Chain, VaultError, VaultErrorCode, Vultisig as VultisigSdk } from '@vultisig/sdk'
import { formatUnits } from 'viem'

import { VaultStateStore } from '../core/VaultStateStore'
import { normalizeAgentError } from './agentErrors'
import type { RecentAction } from './types'

/**
 * THORChain swap-memo chain codes → SDK Chain enum. Used to resolve the
 * destination chain encoded in `=:CHAIN.ASSET:DEST::v0:slippage` memos
 * back to a Chain enum so vault.swap can dispatch.
 *
 * Reference: https://docs.thorchain.org/concepts/memos
 * Maya uses similar codes — additions here cover both ecosystems.
 */
const THOR_MEMO_CHAIN_TO_ENUM: Record<string, Chain> = {
  BTC: Chain.Bitcoin,
  ETH: Chain.Ethereum,
  BSC: Chain.BSC,
  AVAX: Chain.Avalanche,
  BASE: Chain.Base, // L2 — THORChain routinely quotes Base destinations (PR #439 review finding 1)
  ARB: Chain.Arbitrum, // L1-via-bridge path (PR #439 review finding 1)
  BCH: Chain.BitcoinCash,
  LTC: Chain.Litecoin,
  DOGE: Chain.Dogecoin,
  GAIA: Chain.Cosmos,
  THOR: Chain.THORChain,
  RUNE: Chain.THORChain,
  XRP: Chain.Ripple,
  DASH: Chain.Dash,
  ZEC: Chain.Zcash,
  MAYA: Chain.MayaChain,
  CACAO: Chain.MayaChain,
}

/**
 * THORChain abbreviated asset shortcuts → expanded `CHAIN.ASSET`. THORChain
 * memos accept both full (`XRP.XRP`) and abbreviated (`x`) notation for
 * common native assets to fit within the 250-byte memo limit when paired
 * with long destination addresses. Reference:
 * https://docs.thorchain.org/concepts/asset-notation#asset-shorthand
 */
const THOR_MEMO_ASSET_SHORTCUTS: Record<string, string> = {
  b: 'BTC.BTC',
  e: 'ETH.ETH',
  s: 'BSC.BNB',
  a: 'AVAX.AVAX',
  c: 'BCH.BCH',
  l: 'LTC.LTC',
  d: 'DOGE.DOGE',
  g: 'GAIA.ATOM',
  r: 'THOR.RUNE',
  x: 'XRP.XRP',
  cacao: 'MAYA.CACAO',
  dash: 'DASH.DASH',
  zec: 'ZEC.ZEC',
  // BASE / ARB don't have documented single-letter shortcuts; THORChain
  // emits these as the full CHAIN.ASSET form in memos. Listed in
  // THOR_MEMO_CHAIN_TO_ENUM only.
}

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

// Public RPC endpoints for refreshing gas estimates before signing.
// Used as fallback to ensure maxFeePerGas covers current base fee.
const EVM_GAS_RPC: Record<string, string> = {
  Ethereum: 'https://eth.llamarpc.com',
  BSC: 'https://bsc-dataseed.binance.org',
  Polygon: 'https://polygon-rpc.com',
  Avalanche: 'https://api.avax.network/ext/bc/C/rpc',
  Arbitrum: 'https://arb1.arbitrum.io/rpc',
  Optimism: 'https://mainnet.optimism.io',
  Base: 'https://mainnet.base.org',
  Blast: 'https://rpc.blast.io',
  Zksync: 'https://mainnet.era.zksync.io',
  Mantle: 'https://rpc.mantle.xyz',
  CronosChain: 'https://cronos-evm-rpc.publicnode.com',
  Hyperliquid: 'https://rpc.hyperliquid.xyz/evm',
  Sei: 'https://evm-rpc.sei-apis.com',
}

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

  constructor(vault: VaultBase, verbose = false, vaultId?: string, vultisig?: Vultisig) {
    this.vault = vault
    this.verbose = verbose
    this.vultisig = vultisig
    if (vaultId) {
      this.stateStore = new VaultStateStore(vaultId)
    }
  }

  setPassword(password: string): void {
    this.password = password
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
      if (!EVM_CHAINS.has(chain)) {
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

    // Clear stale payloads before storing the new server tx
    this.pendingPayloads.clear()
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
      const results: { chain: string; tokenId: string }[] = []
      for (const t of coins) {
        const chain = resolveChain(t.chain)
        if (!chain) throw new Error(`Unknown chain: ${t.chain}`)
        const tokenId = (t.contract_address || t.contractAddress || t.token_id || t.id) as string
        if (!tokenId) {
          throw new Error(
            `vault_coin remove: missing contract_address for ${t.ticker || t.symbol || 'coin'} on ${t.chain}`
          )
        }
        await this.vault.removeToken(chain, tokenId)
        results.push({ chain: chain.toString(), tokenId })
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
    await this.vault.removeToken(chain, tokenId)
    return { chain: chain.toString(), removed: true }
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
              process.stderr.write(`[sign_tx] Solana local build failed (${e.message}), falling back to signServerTx\n`)
          } else {
            throw e
          }
        }
      }
      if (!result) result = await this.signServerTx(payload, chain, {})
      if (payload.sequence_id) result.sequence_id = payload.sequence_id
      return result
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
   * Non-EVM signing path: parse the agent's tx_ready envelope into a
   * `vault.send`-shaped argument bag and call through. The SDK already
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

    // THORChain / MayaChain MsgDeposit branch — agent emitted a swap
    // envelope sourcing from the cosmos chain natively.
    if (txArgs.msg_type === 'deposit' && (chain === Chain.THORChain || chain === Chain.MayaChain)) {
      return this.signThorMsgDepositSwap(serverTxData, chain)
    }

    const args = parseNonEvmEnvelope(serverTxData, chain)
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
   * IMPORTANT — destination address handling: `vault.swap` re-derives the
   * destination address from `vault.address(toChain)` when fetching the
   * native swap quote (see `findSwapQuote` → `getNativeSwapQuote` —
   * `destination: to.address`). It does NOT honor the destination address
   * encoded in the envelope's memo. As a fund-safety guard we therefore
   * require the memo's destination address to match the vault's own
   * destination address (self-swap) and throw otherwise — see Phase D
   * review F1. Cross-account routing must wait on a Phase E SDK extension
   * that lets `vault.swap` accept a user-supplied destination.
   */
  private async signThorMsgDepositSwap(serverTxData: any, chain: Chain): Promise<Record<string, unknown>> {
    const txArgs = serverTxData?.txArgs ?? {}
    const memo: string = typeof txArgs.memo === 'string' ? txArgs.memo : ''
    const parsed = parseThorSwapMemo(memo)

    const toChain = THOR_MEMO_CHAIN_TO_ENUM[parsed.destChainCode]
    if (!toChain) {
      throw new VaultError(
        VaultErrorCode.UnsupportedChain,
        `signThorMsgDepositSwap: unsupported destination chain code '${parsed.destChainCode}' in memo '${memo}'.`
      )
    }

    // Fund-safety: require memo destination to equal the vault's own
    // destination address. vault.swap silently substitutes the vault's
    // address into the broadcast memo, so any mismatch here would misroute
    // funds without warning. Phase D self-swaps remain supported (BTC
    // tests confirmed 3.565 XRP arrived at the vault's own XRP address).
    //
    // **Empty `destAddress` semantics** (PR #439 review finding 2):
    // THORChain treats an empty DEST in a swap memo as "refund to source"
    // — the chain substitutes its own record of the user's address on the
    // destination chain. The leading-truthiness check intentionally skips
    // the equality assertion in that case: vault.swap's substitution will
    // land at the vault's own dest address (which IS the right address),
    // so there's nothing to compare against. A malicious party can't
    // exploit this because the substitution is constrained to addresses
    // THORChain associates with the source signer (i.e. the vault).
    const vaultDestAddress = await this.vault.address(toChain)
    // EVM addresses are case-insensitive on-chain — TrustWallet wallet-core
    // returns EIP-55 checksummed form, but THORChain memos can carry either
    // case depending on quote source. Normalize both sides for EVM
    // destinations to avoid false-positive rejections on legitimate
    // self-swaps. Non-EVM chains use case-sensitive base58/bech32/etc.
    // encodings — leave those untouched.
    const normalizeForCompare = (addr: string): string => (EVM_CHAINS.has(toChain) ? addr.toLowerCase() : addr)
    if (parsed.destAddress && normalizeForCompare(parsed.destAddress) !== normalizeForCompare(vaultDestAddress)) {
      throw new VaultError(
        VaultErrorCode.NotImplemented,
        `signThorMsgDepositSwap: memo destination '${parsed.destAddress}' does not match vault address '${vaultDestAddress}' on ${toChain}. ` +
          `Phase D only supports self-swaps; cross-account routing requires a Phase E SDK extension that passes the user-supplied destination through to vault.swap.`
      )
    }

    // From-asset: derived from the source chain's native ticker (RUNE on
    // THORChain, CACAO on MayaChain).
    const fromSymbol = chain === Chain.THORChain ? 'RUNE' : 'CACAO'

    // Convert base-units amount → decimal string for vault.swap. We refuse
    // to fall through with a default (e.g. '0') because that would mask
    // malformed envelopes by silently submitting a zero-value swap.
    const amountRaw = typeof txArgs.amount === 'string' ? txArgs.amount : undefined
    if (!amountRaw) {
      throw new VaultError(
        VaultErrorCode.InvalidConfig,
        `signThorMsgDepositSwap: missing or non-string 'amount' field on ${chain} envelope`
      )
    }
    const amountDecimal = convertBaseUnitsToDecimal(chain, amountRaw, 'signThorMsgDepositSwap')

    if (this.verbose)
      process.stderr.write(
        `[sign_thor_msg_deposit_swap] ${fromSymbol}@${chain} → ${parsed.destAsset}@${toChain}, amount=${amountDecimal}, memo='${memo}'\n`
      )

    const result = await this.vault.swap({
      fromChain: chain,
      fromSymbol,
      toChain,
      toSymbol: parsed.destAsset,
      amount: amountDecimal,
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
   * Sign and broadcast a server-built EVM transaction (raw EVM tx from
   * tx_ready SSE). Uses vault.prepareSendTx with memo field to carry the
   * calldata, plus EVM-specific nonce/lock plumbing that Phase B's
   * `signMultiLeg` depends on for back-to-back approve+main broadcasts.
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
      const address = await this.vault.address(chain)
      const balance = await this.vault.balance(chain)

      const coin: AccountCoin = {
        chain,
        address,
        decimals: (balance as any).decimals || 18,
        ticker: (balance as any).symbol || chain.toString(),
      }

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

      // Build keysign payload using prepareSendTx - memo field carries EVM calldata
      // For 0-value contract calls (e.g. approve), use a tiny amount to bypass the SDK's
      // refineKeysignAmount check, then patch toAmount back to "0" after building.
      const buildAmount = amount === 0n && hasCalldata ? 1n : amount
      const keysignPayload = await this.vault.prepareSendTx({
        coin,
        receiver: swapTx.to,
        amount: buildAmount,
        memo: swapTx.data,
      })

      // Patch toAmount to actual value for 0-value contract calls
      if (amount === 0n && hasCalldata) {
        ;(keysignPayload as any).toAmount = '0'
      }

      // Patch EVM nonce if local state is ahead of on-chain
      await this.patchEvmNonce(chain, keysignPayload)

      // If the server provided a gas_limit, use it — the MCP server's estimate
      // is more accurate for complex DeFi calls (e.g. Pendle router ~1.2M gas)
      // that the SDK's prepareSendTx may underestimate.
      if (swapTx.gas_limit) {
        const bs = (keysignPayload as any).blockchainSpecific
        if (bs?.case === 'ethereumSpecific' && bs.value?.gasLimit) {
          const serverGas = swapTx.gas_limit.toString()
          const currentGas = bs.value.gasLimit.toString()
          // Use the higher of server estimate and SDK estimate
          if (BigInt(serverGas) > BigInt(currentGas)) {
            bs.value.gasLimit = serverGas
            if (this.verbose) process.stderr.write(`[gas] Using server gas_limit: ${serverGas} (was ${currentGas})\n`)
          }
        }
      }

      // Refresh gas estimate — base fee may have drifted since prepareSendTx
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
    const intervalMs = 3_000
    const deadline = Date.now() + opts.timeoutSec * 1_000
    while (Date.now() < deadline) {
      try {
        const result = await (this.vault as any).getTxStatus({ chain, txHash })
        if (result?.status === 'success') return
        if (result?.status === 'error') {
          // Typed BroadcastFailed lets callers distinguish a revert (the tx
          // mined but reverted on-chain) from a generic timeout below.
          throw new VaultError(VaultErrorCode.BroadcastFailed, `approve tx reverted (${txHash})`)
        }
      } catch (e: any) {
        // Re-throw revert failures; treat other errors (network, RPC) as
        // transient and keep polling until the deadline.
        if (e instanceof VaultError && e.code === VaultErrorCode.BroadcastFailed) throw e
        if (e?.message?.includes('reverted')) throw e
      }
      await new Promise(r => setTimeout(r, intervalMs))
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
    if (!this.stateStore || !EVM_CHAINS.has(chain)) return

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
    if (!this.stateStore || !EVM_CHAINS.has(chain)) return

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
        if (this.verbose)
          process.stderr.write(
            `[nonce] Large nonce gap for ${chain} (${nonceGap}) and couldn't verify pending txs — using on-chain nonce ${rpcNonce}\n`
          )
        this.stateStore.clearEvmState(chain)
        return
      }

      bs.value.nonce = nextNonce
      if (this.verbose) process.stderr.write(`[nonce] Patched ${chain} nonce: ${rpcNonce} → ${nextNonce}\n`)
    }
  }

  /**
   * Ensure the keysign payload's maxFeePerGas covers current network base fee.
   * Re-fetches latest base fee from RPC and bumps maxFeePerGas if it's too low.
   * Compensates for gas price drift between build time and sign time.
   */
  private async patchEvmGas(chain: Chain, payload: any): Promise<void> {
    if (!EVM_CHAINS.has(chain)) return

    const bs = payload.blockchainSpecific
    if (!bs || bs.case !== 'ethereumSpecific') return

    const rpcUrl = EVM_GAS_RPC[chain as string]
    if (!rpcUrl) return

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
      const baseFee = BigInt(data.result?.baseFeePerGas || '0')
      if (baseFee === 0n) return

      const currentPriorityFee = BigInt(bs.value.priorityFee || '0')
      const currentMaxFee = BigInt(bs.value.maxFeePerGasWei || '0')

      // Minimum maxFeePerGas = baseFee * 2.5 + priorityFee
      // The 2.5x multiplier provides headroom for base fee fluctuations
      // during the MPC signing window (15-60 seconds)
      const minMaxFee = (baseFee * 25n) / 10n + currentPriorityFee

      if (currentMaxFee < minMaxFee) {
        bs.value.maxFeePerGasWei = minMaxFee.toString()
        if (this.verbose)
          process.stderr.write(
            `[gas] Bumped ${chain} maxFeePerGas: ${currentMaxFee} → ${minMaxFee} (baseFee=${baseFee})\n`
          )
      }
    } catch {
      // Non-fatal — keep the original gas estimate
      if (this.verbose) process.stderr.write(`[gas] Failed to refresh base fee for ${chain}, keeping original\n`)
    }
  }

  /**
   * Fetch the pending nonce from RPC (eth_getTransactionCount with "pending" tag).
   * Returns null if the RPC call fails (non-fatal).
   */
  private async fetchEvmPendingNonce(chain: Chain): Promise<bigint | null> {
    const rpcUrl = EVM_GAS_RPC[chain as string]
    if (!rpcUrl) return null

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
      return BigInt(data.result || '0')
    } catch {
      return null
    }
  }

  /**
   * Record the nonce(s) used after a successful broadcast.
   * For approve+swap flows with N message hashes, the highest nonce used is base + N - 1.
   */
  private recordEvmNonceFromPayload(chain: Chain, payload: any, numTxs: number): void {
    if (!this.stateStore || !EVM_CHAINS.has(chain)) return

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

    const eip712Hash = await computeEIP712Hash(domain, types, primaryType, message)
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

    const { r, s } = parseDERSignature(sigResult.signature)
    const v = (sigResult.recovery ?? 0) + 27

    // 65-byte Ethereum signature: r (32 bytes) + s (32 bytes) + v (1 byte)
    const ethSignature = '0x' + r + s + v.toString(16).padStart(2, '0')

    if (this.verbose) process.stderr.write(`[sign_typed_data] r=${r.slice(0, 16)}... s=${s.slice(0, 16)}... v=${v}\n`)

    return {
      signature: ethSignature,
      r: '0x' + r,
      s: '0x' + s,
      v,
      recovery: sigResult.recovery,
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

function resolveChain(name: string): Chain | null {
  if (!name) return null

  // Direct enum match
  if (Object.values(Chain).includes(name as Chain)) {
    return name as Chain
  }

  // Case-insensitive search
  const lower = name.toLowerCase()
  for (const [, value] of Object.entries(Chain)) {
    if (typeof value === 'string' && value.toLowerCase() === lower) {
      return value as Chain
    }
  }

  // Common aliases
  const aliases: Record<string, string> = {
    eth: 'Ethereum',
    btc: 'Bitcoin',
    sol: 'Solana',
    bnb: 'BSC',
    avax: 'Avalanche',
    matic: 'Polygon',
    arb: 'Arbitrum',
    op: 'Optimism',
    ltc: 'Litecoin',
    doge: 'Dogecoin',
    dot: 'Polkadot',
    atom: 'Cosmos',
    rune: 'THORChain',
    thor: 'THORChain',
    sui: 'Sui',
    ton: 'Ton',
    trx: 'Tron',
    xrp: 'Ripple',
  }

  const aliased = aliases[lower]
  if (aliased && Object.values(Chain).includes(aliased as Chain)) {
    return aliased as Chain
  }

  return null
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
export type NonEvmSendArgs = {
  chain: Chain
  to: string
  /** Decimal amount string (human units), suitable for `vault.send`. */
  amount: string
  /** Optional token symbol; omit for native sends. */
  symbol?: string
  memo?: string
}

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
 * `amount` is ALWAYS base-unit integer (sats / lamports / uatom-equiv /
 * wei) **by contract** — confirmed via live envelope capture across BTC,
 * SOL, RUNE on 2026-05-10. We convert to a decimal string before passing
 * to `vault.send`, which then re-parses to bigint via the chain's native
 * decimals. Round-trip is lossless via viem's `formatUnits` /
 * `parseUnits`.
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
const MAX_AMOUNT_DIGITS = 26

/**
 * Convert a base-unit integer-string amount → decimal string using the
 * chain's native fee-coin decimals. Used by both `parseNonEvmEnvelope`
 * (non-EVM send dispatch) and `signThorMsgDepositSwap` (RUNE/CACAO swap
 * dispatch). Keeping the validation logic in one place ensures both paths
 * fail closed identically on:
 *
 * 1. **Magnitude-bug envelopes** — amount strings longer than 26 digits
 *    (10^26 wei = 10^8 ETH = ~$300B). Defensive bound against quote-side
 *    bugs producing magnitude-wrong envelopes.
 * 2. **Unregistered chain decimals** — `chainFeeCoin[chain]?.decimals`
 *    must not silently fall back to a default. A missing registry entry
 *    on a chain this dispatcher claims to support is a real bug; we
 *    throw `UnsupportedChain` instead of substituting 8 and producing a
 *    magnitude-wrong swap.
 * 3. **Non-numeric / overflow amounts** — `BigInt()` parse failures are
 *    surfaced as `InvalidAmount` with context.
 */
function convertBaseUnitsToDecimal(chain: Chain, amountRaw: string, context: string): string {
  if (amountRaw.length > MAX_AMOUNT_DIGITS) {
    throw new VaultError(
      VaultErrorCode.InvalidAmount,
      `${context}: amount '${amountRaw}' for ${chain} exceeds ${MAX_AMOUNT_DIGITS}-digit safety bound. ` +
        'Likely a quote-side bug. Refusing to sign.'
    )
  }
  const decimals = chainFeeCoin[chain]?.decimals
  if (decimals === undefined) {
    throw new VaultError(VaultErrorCode.UnsupportedChain, `${context}: no native decimals registered for ${chain}`)
  }
  try {
    return formatUnits(BigInt(amountRaw), decimals)
  } catch (err: any) {
    throw new VaultError(
      VaultErrorCode.InvalidAmount,
      `${context}: failed to convert amount '${amountRaw}' for ${chain}: ${err?.message ?? err}`
    )
  }
}

export function parseNonEvmEnvelope(serverTxData: any, chain: Chain): NonEvmSendArgs {
  const txArgs = serverTxData?.txArgs ?? serverTxData
  if (!txArgs || typeof txArgs !== 'object') {
    throw new VaultError(VaultErrorCode.InvalidConfig, 'parseNonEvmEnvelope: envelope missing txArgs')
  }

  const to: string | undefined = typeof txArgs.to === 'string' ? txArgs.to : undefined
  if (!to) {
    throw new VaultError(VaultErrorCode.InvalidConfig, `parseNonEvmEnvelope: missing 'to' field for ${chain}`)
  }

  const amountRaw: string | undefined = typeof txArgs.amount === 'string' ? txArgs.amount : undefined
  if (!amountRaw) {
    throw new VaultError(VaultErrorCode.InvalidConfig, `parseNonEvmEnvelope: missing 'amount' field for ${chain}`)
  }

  // Convert base units (e.g. "1000" sats) → decimal string ("0.00001")
  // using the chain's native fee-coin decimals. vault.send's parseAmount
  // re-multiplies by the same decimals to recover bigint base units.
  const amountDecimal = convertBaseUnitsToDecimal(chain, amountRaw, 'parseNonEvmEnvelope')

  // Token symbol — for native sends, leave undefined (vault.send defaults
  // to native). resolved.labels.token_resolved is the agent-resolved
  // symbol; for native it equals the chain's native ticker (BTC/SOL/RUNE).
  // Phase D PR 0 only wires native sends; non-native (e.g. SPL, TRC-20)
  // is PR 1+ scope.
  let symbol: string | undefined
  const tokenResolved = serverTxData?.resolved?.labels?.token_resolved
  const nativeTicker = chainFeeCoin[chain]?.ticker
  if (typeof tokenResolved === 'string' && tokenResolved !== nativeTicker) {
    symbol = tokenResolved
  }

  const memo: string | undefined = typeof txArgs.memo === 'string' && txArgs.memo.length > 0 ? txArgs.memo : undefined

  return { chain, to, amount: amountDecimal, symbol, memo }
}

/**
 * Parsed shape of a THORChain swap memo (`=:CHAIN.ASSET:DEST[::v0:slippage]`).
 *
 * - `destChainCode` is the raw memo chain prefix (`XRP`, `ETH`, ...).
 *   Caller is responsible for mapping it to a `Chain` enum via
 *   `THOR_MEMO_CHAIN_TO_ENUM` and rejecting unsupported codes.
 * - `destAsset` is the asset ticker only — any ERC-20 contract suffix
 *   (`USDC-0X...`) is stripped because vault.swap takes the ticker.
 * - `destAddress` is the user-supplied destination on the destination
 *   chain. May be empty when the memo omits it (THORChain treats this
 *   as "refund to source"); callers should still validate against the
 *   vault's own destination address before broadcasting since vault.swap
 *   silently substitutes its own address into the broadcast memo.
 */
export type ParsedThorSwapMemo = {
  destChainCode: string
  destAsset: string
  destAddress: string
}

/**
 * Parse a THORChain swap memo into its destination-routing components.
 *
 * Accepts the shorthand notation documented at
 * https://docs.thorchain.org/concepts/asset-notation#asset-shorthand
 * (`x` → `XRP.XRP`, `e` → `ETH.ETH`, ...) — common shortcuts let memos
 * fit inside THORChain's 250-byte limit when paired with long EVM
 * destination addresses.
 *
 * Throws `VaultError(NotImplemented)` for non-swap memos (anything that
 * doesn't start with the `=:` swap prefix — e.g. LP `+:POOL` or `-:POOL`,
 * which are deferred to Phase E). Throws `VaultError(InvalidConfig)`
 * when the swap memo is structurally malformed (no CHAIN.ASSET segment).
 */
export function parseThorSwapMemo(memo: string): ParsedThorSwapMemo {
  if (!memo.startsWith('=:')) {
    throw new VaultError(
      VaultErrorCode.NotImplemented,
      `parseThorSwapMemo: only swap memos (=:CHAIN.ASSET:DEST...) supported on this path; got memo='${memo}'. ` +
        `LP / non-swap MsgDeposit flows route through different SDK helpers (Phase E follow-up).`
    )
  }

  const memoBody = memo.slice(2) // strip leading '=:'
  const parts = memoBody.split(':')

  let chainAsset = parts[0]
  if (chainAsset && !chainAsset.includes('.')) {
    const expanded = THOR_MEMO_ASSET_SHORTCUTS[chainAsset.toLowerCase()]
    if (expanded) chainAsset = expanded
  }
  if (!chainAsset || !chainAsset.includes('.')) {
    throw new VaultError(
      VaultErrorCode.InvalidConfig,
      `parseThorSwapMemo: malformed swap memo '${memo}': missing CHAIN.ASSET in first segment.`
    )
  }

  const [destChainCode, destAssetRaw] = chainAsset.split('.')
  // The destAsset can carry an ERC-20 contract suffix ("ETH.USDC-0X...");
  // for vault.swap we only need the ticker (part before `-`).
  const destAsset = destAssetRaw?.split('-')[0] ?? ''
  const destAddress = typeof parts[1] === 'string' ? parts[1] : ''

  return { destChainCode, destAsset, destAddress }
}

/**
 * Resolve a Chain from a numeric EVM chain ID.
 */
function resolveChainId(chainId: string | number): Chain | null {
  const id = typeof chainId === 'string' ? parseInt(chainId, 10) : chainId
  if (isNaN(id)) return null

  const chainIdMap: Record<number, Chain> = {
    1: Chain.Ethereum,
    56: Chain.BSC,
    137: Chain.Polygon,
    43114: Chain.Avalanche,
    42161: Chain.Arbitrum,
    10: Chain.Optimism,
    8453: Chain.Base,
    81457: Chain.Blast,
    324: Chain.Zksync,
    25: Chain.CronosChain,
  }
  return chainIdMap[id] || null
}

// ============================================================================
// EIP-712 Typed Data Hashing
// ============================================================================

/**
 * Compute the EIP-712 hash: keccak256("\x19\x01" || domainSeparator || structHash)
 */
async function computeEIP712Hash(
  domain: Record<string, unknown>,
  types: Record<string, Array<{ name: string; type: string }>>,
  primaryType: string,
  message: Record<string, unknown>
): Promise<string> {
  const { keccak_256 } = await import('@noble/hashes/sha3')

  const domainSeparator = hashStruct('EIP712Domain', domain, types, keccak_256)
  const messageHash = hashStruct(primaryType, message, types, keccak_256)

  // \x19\x01 || domainSeparator || messageHash
  const prefix = new Uint8Array([0x19, 0x01])
  const combined = new Uint8Array(2 + 32 + 32)
  combined.set(prefix, 0)
  combined.set(domainSeparator, 2)
  combined.set(messageHash, 34)

  const finalHash = keccak_256(combined)
  return '0x' + Buffer.from(finalHash).toString('hex')
}

/**
 * Hash a struct: keccak256(typeHash || encodeData)
 */
function hashStruct(
  typeName: string,
  data: Record<string, unknown>,
  types: Record<string, Array<{ name: string; type: string }>>,
  keccak: (data: Uint8Array) => Uint8Array
): Uint8Array {
  const typeHash = hashType(typeName, types, keccak)
  const encodedData = encodeData(typeName, data, types, keccak)

  const combined = new Uint8Array(32 + encodedData.length)
  combined.set(typeHash, 0)
  combined.set(encodedData, 32)

  return keccak(combined)
}

/**
 * Compute the type hash: keccak256(encodeType)
 */
function hashType(
  typeName: string,
  types: Record<string, Array<{ name: string; type: string }>>,
  keccak: (data: Uint8Array) => Uint8Array
): Uint8Array {
  const encoded = encodeType(typeName, types)
  return keccak(new TextEncoder().encode(encoded))
}

/**
 * Encode a type string including referenced types, sorted alphabetically.
 * e.g. "Order(uint256 salt,address maker,...)"
 */
function encodeType(typeName: string, types: Record<string, Array<{ name: string; type: string }>>): string {
  const fields = getTypeFields(typeName, types)
  if (!fields) return ''

  // Find all referenced struct types
  const refs = new Set<string>()
  findReferencedTypes(typeName, types, refs)
  refs.delete(typeName) // primary type goes first

  const sortedRefs = [...refs].sort()

  let result = `${typeName}(${fields.map(f => `${f.type} ${f.name}`).join(',')})`
  for (const ref of sortedRefs) {
    const refFields = getTypeFields(ref, types)
    if (refFields) {
      result += `${ref}(${refFields.map(f => `${f.type} ${f.name}`).join(',')})`
    }
  }
  return result
}

function findReferencedTypes(
  typeName: string,
  types: Record<string, Array<{ name: string; type: string }>>,
  refs: Set<string>
): void {
  if (refs.has(typeName)) return
  const fields = getTypeFields(typeName, types)
  if (!fields) return
  refs.add(typeName)
  for (const field of fields) {
    const baseType = field.type.replace(/\[\d*\]$/, '')
    if (types[baseType]) {
      findReferencedTypes(baseType, types, refs)
    }
  }
}

/**
 * Get fields for a type, including implicit EIP712Domain fields.
 */
function getTypeFields(
  typeName: string,
  types: Record<string, Array<{ name: string; type: string }>>
): Array<{ name: string; type: string }> | undefined {
  if (types[typeName]) return types[typeName]

  // EIP712Domain is implicit — infer from domain object fields
  if (typeName === 'EIP712Domain') {
    // Standard EIP-712 domain fields in canonical order
    return [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ]
  }
  return undefined
}

/**
 * ABI-encode struct data fields (each as 32 bytes).
 */
function encodeData(
  typeName: string,
  data: Record<string, unknown>,
  types: Record<string, Array<{ name: string; type: string }>>,
  keccak: (data: Uint8Array) => Uint8Array
): Uint8Array {
  const fields = getTypeFields(typeName, types)
  if (!fields) return new Uint8Array(0)

  const chunks: Uint8Array[] = []
  for (const field of fields) {
    const value = data[field.name]
    if (value === undefined || value === null) continue
    chunks.push(encodeField(field.type, value, types, keccak))
  }

  const totalLen = chunks.reduce((sum, c) => sum + c.length, 0)
  const result = new Uint8Array(totalLen)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

/**
 * Encode a single field value to 32 bytes.
 */
function encodeField(
  type: string,
  value: unknown,
  types: Record<string, Array<{ name: string; type: string }>>,
  keccak: (data: Uint8Array) => Uint8Array
): Uint8Array {
  // Dynamic types: string and bytes → keccak256 of the content
  if (type === 'string') {
    return keccak(new TextEncoder().encode(value as string))
  }
  if (type === 'bytes') {
    const hex = (value as string).startsWith('0x') ? (value as string).slice(2) : (value as string)
    const bytes = hexToBytes(hex)
    return keccak(bytes)
  }

  // Struct type → hashStruct recursively
  const baseType = type.replace(/\[\d*\]$/, '')
  if (types[baseType] && !type.endsWith(']')) {
    return hashStruct(baseType, value as Record<string, unknown>, types, keccak)
  }

  // Array type → keccak256 of concatenated encoded elements
  if (type.endsWith(']')) {
    const arr = value as unknown[]
    const elementType = type.replace(/\[\d*\]$/, '')
    const encodedElements = arr.map(el => encodeField(elementType, el, types, keccak))
    const totalLen = encodedElements.reduce((sum, e) => sum + e.length, 0)
    const concat = new Uint8Array(totalLen)
    let off = 0
    for (const el of encodedElements) {
      concat.set(el, off)
      off += el.length
    }
    return keccak(concat)
  }

  // Atomic types → 32-byte padded
  const result = new Uint8Array(32)

  if (type === 'address') {
    const addr = (value as string).startsWith('0x') ? (value as string).slice(2) : (value as string)
    const bytes = hexToBytes(addr.toLowerCase())
    result.set(bytes, 32 - bytes.length)
    return result
  }

  if (type === 'bool') {
    if (value === true || value === 'true' || value === 1 || value === '1') {
      result[31] = 1
    }
    return result
  }

  if (type.startsWith('uint') || type.startsWith('int')) {
    const n = BigInt(value as string | number)
    const hex = n.toString(16).padStart(64, '0')
    const bytes = hexToBytes(hex)
    result.set(bytes, 32 - bytes.length)
    return result
  }

  if (type.startsWith('bytes')) {
    // Fixed-size bytes (bytes1..bytes32) — right-padded
    const hex = (value as string).startsWith('0x') ? (value as string).slice(2) : (value as string)
    const bytes = hexToBytes(hex)
    result.set(bytes, 0) // right-padded, not left-padded
    return result
  }

  // Fallback: treat as uint256
  const n = BigInt(value as string | number)
  const hex = n.toString(16).padStart(64, '0')
  const bytes = hexToBytes(hex)
  result.set(bytes, 32 - bytes.length)
  return result
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  const padded = clean.length % 2 === 1 ? '0' + clean : clean
  const bytes = new Uint8Array(padded.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/**
 * Parse a DER-encoded ECDSA signature into r and s hex strings (each 32 bytes / 64 hex chars).
 */
function parseDERSignature(sigHex: string): { r: string; s: string } {
  const raw = sigHex.startsWith('0x') ? sigHex.slice(2) : sigHex

  // If it's already 128 hex chars (64 bytes), it's raw r||s
  if (raw.length === 128) {
    return { r: raw.slice(0, 64), s: raw.slice(64) }
  }

  // DER format: 30 <len> 02 <rlen> <r> 02 <slen> <s>
  let offset = 0
  if (raw.slice(offset, offset + 2) !== '30') {
    // Not DER, try raw
    return {
      r: raw.slice(0, 64).padStart(64, '0'),
      s: raw.slice(64).padStart(64, '0'),
    }
  }
  offset += 2
  offset += 2 // skip total length

  // R value
  if (raw.slice(offset, offset + 2) !== '02') throw new Error('Invalid DER: expected 02 for R')
  offset += 2
  const rLen = parseInt(raw.slice(offset, offset + 2), 16)
  offset += 2
  let rHex = raw.slice(offset, offset + rLen * 2)
  offset += rLen * 2
  // Remove leading 00 padding
  if (rHex.length > 64 && rHex.startsWith('00')) {
    rHex = rHex.slice(rHex.length - 64)
  }
  rHex = rHex.padStart(64, '0')

  // S value
  if (raw.slice(offset, offset + 2) !== '02') throw new Error('Invalid DER: expected 02 for S')
  offset += 2
  const sLen = parseInt(raw.slice(offset, offset + 2), 16)
  offset += 2
  let sHex = raw.slice(offset, offset + sLen * 2)
  // Remove leading 00 padding
  if (sHex.length > 64 && sHex.startsWith('00')) {
    sHex = sHex.slice(sHex.length - 64)
  }
  sHex = sHex.padStart(64, '0')

  return { r: rHex, s: sHex }
}
