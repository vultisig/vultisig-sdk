import { Chain } from '@vultisig/core-chain/Chain'
import { TypedDataEncoder } from 'ethers'
import { recoverAddress } from 'viem'
import { privateKeyToAddress, sign } from 'viem/accounts'
import { describe, expect, it, vi } from 'vitest'

import { PasswordCacheService } from '../../../src/services/PasswordCacheService'
import { createVaultBackup } from '../../../src/utils/export'
import { FastVault } from '../../../src/vault/FastVault'
import { VaultBase } from '../../../src/vault/VaultBase'

const key = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
const address = privateKeyToAddress(key)
const order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
const types = {
  Note: [{ name: 'contents', type: 'Item[]' }],
  Item: [{ name: 'text', type: 'string' }],
}
const message = { contents: [{ text: 'SDK harmless signing test' }] }
const payload = { domain: {}, types, primaryType: 'Note', message }

function vaultFixture() {
  const vault = {
    name: 'typed-data-test',
    id: 'typed-data-fixture',
    isEncrypted: false,
    passwordCache: { set: vi.fn() },
    unlock: vi.fn().mockResolvedValue(undefined),
    address: vi.fn().mockResolvedValue(address),
    signBytes: vi.fn(async ({ data }: { data: string }, _options?: { signal?: AbortSignal }) => {
      const sig = await sign({ hash: data as `0x${string}`, privateKey: key })
      return { signature: sig.r.slice(2) + sig.s.slice(2), recovery: sig.yParity }
    }),
  }
  const signTypedData = (
    typedData: Record<string, unknown> = payload,
    options?: { signal?: AbortSignal },
    password?: string
  ) =>
    VaultBase.prototype.signTypedData.call(
      vault as unknown as VaultBase,
      { chain: Chain.Ethereum, typedData, password },
      options
    )
  return { vault, signTypedData }
}

function derInteger(hex: string): string {
  let value = hex.replace(/^(00)+/, '') || '00'
  if (parseInt(value.slice(0, 2), 16) >= 128) value = '00' + value
  return '02' + (value.length / 2).toString(16).padStart(2, '0') + value
}

describe('VaultBase.signTypedData', () => {
  it.each([
    {},
    { name: 'Harmless note', version: '1', chainId: '1' },
    { name: 'Salted', salt: '0x' + 'ab'.repeat(32) },
    { chainId: '9007199254740993' },
    { chainId: '0x20000000000001' },
  ])('hashes nested data and domain %j without losing precision', async domain => {
    const { vault, signTypedData } = vaultFixture()
    const signed = await signTypedData({ ...payload, domain, types: { ...types, EIP712Domain: [] } })
    expect(signed.hash).toBe(TypedDataEncoder.hash(domain, types, message))
    expect(signed.signature).toMatch(/^0x[0-9a-f]{130}$/)
    expect(BigInt(signed.s)).toBeLessThanOrEqual(order / 2n)
    expect(signed.v).toBe(signed.recovery + 27)
    expect(
      await recoverAddress({ hash: signed.hash as `0x${string}`, signature: signed.signature as `0x${string}` })
    ).toBe(address)
    expect(vault.signBytes).toHaveBeenCalledWith({ chain: Chain.Ethereum, data: signed.hash }, undefined)
    expect(signed.chain).toBe(Chain.Ethereum)
  })

  it.each(['raw', 'der'])('folds high-S %s signatures and verifies both recovery parities', async format => {
    const observed = new Set<number>()
    for (let i = 0; i < 32 && observed.size < 2; i++) {
      const { vault, signTypedData } = vaultFixture()
      vault.signBytes.mockImplementation(async ({ data }) => {
        const sig = await sign({ hash: data as `0x${string}`, privateKey: key })
        observed.add(sig.yParity!)
        const highS = (order - BigInt(sig.s)).toString(16).padStart(64, '0')
        const body = derInteger(sig.r.slice(2)) + derInteger(highS)
        return {
          signature: format === 'raw' ? sig.r.slice(2) + highS : '30' + (body.length / 2).toString(16) + body,
          recovery: sig.yParity! ^ 1,
        }
      })
      const signed = await signTypedData({ ...payload, message: { contents: [{ text: String(i) }] } })
      expect(BigInt(signed.s)).toBeLessThanOrEqual(order / 2n)
      expect(
        await recoverAddress({ hash: signed.hash as `0x${string}`, signature: signed.signature as `0x${string}` })
      ).toBe(address)
    }
    expect([...observed].sort()).toEqual([0, 1])
  })

  it.each([
    {},
    { ...payload, domain: null },
    { ...payload, domain: [] },
    { ...payload, types: null },
    { ...payload, message: [] },
    { ...payload, primaryType: '' },
    { ...payload, primaryType: 'Missing' },
    { ...payload, domain: { chainId: 'not-a-number' } },
  ])('rejects malformed data before credentials or signing: %j', async typedData => {
    const { vault, signTypedData } = vaultFixture()
    await expect(signTypedData(typedData, undefined, 'password')).rejects.toThrow()
    expect(vault.signBytes).not.toHaveBeenCalled()
    expect(vault.unlock).not.toHaveBeenCalled()
    expect(vault.passwordCache.set).not.toHaveBeenCalled()
  })

  it.each([Chain.Bitcoin, Chain.Solana, undefined])('rejects unsupported or missing signing chain %s', async chain => {
    const { vault } = vaultFixture()
    await expect(
      VaultBase.prototype.signTypedData.call(vault as unknown as VaultBase, {
        chain: chain as Chain,
        typedData: payload,
      })
    ).rejects.toThrow()
    expect(vault.signBytes).not.toHaveBeenCalled()
  })

  it('rejects the wrong signer with actionable vault context', async () => {
    const { vault, signTypedData } = vaultFixture()
    vault.address.mockResolvedValue('0x1111111111111111111111111111111111111111')
    await expect(signTypedData()).rejects.toThrow(
      /SIGNATURE_RECOVERY_MISMATCH:.*typed-data-test.*typed-data-fixture.*retrying will not help/
    )
  })

  it.each([true, false])('forwards explicit credentials without caching (encrypted=%s)', async isEncrypted => {
    const { vault, signTypedData } = vaultFixture()
    vault.isEncrypted = isEncrypted
    const result = await signTypedData(payload, undefined, 'password')
    expect(vault.signBytes).toHaveBeenCalledWith({ chain: Chain.Ethereum, data: result.hash, password: 'password' }, undefined)
    expect(vault.unlock).not.toHaveBeenCalled()
    expect(vault.passwordCache.set).not.toHaveBeenCalled()
  })

  it('leaves existing credential resolution to signBytes when password is omitted', async () => {
    const { vault, signTypedData } = vaultFixture()
    await signTypedData()
    expect(vault.unlock).not.toHaveBeenCalled()
    expect(vault.passwordCache.set).not.toHaveBeenCalled()
  })

  it('propagates credential or signing failure without a success result', async () => {
    const { vault, signTypedData } = vaultFixture()
    vault.signBytes.mockRejectedValue(new Error('wrong password'))
    await expect(signTypedData(payload, undefined, 'wrong')).rejects.toThrow('wrong password')
  })

  it('rejects an empty explicit password', async () => {
    const { vault, signTypedData } = vaultFixture()
    await expect(signTypedData(payload, undefined, '')).rejects.toThrow('Password cannot be empty')
    expect(vault.signBytes).not.toHaveBeenCalled()
  })

  it('forwards cancellation and never returns success after cancellation', async () => {
    const { vault, signTypedData } = vaultFixture()
    const controller = new AbortController()
    const options = { signal: controller.signal }
    await signTypedData(payload, options)
    expect(vault.signBytes.mock.calls[0][1]).toBe(options)
    controller.abort()
    vault.signBytes.mockClear()
    await expect(signTypedData(payload, options)).rejects.toThrow()
    expect(vault.signBytes).not.toHaveBeenCalled()
  })

  it('does not enter signing if cancelled during address lookup', async () => {
    const { vault, signTypedData } = vaultFixture()
    const controller = new AbortController()
    vault.address.mockImplementation(async () => {
      controller.abort()
      return address
    })
    await expect(signTypedData(payload, { signal: controller.signal })).rejects.toThrow()
    expect(vault.signBytes).not.toHaveBeenCalled()
  })

  it.each([2, -1, NaN])('rejects invalid recovery parity %s', async recovery => {
    const { vault, signTypedData } = vaultFixture()
    const original = vault.signBytes.getMockImplementation()!
    vault.signBytes.mockImplementation(async input => ({ ...(await original(input)), recovery }))
    await expect(signTypedData()).rejects.toThrow('Invalid EIP-712 signature recovery parity')
  })
})


describe('FastVault typed-data credentials with caching disabled', () => {
  it.each([true, false])('decrypts and authenticates with explicit credentials (encrypted=%s)', async encrypted => {
    const coreVault = {
      name: 'credential-test', publicKeys: { ecdsa: 'abcd', eddsa: 'dcba' },
      signers: ['local', 'Server-1'], localPartyId: 'local', hexChainCode: 'ab'.repeat(32),
      keyShares: { ecdsa: 'ecdsa-share', eddsa: 'eddsa-share' },
      libType: 'DKLS' as const, isBackedUp: true, order: 0,
    }
    const content = await createVaultBackup(coreVault, encrypted ? 'explicit-password' : undefined)
    const cache = new PasswordCacheService({ defaultTTL: 0 })
    const callback = vi.fn().mockRejectedValue(new Error('Callback must not replace explicit password'))
    const server = { signBytesWithServer: vi.fn(async (loaded, payload, password) => {
      expect(password).toBe('explicit-password')
      expect(loaded.keyShares).toEqual({ ecdsa: 'ecdsa-share', eddsa: 'eddsa-share' })
      const sig = await sign({ hash: ('0x' + payload.messageHashes[0].replace(/^0x/, '')) as `0x${string}`, privateKey: key })
      return { signature: sig.r.slice(2) + sig.s.slice(2), recovery: sig.yParity, format: 'ECDSA' }
    }) }
    const vault = FastVault.fromImport('credential-test', content, { ...coreVault, keyShares: { ecdsa: '', eddsa: '' } }, server as never, {
      storage: {}, config: { onPasswordRequired: callback }, passwordCache: cache, wasmProvider: {}, serverManager: {},
    } as never)
    vi.spyOn(vault, 'address').mockResolvedValue(address)
    const result = await vault.signTypedData({ chain: Chain.Ethereum, typedData: payload, password: 'explicit-password' })
    expect(result.signature).toMatch(/^0x[0-9a-f]{130}$/)
    expect(server.signBytesWithServer).toHaveBeenCalledOnce()
    expect(callback).not.toHaveBeenCalled()
    expect(cache.has(vault.id)).toBe(false)
    cache.destroy()
  })
})
