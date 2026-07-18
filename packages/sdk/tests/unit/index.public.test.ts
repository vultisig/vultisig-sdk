import { describe, expect, it } from 'vitest'

import { Chain } from '@vultisig/core-chain/Chain'

import { COSMOS_SEND_FEE_DEFAULT, getCosmosSendFeeBaseUnits } from '../../src/index'

describe('public SDK cosmos fee exports', () => {
  it('exports the canonical cosmos send-fee helper for ibc-enabled chains', () => {
    expect(getCosmosSendFeeBaseUnits(Chain.Cosmos)).toBe(7_500n)
    expect(getCosmosSendFeeBaseUnits(Chain.TerraClassic)).toBe(20_000_000n)
  })

  it('exports the shared default for vault-based cosmos chains', () => {
    expect(COSMOS_SEND_FEE_DEFAULT).toBe(7_500n)
    expect(getCosmosSendFeeBaseUnits(Chain.THORChain)).toBe(COSMOS_SEND_FEE_DEFAULT)
  })
})
