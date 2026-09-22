import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getTonGaslessConfig: vi.fn(),
  estimateTonGasless: vi.fn(),
  resolveTonWalletVersion: vi.fn(),
  getTonAccountInfo: vi.fn(),
  getJettonWalletAddress: vi.fn(),
  getTonWalletState: vi.fn(),
}))

vi.mock('@vultisig/core-chain/chains/ton/gasless/api', async importOriginal => ({
  ...(await importOriginal<typeof import('@vultisig/core-chain/chains/ton/gasless/api')>()),
  getTonGaslessConfig: mocks.getTonGaslessConfig,
  estimateTonGasless: mocks.estimateTonGasless,
}))
vi.mock('@vultisig/core-chain/chains/ton/wallet', async importOriginal => ({
  ...(await importOriginal<typeof import('@vultisig/core-chain/chains/ton/wallet')>()),
  resolveTonWalletVersion: mocks.resolveTonWalletVersion,
}))
vi.mock('@vultisig/core-chain/chains/ton/account/getTonAccountInfo', async importOriginal => ({
  ...(await importOriginal<typeof import('@vultisig/core-chain/chains/ton/account/getTonAccountInfo')>()),
  getTonAccountInfo: mocks.getTonAccountInfo,
}))
vi.mock('@vultisig/core-chain/chains/ton/api', () => ({
  getJettonWalletAddress: mocks.getJettonWalletAddress,
  getTonWalletState: mocks.getTonWalletState,
}))

import { create } from '@bufbuild/protobuf'
import { Address, Cell, loadMessageRelaxed } from '@ton/core'
import { Chain } from '@vultisig/core-chain/Chain'
import { HttpResponseError } from '@vultisig/lib-utils/fetch/HttpResponseError'
import { tonConfig } from '@vultisig/core-chain/chains/ton/config'
import {
  buildTonJettonTransferBody,
  parseTonJettonTransferBody,
} from '@vultisig/core-chain/chains/ton/jetton/transferBody'

import { KeysignPayload, KeysignPayloadSchema } from '../../../../types/vultisig/keysign/v1/keysign_message_pb'
import { BuildKeysignPayloadError } from '../../../error'
import { buildTonGaslessTransferBody } from '../../../ton/gasless'
import { getTonGaslessQuote } from './gasless'
import { getTonChainSpecific } from './index'

const relay = '0:7ae5056c3fd9406f9bbbe7c7089cd4c40801d9075486cbedb7ce12df119eacf1'
const usdtMaster = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'
const sender = 'UQCvaZohosTA0ak9ZFMs-cvL1JrXqogqJH8sI2uO6k8clJpn'
const receiver = 'UQDmLe6ticcY_uLZsfurdYONshNuCn8IS81KcJ8p6M6ISMcB'
const jettonWallet = 'EQCIcjES4cQET0z6nRixZ0MdvTB4u3_8triztLSrIIrDkpgJ'
const publicKeyHex = 'aa'.repeat(32)
const commission = 150_000n

const walletCore = {
  PublicKey: { createWithData: () => ({}) },
  PublicKeyType: { ed25519: 0 },
} as never

const buildPayload = (
  overrides: {
    contractAddress?: string
    isNativeToken?: boolean
    memo?: string
  } = {}
): KeysignPayload =>
  create(KeysignPayloadSchema, {
    coin: {
      chain: Chain.Ton,
      ticker: overrides.isNativeToken ? 'TON' : 'USDT',
      address: sender,
      decimals: overrides.isNativeToken ? 9 : 6,
      isNativeToken: overrides.isNativeToken ?? false,
      contractAddress: overrides.isNativeToken ? '' : (overrides.contractAddress ?? usdtMaster),
      hexPublicKey: publicKeyHex,
    },
    toAddress: receiver,
    toAmount: '5000000',
    memo: overrides.memo ?? 'hi',
  })

const base64 = (cell: Cell) => cell.toBoc().toString('base64')

/** A faithful relay answer: the caller's transfer echoed back plus the commission transfer. */
const faithfulQuote = (keysignPayload: KeysignPayload, isActiveDestination = true) => ({
  relayAddress: relay,
  commission,
  validUntil: 1_700_000_240,
  protocolName: 'gasless',
  messages: [
    {
      to: jettonWallet,
      amount: tonConfig.jettonAmount.toString(),
      payload: base64(
        buildTonGaslessTransferBody({
          keysignPayload,
          relayAddress: relay,
          isActiveDestination,
        })
      ),
    },
    {
      to: jettonWallet,
      amount: '50000000',
      payload: base64(
        buildTonJettonTransferBody({
          amount: commission,
          destination: relay,
          responseDestination: relay,
          forwardTonAmount: 0n,
        })
      ),
    },
  ],
})

describe('getTonGaslessQuote', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTonWalletVersion.mockReturnValue('v5r1')
    mocks.getTonGaslessConfig.mockResolvedValue({
      relayAddress: relay,
      gasJettonMasters: [usdtMaster],
    })
  })

  it('prices the transfer with the relay and records the quote', async () => {
    const keysignPayload = buildPayload()
    mocks.estimateTonGasless.mockResolvedValue(faithfulQuote(keysignPayload))

    const { gasless, validUntil } = await getTonGaslessQuote({
      keysignPayload,
      walletCore,
      jettonAddress: jettonWallet,
      isActiveDestination: true,
    })

    expect(validUntil).toBe(1_700_000_240)
    expect(gasless.relayAddress).toBe(relay)
    expect(gasless.gasJettonMaster).toBe(usdtMaster)
    expect(gasless.commission).toBe(commission.toString())
    expect(gasless.messages).toHaveLength(2)
    expect(gasless.messages[0]).toMatchObject({
      to: jettonWallet,
      amount: tonConfig.jettonAmount.toString(),
    })
  })

  it('asks the relay to price exactly the approved transfer, refunding excess TON to the relay', async () => {
    const keysignPayload = buildPayload()
    mocks.estimateTonGasless.mockResolvedValue(faithfulQuote(keysignPayload, false))

    await getTonGaslessQuote({
      keysignPayload,
      walletCore,
      jettonAddress: jettonWallet,
      isActiveDestination: false,
    })

    const [input] = mocks.estimateTonGasless.mock.calls[0]
    expect(input.gasJettonMaster).toBe(usdtMaster)
    expect(input.walletAddress).toBe(Address.parse(sender).toRawString())
    expect(input.walletPublicKeyHex).toBe(publicKeyHex)
    expect(input.messages).toHaveLength(1)

    const message = loadMessageRelaxed(input.messages[0].beginParse())
    expect(message.info.type).toBe('internal')
    if (message.info.type !== 'internal') throw new Error('unreachable')
    expect(message.info.dest.equals(Address.parse(jettonWallet))).toBe(true)
    expect(message.info.value.coins).toBe(tonConfig.jettonAmount)
    expect(message.info.bounce).toBe(true)

    const body = parseTonJettonTransferBody(message.body)!
    expect(body.amount).toBe(5_000_000n)
    expect(body.destination.equals(Address.parse(receiver))).toBe(true)
    expect(body.responseDestination!.equals(Address.parse(relay))).toBe(true)
    expect(body.forwardTonAmount).toBe(0n)
    expect(body.comment).toBe('hi')
  })

  it('refuses a V4R2 account: gasless is a W5 feature', async () => {
    mocks.resolveTonWalletVersion.mockReturnValue('v4r2')

    await expect(
      getTonGaslessQuote({
        keysignPayload: buildPayload(),
        walletCore,
        jettonAddress: jettonWallet,
        isActiveDestination: true,
      })
    ).rejects.toMatchObject({
      type: 'ton-gasless-unsupported',
      message: expect.stringMatching(/W5/),
    })
    expect(mocks.estimateTonGasless).not.toHaveBeenCalled()
  })

  it('refuses a native TON send', async () => {
    await expect(
      getTonGaslessQuote({
        keysignPayload: buildPayload({ isNativeToken: true }),
        walletCore,
        jettonAddress: '',
        isActiveDestination: true,
      })
    ).rejects.toMatchObject({ type: 'ton-gasless-unsupported' })
  })

  it('refuses a jetton the relay does not take as a fee', async () => {
    mocks.getTonGaslessConfig.mockResolvedValue({
      relayAddress: relay,
      gasJettonMasters: [],
    })

    await expect(
      getTonGaslessQuote({
        keysignPayload: buildPayload(),
        walletCore,
        jettonAddress: jettonWallet,
        isActiveDestination: true,
      })
    ).rejects.toMatchObject({
      type: 'ton-gasless-unsupported',
      message: expect.stringMatching(/USDT/),
    })
    expect(mocks.estimateTonGasless).not.toHaveBeenCalled()
  })

  it('turns a relay refusal into bad input, and leaves a relay outage retryable', async () => {
    const refusal = new HttpResponseError({
      message: 'failed to determine wallet version: invalid wallet address',
      status: 400,
      statusText: 'Bad Request',
      url: 'https://tonapi.io/v2/gasless/estimate/x',
      body: { error: 'failed to determine wallet version: invalid wallet address' },
    })
    mocks.estimateTonGasless.mockRejectedValueOnce(refusal)
    await expect(
      getTonGaslessQuote({
        keysignPayload: buildPayload(),
        walletCore,
        jettonAddress: jettonWallet,
        isActiveDestination: true,
      })
    ).rejects.toMatchObject({ type: 'ton-gasless-unsupported', message: expect.stringMatching(/wallet version/) })

    const outage = new HttpResponseError({ message: 'HTTP 503', status: 503, statusText: '', url: '', body: '' })
    mocks.estimateTonGasless.mockRejectedValueOnce(outage)
    await expect(
      getTonGaslessQuote({
        keysignPayload: buildPayload(),
        walletCore,
        jettonAddress: jettonWallet,
        isActiveDestination: true,
      })
    ).rejects.toBe(outage)
  })

  it('reports the relay refusing a transfer that leaves no room for the commission as not enough funds', async () => {
    mocks.estimateTonGasless.mockRejectedValueOnce(
      new HttpResponseError({
        message: "wallet doesn't have enough tokens to complete a transaction",
        status: 400,
        statusText: 'Bad Request',
        url: 'https://tonapi.io/v2/gasless/estimate/x',
        body: { error: "wallet doesn't have enough tokens to complete a transaction", error_code: 40007 },
      })
    )

    await expect(
      getTonGaslessQuote({
        keysignPayload: buildPayload(),
        walletCore,
        jettonAddress: jettonWallet,
        isActiveDestination: true,
      })
    ).rejects.toMatchObject({ type: 'not-enough-funds' })
  })

  it('refuses a quote that names a commission address other than the published relay', async () => {
    const keysignPayload = buildPayload()
    mocks.estimateTonGasless.mockResolvedValue({
      ...faithfulQuote(keysignPayload),
      relayAddress: jettonWallet,
    })

    await expect(
      getTonGaslessQuote({
        keysignPayload,
        walletCore,
        jettonAddress: jettonWallet,
        isActiveDestination: true,
      })
    ).rejects.toMatchObject({ type: 'ton-gasless-quote-invalid' })
  })

  it('refuses a quote that changed the transfer, as bad input rather than a retryable failure', async () => {
    const keysignPayload = buildPayload()
    const quote = faithfulQuote(keysignPayload)
    quote.messages[0].payload = base64(
      buildTonJettonTransferBody({
        amount: 5_000_001n,
        destination: receiver,
        responseDestination: relay,
        forwardTonAmount: 1n,
        comment: 'hi',
      })
    )
    mocks.estimateTonGasless.mockResolvedValue(quote)

    const failure = await getTonGaslessQuote({
      keysignPayload,
      walletCore,
      jettonAddress: jettonWallet,
      isActiveDestination: true,
    }).catch(error => error)

    expect(failure).toBeInstanceOf(BuildKeysignPayloadError)
    expect(failure).toMatchObject({
      type: 'ton-gasless-quote-invalid',
      message: expect.stringMatching(/5000001/),
    })
  })
})

describe('getTonChainSpecific — gasless', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(1_700_000_000_000))
    mocks.resolveTonWalletVersion.mockReturnValue('v5r1')
    mocks.getTonGaslessConfig.mockResolvedValue({
      relayAddress: relay,
      gasJettonMasters: [usdtMaster],
    })
    mocks.getTonAccountInfo.mockResolvedValue({ account_state: { seqno: 3 } })
    mocks.getTonWalletState.mockResolvedValue('active')
    mocks.getJettonWalletAddress.mockResolvedValue(jettonWallet)
  })

  it('records the quote and caps the expiry at the relay deadline', async () => {
    const keysignPayload = buildPayload()
    mocks.estimateTonGasless.mockResolvedValue(faithfulQuote(keysignPayload))

    const specific = await getTonChainSpecific({
      keysignPayload,
      walletCore,
      gasless: true,
    })

    expect(specific.gasless?.commission).toBe(commission.toString())
    expect(specific.gasless?.messages).toHaveLength(2)
    expect(specific.jettonAddress).toBe(jettonWallet)
    expect(specific.sequenceNumber).toBe(3n)
    // The wallet window would be now + 600; the relay's 240 s deadline is tighter.
    expect(specific.expireAt).toBe(1_700_000_240n)
  })

  it('keeps the wallet window when the relay deadline is later', async () => {
    const keysignPayload = buildPayload()
    mocks.estimateTonGasless.mockResolvedValue({
      ...faithfulQuote(keysignPayload),
      validUntil: 1_700_001_000,
    })

    const specific = await getTonChainSpecific({
      keysignPayload,
      walletCore,
      gasless: true,
    })

    expect(specific.expireAt).toBe(1_700_000_600n)
  })

  it('leaves a direct send untouched: no relay call, no quote', async () => {
    const specific = await getTonChainSpecific({
      keysignPayload: buildPayload(),
      walletCore,
    })

    expect(specific.gasless).toBeUndefined()
    expect(mocks.getTonGaslessConfig).not.toHaveBeenCalled()
    expect(mocks.estimateTonGasless).not.toHaveBeenCalled()
  })
})
