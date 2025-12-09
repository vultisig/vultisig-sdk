/**
 * UI Helper Module - Presentation layer utilities for CLI
 *
 * Contains all UI-related functionality:
 * - Display formatters for balances, addresses, portfolios
 * - User prompts and confirmations
 *
 * Note: For output helpers (info, success, warn, error, createSpinner),
 * import directly from './lib/output' which respects silent mode.
 */
import type { Balance, Chain, FiatCurrency, GasInfo, SwapQuoteResult, VaultBase } from '@vultisig/sdk'
import { fiatCurrencyNameRecord, Vultisig } from '@vultisig/sdk'
import chalk from 'chalk'

import { replPrompt } from './interactive'

// Re-export types from core for backwards compatibility
export type { PortfolioSummary, SendParams } from './core/types'
import type { PortfolioSummary } from './core/types'
// Import output helpers
import { info, isJsonOutput, printError, printResult, printTable, warn } from './lib/output'

// ============================================================================
// Display Formatters
// ============================================================================

export function displayBalance(chain: string, balance: Balance): void {
  printResult(chalk.cyan(`\n${chain} Balance:`))
  printResult(`  Amount: ${balance.amount} ${balance.symbol}`)
  if (balance.fiatValue && balance.fiatCurrency) {
    printResult(`  Value:  ${balance.fiatValue.toFixed(2)} ${balance.fiatCurrency}`)
  }
}

export function displayBalancesTable(balances: Record<string, Balance>): void {
  printResult(chalk.cyan('\nPortfolio Balances:\n'))

  const tableData = Object.entries(balances).map(([chain, balance]) => ({
    Chain: chain,
    Amount: balance.amount,
    Symbol: balance.symbol,
    Value:
      balance.fiatValue && balance.fiatCurrency ? `${balance.fiatValue.toFixed(2)} ${balance.fiatCurrency}` : 'N/A',
  }))

  printTable(tableData)
}

export function displayPortfolio(portfolio: PortfolioSummary, currency: FiatCurrency): void {
  const currencyName = fiatCurrencyNameRecord[currency]

  // Display total value
  printResult(chalk.cyan('\n+----------------------------------------+'))
  printResult(chalk.cyan(`|       Portfolio Total Value (${currencyName})       |`))
  printResult(chalk.cyan('+----------------------------------------+'))
  const totalDisplay = portfolio.totalValue.amount.padEnd(20) + portfolio.totalValue.currency.toUpperCase().padStart(16)
  printResult(chalk.cyan('|  ') + chalk.bold.green(totalDisplay) + chalk.cyan('  |'))
  printResult(chalk.cyan('+----------------------------------------+\n'))

  // Display breakdown by chain
  printResult(chalk.bold('Chain Breakdown:\n'))

  const table = portfolio.chainBalances.map(({ chain, balance, value }) => ({
    Chain: chain,
    Amount: balance.amount,
    Symbol: balance.symbol,
    Value: value ? `${value.amount} ${value.currency.toUpperCase()}` : 'N/A',
  }))

  printTable(table)
}

export function displayAddresses(addresses: Record<string, string>): void {
  printResult(chalk.cyan('\nVault Addresses:\n'))

  const table = Object.entries(addresses).map(([chain, address]) => ({
    Chain: chain,
    Address: address,
  }))

  printTable(table)
}

export function displayVaultInfo(vault: VaultBase): void {
  printResult(chalk.cyan('\n+----------------------------------------+'))
  printResult(chalk.cyan('|           Vault Information            |'))
  printResult(chalk.cyan('+----------------------------------------+\n'))

  // Basic info
  printResult(chalk.bold('Basic Information:'))
  printResult(`  Name:          ${chalk.green(vault.name)}`)
  printResult(`  ID:            ${vault.id}`)
  printResult(`  Type:          ${chalk.yellow(vault.type)}`)
  printResult(`  Created:       ${new Date(vault.createdAt).toLocaleString()}`)
  printResult(`  Last Modified: ${new Date(vault.lastModified).toLocaleString()}`)

  // Security info
  printResult(chalk.bold('\nSecurity:'))
  printResult(`  Encrypted:     ${vault.isEncrypted ? chalk.green('Yes') : chalk.gray('No')}`)
  printResult(`  Backed Up:     ${vault.isBackedUp ? chalk.green('Yes') : chalk.yellow('No')}`)

  // MPC info
  printResult(chalk.bold('\nMPC Configuration:'))
  printResult(`  Library Type:  ${vault.libType}`)
  printResult(`  Threshold:     ${chalk.cyan(vault.threshold)} of ${chalk.cyan(vault.totalSigners)}`)
  printResult(`  Local Party:   ${vault.localPartyId}`)
  printResult(`  Total Signers: ${vault.totalSigners}`)

  // Signing modes
  const modes = vault.availableSigningModes
  printResult(chalk.bold('\nSigning Modes:'))
  modes.forEach(mode => {
    printResult(`  - ${mode}`)
  })

  // Chains
  const chains = vault.chains
  printResult(chalk.bold('\nChains:'))
  printResult(`  Total: ${chains.length}`)
  chains.forEach((chain: Chain) => {
    printResult(`  - ${chain}`)
  })

  // Currency
  printResult(chalk.bold('\nPreferences:'))
  printResult(`  Currency:      ${vault.currency.toUpperCase()}`)

  // Public keys
  printResult(chalk.bold('\nPublic Keys:'))
  printResult(`  ECDSA:         ${vault.publicKeys.ecdsa.substring(0, 20)}...`)
  printResult(`  EdDSA:         ${vault.publicKeys.eddsa.substring(0, 20)}...`)
  printResult(`  Chain Code:    ${vault.hexChainCode.substring(0, 20)}...\n`)
}

export function displayTransactionPreview(
  fromAddress: string,
  toAddress: string,
  amount: string,
  symbol: string,
  chain: Chain,
  memo?: string,
  gas?: GasInfo
): void {
  if (gas) {
    const bigIntReplacer = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)
    info(chalk.blue(`\nEstimated gas: ${JSON.stringify(gas, bigIntReplacer, 2)}`))
  }

  printResult(chalk.cyan('\nTransaction Preview:'))
  printResult(`  From:   ${fromAddress}`)
  printResult(`  To:     ${toAddress}`)
  printResult(`  Amount: ${amount} ${symbol}`)
  printResult(`  Chain:  ${chain}`)
  if (memo) {
    printResult(`  Memo:   ${memo}`)
  }
}

export function displayTransactionResult(chain: Chain, txHash: string): void {
  const explorerUrl = Vultisig.getTxExplorerUrl(chain, txHash)

  printResult(txHash)
  printResult(explorerUrl)
}

export function displayVaultsList(vaults: VaultBase[], activeVault: VaultBase | null): void {
  printResult(chalk.cyan('\nStored Vaults:\n'))

  const table = vaults.map(vault => ({
    ID: vault.id,
    Name: vault.name === activeVault?.name ? chalk.green(`${vault.name} (active)`) : vault.name,
    Type: vault.type,
    Chains: vault.chains.length,
    Created: new Date(vault.createdAt).toLocaleDateString(),
  }))

  printTable(table)
}

// ============================================================================
// User Prompts
// ============================================================================

export async function confirmTransaction(): Promise<boolean> {
  const { confirmed } = await replPrompt([
    {
      type: 'confirm',
      name: 'confirmed',
      message: 'Proceed with this transaction?',
      default: false,
    },
  ])
  return confirmed
}

export async function promptForPassword(message = 'Enter password:'): Promise<string> {
  const { password } = await replPrompt([
    {
      type: 'password',
      name: 'password',
      message,
      mask: '*',
    },
  ])
  return password
}

// ============================================================================
// Vault Event Handlers
// ============================================================================

export function setupVaultEvents(vault: VaultBase): void {
  // Balance updates
  vault.on('balanceUpdated', ({ chain, balance, tokenId }: any) => {
    const asset = tokenId ? `${balance.symbol} token` : balance.symbol
    info(chalk.blue(`i Balance updated for ${chain} (${asset}): ${balance.amount}`))
  })

  // Transaction broadcast
  vault.on('transactionBroadcast', ({ chain, txHash }: any) => {
    info(chalk.green(`+ Transaction broadcast on ${chain}`))
    info(chalk.blue(`  TX Hash: ${txHash}`))
  })

  // Chain added
  vault.on('chainAdded', ({ chain }: any) => {
    info(chalk.green(`+ Chain added: ${chain}`))
  })

  // Chain removed
  vault.on('chainRemoved', ({ chain }: any) => {
    warn(chalk.yellow(`i Chain removed: ${chain}`))
  })

  // Token added
  vault.on('tokenAdded', ({ chain, token }: any) => {
    info(chalk.green(`+ Token added: ${token.symbol} on ${chain}`))
  })

  // Values updated
  vault.on('valuesUpdated', ({ chain }: any) => {
    if (chain === 'all') {
      info(chalk.blue('i Portfolio values updated'))
    } else {
      info(chalk.blue(`i Values updated for ${chain}`))
    }
  })

  // Errors - skip in JSON mode (errors are reported via JSON response)
  if (!isJsonOutput()) {
    vault.on('error', (err: any) => {
      printError(chalk.red(`x Vault error: ${err.message}`))
    })
  }
}

// ============================================================================
// Swap Display Helpers
// ============================================================================

/**
 * Format bigint amount to human-readable string
 */
function formatBigintAmount(amount: bigint, decimals: number): string {
  if (amount === 0n) return '0'

  const divisor = BigInt(10 ** decimals)
  const whole = amount / divisor
  const fraction = amount % divisor

  if (fraction === 0n) {
    return whole.toString()
  }

  const fractionStr = fraction.toString().padStart(decimals, '0')
  // Trim trailing zeros
  const trimmed = fractionStr.replace(/0+$/, '')
  return `${whole}.${trimmed}`
}

export type SwapPreviewOptions = {
  fromDecimals: number
  toDecimals: number
  feeDecimals: number
  feeSymbol: string
}

export function displaySwapPreview(
  quote: SwapQuoteResult,
  fromAmount: string,
  fromSymbol: string,
  toSymbol: string,
  options: SwapPreviewOptions
): void {
  const estimatedOutputFormatted = formatBigintAmount(quote.estimatedOutput, options.toDecimals)

  printResult(chalk.cyan('\nSwap Preview:'))
  printResult(`  From:     ${fromAmount} ${fromSymbol}`)
  printResult(`  To:       ${estimatedOutputFormatted} ${toSymbol}`)

  // Show fiat value if available
  if (quote.estimatedOutputFiat !== undefined) {
    printResult(`            (~$${quote.estimatedOutputFiat.toFixed(2)})`)
  }

  printResult(`  Provider: ${quote.provider}`)

  if (quote.fees) {
    const networkFeeFormatted = formatBigintAmount(quote.fees.network, options.feeDecimals)
    const totalFeeFormatted = formatBigintAmount(quote.fees.total, options.feeDecimals)

    printResult(chalk.bold('\n  Fees:'))
    printResult(`    Network:  ${networkFeeFormatted} ${options.feeSymbol}`)

    // Show fiat fee if available
    if (quote.feesFiat) {
      printResult(`              (~$${quote.feesFiat.network.toFixed(2)})`)
    }

    if (quote.fees.affiliate && quote.fees.affiliate > 0n) {
      const affiliateFeeFormatted = formatBigintAmount(quote.fees.affiliate, options.feeDecimals)
      printResult(`    Affiliate: ${affiliateFeeFormatted} ${options.feeSymbol}`)
      if (quote.feesFiat?.affiliate) {
        printResult(`               (~$${quote.feesFiat.affiliate.toFixed(2)})`)
      }
    }

    printResult(`    Total:    ${totalFeeFormatted} ${options.feeSymbol}`)
    if (quote.feesFiat) {
      printResult(`              (~$${quote.feesFiat.total.toFixed(2)})`)
    }
  }

  if (quote.warnings && quote.warnings.length > 0) {
    printResult(chalk.yellow('\n  Warnings:'))
    quote.warnings.forEach(warning => {
      printResult(chalk.yellow(`    - ${warning}`))
    })
  }

  if (quote.requiresApproval) {
    printResult(chalk.yellow('\n  Token approval required before swap'))
    if (quote.approvalInfo) {
      printResult(`    Spender: ${quote.approvalInfo.spender}`)
    }
  }

  // Show expiry
  const expiresIn = Math.max(0, Math.floor((quote.expiresAt - Date.now()) / 1000))
  info(chalk.gray(`\n  Quote expires in ${expiresIn}s`))
}

export function displaySwapResult(
  fromChain: Chain,
  _toChain: Chain,
  txHash: string,
  quote: SwapQuoteResult,
  toDecimals: number
): void {
  const explorerUrl = Vultisig.getTxExplorerUrl(fromChain, txHash)
  const estimatedOutputFormatted = formatBigintAmount(quote.estimatedOutput, toDecimals)

  printResult(txHash)
  printResult(explorerUrl)
  printResult(estimatedOutputFormatted)
}

export function displaySwapChains(chains: readonly Chain[]): void {
  printResult(chalk.cyan('\nSupported Swap Chains:\n'))

  const table = chains.map(chain => ({
    Chain: chain,
  }))

  printTable(table)
  printResult(`\nTotal: ${chains.length} chains`)
}

export async function confirmSwap(): Promise<boolean> {
  const { confirmed } = await replPrompt([
    {
      type: 'confirm',
      name: 'confirmed',
      message: 'Proceed with this swap?',
      default: false,
    },
  ])
  return confirmed
}
