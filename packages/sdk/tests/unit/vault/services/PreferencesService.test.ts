import { Chain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

import { PreferencesService } from '@/vault/services/PreferencesService'
import { VaultErrorCode } from '@/vault/VaultError'

describe('PreferencesService chain address requirements', () => {
  let chains: Chain[]
  let setUserChains: Mock<(next: Chain[]) => void>
  let deriveAddresses: Mock<(chains: Chain[]) => Promise<void>>
  let saveVault: Mock<() => Promise<void>>
  let emitChainAdded: Mock<(data: { chain: Chain }) => void>

  function makeService(hasMldsa: boolean): PreferencesService {
    return new PreferencesService(
      {} as never,
      () => chains,
      setUserChains,
      () => 'usd',
      vi.fn(),
      deriveAddresses,
      requested => (hasMldsa ? [] : requested.filter(chain => chain === Chain.QBTC)),
      saveVault,
      emitChainAdded,
      vi.fn()
    )
  }

  beforeEach(() => {
    chains = [Chain.Ethereum]
    setUserChains = vi.fn((next: Chain[]) => {
      chains = next
    })
    deriveAddresses = vi.fn(async () => {})
    saveVault = vi.fn(async () => {})
    emitChainAdded = vi.fn()
  })

  it('rejects addChain for a newly added underivable chain without mutating or saving', async () => {
    const service = makeService(false)

    await expect(service.addChain(Chain.QBTC)).rejects.toMatchObject({
      code: VaultErrorCode.AddressDerivationFailed,
      message: 'Failed to derive address for QBTC',
      originalError: { message: 'Vault has no MLDSA public key (required for QBTC address derivation)' },
    })
    expect(chains).toEqual([Chain.Ethereum])
    expect(setUserChains).not.toHaveBeenCalled()
    expect(deriveAddresses).not.toHaveBeenCalled()
    expect(saveVault).not.toHaveBeenCalled()
    expect(emitChainAdded).not.toHaveBeenCalled()
  })

  it('rejects setChains when it introduces an underivable chain', async () => {
    const service = makeService(false)

    await expect(service.setChains([Chain.Ethereum, Chain.QBTC])).rejects.toMatchObject({
      code: VaultErrorCode.AddressDerivationFailed,
      message: 'Failed to derive address for QBTC',
    })
    expect(chains).toEqual([Chain.Ethereum])
    expect(setUserChains).not.toHaveBeenCalled()
    expect(saveVault).not.toHaveBeenCalled()
  })

  it('allows setChains to preserve an already-enabled underivable chain', async () => {
    chains = [Chain.Ethereum, Chain.QBTC]
    const service = makeService(false)

    await expect(service.setChains([Chain.Ethereum, Chain.QBTC])).resolves.toBeUndefined()

    expect(setUserChains).toHaveBeenCalledWith([Chain.Ethereum, Chain.QBTC])
    expect(saveVault).toHaveBeenCalledOnce()
  })

  it('allows addChain when the vault meets the address requirement', async () => {
    const service = makeService(true)

    await expect(service.addChain(Chain.QBTC)).resolves.toBeUndefined()

    expect(chains).toEqual([Chain.Ethereum, Chain.QBTC])
    expect(saveVault).toHaveBeenCalledOnce()
    expect(emitChainAdded).toHaveBeenCalledWith({ chain: Chain.QBTC })
  })
})
