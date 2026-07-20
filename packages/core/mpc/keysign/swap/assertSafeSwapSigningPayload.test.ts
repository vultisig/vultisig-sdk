import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import {
  OneInchQuoteSchema,
  OneInchSwapPayloadSchema,
  OneInchTransactionSchema,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/1inch_swap_payload_pb'
import { Erc20ApprovePayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/erc20_approve_payload_pb'
import {
  KeysignPayload,
  KeysignPayloadSchema,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { THORChainSwapPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/thorchain_swap_payload_pb'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  assertSafeSolanaSwapTransactionBase64: vi.fn(async () => {}),
}))

// The Solana instruction guard decodes real tx bytes and resolves address lookup
// tables over the network — mock it so this suite stays a pure unit test and only
// asserts that the SIGNING path actually invokes it (parity with quote-time).
vi.mock('@vultisig/core-chain/chains/solana/assertSafeSolanaSwapInstructions', () => ({
  assertSafeSolanaSwapTransactionBase64: mocks.assertSafeSolanaSwapTransactionBase64,
}))

import { assertSafeSwapSigningPayload } from './assertSafeSwapSigningPayload'

const ONE_INCH_V6_ROUTER = '0x111111125421ca6dc452d289314280a0f8842a65'
const KYBER_ROUTER = '0x6131b5fae19ea4f9d964eac0408e4408b66337b5'
const ATTACKER = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'

const evmSwapPayload = ({
  provider,
  to,
  spender,
}: {
  provider: string
  to: string
  spender?: string
}): KeysignPayload =>
  create(KeysignPayloadSchema, {
    coin: create(CoinSchema, { chain: Chain.Ethereum, address: '0xsender' }),
    swapPayload: {
      case: 'oneinchSwapPayload',
      value: create(OneInchSwapPayloadSchema, {
        provider,
        quote: create(OneInchQuoteSchema, {
          tx: create(OneInchTransactionSchema, { to, data: '0xabc', value: '0' }),
        }),
      }),
    },
    ...(spender
      ? { erc20ApprovePayload: create(Erc20ApprovePayloadSchema, { spender, amount: '1000000' }) }
      : {}),
  })

const solanaSwapPayload = (data: string, provider = 'jupiter'): KeysignPayload =>
  create(KeysignPayloadSchema, {
    coin: create(CoinSchema, { chain: Chain.Solana, address: '11111111111111111111111111111111' }),
    swapPayload: {
      case: 'oneinchSwapPayload',
      value: create(OneInchSwapPayloadSchema, {
        provider,
        quote: create(OneInchQuoteSchema, {
          tx: create(OneInchTransactionSchema, { to: '', data, value: '' }),
        }),
      }),
    },
  })

describe('assertSafeSwapSigningPayload — signing-time swap guard (co-signer choke point)', () => {
  afterEach(() => vi.clearAllMocks())

  it('accepts a 1inch swap whose router is the known aggregator router', async () => {
    await expect(
      assertSafeSwapSigningPayload(evmSwapPayload({ provider: '1inch', to: ONE_INCH_V6_ROUTER }))
    ).resolves.toBeUndefined()
  })

  it('accepts a kyber swap whose router is the known aggregator router', async () => {
    await expect(
      assertSafeSwapSigningPayload(evmSwapPayload({ provider: 'kyber', to: KYBER_ROUTER }))
    ).resolves.toBeUndefined()
  })

  // The core fund-safety win: a hand-built payload whose tx.to never passed the
  // quote-time allowlist is now rejected at the point the co-signer signs it.
  it('REJECTS a 1inch swap pointing at an unrecognized router (blind-sign gap)', async () => {
    await expect(
      assertSafeSwapSigningPayload(evmSwapPayload({ provider: '1inch', to: ATTACKER }))
    ).rejects.toThrow(/unrecognized router/i)
  })

  it('REJECTS a kyber swap pointing at an unrecognized router', async () => {
    await expect(
      assertSafeSwapSigningPayload(evmSwapPayload({ provider: 'kyber', to: ATTACKER }))
    ).rejects.toThrow(/unrecognized router/i)
  })

  // Approval-drain vector: benign swap tx.to but the (separate) approval spender
  // field points at an attacker.
  it('REJECTS an enforced swap whose ERC-20 approval spender is not the verified router', async () => {
    await expect(
      assertSafeSwapSigningPayload(evmSwapPayload({ provider: '1inch', to: ONE_INCH_V6_ROUTER, spender: ATTACKER }))
    ).rejects.toThrow(/approval spender/i)
  })

  it('accepts an enforced swap whose approval spender equals the verified router', async () => {
    await expect(
      assertSafeSwapSigningPayload(
        evmSwapPayload({ provider: '1inch', to: ONE_INCH_V6_ROUTER, spender: ONE_INCH_V6_ROUTER })
      )
    ).resolves.toBeUndefined()
  })

  // Parity with quote-time: LiFi/SwapKit route through many contracts and are
  // unenforceable by design (log-only, never thrown) at both quote and sign time.
  it('does not throw for unenforceable providers (li.fi)', async () => {
    await expect(
      assertSafeSwapSigningPayload(evmSwapPayload({ provider: 'li.fi', to: ATTACKER }))
    ).resolves.toBeUndefined()
  })

  it('is a no-op for a non-swap payload', async () => {
    const payload = create(KeysignPayloadSchema, {
      coin: create(CoinSchema, { chain: Chain.Ethereum, address: '0xsender' }),
    })
    await expect(assertSafeSwapSigningPayload(payload)).resolves.toBeUndefined()
    expect(mocks.assertSafeSolanaSwapTransactionBase64).not.toHaveBeenCalled()
  })

  it('is a no-op for native (THORChain) swaps — those are validated elsewhere', async () => {
    const payload = create(KeysignPayloadSchema, {
      coin: create(CoinSchema, { chain: Chain.Ethereum, address: '0xsender' }),
      swapPayload: {
        case: 'thorchainSwapPayload',
        value: create(THORChainSwapPayloadSchema, { vaultAddress: '0xvault', routerAddress: ONE_INCH_V6_ROUTER }),
      },
    })
    await expect(assertSafeSwapSigningPayload(payload)).resolves.toBeUndefined()
  })

  it('runs the Jupiter instruction guard for a Solana swap, with the tx bytes and user address', async () => {
    await assertSafeSwapSigningPayload(solanaSwapPayload('c29tZS1iYXNlNjQtdHg='))
    expect(mocks.assertSafeSolanaSwapTransactionBase64).toHaveBeenCalledTimes(1)
    const [txData, userWallet] = mocks.assertSafeSolanaSwapTransactionBase64.mock.calls[0] as unknown as [
      string,
      { toBase58(): string },
    ]
    expect(txData).toBe('c29tZS1iYXNlNjQtdHg=')
    expect(userWallet.toBase58()).toBe('11111111111111111111111111111111')
  })

  it('propagates a Jupiter guard rejection (spliced-instruction drain)', async () => {
    mocks.assertSafeSolanaSwapTransactionBase64.mockRejectedValueOnce(new Error('SOL_SWAP_UNEXPECTED_PROGRAM'))
    await expect(assertSafeSwapSigningPayload(solanaSwapPayload('YmFk'))).rejects.toThrow(/SOL_SWAP_UNEXPECTED_PROGRAM/)
  })

  // The Jupiter instruction allow-list rejects any non-Jupiter program, so it
  // must NOT run on a LiFi (or other) Solana swap — those route through
  // different programs by design and would be false-rejected.
  it('does not run the Jupiter guard for a non-Jupiter Solana swap (li.fi)', async () => {
    await expect(assertSafeSwapSigningPayload(solanaSwapPayload('c29tZQ==', 'li.fi'))).resolves.toBeUndefined()
    expect(mocks.assertSafeSolanaSwapTransactionBase64).not.toHaveBeenCalled()
  })
})
