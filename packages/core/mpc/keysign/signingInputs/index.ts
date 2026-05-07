import { ChainKind, getChainKind } from '@vultisig/core-chain/ChainKind'
import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { WalletCore } from '@trustwallet/wallet-core'
import { PublicKey } from '@trustwallet/wallet-core/dist/src/wallet-core'

import { getKeysignChain } from '../utils/getKeysignChain'
import { signingInputClasses } from './core'
import { AsyncSigningInputsResolver, SigningInputsResolver } from './resolver'
import { getBittensorSigningInputs } from './resolvers/bittensor'
import { getCardanoSigningInputs } from './resolvers/cardano'
import { getCosmosSigningInputs } from './resolvers/cosmos'
import { getEvmSigningInputs } from './resolvers/evm'
import { getPolkadotSigningInputs } from './resolvers/polkadot'
import { getQbtcSigningInputs } from './resolvers/qbtc'
import { getRippleSigningInputs } from './resolvers/ripple'
import { getSolanaSigningInputs } from './resolvers/solana'
import { getSuiSigningInputs } from './resolvers/sui'
import { getTonSigningInputs } from './resolvers/ton'
import { getTronSigningInputs } from './resolvers/tron'
import { getUtxoSigningInputs } from './resolvers/utxo'

type Input = {
  keysignPayload: KeysignPayload
  walletCore: WalletCore
  publicKey?: PublicKey
}

type AnyResolver =
  | SigningInputsResolver<any>
  | AsyncSigningInputsResolver<any>

const resolvers: Record<ChainKind, AnyResolver> = {
  bittensor: getBittensorSigningInputs,
  cardano: getCardanoSigningInputs,
  cosmos: getCosmosSigningInputs,
  evm: getEvmSigningInputs,
  polkadot: getPolkadotSigningInputs,
  qbtc: getQbtcSigningInputs,
  ripple: getRippleSigningInputs,
  solana: getSolanaSigningInputs,
  sui: getSuiSigningInputs,
  ton: getTonSigningInputs,
  utxo: getUtxoSigningInputs,
  tron: getTronSigningInputs,
} as Record<ChainKind, AnyResolver>

const encodeResolverOutput = (
  chainKind: ChainKind,
  signingInputs: any[]
): Uint8Array[] => {
  // Bittensor returns pre-encoded Uint8Array (custom extrinsic builder, not TW proto)
  if (chainKind === 'bittensor' || chainKind === 'qbtc') {
    return signingInputs as unknown as Uint8Array[]
  }

  return signingInputs.map(signingInput => {
    const SigningInputClass = signingInputClasses[chainKind]
    return SigningInputClass.encode(signingInput).finish()
  })
}

/**
 * Sync entry point. Use when you know the chain isn't Cardano — Cardano's
 * resolver is async (it fetches per-UTXO assets from Koios at sign time so
 * the planner can balance CNT outputs) and will throw if invoked here.
 * Blockaid input builders use this because Cardano isn't in the supported
 * chains for either simulation or validation.
 */
export const getEncodedSigningInputs = (input: Input): Uint8Array[] => {
  const chain = getKeysignChain(input.keysignPayload)
  const chainKind = getChainKind(chain)

  const result = resolvers[chainKind](input as any)
  if (typeof (result as any)?.then === 'function') {
    throw new Error(
      `getEncodedSigningInputs: chain ${chain} requires async resolution; call getEncodedSigningInputsAsync instead`
    )
  }

  return encodeResolverOutput(chainKind, result as any[])
}

/**
 * Async entry point. The keysign flow (cosigner, TransactionBuilder, broadcast)
 * uses this so Cardano's per-UTXO Koios fetch can run; non-Cardano chains
 * resolve synchronously and the await is a no-op.
 */
export const getEncodedSigningInputsAsync = async (
  input: Input
): Promise<Uint8Array[]> => {
  const chain = getKeysignChain(input.keysignPayload)
  const chainKind = getChainKind(chain)

  const signingInputs = await resolvers[chainKind](input as any)

  return encodeResolverOutput(chainKind, signingInputs as any[])
}
