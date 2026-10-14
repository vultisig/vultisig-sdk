import type { Vultisig } from '@vultisig/sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { executePortfolio, executeSwap } = vi.hoisted(() => ({
  executePortfolio: vi.fn(async () => {}),
  executeSwap: vi.fn(async () => {}),
}))

vi.mock('../commands', async importOriginal => ({
  ...(await importOriginal<typeof import('../commands')>()),
  executePortfolio,
  executeSwap,
}))

import { ShellSession } from './session'

type TestableShellSession = {
  processLine(line: string): Promise<void>
}

describe('interactive portfolio command', () => {
  beforeEach(() => executePortfolio.mockClear())

  it('passes through an omitted or explicit display currency', async () => {
    const session = new ShellSession({} as Vultisig) as unknown as TestableShellSession

    await session.processLine('portfolio')
    expect(executePortfolio).toHaveBeenLastCalledWith(expect.anything(), { currency: undefined, raw: false })

    await session.processLine('portfolio -c gbp')
    expect(executePortfolio).toHaveBeenLastCalledWith(expect.anything(), { currency: 'gbp', raw: false })
  })
})

describe('interactive swap command', () => {
  beforeEach(() => executeSwap.mockClear())

  it('rejects invalid slippage before calling the SDK path', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const session = new ShellSession({} as Vultisig) as unknown as TestableShellSession

    await session.processLine('swap Ethereum Bitcoin 1 --slippage abc')

    expect(executeSwap).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Invalid --slippage: "abc"'))
    error.mockRestore()
  })
})
