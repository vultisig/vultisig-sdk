import { Chain } from '@vultisig/core-chain/Chain'
import { getChainKind } from '@vultisig/core-chain/ChainKind'
import { assertSafeTokenTransferDestination } from '@vultisig/core-chain/security/tokenTransferGuards'
import { getNativeSwapDecimals } from '@vultisig/core-chain/swap/native/utils/getNativeSwapDecimals'
import { describe, expect, it } from 'vitest'

import { knownTokens, knownTokensIndex, usdc } from '.'
import { assertKnownToken, getKnownToken } from './utils'

const solanaUsdc = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

describe('chain-aware curated token lookup', () => {
  it('preserves every canonical entry and its enumeration', () => {
    for (const chain of Object.values(Chain)) {
      expect(Object.values(knownTokensIndex[chain])).toEqual(knownTokens[chain])
      for (const coin of knownTokens[chain]) {
        expect(getKnownToken({ chain, id: coin.id! })).toBe(coin)
      }
    }
  })

  it.each(['toString', 'valueOf', 'constructor', '__proto__'])('rejects inherited object name %s', id => {
    expect(knownTokensIndex[Chain.Solana][id]).toBeUndefined()
    expect(getKnownToken({ chain: Chain.Solana, id })).toBeUndefined()
  })

  it('retains EVM case-insensitivity and canonical metadata', () => {
    for (const id of [usdc.id, usdc.id.toLowerCase(), usdc.id.toUpperCase()]) {
      expect(getKnownToken({ chain: Chain.Ethereum, id })?.id).toBe(usdc.id)
    }
  })

  it('never aliases a case-mutated non-EVM identifier to another entry', () => {
    for (const chain of Object.values(Chain).filter(chain => getChainKind(chain) !== 'evm')) {
      for (const coin of knownTokens[chain]) {
        for (const id of [coin.id!.toLowerCase(), coin.id!.toUpperCase()]) {
          const exact = knownTokens[chain].find(candidate => candidate.id === id)
          expect(getKnownToken({ chain, id })).toBe(exact)
          expect(knownTokensIndex[chain][id]).toBe(exact)
        }
      }
    }
  })

  it('asserts only canonical Solana identifiers', () => {
    expect(assertKnownToken({ chain: Chain.Solana, id: solanaUsdc }).ticker).toBe('USDC')
    expect(() => assertKnownToken({ chain: Chain.Solana, id: solanaUsdc.toLowerCase() })).toThrow()
  })

  it('retains non-EVM token destination guards without case false hits', () => {
    expect(() => assertSafeTokenTransferDestination(Chain.Solana, solanaUsdc, solanaUsdc)).toThrow('permanently burn')
    expect(() => assertSafeTokenTransferDestination(Chain.Solana, solanaUsdc.toLowerCase(), solanaUsdc)).not.toThrow()
  })

  it('preserves native and canonical MayaChain precision with the unknown-token default', () => {
    expect(getNativeSwapDecimals({ chain: Chain.MayaChain })).toBe(10)
    for (const id of ['maya', 'aztec']) {
      expect(getNativeSwapDecimals({ chain: Chain.MayaChain, id })).toBe(4)
      expect(getNativeSwapDecimals({ chain: Chain.MayaChain, id: id.toUpperCase() })).toBe(8)
    }
  })
})
