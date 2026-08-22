import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetCode = vi.fn()

vi.mock('@vultisig/core-chain/chains/evm/client', () => ({
  getEvmClient: () => ({
    getCode: mockGetCode,
  }),
}))

import { assertCctpMintSideHasCode, CctpMintSideCodeError } from '@/tools/bridge/assertCctpMintSideCode'
import { getCctpChain } from '@/tools/bridge/cctp'

describe('assertCctpMintSideHasCode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves when the destination MessageTransmitter has code', async () => {
    mockGetCode.mockResolvedValueOnce('0x6080604052')
    await expect(assertCctpMintSideHasCode('Arbitrum')).resolves.toBeUndefined()
    expect(mockGetCode).toHaveBeenCalledWith({ address: getCctpChain('Arbitrum')!.messageTransmitter })
  })

  it('fails closed when the destination MessageTransmitter has NO code (0x)', async () => {
    mockGetCode.mockResolvedValueOnce('0x')
    await expect(assertCctpMintSideHasCode('Polygon')).rejects.toThrow(CctpMintSideCodeError)
    await expect(assertCctpMintSideHasCode('Polygon')).rejects.toThrow(/no contract code found/)
  })

  it('fails closed when getCode returns undefined (e.g. address never deployed)', async () => {
    mockGetCode.mockResolvedValueOnce(undefined)
    await expect(assertCctpMintSideHasCode('Optimism')).rejects.toThrow(CctpMintSideCodeError)
  })

  it('rejects an unsupported destination chain before hitting the network', async () => {
    await expect(assertCctpMintSideHasCode('Solana')).rejects.toThrow(/not supported by CCTP/)
    expect(mockGetCode).not.toHaveBeenCalled()
  })

  it('caches a positive result — a second call for the same chain does not re-hit the RPC', async () => {
    mockGetCode.mockResolvedValueOnce('0x6080604052')
    await assertCctpMintSideHasCode('Ethereum')
    await assertCctpMintSideHasCode('Ethereum')
    expect(mockGetCode).toHaveBeenCalledTimes(1)
  })

  it('does NOT cache a failure — a second call after a codeless result re-hits the RPC', async () => {
    mockGetCode.mockResolvedValueOnce('0x').mockResolvedValueOnce('0x6080604052')
    await expect(assertCctpMintSideHasCode('Base')).rejects.toThrow(CctpMintSideCodeError)
    await expect(assertCctpMintSideHasCode('Base')).resolves.toBeUndefined()
    expect(mockGetCode).toHaveBeenCalledTimes(2)
  })
})
