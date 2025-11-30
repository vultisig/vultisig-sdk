/**
 * Event Buffer - Buffers vault events during command execution
 *
 * Prevents vault events from interfering with the REPL prompt.
 * Events are collected during command execution and displayed after completion.
 */
import type { VaultBase } from '@vultisig/sdk/node'
import chalk from 'chalk'

type BufferedEvent = {
  timestamp: Date
  message: string
  type: 'info' | 'success' | 'warning' | 'error'
}

/**
 * EventBuffer - Manages vault event buffering for clean REPL output
 */
export class EventBuffer {
  private eventBuffer: BufferedEvent[] = []
  private isCommandRunning = false

  /**
   * Mark the start of a command execution.
   * Events will be buffered until endCommand() is called.
   */
  startCommand(): void {
    this.isCommandRunning = true
    this.eventBuffer = []
  }

  /**
   * Mark the end of a command execution.
   * Flushes any buffered events to the console.
   */
  endCommand(): void {
    this.isCommandRunning = false
    this.flushBuffer()
  }

  /**
   * Handle an event - buffer if command is running, display immediately if idle.
   */
  private handleEvent(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
    if (this.isCommandRunning) {
      this.eventBuffer.push({
        timestamp: new Date(),
        message,
        type,
      })
    } else {
      this.displayEvent(message, type)
    }
  }

  /**
   * Display a single event to the console with appropriate formatting.
   */
  private displayEvent(message: string, type: 'info' | 'success' | 'warning' | 'error'): void {
    switch (type) {
      case 'success':
        console.log(chalk.green(message))
        break
      case 'warning':
        console.log(chalk.yellow(message))
        break
      case 'error':
        console.error(chalk.red(message))
        break
      case 'info':
      default:
        console.log(chalk.blue(message))
        break
    }
  }

  /**
   * Flush all buffered events to the console.
   */
  private flushBuffer(): void {
    if (this.eventBuffer.length === 0) {
      return
    }

    console.log(chalk.gray('\n--- Background Events ---'))
    this.eventBuffer.forEach(event => {
      const timeStr = event.timestamp.toLocaleTimeString()
      const message = `[${timeStr}] ${event.message}`
      this.displayEvent(message, event.type)
    })
    console.log(chalk.gray('--- End Events ---\n'))
  }

  /**
   * Setup all vault event listeners
   */
  setupVaultListeners(vault: VaultBase): void {
    // Balance updates
    vault.on('balanceUpdated', ({ chain, balance, tokenId }: any) => {
      const asset = tokenId ? `${balance.symbol} token` : balance.symbol
      this.handleEvent(`i Balance updated for ${chain} (${asset}): ${balance.amount}`, 'info')
    })

    // Transaction signed
    vault.on('transactionSigned', () => {
      this.handleEvent(`+ Transaction signed successfully`, 'success')
    })

    // Transaction broadcast
    vault.on('transactionBroadcast', ({ chain, txHash }: any) => {
      this.handleEvent(`+ Transaction broadcast on ${chain}`, 'success')
      this.handleEvent(`  TX Hash: ${txHash}`, 'info')
    })

    // Signing progress
    vault.on('signingProgress', ({ step }: any) => {
      this.handleEvent(`i Signing: ${step}`, 'info')
    })

    // Chain added
    vault.on('chainAdded', ({ chain }: any) => {
      this.handleEvent(`+ Chain added: ${chain}`, 'success')
    })

    // Chain removed
    vault.on('chainRemoved', ({ chain }: any) => {
      this.handleEvent(`i Chain removed: ${chain}`, 'warning')
    })

    // Token added
    vault.on('tokenAdded', ({ chain, token }: any) => {
      this.handleEvent(`+ Token added: ${token.symbol} on ${chain}`, 'success')
    })

    // Token removed
    vault.on('tokenRemoved', ({ chain, tokenId }: any) => {
      this.handleEvent(`i Token removed: ${tokenId} from ${chain}`, 'warning')
    })

    // Vault renamed
    vault.on('renamed', ({ oldName, newName }: any) => {
      this.handleEvent(`i Vault renamed: ${oldName} -> ${newName}`, 'info')
    })

    // Values updated
    vault.on('valuesUpdated', ({ chain }: any) => {
      if (chain === 'all') {
        this.handleEvent('i Portfolio values updated', 'info')
      } else {
        this.handleEvent(`i Values updated for ${chain}`, 'info')
      }
    })

    // Total value updated
    vault.on('totalValueUpdated', ({ value }: any) => {
      this.handleEvent(`i Portfolio total: ${value.formatted}`, 'info')
    })

    // Vault lifecycle events
    vault.on('saved', () => {
      this.handleEvent(`+ Vault saved`, 'success')
    })

    vault.on('loaded', () => {
      this.handleEvent(`i Vault loaded`, 'info')
    })

    vault.on('unlocked', () => {
      this.handleEvent(`+ Vault unlocked`, 'success')
    })

    vault.on('locked', () => {
      this.handleEvent(`i Vault locked`, 'info')
    })

    // Swap events
    vault.on('swapQuoteReceived', ({ quote }: any) => {
      this.handleEvent(`i Swap quote received: ${quote.fromAmount} -> ${quote.toAmount}`, 'info')
    })

    vault.on('swapApprovalRequired', ({ token, amount }: any) => {
      this.handleEvent(`! Approval required for ${token}: ${amount}`, 'warning')
    })

    vault.on('swapApprovalGranted', ({ token }: any) => {
      this.handleEvent(`+ Approval granted for ${token}`, 'success')
    })

    vault.on('swapPrepared', ({ provider, fromAmount, toAmountExpected }: any) => {
      this.handleEvent(`i Swap prepared via ${provider}: ${fromAmount} -> ${toAmountExpected}`, 'info')
    })

    // Errors
    vault.on('error', (error: any) => {
      this.handleEvent(`x Vault error: ${error.message}`, 'error')
    })
  }

  /**
   * Remove all event listeners from a vault.
   */
  cleanupVaultListeners(vault: VaultBase): void {
    vault.removeAllListeners('balanceUpdated')
    vault.removeAllListeners('transactionSigned')
    vault.removeAllListeners('transactionBroadcast')
    vault.removeAllListeners('signingProgress')
    vault.removeAllListeners('chainAdded')
    vault.removeAllListeners('chainRemoved')
    vault.removeAllListeners('tokenAdded')
    vault.removeAllListeners('tokenRemoved')
    vault.removeAllListeners('renamed')
    vault.removeAllListeners('valuesUpdated')
    vault.removeAllListeners('totalValueUpdated')
    vault.removeAllListeners('saved')
    vault.removeAllListeners('loaded')
    vault.removeAllListeners('unlocked')
    vault.removeAllListeners('locked')
    vault.removeAllListeners('swapQuoteReceived')
    vault.removeAllListeners('swapApprovalRequired')
    vault.removeAllListeners('swapApprovalGranted')
    vault.removeAllListeners('swapPrepared')
    vault.removeAllListeners('error')
  }
}
