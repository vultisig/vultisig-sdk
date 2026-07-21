import { Buffer } from 'buffer'
import { ChainKind, getChainKind } from '@vultisig/core-chain/ChainKind'
import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { WalletCore } from '@trustwallet/wallet-core'
import { PublicKey } from '@trustwallet/wallet-core/dist/src/wallet-core'

import { getKeysignChain } from '../utils/getKeysignChain'
import { signingInputClasses } from './core'
import { SigningInputsResolver } from './resolver'
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

/** Exported for alignment tests: every {@link ChainKind} must map to a resolver and a TW signing-input class. */
export const signingInputResolversByChainKind: Record<ChainKind, SigningInputsResolver<any>> = {
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
}

export const getEncodedSigningInputs = async (input: Input): Promise<Uint8Array[]> => {
  const chain = getKeysignChain(input.keysignPayload)
  const chainKind = getChainKind(chain)

  // dApp-supplied raw Solana transactions bypass TW SigningInput entirely
  // (sdk#1204): the txInputData IS the original serialized transaction, and
  // getPreSigningHashes / compileTx have matching signSolana branches that
  // sign the original message bytes verbatim and splice the signature back
  // in. Routing these through TransactionDecoder + SigningInput.rawMessage
  // made WalletCore RE-ENCODE the message, which is not guaranteed
  // byte-identical for v0+ALT transactions and broke mixed-vault co-signing
  // (iOS/Android already sign the original bytes — ios#4419, android#5223).
  if (chainKind === 'solana' && input.keysignPayload.signData.case === 'signSolana') {
    return input.keysignPayload.signData.value.rawTransactions.map(
      transaction => new Uint8Array(Buffer.from(transaction, 'base64'))
    )
  }

  const signingInputs = await signingInputResolversByChainKind[chainKind](input as any)

  // Bittensor returns pre-encoded Uint8Array (custom extrinsic builder, not TW proto)
  if (chainKind === 'bittensor' || chainKind === 'qbtc') {
    return signingInputs as unknown as Uint8Array[]
  }

  return signingInputs.map(signingInput => {
    const SigningInputClass = signingInputClasses[chainKind]
    return SigningInputClass.encode(signingInput).finish()
  })
}
