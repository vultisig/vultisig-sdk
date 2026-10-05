import { Buffer } from 'buffer'
import { toBinary } from '@bufbuild/protobuf'
import { ChainKind, getChainKind } from '@vultisig/core-chain/ChainKind'
import { KeysignPayload, KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { WalletCore } from '@trustwallet/wallet-core'
import { PublicKey } from '@trustwallet/wallet-core/dist/src/wallet-core'

import {
  getSwapKitCardanoPrebuiltPayload,
  getSwapKitCardanoPrebuiltSigningInput,
} from '../../tx/swapkitCardanoPrebuilt'
import { getKeysignTonGasless } from '../ton/gasless'
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

  // A relayed (gasless) TON request is a W5 `internal_signed` body WalletCore
  // cannot build, so — like QBTC — the payload itself is the signing input:
  // getPreSigningHashes and compileTx hash and assemble it from the payload.
  if (chainKind === 'ton' && getKeysignTonGasless(input.keysignPayload)) {
    return [toBinary(KeysignPayloadSchema, input.keysignPayload)]
  }

  // SwapKit pre-built Cardano transaction (sdk#2468): the txInputData IS
  // SwapKit's unsigned CBOR envelope, and getPreSigningHashes / compileTx have
  // matching branches that hash its body verbatim and splice the witness back
  // in. Resolving it into a TW SigningInput would rebuild a native send from
  // toAddress / toAmount / utxoInfo — a different body, so a different digest
  // than the one iOS / Android peers sign. The body is validated here against
  // the caller's own vault key, not the payload's coin (which a co-signer
  // receives from the initiator), so an unexpected transaction never yields a
  // hash to sign.
  const swapKitCardanoPrebuilt = getSwapKitCardanoPrebuiltPayload(input.keysignPayload)
  if (swapKitCardanoPrebuilt) {
    if (!input.publicKey) {
      throw new Error('publicKey is required to validate a SwapKit pre-built Cardano transaction')
    }

    return [
      getSwapKitCardanoPrebuiltSigningInput({
        swapKitPayload: swapKitCardanoPrebuilt,
        // The extended ed25519Cardano key leads with the 32-byte spending key.
        vaultPublicKey: new Uint8Array(input.publicKey.data()).slice(0, 32),
      }),
    ]
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
