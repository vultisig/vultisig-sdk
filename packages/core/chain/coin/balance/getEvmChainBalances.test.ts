import { EvmChain } from '@vultisig/core-chain/Chain'
import { getEvmClient } from '@vultisig/core-chain/chains/evm/client'
import { getEvmChainBalances } from '@vultisig/core-chain/coin/balance/getEvmChainBalances'
import { getEvmCoinBalance } from '@vultisig/core-chain/coin/balance/resolvers/evm'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@vultisig/core-chain/chains/evm/client', () => ({
  getEvmClient: vi.fn(),
}))

vi.mock('@vultisig/core-chain/coin/balance/resolvers/evm', () => ({
  getEvmCoinBalance: vi.fn(),
}))

afterEach(() => {
  vi.clearAllMocks()
})

const address = '0x00000000000000000000000000000000000000aa'
const usdc = '0x00000000000000000000000000000000000000bb'
const badToken = '0x00000000000000000000000000000000000000cc'

describe('getEvmChainBalances', () => {
  it('fetches native and ERC20 balances in one multicall and decodes failed calls as zero', async () => {
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
    expect(balances).toEqual({
      [`${EvmChain.Ethereum}:${address}`]: 10n,
      [`${EvmChain.Ethereum}:${usdc}:${address}`]: 20n,
      [`${EvmChain.Ethereum}:${badToken}:${address}`]: 0n,
    })
  })

  it('falls back to existing per-coin resolver when the chain has no Multicall3 metadata', async () => {
    vi.mocked(getEvmClient).mockReturnValue({
      chain: { contracts: {} },
    } as any)
    vi.mocked(getEvmCoinBalance).mockResolvedValueOnce(11n).mockRejectedValueOnce(new Error('bad token'))

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
      [`${EvmChain.Hyperliquid}:${badToken}:${address}`]: 0n,
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
    vi.mocked(getEvmCoinBalance).mockResolvedValueOnce(12n).mockRejectedValueOnce(new Error('bad token'))

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
      [`${EvmChain.Ethereum}:${badToken}:${address}`]: 0n,
    })
  })
})
