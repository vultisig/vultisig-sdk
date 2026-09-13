import { getAssociatedTokenAddressSync } from '@solana/spl-token'
import { Keypair, PublicKey } from '@solana/web3.js'
import { initWasm, type WalletCore } from '@trustwallet/wallet-core'
import { beforeAll, describe, expect, it } from 'vitest'

import { Chain } from '../Chain'
import { isValidAddress } from './isValidAddress'
import { isValidRecipient } from './isValidRecipient'
import { isValidSolanaRecipient } from './isValidSolanaRecipient'

const wallet = Keypair.fromSeed(new Uint8Array(32).fill(7)).publicKey
const mint = Keypair.fromSeed(new Uint8Array(32).fill(11)).publicKey
const program = Keypair.fromSeed(new Uint8Array(32).fill(19)).publicKey
const pda = PublicKey.findProgramAddressSync([new TextEncoder().encode('recipient')], program)[0]
const ata = getAssociatedTokenAddressSync(mint, wallet)
const ataOfAta = getAssociatedTokenAddressSync(mint, ata, true)

describe('isValidRecipient', () => {
  let walletCore: WalletCore

  beforeAll(async () => {
    walletCore = await initWasm()
  })

  it('accepts an on-curve Solana wallet public key', () => {
    expect(isValidRecipient({ chain: Chain.Solana, address: wallet.toBase58(), walletCore })).toBe(true)
  })

  it.each([
    ['program-derived address', pda],
    ['associated token account', ata],
    ['ATA derived from an ATA recipient', ataOfAta],
  ])('rejects an off-curve %s while generic address validation still accepts it', (_label, address) => {
    const value = address.toBase58()

    expect(isValidAddress({ chain: Chain.Solana, address: value, walletCore })).toBe(true)
    expect(PublicKey.isOnCurve(address.toBytes())).toBe(false)
    expect(isValidRecipient({ chain: Chain.Solana, address: value, walletCore })).toBe(false)
  })

  it('preserves non-Solana address validation behavior', () => {
    const address = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'

    expect(isValidRecipient({ chain: Chain.Ethereum, address, walletCore })).toBe(
      isValidAddress({ chain: Chain.Ethereum, address, walletCore })
    )
  })

  it.each(['', 'not-a-public-key', '1111'])('rejects malformed wallet recipient %j', address => {
    expect(isValidSolanaRecipient(address)).toBe(false)
  })

  it('matches Solana curve validation without loading its RPC stack', () => {
    for (let seed = 0; seed < 256; seed++) {
      const bytes = Uint8Array.from({ length: 32 }, (_, index) => (seed + index * 17) % 256)
      const address = new PublicKey(bytes).toBase58()

      expect(isValidSolanaRecipient(address)).toBe(PublicKey.isOnCurve(bytes))
    }
  })
})
