import { Buffer } from 'buffer'

import { create } from '@bufbuild/protobuf'
import { deriveCardanoAddress } from '@vultisig/core-chain/publicKey/address/cardano'
import { initWasm, TW, type WalletCore } from '@trustwallet/wallet-core'
import { type PublicKey } from '@trustwallet/wallet-core/dist/src/wallet-core'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { Chain } from '@vultisig/core-chain/Chain'

import { getCardanoSigningInputs } from '../../signingInputs/resolvers/cardano'
import { buildCip20AuxData } from '../../../tx/compile/cardano/buildCip20AuxData'
import { buildSignedCardanoTx } from '../../../tx/compile/cardano/buildSignedCardanoTx'
import { CardanoChainSpecific } from '../../../types/vultisig/keysign/v1/blockchain_specific_pb'
import { CoinSchema } from '../../../types/vultisig/keysign/v1/coin_pb'
import { KeysignPayload, KeysignPayloadSchema } from '../../../types/vultisig/keysign/v1/keysign_message_pb'
import { getCardanoChainSpecific } from './cardano'

vi.mock('@vultisig/core-chain/chains/cardano/client/currentSlot', () => ({
  getCardanoCurrentSlot: vi.fn(async () => 500_000n),
}))

const CARDANO_A_PARAM = 44n
const CARDANO_B_PARAM = 155_381n

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')

const cardanoPublicKeyFromSeed = (walletCore: WalletCore, seed: number, chainCodeByte: number) => {
  const privateKey = walletCore.PrivateKey.createWithData(new Uint8Array(32).fill(seed))
  const spendingKey = Buffer.from(privateKey.getPublicKeyEd25519().data())
  const chainCode = Buffer.alloc(32, chainCodeByte)

  return walletCore.PublicKey.createWithData(
    new Uint8Array([...spendingKey, ...spendingKey, ...chainCode, ...chainCode]),
    walletCore.PublicKeyType.ed25519Cardano
  )
}

const UTXO_AMOUNT = 2_000_000n

const buildPayload = ({
  walletCore,
  publicKey,
  recipient,
  utxoCount,
  memo,
  toAmount = '1000000',
}: {
  walletCore: WalletCore
  publicKey: PublicKey
  recipient: string
  utxoCount: number
  memo?: string
  toAmount?: string
}) => {
  const sender = deriveCardanoAddress({ publicKey, walletCore })

  return create(KeysignPayloadSchema, {
    coin: create(CoinSchema, {
      chain: Chain.Cardano,
      ticker: 'ADA',
      address: sender,
      contractAddress: '',
      decimals: 6,
      isNativeToken: true,
      hexPublicKey: hex(new Uint8Array(publicKey.data())),
    }),
    toAddress: recipient,
    toAmount,
    memo,
    utxoInfo: Array.from({ length: utxoCount }, (_, index) => ({
      hash: (index + 1).toString(16).padStart(64, '0'),
      amount: UTXO_AMOUNT,
      index,
    })),
  })
}

const planCardanoTx = async ({
  keysignPayload,
  walletCore,
  chainSpecific,
}: {
  keysignPayload: KeysignPayload
  walletCore: WalletCore
  chainSpecific: CardanoChainSpecific
}) => {
  const [signingInput] = await getCardanoSigningInputs({
    keysignPayload: {
      ...keysignPayload,
      blockchainSpecific: { case: 'cardano', value: chainSpecific },
    },
    walletCore,
  })
  const encoded = TW.Cardano.Proto.SigningInput.encode(signingInput).finish()
  return TW.Cardano.Proto.TransactionPlan.decode(walletCore.AnySigner.plan(encoded, walletCore.CoinType.cardano))
}

const calculateFinalSignedTxFee = async ({
  keysignPayload,
  walletCore,
  chainSpecific,
  publicKey,
}: {
  keysignPayload: KeysignPayload
  walletCore: WalletCore
  chainSpecific: CardanoChainSpecific
  publicKey: PublicKey
}) => {
  const [signingInput] = await getCardanoSigningInputs({
    keysignPayload: {
      ...keysignPayload,
      blockchainSpecific: {
        case: 'cardano',
        value: chainSpecific,
      },
    },
    walletCore,
  })
  const txInputData = TW.Cardano.Proto.SigningInput.encode(signingInput).finish()
  const preOutput = TW.TxCompiler.Proto.PreSigningOutput.decode(
    walletCore.TransactionCompiler.preImageHashes(walletCore.CoinType.cardano, txInputData)
  )

  const publicKeyBytes = new Uint8Array(publicKey.data()).slice(0, 32)
  const signature = new Uint8Array(64)

  if (!keysignPayload.memo) {
    const signedTx = buildSignedCardanoTx({ txBodyCbor: preOutput.data, publicKey: publicKeyBytes, signature })

    return CARDANO_A_PARAM * BigInt(signedTx.length) + CARDANO_B_PARAM
  }

  // WalletCore already committed the aux hash into the body (key 7) from
  // SigningInput.auxiliary_data, so use it as-is and embed the aux-data bytes.
  const { auxDataCbor } = buildCip20AuxData(keysignPayload.memo)
  const signedTx = buildSignedCardanoTx({
    txBodyCbor: preOutput.data,
    publicKey: publicKeyBytes,
    signature,
    auxDataCbor,
  })

  return CARDANO_A_PARAM * BigInt(signedTx.length) + CARDANO_B_PARAM
}

describe('getCardanoChainSpecific', () => {
  let walletCore: WalletCore
  let publicKey: PublicKey
  let recipient: string

  beforeAll(async () => {
    walletCore = await initWasm()
    publicKey = cardanoPublicKeyFromSeed(walletCore, 1, 2)
    recipient = deriveCardanoAddress({
      publicKey: cardanoPublicKeyFromSeed(walletCore, 2, 3),
      walletCore,
    })
  })

  it('prices the fee from WalletCore tx body size instead of a flat default', async () => {
    const oneInputPayload = buildPayload({ walletCore, publicKey, recipient, utxoCount: 1 })
    const manyInputPayload = buildPayload({ walletCore, publicKey, recipient, utxoCount: 6 })

    const oneInputSpecific = await getCardanoChainSpecific({ keysignPayload: oneInputPayload, walletCore })
    const manyInputSpecific = await getCardanoChainSpecific({ keysignPayload: manyInputPayload, walletCore })

    expect(oneInputSpecific.byteFee).toBe(
      await calculateFinalSignedTxFee({
        keysignPayload: oneInputPayload,
        walletCore,
        chainSpecific: oneInputSpecific,
        publicKey,
      })
    )
    expect(manyInputSpecific.byteFee).toBe(
      await calculateFinalSignedTxFee({
        keysignPayload: manyInputPayload,
        walletCore,
        chainSpecific: manyInputSpecific,
        publicKey,
      })
    )
    expect(manyInputSpecific.byteFee).toBeGreaterThan(oneInputSpecific.byteFee)
  })

  it('includes memo aux-data bytes in the Cardano fee', async () => {
    const noMemoPayload = buildPayload({ walletCore, publicKey, recipient, utxoCount: 1 })
    const memoPayload = buildPayload({ walletCore, publicKey, recipient, utxoCount: 1, memo: 'vultisig-test' })

    const noMemoSpecific = await getCardanoChainSpecific({ keysignPayload: noMemoPayload, walletCore })
    const memoSpecific = await getCardanoChainSpecific({ keysignPayload: memoPayload, walletCore })

    expect(memoSpecific.byteFee).toBe(
      await calculateFinalSignedTxFee({
        keysignPayload: memoPayload,
        walletCore,
        chainSpecific: memoSpecific,
        publicKey,
      })
    )
    expect(memoSpecific.byteFee).toBeGreaterThan(noMemoSpecific.byteFee)
  })

  // sdk#1382: a send-max used to pair useMaxAmount+forceFee, which WalletCore's
  // Cardano planner resolves to fee=0 (an unbroadcastable tx). The fix builds an
  // explicit (totalInput - fee) transfer so the planner yields a real fee.
  it('builds a send-max with a real (non-zero) fee and no change output', async () => {
    const total = UTXO_AMOUNT * 3n
    const maxPayload = buildPayload({
      walletCore,
      publicKey,
      recipient,
      utxoCount: 3,
      toAmount: total.toString(),
    })

    const specific = await getCardanoChainSpecific({ keysignPayload: maxPayload, walletCore })
    expect(specific.sendMaxAmount).toBe(true)
    expect(specific.byteFee).toBeGreaterThan(0n)

    const plan = await planCardanoTx({ keysignPayload: maxPayload, walletCore, chainSpecific: specific })

    expect(plan.error).toBe(TW.Common.Proto.SigningError.OK)
    const fee = BigInt(plan.fee.toString())
    const amount = BigInt(plan.amount.toString())
    // The whole point of the fix: a broadcastable fee, not zero.
    expect(fee).toBeGreaterThan(0n)
    expect(fee).toBe(specific.byteFee)
    // Max-send consumes the full balance: recipient gets (total - fee), no change.
    expect(BigInt(plan.change.toString())).toBe(0n)
    expect(amount + fee).toBe(total)
  })

  it('leaves a regular (non-max) send unchanged: recipient gets exactly toAmount', async () => {
    const payload = buildPayload({ walletCore, publicKey, recipient, utxoCount: 3, toAmount: '1500000' })

    const specific = await getCardanoChainSpecific({ keysignPayload: payload, walletCore })
    expect(specific.sendMaxAmount).toBe(false)

    const plan = await planCardanoTx({ keysignPayload: payload, walletCore, chainSpecific: specific })

    expect(plan.error).toBe(TW.Common.Proto.SigningError.OK)
    expect(BigInt(plan.amount.toString())).toBe(1_500_000n)
    expect(BigInt(plan.fee.toString())).toBeGreaterThan(0n)
  })
})
