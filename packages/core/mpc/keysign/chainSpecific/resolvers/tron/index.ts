import { create } from '@bufbuild/protobuf'
import { getTronBlockInfo } from '@vultisig/core-chain/chains/tron/getTronBlockInfo'
import { getTronAccountResources } from '@vultisig/core-chain/chains/tron/resources/getTronAccountResources'
import { isFeeCoin } from '@vultisig/core-chain/coin/utils/isFeeCoin'
import { TronSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'

import { getKeysignAmount } from '../../../utils/getKeysignAmount'
import { getKeysignCoin } from '../../../utils/getKeysignCoin'
import { GetChainSpecificResolver } from '../../resolver'
import { getTrc20TransferFee } from './fee'

// Worst-case fee when sender has exhausted bandwidth (300 bytes * 1000 sun/byte)
const NATIVE_TRX_SEND_FEE_FALLBACK = 800_000n

// Native TRX transfer is ~270-345 bytes; use 300 as the threshold (mirrors iOS BYTES_PER_COIN_TX)
const BYTES_PER_NATIVE_TRX_TX = 300

const getNativeTronSendFee = async (fromAddress: string): Promise<bigint> => {
  try {
    const resources = await getTronAccountResources(fromAddress)
    if (resources.bandwidth.available >= BYTES_PER_NATIVE_TRX_TX) {
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
      return getNativeTronSendFee(coin.address)
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
