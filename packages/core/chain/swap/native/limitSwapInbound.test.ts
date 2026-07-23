import { describe, expect, it } from 'vitest'

import { Chain } from '../../Chain'
import { ThorchainInboundAddress } from '../../chains/cosmos/thor/getThorchainInboundAddress'
import {
  findLimitSwapInbound,
  isLimitSwapDestinationHalted,
  isThorchainGloballyPaused,
  shouldBlockRuneDeposit,
} from './limitSwapInbound'

const inbound = (chain: string, overrides: Partial<ThorchainInboundAddress> = {}): ThorchainInboundAddress => ({
  address: `${chain.toLowerCase()}-vault`,
  chain,
  chain_lp_actions_paused: false,
  chain_trading_paused: false,
  dust_threshold: '0',
  gas_rate: '0',
  gas_rate_units: 'satsperbyte',
  global_trading_paused: false,
  halted: false,
  observed_fee_rate: '0',
  outbound_fee: '0',
  outbound_tx_size: '0',
  pub_key: 'pub',
  router: '',
  ...overrides,
})

describe('isThorchainGloballyPaused', () => {
  it('detects the network-wide pause flag on any row', () => {
    expect(isThorchainGloballyPaused([inbound('BTC'), inbound('ETH', { global_trading_paused: true })])).toBe(true)
  })

  it('is false when no row is paused', () => {
    expect(isThorchainGloballyPaused([inbound('BTC'), inbound('ETH')])).toBe(false)
  })
})

describe('shouldBlockRuneDeposit', () => {
  it('blocks when trading is globally paused', () => {
    expect(shouldBlockRuneDeposit([inbound('BTC', { global_trading_paused: true })])).toBe(true)
  })

  // A real inbound_addresses response always carries many rows, so an empty
  // (non-throwing) result means the pause state is unverifiable.
  it('blocks on an empty inbound list rather than assuming healthy', () => {
    expect(shouldBlockRuneDeposit([])).toBe(true)
  })

  it('allows a deposit when the network is trading normally', () => {
    expect(shouldBlockRuneDeposit([inbound('BTC'), inbound('ETH')])).toBe(false)
  })

  // RUNE has no inbound vault, so a halted BTC row must not block a RUNE deposit.
  it('ignores a single halted chain', () => {
    expect(shouldBlockRuneDeposit([inbound('BTC', { halted: true }), inbound('ETH')])).toBe(false)
  })
})

describe('isLimitSwapDestinationHalted', () => {
  it.each([
    ['halted', { halted: true }],
    ['globally paused', { global_trading_paused: true }],
    ['chain paused', { chain_trading_paused: true }],
  ])('flags a %s destination', (_, overrides) => {
    expect(isLimitSwapDestinationHalted({ inbounds: [inbound('BTC', overrides)], chain: Chain.Bitcoin })).toBe(true)
  })

  it('reads a live destination as not halted', () => {
    expect(isLimitSwapDestinationHalted({ inbounds: [inbound('BTC'), inbound('ETH')], chain: Chain.Bitcoin })).toBe(
      false
    )
  })

  // A partial or stale feed that drops a row would otherwise let an order be
  // signed into a destination whose halt status was never verified.
  it('fails closed when a mapped destination has no inbound row', () => {
    expect(isLimitSwapDestinationHalted({ inbounds: [inbound('ETH')], chain: Chain.Bitcoin })).toBe(true)
  })

  it('fails closed on an empty inbound feed', () => {
    expect(isLimitSwapDestinationHalted({ inbounds: [], chain: Chain.Bitcoin })).toBe(true)
  })

  // THORChain has no Asgard vault, so it never appears in the feed -- treating a
  // missing row as halted there would block every RUNE-denominated destination.
  it('treats THORChain itself as live despite having no inbound row', () => {
    expect(isLimitSwapDestinationHalted({ inbounds: [inbound('BTC')], chain: Chain.THORChain })).toBe(false)
  })

  it('matches the destination row case-insensitively and ignores surrounding whitespace', () => {
    expect(isLimitSwapDestinationHalted({ inbounds: [inbound(' btc ', { halted: true })], chain: Chain.Bitcoin })).toBe(
      true
    )
  })

  // The feed lists no row for THORChain itself, so a THORChain-native
  // destination (RUNE, TCY, secured assets) is not haltable via it.
  it('skips a destination with no inbound row rather than false-blocking it', () => {
    expect(isLimitSwapDestinationHalted({ inbounds: [inbound('BTC')], chain: Chain.THORChain })).toBe(false)
  })

  it('skips a destination the memo builder cannot encode', () => {
    expect(isLimitSwapDestinationHalted({ inbounds: [inbound('BTC')], chain: Chain.Cardano })).toBe(false)
  })
})

describe('findLimitSwapInbound', () => {
  it('resolves the row matching the chain', () => {
    const result = findLimitSwapInbound({
      inbounds: [inbound('BTC'), inbound('ETH')],
      chain: Chain.Ethereum,
    })

    expect(result.address).toBe('eth-vault')
  })

  it('matches the chain symbol case-insensitively and ignores surrounding whitespace', () => {
    const result = findLimitSwapInbound({
      inbounds: [inbound(' btc ', { address: 'trimmed-vault' })],
      chain: Chain.Bitcoin,
    })

    expect(result.address).toBe('trimmed-vault')
  })

  it.each([
    ['halted', { halted: true }],
    ['globally paused', { global_trading_paused: true }],
    ['chain paused', { chain_trading_paused: true }],
  ])('refuses a %s inbound rather than signing against it', (_, overrides) => {
    expect(() => findLimitSwapInbound({ inbounds: [inbound('BTC', overrides)], chain: Chain.Bitcoin })).toThrow(
      /no live, tradeable THORChain inbound/
    )
  })

  // The selected row's address becomes the deposit's toAddress; an empty one
  // would sign funds to nowhere.
  it.each([
    ['empty', ''],
    ['whitespace-only', '   '],
  ])('refuses an inbound with an %s vault address', (_, address) => {
    expect(() => findLimitSwapInbound({ inbounds: [inbound('BTC', { address })], chain: Chain.Bitcoin })).toThrow(
      /no live, tradeable THORChain inbound/
    )
  })

  it('throws when the chain has no inbound row at all', () => {
    expect(() => findLimitSwapInbound({ inbounds: [inbound('ETH')], chain: Chain.Bitcoin })).toThrow(
      /no live, tradeable THORChain inbound/
    )
  })

  it('refuses a chain the memo builder cannot encode', () => {
    expect(() => findLimitSwapInbound({ inbounds: [inbound('ADA')], chain: Chain.Cardano })).toThrow(
      /not routable through THORChain/
    )
  })
})
