import { Chain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  prepareSeedphraseImportPrelude,
  type SeedphraseImportPreludeInput,
} from '@/seedphrase/prepareSeedphraseImportPrelude'

describe('prepareSeedphraseImportPrelude', () => {
  const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
  const progressLabels = {
    validating: { progress: 10, message: 'validating' },
    derivingKeys: { progress: 20, message: 'deriving' },
    discoveringChains: { progress: 30, message: 'discovering' },
  }

  const validator = { validate: vi.fn() }
  const keyDeriver = { deriveMasterKeys: vi.fn() }
  const discoveryService = { discoverChains: vi.fn() }
  const reportProgress = vi.fn()

  const input = (overrides: Partial<SeedphraseImportPreludeInput> = {}): SeedphraseImportPreludeInput =>
    ({
      mnemonic,
      validator,
      keyDeriver,
      discoveryService,
      reportProgress,
      progressLabels,
      ...overrides,
    }) as SeedphraseImportPreludeInput

  beforeEach(() => {
    vi.clearAllMocks()
    validator.validate.mockResolvedValue({ valid: true })
    keyDeriver.deriveMasterKeys.mockResolvedValue({
      ecdsaPrivateKeyHex: 'ecdsa',
      eddsaPrivateKeyHex: 'eddsa',
      chainCodeHex: '',
    })
    discoveryService.discoverChains.mockResolvedValue({
      results: [],
      usePhantomSolanaPath: false,
      useCosmosPathTerra: false,
    })
  })

  it('rejects explicitly selected chains that are disabled for seedphrase import before deriving master keys', async () => {
    await expect(prepareSeedphraseImportPrelude(input({ chains: [Chain.Bittensor] }))).rejects.toThrow(/Bittensor/)
    expect(keyDeriver.deriveMasterKeys).not.toHaveBeenCalled()
  })

  it('rejects unsupported funded discovery results before deriving master keys', async () => {
    discoveryService.discoverChains.mockResolvedValue({
      results: [
        {
          chain: Chain.Bittensor,
          address: '5fake',
          balance: '1',
          decimals: 9,
          symbol: 'TAO',
          hasBalance: true,
        },
      ],
      usePhantomSolanaPath: false,
      useCosmosPathTerra: false,
    })

    await expect(prepareSeedphraseImportPrelude(input({ discoverChains: true }))).rejects.toThrow(/Bittensor/)
    expect(keyDeriver.deriveMasterKeys).not.toHaveBeenCalled()
  })
})
