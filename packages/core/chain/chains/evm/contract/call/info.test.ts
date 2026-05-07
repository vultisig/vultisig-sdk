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
})
