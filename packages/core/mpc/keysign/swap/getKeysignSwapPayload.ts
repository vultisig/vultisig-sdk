import { Chain } from '@vultisig/core-chain/Chain'
import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { matchDiscriminatedUnion } from '@vultisig/lib-utils/matchDiscriminatedUnion'

import { KeysignSwapPayload } from './KeysignSwapPayload'

type NativeKeysignSwapPayload = Extract<KeysignSwapPayload, { native: unknown }>['native']

type IsSecuredAssetWithdrawalInput = {
  chain: Chain
  keysignPayload: KeysignPayload
  native?: NativeKeysignSwapPayload | null
}

export const isSecuredAssetWithdrawal = ({ chain, keysignPayload, native }: IsSecuredAssetWithdrawalInput): boolean =>
  !!native &&
  chain === Chain.THORChain &&
  native.chain === Chain.THORChain &&
  native.expirationTime === 0n &&
  native.vaultAddress === '' &&
  native.routerAddress === '' &&
  keysignPayload.toAddress === '' &&
  !!keysignPayload.memo?.toLowerCase().startsWith('secure-:') &&
  keysignPayload.blockchainSpecific.case === 'thorchainSpecific' &&
  keysignPayload.blockchainSpecific.value.isDeposit &&
  !!native.fromCoin &&
  native.fromCoin.chain !== Chain.THORChain &&
  typeof native.fromCoin.ticker === 'string' &&
  !!native.fromCoin.ticker.trim() &&
  /^[0-9]+$/.test(native.fromAmount) &&
  BigInt(native.fromAmount) > 0n &&
  native.fromAmount === keysignPayload.toAmount

export const getKeysignSwapPayload = ({
  swapPayload,
}: Pick<KeysignPayload, 'swapPayload'>): KeysignSwapPayload | undefined => {
  if (!swapPayload || !swapPayload.case || !swapPayload.value) {
    return undefined
  }

  return matchDiscriminatedUnion(swapPayload, 'case', 'value', {
    thorchainSwapPayload: value => ({
      native: { ...value, chain: Chain.THORChain },
    }),
    mayachainSwapPayload: value => ({
      native: { ...value, chain: Chain.MayaChain },
    }),
    oneinchSwapPayload: general => ({ general }),
    swapkitSwapPayload: value => ({
      general: { ...value, provider: 'swapkit' },
    }),
    kyberswapSwapPayload: () => {
      throw new Error('Kyberswap swap payload is deprecated and no longer supported')
    },
  })
}
