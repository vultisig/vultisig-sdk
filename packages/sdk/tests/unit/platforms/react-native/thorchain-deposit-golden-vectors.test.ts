/**
 * THORChain/MayaChain `types.MsgDeposit` golden-vector byte tests.
 *
 * Gap this fills: no byte-level cross-check exists today for
 * `buildThorchainDepositTx` (the native-swap / LP-deposit path — the most
 * fund-safety-sensitive Cosmos-family message in the SDK, since a malformed
 * memo or amount silently produces a swap/deposit to the wrong destination).
 *
 * Why there's no npm reference package: `types.MsgDeposit` is a
 * THORChain/MayaChain-specific proto message (defined in the thornode /
 * mayanode Go repos), not part of cosmos-sdk's own proto set, so it is not
 * present in `cosmjs-types`. No maintained TypeScript/JS package publishes
 * generated bindings for it.
 *
 * Strategy: hand-encode the message using the OFFICIAL thornode/mayanode
 * proto schema (reproduced in the comments below, matching
 * `proto/thorchain/v1/x/thorchain/types/msg_deposit.proto` and
 * `common/common.proto`) via `@bufbuild/protobuf`'s audited `BinaryWriter` —
 * a genuinely independent protobuf wire-format implementation from the SDK's
 * own hand-rolled `field()`/`varint()` helpers in `utils/cosmosProto.ts`.
 * The outer envelope (Any -> TxBody -> AuthInfo -> SignDoc) IS covered by
 * cosmjs-types (the real cosmos-sdk reference), so only the THORChain-specific
 * inner message uses the hand-derived schema.
 *
 * This is a weaker guarantee than a true cross-library check (there is no
 * second implementation of the THORChain-specific schema to diff against),
 * but it independently verifies wire-format mechanics (varint tags, nested
 * length-delimited messages, field ordering) using a battle-tested protobuf
 * primitive library, and pins exact bytes so any accidental field
 * reordering/renumbering regresses loudly.
 */
import { BinaryReader, BinaryWriter, WireType } from '@bufbuild/protobuf/wire'
import { fromBech32 } from '@cosmjs/encoding'
import { sha256 } from '@noble/hashes/sha2.js'
import { PubKey } from 'cosmjs-types/cosmos/crypto/secp256k1/keys'
import { AuthInfo, Fee, ModeInfo, SignDoc, SignerInfo, TxBody } from 'cosmjs-types/cosmos/tx/v1beta1/tx'
import { Any } from 'cosmjs-types/google/protobuf/any'
import { describe, expect, it } from 'vitest'

import { buildThorchainDepositTx } from '../../../../src/platforms/react-native/chains/cosmos/tx'

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

const FX = {
  chainId: 'thorchain-mainnet-v1',
  // Valid bech32 (20-byte payload 0xAB*20, `thor` hrp).
  signerAddress: 'thor14w46h2at4w46h2at4w46h2at4w46h2at6frwyz',
  amountBaseUnits: '150000000',
  memo: 'SWAP:THOR.RUNE:thor1zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz:0',
  feeAmount: '2000000',
  gasLimit: 10_000_000,
  sequence: 4,
  accountNumber: 88,
  pubKey: new Uint8Array(33).fill(0x02),
}

/**
 * Reference encoder for `types.MsgDeposit`, built from the official proto:
 *
 *   message Asset {
 *     string chain = 1;
 *     string symbol = 2;
 *     string ticker = 3;
 *   }
 *   message Coin {
 *     Asset asset = 1;
 *     string amount = 2;
 *   }
 *   message MsgDeposit {
 *     repeated Coin coins = 1;
 *     string memo = 2;
 *     bytes signer = 3;
 *   }
 *
 * (synth/trade/secured on Asset and decimals on Coin are proto3 default-value
 * fields the SDK never sets, so they're correctly omitted on the wire —
 * proto3 omits default/zero values by convention.)
 */
function encodeReferenceMsgDeposit(amount: string, memo: string, signerBytes: Uint8Array): Uint8Array {
  const w = new BinaryWriter()

  // coins (field 1, repeated — single entry here)
  w.tag(1, WireType.LengthDelimited).fork()
  {
    // Coin.asset (field 1)
    w.tag(1, WireType.LengthDelimited).fork()
    {
      w.tag(1, WireType.LengthDelimited).string('THOR') // Asset.chain
      w.tag(2, WireType.LengthDelimited).string('RUNE') // Asset.symbol
      w.tag(3, WireType.LengthDelimited).string('RUNE') // Asset.ticker
    }
    w.join()
    // Coin.amount (field 2)
    w.tag(2, WireType.LengthDelimited).string(amount)
  }
  w.join()

  // memo (field 2)
  w.tag(2, WireType.LengthDelimited).string(memo)
  // signer (field 3)
  w.tag(3, WireType.LengthDelimited).bytes(signerBytes)

  return w.finish()
}

function buildReferenceSignDoc(amount: string, memo: string, signerBytes: Uint8Array) {
  const msgDepositBytes = encodeReferenceMsgDeposit(amount, memo, signerBytes)

  const anyBytes = Any.encode(Any.fromPartial({ typeUrl: '/types.MsgDeposit', value: msgDepositBytes })).finish()

  const txBodyBytes = TxBody.encode(TxBody.fromPartial({ messages: [Any.decode(anyBytes)], memo: '' })).finish()

  const pubKeyAnyBytes = Any.encode(
    Any.fromPartial({
      typeUrl: '/cosmos.crypto.secp256k1.PubKey',
      value: PubKey.encode(PubKey.fromPartial({ key: FX.pubKey })).finish(),
    })
  ).finish()

  const authInfoBytes = AuthInfo.encode(
    AuthInfo.fromPartial({
      signerInfos: [
        SignerInfo.fromPartial({
          publicKey: Any.decode(pubKeyAnyBytes),
          modeInfo: ModeInfo.fromPartial({ single: { mode: 1 } }),
          sequence: BigInt(FX.sequence),
        }),
      ],
      fee: Fee.fromPartial({
        amount: [{ denom: 'rune', amount: FX.feeAmount }],
        gasLimit: BigInt(FX.gasLimit),
      }),
    })
  ).finish()

  const signDocBytes = SignDoc.encode(
    SignDoc.fromPartial({
      bodyBytes: txBodyBytes,
      authInfoBytes,
      chainId: FX.chainId,
      accountNumber: BigInt(FX.accountNumber),
    })
  ).finish()

  return { txBodyBytes, signDocBytes }
}

describe('cosmos / buildThorchainDepositTx — types.MsgDeposit golden vectors', () => {
  it('produces SignDoc bytes byte-identical to an independently hand-derived reference encoding', () => {
    const result = buildThorchainDepositTx({
      chainId: FX.chainId,
      fromAddress: FX.signerAddress,
      amountBaseUnits: FX.amountBaseUnits,
      memo: FX.memo,
      sequence: FX.sequence,
      accountNumber: FX.accountNumber,
      pubKeyBytes: FX.pubKey,
      gasLimit: FX.gasLimit,
      feeDenom: 'rune',
      feeAmount: FX.feeAmount,
    })

    const signerBytes = fromBech32(FX.signerAddress).data
    const reference = buildReferenceSignDoc(FX.amountBaseUnits, FX.memo, signerBytes)

    expect(bytesToHex(result.txBodyBytes)).toBe(bytesToHex(reference.txBodyBytes))
    expect(bytesToHex(result.signDocBytes)).toBe(bytesToHex(reference.signDocBytes))
    expect(result.signingHashHex).toBe(bytesToHex(sha256(reference.signDocBytes)))
  })

  it('carries the swap memo verbatim inside MsgDeposit.memo, not TxBody.memo', () => {
    // Regression guard: THORChain routes swaps/LP actions entirely through the
    // memo string. If a future refactor accidentally moved the memo to the
    // TxBody-level field instead of MsgDeposit's own field 2, the chain would
    // silently ignore the swap instruction (deposit succeeds, swap never
    // executes) while the tx still broadcasts successfully.
    const result = buildThorchainDepositTx({
      chainId: FX.chainId,
      fromAddress: FX.signerAddress,
      amountBaseUnits: FX.amountBaseUnits,
      memo: FX.memo,
      sequence: FX.sequence,
      accountNumber: FX.accountNumber,
      pubKeyBytes: FX.pubKey,
      gasLimit: FX.gasLimit,
      feeDenom: 'rune',
      feeAmount: FX.feeAmount,
    })

    const txBody = TxBody.decode(result.txBodyBytes)
    expect(txBody.memo).toBe('') // TxBody-level memo is always empty for MsgDeposit
    expect(txBody.messages[0].typeUrl).toBe('/types.MsgDeposit')

    const reader = new BinaryReader(txBody.messages[0].value)
    const fields: Record<number, Uint8Array> = {}
    while (reader.pos < reader.len) {
      const [fieldNo] = reader.tag()
      fields[fieldNo] = reader.bytes()
    }
    expect(new TextDecoder().decode(fields[2])).toBe(FX.memo) // MsgDeposit.memo
  })

  it('produces a different signing hash when the amount changes (regression guard)', () => {
    const base = buildThorchainDepositTx({
      chainId: FX.chainId,
      fromAddress: FX.signerAddress,
      amountBaseUnits: FX.amountBaseUnits,
      memo: FX.memo,
      sequence: FX.sequence,
      accountNumber: FX.accountNumber,
      pubKeyBytes: FX.pubKey,
      gasLimit: FX.gasLimit,
      feeDenom: 'rune',
      feeAmount: FX.feeAmount,
    })
    const changed = buildThorchainDepositTx({
      chainId: FX.chainId,
      fromAddress: FX.signerAddress,
      amountBaseUnits: '1',
      memo: FX.memo,
      sequence: FX.sequence,
      accountNumber: FX.accountNumber,
      pubKeyBytes: FX.pubKey,
      gasLimit: FX.gasLimit,
      feeDenom: 'rune',
      feeAmount: FX.feeAmount,
    })
    expect(base.signingHashHex).not.toBe(changed.signingHashHex)
  })
})
