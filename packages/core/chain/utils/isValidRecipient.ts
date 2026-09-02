import { Chain } from '@vultisig/core-chain/Chain'

import { isValidAddress } from './isValidAddress'
import { isValidSolanaRecipient } from './isValidSolanaRecipient'

type Input = Parameters<typeof isValidAddress>[0]

export { isValidSolanaRecipient } from './isValidSolanaRecipient'

/**
 * Validate an address specifically for use as a wallet-controlled recipient.
 *
 * Generic Solana address validation intentionally accepts program-derived
 * addresses and token accounts because they are valid account identifiers.
 * A direct send recipient is narrower: it must be an on-curve public key that
 * can be controlled by a wallet signer.
 */
export const isValidRecipient = (input: Input): boolean => {
  if (!isValidAddress(input)) {
    return false
  }

  if (input.chain !== Chain.Solana) {
    return true
  }

  return isValidSolanaRecipient(input.address)
}
