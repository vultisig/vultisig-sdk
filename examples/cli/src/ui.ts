/**
 * UI Helper Module - Presentation layer utilities for CLI
 *
 * Contains all UI-related functionality:
 * - Spinners for async operations
 * - Colored console output
 * - Display formatters for balances, addresses, portfolios
 * - User prompts and confirmations
 */
import type { Balance, Chain, FiatCurrency, GasInfo, SwapQuoteResult, Value, VaultBase } from '@vultisig/sdk/node'
import { fiatCurrencyNameRecord, Vultisig } from '@vultisig/sdk/node'
import chalk from 'chalk'
import inquirer from 'inquirer'
import ora, { type Ora } from 'ora'

// ============================================================================
// Types
// ============================================================================

export type SendParams = {
  chain: Chain
  to: string
  amount: string // Human-readable amount (e.g., "1.5")
  tokenId?: string
  memo?: string
}

export type PortfolioSummary = {
  totalValue: Value
  chainBalances: Array<{
    chain: Chain
    balance: Balance
    value?: Value
  }>
}

// ============================================================================
// Spinner Helpers
// ============================================================================

export function createSpinner(text: string): Ora {
  return ora(text).start()
}

// ============================================================================
// Console Output Helpers
// ============================================================================

export function success(message: string): void {
  console.log(chalk.green(`\n${message}`))
}

export function error(message: string): void {
  console.error(chalk.red(`\n${message}`))
}

export function info(message: string): void {
  console.log(chalk.blue(message))
}

export function warn(message: string): void {
  console.log(chalk.yellow(message))
}

// ============================================================================
// Display Formatters
// ============================================================================

export function displayBalance(chain: string, balance: Balance): void {
  console.log(chalk.cyan(`\n${chain} Balance:`))
  console.log(`  Amount: ${balance.amount} ${balance.symbol}`)
  if (balance.fiatValue && balance.fiatCurrency) {
    console.log(`  Value:  ${balance.fiatValue.toFixed(2)} ${balance.fiatCurrency}`)
  }
}

export function displayBalancesTable(balances: Record<string, Balance>): void {
  console.log(chalk.cyan('\nPortfolio Balances:\n'))

  const tableData = Object.entries(balances).map(([chain, balance]) => ({
    Chain: chain,
    Amount: balance.amount,
    Symbol: balance.symbol,
    Value:
      balance.fiatValue && balance.fiatCurrency ? `${balance.fiatValue.toFixed(2)} ${balance.fiatCurrency}` : 'N/A',
  }))

  console.table(tableData)
}

export function displayPortfolio(portfolio: PortfolioSummary, currency: FiatCurrency): void {
  const currencyName = fiatCurrencyNameRecord[currency]

  // Display total value
  console.log(chalk.cyan('\n+----------------------------------------+'))
  console.log(chalk.cyan(`|       Portfolio Total Value (${currencyName})       |`))
  console.log(chalk.cyan('+----------------------------------------+'))
  const totalDisplay = portfolio.totalValue.amount.padEnd(20) + portfolio.totalValue.currency.toUpperCase().padStart(16)
  console.log(chalk.cyan('|  ') + chalk.bold.green(totalDisplay) + chalk.cyan('  |'))
  console.log(chalk.cyan('+----------------------------------------+\n'))

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

export function displayAddresses(addresses: Record<string, string>): void {
  console.log(chalk.cyan('\nVault Addresses:\n'))

  const table = Object.entries(addresses).map(([chain, address]) => ({
    Chain: chain,
    Address: address,
  }))

  console.table(table)
}

export function displayVaultInfo(vault: VaultBase): void {
  console.log(chalk.cyan('\n+----------------------------------------+'))
  console.log(chalk.cyan('|           Vault Information            |'))
  console.log(chalk.cyan('+----------------------------------------+\n'))

  // Basic info
  console.log(chalk.bold('Basic Information:'))
  console.log(`  Name:          ${chalk.green(vault.name)}`)
  console.log(`  ID:            ${vault.id}`)
  console.log(`  Type:          ${chalk.yellow(vault.type)}`)
  console.log(`  Created:       ${new Date(vault.createdAt).toLocaleString()}`)
  console.log(`  Last Modified: ${new Date(vault.lastModified).toLocaleString()}`)

  // Security info
  console.log(chalk.bold('\nSecurity:'))
  console.log(`  Encrypted:     ${vault.isEncrypted ? chalk.green('Yes') : chalk.gray('No')}`)
  console.log(`  Backed Up:     ${vault.isBackedUp ? chalk.green('Yes') : chalk.yellow('No')}`)

  // MPC info
  console.log(chalk.bold('\nMPC Configuration:'))
  console.log(`  Library Type:  ${vault.libType}`)
  console.log(`  Threshold:     ${chalk.cyan(vault.threshold)} of ${chalk.cyan(vault.totalSigners)}`)
  console.log(`  Local Party:   ${vault.localPartyId}`)
  console.log(`  Total Signers: ${vault.totalSigners}`)

  // Signing modes
  const modes = vault.availableSigningModes
  console.log(chalk.bold('\nSigning Modes:'))
  modes.forEach(mode => {
    console.log(`  - ${mode}`)
  })

  // Chains
  const chains = vault.chains
  console.log(chalk.bold('\nChains:'))
  console.log(`  Total: ${chains.length}`)
  chains.forEach((chain: Chain) => {
    console.log(`  - ${chain}`)
  })

  // Currency
  console.log(chalk.bold('\nPreferences:'))
  console.log(`  Currency:      ${vault.currency.toUpperCase()}`)

  // Public keys
  console.log(chalk.bold('\nPublic Keys:'))
  console.log(`  ECDSA:         ${vault.publicKeys.ecdsa.substring(0, 20)}...`)
  console.log(`  EdDSA:         ${vault.publicKeys.eddsa.substring(0, 20)}...`)
  console.log(`  Chain Code:    ${vault.hexChainCode.substring(0, 20)}...\n`)
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
    console.log(chalk.blue(`\nEstimated gas: ${JSON.stringify(gas, null, 2)}`))
  }

  console.log(chalk.cyan('\nTransaction Preview:'))
  console.log(`  From:   ${fromAddress}`)
  console.log(`  To:     ${toAddress}`)
  console.log(`  Amount: ${amount} ${symbol}`)
  console.log(`  Chain:  ${chain}`)
  if (memo) {
    console.log(`  Memo:   ${memo}`)
  }
}

export function displayTransactionResult(chain: Chain, txHash: string): void {
  const explorerUrl = Vultisig.getTxExplorerUrl(chain, txHash)

  console.log(chalk.green('\n+ Transaction successful!'))
  console.log(chalk.blue(`\nTransaction Hash: ${txHash}`))
  console.log(chalk.cyan(`View on explorer: ${explorerUrl}`))
}

export function displayVaultsList(vaults: VaultBase[], activeVault: VaultBase | null): void {
  console.log(chalk.cyan('\nStored Vaults:\n'))

  const table = vaults.map(vault => ({
    ID: vault.id,
    Name: vault.name === activeVault?.name ? chalk.green(`${vault.name} (active)`) : vault.name,
    Type: vault.type,
    Chains: vault.chains.length,
    Created: new Date(vault.createdAt).toLocaleDateString(),
  }))

  console.table(table)
}

// ============================================================================
// User Prompts
// ============================================================================

export async function confirmTransaction(): Promise<boolean> {
  const { confirmed } = await inquirer.prompt([
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
  const { password } = await inquirer.prompt([
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
    console.log(chalk.blue(`i Balance updated for ${chain} (${asset}): ${balance.amount}`))
  })

  // Transaction broadcast
  vault.on('transactionBroadcast', ({ chain, txHash }: any) => {
    console.log(chalk.green(`+ Transaction broadcast on ${chain}`))
    console.log(chalk.blue(`  TX Hash: ${txHash}`))
  })

  // Chain added
  vault.on('chainAdded', ({ chain }: any) => {
    console.log(chalk.green(`+ Chain added: ${chain}`))
  })

  // Chain removed
  vault.on('chainRemoved', ({ chain }: any) => {
    console.log(chalk.yellow(`i Chain removed: ${chain}`))
  })

  // Token added
  vault.on('tokenAdded', ({ chain, token }: any) => {
    console.log(chalk.green(`+ Token added: ${token.symbol} on ${chain}`))
  })

  // Values updated
  vault.on('valuesUpdated', ({ chain }: any) => {
    if (chain === 'all') {
      console.log(chalk.blue('i Portfolio values updated'))
    } else {
      console.log(chalk.blue(`i Values updated for ${chain}`))
    }
  })

  // Errors
  vault.on('error', (error: any) => {
    console.error(chalk.red(`x Vault error: ${error.message}`))
  })
}

// ============================================================================
// Swap Display Helpers
// ============================================================================

export function displaySwapPreview(
  quote: SwapQuoteResult,
  fromAmount: string,
  fromSymbol: string,
  toSymbol: string
): void {
  console.log(chalk.cyan('\nSwap Preview:'))
  console.log(`  From:     ${fromAmount} ${fromSymbol}`)
  console.log(`  To:       ${quote.estimatedOutput} ${toSymbol}`)
  console.log(`  Provider: ${quote.provider}`)

  if (quote.fees) {
    console.log(chalk.bold('\n  Fees:'))
    console.log(`    Network:  ${quote.fees.network}`)
    if (quote.fees.affiliate) {
      console.log(`    Affiliate: ${quote.fees.affiliate}`)
    }
    console.log(`    Total:    ${quote.fees.total}`)
  }

  if (quote.warnings && quote.warnings.length > 0) {
    console.log(chalk.yellow('\n  Warnings:'))
    quote.warnings.forEach(warning => {
      console.log(chalk.yellow(`    - ${warning}`))
    })
  }

  if (quote.requiresApproval) {
    console.log(chalk.yellow('\n  ⚠ Token approval required before swap'))
    if (quote.approvalInfo) {
      console.log(`    Spender: ${quote.approvalInfo.spender}`)
    }
  }

  // Show expiry
  const expiresIn = Math.max(0, Math.floor((quote.expiresAt - Date.now()) / 1000))
  console.log(chalk.gray(`\n  Quote expires in ${expiresIn}s`))
}

export function displaySwapResult(fromChain: Chain, toChain: Chain, txHash: string, quote: SwapQuoteResult): void {
  const explorerUrl = Vultisig.getTxExplorerUrl(fromChain, txHash)

  console.log(chalk.green('\n✓ Swap transaction broadcast!'))
  console.log(chalk.blue(`\nTransaction Hash: ${txHash}`))
  console.log(chalk.cyan(`View on explorer: ${explorerUrl}`))

  if (fromChain !== toChain) {
    console.log(chalk.yellow(`\nNote: Cross-chain swap from ${fromChain} to ${toChain}`))
    console.log(chalk.yellow('The destination tokens will arrive after the swap completes.'))
  }

  console.log(`\nEstimated output: ${quote.estimatedOutput}`)
}

export function displaySwapChains(chains: readonly Chain[]): void {
  console.log(chalk.cyan('\nSupported Swap Chains:\n'))

  const table = chains.map(chain => ({
    Chain: chain,
  }))

  console.table(table)
  console.log(`\nTotal: ${chains.length} chains`)
}

export async function confirmSwap(): Promise<boolean> {
  const { confirmed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmed',
      message: 'Proceed with this swap?',
      default: false,
    },
  ])
  return confirmed
}
