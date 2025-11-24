import chalk from 'chalk'

import type { TransactionResult } from '../utils/types'

/**
 * Display transaction result
 */
export function displayTransactionResult(result: TransactionResult): void {
  console.log(chalk.green('\n✓ Transaction successful!'))
  console.log(chalk.blue(`\nTransaction Hash: ${result.txHash}`))
  console.log(chalk.cyan(`View on explorer: ${result.explorerUrl}`))
}
