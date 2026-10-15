import { EvmChain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import suiSimulationFixtures from '../../../../../fixtures/blockaid-sui-simulations.json'
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

describe('parseBlockaidSolanaSimulation', () => {
  const WSOL_MINT = 'So11111111111111111111111111111111111111112'
  const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

  type SolanaAssetDiff = BlockaidSolanaSimulation['account_summary']['account_assets_diff'][number]
  type SolanaSide = NonNullable<SolanaAssetDiff['in']>

  const solSide = (rawValue: string): SolanaSide => ({ usd_price: 0, summary: '', value: 0, raw_value: rawValue })

  const solDiff = (parts: Partial<SolanaAssetDiff> & Pick<SolanaAssetDiff, 'asset'>): SolanaAssetDiff => ({
    in: null,
    out: null,
    asset_type: parts.asset.type,
    ...parts,
  })

  const nativeSolAsset = { type: 'SOL' as const, symbol: 'SOL', decimals: 9, logo: '' }
  const wsolAsset = { type: 'TOKEN' as const, address: WSOL_MINT, symbol: 'WSOL', decimals: 9, logo: '' }
  const usdcAsset = { type: 'TOKEN' as const, address: USDC_MINT, symbol: 'USDC', decimals: 6, logo: '' }

  const buildSolanaSimulation = (diffs: SolanaAssetDiff[]): BlockaidSolanaSimulation => ({
    account_summary: { account_assets_diff: diffs },
  })

  it('nets a wrap-then-spend (SOL out + WSOL in) to a single transfer, not a bogus SOL->WSOL swap (sdk#1997)', async () => {
    // Captured Kamino Allez SOL vault deposit shape from the issue: wraps SOL
    // then spends it, leaving only the WSOL token account's rent-exempt
    // residual (2_039_280) as an `in` leg.
    const result = await parseBlockaidSolanaSimulation(
      buildSolanaSimulation([
        solDiff({ asset: nativeSolAsset, out: solSide('59435000') }),
        solDiff({ asset: wsolAsset, in: solSide('2039280') }),
      ])
    )

    expect(result).toEqual({
      transfer: {
        fromMint: WSOL_MINT,
        fromAmount: 57395720n, // 59_435_000 - 2_039_280 net spend, not the raw 2_039_280 residual
      },
    })
  })

  it('nets the reverse direction (WSOL out + SOL in, an unwrap/close) without inventing a receive amount', async () => {
    // Reverse of the captured case: unwrapping/closing a WSOL account nets a
    // POSITIVE change (a receive), which this parser's `swap`/`transfer`
    // contract has no shape for — it must throw instead of mislabeling a
    // receive as an outgoing transfer.
    await expect(
      parseBlockaidSolanaSimulation(
        buildSolanaSimulation([
          solDiff({ asset: wsolAsset, out: solSide('2039280') }),
          solDiff({ asset: nativeSolAsset, in: solSide('59435000') }),
        ])
      )
    ).rejects.toThrow('Invalid simulation data: no out value for transfer')
  })

  it('still emits a genuine swap between two distinct mints', async () => {
    const result = await parseBlockaidSolanaSimulation(
      buildSolanaSimulation([
        solDiff({ asset: nativeSolAsset, out: solSide('1000000000') }),
        solDiff({ asset: usdcAsset, in: solSide('150000000') }),
      ])
    )

    expect(result).toEqual({
      swap: {
        fromMint: WSOL_MINT,
        toMint: USDC_MINT,
        fromAmount: 1000000000n,
        toAmount: 150000000n,
        toAssetDecimal: 6,
      },
    })
  })

  it('includes fee-bearing native SOL movements in the complete net amount', async () => {
    const result = await parseBlockaidSolanaSimulation(
      buildSolanaSimulation([
        solDiff({ asset: nativeSolAsset, out: solSide('5000') }), // network fee
        solDiff({ asset: nativeSolAsset, out: solSide('1000000000') }),
        solDiff({ asset: usdcAsset, in: solSide('150000000') }),
      ])
    )

    expect(result).toMatchObject({
      swap: { fromMint: WSOL_MINT, toMint: USDC_MINT, fromAmount: 1000005000n, toAmount: 150000000n },
    })
  })

  const permutations = ([a, b, c]: [SolanaAssetDiff, SolanaAssetDiff, SolanaAssetDiff]) => [
    [a, b, c],
    [a, c, b],
    [b, a, c],
    [b, c, a],
    [c, a, b],
    [c, b, a],
  ]

  for (const nativeTag of ['asset', 'diff'] as const) {
    for (const direction of ['receive', 'send'] as const) {
      const receiving = direction === 'receive'
      const principal = solDiff({
        asset: nativeTag === 'asset' ? nativeSolAsset : { ...nativeSolAsset, type: 'TOKEN' },
        asset_type: 'SOL',
        in: receiving ? solSide('1000000000') : null,
        out: receiving ? null : solSide('1000000000'),
      })
      const residual = solDiff({
        asset: wsolAsset,
        in: receiving ? null : solSide('2039280'),
        out: receiving ? solSide('2039280') : null,
      })
      const sameDirectionToken = solDiff({
        asset: usdcAsset,
        in: receiving ? solSide('1000000') : null,
        out: receiving ? null : solSide('1000000'),
      })
      it.each(permutations([principal, residual, sameDirectionToken]).map(diffs => [diffs]))(
        `declines the reversed-${direction} counterexample with ${nativeTag}-level SOL metadata in every order (%#)`,
        async diffs => {
          await expect(parseBlockaidSolanaSimulation(buildSolanaSimulation(diffs))).rejects.toThrow(
            'Invalid simulation data'
          )
        }
      )
      const oppositeToken = { ...sameDirectionToken, in: sameDirectionToken.out, out: sameDirectionToken.in }
      it.each(permutations([principal, residual, oppositeToken]).map(diffs => [diffs]))(
        `preserves the principal ${direction} for withdrawal/deposit with ${nativeTag}-level SOL metadata in every order (%#)`,
        async diffs => {
          const result = await parseBlockaidSolanaSimulation(buildSolanaSimulation(diffs))
          expect(result).toEqual({
            swap: {
              fromMint: receiving ? USDC_MINT : WSOL_MINT,
              toMint: receiving ? WSOL_MINT : USDC_MINT,
              fromAmount: receiving ? 1000000n : 997960720n,
              toAmount: receiving ? 997960720n : 1000000n,
              toAssetDecimal: receiving ? 9 : 6,
            },
          })
        }
      )
    }
  }

  it.each(['1', '5000', '100000', '10000000'])(
    'does not discard a small native principal of %s lamports from a token swap',
    async raw => {
      for (const diffs of permutations([
        solDiff({ asset: nativeSolAsset, out: solSide(raw) }),
        solDiff({ asset: usdcAsset, out: solSide('1000000') }),
        solDiff({ asset: { ...usdcAsset, address: 'AnotherMint' }, in: solSide('2000000') }),
      ])) {
        await expect(parseBlockaidSolanaSimulation(buildSolanaSimulation(diffs))).rejects.toThrow(
          'Invalid simulation data'
        )
      }
    }
  )

  it('retains same-mint fee-sized movements regardless of which native leg appears first', async () => {
    for (const diffs of permutations([
      solDiff({ asset: nativeSolAsset, out: solSide('5000') }),
      solDiff({ asset: nativeSolAsset, out: solSide('1000000000') }),
      solDiff({ asset: usdcAsset, in: solSide('150000000') }),
    ])) {
      expect(await parseBlockaidSolanaSimulation(buildSolanaSimulation(diffs))).toEqual({
        swap: {
          fromMint: WSOL_MINT,
          toMint: USDC_MINT,
          fromAmount: 1000005000n,
          toAmount: 150000000n,
          toAssetDecimal: 6,
        },
      })
    }
  })

  it('emits a plain transfer for a single-mint send', async () => {
    const result = await parseBlockaidSolanaSimulation(
      buildSolanaSimulation([solDiff({ asset: usdcAsset, out: solSide('42000000') })])
    )

    expect(result).toEqual({ transfer: { fromMint: USDC_MINT, fromAmount: 42000000n } })
  })

  it('resolves native SOL to the WSOL mint via the diff-level asset_type even when asset.type disagrees (inconsistent Blockaid metadata)', async () => {
    // Some Blockaid responses carry asset_type: 'SOL' at the diff level while
    // asset.type says 'TOKEN' with no address; the diff-level native tag
    // still identifies the canonical SOL/WSOL group.
    const inconsistentNativeSol: SolanaAssetDiff['asset'] = {
      type: 'TOKEN',
      symbol: 'SOL',
      decimals: 9,
      logo: '',
    }

    const result = await parseBlockaidSolanaSimulation(
      buildSolanaSimulation([
        { asset: inconsistentNativeSol, out: solSide('59435000'), in: null, asset_type: 'SOL' },
        solDiff({ asset: wsolAsset, in: solSide('2039280') }),
      ])
    )

    expect(result).toEqual({
      transfer: {
        fromMint: WSOL_MINT,
        fromAmount: 57395720n,
      },
    })
  })

  it('throws rather than guess when three distinct nonzero mints remain', async () => {
    await expect(
      parseBlockaidSolanaSimulation(
        buildSolanaSimulation([
          solDiff({ asset: nativeSolAsset, out: solSide('1000000000') }),
          solDiff({ asset: usdcAsset, in: solSide('150000000') }),
          solDiff({
            asset: {
              type: 'TOKEN',
              address: 'BonkMintReadyToLaunchXXXXXXXXXXXXXXXXXXXXX',
              symbol: 'BONK',
              decimals: 5,
              logo: '',
            },
            in: solSide('9999'),
          }),
        ])
      )
    ).rejects.toThrow('Invalid simulation data')
  })
})

describe('parseBlockaidSuiSimulation', () => {
  type SuiSummary = NonNullable<BlockaidSuiSimulation['account_summary']>
  type SuiDiff = NonNullable<SuiSummary['account_assets_diffs']>[number]
  type SuiRawAsset = SuiDiff['asset']

  const sui = '0x2::sui::SUI'
  const native: SuiRawAsset = { type: 'NATIVE', symbol: 'SUI', name: 'Sui', decimals: 9, logo_url: 'https://logo/sui' }
  const walType = '0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL'
  const usdcType = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'
  const wal: SuiRawAsset = { type: 'COIN', id: walType, symbol: 'WAL', decimals: 9 }
  const usdc: SuiRawAsset = { type: 'COIN', id: usdcType, symbol: 'USDC', decimals: 6 }

  const movement = (asset: SuiRawAsset, direction: 'in' | 'out', raw: number | string): SuiDiff => ({
    asset,
    in: direction === 'in' ? { raw_value: raw } : null,
    out: direction === 'out' ? { raw_value: raw } : null,
  })
  const simulation = (diffs: SuiDiff[]): BlockaidSuiSimulation => ({
    status: 'Success',
    account_summary: { account_assets_diffs: diffs },
  })
  const permutations = <T>(items: T[]): T[][] =>
    items.length <= 1
      ? [items]
      : items.flatMap((item, index) =>
          permutations([...items.slice(0, index), ...items.slice(index + 1)]).map(rest => [item, ...rest])
        )
  const parsedFixture = (name: keyof Omit<typeof suiSimulationFixtures, '_source'>) =>
    parseBlockaidSuiSimulation({
      status: 'Success',
      account_summary: { account_assets_diffs: suiSimulationFixtures[name].account_assets_diffs },
    })

  // Live `/sui/transaction/scan` simulations of unsigned mainnet transactions
  // (fixtures/blockaid-sui-simulations.json). Blockaid nets each coin into one
  // diff and folds gas into native SUI when SUI itself moves.
  describe('live Blockaid responses', () => {
    it('headlines a SUI send with the single native outflow, gas included', async () => {
      await expect(parsedFixture('suiTransfer')).resolves.toEqual({
        transfer: {
          from: { coinType: sui, symbol: 'SUI', decimals: 9, logo: expect.stringContaining('0x2::sui::SUI') },
          fromAmount: 101_088_099n,
        },
      })
    })

    it('headlines a SUI-funded swap with the native outflow and the coin inflow', async () => {
      await expect(parsedFixture('suiToCoinSwap')).resolves.toMatchObject({
        swap: {
          from: { coinType: sui, symbol: 'SUI', decimals: 9 },
          to: { coinType: usdcType, symbol: 'USDC', decimals: 6 },
          fromAmount: 101_424_127n,
          toAmount: 97_961n,
        },
      })
    })

    it('keeps the native inflow of a swap into SUI as the swap destination', async () => {
      await expect(parsedFixture('coinToSuiSwap')).resolves.toMatchObject({
        swap: {
          from: { coinType: walType, symbol: 'WAL', decimals: 9 },
          to: { coinType: sui, symbol: 'SUI', decimals: 9 },
          fromAmount: 13_120_000_000n,
          toAmount: 691_913_411n,
        },
      })
    })

    it('declines a coin send, whose gas is a second, native outflow the response does not identify as gas', async () => {
      await expect(parsedFixture('coinTransfer')).resolves.toBeNull()
    })

    it('declines a coin-to-coin swap with its separate native gas outflow rather than drop a movement', async () => {
      // The former three-diff rule turned this into a WAL -> USDC headline by
      // discarding the native diff; nothing in the response says it is gas.
      await expect(parsedFixture('coinToCoinSwap')).resolves.toBeNull()
    })
  })

  describe('native SUI principal among three diffs', () => {
    it.each([
      ['inflow', 'in', 500_000_000],
      ['outflow', 'out', 500_000_000],
      ['fee-sized inflow', 'in', 1_482_041],
      ['fee-sized outflow', 'out', 1_482_041],
    ] as const)(
      'never discards a native %s to headline the other two legs, in any order',
      async (_, direction, raw) => {
        for (const diffs of permutations([
          movement(native, direction, raw),
          movement(wal, 'out', 13_120_000_000),
          movement(usdc, 'in', 679_441),
        ])) {
          await expect(parseBlockaidSuiSimulation(simulation(diffs))).resolves.toBeNull()
        }
      }
    )

    it('declines two coin outflows plus a native inflow instead of reversing the direction', async () => {
      // The sdk#2091 counterexample shape: with the native inflow discarded,
      // the former rule reported one of the outflows as the whole transfer.
      for (const diffs of permutations([
        movement(native, 'in', 2_000_000_000),
        movement(wal, 'out', 1_000),
        movement(usdc, 'out', 1_000),
      ])) {
        await expect(parseBlockaidSuiSimulation(simulation(diffs))).resolves.toBeNull()
      }
    })
  })

  describe('netting by coin type', () => {
    it('nets split native diffs into one movement so an in/out pair cannot read as two assets', async () => {
      for (const diffs of permutations([
        movement(native, 'in', 700_000_000),
        movement(native, 'out', 8_086_589),
        movement(wal, 'out', 13_120_000_000),
      ])) {
        await expect(parseBlockaidSuiSimulation(simulation(diffs))).resolves.toMatchObject({
          swap: {
            from: { coinType: walType },
            to: { coinType: sui },
            fromAmount: 13_120_000_000n,
            toAmount: 691_913_411n,
          },
        })
      }
    })

    it('nets a diff carrying both sides for the same coin', async () => {
      await expect(
        parseBlockaidSuiSimulation(
          simulation([{ asset: native, in: { raw_value: 700_000_000 }, out: { raw_value: 8_086_589 } }])
        )
      ).resolves.toBeNull()
      await expect(
        parseBlockaidSuiSimulation(
          simulation([{ asset: native, in: { raw_value: 100 }, out: { raw_value: 700_000_000 } }])
        )
      ).resolves.toEqual({ transfer: { from: expect.objectContaining({ coinType: sui }), fromAmount: 699_999_900n } })
    })

    it('ignores a coin whose movements cancel out', async () => {
      const refund: SuiDiff[] = [movement(usdc, 'out', 5_000), movement(usdc, 'in', 5_000)]
      await expect(
        parseBlockaidSuiSimulation(simulation([...refund, movement(wal, 'out', 1_000)]))
      ).resolves.toMatchObject({
        transfer: { from: { coinType: walType }, fromAmount: 1_000n },
      })
    })

    it('groups every spelling of native SUI together', async () => {
      const qualified: SuiRawAsset = { type: 'COIN', id: `0x${'0'.repeat(63)}2::sui::SUI`, symbol: 'SUI', decimals: 9 }
      const byCoinType: SuiRawAsset = { coin_type: sui, symbol: 'SUI', decimals: 9 }
      const bare: SuiRawAsset = { symbol: 'SUI', decimals: 9 }
      await expect(
        parseBlockaidSuiSimulation(
          simulation([
            movement(native, 'out', 400),
            movement(qualified, 'out', 300),
            movement(byCoinType, 'out', 200),
            movement(bare, 'out', 100),
          ])
        )
      ).resolves.toEqual({ transfer: { from: expect.objectContaining({ coinType: sui }), fromAmount: 1_000n } })
    })
  })

  describe('classification', () => {
    it('headlines a swap identically whichever diff comes first', async () => {
      const diffs = [movement(wal, 'out', 1_000), movement(usdc, 'in', 2_000)]
      const expected = {
        swap: {
          from: { coinType: walType, symbol: 'WAL', decimals: 9 },
          to: { coinType: usdcType, symbol: 'USDC', decimals: 6 },
          fromAmount: 1_000n,
          toAmount: 2_000n,
        },
      }
      await expect(parseBlockaidSuiSimulation(simulation(diffs))).resolves.toEqual(expected)
      await expect(parseBlockaidSuiSimulation(simulation([...diffs].reverse()))).resolves.toEqual(expected)
    })

    it.each([
      ['a pure receive', [movement(usdc, 'in', 1)]],
      ['two outflows', [movement(wal, 'out', 1_000), movement(usdc, 'out', 5_000)]],
      ['two inflows', [movement(wal, 'in', 1_000), movement(usdc, 'in', 5_000)]],
      ['an empty diff list', []],
    ] as const)('declines %s', async (_, diffs) => {
      await expect(parseBlockaidSuiSimulation(simulation([...diffs]))).resolves.toBeNull()
    })

    it('reads the singular account_assets_diff key too', async () => {
      await expect(
        parseBlockaidSuiSimulation({ account_summary: { account_assets_diff: [movement(wal, 'out', 1_000)] } })
      ).resolves.toMatchObject({ transfer: { fromAmount: 1_000n } })
    })

    it('declines a missing account summary', async () => {
      await expect(parseBlockaidSuiSimulation({})).resolves.toBeNull()
    })
  })

  describe('malformed amounts and assets', () => {
    it.each([Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, 1.5, '1.5', '1e3', '', -1, '-1'])(
      'declines the unsafe or negative raw_value %s on either side',
      async raw => {
        await expect(parseBlockaidSuiSimulation(simulation([movement(wal, 'out', raw)]))).resolves.toBeNull()
        await expect(
          parseBlockaidSuiSimulation(simulation([movement(wal, 'out', 1), movement(usdc, 'in', raw)]))
        ).resolves.toBeNull()
      }
    )

    it('keeps integer strings above the safe JS number range exact', async () => {
      await expect(
        parseBlockaidSuiSimulation(simulation([movement(wal, 'out', '9007199254740993')]))
      ).resolves.toMatchObject({
        transfer: { fromAmount: 9_007_199_254_740_993n },
      })
    })

    it('declines a coin without any type tag rather than merge it into another group', async () => {
      const untyped: SuiRawAsset = { type: 'COIN', symbol: 'X', decimals: 6 }
      await expect(
        parseBlockaidSuiSimulation(simulation([movement(untyped, 'out', 1), movement(usdc, 'in', 1)]))
      ).resolves.toBeNull()
    })

    it('falls back to the type tag name when a coin has no symbol', async () => {
      const unnamed: SuiRawAsset = { type: 'COIN', id: walType, decimals: 9 }
      await expect(parseBlockaidSuiSimulation(simulation([movement(unnamed, 'out', 1)]))).resolves.toMatchObject({
        transfer: { from: { coinType: walType, symbol: 'WAL' } },
      })
    })
  })
})
