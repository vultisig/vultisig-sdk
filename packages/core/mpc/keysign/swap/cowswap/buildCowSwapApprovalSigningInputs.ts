import { WalletCore } from '@trustwallet/wallet-core'

import { KeysignPayload } from '../../../types/vultisig/keysign/v1/keysign_message_pb'
import { signingInputClasses } from '../../signingInputs/core'
import { getErc20ApproveSigningInputs } from '../../signingInputs/resolvers/evm/erc20'

type Input = {
  keysignPayload: KeysignPayload
  walletCore: WalletCore
}

/**
 * Encode the on-chain ERC-20 approval signing inputs a CowSwap order needs
 * before the VaultRelayer can pull the sell token, in nonce order: an
 * `approve(0)` reset first when the payload asks for one (USDT-style tokens),
 * then `approve(VaultRelayer, amount)`. Empty when no approval is required
 * (sufficient allowance, or a permit-capable token handled gas-lessly).
 *
 * CowSwap orders cannot flow through the normal `getEncodedSigningInputs` path:
 * the off-chain order leg has no TW transaction to encode, so the generic EVM
 * resolver (which always pairs an approval with a follow-up transaction) would
 * emit a spurious extra input. The consumer therefore drives the CowSwap
 * ceremony directly — this helper hands it only the on-chain inputs it does
 * need, ready for `getPreSigningHashes` / `compileTx` / `broadcastTx`.
 */
export const buildCowSwapApprovalSigningInputs = ({ keysignPayload, walletCore }: Input): Uint8Array[] => {
  if (!keysignPayload.erc20ApprovePayload) {
    return []
  }

  const { signingInputs } = getErc20ApproveSigningInputs({ keysignPayload, walletCore })

  return signingInputs.map(signingInput => signingInputClasses.evm.encode(signingInput).finish())
}
