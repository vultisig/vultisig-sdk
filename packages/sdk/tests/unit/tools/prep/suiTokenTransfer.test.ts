import { Chain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockBuildSendKeysignPayload, mockGetPublicKey, mockIsValidAddress, mockGetWalletCore } = vi.hoisted(() => ({
  mockBuildSendKeysignPayload: vi.fn(),
  mockGetPublicKey: vi.fn(),
  mockIsValidAddress: vi.fn(),
  mockGetWalletCore: vi.fn(),
}))

vi.mock('@vultisig/core-mpc/keysign/send/build', () => ({
  buildSendKeysignPayload: mockBuildSendKeysignPayload,
}))
vi.mock('@vultisig/core-chain/publicKey/getPublicKey', () => ({
  getPublicKey: mockGetPublicKey,
}))
vi.mock('@vultisig/core-chain/utils/isValidAddress', () => ({
  isValidAddress: mockIsValidAddress,
}))
vi.mock('@/context/wasmRuntime', () => ({
  getWalletCore: mockGetWalletCore,
}))

import { prepareSuiTokenTransferFromKeys, SUI_NATIVE_COIN_TYPE } from '@/tools/prep/suiTokenTransfer'
import type { VaultIdentity } from '@/tools/prep/types'

const identity: VaultIdentity = {
  ecdsaPublicKey: '02ecdsa-public-key',
  eddsaPublicKey: 'eddsa-public-key',
  hexChainCode: 'deadbeef',
  localPartyId: 'iPhone-A1B2',
  libType: 'DKLS',
}

const FROM = '0x' + 'ab'.repeat(32)
const TO = '0x' + 'cd'.repeat(32)
const COIN_TYPE = '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN'

const mockWalletCore = { __mock: 'walletCore' }
const mockPublicKey = { __mock: 'publicKey' }
const mockPayload = { __mock: 'payload' }

describe('prepareSuiTokenTransferFromKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWalletCore.mockResolvedValue(mockWalletCore)
    mockIsValidAddress.mockReturnValue(true)
    mockGetPublicKey.mockReturnValue(mockPublicKey)
    mockBuildSendKeysignPayload.mockResolvedValue(mockPayload)
  })

  it('builds an unsigned token payload with id=coinType (drives Pay over PaySui)', async () => {
    const payload = await prepareSuiTokenTransferFromKeys(identity, {
      coinType: COIN_TYPE,
      from: FROM,
      to: TO,
      amount: 1_000_000n,
      decimals: 6,
      ticker: 'USDC',
    })

    expect(payload).toBe(mockPayload)
    expect(mockBuildSendKeysignPayload).toHaveBeenCalledTimes(1)
    const call = mockBuildSendKeysignPayload.mock.calls[0][0]
    // The presence of coin.id is what flips the Sui signing-input resolver to
    // a token `Pay` over matching coin objects.
    expect(call.coin).toMatchObject({
      chain: Chain.Sui,
      id: COIN_TYPE,
      address: FROM,
      decimals: 6,
      ticker: 'USDC',
    })
    expect(call.receiver).toBe(TO)
    expect(call.amount).toBe(1_000_000n)
    // Sui has no memo concept — never forward one.
    expect(call.memo).toBeUndefined()
  })

  it('rejects a malformed coin type', async () => {
    await expect(
      prepareSuiTokenTransferFromKeys(identity, { coinType: 'USDC', from: FROM, to: TO, amount: 1n })
    ).rejects.toThrow('not a valid Sui coin type')
    expect(mockBuildSendKeysignPayload).not.toHaveBeenCalled()
  })

  it('refuses native SUI (that is a native send, not a token transfer)', async () => {
    await expect(
      prepareSuiTokenTransferFromKeys(identity, { coinType: SUI_NATIVE_COIN_TYPE, from: FROM, to: TO, amount: 1n })
    ).rejects.toThrow('coinType is native SUI')
    expect(mockBuildSendKeysignPayload).not.toHaveBeenCalled()
  })

  it('rejects a non-Sui (EVM-shaped) recipient before building (mcp-ts#359)', async () => {
    await expect(
      prepareSuiTokenTransferFromKeys(identity, {
        coinType: COIN_TYPE,
        from: FROM,
        to: '0x' + 'cd'.repeat(20), // EVM 0x+40-hex
        amount: 1n,
      })
    ).rejects.toThrow('not a valid Sui address')
    expect(mockBuildSendKeysignPayload).not.toHaveBeenCalled()
  })

  it('rejects a malformed sender address', async () => {
    await expect(
      prepareSuiTokenTransferFromKeys(identity, { coinType: COIN_TYPE, from: '0xdead', to: TO, amount: 1n })
    ).rejects.toThrow('not a valid Sui address')
    expect(mockBuildSendKeysignPayload).not.toHaveBeenCalled()
  })

  it('rejects a non-positive amount', async () => {
    await expect(
      prepareSuiTokenTransferFromKeys(identity, { coinType: COIN_TYPE, from: FROM, to: TO, amount: 0n })
    ).rejects.toThrow('amount must be greater than zero')
    expect(mockBuildSendKeysignPayload).not.toHaveBeenCalled()
  })

  it('forwards an explicit walletCore override', async () => {
    const overrideWalletCore = { __mock: 'override-walletCore' }
    await prepareSuiTokenTransferFromKeys(
      identity,
      { coinType: COIN_TYPE, from: FROM, to: TO, amount: 5n },
      overrideWalletCore as never
    )
    expect(mockGetWalletCore).not.toHaveBeenCalled()
    expect(mockBuildSendKeysignPayload.mock.calls[0][0].walletCore).toBe(overrideWalletCore)
  })
})
