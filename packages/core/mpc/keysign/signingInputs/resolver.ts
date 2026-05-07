import { ChainKind } from '@vultisig/core-chain/ChainKind'
import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { Resolver } from '@vultisig/lib-utils/types/Resolver'
import { WalletCore } from '@trustwallet/wallet-core'
import { PublicKey } from '@trustwallet/wallet-core/dist/src/wallet-core'

import { SigningInput } from './core'

type SigningInputsResolverInput<T extends ChainKind> = {
  keysignPayload: KeysignPayload
  walletCore: WalletCore
} & (T extends 'utxo' ? { publicKey: PublicKey } : {})

export type SigningInputsResolver<T extends ChainKind> = Resolver<
  SigningInputsResolverInput<T>,
  SigningInput<T>[]
>

/**
 * Variant for resolvers that need to do async work (e.g. fetching per-UTXO
 * assets from Koios for Cardano CNT sends so the planner can balance the
 * TokenBundle output). Used by `getCardanoSigningInputs`. The async dispatcher
 * (`getEncodedSigningInputsAsync`) awaits unconditionally; the sync dispatcher
 * (`getEncodedSigningInputs`) throws if a resolver returns a Promise so
 * non-Cardano callers (Blockaid) keep their sync surface.
 */
export type AsyncSigningInputsResolver<T extends ChainKind> = Resolver<
  SigningInputsResolverInput<T>,
  Promise<SigningInput<T>[]>
>
