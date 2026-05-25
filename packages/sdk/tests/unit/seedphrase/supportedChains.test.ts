import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import {
  assertSeedphraseImportSupportsChains,
  getUnsupportedSeedphraseImportChains,
  isSeedphraseImportSupportedChain,
  SEEDPHRASE_IMPORT_SUPPORTED_CHAINS,
  SEEDPHRASE_IMPORT_UNSUPPORTED_CHAINS,
} from '@/constants'

describe('seedphrase import chain support', () => {
  it('excludes chains that cannot be imported and signed end-to-end', () => {
    expect(SEEDPHRASE_IMPORT_UNSUPPORTED_CHAINS).toEqual([Chain.Cardano, Chain.QBTC, Chain.Bittensor])
    expect(SEEDPHRASE_IMPORT_SUPPORTED_CHAINS).toContain(Chain.Ethereum)
    expect(SEEDPHRASE_IMPORT_SUPPORTED_CHAINS).toContain(Chain.Solana)
    expect(SEEDPHRASE_IMPORT_SUPPORTED_CHAINS).not.toContain(Chain.Bittensor)
  })

  it('reports unsupported chains from arbitrary import requests', () => {
    expect(isSeedphraseImportSupportedChain(Chain.Bittensor)).toBe(false)
    expect(getUnsupportedSeedphraseImportChains([Chain.Ethereum, Chain.Bittensor])).toEqual([Chain.Bittensor])
    expect(() => assertSeedphraseImportSupportsChains([Chain.Bittensor])).toThrow(/Bittensor/)
  })
})
