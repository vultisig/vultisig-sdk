import { EvmChain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import {
  BlockaidEVMSimulation,
  BlockaidSolanaSimulation,
  BlockaidSuiSimulation,
  parseBlockaidEvmSimulation,
  parseBlockaidSolanaSimulation,
  parseBlockaidSuiSimulation,
} from './core'

type AssetDiff = BlockaidEVMSimulation['account_summary']['assets_diffs'][number]
type Asset = AssetDiff['asset']
type Side = AssetDiff['in'][number]

const asset = (overrides: Partial<Asset> = {}): Asset => ({
  type: 'ERC20',
  chain_name: 'ethereum',
  decimals: 18,
  chain_id: 1,
  address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  logo_url: 'https://logos.example/usdc.png',
  name: 'USD Coin',
  symbol: 'USDC',
  ...overrides,
})

const side = (rawValue: string, overrides: Partial<Side> = {}): Side => ({
  usd_price: 0,
  summary: '',
  value: 0,
  raw_value: rawValue,
  ...overrides,
})

const diff = (parts: Partial<AssetDiff> & Pick<AssetDiff, 'asset'>): AssetDiff => ({
  asset_type: 'ERC20',
  in: [],
  out: [],
  balance_changes: {
    before: { usd_price: 0, value: 0, raw_value: '0' },
    after: { usd_price: 0, value: 0, raw_value: '0' },
  },
  ...parts,
})

const buildSimulation = (diffs: AssetDiff[]): BlockaidEVMSimulation => ({
  account_summary: { assets_diffs: diffs },
})

const TOKEN_A = asset({
  address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  symbol: 'A',
  name: 'Token A',
  decimals: 18,
})
const TOKEN_B = asset({
  address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  symbol: 'B',
  name: 'Token B',
  decimals: 6,
})

describe('parseBlockaidEvmSimulation', () => {
  it('emits a single send change for a single-diff out simulation', async () => {
    const result = await parseBlockaidEvmSimulation(
      buildSimulation([diff({ asset: TOKEN_A, out: [side('1000')] })]),
      EvmChain.Ethereum
    )

    expect(result).toEqual({
      changes: [
        {
          direction: 'send',
          coin: {
            decimals: TOKEN_A.decimals,
            logo: TOKEN_A.logo_url,
            ticker: TOKEN_A.symbol,
            id: TOKEN_A.address,
            chain: EvmChain.Ethereum,
          },
          amount: 1000n,
        },
      ],
    })
  })

  it('returns net send + receive across a router-mediated permitAndCall flow (3 diffs)', async () => {
    const result = await parseBlockaidEvmSimulation(
      buildSimulation([
        diff({ asset: TOKEN_A, out: [side('5000')] }),
        diff({ asset: asset({ address: '0xcccc' }) }),
        diff({ asset: TOKEN_B, in: [side('42')] }),
      ]),
      EvmChain.Ethereum
    )

    expect(result).toEqual({
      changes: [
        expect.objectContaining({
          direction: 'send',
          coin: expect.objectContaining({ id: TOKEN_A.address, ticker: 'A' }),
          amount: 5000n,
        }),
        expect.objectContaining({
          direction: 'receive',
          coin: expect.objectContaining({ id: TOKEN_B.address, ticker: 'B' }),
          amount: 42n,
        }),
      ],
    })
  })

  it('emits two changes for the standard 2-diff swap shape', async () => {
    const result = await parseBlockaidEvmSimulation(
      buildSimulation([diff({ asset: TOKEN_A, out: [side('100')] }), diff({ asset: TOKEN_B, in: [side('200')] })]),
      EvmChain.Ethereum
    )

    expect(result).toEqual({
      changes: [
        expect.objectContaining({
          direction: 'send',
          coin: expect.objectContaining({ id: TOKEN_A.address }),
          amount: 100n,
        }),
        expect.objectContaining({
          direction: 'receive',
          coin: expect.objectContaining({ id: TOKEN_B.address }),
          amount: 200n,
        }),
      ],
    })
  })

  it('groups EIP-55 checksum casing as the same asset and nets across legs', async () => {
    // The checksum-case A leg cancels the original-case A leg (same address,
    // different display casing), so the net effect is just the +B leg.
    const tokenAChecksum = asset({
      address: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      symbol: 'A',
    })
    const result = await parseBlockaidEvmSimulation(
      buildSimulation([
        diff({ asset: TOKEN_A, out: [side('1')] }),
        diff({ asset: tokenAChecksum, in: [side('1')] }),
        diff({ asset: TOKEN_B, in: [side('2')] }),
      ]),
      EvmChain.Ethereum
    )

    expect(result).toEqual({
      changes: [
        expect.objectContaining({
          direction: 'receive',
          coin: expect.objectContaining({ id: TOKEN_B.address }),
          amount: 2n,
        }),
      ],
    })
  })

  it('returns null when there is no out-side diff and no in-side diff', async () => {
    const result = await parseBlockaidEvmSimulation(
      buildSimulation([diff({ asset: TOKEN_A }), diff({ asset: TOKEN_B })]),
      EvmChain.Ethereum
    )

    expect(result).toBeNull()
  })

  it('emits two receives when only the in-side has values across two assets', async () => {
    const result = await parseBlockaidEvmSimulation(
      buildSimulation([diff({ asset: TOKEN_A, in: [side('1')] }), diff({ asset: TOKEN_B, in: [side('2')] })]),
      EvmChain.Ethereum
    )

    expect(result).toEqual({
      changes: [
        expect.objectContaining({ direction: 'receive', amount: 1n }),
        expect.objectContaining({ direction: 'receive', amount: 2n }),
      ],
    })
  })

  it('returns null when the only in-side diff is the same asset as the out-side (refund-shaped)', async () => {
    const result = await parseBlockaidEvmSimulation(
      buildSimulation([diff({ asset: TOKEN_A, out: [side('1')] }), diff({ asset: TOKEN_A, in: [side('1')] })]),
      EvmChain.Ethereum
    )

    expect(result).toBeNull()
  })

  it('returns null when in/out share an address but Blockaid returns inconsistent symbol metadata', async () => {
    // Address is the canonical token identity. Blockaid occasionally returns
    // the same contract with mismatched symbols (different casing, stale
    // metadata, etc.) — those still represent a refund-shaped self-swap.
    const tokenAUppercaseSymbol = asset({
      address: TOKEN_A.address,
      symbol: 'TOKENA',
      name: 'Token A (alt metadata)',
    })

    const result = await parseBlockaidEvmSimulation(
      buildSimulation([
        diff({ asset: TOKEN_A, out: [side('1')] }),
        diff({ asset: tokenAUppercaseSymbol, in: [side('1')] }),
      ]),
      EvmChain.Ethereum
    )

    expect(result).toBeNull()
  })

  it('emits net send when an asset has both out and in legs and out > in', async () => {
    // User sends 10 A and receives 1 A as refund — net send of 9 A.
    const result = await parseBlockaidEvmSimulation(
      buildSimulation([diff({ asset: TOKEN_A, out: [side('10')] }), diff({ asset: TOKEN_A, in: [side('1')] })]),
      EvmChain.Ethereum
    )

    expect(result).toEqual({
      changes: [
        expect.objectContaining({
          direction: 'send',
          coin: expect.objectContaining({ id: TOKEN_A.address }),
          amount: 9n,
        }),
      ],
    })
  })

  it('emits multiple changes for a multicall-style simulation (4 diffs)', async () => {
    const TOKEN_C = asset({
      address: '0xcccccccccccccccccccccccccccccccccccccccc',
      symbol: 'C',
      decimals: 8,
    })
    const result = await parseBlockaidEvmSimulation(
      buildSimulation([
        diff({ asset: TOKEN_A, out: [side('100')] }),
        diff({ asset: TOKEN_B, out: [side('200')] }),
        diff({ asset: TOKEN_C, in: [side('300')] }),
        diff({ asset: asset({ address: '0xdddd' }), in: [side('400')] }),
      ]),
      EvmChain.Ethereum
    )

    expect(result?.changes).toHaveLength(4)
    expect(result?.changes.filter(c => c.direction === 'send')).toHaveLength(2)
    expect(result?.changes.filter(c => c.direction === 'receive')).toHaveLength(2)
  })

  it('aggregates usdValue from in/out side prices when present', async () => {
    const result = await parseBlockaidEvmSimulation(
      buildSimulation([
        diff({
          asset: TOKEN_A,
          out: [side('1000', { usd_price: 1.5, value: 2 })],
        }),
      ]),
      EvmChain.Ethereum
    )

    expect(result?.changes[0].usdValue).toBe(3)
  })

  it('omits coin.id for native assets', async () => {
    const nativeAsset = asset({
      type: 'NATIVE',
      address: undefined,
      symbol: 'ETH',
      decimals: 18,
    })
    const result = await parseBlockaidEvmSimulation(
      buildSimulation([diff({ asset_type: 'NATIVE', asset: nativeAsset, out: [side('1000')] })]),
      EvmChain.Ethereum
    )

    expect(result?.changes).toHaveLength(1)
    expect(result?.changes[0].coin).not.toHaveProperty('id')
    expect(result?.changes[0].coin).toMatchObject({
      ticker: 'ETH',
      chain: EvmChain.Ethereum,
    })
  })

  it('lowercases ERC20 address in emitted coin.id regardless of input casing', async () => {
    const tokenAChecksum = asset({
      address: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      symbol: 'A',
    })
    const result = await parseBlockaidEvmSimulation(
      buildSimulation([diff({ asset: tokenAChecksum, out: [side('1')] })]),
      EvmChain.Ethereum
    )

    expect(result?.changes[0].coin.id).toBe('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
  })

  it('skips malformed ERC20 entries without an address (does not group with native)', async () => {
    const nativeAsset = asset({
      type: 'NATIVE',
      address: undefined,
      symbol: 'ETH',
      decimals: 18,
    })
    const malformedErc20 = asset({ address: undefined, symbol: 'BROKEN' })
    const result = await parseBlockaidEvmSimulation(
      buildSimulation([
        diff({ asset_type: 'NATIVE', asset: nativeAsset, out: [side('100')] }),
        diff({ asset: malformedErc20, in: [side('999')] }),
      ]),
      EvmChain.Ethereum
    )

    expect(result?.changes).toHaveLength(1)
    expect(result?.changes[0]).toMatchObject({
      direction: 'send',
      amount: 100n,
    })
    expect(result?.changes[0].coin.ticker).toBe('ETH')
  })
})

type SolanaDiff = BlockaidSolanaSimulation['account_summary']['account_assets_diff'][number]
type SolanaAsset = SolanaDiff['asset']
type SolanaSide = NonNullable<SolanaDiff['in']>

const WSOL_MINT = 'So11111111111111111111111111111111111111112'

const solSide = (rawValue: string): SolanaSide => ({
  usd_price: 0,
  summary: '',
  value: 0,
  raw_value: rawValue,
})

const nativeSol: SolanaAsset = { type: 'SOL', symbol: 'SOL', decimals: 9, logo: '' }

const splToken = (address: string, symbol: string, decimals = 9): SolanaAsset => ({
  type: 'TOKEN',
  symbol,
  address,
  decimals,
  logo: '',
})

const solDiff = (asset: SolanaAsset, sides: { in?: SolanaSide; out?: SolanaSide }): SolanaDiff => ({
  asset,
  asset_type: asset.type,
  in: sides.in ?? null,
  out: sides.out ?? null,
})

const solanaSimulation = (diffs: SolanaDiff[]): BlockaidSolanaSimulation => ({
  account_summary: { account_assets_diff: diffs },
})

const SPL_A = splToken('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'AAA', 6)
const SPL_B = splToken('BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', 'BBB', 6)
const RECEIPT = splToken('ReCeIpT111111111111111111111111111111111111', 'rcpt')
const WSOL = splToken(WSOL_MINT, 'wSOL')

describe('parseBlockaidSolanaSimulation', () => {
  // The sdk#2091 counterexample: a wrapped-SOL withdrawal netting to SOL
  // received. Reporting any remaining out-leg would state money LEAVING on a
  // transaction that nets to money received — a reversed approval direction.
  it('declines a three-diff withdrawal whose native leg is the principal inflow', async () => {
    const simulation = solanaSimulation([
      solDiff(nativeSol, { in: solSide('1500000000') }),
      solDiff(WSOL, { out: solSide('2039280') }),
      solDiff(RECEIPT, { out: solSide('1490000000') }),
    ])

    await expect(parseBlockaidSolanaSimulation(simulation)).rejects.toThrow()
  })

  it('declines a three-diff deposit whose native leg is the principal outflow', async () => {
    const simulation = solanaSimulation([
      solDiff(nativeSol, { out: solSide('500000000') }),
      solDiff(WSOL, { out: solSide('2039280') }),
      solDiff(RECEIPT, { in: solSide('490000000') }),
    ])

    await expect(parseBlockaidSolanaSimulation(simulation)).rejects.toThrow()
  })

  it('still nets a token swap by excluding a gas-sized native out-leg', async () => {
    const simulation = solanaSimulation([
      solDiff(SPL_A, { out: solSide('1000000') }),
      solDiff(SPL_B, { in: solSide('2500000') }),
      solDiff(nativeSol, { out: solSide('5000') }),
    ])

    expect(await parseBlockaidSolanaSimulation(simulation)).toEqual({
      swap: {
        fromMint: SPL_A.address,
        toMint: SPL_B.address,
        fromAmount: 1000000n,
        toAmount: 2500000n,
        toAssetDecimal: 6,
      },
    })
  })

  it('keeps a rent-refund-sized native in-leg from blocking a token swap headline', async () => {
    const simulation = solanaSimulation([
      solDiff(SPL_A, { out: solSide('1000000') }),
      solDiff(SPL_B, { in: solSide('2500000') }),
      solDiff(nativeSol, { in: solSide('2039280') }),
    ])

    expect(await parseBlockaidSolanaSimulation(simulation)).toEqual({
      swap: {
        fromMint: SPL_A.address,
        toMint: SPL_B.address,
        fromAmount: 1000000n,
        toAmount: 2500000n,
        toAssetDecimal: 6,
      },
    })
  })

  it('reports a token send after excluding the gas-sized native out-leg', async () => {
    const simulation = solanaSimulation([
      solDiff(SPL_A, { out: solSide('750000') }),
      solDiff(nativeSol, { out: solSide('5000') }),
    ])

    expect(await parseBlockaidSolanaSimulation(simulation)).toEqual({
      transfer: { fromMint: SPL_A.address, fromAmount: 750000n },
    })
  })

  it('locks the swap direction regardless of diff order', async () => {
    const simulation = solanaSimulation([
      solDiff(SPL_B, { in: solSide('2500000') }),
      solDiff(SPL_A, { out: solSide('1000000') }),
    ])

    expect(await parseBlockaidSolanaSimulation(simulation)).toEqual({
      swap: {
        fromMint: SPL_A.address,
        toMint: SPL_B.address,
        fromAmount: 1000000n,
        toAmount: 2500000n,
        toAssetDecimal: 6,
      },
    })
  })

  it('declines two simultaneous spends rather than reporting only the first', async () => {
    const simulation = solanaSimulation([
      solDiff(SPL_A, { out: solSide('1000000') }),
      solDiff(SPL_B, { out: solSide('2500000') }),
    ])

    await expect(parseBlockaidSolanaSimulation(simulation)).rejects.toThrow()
  })

  it('reports a lone gas-sized native send instead of filtering it away', async () => {
    const simulation = solanaSimulation([solDiff(nativeSol, { out: solSide('5000000') })])

    expect(await parseBlockaidSolanaSimulation(simulation)).toEqual({
      transfer: { fromMint: WSOL_MINT, fromAmount: 5000000n },
    })
  })

  it('declines a SOL-to-wrapped-SOL pair instead of calling it a swap', async () => {
    const simulation = solanaSimulation([
      solDiff(nativeSol, { out: solSide('1000000000') }),
      solDiff(WSOL, { in: solSide('1000000000') }),
    ])

    await expect(parseBlockaidSolanaSimulation(simulation)).rejects.toThrow()
  })
})

type SuiDiff = NonNullable<NonNullable<BlockaidSuiSimulation['account_summary']>['account_assets_diffs']>[number]
type SuiAsset = SuiDiff['asset']

const nativeSuiAsset: SuiAsset = { type: 'NATIVE', symbol: 'SUI', decimals: 9 }

const suiCoin = (id: string, symbol: string): SuiAsset => ({
  type: 'COIN',
  id,
  symbol,
  decimals: 9,
})

const suiDiff = (asset: SuiAsset, sides: { in?: number; out?: number }): SuiDiff => ({
  asset,
  in: sides.in === undefined ? null : { raw_value: sides.in },
  out: sides.out === undefined ? null : { raw_value: sides.out },
})

const suiSimulation = (diffs: SuiDiff[]): BlockaidSuiSimulation => ({
  account_summary: { account_assets_diffs: diffs },
})

const SUI_COIN_A = suiCoin('0xaaa::coin::AAA', 'AAA')
const SUI_COIN_B = suiCoin('0xbbb::coin::BBB', 'BBB')

describe('parseBlockaidSuiSimulation', () => {
  it('declines when the native leg is the principal outflow instead of hiding it', async () => {
    const simulation = suiSimulation([
      suiDiff(nativeSuiAsset, { out: 5_000_000_000 }),
      suiDiff(SUI_COIN_A, { out: 1_000_000 }),
      suiDiff(SUI_COIN_B, { in: 2_500_000 }),
    ])

    expect(await parseBlockaidSuiSimulation(simulation)).toBeNull()
  })

  it('still nets a coin swap by excluding a gas-sized native out-leg', async () => {
    const simulation = suiSimulation([
      suiDiff(SUI_COIN_A, { out: 1_000_000 }),
      suiDiff(SUI_COIN_B, { in: 2_500_000 }),
      suiDiff(nativeSuiAsset, { out: 3_000_000 }),
    ])

    const result = await parseBlockaidSuiSimulation(simulation)
    expect(result).toMatchObject({
      swap: {
        from: { coinType: '0xaaa::coin::AAA' },
        to: { coinType: '0xbbb::coin::BBB' },
        fromAmount: 1000000n,
        toAmount: 2500000n,
      },
    })
  })

  it('reports a coin send after excluding the gas-sized native out-leg', async () => {
    const simulation = suiSimulation([
      suiDiff(SUI_COIN_A, { out: 750_000 }),
      suiDiff(nativeSuiAsset, { out: 3_000_000 }),
    ])

    const result = await parseBlockaidSuiSimulation(simulation)
    expect(result).toMatchObject({
      transfer: { from: { coinType: '0xaaa::coin::AAA' }, fromAmount: 750000n },
    })
  })
})
