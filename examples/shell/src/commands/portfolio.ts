import { FiatCurrency, fiatCurrencyNameRecord } from '@vultisig/sdk'
import chalk from 'chalk'

import type { PortfolioSummary } from '../utils/types'

/**
 * Display portfolio summary
 */
export function displayPortfolio(portfolio: PortfolioSummary, currency: FiatCurrency = 'usd'): void {
  const currencyName = fiatCurrencyNameRecord[currency]

  // Display total value
  console.log(chalk.cyan('\n╔════════════════════════════════════════╗'))
  console.log(chalk.cyan(`║       Portfolio Total Value (${currencyName})       ║`))
  console.log(chalk.cyan('╠════════════════════════════════════════╣'))
  const totalDisplay = portfolio.totalValue.amount.padEnd(20) + portfolio.totalValue.currency.toUpperCase().padStart(16)
  console.log(chalk.cyan('║  ') + chalk.bold.green(totalDisplay) + chalk.cyan('  ║'))
  console.log(chalk.cyan('╚════════════════════════════════════════╝\n'))

  // Display breakdown by chain
  console.log(chalk.bold('Chain Breakdown:\n'))

  const table = portfolio.chainBalances.map(({ chain, balance, value }) => ({
    Chain: chain,
    Amount: balance.amount,
    Symbol: balance.symbol,
    Value: value ? `${value.amount} ${value.currency.toUpperCase()}` : 'N/A',
  }))

  console.table(table)
}
