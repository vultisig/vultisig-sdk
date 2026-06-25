import { Chain } from '@vultisig/core-chain/Chain'
import { fromBinary } from '@bufbuild/protobuf'
import { decodeBittensorTxInput } from '../../keysign/signingInputs/resolvers/bittensor'
import { computePreSigningHashes } from '../../keysign/signingInputs/resolvers/bitcoin/sighash'
import { getQBTCPreSignedImageHash } from '../../chains/cosmos/qbtc/QBTCHelper'
import { without } from '@vultisig/lib-utils/array/without'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { blake2AsU8a } from '@polkadot/util-crypto'
import { WalletCore } from '@trustwallet/wallet-core'
import { getBlockchainSpecificValue } from '../../keysign/chainSpecific/KeysignChainSpecific'
import { getPreSigningOutput } from '../../keysign/preSigningOutput'
import { KeysignPayload, KeysignPayloadSchema } from '../../types/vultisig/keysign/v1/keysign_message_pb'
import { getSwapKitSignBitcoin } from '../swapkitSignBitcoin'

type Input = {
  walletCore: WalletCore
  chain: Chain
  txInputData: Uint8Array
  keysignPayload?: KeysignPayload
}

const sortHashes = (hashes: Uint8Array[]): Uint8Array[] =>
  [...hashes].sort((one, another) => Buffer.from(one).compare(Buffer.from(another)))

export const getPreSigningHashes = ({ walletCore, txInputData, chain, keysignPayload }: Input) => {
  const signBitcoin = keysignPayload ? getSwapKitSignBitcoin(keysignPayload) : undefined

  // PSBT signing: compute BIP-143 sighashes directly from structured data.
  // Sort the public ceremony hashes for deterministic cross-platform order;
  // final PSBT assembly still maps signatures by hash and preserves input order.
  if (signBitcoin) {
    return sortHashes(computePreSigningHashes(signBitcoin))
  }

  if (chain === Chain.QBTC) {
    const qbtcPayload = fromBinary(KeysignPayloadSchema, txInputData)
    const cosmosSpecific = getBlockchainSpecificValue(qbtcPayload.blockchainSpecific, 'cosmosSpecific')
    return getQBTCPreSignedImageHash({ keysignPayload: qbtcPayload, cosmosSpecific })
  }

  if (chain === Chain.Bittensor) {
    const { payload } = decodeBittensorTxInput(txInputData)
    const toSign = payload.length > 256 ? blake2AsU8a(payload, 256) : payload
    return [toSign]
  }

  const output = getPreSigningOutput({
    walletCore,
    txInputData,
    chain,
  })

  if ('preSigningResultV2' in output && output.preSigningResultV2 !== null) {
    const preSigningResultV2 = shouldBePresent(output.preSigningResultV2)
    const sighashes = shouldBePresent(preSigningResultV2.sighashes)
    return without(
      sighashes.map(hash => hash?.sighash),
      null,
      undefined
    )
  }

  if ('hashPublicKeys' in output) {
    return without(
      output.hashPublicKeys.map(hash => hash?.dataHash),
      null,
      undefined
    )
  }

  const { data } = output

  if ('dataHash' in output && output.dataHash.length > 0) {
    return [output.dataHash]
  }

  return [data]
}
