/**
 * Golden / second-implementation checks for the compileTx branches that do not
 * use the PSBT-only compileSignBitcoinTx path.
 *
 * Fixture policy:
 * - EVM, Solana, and Cosmos compare MPC-style compileWithSignatures output to
 *   WalletCore AnySigner output built from the same deterministic private key.
 * - EVM additionally compares the raw legacy tx with viem serialization.
 * - Cardano pins the manual CBOR wrapper branch. The public key fixture follows
 *   deriveCardanoAddress(): spending key + repeated chain-code bytes.
 * - Bittensor pins the custom SCALE extrinsic assembly used because WalletCore
 *   does not include Bittensor's current signed extensions.
 * - QBTC pins the custom Cosmos TxRaw assembly used for MLDSA signatures, which
 *   WalletCore cannot verify or assemble.
 */
import { Buffer } from 'buffer'

import { create, toBinary } from '@bufbuild/protobuf'
import { deriveCardanoAddress } from '@vultisig/core-chain/publicKey/address/cardano'
import { initWasm, TW, type WalletCore } from '@trustwallet/wallet-core'
import type { PrivateKey, PublicKey } from '@trustwallet/wallet-core/dist/src/wallet-core'
import Long from 'long'
import { serializeTransaction } from 'viem'
import { beforeAll, describe, expect, it } from 'vitest'

import { Chain } from '@vultisig/core-chain/Chain'

import { getPreSigningHashes } from '../preSigningHashes'
import { KeysignSignature } from '../../keysign/KeysignSignature'
import { CosmosSpecificSchema, TransactionType } from '../../types/vultisig/keysign/v1/blockchain_specific_pb'
import { CoinSchema } from '../../types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '../../types/vultisig/keysign/v1/keysign_message_pb'
import { compileTx } from './compileTx'

const ECDSA_PRIVATE_KEY = new Uint8Array(32).fill(1)
const EDDSA_PRIVATE_KEY = new Uint8Array(32).fill(1)

const EXPECTED_EVM_RAW_TX =
  'f86c098504a817c800825208943535353535353535353535353535353535353535880de0b6b3a76400008026a04341a097d64227daf74b4c3088efc98fafe67f5d80eb5dcf773d733584ec4732a036a068fb7695775f82a7c522751b3e6273ff1f550548ae1dd1ac0b05307c028f'
const EXPECTED_CARDANO_SIGNED_CBOR =
  '84a40081825820111111111111111111111111111111111111111111111111111111111111111100018282581d61008b47844d92812fc30d1f0ac9b6fbf38778ccba9db8312ad90790791a000f424082581d610d6a577e9441ad8ed9663931906e4d43ece8f82c712b1d0235affb061a000caa30021a00029810031a0007a120a100818258208a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c584056aafae4672f72f973dcec2d8f2ba6f632ee29e8df842ff4ccb7b5cbccd7af1d20db8f68d90d9fda0aab60490cf8e276abea888caf9be913f55384f0ad8a960df5f6'
const EXPECTED_BITTENSOR_EXTRINSIC =
  '2d0284008a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c00e86599818c154d1b4e6ce0bca1e46a0bf39aab36908b067efc08474a1e005cc72e2770e37b1e8c3c246d4972ba4f1dff5e054a2fe1d0ad091c211db81bc0f90a250200000500008a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c04'
const EXPECTED_QBTC_SERIALIZED =
  '{"tx_bytes":"Cp4BCokBChwvY29zbW9zLmJhbmsudjFiZXRhMS5Nc2dTZW5kEmkKKnFidGMxc2VuZGVyMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMBIrcWJ0YzFyZWNlaXZlcjAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMBoOCgRxYnRjEgYxMjM0NTYSEGNvbXBpbGVUeCBnb2xkZW4SYQpLCkEKGy9jb3Ntb3MuY3J5cHRvLm1sZHNhLlB1YktleRIiCiCqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqhIECgIIARgDEhIKDAoEcWJ0YxIEMjUwMBDgpxIaQFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU=","mode":"BROADCAST_MODE_SYNC"}'

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')

const bytesFromHex = (value: string) => new Uint8Array(Buffer.from(value, 'hex'))

const concat = (parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0

  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }

  return result
}

const uint32Le = (value: number) => {
  const result = new Uint8Array(4)
  new DataView(result.buffer).setUint32(0, value, true)
  return result
}

const bigIntBytes = (value: bigint) => {
  const raw = value.toString(16)
  return bytesFromHex(raw.length % 2 === 0 ? raw : `0${raw}`)
}

const signatureForHash = ({
  privateKey,
  hash,
  curve,
  format,
}: {
  privateKey: PrivateKey
  hash: Uint8Array
  curve: WalletCore['Curve']['secp256k1']
  format: 'raw' | 'rawWithRecoveryId'
}): KeysignSignature => {
  const signature = privateKey.sign(hash, curve)

  if (format === 'rawWithRecoveryId') {
    return {
      msg: '',
      r: hex(signature.slice(0, 32)),
      s: hex(signature.slice(32, 64)),
      der_signature: '',
      recovery_id: hex(signature.slice(64, 65)),
    }
  }

  return {
    msg: '',
    r: hex(signature.slice(0, 32).reverse()),
    s: hex(signature.slice(32, 64).reverse()),
    der_signature: '',
  }
}

const signaturesFor = ({
  privateKey,
  hashes,
  curve,
  format,
}: {
  privateKey: PrivateKey
  hashes: Uint8Array[]
  curve: WalletCore['Curve']['secp256k1']
  format: 'raw' | 'rawWithRecoveryId'
}) => Object.fromEntries(hashes.map(hash => [hex(hash), signatureForHash({ privateKey, hash, curve, format })]))

const compile = ({
  walletCore,
  chain,
  txInputData,
  publicKey,
  privateKey,
  curve,
  format,
}: {
  walletCore: WalletCore
  chain: Chain
  txInputData: Uint8Array
  publicKey: PublicKey
  privateKey: PrivateKey
  curve: WalletCore['Curve']['secp256k1']
  format: 'raw' | 'rawWithRecoveryId'
}) => {
  const hashes = getPreSigningHashes({ walletCore, chain, txInputData })
  const signatures = signaturesFor({
    privateKey,
    hashes,
    curve,
    format,
  })

  return {
    hashes,
    signatures,
    compiled: compileTx({
      publicKey,
      txInputData,
      signatures,
      chain,
      walletCore,
    }),
  }
}

describe('compileTx golden vectors', () => {
  let walletCore: WalletCore

  beforeAll(async () => {
    walletCore = await initWasm()
  })

  it('matches WalletCore and viem for a legacy Ethereum transfer', () => {
    const privateKey = walletCore.PrivateKey.createWithData(ECDSA_PRIVATE_KEY)
    const publicKey = privateKey.getPublicKeySecp256k1(false)
    const signingInput = TW.Ethereum.Proto.SigningInput.create({
      chainId: new Uint8Array([1]),
      nonce: new Uint8Array([9]),
      gasPrice: bigIntBytes(20_000_000_000n),
      gasLimit: bigIntBytes(21_000n),
      toAddress: '0x3535353535353535353535353535353535353535',
      transaction: TW.Ethereum.Proto.Transaction.create({
        transfer: TW.Ethereum.Proto.Transaction.Transfer.create({
          amount: bigIntBytes(1_000_000_000_000_000_000n),
        }),
      }),
    })
    const txInputData = TW.Ethereum.Proto.SigningInput.encode(signingInput).finish()
    const { compiled, signatures, hashes } = compile({
      walletCore,
      chain: Chain.Ethereum,
      txInputData,
      publicKey,
      privateKey,
      curve: walletCore.Curve.secp256k1,
      format: 'rawWithRecoveryId',
    })

    const compiledOutput = TW.Ethereum.Proto.SigningOutput.decode(compiled)
    const signedByWalletCore = TW.Ethereum.Proto.SigningOutput.decode(
      walletCore.AnySigner.sign(
        TW.Ethereum.Proto.SigningInput.encode({
          ...signingInput,
          privateKey: privateKey.data(),
        }).finish(),
        walletCore.CoinType.ethereum
      )
    )

    const rawTx = hex(compiledOutput.encoded)
    const [hash] = hashes
    const { r, s, recovery_id } = signatures[hex(hash)]
    const viemRaw = serializeTransaction(
      {
        chainId: 1,
        nonce: 9,
        gasPrice: 20_000_000_000n,
        gas: 21_000n,
        to: '0x3535353535353535353535353535353535353535',
        value: 1_000_000_000_000_000_000n,
        data: '0x',
        type: 'legacy',
      },
      {
        r: `0x${r}`,
        s: `0x${s}`,
        v: 37n + BigInt(Number.parseInt(recovery_id ?? '00', 16)),
      }
    )

    expect(rawTx).toBe(EXPECTED_EVM_RAW_TX)
    expect(rawTx).toBe(hex(signedByWalletCore.encoded))
    expect(rawTx).toBe(viemRaw.slice(2))
  })

  it('matches WalletCore for a Solana transfer transaction', () => {
    const privateKey = walletCore.PrivateKey.createWithData(EDDSA_PRIVATE_KEY)
    const publicKey = privateKey.getPublicKeyEd25519()
    const sender = walletCore.AnyAddress.createWithPublicKey(publicKey, walletCore.CoinType.solana).description()
    const signingInput = TW.Solana.Proto.SigningInput.create({
      recentBlockhash: '44jzmJEahEFTHexSNLkLfXXXyKggtpT2jJuJ3hdCBbsB',
      sender,
      transferTransaction: TW.Solana.Proto.Transfer.create({
        recipient: 'GogodXVKU6KfeZiSR9oybanGGZXRuQ34ogb2i3f3WvYi',
        value: Long.fromNumber(123_456_789),
      }),
    })
    const txInputData = TW.Solana.Proto.SigningInput.encode(signingInput).finish()
    const { compiled } = compile({
      walletCore,
      chain: Chain.Solana,
      txInputData,
      publicKey,
      privateKey,
      curve: walletCore.Curve.ed25519,
      format: 'raw',
    })

    const compiledOutput = TW.Solana.Proto.SigningOutput.decode(compiled)
    const signedByWalletCore = TW.Solana.Proto.SigningOutput.decode(
      walletCore.AnySigner.sign(
        TW.Solana.Proto.SigningInput.encode({
          ...signingInput,
          privateKey: privateKey.data(),
        }).finish(),
        walletCore.CoinType.solana
      )
    )

    expect(compiledOutput.encoded).toEqual(signedByWalletCore.encoded)
  })

  it('matches WalletCore for a Cosmos protobuf MsgSend', () => {
    const privateKey = walletCore.PrivateKey.createWithData(ECDSA_PRIVATE_KEY)
    const publicKey = privateKey.getPublicKeySecp256k1(true)
    const recipient = walletCore.AnyAddress.createWithPublicKey(
      walletCore.PrivateKey.createWithData(new Uint8Array(32).fill(2)).getPublicKeySecp256k1(true),
      walletCore.CoinType.cosmos
    ).description()
    const sender = walletCore.AnyAddress.createWithPublicKey(publicKey, walletCore.CoinType.cosmos).description()
    const signingInput = TW.Cosmos.Proto.SigningInput.create({
      signingMode: TW.Cosmos.Proto.SigningMode.Protobuf,
      accountNumber: Long.fromNumber(7),
      chainId: 'cosmoshub-4',
      sequence: Long.fromNumber(3),
      mode: TW.Cosmos.Proto.BroadcastMode.SYNC,
      publicKey: publicKey.data(),
      memo: 'compileTx golden',
      fee: TW.Cosmos.Proto.Fee.create({
        gas: Long.fromNumber(200_000),
        amounts: [TW.Cosmos.Proto.Amount.create({ denom: 'uatom', amount: '2500' })],
      }),
      messages: [
        TW.Cosmos.Proto.Message.create({
          sendCoinsMessage: TW.Cosmos.Proto.Message.Send.create({
            fromAddress: sender,
            toAddress: recipient,
            amounts: [TW.Cosmos.Proto.Amount.create({ denom: 'uatom', amount: '12345' })],
          }),
        }),
      ],
    })
    const txInputData = TW.Cosmos.Proto.SigningInput.encode(signingInput).finish()
    const { compiled } = compile({
      walletCore,
      chain: Chain.Cosmos,
      txInputData,
      publicKey,
      privateKey,
      curve: walletCore.Curve.secp256k1,
      format: 'rawWithRecoveryId',
    })

    const compiledOutput = TW.Cosmos.Proto.SigningOutput.decode(compiled)
    const signedByWalletCore = TW.Cosmos.Proto.SigningOutput.decode(
      walletCore.AnySigner.sign(
        TW.Cosmos.Proto.SigningInput.encode({
          ...signingInput,
          privateKey: privateKey.data(),
        }).finish(),
        walletCore.CoinType.cosmos
      )
    )

    expect(compiledOutput.serialized).toBe(signedByWalletCore.serialized)
  })

  it('pins the manual Cardano witness wrapper', () => {
    const privateKey = walletCore.PrivateKey.createWithData(EDDSA_PRIVATE_KEY)
    const recipientPrivateKey = walletCore.PrivateKey.createWithData(new Uint8Array(32).fill(2))
    const publicKey = cardanoPublicKeyFromEd25519(walletCore, privateKey, 2)
    const recipientPublicKey = cardanoPublicKeyFromEd25519(walletCore, recipientPrivateKey, 3)
    const sender = deriveCardanoAddress({ publicKey, walletCore })
    const recipient = deriveCardanoAddress({
      publicKey: recipientPublicKey,
      walletCore,
    })
    const signingInput = TW.Cardano.Proto.SigningInput.create({
      ttl: Long.fromNumber(500_000),
      transferMessage: TW.Cardano.Proto.Transfer.create({
        toAddress: recipient,
        changeAddress: sender,
        amount: Long.fromNumber(1_000_000),
        forceFee: Long.fromNumber(170_000),
      }),
      utxos: [
        TW.Cardano.Proto.TxInput.create({
          outPoint: TW.Cardano.Proto.OutPoint.create({
            txHash: bytesFromHex('11'.repeat(32)),
            outputIndex: Long.fromNumber(0),
          }),
          address: sender,
          amount: Long.fromNumber(2_000_000),
        }),
      ],
    })
    const txInputData = TW.Cardano.Proto.SigningInput.encode(signingInput).finish()
    const { compiled, hashes } = compile({
      walletCore,
      chain: Chain.Cardano,
      txInputData,
      publicKey,
      privateKey,
      curve: walletCore.Curve.ed25519,
      format: 'raw',
    })

    const compiledOutput = TW.Cardano.Proto.SigningOutput.decode(compiled)

    expect(hex(compiledOutput.txId)).toBe(hex(hashes[0]))
    expect(hex(compiledOutput.encoded)).toBe(EXPECTED_CARDANO_SIGNED_CBOR)
  })

  it('pins the custom Bittensor extrinsic assembly', () => {
    const privateKey = walletCore.PrivateKey.createWithData(EDDSA_PRIVATE_KEY)
    const publicKey = privateKey.getPublicKeyEd25519()
    const callData = new Uint8Array([5, 0, 0, ...publicKey.data(), 4])
    const signedExtra = new Uint8Array([0x25, 0x02, 0x00, 0x00])
    const payload = concat([callData, signedExtra, bytesFromHex('22'.repeat(32))])
    const txInputData = concat([
      uint32Le(callData.length),
      callData,
      uint32Le(signedExtra.length),
      signedExtra,
      payload,
    ])
    const { compiled } = compile({
      walletCore,
      chain: Chain.Bittensor,
      txInputData,
      publicKey,
      privateKey,
      curve: walletCore.Curve.ed25519,
      format: 'raw',
    })

    const compiledOutput = TW.Polkadot.Proto.SigningOutput.decode(compiled)

    expect(hex(compiledOutput.encoded)).toBe(EXPECTED_BITTENSOR_EXTRINSIC)
  })

  it('pins the QBTC MLDSA Cosmos TxRaw assembly', () => {
    const coin = create(CoinSchema, {
      chain: Chain.QBTC,
      ticker: 'QBTC',
      address: 'qbtc1sender0000000000000000000000000000000',
      contractAddress: '',
      decimals: 8,
      isNativeToken: true,
      hexPublicKey: 'aa'.repeat(32),
    })
    const cosmosSpecific = create(CosmosSpecificSchema, {
      accountNumber: 7n,
      sequence: 3n,
      gas: 2500n,
      transactionType: TransactionType.UNSPECIFIED,
    })
    const keysignPayload = create(KeysignPayloadSchema, {
      coin,
      toAddress: 'qbtc1receiver000000000000000000000000000000',
      toAmount: '123456',
      memo: 'compileTx golden',
      blockchainSpecific: {
        case: 'cosmosSpecific',
        value: cosmosSpecific,
      },
    })
    const txInputData = toBinary(KeysignPayloadSchema, keysignPayload)
    const [hash] = getPreSigningHashes({
      walletCore,
      chain: Chain.QBTC,
      txInputData,
    })
    const compiled = compileTx({
      txInputData,
      signatures: {
        [hex(hash)]: {
          msg: '',
          r: '',
          s: '',
          der_signature: '55'.repeat(64),
        },
      },
      chain: Chain.QBTC,
      walletCore,
    })

    const compiledOutput = TW.Cosmos.Proto.SigningOutput.decode(compiled)

    expect(compiledOutput.serialized).toBe(EXPECTED_QBTC_SERIALIZED)
  })
})

const cardanoPublicKeyFromEd25519 = (walletCore: WalletCore, privateKey: PrivateKey, chainCodeByte: number) => {
  const spendingKey = Buffer.from(privateKey.getPublicKeyEd25519().data())
  const chainCode = Buffer.alloc(32, chainCodeByte)

  return walletCore.PublicKey.createWithData(
    concat([spendingKey, spendingKey, chainCode, chainCode]),
    walletCore.PublicKeyType.ed25519Cardano
  )
}
