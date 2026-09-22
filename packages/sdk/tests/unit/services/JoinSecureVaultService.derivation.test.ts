import { Chain } from '@vultisig/core-chain/Chain'
import { joinMpcSession } from '@vultisig/core-mpc/session/joinMpcSession'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SdkContext } from '../../../src/context/SdkContext'
import { MasterKeyDeriver } from '../../../src/seedphrase/MasterKeyDeriver'
import { SeedphraseValidator } from '../../../src/seedphrase/SeedphraseValidator'
import { JoinSecureVaultService } from '../../../src/services/JoinSecureVaultService'
import type { ParsedKeygenQR } from '../../../src/utils/parseKeygenQR'

vi.mock('@vultisig/core-mpc/session/joinMpcSession', () => ({ joinMpcSession: vi.fn() }))
vi.mock('../../../src/services/waitForRelayPeerCommittee', () => ({
  waitForRelayPeerCommittee: vi.fn(async () => ['a', 'b', 'c']),
}))
vi.mock('@vultisig/core-mpc/dkls/dkls', () => ({
  DKLS: class {
    async startKeyImportWithRetry() {
      return { publicKey: 'pk', keyshare: 'share', chaincode: 'cc' }
    }
  },
}))
vi.mock('@vultisig/core-mpc/schnorr/schnorrKeygen', () => ({
  Schnorr: class {
    async startKeyImportWithRetry() {
      return { publicKey: 'pk', keyshare: 'share', chaincode: 'cc' }
    }
  },
}))

const qr: ParsedKeygenQR = {
  sessionId: 'session',
  hexEncryptionKey: 'aa'.repeat(32),
  hexChainCode: 'bb'.repeat(32),
  initiatorPartyId: 'a',
  vaultName: 'test',
  chains: [Chain.Solana, Chain.Terra, Chain.TerraClassic],
  libType: 'KEYIMPORT',
  useVultisigRelay: true,
}
const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const context = { wasmProvider: {}, serverManager: { messageRelay: 'https://unused.invalid' } } as SdkContext

describe('join derivation propagation before chain import', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    vi.spyOn(SeedphraseValidator.prototype, 'validate').mockResolvedValue({ valid: true, wordCount: 12 })
    vi.spyOn(MasterKeyDeriver.prototype, 'deriveMasterKeys').mockResolvedValue({
      ecdsaPrivateKeyHex: 'a',
      eddsaPrivateKeyHex: 'b',
      chainCodeHex: 'c',
    })
    vi.spyOn(MasterKeyDeriver.prototype, 'deriveChainPrivateKeys').mockRejectedValue(new Error('derivation boundary'))
  })

  it.each([false, true])('forwards QR settings and legacy options for batching=%s', async tssBatching => {
    const service = new JoinSecureVaultService(context)
    for (const value of [true, false]) {
      const settings = { usePhantomSolanaPath: value, useCosmosPathTerra: value }
      await expect(service.join({ ...qr, tssBatching, ...settings }, { mnemonic, devices: 3 })).rejects.toThrow(
        'derivation boundary'
      )
      expect(MasterKeyDeriver.prototype.deriveChainPrivateKeys).toHaveBeenLastCalledWith(mnemonic, qr.chains, settings)
      await expect(service.join({ ...qr, tssBatching }, { mnemonic, devices: 3, ...settings })).rejects.toThrow(
        'derivation boundary'
      )
      expect(MasterKeyDeriver.prototype.deriveChainPrivateKeys).toHaveBeenLastCalledWith(mnemonic, qr.chains, settings)
    }
  })

  it.each(['usePhantomSolanaPath', 'useCosmosPathTerra'] as const)(
    'rejects conflicting %s before joining the relay',
    async key => {
      const service = new JoinSecureVaultService(context)
      await expect(service.join({ ...qr, [key]: false }, { mnemonic, devices: 3, [key]: true })).rejects.toThrow(
        'conflicts'
      )
      expect(joinMpcSession).not.toHaveBeenCalled()
      expect(SeedphraseValidator.prototype.validate).not.toHaveBeenCalled()
    }
  )
})
