import { Chain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CacheService } from '@/services/CacheService'
import { MemoryStorage } from '@/storage/MemoryStorage'
import { AddressService } from '@/vault/services/AddressService'
import { VaultErrorCode } from '@/vault/VaultError'

const { mockDeriveAddress, mockDeriveQbtc, mockGetPublicKey } = vi.hoisted(() => ({
  mockGetPublicKey: vi.fn(),
  mockDeriveAddress: vi.fn(),
  mockDeriveQbtc: vi.fn(),
}))

vi.mock('@vultisig/core-chain/publicKey/getPublicKey', () => ({
  getPublicKey: mockGetPublicKey,
}))
vi.mock('@vultisig/core-chain/publicKey/address/deriveAddress', () => ({
  deriveAddress: mockDeriveAddress,
}))
vi.mock('@vultisig/core-chain/publicKey/address/deriveQbtcAddress', () => ({
  deriveQbtcAddress: mockDeriveQbtc,
}))

describe('AddressService', () => {
  const walletCore = { __wc: true }
  let cache: CacheService
  let storage: MemoryStorage

  const baseVault = {
    publicKeys: { ecdsa: '02abc', eddsa: 'ed' },
    hexChainCode: 'deadbeef',
    chainPublicKeys: [],
    publicKeyMldsa: undefined as string | undefined,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    storage = new MemoryStorage()
    cache = new CacheService(storage, 'vault-1', {})
    mockGetPublicKey.mockReturnValue({ pk: true })
    mockDeriveAddress.mockReturnValue('0xderived')
    mockDeriveQbtc.mockReturnValue('qbtc1addr')
  })

  const wasmProvider = {
    getWalletCore: vi.fn().mockResolvedValue(walletCore),
  }

  it('getAddress derives via WASM path and caches', async () => {
    const service = new AddressService(baseVault as never, cache, wasmProvider)

    await expect(service.getAddress(Chain.Ethereum)).resolves.toBe('0xderived')
    await expect(service.getAddress(Chain.Ethereum)).resolves.toBe('0xderived')

    expect(mockGetPublicKey).toHaveBeenCalledTimes(1)
    expect(mockDeriveAddress).toHaveBeenCalledTimes(1)
    expect(wasmProvider.getWalletCore).toHaveBeenCalledTimes(1)
  })

  it('getAddress uses deriveQbtcAddress when chain is QBTC', async () => {
    const service = new AddressService({ ...baseVault, publicKeyMldsa: 'mldsa-pub' } as never, cache, wasmProvider)

    await expect(service.getAddress(Chain.QBTC)).resolves.toBe('qbtc1addr')
    expect(mockDeriveQbtc).toHaveBeenCalledWith('mldsa-pub')
    expect(mockGetPublicKey).not.toHaveBeenCalled()
  })

  it('getAddress throws VaultError when QBTC vault lacks MLDSA key', async () => {
    const service = new AddressService(baseVault as never, cache, wasmProvider)

    await expect(service.getAddress(Chain.QBTC)).rejects.toMatchObject({
      code: VaultErrorCode.AddressDerivationFailed,
    })
  })

  it('getAddress wraps derivation failures in VaultError', async () => {
    mockDeriveAddress.mockImplementation(() => {
      throw new Error('boom')
    })
    const service = new AddressService(baseVault as never, cache, wasmProvider)

    await expect(service.getAddress(Chain.Polygon)).rejects.toMatchObject({
      code: VaultErrorCode.AddressDerivationFailed,
      message: expect.stringContaining('Polygon'),
    })
  })

  it('getAddresses returns empty object when chains omitted or empty', async () => {
    const service = new AddressService(baseVault as never, cache, wasmProvider)
    await expect(service.getAddresses()).resolves.toEqual({})
    await expect(service.getAddresses([])).resolves.toEqual({})
  })

  it('getAddresses skips chains that fail derivation', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockDeriveAddress.mockImplementation(() => {
      throw new Error('fail')
    })
    const service = new AddressService(baseVault as never, cache, wasmProvider)

    const out = await service.getAddresses([Chain.Ethereum, Chain.Bitcoin])
    expect(out).toEqual({})
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('getAddresses merges successful chains', async () => {
    const service = new AddressService(baseVault as never, cache, wasmProvider)
    const out = await service.getAddresses([Chain.Ethereum, Chain.Bitcoin])
    expect(out.Ethereum).toBe('0xderived')
    expect(out.Bitcoin).toBe('0xderived')
  })

  // TON is the one chain with two wallet contracts per key. The vault acts on
  // one selected account; a per-call version only previews the other.
  describe('AddressService — TON wallet contract selection', () => {
    const tonVersionOf = (call: number) => mockDeriveAddress.mock.calls[call]?.[0]?.tonWalletVersion

    it('derives V4R2 by default, the account every existing vault uses', async () => {
      const service = new AddressService(baseVault as never, cache, wasmProvider)

      await service.getAddress(Chain.Ton)

      expect(service.getTonWalletVersion()).toBe('v4r2')
      expect(tonVersionOf(0)).toBe('v4r2')
    })

    it('moves every un-versioned lookup to W5 once selected, and caches each account separately', async () => {
      mockDeriveAddress.mockImplementation(({ tonWalletVersion }) => `ton-${tonWalletVersion}`)
      const service = new AddressService(baseVault as never, cache, wasmProvider)

      await expect(service.getAddress(Chain.Ton)).resolves.toBe('ton-v4r2')
      service.setTonWalletVersion('v5r1')
      await expect(service.getAddress(Chain.Ton)).resolves.toBe('ton-v5r1')
      service.setTonWalletVersion('v4r2')
      await expect(service.getAddress(Chain.Ton)).resolves.toBe('ton-v4r2')

      // Two derivations, one per contract; switching back served the cache.
      expect(mockDeriveAddress).toHaveBeenCalledTimes(2)
    })

    it('lets a single lookup preview the other account without changing the selection', async () => {
      mockDeriveAddress.mockImplementation(({ tonWalletVersion }) => `ton-${tonWalletVersion}`)
      const service = new AddressService(baseVault as never, cache, wasmProvider)

      await expect(service.getAddress(Chain.Ton, { tonWalletVersion: 'v5r1' })).resolves.toBe('ton-v5r1')
      expect(service.getTonWalletVersion()).toBe('v4r2')
      await expect(service.getAddress(Chain.Ton)).resolves.toBe('ton-v4r2')
    })

    it('never passes a TON wallet version for another chain', async () => {
      const service = new AddressService(baseVault as never, cache, wasmProvider)
      service.setTonWalletVersion('v5r1')

      await service.getAddress(Chain.Ethereum)

      expect(tonVersionOf(0)).toBeUndefined()
    })
  })
})
