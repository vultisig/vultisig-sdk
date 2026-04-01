/**
 * Wires FastVault batching flags to the correct VultiServer entrypoints and payloads.
 */
import type { MockInstance } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as sdkCrypto from '../../../src/crypto'
import { ServerManager } from '../../../src/server/ServerManager'

const keygenResult = {
  publicKey: '0xecdsa',
  keyshare: 'ecdsa-share',
  chaincode: '0xcc',
}

const eddsaResult = {
  publicKey: '0xeddsa',
  keyshare: 'eddsa-share',
  chaincode: '0xedcc',
}

const mldsaResult = {
  publicKey: '0xmldsa',
  keyshare: 'mldsa-share',
}

const { setupVaultWithServerMock, createVaultWithServerMock } = vi.hoisted(() => ({
  setupVaultWithServerMock: vi.fn(async () => undefined),
  createVaultWithServerMock: vi.fn(async () => undefined),
}))

const { batchReshareMock, reshareWithServerMock } = vi.hoisted(() => ({
  batchReshareMock: vi.fn(async () => undefined),
  reshareWithServerMock: vi.fn(async () => undefined),
}))

vi.mock('@vultisig/core-mpc/fast/api/setupVaultWithServer', () => ({
  setupVaultWithServer: (...args: unknown[]) => setupVaultWithServerMock(...args),
}))

vi.mock('@vultisig/core-mpc/fast/api/createVaultWithServer', () => ({
  createVaultWithServer: (...args: unknown[]) => createVaultWithServerMock(...args),
}))

vi.mock('@vultisig/core-mpc/fast/api/batchReshareWithServer', () => ({
  batchReshareWithServer: (...args: unknown[]) => batchReshareMock(...args),
}))

vi.mock('@vultisig/core-mpc/fast/api/reshareWithServer', () => ({
  reshareWithServer: (...args: unknown[]) => reshareWithServerMock(...args),
}))

vi.mock('@vultisig/core-mpc/fast/api/mldsaWithServer', () => ({
  mldsaWithServer: vi.fn(async () => undefined),
}))

vi.mock('@vultisig/core-mpc/devices/localPartyId', () => ({
  generateLocalPartyId: vi.fn((prefix: string) => `${prefix}-test-id`),
}))

vi.mock('@vultisig/core-mpc/utils/generateHexEncryptionKey', () => ({
  generateHexEncryptionKey: vi.fn(() => '00'.repeat(32)),
}))

vi.mock('@vultisig/core-mpc/utils/generateHexChainCode', () => ({
  generateHexChainCode: vi.fn(() => '11'.repeat(32)),
}))

vi.mock('@vultisig/core-mpc/dkls/dkls', () => ({
  DKLS: vi.fn().mockImplementation(() => ({
    prepareKeygenSetup: vi.fn().mockResolvedValue(undefined),
    getSetupMessage: vi.fn(() => new Uint8Array([1, 2])),
    startKeygenWithRetry: vi.fn().mockResolvedValue(keygenResult),
  })),
}))

vi.mock('@vultisig/core-mpc/schnorr/schnorrKeygen', () => ({
  Schnorr: vi.fn().mockImplementation(() => ({
    startKeygenWithRetry: vi.fn().mockResolvedValue(eddsaResult),
  })),
}))

vi.mock('@vultisig/core-mpc/mldsa/mldsaKeygen', () => ({
  MldsaKeygen: vi.fn().mockImplementation(() => ({
    startKeygenWithRetry: vi.fn().mockResolvedValue(mldsaResult),
  })),
}))

const queryUrlMock = vi.hoisted(() =>
  vi.fn(
    async (
      url: string | URL,
      options?: { body?: unknown; responseType?: string; method?: string }
    ): Promise<unknown> => {
      const u = String(url)
      const hasBody = options?.body !== undefined && options?.body !== null
      const method = options?.method ?? (hasBody ? 'POST' : 'GET')

      if (u.includes('/complete/') && method === 'GET') {
        return ['server-test-id']
      }
      if (method === 'GET' && u.includes('relay.test') && !u.includes('/start/') && !u.includes('/complete/')) {
        return ['sdk-test-id', 'server-test-id']
      }
      if (options?.responseType === 'none') {
        return undefined
      }
      return undefined
    }
  )
)

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: (...args: unknown[]) => queryUrlMock(...args),
}))

describe('ServerManager — TSS batching wiring', () => {
  const relay = 'http://relay.test'
  const fastVault = 'http://fastvault.test/vault'
  let randomUuidSpy: MockInstance<() => string>

  beforeEach(() => {
    vi.clearAllMocks()
    randomUuidSpy = vi.spyOn(sdkCrypto, 'randomUUID').mockReturnValue('fixed-session')
  })

  afterEach(() => {
    randomUuidSpy.mockRestore()
  })

  describe('createFastVault', () => {
    it('calls setupVaultWithServer when tssBatching is true', async () => {
      const mgr = new ServerManager({ messageRelay: relay, fastVault })
      await mgr.createFastVault({
        name: 'Vault',
        email: 'a@b.c',
        password: 'pw',
        tssBatching: true,
      })

      expect(setupVaultWithServerMock).toHaveBeenCalledTimes(1)
      expect(createVaultWithServerMock).not.toHaveBeenCalled()

      const arg = setupVaultWithServerMock.mock.calls[0][0] as {
        vaultBaseUrl: string
        protocols: string[]
      }
      expect(arg.vaultBaseUrl).toBe(fastVault)
      expect(arg.protocols).toEqual(['ecdsa', 'eddsa'])
    })

    it('calls createVaultWithServer when tssBatching is false or omitted', async () => {
      const mgr = new ServerManager({ messageRelay: relay, fastVault })

      await mgr.createFastVault({
        name: 'Vault',
        email: 'a@b.c',
        password: 'pw',
        tssBatching: false,
      })
      expect(createVaultWithServerMock).toHaveBeenCalledTimes(1)
      expect(setupVaultWithServerMock).not.toHaveBeenCalled()

      vi.clearAllMocks()
      await mgr.createFastVault({
        name: 'Vault2',
        email: 'a@b.c',
        password: 'pw',
      })
      expect(createVaultWithServerMock).toHaveBeenCalledTimes(1)
      expect(setupVaultWithServerMock).not.toHaveBeenCalled()
    })
  })

  describe('reshareVault', () => {
    const minimalVault = {
      name: 'V',
      publicKeys: { ecdsa: '0xpk', eddsa: '0xed' },
      localPartyId: 'lp',
      signers: ['a', 'b'],
      hexChainCode: '0xhcc',
      keyShares: { ecdsa: 'ks', eddsa: 'ks2' },
      libType: 'DKLS' as const,
      isBackedUp: true,
      order: 0,
      createdAt: 0,
    }

    it('calls batchReshareWithServer when tssBatching is true', async () => {
      const mgr = new ServerManager({ fastVault })
      await mgr.reshareVault(minimalVault as never, {
        password: 'pw',
        email: 'e@e.e',
        tssBatching: true,
      })

      expect(batchReshareMock).toHaveBeenCalledTimes(1)
      expect(reshareWithServerMock).not.toHaveBeenCalled()
      const body = batchReshareMock.mock.calls[0][0] as {
        vaultBaseUrl: string
        protocols: string[]
        hex_chain_code: string
      }
      expect(body.vaultBaseUrl).toBe(fastVault)
      expect(body.protocols).toEqual(['ecdsa', 'eddsa'])
      expect(body.hex_chain_code).toBe('0xhcc')
    })

    it('calls reshareWithServer when tssBatching is false or omitted', async () => {
      const mgr = new ServerManager({ fastVault })

      await mgr.reshareVault(minimalVault as never, { password: 'pw', tssBatching: false })
      expect(reshareWithServerMock).toHaveBeenCalledTimes(1)
      expect(batchReshareMock).not.toHaveBeenCalled()
      expect(
        (reshareWithServerMock.mock.calls[0][0] as { vaultBaseUrl: string }).vaultBaseUrl
      ).toBe(fastVault)

      vi.clearAllMocks()
      await mgr.reshareVault(minimalVault as never, { password: 'pw' })
      expect(reshareWithServerMock).toHaveBeenCalledTimes(1)
      expect(batchReshareMock).not.toHaveBeenCalled()
      expect(
        (reshareWithServerMock.mock.calls[0][0] as { vaultBaseUrl: string }).vaultBaseUrl
      ).toBe(fastVault)
    })
  })
})
