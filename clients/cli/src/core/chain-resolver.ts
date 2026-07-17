import type { Chain } from '@vultisig/sdk'

import { findChainByName } from '../interactive'
import { InvalidChainError } from './errors'

/**
 * Resolve a user-supplied chain name, or throw INVALID_CHAIN.
 *
 * Call sites historically wrote `findChainByName(input) || (input as Chain)`, which
 * launders an unknown name into a `Chain` and defers the failure to whatever the
 * command does next — `tokens bogus-chain` reported `success: true` with an empty
 * list, and `swap-quote bogus-chain ...` surfaced a raw TypeError. Resolving up
 * front turns both into the same typed, non-retryable INVALID_CHAIN.
 *
 * `label` names the argument in the message, so a two-chain command can say which
 * side was wrong.
 */
export function resolveChainOrThrow(input: string, label = 'chain'): Chain {
  const chain = findChainByName(input)
  if (!chain) {
    throw new InvalidChainError(
      `Unsupported ${label}: "${input}"`,
      'Run "vultisig chains" to see the supported chains, or check the spelling.',
      undefined,
      { chain: input }
    )
  }
  return chain
}
