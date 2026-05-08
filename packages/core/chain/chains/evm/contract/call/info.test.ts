import { Interface } from 'ethers'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getEvmContractCallInfo } from './info'
import * as signaturesModule from './signatures'

const RECIPIENT = '0x1111111111111111111111111111111111111111'
const SPENDER = '0x2222222222222222222222222222222222222222'

describe('getEvmContractCallInfo', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('decodes a known selector offline without hitting the 4byte API', async () => {
    const fetchSpy = vi.spyOn(signaturesModule, 'getEvmContractCallSignatures')

    const iface = new Interface(['function approve(address,uint256)'])
    const calldata = iface.encodeFunctionData('approve', [SPENDER, 1234n])

    const info = await getEvmContractCallInfo(calldata)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(info).not.toBeNull()
    expect(info?.functionSignature).toBe('approve(address,uint256)')
    expect(info?.actionLabel).toBe('Token Approval')

    const decoded = JSON.parse(info!.functionArguments)
    expect(decoded[0].toLowerCase()).toBe(SPENDER.toLowerCase())
    expect(decoded[1]).toBe('1234')
  })

  it('falls back to the 4byte API for unknown selectors', async () => {
    // Random selector unlikely to exist in the static table
    const unknownSig = 'doSomething(address,uint256)'
    const iface = new Interface([`function ${unknownSig}`])
    const calldata = iface.encodeFunctionData('doSomething', [RECIPIENT, 42n])

    const fetchSpy = vi.spyOn(signaturesModule, 'getEvmContractCallSignatures').mockResolvedValue({
      count: 1,
      results: [{ text_signature: unknownSig }],
    })

    const info = await getEvmContractCallInfo(calldata)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(info?.functionSignature).toBe(unknownSig)
    expect(info?.actionLabel).toBeUndefined()
  })

  it('returns null when both offline and remote lookup fail', async () => {
    vi.spyOn(signaturesModule, 'getEvmContractCallSignatures').mockRejectedValue(new Error('network down'))

    // Use a calldata with an unknown selector
    const calldata = '0xdeadbeef'
    const info = await getEvmContractCallInfo(calldata)

    expect(info).toBeNull()
  })

  it('decodes a tuple-based V3 swap (exactInputSingle)', async () => {
    const fetchSpy = vi.spyOn(signaturesModule, 'getEvmContractCallSignatures')

    const sig = 'exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))'
    const iface = new Interface([`function ${sig}`])
    const tokenIn = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' // WETH
    const tokenOut = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' // USDC
    const calldata = iface.encodeFunctionData('exactInputSingle', [
      [tokenIn, tokenOut, 3000, RECIPIENT, 1_700_000_000n, 10n ** 18n, 1n, 0n],
    ])

    const info = await getEvmContractCallInfo(calldata)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(info?.functionSignature).toBe(sig)
    expect(info?.actionLabel).toBe('Token Swap')
  })

  it('disambiguates overloaded NFT safeTransferFrom selectors', async () => {
    const erc721 = '0x42842e0e' // safeTransferFrom(address,address,uint256)
    const erc721WithData = '0xb88d4fde' // safeTransferFrom(address,address,uint256,bytes)
    const erc1155 = '0xf242432a' // safeTransferFrom(address,address,uint256,uint256,bytes)

    const erc721Iface = new Interface(['function safeTransferFrom(address,address,uint256)'])
    const erc721Calldata = erc721Iface.encodeFunctionData('safeTransferFrom', [SPENDER, RECIPIENT, 42n])
    expect(erc721Calldata.slice(0, 10)).toBe(erc721)

    const erc1155Iface = new Interface(['function safeTransferFrom(address,address,uint256,uint256,bytes)'])
    const erc1155Calldata = erc1155Iface.encodeFunctionData('safeTransferFrom', [SPENDER, RECIPIENT, 1n, 5n, '0x'])
    expect(erc1155Calldata.slice(0, 10)).toBe(erc1155)

    const erc721WithDataIface = new Interface(['function safeTransferFrom(address,address,uint256,bytes)'])
    const erc721WithDataCalldata = erc721WithDataIface.encodeFunctionData('safeTransferFrom', [
      SPENDER,
      RECIPIENT,
      7n,
      '0xdead',
    ])
    expect(erc721WithDataCalldata.slice(0, 10)).toBe(erc721WithData)

    for (const calldata of [erc721Calldata, erc1155Calldata, erc721WithDataCalldata]) {
      const info = await getEvmContractCallInfo(calldata)
      expect(info?.actionLabel).toBe('NFT Transfer')
    }
  })

  it('decodes setApprovalForAll offline (NFT marketplace approval)', async () => {
    const fetchSpy = vi.spyOn(signaturesModule, 'getEvmContractCallSignatures')

    const iface = new Interface(['function setApprovalForAll(address,bool)'])
    const calldata = iface.encodeFunctionData('setApprovalForAll', [SPENDER, true])

    const info = await getEvmContractCallInfo(calldata)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(info?.functionSignature).toBe('setApprovalForAll(address,bool)')
    expect(info?.actionLabel).toBe('Token Approval')
  })

  it('decodes THORChain depositWithExpiry offline as Cross-Chain Swap', async () => {
    const fetchSpy = vi.spyOn(signaturesModule, 'getEvmContractCallSignatures')

    const sig = 'depositWithExpiry(address,address,uint256,string,uint256)'
    const iface = new Interface([`function ${sig}`])
    const vault = '0x3333333333333333333333333333333333333333'
    const asset = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' // WETH
    const memo = '=:BTC.BTC:bc1qxyz:0/1/0'
    const calldata = iface.encodeFunctionData('depositWithExpiry', [vault, asset, 10n ** 18n, memo, 1_700_000_000n])

    const info = await getEvmContractCallInfo(calldata)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(info?.functionSignature).toBe(sig)
    expect(info?.actionLabel).toBe('Cross-Chain Swap')
  })

  it('disambiguates Aave withdraw (3 args) from WETH withdraw (1 arg)', async () => {
    const aaveIface = new Interface(['function withdraw(address,uint256,address)'])
    const aaveCalldata = aaveIface.encodeFunctionData('withdraw', [
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
      1_000_000n,
      RECIPIENT,
    ])

    const wethIface = new Interface(['function withdraw(uint256)'])
    const wethCalldata = wethIface.encodeFunctionData('withdraw', [10n ** 18n])

    const aaveInfo = await getEvmContractCallInfo(aaveCalldata)
    const wethInfo = await getEvmContractCallInfo(wethCalldata)

    expect(aaveInfo?.actionLabel).toBe('Lending Withdraw')
    expect(wethInfo?.actionLabel).toBe('Unwrap WETH')
  })

  it('falls back to 4byte when a known selector has corrupt arguments', async () => {
    // Valid `transfer` selector but truncated argument data (only 1 byte after).
    const corrupt = '0xa9059cbb00'
    const fetchSpy = vi.spyOn(signaturesModule, 'getEvmContractCallSignatures').mockResolvedValue({
      count: 1,
      results: [{ text_signature: 'transfer(address,uint256)' }],
    })

    const info = await getEvmContractCallInfo(corrupt)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    // Both offline and remote decoders fail on the truncated args, so we expect
    // the call to ultimately return null rather than fabricated data.
    expect(info).toBeNull()
  })
})
