import chalk from 'chalk'

import { TransactionManager } from '../utils/transaction'
import type { SendParams, TransactionResult } from '../utils/types'

/**
 * Send transaction (complete flow: prepare → confirm → sign → broadcast)
 */
export async function handleSend(
  transactionManager: TransactionManager,
  params: SendParams
): Promise<TransactionResult> {
  return await transactionManager.send(params)
}

/**
 * Display transaction result
 */
export function displayTransactionResult(result: TransactionResult): void {
  console.log(chalk.green('\n✓ Transaction successful!'))
  console.log(chalk.blue(`\nTransaction Hash: ${result.txHash}`))
  console.log(chalk.cyan(`View on explorer: ${result.explorerUrl}`))
}
