import { create } from '@bufbuild/protobuf'
import { initWasm, type WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import {
  OneInchQuoteSchema,
  OneInchSwapPayloadSchema,
  OneInchTransactionSchema,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/1inch_swap_payload_pb'
import { EthereumSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import { Erc20ApprovePayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/erc20_approve_payload_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { beforeAll, describe, expect, it } from 'vitest'

import { getEvmSigningInputs } from './index'

// sdk#1358 fund-safety: assertKnownAggregatorRouterOnSigningPath re-asserts the 1inch/kyber
// router allow-list on the CO-SIGNER signing-input path (not just at quote construction), since
// every co-signer independently rebuilds the SigningInput from the shared KeysignPayload. This
// test proves the guard is actually wired into getEvmSigningInputs's general-swap arm: a
// KeysignPayload whose swapPayload.quote.tx.to was never quote-time-validated must be rejected
// here, and a KeysignPayload carrying the real router must still sign cleanly (no over-blocking).
const ONE_INCH_V6_ROUTER = '0x111111125421ca6dc452d289314280a0f8842a65'
const ATTACKER_ROUTER = '0x000000000000000000000000000000000000dEaD'
const SENDER = '0x1234567890123456789012345678901234567890'
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

const buildPayload = (routerTo: string) =>
  create(KeysignPayloadSchema, {
    coin: create(CoinSchema, {
      chain: Chain.Ethereum,
      ticker: 'USDC',
      address: SENDER,
      decimals: 6,
      contractAddress: USDC,
      isNativeToken: false,
    }),
    blockchainSpecific: {
      case: 'ethereumSpecific',
      value: create(EthereumSpecificSchema, {
        maxFeePerGasWei: '1000000000',
        priorityFee: '100000000',
        nonce: 0n,
        gasLimit: '210000',
      }),
    },
    swapPayload: {
      case: 'oneinchSwapPayload',
      value: create(OneInchSwapPayloadSchema, {
        provider: '1inch',
        quote: create(OneInchQuoteSchema, {
          tx: create(OneInchTransactionSchema, {
            to: routerTo,
            data: '0xabcdef',
            value: '0',
            gasPrice: '0',
            gas: 0n,
          }),
        }),
      }),
    },
  })

describe('getEvmSigningInputs — sdk#1358 aggregator router guard on the signing-input path', () => {
  let walletCore: WalletCore

  beforeAll(async () => {
    walletCore = await initWasm()
  })

  it('throws when a 1inch general-swap KeysignPayload carries an unrecognized router as quote.tx.to', async () => {
    await expect(
      getEvmSigningInputs({
        keysignPayload: buildPayload(ATTACKER_ROUTER),
        walletCore,
      })
    ).rejects.toThrow(/unrecognized router/i)
  })

  it('does not over-block a 1inch general-swap KeysignPayload carrying the real router as quote.tx.to', async () => {
    const inputs = await getEvmSigningInputs({
      keysignPayload: buildPayload(ONE_INCH_V6_ROUTER),
      walletCore,
    })

    expect(inputs[0]?.toAddress).toBe(ONE_INCH_V6_ROUTER)
  })
})

// sdk#1358 review follow-up (neavra): the router guard covers quote.tx.to, but the ERC-20 approval
// spender is an INDEPENDENT wire field (erc20ApprovePayload.spender) the approve resolver reads
// verbatim. A payload can pass the router check with a genuine router yet still approve an attacker -
// a classic approval-drain the co-signer would sign blind. Bind spender === router for enforced providers.
const buildApprovePayload = ({ routerTo, spender }: { routerTo: string; spender: string }) => {
  const payload = buildPayload(routerTo)
  payload.erc20ApprovePayload = create(Erc20ApprovePayloadSchema, { amount: '1000000', spender })
  return payload
}

describe('getEvmSigningInputs — sdk#1358 approval-spender bind on the signing-input path', () => {
  let walletCore: WalletCore

  beforeAll(async () => {
    walletCore = await initWasm()
  })

  it('throws when a 1inch swap carries a valid router but the approve spender is an attacker address', async () => {
    await expect(
      getEvmSigningInputs({
        keysignPayload: buildApprovePayload({ routerTo: ONE_INCH_V6_ROUTER, spender: ATTACKER_ROUTER }),
        walletCore,
      })
    ).rejects.toThrow(/approval spender .* does not match the verified swap router/i)
  })

  it('signs cleanly when the approve spender matches the verified router (approve + swap legs)', async () => {
    const inputs = await getEvmSigningInputs({
      keysignPayload: buildApprovePayload({ routerTo: ONE_INCH_V6_ROUTER, spender: ONE_INCH_V6_ROUTER }),
      walletCore,
    })

    // [0] = ERC-20 approve leg, [1] = the swap leg targeting the router.
    expect(inputs).toHaveLength(2)
    expect(inputs[1]?.toAddress).toBe(ONE_INCH_V6_ROUTER)
  })
})
