/**
 * unlock() must verify the password against the vault file even when key shares
 * are already in memory, and must never replace a good cached password with a bad one (#2474).
 */
import { Vault as CoreVault } from '@vultisig/core-mpc/vault/Vault'
import { describe, expect, it } from 'vitest'

import { PasswordCacheService } from '../../../src/services/PasswordCacheService'
import { createVaultBackup } from '../../../src/utils/export'
import { FastVault } from '../../../src/vault/FastVault'
import { SecureVault } from '../../../src/vault/SecureVault'
import { VaultError } from '../../../src/vault/VaultError'

const vaultId = 'test-vault'
const correctPassword = 'correct-password'
const wrongPassword = 'wrong-password'

const coreVault: CoreVault = {
  name: 'TestVault',
  localPartyId: 'device-1',
  signers: ['device-1', 'Server-1'],
  publicKeys: { ecdsa: 'ecdsa-pub', eddsa: 'eddsa-pub' },
  hexChainCode: 'chain-code',
  keyShares: { ecdsa: 'ecdsa-share', eddsa: 'eddsa-share' },
  libType: 'DKLS',
  isBackedUp: true,
  order: 0,
}

const vultFileContent = await createVaultBackup(coreVault, correctPassword)

type VaultClass = typeof FastVault | typeof SecureVault

const makeVault = ({ VaultClass, sharesLoaded }: { VaultClass: VaultClass; sharesLoaded: boolean }) => {
  const passwordCache = new PasswordCacheService()
  const vault = Object.assign(Object.create(VaultClass.prototype), {
    passwordCache,
    vaultData: { id: vaultId, name: 'TestVault', isEncrypted: true, vultFileContent },
    coreVault: {
      ...coreVault,
      keyShares: sharesLoaded ? coreVault.keyShares : { ecdsa: '', eddsa: '' },
    },
    emit: () => {},
  })
  return { vault: vault as FastVault, passwordCache }
}

describe.each([
  ['FastVault', FastVault],
  ['SecureVault', SecureVault],
] as const)('%s.unlock()', (_, VaultClass) => {
  describe.each([true, false])('with key shares loaded: %s', sharesLoaded => {
    it('accepts and caches the correct password', async () => {
      const { vault, passwordCache } = makeVault({ VaultClass, sharesLoaded })
      await vault.unlock(correctPassword)
      expect(passwordCache.get(vaultId)).toBe(correctPassword)
    })

    it('rejects a wrong password without caching it', async () => {
      const { vault, passwordCache } = makeVault({ VaultClass, sharesLoaded })
      await expect(vault.unlock(wrongPassword)).rejects.toBeInstanceOf(VaultError)
      expect(passwordCache.get(vaultId)).toBeUndefined()
    })

    it('keeps a previously cached password when a wrong one is given', async () => {
      const { vault, passwordCache } = makeVault({ VaultClass, sharesLoaded })
      passwordCache.set(vaultId, correctPassword)
      await expect(vault.unlock(wrongPassword)).rejects.toBeInstanceOf(VaultError)
      expect(passwordCache.get(vaultId)).toBe(correctPassword)
    })
  })
})
