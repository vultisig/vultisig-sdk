import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { ThorchainInboundAddress } from '@vultisig/core-chain/chains/cosmos/thor/getThorchainInboundAddress'
import { THORChainSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getChainSpecific: vi.fn(async () => ({
    case: 'thorchainSpecific' as const,
    value: create(THORChainSpecificSchema, { accountNumber: 1n, sequence: 2n, fee: 2000000n }),
  })),
  getKeysignUtxoInfo: vi.fn(async () => []),
  getThorchainInboundAddress: vi.fn(async (): Promise<ThorchainInboundAddress[]> => []),
  refineKeysignUtxo: vi.fn(async ({ keysignPayload }: { keysignPayload: unknown }) => keysignPayload),
}))

vi.mock('@vultisig/core-mpc/keysign/chainSpecific', () => ({ getChainSpecific: mocks.getChainSpecific }))
vi.mock('@vultisig/core-mpc/keysign/utxo/getKeysignUtxoInfo', () => ({
  getKeysignUtxoInfo: mocks.getKeysignUtxoInfo,
}))
vi.mock('@vultisig/core-mpc/keysign/refine/utxo', () => ({ refineKeysignUtxo: mocks.refineKeysignUtxo }))
vi.mock('@vultisig/core-chain/chains/cosmos/thor/getThorchainInboundAddress', () => ({
  getThorchainInboundAddress: mocks.getThorchainInboundAddress,
}))

import { doesCancelLimitSwapMemoFit } from '@vultisig/core-chain/swap/native/limitSwapCancelMemo'

import { buildLimitSwapCancelKeysignPayload } from './buildLimitSwapCancelKeysignPayload'

const inbound = (chain: string, overrides: Partial<ThorchainInboundAddress> = {}): ThorchainInboundAddress => ({
  address: `${chain.toLowerCase()}-vault`,
  chain,
  chain_lp_actions_paused: false,
  chain_trading_paused: false,
  dust_threshold: '10000',
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

const publicKey = { data: () => new Uint8Array([1, 2, 3]) } as never

const runeCoin = { chain: Chain.THORChain, address: 'thor1sender', ticker: 'RUNE', decimals: 8 }
const ethCoin = { chain: Chain.Ethereum, address: '0xsender', ticker: 'ETH', decimals: 18 }
const btcCoin = { chain: Chain.Bitcoin, address: 'bc1sender', ticker: 'BTC', decimals: 8 }
const usdcCoin = {
  chain: Chain.Ethereum,
  address: '0xsender',
  id: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  ticker: 'USDC',
  decimals: 6,
}

const fullUsdc = 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48'

// Named by FUNDING chain: the builder now requires the signing coin's chain to
// be the one the memo's source asset names, so each test has to pair them.
const memo = `m=<:100000000THOR.RUNE:43079145${fullUsdc}:0`
const ethSourcedMemo = 'm=<:1000000000000000000ETH.ETH:5000000000THOR.RUNE:0'
const btcSourcedMemo = 'm=<:100000000BTC.BTC:5000000THOR.RUNE:0'
/** BTC-sourced with a full-contract target — overflows the 80-byte OP_RETURN. */
const btcSourcedOverlongMemo = `m=<:100000000BTC.BTC:43079145${fullUsdc}:0`

const baseInput = {
  memo,
  vaultId: 'vault-id',
  localPartyId: 'local-party',
  publicKey,
  libType: 'DKLS' as const,
  walletCore: {} as never,
}

describe('buildLimitSwapCancelKeysignPayload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getThorchainInboundAddress.mockResolvedValue([
      inbound('BTC'),
      inbound('ETH', { router: '0xrouter', dust_threshold: '10000' }),
    ])
  })

  describe('THORChain source (MsgDeposit)', () => {
    it('signs a deposit with no inbound vault, no value, and the memo attached', async () => {
      const payload = await buildLimitSwapCancelKeysignPayload({ ...baseInput, signingCoin: runeCoin })

      expect(payload.memo).toBe(memo)
      expect(payload.toAddress).toBe(runeCoin.address)
      // A cancel closes a position; attaching value would be a donation.
      expect(payload.toAmount).toBe('0')
      expect(mocks.getChainSpecific).toHaveBeenCalledWith(expect.objectContaining({ isDeposit: true }))
    })

    it('refuses to sign while THORChain has globally paused trading', async () => {
      mocks.getThorchainInboundAddress.mockResolvedValue([inbound('BTC', { global_trading_paused: true })])

      await expect(buildLimitSwapCancelKeysignPayload({ ...baseInput, signingCoin: runeCoin })).rejects.toThrow(
        /globally paused trading/
      )
    })

    it('refuses to sign when the inbound list is unverifiable', async () => {
      mocks.getThorchainInboundAddress.mockResolvedValue([])

      await expect(buildLimitSwapCancelKeysignPayload({ ...baseInput, signingCoin: runeCoin })).rejects.toThrow(
        /globally paused trading|unverifiable/
      )
    })
  })

  describe('L1 source (dust transfer to the inbound vault)', () => {
    it('targets the live Asgard vault and attaches derived dust', async () => {
      const payload = await buildLimitSwapCancelKeysignPayload({
        ...baseInput,
        memo: ethSourcedMemo,
        signingCoin: ethCoin,
      })

      expect(payload.toAddress).toBe('eth-vault')
      expect(payload.memo).toBe(ethSourcedMemo)
      // 10000 in THORChain's 1e8 rescaled to 18 decimals, doubled.
      expect(payload.toAmount).toBe((10_000n * 10n ** 10n * 2n).toString())
      expect(mocks.getChainSpecific).toHaveBeenCalledWith(expect.objectContaining({ isDeposit: false }))
    })

    // The exact failure this rescaling exists for: 2000 wei is what an
    // un-rescaled threshold produces, and ConvertAmount truncates it to zero.
    it('never attaches the raw 1e8 threshold to an 18-decimal chain', async () => {
      const payload = await buildLimitSwapCancelKeysignPayload({
        ...baseInput,
        memo: ethSourcedMemo,
        signingCoin: ethCoin,
      })

      expect(BigInt(payload.toAmount)).toBeGreaterThan(10_000n * 2n)
    })

    it('refuses a halted source chain rather than paying into a dead vault', async () => {
      mocks.getThorchainInboundAddress.mockResolvedValue([inbound('ETH', { halted: true })])

      await expect(
        buildLimitSwapCancelKeysignPayload({ ...baseInput, memo: ethSourcedMemo, signingCoin: ethCoin })
      ).rejects.toThrow(/no live, tradeable THORChain inbound/)
    })

    it('refuses when the inbound publishes no dust threshold', async () => {
      mocks.getThorchainInboundAddress.mockResolvedValue([inbound('ETH', { dust_threshold: '' })])

      await expect(
        buildLimitSwapCancelKeysignPayload({ ...baseInput, memo: ethSourcedMemo, signingCoin: ethCoin })
      ).rejects.toThrow(/dust_threshold/)
    })

    it('refines the payload for a UTXO source', async () => {
      await buildLimitSwapCancelKeysignPayload({ ...baseInput, memo: btcSourcedMemo, signingCoin: btcCoin })

      expect(mocks.refineKeysignUtxo).toHaveBeenCalled()
    })
  })

  describe('fail-closed gates', () => {
    // A retarget re-prices a resting order. Signing one from a function whose
    // callers believe they are cancelling leaves the position open.
    it('rejects a retarget rather than treating it as a cancel', async () => {
      const retarget = `m=<:100000000THOR.RUNE:43079145${fullUsdc}:50000000`

      await expect(
        buildLimitSwapCancelKeysignPayload({ ...baseInput, memo: retarget, signingCoin: runeCoin })
      ).rejects.toThrow(/re-targets a limit order/)
      expect(mocks.getChainSpecific).not.toHaveBeenCalled()
    })

    it.each([
      ['=<:ETH.ETH:0xdest:100/14400/0', 'placement'],
      ['=>:ETH.ETH:0xdest:100', 'market swap'],
      ['+:BTC.BTC', 'LP add'],
      ['', 'empty'],
    ])('rejects a %s memo', async (badMemo: string) => {
      await expect(
        buildLimitSwapCancelKeysignPayload({ ...baseInput, memo: badMemo, signingCoin: runeCoin })
      ).rejects.toThrow(/not a THORChain limit-order cancel/)
    })

    // Nothing in a cancel memo can be shortened, so an over-long one has to be
    // refused rather than silently truncated into a memo matching no order.
    it('refuses a memo that overflows a UTXO source OP_RETURN', async () => {
      await expect(
        buildLimitSwapCancelKeysignPayload({ ...baseInput, memo: btcSourcedOverlongMemo, signingCoin: btcCoin })
      ).rejects.toThrow(/memo budget/)
    })

    // A token here builds an ERC20 transfer, which drops the memo entirely —
    // the cancel confirms, costs gas, and closes nothing.
    it('refuses a token signing coin', async () => {
      await expect(buildLimitSwapCancelKeysignPayload({ ...baseInput, signingCoin: usdcCoin })).rejects.toThrow(
        /must be signed with Ethereum's gas asset/
      )
    })
  })

  // The coin and the memo arrive as independent parameters. THORChain requires
  // `From.IsChain(Source.Asset.GetChain())`, so a mismatched pair broadcasts
  // cleanly and is then refunded — a successful-looking transaction that cancels
  // nothing, which is the exact failure this whole module guards against.
  describe('signing chain must match the memo funding chain', () => {
    // The control: this pairing is correct and must keep building, so the
    // rejections below cannot be passing for some unrelated reason.
    it('builds when the coin is the chain the memo names', async () => {
      const payload = await buildLimitSwapCancelKeysignPayload({
        ...baseInput,
        memo: btcSourcedMemo,
        signingCoin: btcCoin,
      })

      expect(payload.toAddress).toBe('btc-vault')
    })

    it('refuses an ETH coin against a BTC-sourced memo', async () => {
      await expect(
        buildLimitSwapCancelKeysignPayload({ ...baseInput, memo: btcSourcedMemo, signingCoin: ethCoin })
      ).rejects.toThrow(/funded on Bitcoin, so its cancel must be sent from Bitcoin, not Ethereum/)
    })

    // The mirror pairing was already rejected, but only incidentally — the memo
    // overflowed BTC's OP_RETURN budget. Pinned against a memo that FITS the
    // signing chain, so it is the chain check doing the work, not the byte one.
    it('refuses an ETH coin against a THORChain-sourced memo that fits', async () => {
      expect(doesCancelLimitSwapMemoFit(memo, 'other')).toBe(true)

      await expect(buildLimitSwapCancelKeysignPayload({ ...baseInput, memo, signingCoin: ethCoin })).rejects.toThrow(
        /funded on THORChain, so its cancel must be sent from THORChain, not Ethereum/
      )
    })

    it('refuses a RUNE coin against an L1-sourced memo', async () => {
      await expect(
        buildLimitSwapCancelKeysignPayload({ ...baseInput, memo: btcSourcedMemo, signingCoin: runeCoin })
      ).rejects.toThrow(/funded on Bitcoin/)
    })

    // A secured asset originates on Ethereum but is custodied on THORChain, so
    // `GetChain()` says THOR — the home chain would be the wrong authority here.
    it('sends a secured-asset order from THORChain, not its home chain', async () => {
      const securedMemo = 'm=<:100000000eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48:5000000THOR.RUNE:0'

      const payload = await buildLimitSwapCancelKeysignPayload({
        ...baseInput,
        memo: securedMemo,
        signingCoin: runeCoin,
      })

      expect(mocks.getChainSpecific).toHaveBeenCalledWith(expect.objectContaining({ isDeposit: true }))
      expect(payload.toAmount).toBe('0')

      await expect(
        buildLimitSwapCancelKeysignPayload({ ...baseInput, memo: securedMemo, signingCoin: ethCoin })
      ).rejects.toThrow(/funded on THORChain/)
    })

    it('refuses a memo whose source asset names an unroutable chain', async () => {
      await expect(
        buildLimitSwapCancelKeysignPayload({
          ...baseInput,
          memo: 'm=<:100000000NOPE.NOPE:5000000THOR.RUNE:0',
          signingCoin: runeCoin,
        })
      ).rejects.toThrow(/cannot resolve which chain must send this cancel/)
    })
  })
})
