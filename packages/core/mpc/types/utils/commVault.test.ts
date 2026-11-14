import { Chain } from '@vultisig/core-chain/Chain'
import { Vault } from '@vultisig/core-mpc/vault/Vault'
import { describe, expect, it } from 'vitest'

import { fromCommVault, toCommVault } from './commVault'

const baseVault = (overrides: Partial<Vault>): Vault => ({
  name: 'test',
  publicKeys: { ecdsa: 'root-ecdsa', eddsa: 'root-eddsa' },
  signers: ['sdk-1', 'Server-1'],
  hexChainCode: '00',
  keyShares: { ecdsa: 'ks-root-ecdsa', eddsa: 'ks-root-eddsa' },
  localPartyId: 'sdk-1',
  libType: 'KeyImport',
  isBackedUp: false,
  order: 0,
  ...overrides,
})

describe('commVault key-import chain keyshares', () => {
  it('keeps a distinct keyshare per chain when chains share a public key', () => {
    const vault = baseVault({
      chainPublicKeys: {
        [Chain.Arbitrum]: 'evm',
        [Chain.Bitcoin]: 'btc',
        [Chain.BSC]: 'evm',
        [Chain.Ethereum]: 'evm',
      },
      chainKeyShares: {
        [Chain.Arbitrum]: 'ks-arbitrum',
        [Chain.Bitcoin]: 'ks-bitcoin',
        [Chain.BSC]: 'ks-bsc',
        [Chain.Ethereum]: 'ks-ethereum',
      },
    })

    const restored = fromCommVault(toCommVault(vault))

    expect(restored.chainKeyShares).toEqual(vault.chainKeyShares)
    expect(restored.keyShares).toEqual(vault.keyShares)
  })

  it('skips the root keyshare when a chain key equals the root key', () => {
    const vault = baseVault({
      publicKeys: { ecdsa: 'k', eddsa: 'root-eddsa' },
      keyShares: { ecdsa: 'ks-root', eddsa: 'ks-root-eddsa' },
      chainPublicKeys: { [Chain.Ethereum]: 'k' },
      chainKeyShares: { [Chain.Ethereum]: 'ks-ethereum' },
    })

    const restored = fromCommVault(toCommVault(vault))

    expect(restored.keyShares.ecdsa).toBe('ks-root')
    expect(restored.chainKeyShares?.[Chain.Ethereum]).toBe('ks-ethereum')
  })

  it('gives every chain on a key the single keyshare a backup stores for it', () => {
    const comm = toCommVault(
      baseVault({
        chainPublicKeys: { [Chain.Ethereum]: 'evm' },
        chainKeyShares: { [Chain.Ethereum]: 'ks-evm' },
      })
    )
    comm.chainPublicKeys.push({ ...comm.chainPublicKeys[0], chain: Chain.BSC })

    const restored = fromCommVault(comm)

    expect(restored.chainKeyShares).toEqual({ [Chain.Ethereum]: 'ks-evm', [Chain.BSC]: 'ks-evm' })
  })
})
