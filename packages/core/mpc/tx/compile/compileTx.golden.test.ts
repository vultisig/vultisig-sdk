/**
 * Golden / second-implementation checks for the compileTx branches that do not
 * use the PSBT-only compileSignBitcoinTx path.
 *
 * Fixture policy:
 * - EVM, Solana, and Cosmos compare MPC-style compileWithSignatures output to
 *   WalletCore AnySigner output built from the same deterministic private key.
 * - EVM additionally compares the raw legacy tx with viem serialization.
 * - Cardano (no memo) pins the manual CBOR wrapper branch. The public key
 *   fixture follows deriveCardanoAddress(): spending key + repeated chain-code
 *   bytes.
 * - Cardano (with memo) verifies CIP-20 label-674 metadata attachment:
 *   - signed tx element [3] decodes to { 674: { msg: ['vultisig-test'] } }
 *   - tx body key 7 matches blake2b-256 of element [3]
 *   - no-memo path bytes are unchanged (regression guard)
 * - Bittensor pins the custom SCALE extrinsic assembly used because WalletCore
 *   does not include Bittensor's current signed extensions.
 * - QBTC pins the custom Cosmos TxRaw assembly used for MLDSA signatures, which
 *   WalletCore cannot verify or assemble.
 * - Bitcoin-Cash, Litecoin, Dogecoin, Dash, and Zcash pin WalletCore
 *   compileWithSignatures output for the generic (non-SwapKit-PSBT) UTXO send
 *   path, cross-checked against walletCore.AnySigner.sign with an embedded
 *   private key — the same second-implementation pattern used for EVM/Solana/
 *   Cosmos above. Bitcoin itself is already covered end-to-end against real
 *   device hashes by mobileFixtures.golden.test.ts, so it is not duplicated
 *   here.
 * - Dogecoin and Dash serialize to byte-identical output for equivalent
 *   inputs: both share Bitcoin's original legacy P2PKH sighash algorithm with
 *   no chain-specific wire marker, so the only chain-identifying artifact is
 *   the address encoding (base58 version byte), not the transaction bytes.
 * - Zcash pins WalletCore's *current* output, which is version-4 (Sapling)
 *   framing signed with a NU5+ consensus branch id — WalletCore does not
 *   implement true NU5 v5 (ZIP-244/Orchard) transaction framing. This suite
 *   only guards against a wire-format regression in that WalletCore output;
 *   the SDK's independent NU5 v5-aware UTXO builder is verified separately
 *   elsewhere in this audit and is out of scope here.
 */
import { Buffer } from 'buffer'

import { create, toBinary } from '@bufbuild/protobuf'
import { blake2b } from '@noble/hashes/blake2b'
import { deriveCardanoAddress } from '@vultisig/core-chain/publicKey/address/cardano'
import { initWasm, TW, type WalletCore } from '@trustwallet/wallet-core'
import type { PrivateKey, PublicKey } from '@trustwallet/wallet-core/dist/src/wallet-core'
import { decode as cborDecode } from 'cbor-x'
import Long from 'long'
import { serializeTransaction } from 'viem'
import { beforeAll, describe, expect, it } from 'vitest'

import { Chain } from '@vultisig/core-chain/Chain'
import { getCardanoTxTtl } from '@vultisig/core-chain/chains/cardano/cip30/cardanoTxTtl'
import { utxoChainScriptType } from '@vultisig/core-chain/chains/utxo/tx/UtxoScriptType'
import { zcashBranchIdToWalletCoreHex } from '@vultisig/core-chain/chains/utxo/zcashBranchId'
import { getCoinType } from '@vultisig/core-chain/coin/coinType'

import { getPreSigningHashes } from '../preSigningHashes'
import { encodeDERSignature } from '../../derSignature'
import { KeysignSignature } from '../../keysign/KeysignSignature'
import {
  CardanoChainSpecificSchema,
  CosmosSpecificSchema,
  TransactionType,
} from '../../types/vultisig/keysign/v1/blockchain_specific_pb'
import { CoinSchema } from '../../types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '../../types/vultisig/keysign/v1/keysign_message_pb'
import { buildCip20AuxData } from './cardano/buildCip20AuxData'
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

const EXPECTED_BCH_RAW_TX =
  '01000000012222222222222222222222222222222222222222222222222222222222222222000000006a47304402205cc7b73d7f848464b886c1262e876e9d5a080563dd3be2721d3786f3c3272c43022024b68bde9094789eddeffb05291886d3ed8fe177001bc261a1922fdea5ee22874121031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078fffffffff0250c30000000000001976a914ebc0ee0b2ab9e8277a600c251475e22a3241a1c188acaac00000000000001976a91479b000887626b294a914501a4cd226b58b23598388ac00000000'
const EXPECTED_LTC_RAW_TX =
  '0100000000010133333333333333333333333333333333333333333333333333333333333333330000000000ffffffff0260ea000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c146e900000000000016001479b000887626b294a914501a4cd226b58b23598302483045022100ff471204dd7e4f52e4dda18cc63956ef70c4b67d4e8a8d0b4643c6a2354fd5ac02204c375cf8ab833f20359eb2625cb4116ced23f3de67f52fbc1c8095e855f40b530121031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f00000000'
const EXPECTED_DOGE_RAW_TX =
  '01000000014444444444444444444444444444444444444444444444444444444444444444000000006a47304402207048fb061ed4502f7c4517a4bcfa152f406e9f3cfc46639e15488b1a197fd2a002202b853ec92c43c36eb1a342df8182c3ec2f9762c717645cc296b313af5a67e5830121031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078fffffffff0270110100000000001976a914ebc0ee0b2ab9e8277a600c251475e22a3241a1c188ac28b90000000000001976a91479b000887626b294a914501a4cd226b58b23598388ac00000000'
const EXPECTED_DASH_RAW_TX =
  '01000000015555555555555555555555555555555555555555555555555555555555555555000000006b4830450221008e10337a586413f4dc93616bb07a1eee4ff23a42b4bbc7a6198789760beaca5f0220024ce21dfa1c31017715ee638677c1aa2c3af6ce04f903d9c0f195e35c82d9080121031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078fffffffff0280380100000000001976a914ebc0ee0b2ab9e8277a600c251475e22a3241a1c188ac16340100000000001976a91479b000887626b294a914501a4cd226b58b23598388ac00000000'
const EXPECTED_ZEC_RAW_TX =
  '0400008085202f89016666666666666666666666666666666666666666666666666666666666666666000000006a473044022065cf6eff680bc0bdbb40c07b05f8f9791213e3791a4ea94d59056d808ffefa6e0220058f39d10fbe41932e58097ce95e4f40b35a4f5e69ca4a2405f0b966cb6c76820121031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078fffffffff02905f0100000000001976a914ebc0ee0b2ab9e8277a600c251475e22a3241a1c188ac80380100000000001976a91479b000887626b294a914501a4cd226b58b23598388ac00000000000000000000000000000000000000'

/**
 * NU6.2 consensus branch id (Zcash mainnet). Mirrors ZCASH_BRANCH_ID_NU6_2 in
 * packages/sdk/src/chains/utxo/tx.ts (duplicated as a literal here — core
 * must not depend on the sdk package).
 */
const ZCASH_TEST_BRANCH_ID_HEX = '5437f330'

const EXPECTED_THORCHAIN_DEPOSIT_SERIALIZED =
  '{"mode":"BROADCAST_MODE_SYNC","tx_bytes":"CpEBCo4BChEvdHlwZXMuTXNnRGVwb3NpdBJ5Ch8KEgoEVEhPUhIEUlVORRoEUlVORRIJMTUwMDAwMDAwEkBTV0FQOlRIT1IuUlVORTp0aG9yMXp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6ejowGhR5sACIdiaylKkUUBpM0ia1iyNZgxJqClAKRgofL2Nvc21vcy5jcnlwdG8uc2VjcDI1NmsxLlB1YktleRIjCiEDG4TFVnsSZECZXT7VqroFZdceGDRgSBn/nBf16dXdB48SBAoCCAEYBBIWCg8KBHJ1bmUSBzIwMDAwMDAQgK3iBBpARomVjU5JqlRGm+O4BDGBzhE2mo+mP6H7RH69nZJahZEK4JbsQZ0eKjj0YxacejBKog7QLTVON7eWDWyJuqOjjA=="}'
const EXPECTED_TRON_SIGNED_JSON =
  '{"raw_data":{"contract":[{"parameter":{"type_url":"type.googleapis.com/protocol.TransferContract","value":{"amount":250000000,"owner_address":"411a642f0e3c3af545e7acbd38b07251b3990914f1","to_address":"415050a4f4b3f9338c3472dcc01a87c76a144b3c9c"}},"type":"TransferContract"}],"data":"636f6d70696c65547820676f6c64656e","expiration":1700000060000,"ref_block_bytes":"7e00","ref_block_hash":"bedca608b7fe9e66","timestamp":1700000000000},"raw_data_hex":"0a027e002208bedca608b7fe9e6640e0a499ffbc315210636f6d70696c65547820676f6c64656e5a68080112640a2d747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e5472616e73666572436f6e747261637412330a15411a642f0e3c3af545e7acbd38b07251b3990914f11215415050a4f4b3f9338c3472dcc01a87c76a144b3c9c1880e59a777080d095ffbc31","signature":["32fa1b2b51742d4cba60f870d53971ce7aa4c146303dca2aca387e528dd6ceec22171c5902e7dfb6f26194e35f83d051a9dc8fd40b1e922b7d95298739d8962800"],"txID":"9218ce3af35e09858b9dd95b3ac0b4ce131b2f7bc53c56f0a64c8fd01ed461de"}'
const EXPECTED_RIPPLE_PAYMENT_RAW_TX =
  '12000022000000002400000005201b01e848006140000000000f424068400000000000000c7321031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f74463044022020ac2b295f5f993ec6a00bdf62cf483e8b0f0a6dd5df6cc6c0a59d604df4b9b3022061862ddb85172cd2ca7e4c6ae14def2595f188803762fe1e736d3db6ff96210d811479b000887626b294a914501a4cd226b58b2359838314ebc0ee0b2ab9e8277a600c251475e22a3241a1c1'

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

type SignatureFormat = 'raw' | 'rawWithRecoveryId' | 'der'

const signatureForHash = ({
  privateKey,
  hash,
  curve,
  format,
}: {
  privateKey: PrivateKey
  hash: Uint8Array
  curve: WalletCore['Curve']['secp256k1']
  format: SignatureFormat
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

  if (format === 'der') {
    return {
      msg: '',
      r: '',
      s: '',
      der_signature: hex(encodeDERSignature(signature.slice(0, 32), signature.slice(32, 64))),
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
  format: SignatureFormat
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
  format: SignatureFormat
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

  it('matches WalletCore for a THORChain types.MsgDeposit (native RUNE swap)', () => {
    const privateKey = walletCore.PrivateKey.createWithData(ECDSA_PRIVATE_KEY)
    const publicKey = privateKey.getPublicKeySecp256k1(true)
    const signerAddress = walletCore.AnyAddress.createWithPublicKey(
      publicKey,
      walletCore.CoinType.thorchain
    ).description()
    // Mirrors toTwAddress(): the resolver hands MsgDeposit.signer the raw
    // bech32-decoded address bytes, not the string.
    const signerBytes = walletCore.AnyAddress.createWithString(signerAddress, walletCore.CoinType.thorchain).data()

    const signingInput = TW.Cosmos.Proto.SigningInput.create({
      signingMode: TW.Cosmos.Proto.SigningMode.Protobuf,
      accountNumber: Long.fromNumber(88),
      chainId: 'thorchain-1',
      sequence: Long.fromNumber(4),
      mode: TW.Cosmos.Proto.BroadcastMode.SYNC,
      publicKey: publicKey.data(),
      // TxBody-level memo is always empty for MsgDeposit — the swap memo lives
      // inside the message itself (MsgDeposit.memo), not the outer envelope.
      memo: '',
      fee: TW.Cosmos.Proto.Fee.create({
        gas: Long.fromNumber(10_000_000),
        amounts: [TW.Cosmos.Proto.Amount.create({ denom: 'rune', amount: '2000000' })],
      }),
      messages: [
        TW.Cosmos.Proto.Message.create({
          thorchainDepositMessage: TW.Cosmos.Proto.Message.THORChainDeposit.create({
            signer: signerBytes,
            memo: 'SWAP:THOR.RUNE:thor1zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz:0',
            coins: [
              TW.Cosmos.Proto.THORChainCoin.create({
                asset: TW.Cosmos.Proto.THORChainAsset.create({
                  chain: 'THOR',
                  symbol: 'RUNE',
                  ticker: 'RUNE',
                  synth: false,
                  secured: false,
                }),
                amount: '150000000',
              }),
            ],
          }),
        }),
      ],
    })
    const txInputData = TW.Cosmos.Proto.SigningInput.encode(signingInput).finish()
    const { compiled } = compile({
      walletCore,
      chain: Chain.THORChain,
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
        walletCore.CoinType.thorchain
      )
    )

    expect(compiledOutput.serialized).toBe(EXPECTED_THORCHAIN_DEPOSIT_SERIALIZED)
    expect(compiledOutput.serialized).toBe(signedByWalletCore.serialized)
  })

  it('matches WalletCore for a Tron TransferContract', () => {
    const privateKey = walletCore.PrivateKey.createWithData(ECDSA_PRIVATE_KEY)
    const publicKey = privateKey.getPublicKeySecp256k1(false)
    const sender = walletCore.AnyAddress.createWithPublicKey(publicKey, walletCore.CoinType.tron).description()
    const recipientPrivateKey = walletCore.PrivateKey.createWithData(new Uint8Array(32).fill(2))
    const recipientPublicKey = recipientPrivateKey.getPublicKeySecp256k1(false)
    const recipient = walletCore.AnyAddress.createWithPublicKey(
      recipientPublicKey,
      walletCore.CoinType.tron
    ).description()

    const signingInput = TW.Tron.Proto.SigningInput.create({
      transaction: TW.Tron.Proto.Transaction.create({
        transfer: TW.Tron.Proto.TransferContract.create({
          ownerAddress: sender,
          toAddress: recipient,
          amount: Long.fromNumber(250_000_000),
        }),
        timestamp: Long.fromNumber(1_700_000_000_000),
        blockHeader: TW.Tron.Proto.BlockHeader.create({
          timestamp: Long.fromNumber(1_700_000_000_000),
          number: Long.fromNumber(56_000_000),
          version: 31,
          txTrieRoot: bytesFromHex('01'.repeat(32)),
          parentHash: bytesFromHex('02'.repeat(32)),
          witnessAddress: bytesFromHex('03'.repeat(21)),
        }),
        expiration: Long.fromNumber(1_700_000_060_000),
        memo: 'compileTx golden',
      }),
    })
    const txInputData = TW.Tron.Proto.SigningInput.encode(signingInput).finish()
    const { compiled } = compile({
      walletCore,
      chain: Chain.Tron,
      txInputData,
      publicKey,
      privateKey,
      curve: walletCore.Curve.secp256k1,
      format: 'rawWithRecoveryId',
    })

    const compiledOutput = TW.Tron.Proto.SigningOutput.decode(compiled)
    const signedByWalletCore = TW.Tron.Proto.SigningOutput.decode(
      walletCore.AnySigner.sign(
        TW.Tron.Proto.SigningInput.encode({
          ...signingInput,
          privateKey: privateKey.data(),
        }).finish(),
        walletCore.CoinType.tron
      )
    )

    expect(compiledOutput.json).toBe(EXPECTED_TRON_SIGNED_JSON)
    expect(compiledOutput.json).toBe(signedByWalletCore.json)
    expect(hex(compiledOutput.id)).toBe(hex(signedByWalletCore.id))
  })

  it('matches WalletCore for a Ripple Payment', () => {
    const privateKey = walletCore.PrivateKey.createWithData(ECDSA_PRIVATE_KEY)
    const publicKey = privateKey.getPublicKeySecp256k1(true)
    const account = walletCore.AnyAddress.createWithPublicKey(publicKey, walletCore.CoinType.xrp).description()
    const recipientPrivateKey = walletCore.PrivateKey.createWithData(new Uint8Array(32).fill(2))
    const recipientPublicKey = recipientPrivateKey.getPublicKeySecp256k1(true)
    const destination = walletCore.AnyAddress.createWithPublicKey(
      recipientPublicKey,
      walletCore.CoinType.xrp
    ).description()

    const signingInput = TW.Ripple.Proto.SigningInput.create({
      account,
      fee: Long.fromNumber(12),
      sequence: 5,
      lastLedgerSequence: 32_000_000,
      publicKey: publicKey.data(),
      opPayment: TW.Ripple.Proto.OperationPayment.create({
        destination,
        amount: Long.fromNumber(1_000_000),
      }),
    })
    const txInputData = TW.Ripple.Proto.SigningInput.encode(signingInput).finish()
    const { compiled } = compile({
      walletCore,
      chain: Chain.Ripple,
      txInputData,
      publicKey,
      privateKey,
      curve: walletCore.Curve.secp256k1,
      format: 'rawWithRecoveryId',
    })

    const compiledOutput = TW.Ripple.Proto.SigningOutput.decode(compiled)
    const signedByWalletCore = TW.Ripple.Proto.SigningOutput.decode(
      walletCore.AnySigner.sign(
        TW.Ripple.Proto.SigningInput.encode({
          ...signingInput,
          privateKey: privateKey.data(),
        }).finish(),
        walletCore.CoinType.xrp
      )
    )

    expect(hex(compiledOutput.encoded)).toBe(EXPECTED_RIPPLE_PAYMENT_RAW_TX)
    expect(hex(compiledOutput.encoded)).toBe(hex(signedByWalletCore.encoded))
  })

  it('matches WalletCore for a Bitcoin-Cash transfer (cashaddr + FORKID sighash)', () => {
    const { compiledRaw, signedRaw } = compileUtxoGolden({
      walletCore,
      chain: Chain.BitcoinCash,
      utxoTxIdFill: 0x22,
      amount: 50_000,
      byteFee: 3,
    })

    expect(compiledRaw).toBe(EXPECTED_BCH_RAW_TX)
    expect(compiledRaw).toBe(signedRaw)
  })

  it('matches WalletCore for a Litecoin transfer', () => {
    const { compiledRaw, signedRaw } = compileUtxoGolden({
      walletCore,
      chain: Chain.Litecoin,
      utxoTxIdFill: 0x33,
      amount: 60_000,
      byteFee: 2,
    })

    expect(compiledRaw).toBe(EXPECTED_LTC_RAW_TX)
    expect(compiledRaw).toBe(signedRaw)
  })

  it('matches WalletCore for a Dogecoin transfer', () => {
    const { compiledRaw, signedRaw } = compileUtxoGolden({
      walletCore,
      chain: Chain.Dogecoin,
      utxoTxIdFill: 0x44,
      amount: 70_000,
      byteFee: 100,
    })

    expect(compiledRaw).toBe(EXPECTED_DOGE_RAW_TX)
    expect(compiledRaw).toBe(signedRaw)
  })

  it('matches WalletCore for a Dash transfer', () => {
    const { compiledRaw, signedRaw } = compileUtxoGolden({
      walletCore,
      chain: Chain.Dash,
      utxoTxIdFill: 0x55,
      amount: 80_000,
      byteFee: 5,
    })

    expect(compiledRaw).toBe(EXPECTED_DASH_RAW_TX)
    expect(compiledRaw).toBe(signedRaw)
  })

  it('produces byte-identical output for Dogecoin and Dash given equivalent inputs', () => {
    // Both share Bitcoin's original legacy P2PKH sighash algorithm with no
    // chain-specific wire marker, so the chain identity lives entirely in the
    // address encoding (base58 version byte), not the transaction bytes.
    const dogecoin = compileUtxoGolden({
      walletCore,
      chain: Chain.Dogecoin,
      utxoTxIdFill: 0x77,
      amount: 42_000,
      byteFee: 4,
    })
    const dash = compileUtxoGolden({
      walletCore,
      chain: Chain.Dash,
      utxoTxIdFill: 0x77,
      amount: 42_000,
      byteFee: 4,
    })

    expect(dogecoin.compiledRaw).toBe(dash.compiledRaw)
  })

  it('pins WalletCore output for a Zcash (NU5+ branch id, v4 Sapling framing) transfer', () => {
    const { compiledRaw, signedRaw } = compileUtxoGolden({
      walletCore,
      chain: Chain.Zcash,
      utxoTxIdFill: 0x66,
      amount: 90_000,
      byteFee: 10,
    })

    expect(compiledRaw).toBe(EXPECTED_ZEC_RAW_TX)
    expect(compiledRaw).toBe(signedRaw)
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
    expect(getCardanoTxTtl(compiledOutput.encoded)).toBe(500_000n)
  })

  it('attaches CIP-20 label-674 metadata when memo is present', () => {
    const MEMO = 'vultisig-test'
    const privateKey = walletCore.PrivateKey.createWithData(EDDSA_PRIVATE_KEY)
    const recipientPrivateKey = walletCore.PrivateKey.createWithData(new Uint8Array(32).fill(2))
    const publicKey = cardanoPublicKeyFromEd25519(walletCore, privateKey, 2)
    const recipientPublicKey = cardanoPublicKeyFromEd25519(walletCore, recipientPrivateKey, 3)
    const sender = deriveCardanoAddress({ publicKey, walletCore })
    const recipient = deriveCardanoAddress({ publicKey: recipientPublicKey, walletCore })

    const coin = create(CoinSchema, {
      chain: Chain.Cardano,
      ticker: 'ADA',
      address: sender,
      contractAddress: '',
      decimals: 6,
      isNativeToken: true,
      hexPublicKey: hex(new Uint8Array(publicKey.data())),
    })
    const cardanoSpecific = create(CardanoChainSpecificSchema, {
      ttl: 500_000n,
      sendMaxAmount: false,
      byteFee: 170_000n,
    })
    const keysignPayload = create(KeysignPayloadSchema, {
      coin,
      toAddress: recipient,
      toAmount: '1000000',
      memo: MEMO,
      blockchainSpecific: {
        case: 'cardano',
        value: cardanoSpecific,
      },
      utxoInfo: [
        {
          hash: '11'.repeat(32),
          amount: 2_000_000n,
          index: 0,
        },
      ],
    })

    // Mirror getCardanoSigningInputs: the resolver hands the CIP-20 CBOR to
    // WalletCore via auxiliary_data, which commits its hash into the body.
    const { auxDataCbor } = buildCip20AuxData(MEMO)
    const signingInput = TW.Cardano.Proto.SigningInput.create({
      ttl: Long.fromNumber(500_000),
      auxiliaryData: auxDataCbor,
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

    // Get the hash that MPC must sign (blake2b of the aux-committed body)
    const hashes = getPreSigningHashes({ walletCore, chain: Chain.Cardano, txInputData, keysignPayload })
    const hashHex = hex(hashes[0])

    // Sign with the deterministic private key
    const sig = privateKey.sign(hashes[0], walletCore.Curve.ed25519)
    const keysignSig: KeysignSignature = {
      msg: '',
      r: hex(sig.slice(0, 32).reverse()),
      s: hex(sig.slice(32, 64).reverse()),
      der_signature: '',
    }

    const compiled = compileTx({
      publicKey,
      txInputData,
      signatures: { [hashHex]: keysignSig },
      chain: Chain.Cardano,
      walletCore,
      keysignPayload,
    })

    const compiledOutput = TW.Cardano.Proto.SigningOutput.decode(compiled)

    // The signed tx is a CBOR array: [body, witnesses, is_valid, aux_data]
    const signedTxArray = cborDecode(compiledOutput.encoded) as unknown[]
    expect(Array.isArray(signedTxArray)).toBe(true)
    expect(signedTxArray).toHaveLength(4)

    // Element [3]: CIP-20 metadata — must decode to { '674': { msg: ['vultisig-test'] } }
    const auxData = signedTxArray[3]
    expect(typeof auxData).toBe('object')
    expect(auxData).not.toBeNull()
    const auxDecoded = auxData as Record<string, Record<string, string[]>>
    expect(auxDecoded['674']).toBeDefined()
    expect(auxDecoded['674']!['msg']).toEqual([MEMO])

    // Element [0]: tx body must commit blake2b-256(aux data) at key 7. cbor-x
    // decodes the integer-keyed body map to an object with stringified keys.
    const body = signedTxArray[0] as Record<string, Uint8Array>
    expect(hex(body['7']!)).toBe(hex(blake2b(auxDataCbor, { dkLen: 32 })))

    // WalletCore now commits the aux hash natively, so its pre-image data hash
    // already equals the signed txId — no client-side patching involved.
    const preOutput = TW.TxCompiler.Proto.PreSigningOutput.decode(
      walletCore.TransactionCompiler.preImageHashes(walletCore.CoinType.cardano, txInputData)
    )
    expect(hex(compiledOutput.txId)).toBe(hashHex)
    expect(hex(compiledOutput.txId)).toBe(hex(preOutput.dataHash))

    // Regression guard: the same fixture without auxiliary data yields a
    // different body hash (no key 7), and its signing hash is that plain hash.
    const noMemoInput = TW.Cardano.Proto.SigningInput.encode(
      TW.Cardano.Proto.SigningInput.create({
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
    ).finish()
    const noMemoPre = TW.TxCompiler.Proto.PreSigningOutput.decode(
      walletCore.TransactionCompiler.preImageHashes(walletCore.CoinType.cardano, noMemoInput)
    )
    const noMemoHashes = getPreSigningHashes({ walletCore, chain: Chain.Cardano, txInputData: noMemoInput })
    expect(hex(noMemoHashes[0])).toBe(hex(noMemoPre.dataHash))
    expect(hex(preOutput.dataHash)).not.toBe(hex(noMemoPre.dataHash))
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

/**
 * Builds a deterministic single-input UTXO send for the given chain, compiles
 * it through the generic (non-SwapKit-PSBT) compileTx path, and cross-checks
 * the result against walletCore.AnySigner.sign with the private key embedded
 * directly in the SigningInput — mirroring the EVM/Solana/Cosmos pattern
 * above. Mirrors getUtxoSigningInputs (the production resolver): the
 * TransactionPlan comes from walletCore.AnySigner.plan, and Zcash gets a
 * fixed post-NU5 consensus branch id instead of the resolver's network fetch.
 */
const compileUtxoGolden = ({
  walletCore,
  chain,
  utxoTxIdFill,
  amount,
  byteFee,
}: {
  walletCore: WalletCore
  chain: Chain
  utxoTxIdFill: number
  amount: number
  byteFee: number
}) => {
  const coinType = getCoinType({ walletCore, chain })
  const privateKey = walletCore.PrivateKey.createWithData(ECDSA_PRIVATE_KEY)
  const recipientPrivateKey = walletCore.PrivateKey.createWithData(new Uint8Array(32).fill(2))
  const publicKey = privateKey.getPublicKeySecp256k1(true)
  const recipientPublicKey = recipientPrivateKey.getPublicKeySecp256k1(true)

  const sender = walletCore.AnyAddress.createWithPublicKey(publicKey, coinType).description()
  const recipient = walletCore.AnyAddress.createWithPublicKey(recipientPublicKey, coinType).description()

  const lockScript = walletCore.BitcoinScript.lockScriptForAddress(sender, coinType)
  const scriptType = utxoChainScriptType[chain as keyof typeof utxoChainScriptType]
  const pubKeyHash =
    scriptType === 'wpkh' ? lockScript.matchPayToWitnessPublicKeyHash() : lockScript.matchPayToPubkeyHash()
  const scriptKey = hex(pubKeyHash)
  const script =
    scriptType === 'wpkh'
      ? walletCore.BitcoinScript.buildPayToWitnessPubkeyHash(pubKeyHash).data()
      : walletCore.BitcoinScript.buildPayToPublicKeyHash(pubKeyHash).data()

  const input = TW.Bitcoin.Proto.SigningInput.create({
    hashType: walletCore.BitcoinScript.hashTypeForCoin(coinType),
    amount: Long.fromNumber(amount),
    toAddress: recipient,
    changeAddress: sender,
    byteFee: Long.fromNumber(byteFee),
    coinType: coinType.value,
    scripts: { [scriptKey]: script },
    utxo: [
      TW.Bitcoin.Proto.UnspentTransaction.create({
        amount: Long.fromNumber(amount * 2),
        outPoint: TW.Bitcoin.Proto.OutPoint.create({
          hash: bytesFromHex(utxoTxIdFill.toString(16).repeat(32)).reverse(),
          index: 0,
          sequence: 0xffffffff,
        }),
        script: lockScript.data(),
      }),
    ],
    zip_0317: chain === Chain.Zcash,
  })

  input.plan = TW.Bitcoin.Proto.TransactionPlan.decode(
    walletCore.AnySigner.plan(TW.Bitcoin.Proto.SigningInput.encode(input).finish(), coinType)
  )

  if (chain === Chain.Zcash) {
    input.plan.branchId = bytesFromHex(zcashBranchIdToWalletCoreHex(ZCASH_TEST_BRANCH_ID_HEX))
  }

  const txInputData = TW.Bitcoin.Proto.SigningInput.encode(input).finish()

  const { compiled } = compile({
    walletCore,
    chain,
    txInputData,
    publicKey,
    privateKey,
    curve: walletCore.Curve.secp256k1,
    format: 'der',
  })
  const compiledOutput = TW.Bitcoin.Proto.SigningOutput.decode(compiled)

  const signedByWalletCore = TW.Bitcoin.Proto.SigningOutput.decode(
    walletCore.AnySigner.sign(
      TW.Bitcoin.Proto.SigningInput.encode({
        ...input,
        privateKey: [privateKey.data()],
      }).finish(),
      coinType
    )
  )

  return {
    compiledRaw: hex(compiledOutput.encoded),
    signedRaw: hex(signedByWalletCore.encoded),
  }
}
