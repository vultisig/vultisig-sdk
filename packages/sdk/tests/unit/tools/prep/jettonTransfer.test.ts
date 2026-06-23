/**
 * Unit tests for `prepareJettonTransferTxFromKeys` — the vault-free TON Jetton
 * transfer prep helper.
 *
 * Unlike the KeysignPayload-building prep helpers (send/swap/cosmos), this one
 * has NO WASM / walletCore dependency: it wraps the pure `@ton/core` cell
 * builder `buildTonJettonTransferTx`. So these tests run the real builder with
 * a deterministic throwaway pubkey (no mocks) and assert the unsigned tx
 * structure is well-formed and deterministic — and crucially that NO signing
 * or broadcasting happens (finalize is a separate, caller-driven step).
 */
import { Address, Cell } from '@ton/core'
import { describe, expect, it } from 'vitest'

import { buildV4R2Wallet } from '@/chains/ton/walletV4R2'
import { prepareJettonTransferTxFromKeys } from '@/tools/prep/jettonTransfer'
import type { VaultIdentity } from '@/tools/prep/types'

// Deterministic 32-byte Ed25519 pubkey (all 0x01s) — keeps the signing hash
// stable across runs. THROWAWAY: never a real vault key.
const PUBKEY_HEX = '01'.repeat(32)

const identity: VaultIdentity = {
  ecdsaPublicKey: '02deadbeef',
  eddsaPublicKey: PUBKEY_HEX,
  hexChainCode: 'deadbeef',
  localPartyId: 'iPhone-TEST',
  // libType is unused by this TON-pure helper, but VaultIdentity requires it.
  libType: 'DKLS',
}

// Valid user-friendly TON addresses (throwaway — derived from 0x02.../0x03...
// pubkeys via deriveTonAddress; real checksums so @ton/core's Address.parse
// accepts them).
const RECIPIENT = 'UQCXhTIYi7zucgALWCxYRAHjwJbLDyZVUZVOa-FzD7UA5P5O'
const JETTON_WALLET = 'EQAtiFQ15MZBgpAGwD1jfJm6maz5otBOPefyw9Wc3MVmMgzp'

const JETTON_TRANSFER_OPCODE = 0xf8a7ea5

describe('prepareJettonTransferTxFromKeys', () => {
  it('builds a deterministic unsigned jetton transfer (no sign, no broadcast)', () => {
    const tx = prepareJettonTransferTxFromKeys(identity, {
      receiver: RECIPIENT,
      jettonWalletAddress: JETTON_WALLET,
      amount: 1_000_000n,
      seqno: 5,
      validUntil: 1_700_000_000, // pinned -> deterministic hash
    })

    expect(tx.signingHashHex).toMatch(/^[0-9a-f]{64}$/)
    expect(tx.unsignedBocHex.length).toBeGreaterThan(0)
    // fromAddress is derived from the pubkey, NOT the recipient/jetton wallet.
    const wallet = buildV4R2Wallet({
      publicKeyEd25519: Uint8Array.from({ length: 32 }, () => 0x01),
    })
    expect(tx.fromAddress).toBe(wallet.addressString({ bounceable: false }))

    // Same inputs -> identical signing hash (pure function, no randomness).
    const tx2 = prepareJettonTransferTxFromKeys(identity, {
      receiver: RECIPIENT,
      jettonWalletAddress: JETTON_WALLET,
      amount: 1_000_000n,
      seqno: 5,
      validUntil: 1_700_000_000,
    })
    expect(tx2.signingHashHex).toBe(tx.signingHashHex)
  })

  it('encodes the jetton transfer opcode + amount + recipient in the message body', () => {
    const amount = 2_500_000n
    const tx = prepareJettonTransferTxFromKeys(identity, {
      receiver: RECIPIENT,
      jettonWalletAddress: JETTON_WALLET,
      amount,
      seqno: 0,
      validUntil: 1_700_000_000,
    })

    // Decode the signing-payload BoC and walk down to the jetton body cell:
    //   signingPayload -> ref(innerMsg) -> ref(jettonBody)
    const cells = Cell.fromBoc(Buffer.from(tx.unsignedBocHex, 'hex'))
    const signingPayload = cells[0]!
    const innerMsg = signingPayload.refs[0]!
    const jettonBody = innerMsg.refs[0]!

    const slice = jettonBody.beginParse()
    expect(slice.loadUint(32)).toBe(JETTON_TRANSFER_OPCODE) // op = transfer
    expect(slice.loadUintBig(64)).toBe(0n) // query_id
    expect(slice.loadCoins()).toBe(amount) // jetton amount (base units)
    expect(slice.loadAddress().toString()).toBe(Address.parse(RECIPIENT).toString()) // destination
  })

  it('exposes a finalize closure but never signs/broadcasts on its own', () => {
    const tx = prepareJettonTransferTxFromKeys(identity, {
      receiver: RECIPIENT,
      jettonWalletAddress: JETTON_WALLET,
      amount: 1n,
      seqno: 1,
    })
    // finalize is a CALLER-DRIVEN step: building the tx must not require a
    // signature, and finalize must reject anything that isn't a 64-byte sig.
    expect(typeof tx.finalize).toBe('function')
    expect(() => tx.finalize('00'.repeat(10))).toThrow(/64 bytes/)
  })

  it('rejects non-positive amounts', () => {
    expect(() =>
      prepareJettonTransferTxFromKeys(identity, {
        receiver: RECIPIENT,
        jettonWalletAddress: JETTON_WALLET,
        amount: 0n,
        seqno: 0,
      })
    ).toThrow(/greater than zero/)
  })

  it('rejects a missing EdDSA public key', () => {
    expect(() =>
      prepareJettonTransferTxFromKeys(
        { ...identity, eddsaPublicKey: '' },
        {
          receiver: RECIPIENT,
          jettonWalletAddress: JETTON_WALLET,
          amount: 1n,
          seqno: 0,
        }
      )
    ).toThrow(/EdDSA public key required/)
  })
})
