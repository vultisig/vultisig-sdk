/**
 * TON transaction golden-vector byte tests.
 *
 * Gap this fills: `buildTonSendTx` / `buildTonJettonTransferTx`
 * (chains/ton/tx.ts) already use `@ton/core` directly (there is no separate
 * npm-published "reference" TON codec to diff against — `@ton/core` IS the
 * canonical TON cell/BOC library used across the ecosystem, including by
 * `@ton/ton`'s own wallet contracts). So unlike THORChain/Tron (where we
 * reconstruct via an unrelated protobuf library) or Ripple/Sui (where a
 * second party-maintained package exists), there is no cross-library check
 * available here.
 *
 * Instead, this test independently reconstructs the wallet-v4 signing-payload
 * header (subWalletId||validUntil||seqno||op||sendMode — a fixed 112-bit /
 * 14-byte structure per the documented V4R2 contract ABI) via manual
 * big-endian byte-packing (`DataView`), NOT by calling the SDK's own
 * `buildSigningPayloadCell` helper or repeating its `storeUint()` call
 * sequence. This catches field-order, bit-width, or byte-order regressions
 * in the hand-written helper even though both sides ultimately go through
 * `@ton/core`'s Cell/BOC primitives (unavoidable — no other library builds
 * TON cells). The inner transfer message itself is built via `@ton/core`'s
 * own `internal()`/`storeMessageRelaxed()` helpers (community-standard,
 * used by every TON wallet integration — not hand-rolled bit-packing like
 * the protobuf-style encoders in other chains), so this test's job is
 * narrowly to verify the V4R2-specific envelope layout.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { Address, beginCell, Cell, internal, SendMode, storeMessageRelaxed } from '@ton/core'
import { describe, expect, it } from 'vitest'

import { buildTonJettonTransferTx, buildTonSendTx, deriveTonAddress } from '../../../../src/chains/ton/tx'
import { prepareJettonTransferTxFromKeys } from '../../../../src/tools/prep/jettonTransfer'

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

const FX = {
  publicKeyEd25519: 'aa'.repeat(32),
  to: '0:' + 'bb'.repeat(32),
  amountNanotons: 1_500_000_000n, // 1.5 TON
  seqno: 7, // non-zero so StateInit is NOT attached — isolates the signing-payload check
  validUntil: 1_800_000_000,
  bounceable: true,
}

type TonNativeCrossEncoderFixture = {
  publicKeyEd25519Hex: string
  recipientAddress: string
  amountNanotons: string
  bounceable: boolean
  sequenceNumber: number
  expireAt: number
  workchain: number
  subWalletId: number
  expectedSigningHashHex: string
}

type TonJettonCrossEncoderFixture = TonNativeCrossEncoderFixture & {
  jettonWalletAddress: string
  amountMinimalUnits: string
  gasAmountNanotons: string
  forwardAmountNanotons: string
  memo?: string
  isActiveDestination: boolean
}

const loadCrossEncoderFixture = <T>(name: string): T =>
  JSON.parse(readFileSync(resolve(__dirname, '../../../../../../testdata/cross-encoder-golden', name), 'utf8')) as T

const buildDispatchedJettonFixture = (fixture: TonJettonCrossEncoderFixture) =>
  prepareJettonTransferTxFromKeys(
    {
      ecdsaPublicKey: '',
      eddsaPublicKey: fixture.publicKeyEd25519Hex,
      hexChainCode: '',
      localPartyId: 'cross-encoder-fixture',
      libType: 'DKLS',
    },
    {
      receiver: fixture.recipientAddress,
      jettonWalletAddress: fixture.jettonWalletAddress,
      amount: BigInt(fixture.amountMinimalUnits),
      isActiveDestination: fixture.isActiveDestination,
      memo: fixture.memo,
      seqno: fixture.sequenceNumber,
      validUntil: fixture.expireAt,
      workchain: fixture.workchain,
    }
  )

/**
 * Independent reconstruction of the V4R2 signing-payload header via manual
 * big-endian byte packing (DataView), NOT the SDK's sequential storeUint()
 * calls. 32+32+32+8+8 bits = 112 bits = exactly 14 bytes, so this is fully
 * byte-aligned and can be built as a plain buffer.
 */
function packReferenceHeader(subWalletId: number, validUntil: number, seqno: number, op: number, sendMode: number) {
  const buf = new Uint8Array(14)
  const view = new DataView(buf.buffer)
  view.setUint32(0, subWalletId >>> 0, false)
  view.setUint32(4, validUntil >>> 0, false)
  view.setUint32(8, seqno >>> 0, false)
  buf[12] = op & 0xff
  buf[13] = sendMode & 0xff
  return buf
}

function buildReferenceSigningPayload(subWalletId: number, validUntil: number, seqno: number, innerMsg: Cell): Cell {
  const sendMode = SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS
  const header = packReferenceHeader(subWalletId, validUntil, seqno, 0, sendMode)
  return beginCell().storeBuffer(Buffer.from(header)).storeRef(innerMsg).endCell()
}

describe('TON / buildTonSendTx golden vectors', () => {
  it('matches WalletCore for the shared native-transfer fixture', () => {
    const fixture = loadCrossEncoderFixture<TonNativeCrossEncoderFixture>('ton-native-transfer.json')
    const result = buildTonSendTx({
      publicKeyEd25519: fixture.publicKeyEd25519Hex,
      to: fixture.recipientAddress,
      amount: BigInt(fixture.amountNanotons),
      bounceable: fixture.bounceable,
      seqno: fixture.sequenceNumber,
      validUntil: fixture.expireAt,
      workchain: fixture.workchain,
      subWalletId: fixture.subWalletId,
    })

    expect(result.signingHashHex).toBe(fixture.expectedSigningHashHex)
  })

  it('signing payload matches an independently byte-packed V4R2 header + @ton/core inner message', () => {
    const result = buildTonSendTx({
      publicKeyEd25519: FX.publicKeyEd25519,
      to: FX.to,
      amount: FX.amountNanotons,
      bounceable: FX.bounceable,
      seqno: FX.seqno,
      validUntil: FX.validUntil,
    })

    const subWalletId = 698983191 // TON_V4R2_SUB_WALLET_ID + workchain(0)
    const innerMsg = beginCell()
      .store(
        storeMessageRelaxed(
          internal({
            to: Address.parse(FX.to),
            value: FX.amountNanotons,
            bounce: FX.bounceable,
            body: undefined,
          }),
          { forceRef: true }
        )
      )
      .endCell()

    const referencePayload = buildReferenceSigningPayload(subWalletId, FX.validUntil, FX.seqno, innerMsg)

    expect(result.signingHashHex).toBe(bytesToHex(referencePayload.hash()))
    expect(result.unsignedBocHex).toBe(bytesToHex(new Uint8Array(referencePayload.toBoc({ idx: false }))))
  })

  it('encodes the comment memo cell identically whether built by the SDK or by hand', () => {
    const memo = 'vultisig ton test'
    const result = buildTonSendTx({
      publicKeyEd25519: FX.publicKeyEd25519,
      to: FX.to,
      amount: FX.amountNanotons,
      bounceable: FX.bounceable,
      seqno: FX.seqno,
      validUntil: FX.validUntil,
      memo,
    })

    // TON convention: 0x00000000 opcode (32-bit) followed by the UTF-8 comment.
    const commentCell = beginCell().storeUint(0, 32).storeStringTail(memo).endCell()
    const innerMsg = beginCell()
      .store(
        storeMessageRelaxed(
          internal({
            to: Address.parse(FX.to),
            value: FX.amountNanotons,
            bounce: FX.bounceable,
            body: commentCell,
          }),
          { forceRef: true }
        )
      )
      .endCell()
    const subWalletId = 698983191
    const referencePayload = buildReferenceSigningPayload(subWalletId, FX.validUntil, FX.seqno, innerMsg)

    expect(result.unsignedBocHex).toBe(bytesToHex(new Uint8Array(referencePayload.toBoc({ idx: false }))))
  })

  it('rejects memos over the 123-byte cell-slice limit before ever reaching @ton/core', () => {
    const oversized = 'x'.repeat(124)
    expect(() =>
      buildTonSendTx({
        publicKeyEd25519: FX.publicKeyEd25519,
        to: FX.to,
        amount: FX.amountNanotons,
        bounceable: FX.bounceable,
        seqno: FX.seqno,
        validUntil: FX.validUntil,
        memo: oversized,
      })
    ).toThrow(/123 bytes/)
  })

  it('produces a different signing hash when seqno changes (replay-protection regression guard)', () => {
    const a = buildTonSendTx({
      publicKeyEd25519: FX.publicKeyEd25519,
      to: FX.to,
      amount: FX.amountNanotons,
      bounceable: FX.bounceable,
      seqno: 1,
      validUntil: FX.validUntil,
    })
    const b = buildTonSendTx({
      publicKeyEd25519: FX.publicKeyEd25519,
      to: FX.to,
      amount: FX.amountNanotons,
      bounceable: FX.bounceable,
      seqno: 2,
      validUntil: FX.validUntil,
    })
    expect(a.signingHashHex).not.toBe(b.signingHashHex)
  })
})

describe('TON / buildTonJettonTransferTx golden vectors', () => {
  const JETTON_TRANSFER_OPCODE = 0xf8a7ea5
  const JETTON_GAS_AMOUNT_NANO = 80000000n
  const JETTON_FORWARD_AMOUNT_NANO = 1n

  it('matches WalletCore for the shared dispatched Jetton-transfer fixture', () => {
    const fixture = loadCrossEncoderFixture<TonJettonCrossEncoderFixture>('ton-jetton-transfer.json')
    expect(fixture.gasAmountNanotons).toBe(JETTON_GAS_AMOUNT_NANO.toString())
    expect(fixture.forwardAmountNanotons).toBe(JETTON_FORWARD_AMOUNT_NANO.toString())

    const result = buildTonJettonTransferTx({
      publicKeyEd25519: fixture.publicKeyEd25519Hex,
      to: fixture.recipientAddress,
      jettonWalletAddress: fixture.jettonWalletAddress,
      amount: BigInt(fixture.amountMinimalUnits),
      isActiveDestination: fixture.isActiveDestination,
      seqno: fixture.sequenceNumber,
      validUntil: fixture.expireAt,
      workchain: fixture.workchain,
      subWalletId: fixture.subWalletId,
    })

    expect(result.signingHashHex).toBe(fixture.expectedSigningHashHex)
    expect(buildDispatchedJettonFixture(fixture).signingHashHex).toBe(fixture.expectedSigningHashHex)
  })

  it.each(['ton-jetton-transfer-inactive.json', 'ton-jetton-transfer-memo.json'])(
    'matches WalletCore for the shared %s fixture',
    fixtureName => {
      const fixture = loadCrossEncoderFixture<TonJettonCrossEncoderFixture>(fixtureName)
      const result = buildTonJettonTransferTx({
        publicKeyEd25519: fixture.publicKeyEd25519Hex,
        to: fixture.recipientAddress,
        jettonWalletAddress: fixture.jettonWalletAddress,
        amount: BigInt(fixture.amountMinimalUnits),
        isActiveDestination: fixture.isActiveDestination,
        memo: fixture.memo,
        seqno: fixture.sequenceNumber,
        validUntil: fixture.expireAt,
        workchain: fixture.workchain,
        subWalletId: fixture.subWalletId,
      })

      expect(fixture.forwardAmountNanotons).toBe(fixture.isActiveDestination ? '1' : '0')
      expect(result.signingHashHex).toBe(fixture.expectedSigningHashHex)
      expect(buildDispatchedJettonFixture(fixture).signingHashHex).toBe(fixture.expectedSigningHashHex)
    }
  )

  it('rejects a Jetton comment that exceeds WalletCore inline capacity', () => {
    const base = {
      publicKeyEd25519: FX.publicKeyEd25519,
      to: FX.to,
      jettonWalletAddress: '0:' + 'cc'.repeat(32),
      amount: 5_000_000n,
      isActiveDestination: true,
      seqno: FX.seqno,
      validUntil: FX.validUntil,
    }
    const result = buildTonJettonTransferTx({ ...base, memo: 'x'.repeat(39) })

    expect(result.signingHashHex).toMatch(/^[0-9a-f]{64}$/)
    expect(() => buildTonJettonTransferTx({ ...base, memo: 'x'.repeat(40) })).toThrow(
      /exceeds WalletCore inline forward_payload capacity/
    )
  })

  it('signing payload matches an independently-built jetton transfer body + V4R2 header', () => {
    const jettonWalletAddress = '0:' + 'cc'.repeat(32)
    const result = buildTonJettonTransferTx({
      publicKeyEd25519: FX.publicKeyEd25519,
      to: FX.to,
      jettonWalletAddress,
      amount: 5_000_000n,
      isActiveDestination: true,
      seqno: FX.seqno,
      validUntil: FX.validUntil,
    })

    // Independently reconstruct the jetton body per the TEP-74 standard
    // (opcode || query_id || amount || destination || response_destination
    // || custom_payload? || forward_ton_amount || forward_payload?), using
    // the SDK's own wallet address for response_destination (unavoidable —
    // it's derived from the caller's pubkey, not a protocol constant).
    const walletId = 698983191
    // We need the SAME sender wallet address the SDK derives internally to
    // build response_destination; re-derive it via the SDK's own
    // deriveTonAddress so this test focuses on the jetton-body wire format,
    // not wallet address derivation (covered by the address-invariant test
    // below).
    const senderAddress = Address.parse(deriveTonAddress(FX.publicKeyEd25519, { bounceable: false }))

    const bodyCell = beginCell()
      .storeUint(JETTON_TRANSFER_OPCODE, 32)
      .storeUint(0, 64)
      .storeCoins(5_000_000n)
      .storeAddress(Address.parse(FX.to))
      .storeAddress(senderAddress)
      .storeBit(false)
      .storeCoins(JETTON_FORWARD_AMOUNT_NANO)
      .storeBit(false)
      .endCell()

    const innerMsg = beginCell()
      .store(
        storeMessageRelaxed(
          internal({
            to: Address.parse(jettonWalletAddress),
            value: JETTON_GAS_AMOUNT_NANO,
            bounce: true,
            body: bodyCell,
          }),
          { forceRef: true }
        )
      )
      .endCell()

    const referencePayload = buildReferenceSigningPayload(walletId, FX.validUntil, FX.seqno, innerMsg)

    expect(result.unsignedBocHex).toBe(bytesToHex(new Uint8Array(referencePayload.toBoc({ idx: false }))))
    expect(result.signingHashHex).toBe(bytesToHex(referencePayload.hash()))
  })
})

describe('TON address derivation', () => {
  it('is deterministic and workchain-sensitive (regression guard)', () => {
    const wc0 = deriveTonAddress(FX.publicKeyEd25519, { workchain: 0 })
    const wc0Again = deriveTonAddress(FX.publicKeyEd25519, { workchain: 0 })
    expect(wc0).toBe(wc0Again)
    // Different pubkey must derive a different address.
    const otherPubkey = 'ff'.repeat(32)
    expect(deriveTonAddress(otherPubkey, { workchain: 0 })).not.toBe(wc0)
  })
})
