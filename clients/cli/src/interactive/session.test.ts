import type { Vultisig } from '@vultisig/sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { executePortfolio } = vi.hoisted(() => ({
  executePortfolio: vi.fn(async () => {}),
}))

vi.mock('../commands', async importOriginal => ({
  ...(await importOriginal<typeof import('../commands')>()),
  executePortfolio,
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
