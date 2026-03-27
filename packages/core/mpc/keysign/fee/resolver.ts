import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { Resolver } from '@vultisig/lib-utils/types/Resolver'
import { WalletCore } from '@trustwallet/wallet-core'
import { PublicKey } from '@trustwallet/wallet-core/dist/src/wallet-core'

type FeeAmountResolverInput = {
  keysignPayload: KeysignPayload
  walletCore: WalletCore
  publicKey: PublicKey
}

export type FeeAmountResolver = Resolver<FeeAmountResolverInput, bigint>
