import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { SwapQuote } from '@vultisig/core-chain/swap/quote/SwapQuote'
import { getBlockchainSpecificValue } from '@vultisig/core-mpc/keysign/chainSpecific/KeysignChainSpecific'
import { EthereumSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { describe, expect, it, vi } from 'vitest'

// AGG-02 (round-2 spec-level fund-safety audit): the aggregator-returned tx.to used to be
// trusted with NO allowlist, and it fed TWO INDEPENDENT downstream consumers — the ERC-20
// approval spender (this file, buildSwapKeysignPayload's allowance check) AND the actual
// swap transaction's on-chain destination (swapPayload.value.quote.tx.to, read by
// packages/core/mpc/keysign/signingInputs/resolvers/evm/index.ts:65's WalletCore
// SigningInput). Fixing only one would have left the other unguarded — that's why the real
// fix (getOneInchSwapQuote.ts / kyber tx.ts / getLifiSwapQuote.ts / getSwapKitQuote.ts) is at
// QUOTE CONSTRUCTION, so a GeneralSwapQuote literally cannot exist with a bad tx.to for an
// enforced provider (1inch/Kyber). This test proves BOTH downstream fields agree once that's
// true — i.e. that build.ts has no THIRD, independent path that could diverge from the
// validated address.
const ONE_INCH_V6_ROUTER = '0x111111125421ca6dc452d289314280a0f8842a65'

const mocks = vi.hoisted(() => ({
  getChainSpecific: vi.fn(async () => ({
    case: 'ethereumSpecific' as const,
    value: create(EthereumSpecificSchema, {
      maxFeePerGasWei: '1000000000',
      priorityFee: '100000000',
      nonce: 0n,
      gasLimit: '210000',
    }),
  })),
  getKeysignUtxoInfo: vi.fn(async () => []),
  getErc20Allowance: vi.fn(async () => 0n), // force the approve-payload branch (allowance < chainAmount)
}))

vi.mock('@vultisig/core-mpc/keysign/chainSpecific', () => ({
  getChainSpecific: mocks.getChainSpecific,
}))
vi.mock('@vultisig/core-mpc/keysign/utxo/getKeysignUtxoInfo', () => ({
  getKeysignUtxoInfo: mocks.getKeysignUtxoInfo,
}))
vi.mock('@vultisig/core-chain/chains/evm/erc20/getErc20Allowance', () => ({
  getErc20Allowance: mocks.getErc20Allowance,
}))

import { buildSwapKeysignPayload } from './build'

const publicKey = { data: () => new Uint8Array([1, 2, 3]) } as never

describe('buildSwapKeysignPayload — AGG-02: both downstream router consumers agree', () => {
  it('the ERC-20 approval spender AND the swap tx destination (read by the evm signingInputs resolver) both carry the SAME validated router address', async () => {
    // This quote shape is exactly what getOneInchSwapQuote returns AFTER its AGG-02
    // allowlist check passes — production code can never construct this object with
    // an unrecognized tx.to for provider '1inch' (see getOneInchSwapQuote.test.ts).
    const swapQuote: SwapQuote = {
      quote: {
        general: {
          provider: '1inch',
          dstAmount: '1000000',
          tx: { evm: { from: '0xsender', to: ONE_INCH_V6_ROUTER, data: '0xabc', value: '0' } },
        },
      },
      discounts: [],
    } as never

    const payload = await buildSwapKeysignPayload({
      fromCoin: { chain: Chain.Ethereum, address: '0xsender', id: '0xusdc', ticker: 'USDC', decimals: 6 },
      toCoin: { chain: Chain.Ethereum, address: '0xdest', id: '0xdai', ticker: 'DAI', decimals: 18 },
      amount: 1,
      swapQuote,
      vaultId: 'vault-id',
      localPartyId: 'local-party',
      fromPublicKey: publicKey,
      toPublicKey: publicKey,
      libType: 'DKLS' as const,
      walletCore: {} as never,
    })

    // Consumer 1: the ERC-20 approval spender (build.ts's allowance check reads
    // keysignPayload.toAddress as the spender when allowance is insufficient).
    expect(payload.toAddress).toBe(ONE_INCH_V6_ROUTER)
    expect(payload.erc20ApprovePayload?.spender).toBe(ONE_INCH_V6_ROUTER)

    // Consumer 2: the actual swap transaction's destination — this is the SEPARATE,
    // independent field signingInputs/resolvers/evm/index.ts:65 reads
    // (`quote?.tx?.to`) to build the real WalletCore SigningInput.toAddress for the
    // on-chain swap. It must match consumer 1 exactly, or the two-path gap AGG-02
    // found is still open.
    expect(payload.swapPayload?.case).toBe('oneinchSwapPayload')
    expect(payload.swapPayload?.case === 'oneinchSwapPayload' && payload.swapPayload.value.quote?.tx?.to).toBe(
      ONE_INCH_V6_ROUTER
    )

    // Sanity: both consumers really did read the same underlying value (not two
    // coincidentally-equal constants) — confirm getErc20Allowance was called with
    // exactly this spender, proving the flow used through build.ts's real branch.
    expect(mocks.getErc20Allowance).toHaveBeenCalledWith(
      expect.objectContaining({ chain: Chain.Ethereum, address: '0xsender', spender: ONE_INCH_V6_ROUTER })
    )
  })
})
