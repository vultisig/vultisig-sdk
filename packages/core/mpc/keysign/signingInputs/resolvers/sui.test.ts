import { Buffer } from 'buffer'

import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { getSuiTransactionDataDigest } from '@vultisig/core-chain/chains/sui/sign'
import { getCoinType } from '@vultisig/core-chain/coin/coinType'
import { initWasm, TW, type WalletCore } from '@trustwallet/wallet-core'
import type { PublicKey } from '@trustwallet/wallet-core/dist/src/wallet-core'
import { beforeAll, describe, expect, it } from 'vitest'

import { getSuiChainSpecific } from '../../chainSpecific/resolvers/sui'
import { CoinSchema } from '../../../types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '../../../types/vultisig/keysign/v1/keysign_message_pb'
import { SignSuiSchema } from '../../../types/vultisig/keysign/v1/wasm_execute_contract_payload_pb'
import { compileTx } from '../../../tx/compile/compileTx'
import { getPreSigningHashes } from '../../../tx/preSigningHashes'
import { getEncodedSigningInputs } from '../index'
import { getSuiSigningInputs } from './sui'

// Deterministic Ed25519 key for the round-trip checks.
const EDDSA_PRIVATE_KEY = new Uint8Array(32).fill(1)

// A real BCS-serialized Sui `TransactionData` (base64), built offline with
// `@mysten/sui` (split + transfer with explicit gas data). The signing path
// must treat these bytes as opaque: hash them under the transaction intent and
// sign, never reconstructing a Pay / PaySui input.
const UNSIGNED_TX_MSG =
  'AAACAAhkAAAAAAAAAAAgW4yMD3sdSyqcPk9QYXKDlKW2x9jp8KGyw9Tl9gcYKTACAgABAQAAAQEDAAAAAAEBAFuMjA97HUsqnD5PUGFyg5SltsfY6fChssPU5fYHGCkwARERERERERERERERERERERERERERERERERERERERERERAQAAAAAAAAAgBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwdbjIwPex1LKpw+T1BhcoOUpbbH2OnwobLD1OX2BxgpMOgDAAAAAAAAwMYtAAAAAAAA'

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')

let walletCore: WalletCore
let publicKey: PublicKey
let signer: string

const buildSignSuiPayload = () =>
  create(KeysignPayloadSchema, {
    coin: create(CoinSchema, {
      chain: Chain.Sui,
      ticker: 'SUI',
      address: signer,
      decimals: 9,
      isNativeToken: true,
      hexPublicKey: hex(publicKey.data()),
    }),
    signData: {
      case: 'signSui',
      value: create(SignSuiSchema, { unsignedTxMsg: UNSIGNED_TX_MSG }),
    },
  })

beforeAll(async () => {
  walletCore = await initWasm()
  const privateKey = walletCore.PrivateKey.createWithData(EDDSA_PRIVATE_KEY)
  publicKey = privateKey.getPublicKeyEd25519()
  signer = walletCore.AnyAddress.createWithPublicKey(
    publicKey,
    getCoinType({ walletCore, chain: Chain.Sui })
  ).description()
})

describe('getSuiSigningInputs — signSui (pre-built PTB)', () => {
  it('forwards the PTB bytes verbatim via signDirectMessage', async () => {
    const [input] = await getSuiSigningInputs({
      keysignPayload: buildSignSuiPayload(),
      walletCore,
    })

    expect(input.signDirectMessage?.unsignedTxMsg).toBe(UNSIGNED_TX_MSG)
    expect(input.signer).toBe(signer)
    // It must not synthesize a native-send input.
    expect(input.pay).toBeFalsy()
    expect(input.paySui).toBeFalsy()
  })

  it('hashes to the transaction-intent digest (parity with the legacy path)', async () => {
    const [txInputData] = await getEncodedSigningInputs({
      keysignPayload: buildSignSuiPayload(),
      walletCore,
    })

    const hashes = getPreSigningHashes({
      walletCore,
      chain: Chain.Sui,
      txInputData,
    })

    const expected = getSuiTransactionDataDigest(new Uint8Array(Buffer.from(UNSIGNED_TX_MSG, 'base64')))

    expect(hashes).toHaveLength(1)
    expect(hex(hashes[0])).toBe(hex(expected))
  })

  it('compiles to a wallet-standard Ed25519 signature over the same bytes', async () => {
    const privateKey = walletCore.PrivateKey.createWithData(EDDSA_PRIVATE_KEY)
    const [txInputData] = await getEncodedSigningInputs({
      keysignPayload: buildSignSuiPayload(),
      walletCore,
    })

    const [digest] = getPreSigningHashes({
      walletCore,
      chain: Chain.Sui,
      txInputData,
    })

    // EdDSA 'raw' format: generateSignature reverses each 32-byte half, so the
    // MPC-supplied r/s are the reversed signature halves.
    const rawSignature = privateKey.sign(digest, walletCore.Curve.ed25519)
    const signatures = {
      [hex(digest)]: {
        msg: '',
        r: hex(rawSignature.slice(0, 32).reverse()),
        s: hex(rawSignature.slice(32, 64).reverse()),
        der_signature: '',
      },
    }

    const compiled = compileTx({
      publicKey,
      txInputData,
      signatures,
      chain: Chain.Sui,
      walletCore,
    })

    const output = TW.Sui.Proto.SigningOutput.decode(compiled)
    expect(output.unsignedTx).toBe(UNSIGNED_TX_MSG)

    // Wallet Standard wire signature: flag(1) || sig(64) || pubKey(32).
    const serialized = new Uint8Array(Buffer.from(output.signature, 'base64'))
    expect(serialized).toHaveLength(97)
    expect(serialized[0]).toBe(0x00)
    expect(hex(serialized.slice(65))).toBe(hex(publicKey.data()))
    expect(publicKey.verify(serialized.slice(1, 65), digest)).toBe(true)
  })
})

describe('getSuiSigningInputs — native send', () => {
  it('rejects a memo (Sui has no native memo field)', async () => {
    const keysignPayload = create(KeysignPayloadSchema, {
      coin: create(CoinSchema, {
        chain: Chain.Sui,
        ticker: 'SUI',
        address: signer,
        decimals: 9,
        isNativeToken: true,
        hexPublicKey: hex(publicKey.data()),
      }),
      memo: 'deposit-12345',
    })

    expect(() =>
      getSuiSigningInputs({ keysignPayload, walletCore })
    ).toThrow('do not support a memo')
  })
})

describe('getSuiChainSpecific — signSui (pre-built PTB)', () => {
  it('returns an empty SuiSpecific without touching the RPC', async () => {
    const chainSpecific = await getSuiChainSpecific({
      keysignPayload: buildSignSuiPayload(),
      walletCore,
    })

    expect(chainSpecific.coins).toHaveLength(0)
    expect(chainSpecific.referenceGasPrice).toBe('')
    expect(chainSpecific.gasBudget).toBe('')
  })
})
