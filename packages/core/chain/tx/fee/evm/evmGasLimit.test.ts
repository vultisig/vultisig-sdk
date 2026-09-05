import { EvmChain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { deriveEvmGasLimit, getEvmContractCallGasLimit, getEvmTransferGasLimit } from './evmGasLimit'

const token = '0x3333333333333333333333333333333333333333'

describe('getEvmTransferGasLimit', () => {
  it.each([
    ['Ethereum', EvmChain.Ethereum, 23_000n],
    ['Base', EvmChain.Base, 50_000n],
    ['Blast', EvmChain.Blast, 200_000n],
    ['Mantle', EvmChain.Mantle, 23_000n],
    ['Zksync', EvmChain.Zksync, 200_000n],
  ])('floors a %s fee-coin transfer', (_label, chain, expected) => {
    expect(getEvmTransferGasLimit({ chain })).toBe(expected)
  })

  it.each([
    ['Ethereum', EvmChain.Ethereum, 120_000n],
    ['Base', EvmChain.Base, 150_000n],
    ['Blast', EvmChain.Blast, 200_000n],
    ['Mantle', EvmChain.Mantle, 120_000n],
  ])('floors a %s token transfer', (_label, chain, expected) => {
    expect(getEvmTransferGasLimit({ chain, id: token })).toBe(expected)
  })
})

describe('getEvmContractCallGasLimit', () => {
  it('falls back to 600k on every chain but Mantle', () => {
    expect(getEvmContractCallGasLimit(EvmChain.Ethereum)).toBe(600_000n)
    expect(getEvmContractCallGasLimit(EvmChain.Mantle)).toBe(3_000_000_000n)
  })
})

describe('deriveEvmGasLimit', () => {
  it('uses the contract-call fallback for calldata and the transfer floor otherwise', () => {
    const coin = { chain: EvmChain.Ethereum }

    expect(deriveEvmGasLimit({ coin, data: '0xabcdef' })).toBe(600_000n)
    expect(deriveEvmGasLimit({ coin })).toBe(23_000n)
    expect(deriveEvmGasLimit({ coin: { ...coin, id: token } })).toBe(120_000n)
  })
})
