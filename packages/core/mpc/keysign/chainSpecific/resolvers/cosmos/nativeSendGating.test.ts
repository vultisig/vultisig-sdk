/**
 * Coverage for the `isNativeSend` gate in getCosmosChainSpecific: it decides
 * whether the initiator simulates and relays `CosmosSpecific.gas_limit`.
 * `estimateCosmosGasLimit` is mocked so these assert only the branching (which
 * txs get a relayed limit), not the live simulate/WalletCore path.
 */
import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import {
  CosmosSpecificSchema,
  TransactionType,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { SignAminoSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/wasm_execute_contract_payload_pb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@vultisig/core-chain/chains/cosmos/account/getCosmosAccountInfo', () => ({
  getCosmosAccountInfo: vi.fn().mockResolvedValue({
    accountNumber: 7n,
    sequence: 3,
    sequenceBigInt: 3n,
    latestBlock: '1234567_0',
  }),
}))

vi.mock('@vultisig/core-chain/chains/cosmos/gas', () => ({
  getCosmosFeeAmount: vi.fn().mockResolvedValue(7500n),
}))

vi.mock('./gasEstimation/estimateCosmosGasLimit', () => ({
  estimateCosmosGasLimit: vi.fn(),
}))

// Stub only the LCD round-trip; keep the real burn-tax math so the numbers
// below are the ones a device actually signs. 0.005 = the live governance rate.
vi.mock('@vultisig/core-chain/chains/cosmos/terraClassicTax', async importActual => ({
  ...(await importActual<typeof import('@vultisig/core-chain/chains/cosmos/terraClassicTax')>()),
  getTerraClassicBurnTaxRate: vi.fn().mockResolvedValue(5_000_000_000_000_000n),
}))

import { estimateCosmosGasLimit } from './gasEstimation/estimateCosmosGasLimit.js'
import { getCosmosChainSpecific } from './index.js'

const RELAYED = 130_000n

const walletCore = {} as any

type PayloadOverrides = {
  contractAddress?: string
  toAddress?: string
  toAmount?: string
  signData?: any
}

const buildPayload = ({
  contractAddress = '',
  toAddress = 'cosmos1recipient',
  toAmount = '12345',
  signData,
}: PayloadOverrides = {}) => {
  const payload = create(KeysignPayloadSchema, {
    coin: create(CoinSchema, {
      chain: Chain.Cosmos,
      ticker: 'ATOM',
      address: 'cosmos1sender',
      contractAddress,
      decimals: 6,
      isNativeToken: !contractAddress,
      hexPublicKey: '02'.padEnd(66, '0'),
    }),
    toAddress,
    toAmount,
    blockchainSpecific: {
      case: 'cosmosSpecific',
      value: create(CosmosSpecificSchema, {}),
    },
  })
  if (signData) {
    payload.signData = signData
  }
  return payload
}

const resolve = (payload: ReturnType<typeof buildPayload>, transactionType = TransactionType.UNSPECIFIED) =>
  getCosmosChainSpecific({
    keysignPayload: payload,
    walletCore,
    transactionType,
  })

describe('getCosmosChainSpecific — isNativeSend gate', () => {
  beforeEach(() => {
    vi.mocked(estimateCosmosGasLimit).mockReset().mockResolvedValue(RELAYED)
  })

  it('simulates and relays gas_limit for a native bank send', async () => {
    const result = await resolve(buildPayload())

    expect(estimateCosmosGasLimit).toHaveBeenCalledOnce()
    expect(result.gasLimit).toBe(RELAYED)
  })

  it('leaves gas_limit unset for a token (non-fee-coin) send', async () => {
    const result = await resolve(buildPayload({ contractAddress: 'uxyz' }))

    expect(estimateCosmosGasLimit).not.toHaveBeenCalled()
    expect(result.gasLimit).toBeUndefined()
  })

  it('relays the widened COSMOS-02 gas limit for an IBC transfer without simulating', async () => {
    // Cosmos static limit is 200_000; the source leg of an ICS-20 MsgTransfer
    // gets IBC_GAS_MULTIPLIER headroom. It has to travel in gas_limit so every
    // co-signer resolves the same value — the read side applies no multiplier.
    const result = await resolve(buildPayload(), TransactionType.IBC_TRANSFER)

    expect(estimateCosmosGasLimit).not.toHaveBeenCalled()
    expect(result.gasLimit).toBe(400_000n)
  })

  it('leaves gas_limit unset for a generic contract tx', async () => {
    const result = await resolve(buildPayload(), TransactionType.GENERIC_CONTRACT)

    expect(estimateCosmosGasLimit).not.toHaveBeenCalled()
    expect(result.gasLimit).toBeUndefined()
  })

  it('leaves gas_limit unset when a dapp relays signData', async () => {
    const result = await resolve(
      buildPayload({
        signData: { case: 'signAmino', value: create(SignAminoSchema, {}) },
      })
    )

    expect(estimateCosmosGasLimit).not.toHaveBeenCalled()
    expect(result.gasLimit).toBeUndefined()
  })

  it('leaves gas_limit unset for a zero-amount send', async () => {
    const result = await resolve(buildPayload({ toAmount: '0' }))

    expect(estimateCosmosGasLimit).not.toHaveBeenCalled()
    expect(result.gasLimit).toBeUndefined()
  })

  it('leaves gas_limit unset when there is no recipient', async () => {
    const result = await resolve(buildPayload({ toAddress: '' }))

    expect(estimateCosmosGasLimit).not.toHaveBeenCalled()
    expect(result.gasLimit).toBeUndefined()
  })

  it('keeps gas_limit unset when the estimator fails closed (returns undefined)', async () => {
    vi.mocked(estimateCosmosGasLimit).mockResolvedValue(undefined)

    const result = await resolve(buildPayload())

    expect(estimateCosmosGasLimit).toHaveBeenCalledOnce()
    expect(result.gasLimit).toBeUndefined()
  })
})

/**
 * The initiator is the ONLY place the fee amount may be priced against a gas
 * limit. Co-signers write `CosmosSpecific.gas` into the SignDoc verbatim, so a
 * value that is wrong here is wrong everywhere — but a value that is merely
 * *different* from a peer's re-derivation breaks the keysign outright.
 *
 * Cosmos static gas limit is 200_000; the mocked static fee amount is 7500.
 */
describe('getCosmosChainSpecific — fee amount priced at the relayed gas limit', () => {
  beforeEach(() => {
    vi.mocked(estimateCosmosGasLimit).mockReset().mockResolvedValue(RELAYED)
  })

  it('leaves the fee amount untouched when the simulated limit is below the static limit', async () => {
    // RELAYED (130_000) < 200_000. Static amounts are acceptance floors, not
    // per-gas rates — shrinking them would risk "insufficient fee".
    const result = await resolve(buildPayload())

    expect(result.gasLimit).toBe(130_000n)
    expect(result.gas).toBe(7500n)
  })

  it('scales the fee amount up when the simulated limit exceeds the static limit', async () => {
    vi.mocked(estimateCosmosGasLimit).mockResolvedValue(300_001n)

    const result = await resolve(buildPayload())

    // ceil(7500 × 300_001 / 200_000) = 11_251
    expect(result.gasLimit).toBe(300_001n)
    expect(result.gas).toBe(11_251n)
  })

  it('prices the fee for the widened IBC limit it relays', async () => {
    const result = await resolve(buildPayload(), TransactionType.IBC_TRANSFER)

    expect(result.gasLimit).toBe(400_000n)
    expect(result.gas).toBe(15_000n)
  })

  it('produces a TerraClassic payload iOS and Android sign identically', async () => {
    // The reported send: 300 LUNC, simulated limit 321_979 (> the static
    // 300_000). `gas` must already carry the widened gas fee PLUS the burn tax,
    // because every other client signs field 3 verbatim.
    const { getCosmosFeeAmount } = await import('@vultisig/core-chain/chains/cosmos/gas')
    vi.mocked(getCosmosFeeAmount).mockResolvedValueOnce(8_497_500n) // 300_000 × 28.325
    vi.mocked(estimateCosmosGasLimit).mockResolvedValue(321_979n)

    const payload = buildPayload({ toAmount: '300000000' }) // 300 LUNC
    payload.coin!.chain = Chain.TerraClassic
    payload.coin!.ticker = 'LUNC'

    const result = await resolve(payload)

    // gas  = ceil(8_497_500 × 321_979 / 300_000) = 9_120_056  (= 321_979 × 28.325)
    // tax  = ceil(300_000_000 × 0.005)           = 1_500_000
    // total                                      = 10_620_056 (10.620056 LUNC)
    expect(result.gasLimit).toBe(321_979n)
    expect(result.gas).toBe(10_620_056n)
  })

  it('adds no burn tax for a non-TerraClassic chain', async () => {
    const result = await resolve(buildPayload())

    expect(result.gas).toBe(7500n)
  })

  it('scales the gas fee but NOT the burn tax — the tax tracks the amount, not the limit', async () => {
    const { getCosmosFeeAmount } = await import('@vultisig/core-chain/chains/cosmos/gas')
    vi.mocked(getCosmosFeeAmount).mockResolvedValueOnce(8_497_500n)
    // Double the static limit: the gas half doubles, the tax half must not.
    vi.mocked(estimateCosmosGasLimit).mockResolvedValue(600_000n)

    const payload = buildPayload({ toAmount: '300000000' })
    payload.coin!.chain = Chain.TerraClassic
    payload.coin!.ticker = 'LUNC'

    const result = await resolve(payload)

    // 8_497_500 × 2 = 16_995_000, + an unscaled 1_500_000 tax
    expect(result.gas).toBe(18_495_000n)
  })

  it('covers a large send that the old flat 20 LUNC fee would have underpaid', async () => {
    const { getCosmosFeeAmount } = await import('@vultisig/core-chain/chains/cosmos/gas')
    vi.mocked(getCosmosFeeAmount).mockResolvedValueOnce(8_497_500n)
    vi.mocked(estimateCosmosGasLimit).mockResolvedValue(undefined)

    const payload = buildPayload({ toAmount: '10000000000' }) // 10_000 LUNC
    payload.coin!.chain = Chain.TerraClassic
    payload.coin!.ticker = 'LUNC'

    const result = await resolve(payload)

    // 8_497_500 gas + ceil(10_000_000_000 × 0.005) = 50_000_000 tax = 58_497_500.
    // The old constant paid a flat 20_000_000 here — well short of the tax alone.
    expect(result.gas).toBe(58_497_500n)
    expect(result.gas).toBeGreaterThan(20_000_000n)
  })
})
