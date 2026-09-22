/** Opt-in real relay/WASM imports. Uses only the public BIP39 fixture; never fund these vaults. */
import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { createSdkContext } from '../../src/context/SdkContextBuilder'
import { MemoryStorage } from '../../src/storage/MemoryStorage'
import { parseKeygenQR } from '../../src/utils/parseKeygenQR'
import { Vultisig } from '../../src/Vultisig'
import { setConsoleLogging } from '../setup'

setConsoleLogging(true)

const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const chains = [Chain.Solana, Chain.Terra, Chain.TerraClassic]
const enabled = process.env.E2E_SEEDPHRASE_PAIRING_SETTINGS === '1'

describe.skipIf(!enabled)('seedphrase pairing settings with three real SDK peers', () => {
  it.each([
    { tssBatching: false, legacy: false, alternate: true },
    { tssBatching: true, legacy: false, alternate: true },
    { tssBatching: false, legacy: true, alternate: true },
    { tssBatching: true, legacy: false, alternate: false },
  ])(
    'imports with batching=$tssBatching legacy=$legacy alternate=$alternate',
    { timeout: 900_000 },
    async ({ tssBatching, legacy, alternate }) => {
      const storages = Array.from({ length: 3 }, () => new MemoryStorage())
      const sdks = storages.map(storage => new Vultisig({ storage, defaultChains: chains }))
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 840_000)
      try {
        await Promise.all(sdks.map(sdk => sdk.initialize()))
        let resolveQr!: (qr: string) => void
        let rejectQr!: (reason: unknown) => void
        const qrReady = new Promise<string>((resolve, reject) => {
          resolveQr = resolve
          rejectQr = reject
        })
        const initiator = sdks[0].createSecureVaultFromSeedphrase({
          mnemonic,
          name: 'Pairing settings QA',
          devices: 3,
          chains,
          discoverChains: false,
          usePhantomSolanaPath: alternate,
          useCosmosPathTerra: alternate,
          tssBatching,
          signal: controller.signal,
          onQRCodeReady: resolveQr,
          onProgress: step => console.log(`initiator batching=${tssBatching}: ${step.message}`),
        })
        void initiator.catch(rejectQr)
        let qr = await qrReady
        expect(await parseKeygenQR(qr)).toMatchObject({
          usePhantomSolanaPath: alternate,
          useCosmosPathTerra: alternate,
        })
        if (legacy) {
          const url = new URL(qr)
          url.searchParams.delete('usePhantomSolanaPath')
          url.searchParams.delete('useCosmosPathTerra')
          qr = url.toString()
        }
        const results = await Promise.all([
          initiator,
          ...sdks.slice(1).map(sdk =>
            sdk.joinSecureVault(qr, {
              mnemonic,
              devices: 3,
              signal: controller.signal,
              ...(legacy ? { usePhantomSolanaPath: alternate, useCosmosPathTerra: alternate } : {}),
            })
          ),
        ])
        const context = await createSdkContext({ storage: new MemoryStorage() })
        const wc = await context.wasmProvider.getWalletCore()
        const wallet = wc.HDWallet.createWithMnemonic(mnemonic, '')
        try {
          for (const chain of chains) {
            const coin =
              chain === Chain.Solana
                ? wc.CoinType.solana
                : chain === Chain.Terra
                  ? wc.CoinType.terraV2
                  : wc.CoinType.terra
            // Independent oracle: literal paths and WalletCore, not SDK derivation helpers.
            const key = alternate
              ? wallet.getKey(coin, chain === Chain.Solana ? "m/44'/501'/0'/0'" : "m/44'/118'/0'/0/0")
              : wallet.getKeyForCoin(coin)
            const publicKey = chain === Chain.Solana ? key.getPublicKeyEd25519() : key.getPublicKeySecp256k1(true)
            try {
              const expectedKey = Buffer.from(publicKey.data()).toString('hex')
              const expectedAddress = wc.CoinTypeExt.deriveAddressFromPublicKey(coin, publicKey)
              for (const { vault } of results) {
                expect(vault.data.chainPublicKeys?.[chain]).toBe(expectedKey)
                expect(await vault.address(chain)).toBe(expectedAddress)
              }
              console.log(
                JSON.stringify({ tssBatching, legacy, alternate, chain, expectedKey, expectedAddress, participants: 3 })
              )
            } finally {
              publicKey.delete()
              key.delete()
            }
          }
        } finally {
          wallet.delete()
          context.passwordCache.destroy()
        }
        expect(new Set(results.map(result => result.vaultId)).size).toBe(1)
        expect(new Set(results.map(result => result.vault.localPartyId)).size).toBe(3)
      } finally {
        clearTimeout(timeout)
        controller.abort()
        sdks.forEach(sdk => sdk.dispose())
        await Promise.all(storages.map(storage => storage.clear()))
      }
    }
  )
})
