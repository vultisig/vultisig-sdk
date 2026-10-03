import { Buffer } from 'buffer'
import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { isNearAccountId, isNearImplicitAccountId } from '@vultisig/core-chain/chains/near/accountId'
import { getNearAccessKey, getNearFeeConfig, getNearFinalBlock } from '@vultisig/core-chain/chains/near/api'
import { getNearGasReservation } from '@vultisig/core-chain/chains/near/fees'
import { NearUnknownEntityError } from '@vultisig/core-chain/chains/near/rpc'
import { NearSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import bs58 from 'bs58'

import { GetChainSpecificResolver } from '../resolver'

const HEX_PUBLIC_KEY = /^[0-9a-f]{64}$/
const MAX_U64 = (1n << 64n) - 1n

/**
 * Native NEAR preparation: freezes, once, the two values a NEAR transaction cannot
 * re-fetch — the transaction nonce and the final block hash — plus the gas
 * reservation signing only displays. Unknown account or key, a function-call key
 * and an out-of-grammar recipient all stop the build before review.
 */
export const getNearChainSpecific: GetChainSpecificResolver<'nearSpecific'> = async ({ keysignPayload }) => {
  const coin = shouldBePresent(keysignPayload.coin)

  if (coin.chain !== Chain.Near || !coin.isNativeToken) {
    throw new Error('NEAR preparation supports native NEAR transfers only')
  }

  const sender = shouldBePresent(coin.address, 'NEAR sender address')
  const hexPublicKey = shouldBePresent(coin.hexPublicKey, 'NEAR sender public key')
  const receiver = keysignPayload.toAddress

  if (!isNearAccountId(receiver)) {
    throw new Error(`Invalid NEAR recipient account id: ${receiver}`)
  }

  if (!HEX_PUBLIC_KEY.test(hexPublicKey)) {
    throw new Error(`Invalid NEAR public key: ${hexPublicKey} is not a 32-byte Ed25519 key in lowercase hex`)
  }

  const [accessKey, block, fees] = await Promise.all([
    getNearAccessKey(sender, hexPublicKey),
    getNearFinalBlock(),
    getNearFeeConfig(),
  ])

  if (!accessKey) {
    throw new NearUnknownEntityError(
      'access key',
      `NEAR account ${sender} does not hold the signing key ${hexPublicKey}`
    )
  }

  if (!accessKey.isFullAccess) {
    throw new Error(`NEAR signing key for ${sender} is a function-call key; a native transfer needs full access`)
  }

  if (accessKey.nonce === MAX_U64) {
    throw new Error(`NEAR access key nonce for ${sender} has no successor in the uint64 field: ${accessKey.nonce}`)
  }

  const { reserved } = getNearGasReservation({
    fees,
    gasPrice: block.gasPrice,
    senderIsReceiver: sender === receiver,
    receiverIsImplicit: isNearImplicitAccountId(receiver),
  })

  return create(NearSpecificSchema, {
    // The access-key nonce is not itself a valid transaction nonce: nearcore's
    // `verify_nonce` rejects `tx_nonce <= ak_nonce` (runtime/runtime/src/verifier.rs).
    nonce: accessKey.nonce + 1n,
    blockHash: new Uint8Array(bs58.decode(block.hash)),
    gasFee: reserved.toString(),
  })
}
