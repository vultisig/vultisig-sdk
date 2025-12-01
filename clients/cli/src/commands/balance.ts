/**
 * Balance Commands - balance and portfolio
 */
import type { Chain, FiatCurrency } from '@vultisig/sdk/node'
import { fiatCurrencies, fiatCurrencyNameRecord } from '@vultisig/sdk/node'

import type { CommandContext, PortfolioSummary } from '../core'
import { createSpinner, error, warn } from '../lib/output'
import { displayBalance, displayBalancesTable, displayPortfolio } from '../ui'

export type BalanceOptions = {
  chain?: Chain
  includeTokens?: boolean
}

/**
 * Execute balance command - show balance for one chain or all chains
 */
export async function executeBalance(ctx: CommandContext, options: BalanceOptions = {}): Promise<void> {
  const vault = await ctx.ensureActiveVault()

  const spinner = createSpinner('Loading balances...')

  if (options.chain) {
    const balance = await vault.balance(options.chain)
    spinner.succeed('Balance loaded')
    displayBalance(options.chain, balance)
  } else {
    const balances = await vault.balances(undefined, options.includeTokens)
    spinner.succeed('Balances loaded')
    displayBalancesTable(balances)
  }
}

export type PortfolioOptions = {
  currency?: FiatCurrency
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

  const totalValue = await vault.getTotalValue(currency)
  const chains = vault.chains

  const chainBalances = await Promise.all(
    chains.map(async chain => {
      const balance = await vault.balance(chain)
      try {
        const value = await vault.getValue(chain, undefined, currency)
        return { chain, balance, value }
      } catch {
        return { chain, balance }
      }
    })
  )

  const portfolio: PortfolioSummary = { totalValue, chainBalances }

  spinner.succeed('Portfolio loaded')
  displayPortfolio(portfolio, currency)
}
