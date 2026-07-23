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
  getAdvancedSwapQueueEnabled: vi.fn(async () => true),
  getThorchainInboundAddress: vi.fn(async (): Promise<ThorchainInboundAddress[]> => []),
  getErc20Allowance: vi.fn(async () => 0n),
  refineKeysignUtxo: vi.fn(async ({ keysignPayload }: { keysignPayload: unknown }) => keysignPayload),
}))

vi.mock('@vultisig/core-mpc/keysign/chainSpecific', () => ({ getChainSpecific: mocks.getChainSpecific }))
vi.mock('@vultisig/core-mpc/keysign/utxo/getKeysignUtxoInfo', () => ({
  getKeysignUtxoInfo: mocks.getKeysignUtxoInfo,
}))
vi.mock('@vultisig/core-mpc/keysign/refine/utxo', () => ({ refineKeysignUtxo: mocks.refineKeysignUtxo }))
vi.mock('@vultisig/core-chain/swap/native/limitSwapAvailability', () => ({
  getAdvancedSwapQueueEnabled: mocks.getAdvancedSwapQueueEnabled,
}))
vi.mock('@vultisig/core-chain/chains/cosmos/thor/getThorchainInboundAddress', () => ({
  getThorchainInboundAddress: mocks.getThorchainInboundAddress,
}))
vi.mock('@vultisig/core-chain/chains/evm/erc20/getErc20Allowance', () => ({
  getErc20Allowance: mocks.getErc20Allowance,
}))

import { buildLimitSwapKeysignPayload } from './buildLimitSwapKeysignPayload'

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

const publicKey = { data: () => new Uint8Array([1, 2, 3]) } as never

const runeCoin = { chain: Chain.THORChain, address: 'thor1sender', ticker: 'RUNE', decimals: 8 }
const ethCoin = { chain: Chain.Ethereum, address: '0xsender', ticker: 'ETH', decimals: 18 }
const usdcCoin = {
  chain: Chain.Ethereum,
  address: '0xsender',
  id: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  ticker: 'USDC',
  decimals: 6,
}
const btcCoin = { chain: Chain.Bitcoin, address: 'bc1sender', ticker: 'BTC', decimals: 8 }

const memo = '=<:ETH.ETH:0x742d35Cc6634C0532925a3b844Bc454e4438f44e:1600000000/14400/0:v0:50'

const baseInput = {
  toCoin: ethCoin,
  amount: 100_000_000n,
  memo,
  vaultId: 'vault-id',
  localPartyId: 'local-party',
  fromPublicKey: publicKey,
  toPublicKey: publicKey,
  libType: 'DKLS' as const,
  walletCore: {} as never,
  now: 1_700_000_000_000,
}

describe('buildLimitSwapKeysignPayload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAdvancedSwapQueueEnabled.mockResolvedValue(true)
    mocks.getErc20Allowance.mockResolvedValue(0n)
    mocks.getThorchainInboundAddress.mockResolvedValue([inbound('BTC'), inbound('ETH', { router: '0xrouter' })])
  })

  describe('native RUNE (MsgDeposit)', () => {
    it('signs a deposit with no inbound vault and the memo attached', async () => {
      const payload = await buildLimitSwapKeysignPayload({ ...baseInput, fromCoin: runeCoin })

      expect(payload.memo).toBe(memo)
      expect(payload.toAddress).toBe(runeCoin.address)
      expect(payload.swapPayload.case).toBeUndefined()
      expect(mocks.getChainSpecific).toHaveBeenCalledWith(expect.objectContaining({ isDeposit: true }))
    })

    // RUNE bypasses the per-chain inbound halt filter entirely, so the global
    // pause is its only gate.
    it('refuses to sign while THORChain has globally paused trading', async () => {
      mocks.getThorchainInboundAddress.mockResolvedValue([inbound('BTC', { global_trading_paused: true })])

      await expect(buildLimitSwapKeysignPayload({ ...baseInput, fromCoin: runeCoin })).rejects.toThrow(
        /globally paused trading/
      )
    })

    it('refuses to sign when the inbound list is unverifiable', async () => {
      mocks.getThorchainInboundAddress.mockResolvedValue([])

      await expect(buildLimitSwapKeysignPayload({ ...baseInput, fromCoin: runeCoin })).rejects.toThrow(
        /globally paused trading|unverifiable/
      )
    })
  })

  describe('native gas asset (inbound vault transfer)', () => {
    it('targets the live Asgard vault and carries no swap payload', async () => {
      const payload = await buildLimitSwapKeysignPayload({ ...baseInput, fromCoin: ethCoin, toCoin: btcCoin })

      expect(payload.toAddress).toBe('eth-vault')
      expect(payload.memo).toBe(memo)
      expect(payload.swapPayload.case).toBeUndefined()
      expect(payload.erc20ApprovePayload).toBeUndefined()
      expect(mocks.getChainSpecific).toHaveBeenCalledWith(expect.objectContaining({ isDeposit: false }))
    })

    it('refuses a halted source chain', async () => {
      mocks.getThorchainInboundAddress.mockResolvedValue([inbound('ETH', { halted: true })])

      await expect(buildLimitSwapKeysignPayload({ ...baseInput, fromCoin: ethCoin, toCoin: btcCoin })).rejects.toThrow(
        /no live, tradeable THORChain inbound/
      )
    })
  })

  describe('ERC20 (router depositWithExpiry + approve)', () => {
    it('targets the router and carries the swap payload the router call needs', async () => {
      const payload = await buildLimitSwapKeysignPayload({ ...baseInput, fromCoin: usdcCoin, toCoin: btcCoin })

      expect(payload.toAddress).toBe('0xrouter')
      expect(payload.swapPayload.case).toBe('thorchainSwapPayload')

      const swap = payload.swapPayload.case === 'thorchainSwapPayload' ? payload.swapPayload.value : undefined
      expect(swap?.routerAddress).toBe('0xrouter')
      expect(swap?.vaultAddress).toBe('eth-vault')
      expect(swap?.fromAmount).toBe('100000000')
      // The order's real floor is the LIM in the memo; these travel for display only.
      expect(swap?.toAmountLimit).toBe('0')
    })

    it('approves the router when allowance is short', async () => {
      const payload = await buildLimitSwapKeysignPayload({ ...baseInput, fromCoin: usdcCoin, toCoin: btcCoin })

      expect(payload.erc20ApprovePayload?.spender).toBe('0xrouter')
      expect(payload.erc20ApprovePayload?.amount).toBe('100000000')
    })

    it('skips the approve when allowance already covers the deposit', async () => {
      mocks.getErc20Allowance.mockResolvedValue(10n ** 30n)

      const payload = await buildLimitSwapKeysignPayload({ ...baseInput, fromCoin: usdcCoin, toCoin: btcCoin })

      expect(payload.erc20ApprovePayload).toBeUndefined()
    })

    // Without a router the tokens cannot be deposited; falling back to a plain
    // transfer would strand them on the vault with no memo.
    it('refuses a token source whose inbound has no router', async () => {
      mocks.getThorchainInboundAddress.mockResolvedValue([inbound('ETH')])

      await expect(buildLimitSwapKeysignPayload({ ...baseInput, fromCoin: usdcCoin, toCoin: btcCoin })).rejects.toThrow(
        /no router contract/
      )
    })

    it('bounds the router call with a 15-minute execution deadline', async () => {
      const payload = await buildLimitSwapKeysignPayload({ ...baseInput, fromCoin: usdcCoin, toCoin: btcCoin })

      const swap = payload.swapPayload.case === 'thorchainSwapPayload' ? payload.swapPayload.value : undefined
      expect(swap?.expirationTime).toBe(BigInt(1_700_000_000 + 15 * 60))
    })
  })

  describe('fail-closed gates', () => {
    it('refuses to build anything while the advanced swap queue is disabled', async () => {
      mocks.getAdvancedSwapQueueEnabled.mockResolvedValue(false)

      await expect(buildLimitSwapKeysignPayload({ ...baseInput, fromCoin: runeCoin })).rejects.toThrow(
        /advanced swap queue is disabled/
      )
      expect(mocks.getChainSpecific).not.toHaveBeenCalled()
    })

    // The builder takes a pre-built memo, so a market or unrelated memo reaching
    // it would sign a deposit with completely different semantics.
    it.each([
      ['=>:ETH.ETH:0xdest:100/1/0', 'market swap'],
      ['+:BTC.BTC', 'LP add'],
      ['', 'empty'],
    ])('rejects a %s memo', async (badMemo: string) => {
      await expect(buildLimitSwapKeysignPayload({ ...baseInput, fromCoin: runeCoin, memo: badMemo })).rejects.toThrow(
        /not a THORChain limit-swap memo/
      )
    })

    it('rejects a non-positive amount rather than signing an empty deposit', async () => {
      await expect(buildLimitSwapKeysignPayload({ ...baseInput, fromCoin: runeCoin, amount: 0n })).rejects.toThrow(
        /amount must be greater than 0/
      )
    })
  })

  it('refines the payload for a UTXO source', async () => {
    await buildLimitSwapKeysignPayload({ ...baseInput, fromCoin: btcCoin, toCoin: ethCoin })

    expect(mocks.refineKeysignUtxo).toHaveBeenCalled()
  })
})
