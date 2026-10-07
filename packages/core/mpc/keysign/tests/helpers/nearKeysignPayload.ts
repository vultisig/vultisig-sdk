import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import {
  AMOUNT,
  BLOCK_HASH,
  NAMED_GAS_FEE,
  NAMED_RECEIVER,
  NONCE,
  SENDER,
  SENDER_PUBLIC_KEY,
} from '@vultisig/core-chain/chains/near/__tests__/nearRpcTestKit'
import { NearSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { Buffer } from 'buffer'
import { createHash } from 'crypto'

export const buildNearKeysignPayload = ({
  toAddress = NAMED_RECEIVER,
  toAmount = AMOUNT,
  gasFee = NAMED_GAS_FEE.toString(),
  nonce = BigInt(NONCE),
  blockHash = Buffer.from(createHash('sha256').update(BLOCK_HASH).digest()),
  isNativeToken = true,
}: {
  toAddress?: string
  toAmount?: string
  gasFee?: string
  nonce?: bigint
  blockHash?: Uint8Array
  isNativeToken?: boolean
} = {}) =>
  create(KeysignPayloadSchema, {
    coin: create(CoinSchema, {
      chain: Chain.Near,
      ticker: 'NEAR',
      address: SENDER,
      decimals: 24,
      isNativeToken,
      hexPublicKey: SENDER_PUBLIC_KEY,
    }),
    toAddress,
    toAmount,
    blockchainSpecific: {
      case: 'nearSpecific',
      value: create(NearSpecificSchema, {
        nonce,
        blockHash,
        gasFee,
      }),
    },
  })
