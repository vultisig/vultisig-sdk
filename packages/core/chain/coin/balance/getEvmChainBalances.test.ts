import { getEvmClient } from '@vultisig/core-chain/chains/evm/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EvmChain } from '../../Chain'
import { getEvmChainBalances } from './getEvmChainBalances'
import { getEvmCoinBalance } from './resolvers/evm'

vi.mock('@vultisig/core-chain/chains/evm/client', () => ({
  getEvmClient: vi.fn(),
}))

vi.mock('./resolvers/evm', () => ({
  getEvmCoinBalance: vi.fn(),
}))

afterEach(() => {
  vi.clearAllMocks()
})

const address = '0x00000000000000000000000000000000000000aa'
const usdc = '0x00000000000000000000000000000000000000bb'
const badToken = '0x00000000000000000000000000000000000000cc'

describe('getEvmChainBalances', () => {
  it('fetches native and ERC20 balances in one multicall and retries failed calls with the per-coin resolver', async () => {
    const multicall = vi.fn().mockResolvedValue([
      { status: 'success', result: 10n },
      { status: 'success', result: 20n },
      { status: 'failure', error: new Error('bad token') },
    ])
    vi.mocked(getEvmClient).mockReturnValue({
      chain: {
        contracts: {
          multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' },
        },
      },
      multicall,
    } as any)
    vi.mocked(getEvmCoinBalance).mockResolvedValueOnce(30n)

    const balances = await getEvmChainBalances({
      chain: EvmChain.Ethereum,
      address,
      coins: [
        { chain: EvmChain.Ethereum, address },
        { chain: EvmChain.Ethereum, address, id: usdc },
        { chain: EvmChain.Ethereum, address, id: badToken },
      ],
    })

    expect(multicall).toHaveBeenCalledTimes(1)
    expect(multicall).toHaveBeenCalledWith(
      expect.objectContaining({
        allowFailure: true,
        contracts: [
          expect.objectContaining({
            address: '0xcA11bde05977b3631167028862bE2a173976CA11',
            functionName: 'getEthBalance',
            args: [address],
          }),
          expect.objectContaining({
            address: usdc,
            functionName: 'balanceOf',
            args: [address],
          }),
          expect.objectContaining({
            address: badToken,
            functionName: 'balanceOf',
            args: [address],
          }),
        ],
      })
    )
    expect(getEvmCoinBalance).toHaveBeenCalledTimes(1)
    expect(getEvmCoinBalance).toHaveBeenCalledWith({
      chain: EvmChain.Ethereum,
      address,
      id: badToken,
    })
    expect(balances).toEqual({
      [`${EvmChain.Ethereum}:${address}`]: 10n,
      [`${EvmChain.Ethereum}:${usdc}:${address}`]: 20n,
      [`${EvmChain.Ethereum}:${badToken}:${address}`]: 30n,
    })
  })

  it('falls back to existing per-coin resolver when the chain has no Multicall3 metadata', async () => {
    vi.mocked(getEvmClient).mockReturnValue({
      chain: { contracts: {} },
    } as any)
    vi.mocked(getEvmCoinBalance).mockResolvedValueOnce(11n).mockResolvedValueOnce(22n)

    const balances = await getEvmChainBalances({
      chain: EvmChain.Hyperliquid,
      address,
      coins: [
        { chain: EvmChain.Hyperliquid, address },
        { chain: EvmChain.Hyperliquid, address, id: badToken },
      ],
    })

    expect(getEvmCoinBalance).toHaveBeenCalledTimes(2)
    expect(balances).toEqual({
      [`${EvmChain.Hyperliquid}:${address}`]: 11n,
      [`${EvmChain.Hyperliquid}:${badToken}:${address}`]: 22n,
    })
  })

  it('falls back to existing per-coin resolver when multicall rejects', async () => {
    vi.mocked(getEvmClient).mockReturnValue({
      chain: {
        contracts: {
          multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' },
        },
      },
      multicall: vi.fn().mockRejectedValue(new Error('multicall unavailable')),
    } as any)
    vi.mocked(getEvmCoinBalance).mockResolvedValueOnce(12n).mockResolvedValueOnce(24n)

    const balances = await getEvmChainBalances({
      chain: EvmChain.Ethereum,
      address,
      coins: [
        { chain: EvmChain.Ethereum, address },
        { chain: EvmChain.Ethereum, address, id: badToken },
      ],
    })

    expect(getEvmCoinBalance).toHaveBeenCalledTimes(2)
    expect(balances).toEqual({
      [`${EvmChain.Ethereum}:${address}`]: 12n,
      [`${EvmChain.Ethereum}:${badToken}:${address}`]: 24n,
    })
  })

  it('propagates unresolved balance failures instead of returning a false zero', async () => {
    vi.mocked(getEvmClient).mockReturnValue({
      chain: {
        contracts: {
          multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' },
        },
      },
      multicall: vi.fn().mockResolvedValue([{ status: 'failure', error: new Error('rpc timeout') }]),
    } as any)
    vi.mocked(getEvmCoinBalance).mockRejectedValueOnce(new Error('rpc timeout'))

    await expect(
      getEvmChainBalances({
        chain: EvmChain.Ethereum,
        address,
        coins: [{ chain: EvmChain.Ethereum, address }],
      })
    ).rejects.toThrow('rpc timeout')
  })
})
