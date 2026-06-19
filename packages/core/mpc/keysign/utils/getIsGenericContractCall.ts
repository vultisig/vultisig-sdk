import { getKeysignSwapPayload } from '@vultisig/core-mpc/keysign/swap/getKeysignSwapPayload'
import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'

/**
 * True when a keysign payload is a generic EVM contract call carried as `0x`
 * calldata in `memo` on a token coin — e.g. VULT staking `depositFor`.
 *
 * Matches: a non-native coin, `toAmount === '0'`, `0x` calldata in `memo`, and no
 * swap payload. The zero-`toAmount` guard means this never matches a real ERC-20
 * transfer (those always carry a non-zero amount).
 *
 * Shared by the EVM signing-input, fee-quote, and Blockaid simulation/validation
 * resolvers so they all route to the same on-chain call (data -> `toAddress`)
 * instead of a synthetic ERC-20 transfer to `coin.contractAddress`.
 */
export const getIsGenericContractCall = (payload: KeysignPayload): boolean => {
  if (getKeysignSwapPayload(payload)) {
    return false
  }

  const coin = payload.coin

  if (!coin || coin.isNativeToken) {
    return false
  }

  if (payload.toAmount !== '0') {
    return false
  }

  return !!payload.memo && payload.memo.startsWith('0x')
}
