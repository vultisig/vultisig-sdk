import { readFileSync } from 'node:fs'

import type { ChainId } from '@lifi/sdk'
import { Chain } from '@vultisig/core-chain/Chain'
import { lifiSwapChainId } from '@vultisig/core-chain/swap/general/lifi/LifiSwapEnabledChains'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveSwapFeeChain } from './lifiSwapFeeChain'

describe('resolveSwapFeeChain', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('maps a known LI.FI fee-token chain id to its enabled Vultisig chain', () => {
    expect(resolveSwapFeeChain(lifiSwapChainId[Chain.Ethereum], Chain.Solana)).toBe(Chain.Ethereum)
  })

  it('falls back to the source chain and warns for an unknown intermediate-chain id', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const unknownChainId = Number.MAX_SAFE_INTEGER as ChainId

    expect(resolveSwapFeeChain(unknownChainId, Chain.Solana)).toBe(Chain.Solana)
    expect(warn).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith(
      `[getLifiSwapQuote] fee token chainId ${unknownChainId} not in lifiSwapChainId; falling back to ${Chain.Solana}`
    )
  })
})

describe('LI.FI quote fee-chain architecture', () => {
  const coreQuoteSource = readFileSync(new URL('./getLifiSwapQuote.ts', import.meta.url), 'utf8')
  const reactNativeQuoteSource = readFileSync(
    new URL('../../../../../../sdk/src/platforms/react-native/overrides/getLifiSwapQuote.ts', import.meta.url),
    'utf8'
  )

  it('keeps both quote paths on the shared canonical helper', () => {
    expect(coreQuoteSource).toContain("import { resolveSwapFeeChain } from './lifiSwapFeeChain'")
    expect(reactNativeQuoteSource).toContain(
      "import { resolveSwapFeeChain } from '@vultisig/core-chain/swap/general/lifi/api/lifiSwapFeeChain'"
    )

    for (const source of [coreQuoteSource, reactNativeQuoteSource]) {
      expect(source).not.toMatch(/(?:const|function)\s+resolveSwapFeeChain\b/)
    }
  })
})
