/**
 * Balance Commands - balance and portfolio
 */
import type { Balance, Chain, FiatCurrency, Value } from '@vultisig/sdk'
import { fiatCurrencies, fiatCurrencyNameRecord } from '@vultisig/sdk'

import type { ChainFailure, CommandContext, PortfolioSummary } from '../core'
import { NetworkError } from '../core/errors'
import { createSpinner, error, isJsonOutput, outputJson, warn } from '../lib/output'
import { displayBalance, displayBalancesTable, displayPortfolio } from '../ui'

/**
 * Reduce an unknown thrown value to a concise, single-line message that is safe
 * to surface to machine consumers: never a stack trace, never a filesystem path.
 */
function conciseError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return message.split('\n')[0].trim() || 'Unknown error'
}

export type BalanceOptions = {
  chain?: Chain
  includeTokens?: boolean
  raw?: boolean
}

/**
 * Execute balance command - show balance for one chain or all chains
 */
export async function executeBalance(ctx: CommandContext, options: BalanceOptions = {}): Promise<void> {
  const vault = await ctx.ensureActiveVault()

  const spinner = createSpinner('Loading balances...')
  const raw = options.raw ?? false

  if (options.chain) {
    // `--tokens` used to be accepted and then dropped on this branch: the flag
    // is documented for `balance <chain>`, but only the all-chains branch below
    // ever passed it on, so `balance Ethereum --tokens` silently returned the
    // native balance alone. Same call, same result shape as all-chains, scoped
    // to one chain.
    if (options.includeTokens) {
      const balances = await vault.balances([options.chain], true)
      spinner.succeed('Balances loaded')

      if (isJsonOutput()) {
        outputJson({ chain: options.chain, balances })
        return
      }
      displayBalancesTable(balances, raw)
      return
    }

    const balance = await vault.balance(options.chain)
    spinner.succeed('Balance loaded')

    if (isJsonOutput()) {
      outputJson({ chain: options.chain, balance })
      return
    }
    displayBalance(options.chain, balance, raw)
  } else {
    const balances = await vault.balances(undefined, options.includeTokens)
    spinner.succeed('Balances loaded')

    if (isJsonOutput()) {
      outputJson({ balances })
      return
    }
    displayBalancesTable(balances, raw)
  }
}

export type PortfolioOptions = {
  currency?: FiatCurrency
  raw?: boolean
}

/**
 * Execute portfolio command - show total portfolio value with breakdown
 */
export async function executePortfolio(ctx: CommandContext, options: PortfolioOptions = {}): Promise<void> {
  const vault = await ctx.ensureActiveVault()

  const currency = options.currency || 'usd'

  if (!fiatCurrencies.includes(currency)) {
    error(`x Invalid currency: ${currency}`)
    warn(`Supported currencies: ${fiatCurrencies.join(', ')}`)
    throw new Error('Invalid currency')
  }

  if (vault.currency !== currency) {
    await vault.setCurrency(currency)
  }

  const currencyName = fiatCurrencyNameRecord[currency]
  const spinner = createSpinner(`Loading portfolio in ${currencyName}...`)

  const chains = vault.chains

  // Fetch each chain independently and honestly: a chain that throws is recorded
  // in `failures` instead of rejecting the whole command or silently losing data.
  // `chains` order is preserved across both the kept entries and the failures.
  //   - balance() fails → no entry, failure { stage: 'balance' }
  //   - value lookup fails → entry kept without value, failure { stage: 'value' }
  //
  // Values come from getValues(), which prices the native asset AND every token
  // the vault tracks on the chain. The total below is the sum of exactly these
  // rows. It used to come from a separate vault.getTotalValue() call that
  // included token value while the breakdown listed native value only, so the
  // headline figure contradicted the rows printed under it (and the gap grew
  // silently as `tokens --discover` added tokens).
  type ChainResult = {
    entry?: PortfolioSummary['chainBalances'][number]
    failure?: ChainFailure
  }

  const results = await Promise.all(
    chains.map(async (chain): Promise<ChainResult> => {
      let balance: Balance
      try {
        balance = await vault.balance(chain)
      } catch (err) {
        return { failure: { chain, stage: 'balance', error: conciseError(err) } }
      }

      let values: Record<string, Value>
      try {
        values = await vault.getValues(chain, currency)
      } catch (err) {
        // Balance succeeded but the fiat value did not — keep the balance and
        // flag the missing value rather than swallowing it as "no value".
        return { entry: { chain, balance }, failure: { chain, stage: 'value', error: conciseError(err) } }
      }

      const { native, ...tokenValues } = values
      if (!native) {
        // getValues() logs and drops a per-asset failure rather than throwing.
        // Ask again for just the native value so the failure we report carries
        // the real error instead of a generic "unavailable".
        try {
          const retried = await vault.getValue(chain, undefined, currency)
          return { entry: { chain, balance, value: retried, tokens: await withAmounts(tokenValues) } }
        } catch (err) {
          return {
            entry: { chain, balance, tokens: await withAmounts(tokenValues) },
            failure: { chain, stage: 'value', error: conciseError(err) },
          }
        }
      }

      return { entry: { chain, balance, value: native, tokens: await withAmounts(tokenValues) } }

      // Pair each priced token with its held amount. getValues() has already
      // fetched (and cached) these balances, so this does not re-hit the RPC;
      // a token whose balance is somehow unavailable still shows its value.
      async function withAmounts(byTokenId: Record<string, Value>) {
        return Promise.all(
          Object.entries(byTokenId).map(async ([tokenId, value]) => ({
            tokenId,
            value,
            balance: await vault.balance(chain, tokenId).catch(() => undefined),
          }))
        )
      }
    })
  )

  const chainBalances: PortfolioSummary['chainBalances'] = []
  const failures: ChainFailure[] = []
  for (const result of results) {
    if (result.entry) chainBalances.push(result.entry)
    if (result.failure) failures.push(result.failure)
  }

  // Every chain failed to even fetch a balance → this is a real error, not a
  // partial success. Surface it as a retryable network error (non-zero exit).
  if (failures.length > 0 && chainBalances.length === 0) {
    spinner.fail('Portfolio failed to load')
    throw new NetworkError(
      `Failed to load balances for all ${failures.length} chain(s): ${failures
        .map(f => `${f.chain} (${f.error})`)
        .join('; ')}`,
      'All chain balance fetches failed — likely a network/RPC issue',
      ['Check your internet connection', 'Retry in a few moments']
    )
  }

  // The total is the sum of the rows above — nothing else — so a reader can add
  // up the breakdown and land on it.
  const total = chainBalances.reduce(
    (sum, entry) =>
      sum +
      parseFloat(entry.value?.amount ?? '0') +
      (entry.tokens ?? []).reduce((tokenSum, token) => tokenSum + parseFloat(token.value.amount), 0),
    0
  )
  const totalValue: Value = { amount: total.toFixed(2), currency, lastUpdated: Date.now() }

  const portfolio: PortfolioSummary = { totalValue, chainBalances }

  spinner.succeed('Portfolio loaded')

  if (isJsonOutput()) {
    // `failures` is always present (empty array when none) so machine consumers
    // can branch on `data.failures.length` without probing for the field.
    outputJson({ portfolio, currency, failures })
    return
  }
  displayPortfolio(portfolio, currency, options.raw ?? false)
  if (failures.length > 0) {
    warn(`\nWarning: ${failures.length} chain(s) failed to load fully:`)
    for (const f of failures) {
      warn(`  - ${f.chain} (${f.stage}): ${f.error}`)
    }
  }
}
