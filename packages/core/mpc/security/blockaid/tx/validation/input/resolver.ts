import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { Resolver } from '@vultisig/lib-utils/types/Resolver'
import { WalletCore } from '@trustwallet/wallet-core'

import { BlockaidValidationSupportedChain } from '@vultisig/core-chain/security/blockaid/validationChains'
import { BlockaidTxValidationInput } from '@vultisig/core-chain/security/blockaid/tx/validation/resolver'

export type BlockaidTxValidationInputResolverInput<
  T extends BlockaidValidationSupportedChain = BlockaidValidationSupportedChain,
> = {
  payload: KeysignPayload
  walletCore: WalletCore
  chain: T
}

export type BlockaidTxValidationInputResolver<
  T extends BlockaidValidationSupportedChain = BlockaidValidationSupportedChain,
> = Resolver<
  {
    payload: KeysignPayload
    walletCore: WalletCore
    chain: T
  },
  BlockaidTxValidationInput['data'] | null
>
