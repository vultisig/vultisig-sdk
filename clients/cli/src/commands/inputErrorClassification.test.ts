import type { VaultBase } from '@vultisig/sdk'
import { Chain, VaultError, VaultErrorCode } from '@vultisig/sdk'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/output', () => ({
  createSpinner: () => ({
    succeed: vi.fn(),
    stop: vi.fn(),
    fail: vi.fn(),
    text: '',
  }),
  info: vi.fn(),
  warn: vi.fn(),
  isNonInteractive: () => true,
  isJsonOutput: () => true,
  outputJson: vi.fn(),
}))
vi.mock('../ui', () => ({
  confirmTransaction: vi.fn().mockResolvedValue(true),
  confirmSwap: vi.fn().mockResolvedValue(true),
  displayTransactionPreview: vi.fn(),
  displaySwapChains: vi.fn(),
  displaySwapPreview: vi.fn(),
  displaySwapResult: vi.fn(),
  formatBigintAmount: (value: bigint) => String(value),
}))

import type { CommandContext, SendParams } from '../core'
import { classifyError, ExitCode, InvalidInputError } from '../core/errors'
import { executeSwapQuote } from './swap'
import { executeSend } from './transaction'

function contextWithVault(vault: VaultBase): CommandContext {
  return {
    ensureActiveVault: vi.fn().mockResolvedValue(vault),
  } as unknown as CommandContext
}

async function caughtError(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run()
  } catch (error) {
    return error as Error
  }
  throw new Error('Expected command to reject')
}

describe('command-layer SDK input error classification', () => {
  it('B: preserves and classifies the wrapped XRP DestinationTag error from vault.send', async () => {
    const destination = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh'
    const originalError = new Error(`XRP destination ${destination} requires a DestinationTag`)
    const sdkError = new VaultError(
      VaultErrorCode.InvalidConfig,
      `Failed to prepare send transaction: ${originalError.message}`,
      originalError
    )
    const vault = {
      send: vi.fn().mockRejectedValue(sdkError),
    } as unknown as VaultBase
    const params: SendParams = {
      chain: Chain.Ripple,
      to: destination,
      amount: '1',
      dryRun: true,
    }

    const error = await caughtError(() => executeSend(contextWithVault(vault), params))
    expect(error).toBe(sdkError)
    expect(classifyError(error)).toMatchObject({
      code: 'INVALID_INPUT',
      exitCode: ExitCode.INVALID_INPUT,
      hint: 'Pass --destination-tag <tag>',
    })
    expect(classifyError(error)).toBeInstanceOf(InvalidInputError)
  })

  it("D: preserves and classifies resolveTokenRef's InvalidConfig error from vault.swap", async () => {
    const sdkError = new VaultError(
      VaultErrorCode.InvalidConfig,
      'Token "0xdead" not found on Ethereum. Pass a token symbol or contract address, or add it with vault.addToken().'
    )
    const vault = {
      swap: vi.fn().mockRejectedValue(sdkError),
    } as unknown as VaultBase

    const error = await caughtError(() =>
      executeSwapQuote(contextWithVault(vault), {
        fromChain: Chain.Ethereum,
        toChain: Chain.Ethereum,
        amount: '0.0001',
        toToken: '0xdead',
      })
    )
    expect(error).toBe(sdkError)
    expect(classifyError(error)).toMatchObject({
      code: 'INVALID_INPUT',
      exitCode: ExitCode.INVALID_INPUT,
      hint: 'Run "vultisig tokens Ethereum --add <address>" to track it',
    })
    expect(classifyError(error)).toBeInstanceOf(InvalidInputError)
  })
})
