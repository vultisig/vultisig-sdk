import { EvmChain } from '@vultisig/core-chain/Chain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildCctpBridge,
  CctpRouteUnavailableError,
  createCctpBridgeSession,
  getCctpChain,
} from '../../src/tools/bridge'

const mocks = vi.hoisted(() => ({ getCode: vi.fn(), getEvmClient: vi.fn() }))
vi.mock('@vultisig/core-chain/chains/evm/client', () => ({ getEvmClient: mocks.getEvmClient }))
const params = {
  sourceChain: 'Base',
  destinationChain: 'Arbitrum',
  amount: '10',
  from: '0x1111111111111111111111111111111111111111',
}

beforeEach(() => {
  mocks.getCode.mockReset().mockResolvedValue('0x6000')
  mocks.getEvmClient.mockReset().mockReturnValue({ getCode: mocks.getCode })
})
afterEach(() => vi.useRealTimers())

describe('mandatory CCTP route validation', () => {
  it('exposes the same mandatory builder and session through public barrels', async () => {
    const [root, tools] = await Promise.all([import('../../src/index'), import('../../src/tools')])
    for (const entry of [root, tools]) {
      expect(entry.buildCctpBridge).toBe(buildCctpBridge)
      expect(entry.createCctpBridgeSession).toBe(createCctpBridgeSession)
      expect(entry.CctpRouteUnavailableError).toBe(CctpRouteUnavailableError)
    }
  })

  it('returns nothing until registered destination code is observed', async () => {
    let resolveCode!: (code: string) => void
    mocks.getCode.mockReturnValue(
      new Promise(resolve => {
        resolveCode = resolve
      })
    )
    let returned = false
    const route = buildCctpBridge(params).then(result => {
      returned = true
      return result
    })
    await Promise.resolve()
    expect(returned).toBe(false)
    expect(mocks.getEvmClient).toHaveBeenCalledWith(EvmChain.Arbitrum)
    expect(mocks.getCode).toHaveBeenCalledWith({ address: getCctpChain('Arbitrum')!.messageTransmitter })
    resolveCode('0x6000')
    expect((await route).transactions.map(tx => tx.action)).toEqual(['approve', 'burn'])
  })

  it.each(['0x', undefined, '', '0x1', 'garbage'])(
    'rejects absent or malformed code %j without returning a route',
    async code => {
      mocks.getCode.mockResolvedValue(code)
      await expect(buildCctpBridge(params)).rejects.toThrow(CctpRouteUnavailableError)
      await expect(buildCctpBridge(params)).rejects.toThrow(/route unavailable.*Arbitrum.*no contract code/)
    }
  )

  it('wraps an RPC rejection and retries it within the same session', async () => {
    const session = createCctpBridgeSession()
    mocks.getCode.mockRejectedValueOnce(new Error('provider unavailable'))
    await expect(buildCctpBridge({ ...params, session })).rejects.toThrow(/route unavailable.*RPC failure/)
    expect((await buildCctpBridge({ ...params, session })).transactions).toHaveLength(2)
    expect(mocks.getCode).toHaveBeenCalledTimes(2)
  })

  it('fails closed when the RPC client cannot be created', async () => {
    mocks.getEvmClient.mockImplementation(() => {
      throw new Error('RPC configuration failure')
    })
    await expect(buildCctpBridge(params)).rejects.toThrow(/route unavailable.*RPC client unavailable/)
  })

  it('bounds a hung check, retries, and never caches its late response', async () => {
    vi.useFakeTimers()
    let resolveCode!: (code: string) => void
    mocks.getCode.mockReturnValueOnce(
      new Promise(resolve => {
        resolveCode = resolve
      })
    )
    const session = createCctpBridgeSession()
    const failed = expect(buildCctpBridge({ ...params, session })).rejects.toThrow(/route unavailable.*timeout/)
    await vi.advanceTimersByTimeAsync(20_000)
    await failed
    resolveCode('0x6000')
    mocks.getCode.mockResolvedValueOnce('0x')
    await expect(buildCctpBridge({ ...params, session })).rejects.toThrow(/no contract code/)
    await buildCctpBridge({ ...params, session })
    expect(mocks.getCode).toHaveBeenCalledTimes(3)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retries empty code, while sharing concurrent successful checks for canonical aliases', async () => {
    const session = createCctpBridgeSession()
    mocks.getCode.mockResolvedValueOnce('0x')
    await expect(buildCctpBridge({ ...params, session })).rejects.toThrow(/no contract code/)
    await Promise.all([
      buildCctpBridge({ ...params, session }),
      buildCctpBridge({ ...params, destinationChain: ' arbitrum ', session }),
    ])
    await buildCctpBridge({ ...params, session })
    expect(mocks.getCode).toHaveBeenCalledTimes(2)
  })

  it('never shares cached success across sessions or calls without a session', async () => {
    await buildCctpBridge({ ...params, session: createCctpBridgeSession() })
    await buildCctpBridge({ ...params, session: createCctpBridgeSession() })
    await buildCctpBridge(params)
    await buildCctpBridge(params)
    expect(mocks.getCode).toHaveBeenCalledTimes(4)
  })

  it('checks another destination even when its transmitter address matches', async () => {
    const session = createCctpBridgeSession()
    const base = getCctpChain('Base')!
    const original = base.messageTransmitter
    try {
      base.messageTransmitter = getCctpChain('Arbitrum')!.messageTransmitter
      await buildCctpBridge({ ...params, session })
      await buildCctpBridge({ ...params, sourceChain: 'Arbitrum', destinationChain: 'Base', session })
      expect(mocks.getCode).toHaveBeenCalledTimes(2)
    } finally {
      base.messageTransmitter = original
    }
  })

  it('rechecks changed registry addresses and configured RPC clients', async () => {
    const session = createCctpBridgeSession()
    const destination = getCctpChain('Arbitrum')!
    const original = destination.messageTransmitter
    try {
      await buildCctpBridge({ ...params, session })
      destination.messageTransmitter = '0x1111111111111111111111111111111111111111'
      await buildCctpBridge({ ...params, session })
      mocks.getEvmClient.mockReturnValue({ getCode: mocks.getCode })
      await buildCctpBridge({ ...params, session })
      expect(mocks.getCode).toHaveBeenCalledTimes(3)
    } finally {
      destination.messageTransmitter = original
    }
  })

  it.each([
    { destinationChain: 'Solana' },
    { sourceChain: 'Solana' },
    { destinationChain: 'base' },
    { amount: '0' },
    { amount: '-1' },
    { amount: '1.1234567' },
    { amount: '9'.repeat(80) },
    { to: '' },
    { to: 'invalid' },
    { to: '0x0000000000000000000000000000000000000000' },
  ])('rejects invalid input before touching the network: %j', async invalid => {
    await expect(buildCctpBridge({ ...params, ...invalid })).rejects.toThrow()
    expect(mocks.getEvmClient).not.toHaveBeenCalled()
  })
})
