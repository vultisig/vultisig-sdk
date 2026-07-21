import { sha256 } from '@noble/hashes/sha2.js'
import { PubKey } from 'cosmjs-types/cosmos/crypto/secp256k1/keys'
import { AuthInfo, Fee, ModeInfo, SignDoc, SignerInfo, TxBody } from 'cosmjs-types/cosmos/tx/v1beta1/tx'
import { MsgExecuteContract } from 'cosmjs-types/cosmwasm/wasm/v1/tx'
import { Any } from 'cosmjs-types/google/protobuf/any'
import { describe, expect, it } from 'vitest'

import { buildCosmosWasmExecuteTx } from '../../../../src'

const bytesToHex = (bytes: Uint8Array): string => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')

describe('root buildCosmosWasmExecuteTx export', () => {
  it('matches an independent cosmjs-types SignDoc encoding byte for byte', () => {
    const executeMsgJson = JSON.stringify({ swap: { minimum_output: '123' } })
    const pubKeyBytes = new Uint8Array(33).fill(0x03)
    const opts = {
      chainId: 'thorchain-1',
      fromAddress: 'thor1sender',
      contractAddress: 'thor1contract',
      executeMsgJson,
      funds: [{ denom: 'rune', amount: '250000000' }],
      sequence: 12,
      accountNumber: 777,
      pubKeyBytes,
      gasLimit: 500_000,
      feeDenom: 'rune',
      feeAmount: '0',
      memo: 'sdk-1187',
    }

    const actual = buildCosmosWasmExecuteTx(opts)
    const execute = MsgExecuteContract.fromPartial({
      sender: opts.fromAddress,
      contract: opts.contractAddress,
      msg: new TextEncoder().encode(executeMsgJson),
      funds: opts.funds,
    })
    const body = TxBody.fromPartial({
      messages: [
        Any.fromPartial({
          typeUrl: '/cosmwasm.wasm.v1.MsgExecuteContract',
          value: MsgExecuteContract.encode(execute).finish(),
        }),
      ],
      memo: opts.memo,
    })
    const authInfo = AuthInfo.fromPartial({
      signerInfos: [
        SignerInfo.fromPartial({
          publicKey: Any.fromPartial({
            typeUrl: '/cosmos.crypto.secp256k1.PubKey',
            value: PubKey.encode(PubKey.fromPartial({ key: pubKeyBytes })).finish(),
          }),
          modeInfo: ModeInfo.fromPartial({ single: { mode: 1 } }),
          sequence: BigInt(opts.sequence),
        }),
      ],
      fee: Fee.fromPartial({
        amount: [{ denom: opts.feeDenom, amount: opts.feeAmount }],
        gasLimit: BigInt(opts.gasLimit),
      }),
    })
    const expectedSignDoc = SignDoc.encode(
      SignDoc.fromPartial({
        bodyBytes: TxBody.encode(body).finish(),
        authInfoBytes: AuthInfo.encode(authInfo).finish(),
        chainId: opts.chainId,
        accountNumber: BigInt(opts.accountNumber),
      })
    ).finish()

    expect(bytesToHex(actual.signDocBytes)).toBe(bytesToHex(expectedSignDoc))
    expect(actual.signingHashHex).toBe(bytesToHex(sha256(expectedSignDoc)))
  })
})
