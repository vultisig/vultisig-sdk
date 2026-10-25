import { create } from '@bufbuild/protobuf'
import { type WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import { TronSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { type Coin, CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import {
  type KeysignPayload,
  KeysignPayloadSchema,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import {
  TronTransferAssetContractPayloadSchema,
  TronTransferContractPayloadSchema,
  TronTriggerSmartContractPayloadSchema,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/tron_contract_payload_pb'
import { describe, expect, it } from 'vitest'

import { getTronSigningInputs } from './tron'

// The Tron resolver never touches walletCore.
const walletCore = {} as unknown as WalletCore

const OWNER = 'T9yED5xMV5ARV98BexN97aLZ1UUq7eKSxm'
const OWNER_HEX = '41000102030405060708090a0b0c0d0e0f10111213'
const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
const RECIPIENT = 'TQEkcWrgS74WMjUyhaqh1w7hC23wAJuxR9'
const RECIPIENT_HEX = '419c826361267bc0a68f5237ba435ddb0a471afb6e'
const OTHER = 'TBXSw8fM4jpQkGc6zZjsVABFpVN7UvXPdV'
const BAD_CHECKSUM = 'TQEkcWrgS74WMjUyhaqh1w7hC23wAJuxR8'

const word = (hex: string) => hex.padStart(64, '0')

// The calldata of a confirmed USDT transfer (see tron.test.ts), whose
// recipient word carries the `41` prefix as TronWeb encodes it.
const usdtTransferData = `a9059cbb${word(RECIPIENT_HEX)}${word((9_610_000).toString(16))}`
const unlimitedApproveData = `095ea7b3${word('22'.repeat(20))}${'f'.repeat(64)}`

const trx = create(CoinSchema, {
  chain: Chain.Tron,
  ticker: 'TRX',
  address: OWNER,
  decimals: 6,
  isNativeToken: true,
})
const usdt = create(CoinSchema, {
  chain: Chain.Tron,
  ticker: 'USDT',
  address: OWNER,
  decimals: 6,
  isNativeToken: false,
  contractAddress: USDT,
})
const trc10 = create(CoinSchema, {
  chain: Chain.Tron,
  ticker: 'BTT',
  address: OWNER,
  decimals: 6,
  isNativeToken: false,
})

type BuildInput = {
  coin: Coin
  toAddress: string
  toAmount: string
  contractPayload: KeysignPayload['contractPayload']
}

const build = ({ coin, toAddress, toAmount, contractPayload }: BuildInput) =>
  create(KeysignPayloadSchema, {
    coin,
    toAddress,
    toAmount,
    blockchainSpecific: {
      case: 'tronSpecific',
      value: create(TronSpecificSchema, {
        timestamp: 1_700_000_000_000n,
        expiration: 1_700_003_600_000n,
        blockHeaderTimestamp: 1_699_999_940_000n,
        blockHeaderNumber: 1234n,
        blockHeaderVersion: 28n,
        blockHeaderTxTrieRoot: '00'.repeat(32),
        blockHeaderParentHash: '00'.repeat(32),
        blockHeaderWitnessAddress: '00'.repeat(20),
        gasEstimation: 100_000_000n,
      }),
    },
    contractPayload,
  })

const transfer = ({ ownerAddress = OWNER, toAddress = RECIPIENT, amount = '1000000' } = {}) => ({
  case: 'tronTransferContractPayload' as const,
  value: create(TronTransferContractPayloadSchema, { ownerAddress, toAddress, amount }),
})

const call = ({
  ownerAddress = OWNER,
  contractAddress = USDT,
  data = usdtTransferData,
  callValue,
  callTokenValue,
}: {
  ownerAddress?: string
  contractAddress?: string
  data?: string
  callValue?: string
  callTokenValue?: string
} = {}) => ({
  case: 'tronTriggerSmartContractPayload' as const,
  value: create(TronTriggerSmartContractPayloadSchema, {
    ownerAddress,
    contractAddress,
    data,
    callValue,
    callTokenValue,
  }),
})

const transferAsset = ({ toAddress = RECIPIENT, amount = '500' } = {}) => ({
  case: 'tronTransferAssetContractPayload' as const,
  value: create(TronTransferAssetContractPayloadSchema, {
    ownerAddress: OWNER,
    toAddress,
    amount,
    assetName: '1002000',
  }),
})

const sign = (payload: KeysignPayload) => getTronSigningInputs({ keysignPayload: payload, walletCore })

describe('getTronSigningInputs -- dApp contract payloads match the review', () => {
  it('signs a TRX transfer reviewed as its recipient and amount', async () => {
    const [input] = await sign(
      build({ coin: trx, toAddress: RECIPIENT, toAmount: '1000000', contractPayload: transfer() })
    )
    expect(input.transaction?.transfer?.amount?.toString()).toBe('1000000')
  })

  it('accepts an owner given as 41-prefixed hex', async () => {
    const [input] = await sign(
      build({
        coin: trx,
        toAddress: RECIPIENT,
        toAmount: '1000000',
        contractPayload: transfer({ ownerAddress: OWNER_HEX }),
      })
    )
    expect(input.transaction?.transfer?.ownerAddress).toBe(OWNER_HEX)
  })

  it('signs a TRC-20 transfer reviewed as that token, recipient and amount', async () => {
    const [input] = await sign(
      build({ coin: usdt, toAddress: RECIPIENT, toAmount: '9610000', contractPayload: call() })
    )
    expect(input.transaction?.triggerSmartContract?.contractAddress).toBe(USDT)
  })

  it('signs an approve reviewed as a 0 TRX call to the token contract', async () => {
    const [input] = await sign(
      build({ coin: trx, toAddress: USDT, toAmount: '0', contractPayload: call({ data: unlimitedApproveData }) })
    )
    expect(input.transaction?.triggerSmartContract?.callValue?.isZero()).toBe(true)
  })

  it('signs a contract call reviewed as the TRX it attaches', async () => {
    const [input] = await sign(
      build({
        coin: trx,
        toAddress: USDT,
        toAmount: '2500000',
        contractPayload: call({ data: unlimitedApproveData, callValue: '2500000' }),
      })
    )
    expect(input.transaction?.triggerSmartContract?.callValue?.toString()).toBe('2500000')
  })

  it('signs a TRC-10 transfer reviewed as a token', async () => {
    const [input] = await sign(
      build({ coin: trc10, toAddress: RECIPIENT, toAmount: '500', contractPayload: transferAsset() })
    )
    expect(input.transaction?.transferAsset?.amount?.toString()).toBe('500')
  })

  it.each<[string, BuildInput, RegExp]>([
    [
      'an approve reviewed as a TRX send',
      { coin: trx, toAddress: RECIPIENT, toAmount: '1000000', contractPayload: call({ data: unlimitedApproveData }) },
      /recipient/,
    ],
    [
      'a contract owned by another address',
      { coin: trx, toAddress: RECIPIENT, toAmount: '1000000', contractPayload: transfer({ ownerAddress: OTHER }) },
      /owner/,
    ],
    [
      'a TRX transfer to another recipient',
      { coin: trx, toAddress: OTHER, toAmount: '1000000', contractPayload: transfer() },
      /recipient/,
    ],
    [
      'a TRX transfer of another amount',
      { coin: trx, toAddress: RECIPIENT, toAmount: '1', contractPayload: transfer() },
      /amount/,
    ],
    [
      'a TRX transfer reviewed as a token',
      { coin: usdt, toAddress: RECIPIENT, toAmount: '1000000', contractPayload: transfer() },
      /TRX/,
    ],
    [
      'a TRC-20 transfer reviewed as TRX',
      { coin: trx, toAddress: RECIPIENT, toAmount: '9610000', contractPayload: call() },
      /token/,
    ],
    [
      'a TRC-20 transfer of another token',
      { coin: usdt, toAddress: RECIPIENT, toAmount: '9610000', contractPayload: call({ contractAddress: OTHER }) },
      /token/,
    ],
    [
      'a TRC-20 transfer that attaches TRX',
      { coin: usdt, toAddress: RECIPIENT, toAmount: '9610000', contractPayload: call({ callValue: '1' }) },
      /attach TRX/,
    ],
    [
      'a TRC-20 transfer to another recipient',
      { coin: usdt, toAddress: OTHER, toAmount: '9610000', contractPayload: call() },
      /recipient/,
    ],
    [
      'a TRC-20 transfer of another amount',
      { coin: usdt, toAddress: RECIPIENT, toAmount: '1', contractPayload: call() },
      /amount/,
    ],
    [
      'a contract call that attaches TRC-10 tokens',
      {
        coin: trx,
        toAddress: USDT,
        toAmount: '0',
        contractPayload: call({ data: unlimitedApproveData, callTokenValue: '1' }),
      },
      /TRC-10/,
    ],
    [
      'a contract call that attaches TRX reviewed as a token',
      {
        coin: trc10,
        toAddress: USDT,
        toAmount: '2500000',
        contractPayload: call({ data: unlimitedApproveData, callValue: '2500000' }),
      },
      /TRX/,
    ],
    [
      'a contract call with an empty reviewed amount',
      { coin: trx, toAddress: USDT, toAmount: '', contractPayload: call({ data: unlimitedApproveData }) },
      /amount/,
    ],
    [
      'a recipient that fails its checksum on both sides',
      {
        coin: trx,
        toAddress: BAD_CHECKSUM,
        toAmount: '1000000',
        contractPayload: transfer({ toAddress: BAD_CHECKSUM }),
      },
      /recipient/,
    ],
    [
      'a TRC-10 transfer reviewed as TRX',
      { coin: trx, toAddress: RECIPIENT, toAmount: '500', contractPayload: transferAsset() },
      /TRX/,
    ],
  ])('refuses %s', (_, input, error) => {
    expect(() => sign(build(input))).toThrow(error)
  })
})
