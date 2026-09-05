/**
 * A SwapKit TON deposit, followed from the `/v3/swap` response to the bytes
 * WalletCore signs. The response is allowed to spell the deposit account in
 * any form and the fields are checked for agreement by account, so the
 * spelling that wins precedence must not decide the bounce flag: the signer
 * reads the flag off the address it is given, and a non-bounceable deposit a
 * contract rejects is absorbed rather than refunded.
 */
import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { configureSwapKit } from '@vultisig/core-chain/swap/general/swapkit/config'
import { getSwapKitQuote } from '@vultisig/core-chain/swap/general/swapkit/api/getSwapKitQuote'
import { getSwapDestinationAddress } from '@vultisig/core-chain/swap/keysign/getSwapDestinationAddress'
import { KeysignPayload, KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getTonChainSpecific } from '../chainSpecific/resolvers/ton'
import { getTonSigningInputs } from '../signingInputs/resolvers/ton'

vi.mock('@vultisig/core-chain/security/blockaid/address', () => ({ scanAddressWithBlockaid: vi.fn() }))
vi.mock('@vultisig/core-chain/chains/ton/account/getTonAccountInfo', () => ({
  getTonAccountInfo: vi.fn(async () => ({ account_state: { wallet_id: 'w', seqno: 4 } })),
}))
vi.mock('@vultisig/core-chain/chains/ton/api', () => ({
  getJettonWalletAddress: vi.fn(),
  getTonWalletState: vi.fn(async () => 'active'),
}))
vi.mock('@vultisig/core-chain/coin/balance', () => ({ getCoinBalance: vi.fn(async () => 0n) }))
vi.mock('../fee/resolvers/ton', () => ({ getTonFeeAmount: () => 0n }))

const DEPOSIT_BOUNCEABLE = 'EQCIcjES4cQET0z6nRixZ0MdvTB4u3_8triztLSrIIrDkpgJ'
const DEPOSIT_NON_BOUNCEABLE = 'UQCIcjES4cQET0z6nRixZ0MdvTB4u3_8triztLSrIIrDksXM'
const SENDER = 'UQCc9iCgP_b5RMJcFE5XD8zStfjtNHLhDWfUqC5m1SjSer95'

const fromCoin = {
  chain: Chain.Ton,
  address: SENDER,
  ticker: 'TON',
  decimals: 9,
} as const

const response = (body: unknown) => {
  const serialized = JSON.stringify(body)
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => serialized,
    json: async () => body,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SwapKit TON deposit — bounce flag through the final signing input', () => {
  it('signs bounceable when the route spelled the winning field non-bounceable and only tx[] bounceable', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          response({ routes: [{ routeId: 'ton-route', providers: ['NEAR'], expectedBuyAmount: '0.01' }] })
        )
        .mockResolvedValueOnce(
          response({
            expectedBuyAmount: '0.009',
            providers: ['NEAR'],
            targetAddress: DEPOSIT_NON_BOUNCEABLE,
            tx: [{ address: DEPOSIT_BOUNCEABLE, amount: '0.001' }],
          })
        )
    )
    configureSwapKit({ apiKey: undefined })

    const general = await getSwapKitQuote({
      from: fromCoin,
      to: { chain: Chain.Ethereum, address: '0xdestination', ticker: 'ETH', decimals: 18 },
      amount: 1_000_000n,
    })

    const toAddress = getSwapDestinationAddress({ quote: { quote: { general }, discounts: [] }, fromCoin })
    expect(toAddress).toBe(DEPOSIT_BOUNCEABLE)

    const keysignPayload: KeysignPayload = create(KeysignPayloadSchema, {
      coin: {
        chain: Chain.Ton,
        ticker: 'TON',
        address: SENDER,
        decimals: 9,
        isNativeToken: true,
        hexPublicKey: '6c756400bac0b153b421df6e199302537d12f7d4a53447004485700a958e7571',
      },
      toAddress,
      toAmount: '1000000',
      memo: '',
    })

    const tonSpecific = await getTonChainSpecific({ keysignPayload, walletCore: {} as never })
    expect(tonSpecific.bounceable).toBe(true)

    keysignPayload.blockchainSpecific = { case: 'tonSpecific', value: tonSpecific }
    const [input] = await getTonSigningInputs({ keysignPayload, walletCore: {} as never })
    const [message] = input.messages

    expect(shouldBePresent(message, 'TON transfer').dest).toBe(DEPOSIT_BOUNCEABLE)
    expect(message.bounceable).toBe(true)
  })
})
