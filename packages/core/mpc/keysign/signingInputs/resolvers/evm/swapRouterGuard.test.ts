import { create } from '@bufbuild/protobuf'
import { initWasm, type WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import { scanAddressWithBlockaid } from '@vultisig/core-chain/security/blockaid/address'
import {
  OneInchQuoteSchema,
  OneInchSwapPayloadSchema,
  OneInchTransactionSchema,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/1inch_swap_payload_pb'
import { EthereumSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import { Erc20ApprovePayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/erc20_approve_payload_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { getEvmSigningInputs } from './index'

vi.mock('@vultisig/core-chain/security/blockaid/address', () => ({ scanAddressWithBlockaid: vi.fn() }))

const mockScanAddressWithBlockaid = vi.mocked(scanAddressWithBlockaid)

beforeEach(() => {
  mockScanAddressWithBlockaid.mockReset()
  mockScanAddressWithBlockaid.mockResolvedValue({ resultType: 'Benign', features: ['trusted'] })
})

// sdk#1358 fund-safety: assertKnownAggregatorRouterOnSigningPath re-asserts the 1inch/kyber
// router allow-list on the CO-SIGNER signing-input path (not just at quote construction), since
// every co-signer independently rebuilds the SigningInput from the shared KeysignPayload. This
// test proves the guard is actually wired into getEvmSigningInputs's general-swap arm: a
// KeysignPayload whose swapPayload.quote.tx.to was never quote-time-validated must be rejected
// here, and a KeysignPayload carrying the real router must still sign cleanly (no over-blocking).
const ONE_INCH_V6_ROUTER = '0x111111125421ca6dc452d289314280a0f8842a65'
const LIFI_DIAMOND = '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE'
const LIFI_INNER_EXECUTOR = '0x7f51c134000000000000000000000000000c7e11'
const ATTACKER_ROUTER = '0x000000000000000000000000000000000000dEaD'
const COW_VAULT_RELAYER = '0xC92E8bdf79f0507f65a392b0ab4667716BFE0110'
const SENDER = '0x1234567890123456789012345678901234567890'
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

const buildPayload = (routerTo: string, provider = '1inch') =>
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
        provider,
        fromAmount: '1000000',
        quote: create(OneInchQuoteSchema, {
          tx: create(OneInchTransactionSchema, { to: routerTo, data: '0xabcdef', value: '0', gasPrice: '0', gas: 0n }),
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
    await expect(getEvmSigningInputs({ keysignPayload: buildPayload(ATTACKER_ROUTER), walletCore })).rejects.toThrow(
      /unrecognized router/i
    )
  })

  it('does not over-block a 1inch general-swap KeysignPayload carrying the real router as quote.tx.to', async () => {
    const inputs = await getEvmSigningInputs({ keysignPayload: buildPayload(ONE_INCH_V6_ROUTER), walletCore })

    expect(inputs[0]?.toAddress).toBe(ONE_INCH_V6_ROUTER)
  })
})

// sdk#1457: the router guard previously keyed enforcement on the untrusted `provider` string alone
// - a payload could relabel itself to skip the check entirely. These end-to-end cases prove the fix
// through the real co-signer resolver, not just the guard function in isolation.
describe('getEvmSigningInputs — sdk#1457 provider-string spoofing guard, end to end', () => {
  let walletCore: WalletCore

  beforeAll(async () => {
    walletCore = await initWasm()
  })

  it('does not over-block a legit CowSwap payload whose provider label matches the fixed relayer destination', async () => {
    const inputs = await getEvmSigningInputs({ keysignPayload: buildPayload(COW_VAULT_RELAYER, 'cowswap'), walletCore })

    expect(inputs[0]?.toAddress).toBe(COW_VAULT_RELAYER)
  })

  it('throws when a payload labeled cowswap carries a destination that is not the real relayer (relabel-vs-shape mismatch)', async () => {
    await expect(
      getEvmSigningInputs({ keysignPayload: buildPayload(ATTACKER_ROUTER, 'cowswap'), walletCore })
    ).rejects.toThrow(/unrecognized router/i)
  })

  it('throws when a payload is relabelled to an unrecognized provider string (the previously-open bypass)', async () => {
    await expect(
      getEvmSigningInputs({ keysignPayload: buildPayload(ATTACKER_ROUTER, 'totally-not-a-real-provider'), walletCore })
    ).rejects.toThrow(/Unrecognized swap provider/)
  })

  it('throws when a li.fi payload carries a destination outside the official chain-scoped Diamond allowlist', async () => {
    await expect(
      getEvmSigningInputs({ keysignPayload: buildPayload(ATTACKER_ROUTER, 'li.fi'), walletCore })
    ).rejects.toThrow(/unrecognized router/i)
  })

  it('accepts a li.fi payload carrying the official Diamond for its source chain', async () => {
    const inputs = await getEvmSigningInputs({ keysignPayload: buildPayload(LIFI_DIAMOND, 'li.fi'), walletCore })

    expect(inputs[0]?.toAddress).toBe(LIFI_DIAMOND)
  })

  it('accepts a swapkit payload only after an independent benign destination verdict', async () => {
    const inputs = await getEvmSigningInputs({
      keysignPayload: buildPayload(ONE_INCH_V6_ROUTER, 'swapkit'),
      walletCore,
    })

    expect(inputs[0]?.toAddress).toBe(ONE_INCH_V6_ROUTER)
    expect(mockScanAddressWithBlockaid).toHaveBeenCalledWith(ONE_INCH_V6_ROUTER, 'ethereum')
  })

  it('rejects a swapkit co-signer payload when Blockaid does not return Benign', async () => {
    mockScanAddressWithBlockaid.mockResolvedValueOnce({ resultType: 'Malicious', features: ['drainer'] })

    await expect(
      getEvmSigningInputs({ keysignPayload: buildPayload(ATTACKER_ROUTER, 'swapkit'), walletCore })
    ).rejects.toThrow(/Malicious Blockaid verdict/)
  })

  // This is the most consequential instance of "fail closed on Blockaid" in the repo: unlike
  // the quote path (which fails in front of the user with a retry available), this runs per
  // device, mid-ceremony, on a payload every co-signer has already agreed to sign. A scan we
  // could not obtain must be treated the same as an untrusted destination, not silently
  // skipped — an unavailable reputation service is not evidence the address is safe.
  it('fails closed on the co-signer signing path when the Blockaid call itself throws (not just a non-Benign verdict)', async () => {
    mockScanAddressWithBlockaid.mockRejectedValueOnce(new Error('blockaid unreachable'))

    await expect(
      getEvmSigningInputs({ keysignPayload: buildPayload(ONE_INCH_V6_ROUTER, 'swapkit'), walletCore })
    ).rejects.toThrow(/reputation check failed/)
  })
})

// A SwapKit ERC-20 deposit is addressed to the sold token, so screening tx.to screens only the
// token. The co-signer must bind the calldata itself: exactly transfer(recipient, fromAmount) on
// the sold token, with the decoded recipient screened.
describe('getEvmSigningInputs — SwapKit ERC-20 deposit binding on the signing-input path', () => {
  const DEPOSIT = '0x1f01af4e50082e2982ba5041707efddd3aa4c121'
  const ATTACKER = '0x2222222222222222222222222222222222222222'
  const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7'
  const AMOUNT = 20_000_000n
  const word = (hex: string) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0')
  const transferData = (to: string, amount: bigint) => `0xa9059cbb${word(to)}${word(amount.toString(16))}`

  const buildDepositPayload = ({ to = USDC, data }: { to?: string; data: string }) => {
    const payload = buildPayload(to, 'swapkit')
    payload.swapPayload = {
      case: 'oneinchSwapPayload',
      value: create(OneInchSwapPayloadSchema, {
        provider: 'swapkit',
        fromCoin: payload.coin,
        fromAmount: AMOUNT.toString(),
        quote: create(OneInchQuoteSchema, {
          tx: create(OneInchTransactionSchema, { to, data, value: '0', gasPrice: '0', gas: 0n }),
        }),
      }),
    }
    return payload
  }

  let walletCore: WalletCore

  beforeAll(async () => {
    walletCore = await initWasm()
  })

  it('signs a transfer of exactly fromAmount on the sold token after screening the decoded recipient', async () => {
    const data = transferData(DEPOSIT, AMOUNT)

    const inputs = await getEvmSigningInputs({ keysignPayload: buildDepositPayload({ data }), walletCore })

    expect(inputs[0]?.toAddress).toBe(USDC)
    expect(mockScanAddressWithBlockaid).toHaveBeenCalledWith(DEPOSIT, 'ethereum')
  })

  it.each([
    ['a Warning verdict', async () => ({ resultType: 'Warning' as const, features: ['new_address'] })],
    [
      'a failed scan',
      async () => {
        throw new Error('Blockaid rate limited')
      },
    ],
  ])('still signs when the deposit recipient gets %s', async (_, scanDeposit) => {
    mockScanAddressWithBlockaid.mockImplementation(async address =>
      address.toLowerCase() === DEPOSIT ? scanDeposit() : { resultType: 'Benign', features: ['trusted'] }
    )
    const data = transferData(DEPOSIT, AMOUNT)

    const inputs = await getEvmSigningInputs({ keysignPayload: buildDepositPayload({ data }), walletCore })

    expect(inputs[0]?.toAddress).toBe(USDC)
  })

  it.each([
    ['a recipient Blockaid flags Malicious', { data: transferData(ATTACKER, AMOUNT) }, /Malicious Blockaid verdict/],
    ['an amount other than fromAmount', { data: transferData(DEPOSIT, AMOUNT + 1n) }, /not the sold amount/],
    [
      'a transfer on a token other than the sold one',
      { to: USDT, data: transferData(ATTACKER, AMOUNT) },
      /not the sold token/,
    ],
    [
      'other calldata on the sold token',
      { data: `0x095ea7b3${word(ATTACKER)}${word(AMOUNT.toString(16))}` },
      /not exactly an ERC-20 transfer/,
    ],
  ])('throws for a SwapKit token transfer carrying %s', async (_, fixture, error) => {
    mockScanAddressWithBlockaid.mockImplementation(async address =>
      address.toLowerCase() === ATTACKER
        ? { resultType: 'Malicious', features: ['drainer'] }
        : { resultType: 'Benign', features: ['trusted'] }
    )

    await expect(getEvmSigningInputs({ keysignPayload: buildDepositPayload(fixture), walletCore })).rejects.toThrow(
      error
    )
  })
})

// sdk#1358 review follow-up (neavra): the router guard covers quote.tx.to, but the ERC-20 approval
// spender is an INDEPENDENT wire field (erc20ApprovePayload.spender) the approve resolver reads
// verbatim. A payload can pass the router check with a genuine router yet still approve an attacker -
// a classic approval-drain the co-signer would sign blind. Bind spender === router for enforced providers.
const buildApprovePayload = ({
  routerTo,
  spender,
  provider = '1inch',
}: {
  routerTo: string
  spender: string
  provider?: string
}) => {
  const payload = buildPayload(routerTo, provider)
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

  // sdk#1457: CowSwap is now an enforced provider, so its approve spender is bound the same way
  // 1inch/Kyber's are - both spender and quote.tx.to are always the fixed GPv2VaultRelayer.
  it('throws when a cowswap payload carries a valid relayer destination but the approve spender is an attacker address', async () => {
    await expect(
      getEvmSigningInputs({
        keysignPayload: buildApprovePayload({
          routerTo: COW_VAULT_RELAYER,
          spender: ATTACKER_ROUTER,
          provider: 'cowswap',
        }),
        walletCore,
      })
    ).rejects.toThrow(/approval spender .* does not match the verified swap router/i)
  })

  it('signs cleanly for a cowswap payload when the approve spender matches the relayer', async () => {
    const inputs = await getEvmSigningInputs({
      keysignPayload: buildApprovePayload({
        routerTo: COW_VAULT_RELAYER,
        spender: COW_VAULT_RELAYER,
        provider: 'cowswap',
      }),
      walletCore,
    })

    expect(inputs).toHaveLength(2)
    expect(inputs[1]?.toAddress).toBe(COW_VAULT_RELAYER)
  })

  it('rejects a distinct LI.FI approval spender without an independent benign verdict', async () => {
    mockScanAddressWithBlockaid.mockResolvedValueOnce({ resultType: 'Malicious', features: ['drainer'] })

    await expect(
      getEvmSigningInputs({
        keysignPayload: buildApprovePayload({
          routerTo: LIFI_DIAMOND,
          spender: LIFI_INNER_EXECUTOR,
          provider: 'li.fi',
        }),
        walletCore,
      })
    ).rejects.toThrow(/LI\.FI approval spender .*Malicious Blockaid verdict/i)
  })

  it('signs cleanly for LI.FI when a distinct route spender receives an independent benign verdict', async () => {
    const inputs = await getEvmSigningInputs({
      keysignPayload: buildApprovePayload({
        routerTo: LIFI_DIAMOND,
        spender: LIFI_INNER_EXECUTOR,
        provider: 'li.fi',
      }),
      walletCore,
    })

    expect(inputs).toHaveLength(2)
    expect(inputs[1]?.toAddress).toBe(LIFI_DIAMOND)
    expect(mockScanAddressWithBlockaid).toHaveBeenCalledWith(LIFI_INNER_EXECUTOR, 'ethereum')
  })

  it('fails closed for a distinct LI.FI spender when the reputation service is unavailable', async () => {
    mockScanAddressWithBlockaid.mockRejectedValueOnce(new Error('blockaid unreachable'))

    await expect(
      getEvmSigningInputs({
        keysignPayload: buildApprovePayload({
          routerTo: LIFI_DIAMOND,
          spender: LIFI_INNER_EXECUTOR,
          provider: 'li.fi',
        }),
        walletCore,
      })
    ).rejects.toThrow(/LI\.FI approval spender reputation check failed/i)
  })

  it('signs LI.FI Diamond approvals without a reputation network call', async () => {
    const inputs = await getEvmSigningInputs({
      keysignPayload: buildApprovePayload({
        routerTo: LIFI_DIAMOND,
        spender: LIFI_DIAMOND,
        provider: 'li.fi',
      }),
      walletCore,
    })

    expect(inputs).toHaveLength(2)
    expect(mockScanAddressWithBlockaid).not.toHaveBeenCalled()
  })

  it('rejects a swapkit approval spender without an independent benign verdict', async () => {
    mockScanAddressWithBlockaid.mockResolvedValueOnce({ resultType: 'Warning', features: ['untrusted'] })

    await expect(
      getEvmSigningInputs({
        keysignPayload: buildApprovePayload({
          routerTo: ONE_INCH_V6_ROUTER,
          spender: ATTACKER_ROUTER,
          provider: 'swapkit',
        }),
        walletCore,
      })
    ).rejects.toThrow(/approval spender .*Warning Blockaid verdict/i)
  })
})
