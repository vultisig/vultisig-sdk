import { isAddress } from 'viem'

const evmHexAddressPattern = /^0x[0-9a-fA-F]{40}$/u

const evmChecksumMismatchHint =
  'EIP-55 checksum mismatch: the mixed-case address does not match its checksum. Check for a typo, or paste it in all-lowercase.'

export const isEvmHexAddress = (address: string): boolean => evmHexAddressPattern.test(address)

export const hasUniformEvmAddressCase = (address: string): boolean => {
  const hex = address.slice(2)
  return hex === hex.toLowerCase() || hex === hex.toUpperCase()
}

/**
 * Explain an EVM address rejection when the only thing wrong with it is the
 * EIP-55 checksum.
 *
 * `isValidAddress` rejects a mixed-case EVM address whose checksum does not
 * match. Without this hint that failure reads as a formatting problem, when
 * the address is almost certainly a typo of a real one, which is exactly the
 * case the checksum exists to catch.
 *
 * Returns `undefined` when the input is not shaped like an EVM address, when
 * its letters are uniform-case (no checksum to check), or when the checksum
 * is correct.
 */
export const getEvmChecksumMismatchHint = (address: string): string | undefined => {
  if (!isEvmHexAddress(address)) {
    return undefined
  }

  if (hasUniformEvmAddressCase(address)) {
    return undefined
  }

  return isAddress(address, { strict: true }) ? undefined : evmChecksumMismatchHint
}

/** Append the EIP-55 hint to an invalid-address message when it applies. */
export const withEvmChecksumHint = (message: string, address: string): string => {
  const hint = getEvmChecksumMismatchHint(address)
  return hint ? `${message} (${hint})` : message
}
