import { Balance } from '@vultisig/sdk/node'
import chalk from 'chalk'

/**
 * Display balance results
 */
export function displayBalances(result: Balance | Record<string, Balance>, chainStr?: string): void {
  if (chainStr) {
    // Single chain
    const balance = result as Balance
    console.log(chalk.cyan(`\n${chainStr} Balance:`))
    console.log(`  Amount: ${balance.amount} ${balance.symbol}`)
    if (balance.fiatValue && balance.fiatCurrency) {
      console.log(`  Value:  ${balance.fiatValue.toFixed(2)} ${balance.fiatCurrency}`)
    }
  } else {
    // All chains
    console.log(chalk.cyan('\nPortfolio Balances:\n'))
    const balances = result as Record<string, Balance>
    const tableData = Object.entries(balances).map(([chain, balance]) => ({
      Chain: chain,
      Amount: balance.amount,
      Symbol: balance.symbol,
      Value:
        balance.fiatValue && balance.fiatCurrency ? `${balance.fiatValue.toFixed(2)} ${balance.fiatCurrency}` : 'N/A',
    }))
    console.table(tableData)
  }
}
