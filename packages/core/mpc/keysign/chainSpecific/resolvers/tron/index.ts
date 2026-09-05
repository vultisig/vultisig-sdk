import { Buffer } from 'buffer'

import { create } from '@bufbuild/protobuf'
import { getTronBlockInfo } from '@vultisig/core-chain/chains/tron/getTronBlockInfo'
import { getTronAccountResources } from '@vultisig/core-chain/chains/tron/resources/getTronAccountResources'
import { isFeeCoin } from '@vultisig/core-chain/coin/utils/isFeeCoin'
import { TronSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { TW, type WalletCore } from '@trustwallet/wallet-core'
import Long from 'long'

import { getKeysignAmount } from '../../../utils/getKeysignAmount'
import { getKeysignCoin } from '../../../utils/getKeysignCoin'
import { GetChainSpecificResolver } from '../../resolver'
import { getTrc20TransferFee } from './fee'

// Worst-case fee when sender has exhausted bandwidth. A native TRX transfer
// is ~267-345 bytes on-wire (signed size); at 1000 sun/byte that's ~267k-345k
// sun. 800_000n keeps the pre-existing margin (~2.4× the median signed size)
// and guards against governance-driven bandwidth price hikes.
const NATIVE_TRX_SEND_FEE_FALLBACK = 800_000n

const TRON_SIGNATURE_BYTES = 65
// java-tron charges one 64-byte transaction-result allowance per contract in
// addition to the serialized signed transaction bytes. A native transfer has
// exactly one contract.
const TRON_TRANSACTION_RESULT_BYTES = 64

const getProtoVarintSize = (value: number): number => {
  let size = 1
  while (value >= 128) {
    value = Math.floor(value / 128)
    size += 1
  }
  return size
}

const getLengthDelimitedFieldSize = (valueSize: number): number => 1 + getProtoVarintSize(valueSize) + valueSize

type NativeTronBandwidthInput = {
  walletCore: WalletCore
  fromAddress: string
  toAddress: string
  amount: bigint
  memo: string
  blockInfo: Awaited<ReturnType<typeof getTronBlockInfo>>
}

/**
 * TRON charges bandwidth for the serialized signed transaction, not for a
 * fixed transfer template. WalletCore exposes the exact raw_data bytes through
 * its pre-signing output; the remaining signed envelope consists of the
 * length-delimited raw_data field and one 65-byte secp256k1 signature.
 */
export const getNativeTronBandwidthBytes = ({
  walletCore,
  fromAddress,
  toAddress,
  amount,
  memo,
  blockInfo,
}: NativeTronBandwidthInput): number => {
  const signingInput = TW.Tron.Proto.SigningInput.create({
    transaction: TW.Tron.Proto.Transaction.create({
      transfer: TW.Tron.Proto.TransferContract.create({
        ownerAddress: fromAddress,
        toAddress,
        amount: Long.fromString(amount.toString()),
      }),
      timestamp: Long.fromNumber(blockInfo.timestamp),
      expiration: Long.fromNumber(blockInfo.expiration),
      blockHeader: TW.Tron.Proto.BlockHeader.create({
        timestamp: Long.fromNumber(blockInfo.blockHeaderTimestamp),
        number: Long.fromNumber(blockInfo.blockHeaderNumber),
        version: blockInfo.blockHeaderVersion,
        txTrieRoot: Buffer.from(blockInfo.blockHeaderTxTrieRoot, 'hex'),
        parentHash: Buffer.from(blockInfo.blockHeaderParentHash, 'hex'),
        witnessAddress: Buffer.from(blockInfo.blockHeaderWitnessAddress, 'hex'),
      }),
      memo,
    }),
  })
  const preSigningOutput = TW.TxCompiler.Proto.PreSigningOutput.decode(
    walletCore.TransactionCompiler.preImageHashes(
      walletCore.CoinType.tron,
      TW.Tron.Proto.SigningInput.encode(signingInput).finish()
    )
  )

  if (preSigningOutput.errorMessage) {
    throw new Error(preSigningOutput.errorMessage)
  }

  return (
    getLengthDelimitedFieldSize(preSigningOutput.data.length) +
    getLengthDelimitedFieldSize(TRON_SIGNATURE_BYTES) +
    TRON_TRANSACTION_RESULT_BYTES
  )
}

const getNativeTronSendFee = async (input: NativeTronBandwidthInput): Promise<bigint> => {
  try {
    const requiredBandwidth = getNativeTronBandwidthBytes(input)
    const resources = await getTronAccountResources(input.fromAddress)
    if (resources.bandwidth.available >= requiredBandwidth) {
      return 0n
    }
    return NATIVE_TRX_SEND_FEE_FALLBACK
  } catch {
    // RPC error — don't block the send, fall back to worst-case estimate
    return NATIVE_TRX_SEND_FEE_FALLBACK
  }
}

export const getTronChainSpecific: GetChainSpecificResolver<'tronSpecific'> = async ({
  keysignPayload,
  walletCore,
  thirdPartyGasLimitEstimation,
  expiration,
  timestamp,
  refBlockBytesHex,
  refBlockHashHex,
}) => {
  const coin = getKeysignCoin(keysignPayload)

  const blockInfo = await getTronBlockInfo({
    expiration,
    timestamp,
    refBlockBytesHex,
    refBlockHashHex,
  })

  const getGasEstimation = async () => {
    if (thirdPartyGasLimitEstimation) {
      return thirdPartyGasLimitEstimation
    }
    if (isFeeCoin(coin)) {
      return getNativeTronSendFee({
        walletCore,
        fromAddress: shouldBePresent(coin.address),
        toAddress: shouldBePresent(keysignPayload.toAddress),
        amount: getKeysignAmount(keysignPayload),
        memo: keysignPayload.memo ?? '',
        blockInfo,
      })
    }

    return getTrc20TransferFee({
      coin,
      receiver: keysignPayload.toAddress,
      amount: getKeysignAmount(keysignPayload),
    })
  }

  return create(TronSpecificSchema, {
    timestamp: BigInt(blockInfo.timestamp),
    expiration: BigInt(blockInfo.expiration),
    blockHeaderTimestamp: BigInt(blockInfo.blockHeaderTimestamp),
    blockHeaderNumber: BigInt(blockInfo.blockHeaderNumber),
    blockHeaderVersion: BigInt(blockInfo.blockHeaderVersion),
    blockHeaderTxTrieRoot: blockInfo.blockHeaderTxTrieRoot,
    blockHeaderParentHash: blockInfo.blockHeaderParentHash,
    blockHeaderWitnessAddress: blockInfo.blockHeaderWitnessAddress,
    gasEstimation: await getGasEstimation(),
  })
}
