import { EvmChain } from '@vultisig/core-chain/Chain'
import {
  hasUniformEvmAddressCase,
  isEvmHexAddress,
} from '@vultisig/core-chain/utils/getEvmChecksumMismatchHint'
import { isAddress } from 'viem'
import { describe, expect, it } from 'vitest'

import { knownTokens } from '.'

describe('knownTokens EVM checksums', () => {
  it('uses uniform case or a valid EIP-55 checksum for every EVM token id', () => {
    for (const chain of Object.values(EvmChain)) {
      for (const token of knownTokens[chain]) {
        const id = token.id!
        expect(
          isEvmHexAddress(id) && (hasUniformEvmAddressCase(id) || isAddress(id, { strict: true })),
          `${chain} ${token.ticker}: ${id}`
        ).toBe(true)
      }
    }
  })
})
