import { Buffer } from 'buffer'

import { create } from '@bufbuild/protobuf'
import { deriveCardanoAddress } from '@vultisig/core-chain/publicKey/address/cardano'
import { initWasm, TW, type WalletCore } from '@trustwallet/wallet-core'
import { type PublicKey } from '@trustwallet/wallet-core/dist/src/wallet-core'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { Chain } from '@vultisig/core-chain/Chain'

import { getCardanoSigningInputs } from '../../signingInputs/resolvers/cardano'
import { buildCip20AuxData, patchTxBodyWithAuxHash } from '../../../tx/compile/cardano/buildCip20AuxData'
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

const buildPayload = ({
  walletCore,
  publicKey,
  recipient,
  utxoCount,
  memo,
}: {
  walletCore: WalletCore
  publicKey: PublicKey
  recipient: string
  utxoCount: number
  memo?: string
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
    toAmount: '1000000',
    memo,
    utxoInfo: Array.from({ length: utxoCount }, (_, index) => ({
      hash: (index + 1).toString(16).padStart(64, '0'),
      amount: 2_000_000n,
      index,
    })),
  })
}

const calculateWalletCoreBodyFee = async ({
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

  if (!keysignPayload.memo) {
    return CARDANO_A_PARAM * BigInt(preOutput.data.length) + CARDANO_B_PARAM
  }

  const { auxDataCbor, auxDataHash } = buildCip20AuxData(keysignPayload.memo)
  const patchedTxBodyCbor = patchTxBodyWithAuxHash(preOutput.data, auxDataHash)

  return CARDANO_A_PARAM * BigInt(patchedTxBodyCbor.length + auxDataCbor.length) + CARDANO_B_PARAM
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
      await calculateWalletCoreBodyFee({
        keysignPayload: oneInputPayload,
        walletCore,
        chainSpecific: oneInputSpecific,
      })
    )
    expect(manyInputSpecific.byteFee).toBe(
      await calculateWalletCoreBodyFee({
        keysignPayload: manyInputPayload,
        walletCore,
        chainSpecific: manyInputSpecific,
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
      await calculateWalletCoreBodyFee({ keysignPayload: memoPayload, walletCore, chainSpecific: memoSpecific })
    )
    expect(memoSpecific.byteFee).toBeGreaterThan(noMemoSpecific.byteFee)
  })
})
