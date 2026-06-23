import { describe, expect, it } from 'vitest'

import {
  assembleAstroportSwap,
  ASTROPORT_ROUTER,
  type BuildAstroportSwapParams,
  classifyAstroportAsset,
  computeAstroportMinReceive,
} from '../../../../src/tools/swap/astroport'

// Real phoenix-1 addresses for shape assertions.
const VAULT = 'terra1dcegyrekltswvyy0xy69ydgxn9x8x32zdtapd8' // 20-byte account
const ASTRO_CW20 = 'terra1nsuqsk6kh58ulczatwev87ttq2z6r3pusulg9r24mfj2fvtzd4uq3exn26' // 32-byte CW20 contract
const RECIPIENT = 'terra1zdpgj8am5nqqvht927k3etljyl6a52kwqup0je'
// Validator operator / consensus keys on phoenix-1. These are NOT spendable
// accounts — funds routed to them (or swap proceeds pinned to them) are
// unrecoverable. mcp-ts guards these via assertNotValidatorHrp(); the SDK port
// relies on the exact `decoded.prefix === 'terra'` check rejecting the distinct
// `terravaloper` / `terravalcons` HRPs. Pin that equivalence so it can't drift.
const VALOPER = 'terravaloper1qv9pzxqlyckngw6zf9g9whn9d3eh4qvghu0hpp'
const VALCONS = 'terravalcons1qv9pzxqlyckngw6zf9g9whn9d3eh4qvgr0utdq'

const base: BuildAstroportSwapParams = {
  fromAddress: VAULT,
  offerAssetDenom: 'uluna',
  offerAmount: '1000000',
  askAssetDenom: ASTRO_CW20,
  slippageTolerance: 0.01,
}

describe('classifyAstroportAsset', () => {
  it('classifies a native bank denom as native_token', () => {
    expect(classifyAstroportAsset('uluna', 'offer')).toEqual({
      native_token: { denom: 'uluna' },
    })
  })

  it('classifies factory and ibc denoms as native_token', () => {
    expect(classifyAstroportAsset('factory/terra1abc/shr', 'offer')).toEqual({
      native_token: { denom: 'factory/terra1abc/shr' },
    })
    expect(classifyAstroportAsset('ibc/ABCDEF', 'offer')).toEqual({
      native_token: { denom: 'ibc/ABCDEF' },
    })
  })

  it('classifies a 32-byte terra1 bech32 as a CW20 token (canonicalized lowercase)', () => {
    expect(classifyAstroportAsset(ASTRO_CW20.toUpperCase(), 'ask')).toEqual({
      token: { contract_addr: ASTRO_CW20 },
    })
  })

  it('rejects a terra1-prefixed string that is not valid bech32 (no silent native fallback)', () => {
    expect(() => classifyAstroportAsset('terra1notvalidbech32!!!', 'offer')).toThrow(/not valid bech32/)
  })

  it('rejects a 20-byte account masquerading as a swap asset', () => {
    expect(() => classifyAstroportAsset(VAULT, 'offer')).toThrow(/user account/)
  })
})

describe('computeAstroportMinReceive', () => {
  it('applies integer-only bps haircut', () => {
    // 1_000_000 * (1 - 0.01) = 990_000
    expect(computeAstroportMinReceive('1000000', 0.01)).toBe('990000')
  })

  it('no haircut at zero slippage', () => {
    expect(computeAstroportMinReceive('123456789', 0)).toBe('123456789')
  })

  it('5% cap haircut', () => {
    expect(computeAstroportMinReceive('1000000', 0.05)).toBe('950000')
  })
})

describe('assembleAstroportSwap (native offer)', () => {
  const result = assembleAstroportSwap(base, '500000')

  it('builds a direct router execute with funds for a native offer', () => {
    expect(result.txType).toBe('wasm_execute')
    expect(result.chain).toBe('Terra')
    expect(result.chainId).toBe('phoenix-1')
    expect(result.contractAddress).toBe(ASTROPORT_ROUTER)
    expect(result.funds).toEqual([{ denom: 'uluna', amount: '1000000' }])
    expect(result.gas).toBe(600_000)
  })

  it('encodes execute_swap_operations with a single astro_swap hop', () => {
    const msg = JSON.parse(result.executeMsg)
    expect(msg.execute_swap_operations.operations[0].astro_swap).toEqual({
      offer_asset_info: { native_token: { denom: 'uluna' } },
      ask_asset_info: { token: { contract_addr: ASTRO_CW20 } },
    })
    expect(msg.execute_swap_operations.minimum_receive).toBe('495000') // 500000 * 0.99
  })

  it('defaults to self recipient (no `to` field, recipientMode self)', () => {
    expect(result.recipientMode).toBe('self')
    expect(result.toAddress).toBeUndefined()
    expect(JSON.parse(result.executeMsg).execute_swap_operations.to).toBeUndefined()
  })

  it('surfaces a quote block matching the simulate amount', () => {
    expect(result.quote.expectedAskAmount).toBe('500000')
    expect(result.quote.minReceive).toBe('495000')
    expect(result.quote.slippageTolerance).toBe(0.01)
  })
})

describe('assembleAstroportSwap (CW20 offer)', () => {
  const result = assembleAstroportSwap({ ...base, offerAssetDenom: ASTRO_CW20, askAssetDenom: 'uluna' }, '500000')

  it('wraps execute_swap_operations in a base64 Cw20ReceiveMsg send envelope', () => {
    expect(result.contractAddress).toBe(ASTRO_CW20)
    expect(result.funds).toEqual([])
    const msg = JSON.parse(result.executeMsg)
    expect(msg.send.contract).toBe(ASTROPORT_ROUTER)
    expect(msg.send.amount).toBe('1000000')
    const inner = JSON.parse(Buffer.from(msg.send.msg, 'base64').toString('utf8'))
    expect(inner.execute_swap_operations.minimum_receive).toBe('495000')
  })
})

describe('assembleAstroportSwap (explicit recipient)', () => {
  it('sets toAddress + third_party mode and inner `to` when a recipient is given', () => {
    const result = assembleAstroportSwap({ ...base, recipientAddress: RECIPIENT }, '500000')
    expect(result.recipientMode).toBe('third_party')
    expect(result.toAddress).toBe(RECIPIENT)
    expect(JSON.parse(result.executeMsg).execute_swap_operations.to).toBe(RECIPIENT)
  })
})

describe('assembleAstroportSwap validation', () => {
  it('rejects a non-terra sender prefix', () => {
    // A valid cosmos1 bech32 — decodes fine but the wrong HRP for phoenix-1.
    expect(() =>
      assembleAstroportSwap({ ...base, fromAddress: 'cosmos1dcegyrekltswvyy0xy69ydgxn9x8x32zt08p08' }, '500000')
    ).toThrow(/expected terra prefix/)
  })

  it('rejects a validator operator / consensus sender (valoper / valcons HRP)', () => {
    // Fund-safety equivalence with mcp-ts assertNotValidatorHrp(): the exact
    // `terra`-prefix check must reject the distinct validator HRPs. A valoper /
    // valcons sender is not a spendable account.
    expect(() => assembleAstroportSwap({ ...base, fromAddress: VALOPER }, '500000')).toThrow(/expected terra prefix/)
    expect(() => assembleAstroportSwap({ ...base, fromAddress: VALCONS }, '500000')).toThrow(/expected terra prefix/)
  })

  it('rejects a validator operator / consensus explicit recipient (proceed-redirect guard)', () => {
    // The explicit-recipient path runs the same validateTerraAddress guard, so
    // swap proceeds can never be pinned to a valoper/valcons (or any non-terra)
    // address even when an explicit recipient is supplied.
    expect(() => assembleAstroportSwap({ ...base, recipientAddress: VALOPER }, '500000')).toThrow(
      /expected terra prefix/
    )
    expect(() =>
      assembleAstroportSwap({ ...base, recipientAddress: 'cosmos1dcegyrekltswvyy0xy69ydgxn9x8x32zt08p08' }, '500000')
    ).toThrow(/expected terra prefix/)
  })

  it('rejects a malformed quote amount (no signed payload built from garbage)', () => {
    // The quote feeds minimum_receive on the signed envelope. A non-integer
    // quote must fail closed rather than silently produce a degenerate floor.
    expect(() => assembleAstroportSwap(base, '12.5')).toThrow(/invalid quoteAmount/)
    expect(() => assembleAstroportSwap(base, '')).toThrow(/invalid quoteAmount/)
    expect(() => assembleAstroportSwap(base, 'abc')).toThrow(/invalid quoteAmount/)
  })

  it('rejects a zero / non-integer offer amount', () => {
    expect(() => assembleAstroportSwap({ ...base, offerAmount: '0' }, '500000')).toThrow(/greater than zero/)
    expect(() => assembleAstroportSwap({ ...base, offerAmount: '1.5' }, '500000')).toThrow(/base units/)
  })

  it('rejects slippage above the 5% cap', () => {
    expect(() => assembleAstroportSwap({ ...base, slippageTolerance: 0.1 }, '500000')).toThrow(/slippageTolerance/)
  })
})
