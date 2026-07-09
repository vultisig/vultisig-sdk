/**
 * Cosmos MsgSend golden-vector byte tests.
 *
 * Gap this fills: `cosmos-staking.test.ts` cross-checks the staking/distribution
 * msgs (MsgDelegate/MsgUndelegate/MsgBeginRedelegate/MsgWithdrawDelegatorReward)
 * against cosmjs-types, but the plain `cosmos.bank.v1beta1.MsgSend` path used
 * by every generic Cosmos-SDK send (Cosmos Hub, Osmosis, Kujira, Terra, ...)
 * had no byte-level cross-check.
 *
 * Strategy: independently re-encode the ENTIRE signable envelope (MsgSend Any
 * -> TxBody -> AuthInfo -> SignDoc) using cosmjs-types' own `.encode()`
 * functions (protobufjs-generated, the canonical reference for cosmos-sdk
 * wire format) and assert byte-for-byte equality against the SDK's hand-rolled
 * `buildCosmosSendTx` output in `platforms/react-native/chains/cosmos/tx.ts`.
 * This is stronger than a decode-round-trip: it proves the SDK's varint/
 * length-prefix/field-ordering choices produce the EXACT bytes a real
 * cosmos-sdk node would accept, not just bytes that happen to decode back to
 * the right values.
 *
 * Also covers the THORChain/MayaChain `/types.MsgSend` variant, which has a
 * DIFFERENT wire shape (raw bech32-decoded address bytes, not bech32 strings)
 * and is not representable with the generic cosmos-sdk MsgSend type.
 */
import { BinaryReader } from '@bufbuild/protobuf/wire'
import { fromBech32 } from '@cosmjs/encoding'
import { sha256 } from '@noble/hashes/sha2.js'
import { MsgSend } from 'cosmjs-types/cosmos/bank/v1beta1/tx'
import { PubKey } from 'cosmjs-types/cosmos/crypto/secp256k1/keys'
import { AuthInfo, Fee, ModeInfo, SignDoc, SignerInfo, TxBody } from 'cosmjs-types/cosmos/tx/v1beta1/tx'
import { Any } from 'cosmjs-types/google/protobuf/any'
import { describe, expect, it } from 'vitest'

import { buildCosmosSendTx } from '../../../../src/platforms/react-native/chains/cosmos/tx'

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

const FX = {
  chainId: 'cosmoshub-4',
  from: 'cosmos1abcdefghijklmnopqrstuvwxyz0123456789ab',
  to: 'cosmos1zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzaa',
  amount: '2500000',
  denom: 'uatom',
  feeAmount: '5000',
  gasLimit: 200_000,
  sequence: 12,
  accountNumber: 777,
  pubKey: new Uint8Array(33).fill(0x03),
}

/** Builds the reference SignDoc bytes entirely via cosmjs-types (independent of the SDK). */
function buildReferenceSignDoc(memo: string): { signDocBytes: Uint8Array; txBodyBytes: Uint8Array } {
  const msgSendBytes = MsgSend.encode(
    MsgSend.fromPartial({
      fromAddress: FX.from,
      toAddress: FX.to,
      amount: [{ denom: FX.denom, amount: FX.amount }],
    })
  ).finish()

  const anyBytes = Any.encode(
    Any.fromPartial({ typeUrl: '/cosmos.bank.v1beta1.MsgSend', value: msgSendBytes })
  ).finish()

  const txBodyBytes = TxBody.encode(TxBody.fromPartial({ messages: [Any.decode(anyBytes)], memo })).finish()

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
        amount: [{ denom: FX.denom, amount: FX.feeAmount }],
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

  return { signDocBytes, txBodyBytes }
}

describe('cosmos / buildCosmosSendTx — MsgSend golden vectors', () => {
  describe('generic cosmos-sdk bank.MsgSend (Cosmos Hub / Osmosis / Kujira / ...)', () => {
    it('produces SignDoc bytes byte-identical to an independent cosmjs-types encode', () => {
      const result = buildCosmosSendTx({
        chainName: 'Cosmos',
        chainId: FX.chainId,
        fromAddress: FX.from,
        toAddress: FX.to,
        amount: FX.amount,
        denom: FX.denom,
        feeAmount: FX.feeAmount,
        gasLimit: FX.gasLimit,
        sequence: FX.sequence,
        accountNumber: FX.accountNumber,
        pubKeyBytes: FX.pubKey,
      })

      const reference = buildReferenceSignDoc('')

      expect(bytesToHex(result.txBodyBytes)).toBe(bytesToHex(reference.txBodyBytes))
      expect(bytesToHex(result.signDocBytes)).toBe(bytesToHex(reference.signDocBytes))
      expect(result.signingHashHex).toBe(bytesToHex(sha256(reference.signDocBytes)))
    })

    it('round-trips fromAddress/toAddress/amount through MsgSend.decode', () => {
      const result = buildCosmosSendTx({
        chainName: 'Osmosis',
        chainId: 'osmosis-1',
        fromAddress: FX.from,
        toAddress: FX.to,
        amount: FX.amount,
        denom: 'uosmo',
        feeAmount: FX.feeAmount,
        gasLimit: FX.gasLimit,
        sequence: FX.sequence,
        accountNumber: FX.accountNumber,
        pubKeyBytes: FX.pubKey,
      })

      const txBody = TxBody.decode(result.txBodyBytes)
      expect(txBody.messages).toHaveLength(1)
      expect(txBody.messages[0].typeUrl).toBe('/cosmos.bank.v1beta1.MsgSend')
      const decoded = MsgSend.decode(txBody.messages[0].value)
      expect(decoded.fromAddress).toBe(FX.from)
      expect(decoded.toAddress).toBe(FX.to)
      expect(decoded.amount).toEqual([{ denom: 'uosmo', amount: FX.amount }])
    })

    it('includes the memo in TxBody when provided (matches cosmjs-types reference)', () => {
      const memo = 'test memo for send'
      const result = buildCosmosSendTx({
        chainName: 'Cosmos',
        chainId: FX.chainId,
        fromAddress: FX.from,
        toAddress: FX.to,
        amount: FX.amount,
        denom: FX.denom,
        feeAmount: FX.feeAmount,
        gasLimit: FX.gasLimit,
        sequence: FX.sequence,
        accountNumber: FX.accountNumber,
        pubKeyBytes: FX.pubKey,
        memo,
      })

      const reference = buildReferenceSignDoc(memo)
      expect(bytesToHex(result.txBodyBytes)).toBe(bytesToHex(reference.txBodyBytes))
      const txBody = TxBody.decode(result.txBodyBytes)
      expect(txBody.memo).toBe(memo)
    })
  })

  describe('THORChain / MayaChain types.MsgSend (raw-bytes address variant)', () => {
    // THORChain's `/types.MsgSend` is NOT the cosmos-sdk bank MsgSend: fields
    // 1/2 carry the RAW bech32-decoded address bytes, not bech32 strings.
    // cosmjs-types has no reference for this THORChain-specific type, so we
    // independently decode the bech32 addresses ourselves (via @cosmjs/encoding,
    // a maintained reference bech32 implementation distinct from the SDK's own
    // @scure/base usage) and assert the SDK's raw-bytes-in-the-envelope shape.
    // Valid bech32 (20-byte payload, `thor` hrp) — encode(0xAB * 20) / encode(0xCD * 20).
    const thorFrom = 'thor14w46h2at4w46h2at4w46h2at4w46h2at6frwyz'
    const thorTo = 'thor1ehxumnwdehxumnwdehxumnwdehxumnwdhcuvh7'

    it('encodes signer/recipient as raw bech32-decoded bytes (not strings)', () => {
      const result = buildCosmosSendTx({
        chainName: 'THORChain',
        chainId: 'thorchain-mainnet-v1',
        fromAddress: thorFrom,
        toAddress: thorTo,
        amount: '100000000',
        denom: 'rune',
        feeAmount: '2000000',
        gasLimit: 10_000_000,
        sequence: 3,
        accountNumber: 55,
        pubKeyBytes: FX.pubKey,
      })

      const txBody = TxBody.decode(result.txBodyBytes)
      expect(txBody.messages[0].typeUrl).toBe('/types.MsgSend')

      // Independently decode the inner message per the THORChain MsgSend
      // proto (from_address=1, to_address=2, amount=Coin=3, each
      // length-delimited) using @bufbuild/protobuf's audited BinaryReader —
      // a genuinely different wire-format implementation than the SDK's own
      // hand-rolled encoder in utils/cosmosProto.ts.
      const reader = new BinaryReader(txBody.messages[0].value)
      const fields: Record<number, Uint8Array> = {}
      while (reader.pos < reader.len) {
        const [fieldNo] = reader.tag()
        fields[fieldNo] = reader.bytes()
      }

      expect(bytesToHex(fields[1]!)).toBe(bytesToHex(fromBech32(thorFrom).data))
      expect(bytesToHex(fields[2]!)).toBe(bytesToHex(fromBech32(thorTo).data))
    })
  })
})
