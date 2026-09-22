import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CommandContext } from '../core'
import { executeJoinSecure } from './vault-management'

vi.mock('../lib/output', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/output')>()),
  isJsonOutput: () => true,
  outputJson: vi.fn(),
  createSpinner: () => ({ text: '', succeed: vi.fn(), fail: vi.fn() }),
}))

describe('join secure derivation options', () => {
  beforeEach(() => vi.clearAllMocks())
  it.each([undefined, true, false])('preserves %s when forwarding both settings', async value => {
    const vault = { id: 'vault', name: 'test', on: vi.fn() }
    const joinSecureVault = vi.fn().mockResolvedValue({ vault, vaultId: 'vault' })
    const context = { sdk: { joinSecureVault }, setActiveVault: vi.fn() } as unknown as CommandContext
    await executeJoinSecure(context, {
      qrPayload: 'qr',
      mnemonic: 'mnemonic',
      devices: 3,
      usePhantomSolanaPath: value,
      useCosmosPathTerra: value,
    })
    expect(joinSecureVault).toHaveBeenCalledWith(
      'qr',
      expect.objectContaining({
        usePhantomSolanaPath: value,
        useCosmosPathTerra: value,
      })
    )
  })
})
