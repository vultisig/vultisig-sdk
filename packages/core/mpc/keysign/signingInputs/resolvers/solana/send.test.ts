import { create } from '@bufbuild/protobuf'
import { initWasm, type WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { SolanaSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { beforeAll, describe, expect, it } from 'vitest'

import { getSolanaSendSigningInput } from './send'

const RECEIVER = 'GogodXVKU6KfeZiSR9oybanGGZXRuQ34ogb2i3f3WvYi'
const SENDER = '2rMJcuWtp29QSMNKZucumuznhq9gMPBvw98ZcGDfnJxa'
const MEMO = 'add:sol.sol:thor1lhufh0mwasa0lk9udppdegmvnkgqt08f0m9p5g'
const BLOCKHASH = '44jzmJEahEFTHexSNLkLfXXXyKggtpT2jJuJ3hdCBbsB'
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const FROM_ATA = '7uQp24mcoUe9MxPCabwq8b13mFrjVXfh2ZvYqsVYKkpd'
const TO_ATA = '4XqMxvLmUMxR1L6r7XZ5GnWy3Pna7BUuzrcLvm5Twr2T'

const buildSolanaSpecific = () =>
  create(SolanaSpecificSchema, {
    recentBlockHash: BLOCKHASH,
    priorityFee: '1000000',
    computeLimit: '100000',
  })

const buildPayload = ({
  contractAddress,
  fromTokenAssociatedAddress,
  toTokenAssociatedAddress,
}: {
  contractAddress?: string
  fromTokenAssociatedAddress?: string
  toTokenAssociatedAddress?: string
}) => {
  const solanaSpecific = buildSolanaSpecific()
  if (fromTokenAssociatedAddress) {
    solanaSpecific.fromTokenAssociatedAddress = fromTokenAssociatedAddress
  }
  if (toTokenAssociatedAddress) {
    solanaSpecific.toTokenAssociatedAddress = toTokenAssociatedAddress
  }

  return create(KeysignPayloadSchema, {
    coin: create(CoinSchema, {
      chain: Chain.Solana,
      ticker: contractAddress ? 'USDC' : 'SOL',
      address: SENDER,
      decimals: 6,
      contractAddress: contractAddress ?? '',
      isNativeToken: !contractAddress,
    }),
    toAddress: RECEIVER,
    toAmount: '1000000',
    memo: MEMO,
    blockchainSpecific: {
      case: 'solanaSpecific',
      value: solanaSpecific,
    },
  })
}

describe('getSolanaSendSigningInput memo handling', () => {
  let walletCore: WalletCore

  beforeAll(async () => {
    walletCore = await initWasm()
  })

  it('sets memo on native SOL transfer', () => {
    const input = getSolanaSendSigningInput({
      keysignPayload: buildPayload({}),
      walletCore,
    })

    expect(input.transferTransaction?.memo).toBe(MEMO)
  })

  it('sets memo on SPL token transfer when both ATAs are present', () => {
    const input = getSolanaSendSigningInput({
      keysignPayload: buildPayload({
        contractAddress: USDC_MINT,
        fromTokenAssociatedAddress: FROM_ATA,
        toTokenAssociatedAddress: TO_ATA,
      }),
      walletCore,
    })

    expect(input.tokenTransferTransaction?.memo).toBe(MEMO)
  })

  it('sets memo on SPL create-and-transfer when recipient ATA is missing', () => {
    const input = getSolanaSendSigningInput({
      keysignPayload: buildPayload({
        contractAddress: USDC_MINT,
        fromTokenAssociatedAddress: FROM_ATA,
      }),
      walletCore,
    })

    expect(input.createAndTransferTokenTransaction?.memo).toBe(MEMO)
  })
})
