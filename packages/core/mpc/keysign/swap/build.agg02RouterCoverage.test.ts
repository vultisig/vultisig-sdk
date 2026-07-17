import { create } from '@bufbuild/protobuf'
import { initWasm, type WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import { SwapQuote } from '@vultisig/core-chain/swap/quote/SwapQuote'
import { getBlockchainSpecificValue } from '@vultisig/core-mpc/keysign/chainSpecific/KeysignChainSpecific'
import { getEvmSigningInputs } from '@vultisig/core-mpc/keysign/signingInputs/resolvers/evm'
import { getKeysignSwapPayload } from '@vultisig/core-mpc/keysign/swap/getKeysignSwapPayload'
import { KeysignSwapPayload } from '@vultisig/core-mpc/keysign/swap/KeysignSwapPayload'
import { EthereumSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { matchRecordUnion } from '@vultisig/lib-utils/matchRecordUnion'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// AGG-02 (round-2 spec-level fund-safety audit): the aggregator-returned tx.to used to be
// trusted with NO allowlist, and it feeds the actual swap transaction's on-chain destination
// (swapPayload.value.quote.tx.to, read by the EVM signing-input resolver). Quote construction
// now validates that outer router. A quote may separately identify the ERC-20 transferFrom
// executor in approvalAddress, so this suite locks both valid cases: without an executor the
// allowance/approve spender falls back to the validated router; with one, approval uses the
// executor while signing still targets the validated router.
const ONE_INCH_V6_ROUTER = '0x111111125421ca6dc452d289314280a0f8842a65'
const LIFI_ROUTER = '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE'
const INNER_EXECUTOR = '0x2222222222222222222222222222222222222222'
const SENDER = '0x1234567890123456789012345678901234567890'
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

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

describe('buildSwapKeysignPayload — EVM approval spender and signed destination routing', () => {
  let walletCore: WalletCore

  beforeAll(async () => {
    walletCore = await initWasm()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('the ERC-20 approval spender AND the swap tx destination (read by the evm signingInputs resolver) both carry the SAME validated router address', async () => {
    // This quote shape is exactly what getOneInchSwapQuote returns AFTER its AGG-02
    // allowlist check passes — production code can never construct this object with
    // an unrecognized tx.to for provider '1inch' (see getOneInchSwapQuote.test.ts).
    const swapQuote: SwapQuote = {
      quote: {
        general: {
          provider: '1inch',
          dstAmount: '1000000',
          tx: {
            evm: {
              from: '0xsender',
              to: ONE_INCH_V6_ROUTER,
              data: '0xabc',
              value: '0',
            },
          },
        },
      },
      discounts: [],
    } as never

    const payload = await buildSwapKeysignPayload({
      fromCoin: {
        chain: Chain.Ethereum,
        address: SENDER,
        id: USDC,
        ticker: 'USDC',
        decimals: 6,
      },
      toCoin: {
        chain: Chain.Ethereum,
        address: '0xdest',
        id: '0xdai',
        ticker: 'DAI',
        decimals: 18,
      },
      amount: 1,
      swapQuote,
      vaultId: 'vault-id',
      localPartyId: 'local-party',
      fromPublicKey: publicKey,
      toPublicKey: publicKey,
      libType: 'DKLS' as const,
      walletCore: {} as never,
    })

    // Without approvalAddress, the ERC-20 allowance/approve spender falls back
    // to keysignPayload.toAddress.
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
      expect.objectContaining({
        chain: Chain.Ethereum,
        address: SENDER,
        spender: ONE_INCH_V6_ROUTER,
      })
    )

    // Codex review (PR #1079): don't just assert on the payload's field path — replicate
    // the EXACT resolution signingInputs/resolvers/evm/index.ts:60-66's getToAddress()
    // performs, using the SAME real helper functions it imports (getKeysignSwapPayload,
    // matchRecordUnion, shouldBePresent — none mocked here), so this proves what the
    // WalletCore SigningInput.toAddress will actually be built from, not just what this
    // test assumes the resolver reads.
    const swapPayload = shouldBePresent(getKeysignSwapPayload(payload))
    const toAddressTheEvmResolverWouldUse = matchRecordUnion<KeysignSwapPayload, string>(swapPayload, {
      // Not exercised by this test (a 1inch general quote never takes this arm) —
      // present only because matchRecordUnion requires exhaustive handling.
      native: () => {
        throw new Error('unreachable in this test — quote is a general/1inch swap')
      },
      general: ({ quote }) => shouldBePresent(quote?.tx?.to),
    })
    expect(toAddressTheEvmResolverWouldUse).toBe(ONE_INCH_V6_ROUTER)
  })

  it('uses approvalAddress for an unenforced-provider allowance/approve while retaining the router as the signed swap destination', async () => {
    const swapQuote: SwapQuote = {
      quote: {
        general: {
          provider: 'li.fi',
          dstAmount: '1000000',
          tx: {
            evm: {
              from: SENDER,
              to: LIFI_ROUTER,
              approvalAddress: INNER_EXECUTOR,
              data: '0xabc',
              value: '0',
            },
          },
        },
      },
      discounts: [],
    } as never

    const payload = await buildSwapKeysignPayload({
      fromCoin: {
        chain: Chain.Ethereum,
        address: SENDER,
        id: USDC,
        ticker: 'USDC',
        decimals: 6,
      },
      toCoin: {
        chain: Chain.Ethereum,
        address: '0xdest',
        id: '0xdai',
        ticker: 'DAI',
        decimals: 18,
      },
      amount: 1,
      swapQuote,
      vaultId: 'vault-id',
      localPartyId: 'local-party',
      fromPublicKey: publicKey,
      toPublicKey: publicKey,
      libType: 'DKLS' as const,
      walletCore: {} as never,
    })

    expect(mocks.getErc20Allowance).toHaveBeenCalledWith(
      expect.objectContaining({
        chain: Chain.Ethereum,
        address: SENDER,
        spender: INNER_EXECUTOR,
      })
    )
    expect(payload.erc20ApprovePayload?.spender).toBe(INNER_EXECUTOR)
    expect(payload.toAddress).toBe(LIFI_ROUTER)

    const swapPayload = shouldBePresent(getKeysignSwapPayload(payload))
    const toAddressTheEvmResolverWouldUse = matchRecordUnion<KeysignSwapPayload, string>(swapPayload, {
      native: () => {
        throw new Error('unreachable in this test — quote is a general/li.fi swap')
      },
      general: ({ quote }) => shouldBePresent(quote?.tx?.to),
    })
    expect(toAddressTheEvmResolverWouldUse).toBe(LIFI_ROUTER)

    // Exercise the real signing resolver, including its approval-spender guard. Providers such as
    // li.fi legitimately distinguish the allowance executor from the swap transaction destination,
    // so the payload must produce both the approve and swap signing inputs without weakening the
    // stricter spender===router binding for enforced providers such as 1inch and Kyber.
    const signingInputs = await getEvmSigningInputs({
      keysignPayload: payload,
      walletCore,
    })
    expect(signingInputs).toHaveLength(2)
    expect(signingInputs[0]?.toAddress).toBe(USDC)
    expect(signingInputs[0]?.transaction?.erc20Approve?.spender).toBe(INNER_EXECUTOR)
    expect(signingInputs[1]?.toAddress).toBe(LIFI_ROUTER)
  })
})
