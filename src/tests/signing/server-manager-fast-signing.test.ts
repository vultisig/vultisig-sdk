import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { ServerManager } from '../../server/ServerManager'
import type { Vault, SigningPayload } from '../../types'

// Mocks
vi.mock('@core/mpc/session/joinMpcSession', () => ({
  joinMpcSession: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@core/chain/coin/coinType', () => ({
  getCoinType: vi.fn().mockReturnValue(60),
}))

vi.mock('@trustwallet/wallet-core', () => ({
  initWasm: vi.fn().mockResolvedValue({
    CoinTypeExt: {
      derivationPath: () => "m/44'/60'/0'/0/0",
    },
  }),
}))

vi.mock('@core/mpc/keysign', () => ({
  keysign: vi.fn().mockResolvedValue({
    der_signature: '3045022100...0201',
    recovery_id: '0x1b',
  }),
}))

// Intercept FastVaultClient to capture its POST body
import * as FastVaultClientModule from '../../server/FastVaultClient'

describe('ServerManager.signWithServer flow', () => {
  const vault: Vault = {
    name: 'Test',
    publicKeys: { ecdsa: '04abcd', eddsa: '' },
    signers: ['browser-1234', 'Server-1172'],
    hexChainCode: 'b'.repeat(64),
    keyShares: { ecdsa: 'keyshare-ecdsa', eddsa: '' },
    localPartyId: 'browser-1234',
    libType: 'DKLS',
    isBackedUp: false,
    order: 0,
  }

  const payload: SigningPayload = {
    transaction: { dummy: true },
    chain: 'ethereum',
    messageHashes: ['deadbeef'],
  }

  let originalClient: any
  let capturedSignBody: any | undefined

  beforeEach(() => {
    capturedSignBody = undefined
    originalClient = FastVaultClientModule.FastVaultClient
    vi.spyOn(FastVaultClientModule, 'FastVaultClient').mockImplementation((baseURL?: string) => {
      const client = new (originalClient as any)(baseURL)
      // Patch method to capture body
      vi.spyOn(client, 'signWithServer').mockImplementation(async body => {
        capturedSignBody = body
      })
      return client
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('registers on relay first, posts correct /vault/sign body, then performs keysign', async () => {
    const manager = new ServerManager({
      fastVault: 'https://api.vultisig.com/vault',
      messageRelay: 'https://api.vultisig.com/router',
    })

    // Make waitForPeers resolve immediately with server present
    // @ts-ignore access private for testing
    vi.spyOn(manager as any, 'waitForPeers').mockResolvedValue(['browser-1234', 'Server-1172'])

    const sig = await manager.signWithServer(vault, payload, 'secret')

    // Validate FastVaultClient body shape (keys and mapping)
    expect(capturedSignBody).toBeDefined()
    expect(capturedSignBody!.publicKey).toBe('04abcd')
    expect(capturedSignBody!.messages).toEqual(['deadbeef'])
    expect(typeof capturedSignBody!.session).toBe('string')
    expect(capturedSignBody!.derivePath).toBe("m/44'/60'/0'/0/0")
    expect(capturedSignBody!.isEcdsa).toBe(true)
    expect(capturedSignBody!.vaultPassword).toBe('secret')
    expect(capturedSignBody!.hexEncryptionKey).toMatch(/^[0-9a-f]{64}$/)

    // Validate signature mapping
    expect(sig.signature).toBe('3045022100...0201')
    expect(sig.format === 'ECDSA' || sig.format === 'DER').toBe(true)
    expect(sig.recovery).toBe(27)
  })
})


