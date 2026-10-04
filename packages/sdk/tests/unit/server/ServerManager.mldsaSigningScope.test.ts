/**
 * Keeps ML-DSA signing scoped to ML-DSA chains: a vault that holds an ML-DSA key
 * share must not open an ML-DSA session — or return an ML-DSA signature — when the
 * caller asked for an ECDSA/EdDSA sign.
 */
import { Chain } from '@vultisig/core-chain/Chain'
import { signWithServer } from '@vultisig/core-mpc/fast/api/signWithServer'
import { keysign } from '@vultisig/core-mpc/keysign'
import { MldsaKeysign } from '@vultisig/core-mpc/mldsa/mldsaKeysign'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getChainSigningInfo } from '../../../src/adapters/getChainSigningInfo'
import { ServerManager } from '../../../src/server/ServerManager'

vi.mock('@vultisig/core-mpc/devices/localPartyId', () => ({
  generateLocalPartyId: vi.fn((prefix: string) => `${prefix}-test-id`),
}))

vi.mock('@vultisig/core-mpc/fast/api/signWithServer', () => ({
  signWithServer: vi.fn(async () => undefined),
}))

vi.mock('@vultisig/core-mpc/fast/api/mldsaWithServer', () => ({
  mldsaWithServer: vi.fn(async () => undefined),
}))

vi.mock('@vultisig/core-mpc/session/joinMpcSession', () => ({
  joinMpcSession: vi.fn(async () => undefined),
}))

vi.mock('@vultisig/core-mpc/session/startMpcSession', () => ({
  startMpcSessionWithRetry: vi.fn(async () => undefined),
}))

vi.mock('@vultisig/core-mpc/keysign', () => ({
  keysign: vi.fn(),
}))

vi.mock('@vultisig/core-mpc/mldsa/mldsaKeysign', () => ({
  MldsaKeysign: vi.fn(),
}))

vi.mock('@vultisig/core-mpc/mldsa/mldsaKeygen', () => ({
  MldsaKeygen: vi.fn(),
}))

vi.mock('@vultisig/core-mpc/dkls/dkls', () => ({
  DKLS: vi.fn(),
}))

vi.mock('@vultisig/core-mpc/schnorr/schnorrKeygen', () => ({
  Schnorr: vi.fn(),
}))

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: vi.fn(async () => ['sdk-party', 'server-party']),
}))

vi.mock('@vultisig/lib-utils/crypto/getHexEncodedRandomBytes', () => ({
  getHexEncodedRandomBytes: vi.fn(() => '00'.repeat(32)),
}))

vi.mock('../../../src/crypto', () => ({
  randomUUID: vi.fn(() => 'fast-session-id'),
}))

vi.mock('../../../src/adapters/getChainSigningInfo', () => ({
  getChainSigningInfo: vi.fn(),
}))

const messageHash = 'cd'.repeat(32)

const mldsaCapableVault = {
  localPartyId: 'sdk-party',
  keyShares: { ecdsa: 'ecdsa-share', eddsa: 'eddsa-share' },
  keyShareMldsa: 'mldsa-key-share',
  publicKeys: { ecdsa: 'ecdsa-public-key', eddsa: 'eddsa-public-key' },
  signers: ['sdk-party', 'server-party'],
}

const walletCore = {} as never

describe('ServerManager fast signing on an ML-DSA-capable vault', () => {
  let manager: ServerManager

  beforeEach(() => {
    vi.clearAllMocks()
    manager = new ServerManager({ messageRelay: 'https://relay.test', fastVault: 'https://vault.test' })

    vi.mocked(getChainSigningInfo).mockReturnValue({
      signatureAlgorithm: 'ecdsa',
      derivePath: "m/44'/60'/0'/0/0",
      chainPath: 'm/44/60/0/0/0',
    })
    vi.mocked(keysign).mockResolvedValue({
      msg: messageHash,
      r: '11'.repeat(32),
      s: '22'.repeat(32),
      der_signature: 'der-signature',
      recovery_id: '1',
    } as never)
    vi.mocked(MldsaKeysign).mockImplementation(function () {
      throw new Error('MldsaKeysign must not be constructed for a non-MLDSA sign')
    } as unknown as typeof MldsaKeysign)
  })

  const signWith = (chain: Chain) =>
    manager.coordinateFastSigning({
      vault: mldsaCapableVault as never,
      messages: [messageHash],
      password: 'vault-password',
      payload: { chain } as never,
      walletCore,
    })

  it('never opens an ML-DSA session for an ECDSA transaction', async () => {
    const signature = await signWith(Chain.Ethereum)

    expect(MldsaKeysign).not.toHaveBeenCalled()
    expect(signature.mldsaSignature).toBeUndefined()
    expect(signature.format).toBe('ECDSA')
    expect(vi.mocked(signWithServer).mock.calls[0][0]).toMatchObject({ is_ecdsa: true })
  })

  it('never opens an ML-DSA session for an EdDSA transaction', async () => {
    vi.mocked(getChainSigningInfo).mockReturnValue({
      signatureAlgorithm: 'eddsa',
      derivePath: "m/44'/501'/0'/0'",
      chainPath: 'm/44/501/0/0',
    })

    const signature = await signWith(Chain.Solana)

    expect(MldsaKeysign).not.toHaveBeenCalled()
    expect(signature.mldsaSignature).toBeUndefined()
    expect(signature.format).toBe('EdDSA')
  })
})
