import { describe, expect, it } from 'vitest'

import limitSwapMemoFixtures from '../../fixtures/limit-swap-memos.json'
import type { LimitSwapMemoInput, LimitSwapSourceChainKind } from './limitSwapMemo'
import {
  assertMemoByteLength,
  buildLimitSwapMemo,
  getLimitSwapLimitAmount,
  getLimitSwapSourceChainKind,
  validateLimitSwapInputs,
} from './limitSwapMemo'

type LimitSwapMemoFixture = {
  name: string
  source_chain_kind: LimitSwapSourceChainKind
  affiliate_included: boolean
  inputs: LimitSwapMemoInput
  expected_memo: string
}

const fixtures = limitSwapMemoFixtures as LimitSwapMemoFixture[]

const validInput: LimitSwapMemoInput = {
  source_asset: 'BTC.BTC',
  source_amount: 100_000_000,
  target_asset: 'ETH.ETH',
  dest_addr: '0x742d35Cc6634C0532925a3b844Bc9e7595f12345',
  target_price: 16,
  expiry_hours: 24,
}

const base58DestinationVectors = [
  {
    chain: 'Dash',
    targetAsset: 'DASH.DASH',
    valid: 'XanAvE5GMB8CsPH78B9moJq9viEVKvCS4f',
    wrongVersion: 'Xz7muLNZ4Mb5gpRC9bV6HS6wZDVRyAowVU',
  },
  {
    chain: 'Zcash',
    targetAsset: 'ZEC.ZEC',
    valid: 't1Hxw6JqWMnhDK5jRCieg5bFHM2qt7UtQvu',
    wrongVersion: 't1hJY5R8o4yA68WsWE8yzZiX4yY6pmQRiKY',
  },
  {
    chain: 'Ripple',
    targetAsset: 'XRP.XRP',
    valid: 'rMwNibdiFaEzsTaFCG1NnmAM3Rv3vHUy5L',
  },
  {
    chain: 'Tron',
    targetAsset: 'TRON.TRX',
    valid: 'TA4Y62o6YC2Zsck9rZVGTvqW1AQ7X9zTnj',
    wrongVersion: 'TZQ9596PFNVSh3tEsypax47Hdff4DKLkmj',
  },
] as const

const corruptChecksum = (address: string): string => `${address.slice(0, -1)}${address.endsWith('1') ? '2' : '1'}`

describe('buildLimitSwapMemo', () => {
  it.each(fixtures)('matches fixture $name', ({ inputs, expected_memo, source_chain_kind, affiliate_included }) => {
    const memo = buildLimitSwapMemo(inputs)

    expect(memo).toBe(expected_memo)
    expect(getLimitSwapSourceChainKind(inputs.source_asset)).toBe(source_chain_kind)
    expect(memo.includes(':v0:50')).toBe(affiliate_included)
  })

  it('computes LIM with integer math and floors sub-1e8 remainders', () => {
    expect(
      getLimitSwapLimitAmount({
        source_amount: 123_456_789,
        target_price: '1.23456789',
      })
    ).toBe(152_415_787n)
  })

  it('drops affiliate on UTXO source memos only when required by the 80-byte cap', () => {
    expect(
      buildLimitSwapMemo({
        ...validInput,
        target_asset: 'THOR.RUNE',
        dest_addr: 'thor1x2whgc2nt665y0kc44uywhynazvp0l8tp0vtu6',
        expiry_hours: 24,
      })
    ).toBe('=<:THOR.RUNE:thor1x2whgc2nt665y0kc44uywhynazvp0l8tp0vtu6:1600000000/14400/0')
  })
})

describe('validateLimitSwapInputs', () => {
  it('accepts valid inputs', () => {
    expect(() => validateLimitSwapInputs(validInput)).not.toThrow()
  })

  it('rejects unsupported source assets', () => {
    expect(() =>
      validateLimitSwapInputs({
        ...validInput,
        source_asset: 'NOPE.NOPE',
      })
    ).toThrow(/unsupported THORChain asset prefix/)
  })

  it('rejects unsupported target assets', () => {
    expect(() =>
      validateLimitSwapInputs({
        ...validInput,
        target_asset: 'NOPE.NOPE',
      })
    ).toThrow(/unsupported THORChain asset prefix/)
  })

  it('rejects surrounding whitespace in source and target assets', () => {
    expect(() =>
      validateLimitSwapInputs({
        ...validInput,
        source_asset: ' BTC.BTC ',
      })
    ).toThrow(/surrounding whitespace/)

    expect(() =>
      buildLimitSwapMemo({
        ...validInput,
        target_asset: ' eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48 ',
        dest_addr: 'thor1x2whgc2nt665y0kc44uywhynazvp0l8tp0vtu6',
      })
    ).toThrow(/surrounding whitespace/)
  })

  it('accepts a Solana limit-swap destination (THOR-04)', () => {
    expect(() =>
      validateLimitSwapInputs({
        ...validInput,
        target_asset: 'SOL.SOL',
        dest_addr: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      })
    ).not.toThrow()
  })

  it('rejects a base58 string that is not a valid Solana public key (THOR-04)', () => {
    expect(() =>
      validateLimitSwapInputs({
        ...validInput,
        target_asset: 'SOL.SOL',
        dest_addr: '1'.repeat(44),
      })
    ).toThrow(/valid Solana address/)
  })

  it('accepts a Noble limit-swap destination (THOR-04)', () => {
    expect(() =>
      validateLimitSwapInputs({
        ...validInput,
        target_asset: 'NOBLE.USDC',
        dest_addr: 'noble1qyqszqgpqyqszqgpqyqszqgpqyqszqgp6s5k4j',
      })
    ).not.toThrow()
  })

  it('rejects a MayaChain-only target asset as a THORChain limit-swap destination (THOR-04)', () => {
    expect(() =>
      validateLimitSwapInputs({
        ...validInput,
        target_asset: 'ADA.ADA',
        dest_addr: 'addr1qxy2lpan99fcnhhyj96y0j0js5f2fxzua6tv5efztsc2q6euld',
      })
    ).toThrow(/unsupported THORChain asset prefix/)

    expect(() =>
      validateLimitSwapInputs({
        ...validInput,
        target_asset: 'MAYA.CACAO',
        dest_addr: 'maya1x2whgc2nt665y0kc44uywhynazvp0l8tp0vtu6',
      })
    ).toThrow(/unsupported THORChain asset prefix/)
  })

  it('rejects malformed destination addresses', () => {
    expect(() =>
      validateLimitSwapInputs({
        ...validInput,
        dest_addr: 'not-an-address',
      })
    ).toThrow(/valid Ethereum address/)

    expect(() =>
      validateLimitSwapInputs({
        ...validInput,
        dest_addr: 'bc1q has spaces',
      })
    ).toThrow(/whitespace/)

    expect(() =>
      validateLimitSwapInputs({
        ...validInput,
        dest_addr: 'aaaaaaaaaa',
      })
    ).toThrow(/valid Ethereum address/)

    expect(() =>
      validateLimitSwapInputs({
        ...validInput,
        dest_addr: 'thor1abc:def',
      })
    ).toThrow(/must not contain memo separators/)

    expect(() =>
      validateLimitSwapInputs({
        ...validInput,
        dest_addr: 'thor1abc/def',
      })
    ).toThrow(/must not contain memo separators/)

    expect(() =>
      validateLimitSwapInputs({
        ...validInput,
        dest_addr: 'thor1x2whgc2nt665y0kc44uywhynazvp0l8tp0vtu6\u20ac',
      })
    ).toThrow(/printable ASCII/)
  })

  it.each(base58DestinationVectors)('accepts a checksummed $chain mainnet destination', ({ targetAsset, valid }) => {
    expect(() =>
      validateLimitSwapInputs({
        ...validInput,
        target_asset: targetAsset,
        dest_addr: valid,
      })
    ).not.toThrow()
  })

  it.each(base58DestinationVectors)(
    'rejects a checksum-corrupted but shape-valid $chain destination',
    ({ targetAsset, valid }) => {
      expect(() =>
        validateLimitSwapInputs({
          ...validInput,
          target_asset: targetAsset,
          dest_addr: corruptChecksum(valid),
        })
      ).toThrow(/dest_addr is not a valid/)
    }
  )

  it.each(base58DestinationVectors.filter(vector => 'wrongVersion' in vector))(
    'rejects a checksummed $chain destination carrying the wrong network version',
    ({ targetAsset, wrongVersion }) => {
      expect(() =>
        validateLimitSwapInputs({
          ...validInput,
          target_asset: targetAsset,
          dest_addr: wrongVersion,
        })
      ).toThrow(/dest_addr is not a valid/)
    }
  )

  it('rejects invalid source amounts', () => {
    expect(() =>
      validateLimitSwapInputs({
        ...validInput,
        source_amount: 0,
      })
    ).toThrow(/positive safe integer/)

    expect(() =>
      validateLimitSwapInputs({
        ...validInput,
        source_amount: '1.1',
      })
    ).toThrow(/positive integer/)
  })

  it('rejects non-positive target prices', () => {
    expect(() =>
      validateLimitSwapInputs({
        ...validInput,
        target_price: '0',
      })
    ).toThrow(/greater than 0/)
  })

  it('rejects target prices with more than 8 fractional digits', () => {
    expect(() =>
      validateLimitSwapInputs({
        ...validInput,
        target_price: '1.123456789',
      })
    ).toThrow(/at most 8 fractional digits/)
  })

  it('accepts tiny numeric target prices with 8 decimal places', () => {
    expect(
      getLimitSwapLimitAmount({
        source_amount: 100_000_000,
        target_price: 0.00000001,
      })
    ).toBe(1n)
  })

  it('rejects source_amount/target_price combinations that floor LIM to 0 (THOR-02)', () => {
    // 1_000_000 * 1 (scaled target_price) / 1e8 = 0.01, floors to 0.
    // A zero trade target is treated by THORChain as an unprotected market
    // order, so this must fail closed rather than silently reinterpreting
    // the user's limit swap as a market swap.
    expect(() =>
      getLimitSwapLimitAmount({
        source_amount: 1_000_000,
        target_price: 0.00000001,
      })
    ).toThrow(/floors to 0/)

    expect(() =>
      buildLimitSwapMemo({
        ...validInput,
        source_amount: 1_000_000,
        target_price: 0.00000001,
      })
    ).toThrow(/floors to 0/)
  })

  it('rejects unsupported expiries', () => {
    expect(() =>
      validateLimitSwapInputs({
        ...validInput,
        expiry_hours: 6 as 12,
      })
    ).toThrow(/expiry_hours/)
  })

  it.each(['BTC.BTC', 'BCH.BCH', 'DASH.DASH', 'DOGE.DOGE', 'LTC.LTC', 'ZEC.ZEC'])(
    'applies the UTXO memo byte rule for %s sources',
    source_asset => {
      expect(getLimitSwapSourceChainKind(source_asset)).toBe('utxo')
      expect(
        new TextEncoder().encode(
          buildLimitSwapMemo({
            ...validInput,
            source_asset,
          })
        ).length
      ).toBeLessThanOrEqual(80)
    }
  )
})

describe('assertMemoByteLength', () => {
  it('measures UTF-8 bytes, not JavaScript string length', () => {
    expect(() => assertMemoByteLength('€'.repeat(27), 'utxo')).toThrow(/81 bytes/)
  })

  it('throws when a UTXO memo exceeds 80 bytes', () => {
    expect(() => assertMemoByteLength('x'.repeat(81), 'utxo')).toThrow(/exceeding utxo limit 80/)
  })

  it('allows non-UTXO memos up to 250 bytes', () => {
    expect(() => assertMemoByteLength('x'.repeat(250), 'other')).not.toThrow()
  })
})

// A secured asset is an L1 asset custodied ON THORChain. It is deposited by
// MsgDeposit from a THOR address and paid out to one, so every chain question
// about it answers THORChain — not the chain it originates from.
describe('secured assets', () => {
  const securedUsdc = 'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
  const thorAddress = 'thor12a9rpf9u2ulwuezxkh6uas4au7xnde8umdua5t'

  it('places an order from a secured source', () => {
    const memo = buildLimitSwapMemo({
      source_asset: securedUsdc,
      source_amount: 100_000_000,
      target_asset: 'BTC.BTC',
      dest_addr: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      target_price: 0.001,
      expiry_hours: 24,
    })

    expect(memo.startsWith('=<:BTC.BTC:')).toBe(true)
  })

  // The deposit is a MsgDeposit on THORChain, so it gets THORChain's 250-byte
  // budget — reading the origin chain would give an ETH/UTXO answer instead.
  it('sizes a secured source against THORChain, not its origin chain', () => {
    expect(getLimitSwapSourceChainKind(securedUsdc)).toBe('other')
    expect(getLimitSwapSourceChainKind('btc-btc')).toBe('other')
    // The layer-1 spelling of the same origin chain still sizes as UTXO.
    expect(getLimitSwapSourceChainKind('BTC.BTC')).toBe('utxo')
  })

  // A secured target pays out ON THORChain, so the payout address must be a THOR
  // one. Validating it against Ethereum would reject the only correct address.
  it('requires a THOR payout address for a secured target', () => {
    expect(() =>
      buildLimitSwapMemo({
        source_asset: 'ETH.ETH',
        source_amount: 100_000_000,
        target_asset: securedUsdc,
        dest_addr: thorAddress,
        target_price: 1,
        expiry_hours: 24,
      })
    ).not.toThrow()

    expect(() =>
      buildLimitSwapMemo({
        source_asset: 'ETH.ETH',
        source_amount: 100_000_000,
        target_asset: securedUsdc,
        dest_addr: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
        target_price: 1,
        expiry_hours: 24,
      })
    ).toThrow(/not a valid THORChain address/)
  })

  // A secured denom is long and cannot be abbreviated, and a THOR payout address
  // is 43 characters. Together they overflow OP_RETURN, so this pair is simply
  // not placeable from a UTXO chain — the byte guard says so rather than
  // truncating the asset into one THORChain would resolve differently.
  it('refuses a secured target from a UTXO source, which cannot fit', () => {
    expect(() =>
      buildLimitSwapMemo({
        source_asset: 'BTC.BTC',
        source_amount: 100_000_000,
        target_asset: securedUsdc,
        dest_addr: thorAddress,
        target_price: 1,
        expiry_hours: 24,
      })
    ).toThrow(/exceeding utxo limit 80/)
  })

  it.each(['XRP-XRP', 'ETH-USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48', securedUsdc])(
    'accepts %s in either case convention',
    asset => {
      expect(() => getLimitSwapSourceChainKind(asset)).not.toThrow()
    }
  )

  // A well-shaped string is not a real asset — the origin chain still has to be
  // one THORChain routes.
  it('refuses a secured denom whose origin chain is unroutable', () => {
    expect(() => getLimitSwapSourceChainKind('nope-nope')).toThrow(/cannot route/)
  })

  // Different custody model, unverified against the advanced swap queue. Failing
  // here beats building a memo whose behaviour nobody has established.
  it.each(['BTC/BTC', 'ETH~ETH'])('still refuses the %s flavour', asset => {
    expect(() => getLimitSwapSourceChainKind(asset)).toThrow(/not a THORChain asset this memo can carry/)
  })

  it.each(['BTC.BTC.EXTRA', 'BTC.', '.BTC', ''])('still refuses the malformed %j', asset => {
    expect(() => getLimitSwapSourceChainKind(asset)).toThrow()
  })
})
