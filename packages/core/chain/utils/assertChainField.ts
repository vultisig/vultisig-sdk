import { Chain } from '@vultisig/core-chain/Chain'
import { isOneOf } from '@vultisig/lib-utils/array/isOneOf'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'

export const assertChainField = <C extends Chain, T extends { chain?: string }>(
  input: T
): T & { chain: C } => {
  if (!isOneOf(shouldBePresent(input.chain), Object.values(Chain))) {
    throw new Error(`Invalid chain value: ${input.chain}`)
  }

  return { ...input, chain: input.chain as C }
}
