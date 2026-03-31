import { Chain } from '../Chain'
import { ChainKind, getChainKind } from '../ChainKind'

export const signingAlgorithms = ['ecdsa', 'eddsa'] as const

export type SignatureAlgorithm = (typeof signingAlgorithms)[number] | 'mldsa'

export const signatureAlgorithms: Record<ChainKind, SignatureAlgorithm> = {
  evm: 'ecdsa',
  utxo: 'ecdsa',
  cosmos: 'ecdsa',
  sui: 'eddsa',
  solana: 'eddsa',
  polkadot: 'eddsa',
  bittensor: 'eddsa',
  ton: 'eddsa',
  ripple: 'ecdsa',
  tron: 'ecdsa',
  cardano: 'eddsa',
  qbtc: 'mldsa',
}

export const getSignatureAlgorithm = (chain: Chain): SignatureAlgorithm =>
  signatureAlgorithms[getChainKind(chain)]
