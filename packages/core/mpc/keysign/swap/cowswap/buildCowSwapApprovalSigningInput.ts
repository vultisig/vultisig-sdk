import { WalletCore } from '@trustwallet/wallet-core'

import { KeysignPayload } from '../../../types/vultisig/keysign/v1/keysign_message_pb'
import { signingInputClasses } from '../../signingInputs/core'
import { getErc20ApproveSigningInput } from '../../signingInputs/resolvers/evm/erc20'

type Input = {
  keysignPayload: KeysignPayload
  walletCore: WalletCore
}

/**
 * Encode the on-chain ERC-20 `approve(VaultRelayer, amount)` signing input for a
 * CowSwap order, or `undefined` when no approval is required (sufficient
 * allowance, or a permit-capable token handled gas-lessly).
 *
 * CowSwap orders cannot flow through the normal `getEncodedSigningInputs` path:
 * the off-chain order leg has no TW transaction to encode, so the generic EVM
 * resolver (which always pairs an approval with a follow-up transaction) would
 * emit a spurious second input. The consumer therefore drives the CowSwap
 * ceremony directly — this helper hands it the one signing input it does need:
 * the standalone VaultRelayer approval, ready for `getPreSigningHashes` /
 * `compileTx` / `broadcastTx`.
 */
export const buildCowSwapApprovalSigningInput = ({ keysignPayload, walletCore }: Input): Uint8Array | undefined => {
  if (!keysignPayload.erc20ApprovePayload) {
    return undefined
  }

  const signingInput = getErc20ApproveSigningInput({ keysignPayload, walletCore })

  return signingInputClasses.evm.encode(signingInput).finish()
}
