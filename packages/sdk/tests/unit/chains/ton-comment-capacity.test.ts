/**
 * Proves the exported TON comment caps are the caps WalletCore actually
 * enforces — not arithmetic that happens to look right.
 *
 * The caps live in `@vultisig/core-chain/chains/ton/comment` and gate the
 * keysign path, but WalletCore is what ultimately packs the cell. If the two
 * ever disagree, either a valid memo gets refused in the form or an oversized
 * one reaches WalletCore, which answers with a bare "Internal error" after the
 * user has already reviewed and approved the transaction. So this drives real
 * WalletCore at each cap and one byte past it, deliberately bypassing our own
 * validator.
 */
import { initWasm, TW, type WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import { getTonJettonCommentMaxBytes, tonNativeCommentMaxBytes } from '@vultisig/core-chain/chains/ton/comment'
import { getPreSigningHashes } from '@vultisig/core-mpc/tx/preSigningHashes'
import { beforeAll, describe, expect, it } from 'vitest'

import { buildTonJettonTransferTx, validateTonMemo } from '../../../src/chains/ton/tx'

const OWNER = 'UQCc9iCgP_b5RMJcFE5XD8zStfjtNHLhDWfUqC5m1SjSer95'
const RECIPIENT = 'UQDmLe6ticcY_uLZsfurdYONshNuCn8IS81KcJ8p6M6ISMcB'
const JETTON_WALLET = 'EQCIcjES4cQET0z6nRixZ0MdvTB4u3_8triztLSrIIrDkpgJ'

let walletCore: WalletCore

beforeAll(async () => {
  walletCore = await initWasm()
})

const toAmountBytes = (value: bigint) => {
  const hex = value.toString(16)
  return Buffer.from(hex.length % 2 ? `0${hex}` : hex, 'hex')
}

const mode =
  TW.TheOpenNetwork.Proto.SendMode.PAY_FEES_SEPARATELY | TW.TheOpenNetwork.Proto.SendMode.IGNORE_ACTION_PHASE_ERRORS

const encodeSigningInput = (transfer: TW.TheOpenNetwork.Proto.Transfer) =>
  TW.TheOpenNetwork.Proto.SigningInput.encode(
    TW.TheOpenNetwork.Proto.SigningInput.create({
      walletVersion: TW.TheOpenNetwork.Proto.WalletVersion.WALLET_V4_R2,
      expireAt: 1_800_000_000,
      sequenceNumber: 7,
      messages: [transfer],
      publicKey: Buffer.from('aa'.repeat(32), 'hex'),
    })
  ).finish()

/** Mirrors `buildJettonTransfer` minus the validation this test is checking. */
const encodeJettonTransfer = ({
  memo,
  amount,
  isActiveDestination,
}: {
  memo: string
  amount: bigint
  isActiveDestination: boolean
}) =>
  encodeSigningInput(
    TW.TheOpenNetwork.Proto.Transfer.create({
      dest: JETTON_WALLET,
      amount: toAmountBytes(80_000_000n),
      bounceable: true,
      comment: memo,
      mode,
      jettonTransfer: TW.TheOpenNetwork.Proto.JettonTransfer.create({
        jettonAmount: toAmountBytes(amount),
        toOwner: RECIPIENT,
        responseAddress: OWNER,
        forwardAmount: toAmountBytes(isActiveDestination ? 1n : 0n),
      }),
    })
  )

/** Mirrors `buildNativeTonTransfer` minus the validation this test is checking. */
const encodeNativeTransfer = (memo: string) =>
  encodeSigningInput(
    TW.TheOpenNetwork.Proto.Transfer.create({
      dest: RECIPIENT,
      amount: toAmountBytes(1_000_000_000n),
      bounceable: true,
      comment: memo,
      mode,
    })
  )

const packs = (txInputData: Uint8Array) => {
  const hashes = getPreSigningHashes({ walletCore, chain: Chain.Ton, txInputData })
  expect(hashes).toHaveLength(1)
}

describe('TON jetton comment capacity vs real WalletCore', () => {
  // Two realistic amounts whose VarUInteger encodings differ by five bytes:
  // 5 USDT (6 decimals) and one token of an 18-decimal jetton.
  it.each([
    { label: 'a 3-byte amount', amount: 5_000_000n, expectedCap: 39 },
    { label: 'an 8-byte amount', amount: 10n ** 18n, expectedCap: 34 },
  ])('caps $label at $expectedCap bytes, exactly where WalletCore stops', ({ amount, expectedCap }) => {
    const cap = getTonJettonCommentMaxBytes({ amount, isActiveDestination: true })
    expect(cap).toBe(expectedCap)

    packs(encodeJettonTransfer({ memo: 'x'.repeat(cap), amount, isActiveDestination: true }))

    expect(() =>
      packs(encodeJettonTransfer({ memo: 'x'.repeat(cap + 1), amount, isActiveDestination: true }))
    ).toThrow()
  })

  it('matches WalletCore for an inactive destination too, where the forward amount frees a byte', () => {
    const amount = 5_000_000n
    const cap = getTonJettonCommentMaxBytes({ amount, isActiveDestination: false })
    expect(cap).toBe(40)

    packs(encodeJettonTransfer({ memo: 'x'.repeat(cap), amount, isActiveDestination: false }))

    expect(() =>
      packs(encodeJettonTransfer({ memo: 'x'.repeat(cap + 1), amount, isActiveDestination: false }))
    ).toThrow()
  })

  // The regression this whole change exists for: the old fixed 123-byte cap was
  // the native one, and it let jetton memos through that WalletCore cannot pack.
  it('proves the native cap is not a safe cap for jettons', () => {
    const amount = 5_000_000n

    expect(tonNativeCommentMaxBytes).toBeGreaterThan(getTonJettonCommentMaxBytes({ amount, isActiveDestination: true }))
    expect(() =>
      packs(encodeJettonTransfer({ memo: 'x'.repeat(tonNativeCommentMaxBytes), amount, isActiveDestination: true }))
    ).toThrow()
  })
})

describe('TON native comment capacity vs real WalletCore', () => {
  it('packs a comment at the cap and refuses one byte more', () => {
    packs(encodeNativeTransfer('x'.repeat(tonNativeCommentMaxBytes)))

    expect(() => packs(encodeNativeTransfer('x'.repeat(tonNativeCommentMaxBytes + 1)))).toThrow()
  })
})

// The RN builder measures capacity against the body it is actually filling,
// which is the most accurate check there is — so it is the reference the
// exported cap has to agree with, or the send form and the builder would
// disagree about the same memo.
describe('the RN builder and the exported cap agree', () => {
  const base = {
    publicKeyEd25519: 'aa'.repeat(32),
    to: `0:${'bb'.repeat(32)}`,
    jettonWalletAddress: `0:${'cc'.repeat(32)}`,
    isActiveDestination: true,
    seqno: 7,
    validUntil: 1_800_000_000,
  }

  it.each([5_000_000n, 10n ** 18n])('stops at the same byte for amount %s', amount => {
    const cap = getTonJettonCommentMaxBytes({ amount, isActiveDestination: true })

    expect(buildTonJettonTransferTx({ ...base, amount, memo: 'x'.repeat(cap) }).signingHashHex).toMatch(
      /^[0-9a-f]{64}$/
    )
    expect(() => buildTonJettonTransferTx({ ...base, amount, memo: 'x'.repeat(cap + 1) })).toThrow(
      /inline forward_payload capacity/
    )
  })
})

describe('validateTonMemo', () => {
  it('applies the native cap on its own and the jetton cap when given the context', () => {
    const memo = 'x'.repeat(40)

    expect(() => validateTonMemo(memo)).not.toThrow()
    expect(() => validateTonMemo(memo, { amount: 5_000_000n, isActiveDestination: true })).toThrow(
      /at most 39 bytes for this jetton amount/
    )
  })
})
