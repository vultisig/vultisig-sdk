/**
 * Agent Action Executor
 *
 * Executes actions returned by the agent-backend locally.
 * Handles balance queries, transaction building, signing, and broadcasting.
 */
import type { EvmChain, FiatCurrency, VaultBase, Vultisig } from '@vultisig/sdk'
import { Chain, evmCall, fiatCurrencies, Vultisig as VultisigSdk } from '@vultisig/sdk'
import { formatUnits } from 'viem'

import { VaultStateStore } from '../core/VaultStateStore'
import type { Action, ActionResult } from './types'
import { AUTO_EXECUTE_ACTIONS, PASSWORD_REQUIRED_ACTIONS } from './types'

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
  private password: string | null = null
  private verbose: boolean
  private stateStore: VaultStateStore | null = null
  /** Held chain lock release functions, keyed by chain name */
  private chainLockReleases = new Map<string, () => Promise<void>>()
  private evmLastBroadcast = new Map<string, number>()
  /** Backend client for resolving calldata_id references. */
  private backendClient: {
    getCalldata(id: string): Promise<{ data: string; to?: string; chain?: string }>
  } | null = null

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

  setBackendClient(client: { getCalldata(id: string): Promise<{ data: string; to?: string; chain?: string }> }): void {
    this.backendClient = client
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
    const nestedTx = txReadyData?.swap_tx || txReadyData?.send_tx || txReadyData?.tx
    if (nestedTx?.status === 'error' || nestedTx?.error) {
      if (this.verbose)
        process.stderr.write(`[executor] skipping error tx_ready: ${nestedTx.error || 'unknown error'}\n`)
      return false
    }
    if (!nestedTx) {
      if (this.verbose) process.stderr.write(`[executor] storeServerTransaction: no swap_tx/send_tx/tx found in data\n`)
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

  shouldAutoExecute(action: Action): boolean {
    return action.auto_execute === true || AUTO_EXECUTE_ACTIONS.has(action.type)
  }

  requiresPassword(action: Action): boolean {
    return PASSWORD_REQUIRED_ACTIONS.has(action.type)
  }

  /**
   * Execute a single action and return the result.
   */
  async executeAction(action: Action): Promise<ActionResult> {
    try {
      const data = await this.dispatch(action)
      return {
        action: action.type,
        action_id: action.id,
        success: true,
        data,
      }
    } catch (err: any) {
      return {
        action: action.type,
        action_id: action.id,
        success: false,
        error: err.message || String(err),
      }
    }
  }

  private async dispatch(action: Action): Promise<Record<string, unknown>> {
    if (this.verbose) process.stderr.write(`[dispatch] action.type=${action.type} action.id=${action.id}\n`)
    const params = action.params || {}

    switch (action.type) {
      case 'get_balances':
        return this.getBalances(params)
      case 'get_portfolio':
        return this.getPortfolio(params)
      case 'add_chain':
        return this.addChain(params)
      case 'remove_chain':
        return this.removeChain(params)
      case 'add_coin':
        return this.addCoin(params)
      case 'remove_coin':
        return this.removeCoin(params)
      case 'build_send_tx':
        return this.buildSendTx(params)
      case 'build_swap_tx':
        return this.buildSwapTx(params)
      case 'build_tx':
      case 'build_custom_tx':
        return this.buildTx(params)
      case 'sign_tx':
        return this.signTx(params)
      case 'get_address_book':
        return this.getAddressBook(params)
      case 'address_book_add':
        return this.addAddressBookEntry(params)
      case 'address_book_remove':
        return this.removeAddressBookEntry(params)
      case 'search_token':
        return this.searchToken(params)
      case 'list_vaults':
        return this.listVaults()
      case 'sign_typed_data':
        return this.signTypedData(params)
      case 'scan_tx':
        return this.scanTx(params)
      case 'read_evm_contract':
        return this.readEvmContract(params)
      default:
        throw new Error(
          `Action type '${action.type}' is not implemented locally. The backend may handle this action server-side.`
        )
    }
  }

  // ============================================================================
  // Balance & Portfolio
  // ============================================================================

  private async getBalances(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const chainFilter = params.chain as string | undefined
    const tickerFilter = params.ticker as string | undefined

    const balanceRecord = await this.vault.balances()
    let entries = Object.entries(balanceRecord).map(([key, b]: [string, any]) => ({
      chain: b.chainId || key.split(':')[0] || '',
      symbol: b.symbol || '',
      amount: b.formattedAmount || b.amount?.toString() || '0',
      decimals: b.decimals || 18,
      raw_amount: b.amount?.toString(),
    }))

    if (chainFilter) {
      const chain = resolveChain(chainFilter)
      if (chain) {
        entries = entries.filter(b => b.chain.toLowerCase() === chain.toLowerCase())
      }
    }

    if (tickerFilter) {
      entries = entries.filter(b => b.symbol.toLowerCase() === tickerFilter.toLowerCase())
    }

    return { balances: entries }
  }

  private async getPortfolio(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const currencyRaw = String(params.currency ?? 'USD')
      .trim()
      .toLowerCase()
    const fiatCurrency: FiatCurrency = (fiatCurrencies as readonly string[]).includes(currencyRaw)
      ? (currencyRaw as FiatCurrency)
      : 'usd'

    const portfolio = await this.vault.portfolio(fiatCurrency)

    const chainFilter = params.chain as string | undefined
    const tickerFilter = params.ticker as string | undefined

    let rows = portfolio.balances.map(b => ({
      chain: b.chainId || '',
      symbol: b.symbol || '',
      amount: b.formattedAmount || b.amount?.toString() || '0',
      decimals: b.decimals ?? 18,
      raw_amount: b.amount,
      fiatValue: b.fiatValue,
      fiatCurrency: b.fiatCurrency ?? portfolio.currency,
    }))

    if (chainFilter) {
      const chain = resolveChain(chainFilter)
      if (!chain) throw new Error(`Unknown chain: ${chainFilter}`)
      rows = rows.filter(r => r.chain.toLowerCase() === chain.toLowerCase())
    }

    if (tickerFilter) {
      rows = rows.filter(r => r.symbol.toLowerCase() === String(tickerFilter).toLowerCase())
    }

    return {
      balances: rows,
      totalValue: portfolio.totalValue,
      currency: portfolio.currency,
    }
  }

  // ============================================================================
  // Chain & Token Management
  // ============================================================================

  private async addChain(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    // Backend may send a single chain or a batch via `chains` array
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

    // Single chain format
    const chainName = params.chain as string
    const chain = resolveChain(chainName)
    if (!chain) throw new Error(`Unknown chain: ${chainName}`)
    await this.vault.addChain(chain)
    const address = await this.vault.address(chain)
    return { chain: chain.toString(), address, added: true }
  }

  private async removeChain(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const chainName = params.chain as string
    const chain = resolveChain(chainName)
    if (!chain) throw new Error(`Unknown chain: ${chainName}`)
    await this.vault.removeChain(chain)
    return { chain: chain.toString(), removed: true }
  }

  private async addCoin(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    // Backend may send a single token or a batch via `tokens` array
    const tokens = params.tokens as any[] | undefined
    if (tokens && Array.isArray(tokens)) {
      const results: { chain: string; symbol: string }[] = []
      for (const t of tokens) {
        const chain = resolveChain(t.chain)
        if (!chain) throw new Error(`Unknown chain: ${t.chain}`)
        const symbol = t.symbol || t.ticker || ''
        await this.vault.addToken(chain, {
          id: (t.contract_address || t.contractAddress || '') as string,
          symbol,
          name: (t.name || symbol) as string,
          decimals: t.decimals || 18,
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

    const symbol = (params.symbol || params.ticker) as string
    await this.vault.addToken(chain, {
      id: (params.contract_address || params.contractAddress || '') as string,
      symbol,
      name: (params.name || symbol) as string,
      decimals: (params.decimals as number) || 18,
      contractAddress: (params.contract_address || params.contractAddress) as string,
      chainId: chain.toString(),
    } as any)
    return { chain: chain.toString(), symbol, added: true }
  }

  private async removeCoin(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const chainName = params.chain as string
    const chain = resolveChain(chainName)
    if (!chain) throw new Error(`Unknown chain: ${chainName}`)

    const tokenId = (params.token_id || params.id || params.contract_address) as string
    await this.vault.removeToken(chain, tokenId)
    return { chain: chain.toString(), removed: true }
  }

  // ============================================================================
  // Transaction Building
  // ============================================================================

  private async buildSendTx(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const chainName = (params.chain || params.from_chain) as string
    const chain = resolveChain(chainName)
    if (!chain) throw new Error(`Unknown chain: ${chainName}`)

    const symbol = (params.symbol || params.ticker) as string
    const toAddress = (params.address || params.to || params.destination) as string
    const amountStr = params.amount as string

    if (!toAddress) throw new Error('Destination address is required')
    if (!amountStr) throw new Error('Amount is required')

    // Acquire chain lock for EVM nonce management (released in signTx)
    await this.acquireEvmLockIfNeeded(chain)

    try {
      const address = await this.vault.address(chain)
      const balance = await this.vault.balance(chain, params.token_id as string | undefined)

      const coin: AccountCoin = {
        chain,
        address,
        decimals: balance.decimals,
        ticker: symbol || balance.symbol,
        id: params.token_id as string | undefined,
      }

      // Parse amount
      const amount = parseAmount(amountStr, balance.decimals)

      const memo = params.memo as string | undefined
      const payload = await this.vault.prepareSendTx({
        coin,
        receiver: toAddress,
        amount,
        memo,
      })

      // Patch EVM nonce if local state is ahead of on-chain
      await this.patchEvmNonce(chain, payload)

      const messageHashes = await this.vault.extractMessageHashes(payload)

      // Store payload only after build fully succeeds (including hash extraction)
      this.pendingPayloads.clear()
      const payloadId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      this.pendingPayloads.set(payloadId, {
        payload,
        coin,
        chain,
        timestamp: Date.now(),
      })
      this.pendingPayloads.set('latest', {
        payload,
        coin,
        chain,
        timestamp: Date.now(),
      })

      return {
        keysign_payload: payloadId,
        from_chain: chain.toString(),
        from_symbol: coin.ticker,
        amount: amountStr,
        sender: address,
        destination: toAddress,
        memo: memo || undefined,
        message_hashes: messageHashes,
        tx_details: {
          chain: chain.toString(),
          from: address,
          to: toAddress,
          amount: amountStr,
          symbol: coin.ticker,
        },
      }
    } catch (err) {
      await this.releaseEvmLock(chain)
      throw err
    }
  }

  private async buildSwapTx(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (this.verbose)
      process.stderr.write(`[build_swap_tx] called with params: ${JSON.stringify(params).slice(0, 500)}\n`)
    const fromChainName = (params.from_chain || params.chain) as string
    const toChainName = params.to_chain as string
    const fromChain = resolveChain(fromChainName)
    const toChain = toChainName ? resolveChain(toChainName) : null
    if (!fromChain) throw new Error(`Unknown from_chain: ${fromChainName}`)

    // Acquire chain lock for EVM nonce management (released in signTx)
    await this.acquireEvmLockIfNeeded(fromChain)

    try {
      const amountStr = params.amount as string
      const fromSymbol = (params.from_symbol || params.from_token || '') as string
      const toSymbol = (params.to_symbol || params.to_token || '') as string
      const fromToken = (params.from_contract || params.from_token_id) as string | undefined
      const toToken = (params.to_contract || params.to_token_id) as string | undefined

      const fromCoin = { chain: fromChain, token: fromToken || undefined }
      const toCoin = {
        chain: toChain || fromChain,
        token: toToken || undefined,
      }

      // Get quote
      const quote = await this.vault.getSwapQuote({
        fromCoin: fromCoin as any,
        toCoin: toCoin as any,
        amount: amountStr,
      })

      // Prepare the actual swap transaction
      const swapResult = await this.vault.prepareSwapTx({
        fromCoin: fromCoin as any,
        toCoin: toCoin as any,
        amount: amountStr,
        swapQuote: quote,
        autoApprove: true,
      })

      const chain = fromChain
      const payload = swapResult.keysignPayload

      // Patch EVM nonce if local state is ahead of on-chain
      await this.patchEvmNonce(chain, payload)

      const messageHashes = await this.vault.extractMessageHashes(payload)

      // Store payload only after build fully succeeds (including hash extraction)
      this.pendingPayloads.clear()
      const payloadId = `swap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      this.pendingPayloads.set(payloadId, {
        payload,
        coin: { chain, address: '', decimals: 18, ticker: fromSymbol },
        chain,
        timestamp: Date.now(),
      })
      this.pendingPayloads.set('latest', {
        payload,
        coin: { chain, address: '', decimals: 18, ticker: fromSymbol },
        chain,
        timestamp: Date.now(),
      })

      return {
        keysign_payload: payloadId,
        from_chain: fromChain.toString(),
        to_chain: (toChain || fromChain).toString(),
        from_symbol: fromSymbol,
        to_symbol: toSymbol,
        amount: amountStr,
        estimated_output: (quote as any).estimatedOutput?.toString(),
        provider: (quote as any).provider,
        message_hashes: messageHashes,
      }
    } catch (err) {
      await this.releaseEvmLock(fromChain)
      throw err
    }
  }

  private async buildTx(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    // Resolve calldata_id → actual data before any other checks
    if (params.calldata_id && !params.data && this.backendClient) {
      const id = params.calldata_id as string
      if (this.verbose) process.stderr.write(`[executor] resolving calldata_id ${id}\n`)
      const entry = await this.backendClient.getCalldata(id)
      params = { ...params, data: entry.data }
      if (!params.to && entry.to) params = { ...params, to: entry.to }
      delete (params as Record<string, unknown>).calldata_id
      if (this.verbose) process.stderr.write(`[executor] calldata_id resolved, data len=${entry.data.length}\n`)
    }

    // EVM contract call with function_name + typed params (e.g. from build_custom_tx)
    if (params.function_name && params.contract_address) {
      return this.buildContractCallTx(params)
    }

    // If this has raw contract call data (hex payload from MCP), treat it as a server-built tx
    if (params.data || params.calldata || params.hex_payload) {
      const txData = {
        to: params.to || params.address || params.contract,
        value: params.value || '0',
        data: params.data || params.calldata || params.hex_payload,
        chain: params.chain,
        chain_id: params.chain_id,
      }

      // Store as a server-style tx for sign_tx to pick up
      const stored = this.storeServerTransaction({
        tx: txData,
        chain: params.chain,
        from_chain: params.chain,
      })
      if (!stored) {
        throw new Error('Could not stage calldata transaction for signing (invalid or empty tx payload)')
      }

      const chain = resolveChain(params.chain as string) || Chain.Ethereum
      const address = await this.vault.address(chain)

      return {
        status: 'ready',
        chain: chain.toString(),
        from: address,
        to: txData.to,
        value: txData.value,
        has_calldata: true,
        message: 'Transaction built. Ready to sign.',
      }
    }

    // If we got here with contract_address but no function_name or data,
    // the params are incomplete for a contract call.
    if (params.contract_address && !params.function_name) {
      const provided = Object.keys(params).join(', ')
      throw new Error(
        `build_custom_tx requires function_name and params for contract calls. ` +
          `Got: ${provided}. Missing: function_name, params.`
      )
    }

    // Fallback to simple send for native transfers
    return this.buildSendTx(params)
  }

  /**
   * Build, sign, and broadcast an EVM contract call transaction from structured params.
   * Encodes function_name + typed params into ABI calldata, then signs via signServerTx.
   */
  private async buildContractCallTx(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const chainName = (params.chain || 'Ethereum') as string
    const chain = resolveChain(chainName)
    if (!chain) throw new Error(`Unknown chain: ${chainName}`)

    const contractAddress = params.contract_address as string
    const functionName = params.function_name as string
    const typedParams = params.params as Array<{ type: string; value: string }> | undefined
    const value = (params.value || '0') as string

    // ABI-encode the function call
    const calldata = await encodeContractCall(functionName, typedParams || [])

    if (this.verbose)
      process.stderr.write(
        `[build_contract_tx] ${functionName}(${(typedParams || []).map(p => p.type).join(',')}) on ${contractAddress} chain=${chain}\n`
      )

    // Store as server-style tx and sign via the proven signServerTx path
    const serverTxData = {
      __serverTx: true,
      tx: {
        to: contractAddress,
        value,
        data: calldata,
      },
      chain: chainName,
      from_chain: chainName,
    }

    this.pendingPayloads.set('latest', {
      payload: serverTxData,
      coin: { chain, address: '', decimals: 18, ticker: '' },
      chain,
      timestamp: Date.now(),
    })

    // Sign and broadcast
    return this.signServerTx(serverTxData, chain, { chain: chainName })
  }

  // ============================================================================
  // Transaction Signing
  // ============================================================================

  private async signTx(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (this.verbose) process.stderr.write(`[sign_tx] params: ${JSON.stringify(params).slice(0, 500)}\n`)
    if (this.verbose)
      process.stderr.write(`[sign_tx] pendingPayloads keys: ${[...this.pendingPayloads.keys()].join(', ')}\n`)

    // Find the pending payload
    const payloadId = (params.keysign_payload || params.payload_id || 'latest') as string
    const stored = this.pendingPayloads.get(payloadId)

    if (!stored) {
      throw new Error('No pending transaction to sign. Build a transaction first.')
    }

    const { payload, chain } = stored

    // Server-built transaction (from tx_ready SSE event)
    if (payload.__serverTx) {
      // Solana swaps: prefer local SDK build (vault.getSwapQuote → prepareSwapTx)
      // since the server-built tx format doesn't match signServerTx's EVM assumptions.
      // Only the quote/prepare phase falls back to signServerTx — once signing starts,
      // failures must propagate to avoid double-submitting a broadcast transaction.
      let result: Record<string, unknown> | undefined
      if (chain === ('Solana' as Chain) && (payload.swap_tx || payload.provider)) {
        try {
          result = await this.buildAndSignSolanaSwapLocally(payload)
        } catch (e: any) {
          // Only fall back if the error is from the quote/prepare phase (before signing).
          // Sign/broadcast errors must propagate — retrying could double-submit on-chain.
          if (e._phase === 'prepare') {
            if (this.verbose)
              process.stderr.write(`[sign_tx] Solana local build failed (${e.message}), falling back to signServerTx\n`)
          } else {
            throw e
          }
        }
      }
      if (!result) result = await this.signServerTx(payload, chain, params)
      if (payload.sequence_id) result.sequence_id = payload.sequence_id
      return result
    }

    // SDK-built transaction (from local buildSwapTx/buildSendTx)
    return this.signSdkTx(payload, chain, payloadId)
  }

  /**
   * Sign and broadcast an SDK-built transaction (keysign payload from local build methods).
   */
  private async signSdkTx(payload: any, chain: Chain, _payloadId: string): Promise<Record<string, unknown>> {
    try {
      // Unlock vault if needed
      if (this.vault.isEncrypted && !(this.vault as any).isUnlocked?.()) {
        if (this.password) {
          await (this.vault as any).unlock?.(this.password)
        }
      }

      // Refresh gas estimate before signing — base fee may have risen since build time
      await this.patchEvmGas(chain, payload)

      // Extract message hashes and sign
      const messageHashes = await this.vault.extractMessageHashes(payload)

      const signature = await this.vault.sign(
        {
          transaction: payload,
          chain: (payload as any).coin?.chain || chain,
          messageHashes,
        },
        {}
      )

      // Broadcast
      const txHash = await this.vault.broadcastTx({
        chain,
        keysignPayload: payload,
        signature,
      })

      // Record nonce and broadcast timestamp — tx is already broadcast so
      // don't convert a successful send into an error if persistence fails
      this.evmLastBroadcast.set(chain.toString(), Date.now())
      try {
        this.recordEvmNonceFromPayload(chain, payload, messageHashes.length)
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
   * Sign and broadcast a server-built transaction (raw EVM tx from tx_ready SSE).
   * Uses vault.prepareSendTx with memo field to carry the calldata.
   */
  private async signServerTx(
    serverTxData: any,
    defaultChain: Chain,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const swapTx = serverTxData.swap_tx || serverTxData.send_tx || serverTxData.tx
    if (!swapTx?.to) {
      throw new Error('Server transaction missing required fields (to)')
    }

    // Resolve chain from action params, tx data, or stored default
    const chainName = (params.chain || serverTxData.chain || serverTxData.from_chain) as string | undefined
    const chainId = (serverTxData.chain_id || swapTx.chainId) as string | number | undefined
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
      const lastBroadcast = this.evmLastBroadcast.get(chain.toString()) ?? 0
      if (Date.now() - lastBroadcast < 15_000) {
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
  private async signTypedData(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    // Unlock vault once before signing
    if (this.vault.isEncrypted && !(this.vault as any).isUnlocked?.()) {
      if (this.password) {
        await (this.vault as any).unlock?.(this.password)
      }
    }

    // Handle payloads array format (e.g. Polymarket: order + auth)
    const payloads = params.payloads as Array<Record<string, unknown>> | undefined
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
        pm_order_ref: params.pm_order_ref,
        auto_submit: !!(params.__pm_auto_submit || params.auto_submit),
      }
    }

    // Flat format: domain, types, message, primaryType at top level
    return this.signSingleTypedData(params)
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
  // ============================================================================

  private async getAddressBook(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.vultisig) {
      throw new Error(
        'get_address_book requires the CLI SDK instance. Ensure AgentConfig.vultisig is set when creating the session.'
      )
    }

    const chainName = (params.chain as string | undefined) || (params.chain_name as string | undefined)
    const chain = chainName ? resolveChain(chainName) : undefined
    if (chainName && !chain) {
      throw new Error(`Unknown chain: ${chainName}`)
    }

    return (await this.vultisig.getAddressBook(chain)) as unknown as Record<string, unknown>
  }

  private async addAddressBookEntry(_params: Record<string, unknown>): Promise<Record<string, unknown>> {
    throw new Error('address_book_add is not yet implemented locally. The backend may handle this action server-side.')
  }

  private async removeAddressBookEntry(_params: Record<string, unknown>): Promise<Record<string, unknown>> {
    throw new Error(
      'address_book_remove is not yet implemented locally. The backend may handle this action server-side.'
    )
  }

  // ============================================================================
  // Token Search & Other
  // ============================================================================

  private async searchToken(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const query = String(params.query ?? params.q ?? '')
      .trim()
      .toLowerCase()
    if (!query) {
      return { tokens: [] as unknown[] }
    }

    const limit = 20
    const chainName = params.chain as string | undefined

    const tokenMatchesQuery = (t: { ticker: string; contractAddress?: string; priceProviderId?: string }) => {
      const tick = t.ticker.toLowerCase()
      const addr = (t.contractAddress ?? '').toLowerCase()
      const pid = (t.priceProviderId ?? '').toLowerCase()
      return tick.includes(query) || addr.includes(query) || pid.includes(query)
    }

    if (chainName) {
      const chain = resolveChain(chainName)
      if (!chain) throw new Error(`Unknown chain: ${chainName}`)
      const tokens = VultisigSdk.getKnownTokens(chain).filter(tokenMatchesQuery).slice(0, limit)
      return { tokens }
    }

    const out: ReturnType<typeof VultisigSdk.getKnownTokens> = []
    for (const c of Object.values(Chain) as Chain[]) {
      for (const t of VultisigSdk.getKnownTokens(c)) {
        if (!tokenMatchesQuery(t)) continue
        out.push(t)
        if (out.length >= limit) return { tokens: out }
      }
    }
    return { tokens: out }
  }

  private async listVaults(): Promise<Record<string, unknown>> {
    return {
      vaults: [
        {
          name: this.vault.name,
          id: this.vault.id,
          type: this.vault.type,
          chains: this.vault.chains.map(c => c.toString()),
        },
      ],
    }
  }

  private async scanTx(_params: Record<string, unknown>): Promise<Record<string, unknown>> {
    throw new Error('scan_tx is not yet implemented locally. The backend may handle this action server-side.')
  }

  private async readEvmContract(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const chainName = params.chain as string | undefined
    if (!chainName) throw new Error('read_evm_contract requires chain')

    const contractRaw =
      (params.contract_address as string | undefined) || (params.contractAddress as string | undefined)
    if (!contractRaw) throw new Error('read_evm_contract requires contract_address')

    const functionName = (params.function_name as string | undefined) || (params.functionName as string | undefined)
    if (!functionName) throw new Error('read_evm_contract requires function_name')

    const chain = resolveChain(chainName)
    if (!chain) throw new Error(`Unknown chain: ${chainName}`)
    if (!EVM_CHAINS.has(chain)) {
      throw new Error(`read_evm_contract only supports EVM chains (got ${chain})`)
    }

    const callParams = (params.params as Array<{ type: string; value: string }> | undefined) ?? []
    const data = (await encodeContractCall(functionName, callParams)) as `0x${string}`

    const addr = contractRaw.startsWith('0x') ? contractRaw : `0x${contractRaw}`
    const to = addr as `0x${string}`

    const from = params.from as `0x${string}` | undefined
    const result = await evmCall(chain as EvmChain, { to, data, from })

    return { result }
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * ABI-encode a contract function call from structured params.
 * Produces 4-byte selector + encoded arguments.
 */
async function encodeContractCall(
  functionName: string,
  params: Array<{ type: string; value: string }>
): Promise<string> {
  // Build the function signature: e.g. "approve(address,uint256)"
  // Strip existing parens if the LLM passed a full signature like "approve(address,uint256)"
  // to avoid doubling: "approve(address,uint256)(address,uint256)"
  const baseName = functionName.includes('(') ? functionName.split('(')[0] : functionName
  const types = params.map(p => p.type)
  const sig = `${baseName}(${types.join(',')})`

  // Compute 4-byte selector via keccak256
  const selector = await keccak256Selector(sig)

  // ABI-encode each parameter (32-byte padded)
  let encoded = ''
  for (const param of params) {
    encoded += abiEncodeParam(param.type, param.value)
  }

  return '0x' + selector + encoded
}

/**
 * Compute the 4-byte function selector from a function signature.
 * Uses keccak256 (SHA3-256).
 */
async function keccak256Selector(sig: string): Promise<string> {
  const { keccak_256 } = await import('@noble/hashes/sha3')
  const hash = keccak_256(new TextEncoder().encode(sig))
  return Buffer.from(hash).toString('hex').slice(0, 8)
}

/**
 * ABI-encode a single parameter value to 32 bytes (hex, no 0x prefix).
 */
function abiEncodeParam(type: string, value: string): string {
  if (type === 'address') {
    // Remove 0x prefix, left-pad to 64 hex chars
    const addr = value.startsWith('0x') ? value.slice(2) : value
    return addr.toLowerCase().padStart(64, '0')
  }
  if (type.startsWith('uint') || type.startsWith('int')) {
    // Convert to bigint, then to hex, left-pad to 64 hex chars
    const n = BigInt(value)
    const hex = n.toString(16)
    return hex.padStart(64, '0')
  }
  if (type === 'bool') {
    return (value === 'true' || value === '1' ? '1' : '0').padStart(64, '0')
  }
  if (type === 'bytes32') {
    const b = value.startsWith('0x') ? value.slice(2) : value
    return b.padEnd(64, '0')
  }
  // For bytes and string, use dynamic encoding (offset + length + data)
  // For now, just left-pad simple values
  const b = value.startsWith('0x') ? value.slice(2) : Buffer.from(value).toString('hex')
  return b.padStart(64, '0')
}

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

function parseAmount(amountStr: string, decimals: number): bigint {
  const [whole, frac = ''] = amountStr.split('.')
  const paddedFrac = frac.slice(0, decimals).padEnd(decimals, '0')
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(paddedFrac || '0')
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
  const swapTx = txReadyData.swap_tx || txReadyData.send_tx || txReadyData.tx
  if (swapTx?.chainId) {
    const chain = resolveChainId(swapTx.chainId)
    if (chain) return chain
  }
  return null
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
