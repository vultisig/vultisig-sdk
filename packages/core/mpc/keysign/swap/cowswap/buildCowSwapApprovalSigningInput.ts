import { WalletCore } from '@trustwallet/wallet-core'

import { KeysignPayload } from '../../../types/vultisig/keysign/v1/keysign_message_pb'
import { buildCowSwapApprovalSigningInputs } from './buildCowSwapApprovalSigningInputs'

type Input = {
  keysignPayload: KeysignPayload
  walletCore: WalletCore
}

/**
 * Single-input form of `buildCowSwapApprovalSigningInputs`, kept so consumers
 * on the 3.x line keep resolving this subpath: the one `approve(VaultRelayer,
 * amount)` input, or `undefined` when no approval is required.
 *
 * It predates the USDT-style `approve(0)` reset
 * (`Erc20ApprovePayload.resetAllowanceFirst`) and cannot carry two legs.
 * Signing only one of them would either revoke the allowance or revert on
 * chain, so a payload that asks for the reset throws here instead of losing
 * a leg.
 *
 * @deprecated Use `buildCowSwapApprovalSigningInputs`, which returns every
 * approve leg in nonce order.
 */
export const buildCowSwapApprovalSigningInput = ({ keysignPayload, walletCore }: Input): Uint8Array | undefined => {
  const [signingInput, ...furtherLegs] = buildCowSwapApprovalSigningInputs({
    keysignPayload,
    walletCore,
  })

  if (furtherLegs.length > 0) {
    throw new Error(
      'This CowSwap approval needs an approve(0) reset before approve(amount), which buildCowSwapApprovalSigningInput cannot carry; use buildCowSwapApprovalSigningInputs'
    )
  }

  return signingInput
}
