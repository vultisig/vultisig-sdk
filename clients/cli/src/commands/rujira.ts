/**
 * Rujira Commands - FIN swap, secured assets, deposit/withdraw helpers
 */

import { getRoutesSummary, listEasyRoutes,RujiraClient, VultisigRujiraProvider } from '@vultisig/rujira'

import type { CommandContext } from '../core'
import { ensureVaultUnlocked } from '../core'
import { createSpinner, info, isJsonOutput, outputJson, printResult, printTable, warn } from '../lib/output'

export type RujiraBaseOptions = {
  rpcEndpoint?: string
  restEndpoint?: string
  password?: string
}

async function createRujiraClient(ctx: CommandContext, options: RujiraBaseOptions = {}): Promise<RujiraClient> {
  const vault = await ctx.ensureActiveVault()

  const provider = new VultisigRujiraProvider(vault)

  const client = new RujiraClient({
    signer: provider,
    rpcEndpoint: options.rpcEndpoint,
    config: {
      // Allow overriding rest endpoint via config (used for thornode calls)
      ...(options.restEndpoint ? { restEndpoint: options.restEndpoint } : {}),
    },
  })

  const spinner = createSpinner('Connecting to Rujira/THORChain...')
  await client.connect()
  spinner.succeed('Connected')

  return client
}

// ============================================================================
// rujira balance
// ============================================================================

export type RujiraBalanceOptions = RujiraBaseOptions & {
  securedOnly?: boolean
}

export async function executeRujiraBalance(ctx: CommandContext, options: RujiraBalanceOptions = {}): Promise<void> {
  const vault = await ctx.ensureActiveVault()
  const thorAddress = await vault.address('THORChain')

  const client = await createRujiraClient(ctx, options)

  const spinner = createSpinner('Loading THORChain balances...')
  const balances = await client.deposit.getBalances(thorAddress)
  spinner.succeed('Balances loaded')

  const filtered = options.securedOnly
    ? balances.filter(b => b.denom.includes('-') || b.denom.includes('/'))
    : balances

  if (isJsonOutput()) {
    outputJson({ thorAddress, balances: filtered })
    return
  }

  info(`THORChain address: ${thorAddress}`)

  if (!filtered.length) {
    printResult('No balances found')
    return
  }

  printTable(
    filtered.map(b => ({
      asset: b.asset,
      denom: b.denom,
      amount: b.formatted,
      raw: b.amount,
    }))
  )
}

// ============================================================================
// rujira routes
// ============================================================================

export async function executeRujiraRoutes(): Promise<void> {
  const routes = listEasyRoutes()
  const summary = getRoutesSummary()

  if (isJsonOutput()) {
    outputJson({ routes, summary })
    return
  }

  printResult(summary)
  printResult('')

  printTable(
    routes.map(r => ({
      name: r.name,
      from: r.from,
      to: r.to,
      liquidity: r.liquidity,
      description: r.description,
    }))
  )
}

// ============================================================================
// rujira deposit
// ============================================================================

export type RujiraDepositOptions = RujiraBaseOptions & {
  asset?: string
  affiliate?: string
  affiliateBps?: number
  amount?: string
}

export async function executeRujiraDeposit(ctx: CommandContext, options: RujiraDepositOptions = {}): Promise<void> {
  const vault = await ctx.ensureActiveVault()
  const thorAddress = await vault.address('THORChain')

  const client = await createRujiraClient(ctx, options)

  // If no asset provided, show inbound addresses list and example memo template
  if (!options.asset) {
    const spinner = createSpinner('Loading THORChain inbound addresses...')
    const inbound = await client.deposit.getInboundAddresses()
    spinner.succeed('Inbound addresses loaded')

    if (isJsonOutput()) {
      outputJson({ thorAddress, inboundAddresses: inbound })
      return
    }

    info(`THORChain address: ${thorAddress}`)
    printResult('Provide an L1 asset to get a chain-specific inbound address + memo.')
    printResult('Example: vultisig rujira deposit --asset BTC.BTC --amount 100000')
    printResult('')

    printTable(
      inbound.map(a => ({
        chain: a.chain,
        address: a.address,
        halted: a.halted,
        globalTradingPaused: a.global_trading_paused,
        chainTradingPaused: a.chain_trading_paused,
      }))
    )

    return
  }

  // Amount is optional for memo/inbound, but prepare() needs it
  const amount = options.amount ?? '1'

  const spinner = createSpinner('Preparing deposit instructions...')
  const prepared = await client.deposit.prepare({
    fromAsset: options.asset,
    amount,
    thorAddress,
    affiliate: options.affiliate,
    affiliateBps: options.affiliateBps,
  })
  spinner.succeed('Deposit prepared')

  if (isJsonOutput()) {
    outputJson({ thorAddress, deposit: prepared })
    return
  }

  info(`THORChain address: ${thorAddress}`)
  printResult('Deposit instructions (send from L1):')
  printResult(`  Chain:          ${prepared.chain}`)
  printResult(`  Asset:          ${prepared.asset}`)
  printResult(`  Inbound address:${prepared.inboundAddress}`)
  printResult(`  Memo:           ${prepared.memo}`)
  printResult(`  Min amount:     ${prepared.minimumAmount}`)

  if (prepared.warning) {
    warn(prepared.warning)
  }
}

// ============================================================================
// rujira swap
// ============================================================================

export type RujiraSwapOptions = RujiraBaseOptions & {
  fromAsset: string
  toAsset: string
  amount: string
  slippageBps?: number
  yes?: boolean
  destination?: string
}

export async function executeRujiraSwap(ctx: CommandContext, options: RujiraSwapOptions): Promise<void> {
  const vault = await ctx.ensureActiveVault()

  // Pre-unlock vault before signing
  await ensureVaultUnlocked(vault, options.password)

  const client = await createRujiraClient(ctx, options)

  const destination = options.destination ?? (await vault.address('THORChain'))

  const quoteSpinner = createSpinner('Getting FIN swap quote...')
  const quote = await client.swap.getQuote({
    fromAsset: options.fromAsset,
    toAsset: options.toAsset,
    amount: options.amount,
    destination,
    slippageBps: options.slippageBps,
  })
  quoteSpinner.succeed('Quote received')

  if (isJsonOutput()) {
    const result = await client.swap.execute(quote, { slippageBps: options.slippageBps })
    outputJson({ quote, result })
    return
  }

  printResult('FIN Swap Preview')
  printResult(`  From:        ${options.fromAsset}`)
  printResult(`  To:          ${options.toAsset}`)
  printResult(`  Amount (in): ${options.amount}`)
  printResult(`  Expected out:${quote.expectedOutput}`)
  printResult(`  Min out:     ${quote.minimumOutput}`)
  printResult(`  Contract:    ${quote.contractAddress}`)

  if (quote.warning) {
    warn(quote.warning)
  }

  if (!options.yes) {
    warn('This command will execute a swap. Re-run with -y/--yes to skip this warning.')
    throw new Error('Confirmation required (use --yes)')
  }

  const execSpinner = createSpinner('Executing FIN swap...')
  const result = await client.swap.execute(quote, { slippageBps: options.slippageBps })
  execSpinner.succeed('Swap submitted')

  printResult(`Tx Hash: ${result.txHash}`)
}

// ============================================================================
// rujira withdraw
// ============================================================================

export type RujiraWithdrawOptions = RujiraBaseOptions & {
  asset: string
  amount: string
  l1Address: string
  yes?: boolean
  maxFeeBps?: number
}

export async function executeRujiraWithdraw(ctx: CommandContext, options: RujiraWithdrawOptions): Promise<void> {
  const vault = await ctx.ensureActiveVault()

  // Pre-unlock vault before signing
  await ensureVaultUnlocked(vault, options.password)

  const client = await createRujiraClient(ctx, options)

  const prepSpinner = createSpinner('Preparing withdrawal (MsgDeposit)...')
  const prepared = await client.withdraw.prepare({
    asset: options.asset,
    amount: options.amount,
    l1Address: options.l1Address,
    maxFeeBps: options.maxFeeBps,
  })
  prepSpinner.succeed('Withdrawal prepared')

  if (isJsonOutput()) {
    const result = await client.withdraw.execute(prepared)
    outputJson({ prepared, result })
    return
  }

  printResult('Withdraw Preview')
  printResult(`  Asset:       ${prepared.asset}`)
  printResult(`  Amount:      ${prepared.amount}`)
  printResult(`  Destination: ${prepared.destination}`)
  printResult(`  Memo:        ${prepared.memo}`)
  printResult(`  Est. fee:    ${prepared.estimatedFee}`)

  if (!options.yes) {
    warn('This command will broadcast a THORChain MsgDeposit withdrawal. Re-run with -y/--yes to proceed.')
    throw new Error('Confirmation required (use --yes)')
  }

  const execSpinner = createSpinner('Broadcasting withdrawal...')
  const result = await client.withdraw.execute(prepared)
  execSpinner.succeed('Withdrawal submitted')

  printResult(`Tx Hash: ${result.txHash}`)
}
