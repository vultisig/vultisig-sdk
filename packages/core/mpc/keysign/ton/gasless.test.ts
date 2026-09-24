/**
 * The relayed (gasless) TON path end to end: the quote a relay returns is
 * validated against the payload, hashed as a W5 `internal_signed` request,
 * signed, and assembled into the envelope the relay accepts. Signatures are
 * made with a throwaway key so the assembled body can be verified by the same
 * WalletCore check every co-signer runs.
 */
import { Buffer } from 'buffer'

import { create, toBinary } from '@bufbuild/protobuf'
import { Address, beginCell, Cell, loadMessage } from '@ton/core'
import { Chain } from '@vultisig/core-chain/Chain'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { buildTonGaslessSigningCell, isTonGaslessRequest } from '@vultisig/core-chain/chains/ton/gasless/request'
import {
  buildTonJettonTransferBody,
  parseTonJettonTransferBody,
} from '@vultisig/core-chain/chains/ton/jetton/transferBody'
import { getTonV5R1Address } from '@vultisig/core-chain/chains/ton/walletV5R1'
import { decodeSigningOutput } from '@vultisig/core-chain/tw/signingOutput'
import { getTxHash } from '@vultisig/core-chain/tx/hash'
import { initWasm, WalletCore } from '@trustwallet/wallet-core'
import { beforeAll, describe, expect, it } from 'vitest'

import { compileTx } from '../../tx/compile/compileTx'
import { getPreSigningHashes } from '../../tx/preSigningHashes'
import { TonGasless, TonGaslessSchema, TonSpecificSchema } from '../../types/vultisig/keysign/v1/blockchain_specific_pb'
import { KeysignPayload, KeysignPayloadSchema } from '../../types/vultisig/keysign/v1/keysign_message_pb'
import { TonMessage, TonMessageSchema } from '../../types/vultisig/keysign/v1/wasm_execute_contract_payload_pb'
import { getKeysignFeeCoin } from '../fee/getKeysignFeeCoin'
import { tonFeeAmountResolver } from '../fee/resolvers/ton'
import { getEncodedSigningInputs } from '../signingInputs'
import { getTonSigningInputs } from '../signingInputs/resolvers/ton'
import {
  assertTonGaslessQuote,
  buildTonGaslessTransferBody,
  compileTonGaslessTx,
  getKeysignTonGasless,
  getTonGaslessPreSigningHashes,
  tonGaslessMaxAttachedValue,
} from './gasless'

const throwawayPrivateKeyHex = '11'.repeat(32)
const usdtMaster = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'
const receiver = 'UQDmLe6ticcY_uLZsfurdYONshNuCn8IS81KcJ8p6M6ISMcB'
const jettonWallet = 'EQCIcjES4cQET0z6nRixZ0MdvTB4u3_8triztLSrIIrDkpgJ'
const relay = '0:7ae5056c3fd9406f9bbbe7c7089cd4c40801d9075486cbedb7ce12df119eacf1'
const otherAccount = 'EQDAFuDWly4z3eA16Ej_JHpoL6CcXdt0IRUrODKKsu60HYMi'
const amount = 5_000_000n
const commission = 150_000n
const memo = 'hello'

let walletCore: WalletCore
let publicKeyHex: string
let w5Address: string

beforeAll(async () => {
  walletCore = await initWasm()
  const privateKey = walletCore.PrivateKey.createWithData(Buffer.from(throwawayPrivateKeyHex, 'hex'))
  const publicKey = privateKey.getPublicKeyEd25519().data()
  publicKeyHex = Buffer.from(publicKey).toString('hex')
  w5Address = getTonV5R1Address({ publicKey }).toString({
    bounceable: false,
    testOnly: false,
    urlSafe: true,
  })
})

const base64 = (cell: Cell) => cell.toBoc().toString('base64')

type PayloadOptions = {
  messages?: (message: TonMessage[]) => TonMessage[]
  gasless?: Partial<TonGasless>
  memo?: string
  toAddress?: string
  toAmount?: string
  address?: string
  contractAddress?: string
  isNativeToken?: boolean
  sequenceNumber?: bigint
  jettonAddress?: string
  relayForTransfer?: string
}

const buildPayload = ({
  messages = quoted => quoted,
  gasless = {},
  memo: payloadMemo = memo,
  toAddress = receiver,
  toAmount = amount.toString(),
  address = w5Address,
  contractAddress = usdtMaster,
  isNativeToken = false,
  sequenceNumber = 7n,
  jettonAddress = jettonWallet,
  relayForTransfer = relay,
}: PayloadOptions = {}): KeysignPayload => {
  const base = create(KeysignPayloadSchema, {
    coin: {
      chain: Chain.Ton,
      ticker: isNativeToken ? 'TON' : 'USDT',
      address,
      decimals: isNativeToken ? 9 : 6,
      isNativeToken,
      contractAddress: isNativeToken ? '' : contractAddress,
      hexPublicKey: publicKeyHex,
    },
    toAddress,
    toAmount,
    memo: payloadMemo,
  })

  const transfer = buildTonGaslessTransferBody({
    keysignPayload: base,
    relayAddress: relayForTransfer,
    isActiveDestination: true,
  })
  const commissionTransfer = buildTonJettonTransferBody({
    amount: commission,
    destination: relay,
    responseDestination: relay,
    forwardTonAmount: 0n,
  })

  const quotedMessages = messages([
    create(TonMessageSchema, {
      to: jettonWallet,
      amount: '80000000',
      payload: base64(transfer),
    }),
    create(TonMessageSchema, {
      to: jettonWallet,
      amount: '50000000',
      payload: base64(commissionTransfer),
    }),
  ])

  return {
    ...base,
    blockchainSpecific: {
      case: 'tonSpecific',
      value: create(TonSpecificSchema, {
        sequenceNumber,
        expireAt: 1_800_000_000n,
        bounceable: true,
        jettonAddress,
        isActiveDestination: true,
        gasless: create(TonGaslessSchema, {
          relayAddress: relay,
          gasJettonMaster: usdtMaster,
          commission: commission.toString(),
          messages: quotedMessages,
          ...gasless,
        }),
      }),
    },
  }
}

const withTransferBody = (message: TonMessage, edit: Parameters<typeof buildTonJettonTransferBody>[0]) =>
  create(TonMessageSchema, {
    ...message,
    payload: base64(buildTonJettonTransferBody(edit)),
  })

/** The same transfer with a `custom_payload` cell set, as a mintless-jetton claim would carry. */
const withCustomPayload = (body: Cell): Cell => {
  const slice = body.beginParse()
  const head = beginCell()
    .storeUint(slice.loadUint(32), 32)
    .storeUint(slice.loadUintBig(64), 64)
    .storeCoins(slice.loadCoins())
    .storeAddress(slice.loadAddress())
    .storeAddress(slice.loadMaybeAddress())
  slice.loadMaybeRef()
  return head.storeMaybeRef(beginCell().storeUint(1, 8).endCell()).storeSlice(slice).endCell()
}

const faithfulTransfer = () => ({
  amount,
  destination: receiver,
  responseDestination: relay,
  forwardTonAmount: 1n,
  comment: memo,
})

describe('assertTonGaslessQuote', () => {
  it('accepts a quote that spells out the approved transfer plus the declared commission', () => {
    expect(() => assertTonGaslessQuote(buildPayload())).not.toThrow()
  })

  it('tolerates what the relay may legitimately touch: query ids, refund to the sender, the commission split', () => {
    const tweaked = buildPayload({
      messages: ([transfer, fee]) => [
        withTransferBody(transfer, {
          ...faithfulTransfer(),
          queryId: 12345n,
          responseDestination: w5Address,
        }),
        withTransferBody(fee, {
          amount: commission / 2n,
          destination: relay,
          responseDestination: relay,
          forwardTonAmount: 0n,
        }),
        withTransferBody(fee, {
          amount: commission - commission / 2n,
          destination: relay,
          responseDestination: relay,
          forwardTonAmount: 0n,
        }),
      ],
    })

    expect(() => assertTonGaslessQuote(tweaked)).not.toThrow()
  })

  it.each([
    [
      'a different amount',
      {
        messages: ([t, f]: TonMessage[]) => [withTransferBody(t, { ...faithfulTransfer(), amount: amount + 1n }), f],
      },
      /transfers 5000001 instead of the approved 5000000/,
    ],
    [
      'a different receiver',
      {
        messages: ([t, f]: TonMessage[]) => [
          withTransferBody(t, {
            ...faithfulTransfer(),
            destination: otherAccount,
          }),
          f,
        ],
      },
      /unexpected destination|exactly one transfer/,
    ],
    [
      'a changed comment',
      {
        messages: ([t, f]: TonMessage[]) => [withTransferBody(t, { ...faithfulTransfer(), comment: 'hell0' }), f],
      },
      /changed the transfer comment/,
    ],
    [
      'a dropped comment',
      {
        messages: ([t, f]: TonMessage[]) => [withTransferBody(t, { ...faithfulTransfer(), comment: undefined }), f],
      },
      /changed the transfer comment/,
    ],
    [
      'a refund to a stranger',
      {
        messages: ([t, f]: TonMessage[]) => [
          withTransferBody(t, {
            ...faithfulTransfer(),
            responseDestination: otherAccount,
          }),
          f,
        ],
      },
      /refunds the transfer somewhere other than/,
    ],
    [
      'a custom payload on the transfer',
      {
        messages: ([t, f]: TonMessage[]) => [
          create(TonMessageSchema, {
            ...t,
            payload: base64(withCustomPayload(buildTonJettonTransferBody(faithfulTransfer()))),
          }),
          f,
        ],
      },
      /attached a custom payload/,
    ],
    [
      'a larger forward amount',
      {
        messages: ([t, f]: TonMessage[]) => [withTransferBody(t, { ...faithfulTransfer(), forwardTonAmount: 2n }), f],
      },
      /forwards more TON/,
    ],
    [
      'a commission that does not match the declared one',
      {
        messages: ([t, f]: TonMessage[]) => [
          t,
          withTransferBody(f, {
            amount: commission + 1n,
            destination: relay,
            responseDestination: relay,
            forwardTonAmount: 0n,
          }),
        ],
      },
      /pays the relay 150001, but the declared commission is 150000/,
    ],
    [
      'a second transfer to the receiver',
      { messages: ([t, f]: TonMessage[]) => [t, f, t] },
      /exactly one transfer to the receiver, found 2/,
    ],
    [
      'no transfer to the receiver',
      { messages: ([, f]: TonMessage[]) => [f] },
      /exactly one transfer to the receiver, found 0/,
    ],
    [
      'a message that deploys a contract',
      {
        messages: ([t, f]: TonMessage[]) => [create(TonMessageSchema, { ...t, stateInit: base64(Cell.EMPTY) }), f],
      },
      /deploy a contract/,
    ],
    [
      'a message leaving through another account',
      {
        messages: ([t, f]: TonMessage[]) => [create(TonMessageSchema, { ...t, to: otherAccount }), f],
      },
      /somewhere other than the sender jetton wallet/,
    ],
    [
      'a message that is not a jetton transfer',
      {
        messages: ([t, f]: TonMessage[]) => [t, create(TonMessageSchema, { ...f, payload: base64(Cell.EMPTY) })],
      },
      /not a jetton transfer/,
    ],
    [
      'a message without a payload',
      {
        messages: ([t, f]: TonMessage[]) => [t, create(TonMessageSchema, { ...f, payload: undefined })],
      },
      /without a payload/,
    ],
    [
      'more messages than a transfer needs',
      { messages: ([t, f]: TonMessage[]) => [t, f, f, f] },
      /1 to 3 messages, got 4/,
    ],
    ['no messages at all', { messages: () => [] }, /1 to 3 messages, got 0/],
    [
      'more attached TON than the bound allows',
      {
        messages: ([t, f]: TonMessage[]) => [
          create(TonMessageSchema, {
            ...t,
            amount: (tonGaslessMaxAttachedValue + 1n).toString(),
          }),
          f,
        ],
      },
      /attaches 550000001 nanotons, above the 500000000 allowed/,
    ],
    [
      'a commission in some other jetton',
      { gasless: { gasJettonMaster: otherAccount } },
      /commission in the jetton being sent/,
    ],
    ['a non-numeric commission', { gasless: { commission: '1.5' } }, /not a whole number/],
    ['a native TON send', { isNativeToken: true }, /native TON pays its fee in TON/],
    ['a send to the relay itself', { toAddress: relay }, /addressed to the relay itself/],
    ['a payload without the sender jetton wallet', { jettonAddress: '' }, /sender jetton wallet address/],
  ])('refuses %s', (_, options, error) => {
    expect(() => assertTonGaslessQuote(buildPayload(options as PayloadOptions))).toThrow(error)
  })

  it('refuses a payload that carries no quote', () => {
    const payload = buildPayload()
    const tonSpecific = payload.blockchainSpecific.value as {
      gasless?: TonGasless
    }
    delete tonSpecific.gasless

    expect(getKeysignTonGasless(payload)).toBeUndefined()
    expect(() => assertTonGaslessQuote(payload)).toThrow(/no gasless quote/)
  })
})

describe('getTonGaslessPreSigningHashes', () => {
  it('hashes the W5 internal_signed request built from the payload fields', () => {
    const payload = buildPayload()
    const gasless = getKeysignTonGasless(payload)!

    const expected = buildTonGaslessSigningCell({
      validUntil: 1_800_000_000,
      seqno: 7,
      messages: gasless.messages,
    })
    const [hash] = getTonGaslessPreSigningHashes({
      keysignPayload: payload,
      walletCore,
    })

    expect(Buffer.from(hash).toString('hex')).toBe(expected.hash().toString('hex'))
  })

  it("refuses the key's V4R2 account: only W5 takes a relayed request", () => {
    const v4r2 = walletCore.CoinTypeExt.deriveAddressFromPublicKey(
      walletCore.CoinType.ton,
      walletCore.PublicKey.createWithData(Buffer.from(publicKeyHex, 'hex'), walletCore.PublicKeyType.ed25519)
    )

    expect(() =>
      getTonGaslessPreSigningHashes({
        keysignPayload: buildPayload({ address: v4r2 }),
        walletCore,
      })
    ).toThrow(/Only a W5 TON wallet/)
  })

  it('validates the quote before producing anything to sign', () => {
    const tampered = buildPayload({
      messages: ([t, f]) => [
        withTransferBody(t, {
          ...faithfulTransfer(),
          destination: otherAccount,
        }),
        f,
      ],
    })

    expect(() => getTonGaslessPreSigningHashes({ keysignPayload: tampered, walletCore })).toThrow()
  })
})

const signHash = (hash: Uint8Array) => {
  const privateKey = walletCore.PrivateKey.createWithData(Buffer.from(throwawayPrivateKeyHex, 'hex'))
  const signature = privateKey.sign(hash, walletCore.Curve.ed25519)
  const hex = Buffer.from(signature).toString('hex')

  return { msg: Buffer.from(hash).toString('hex'), r: hex.slice(0, 64), s: hex.slice(64), der_signature: '' }
}

const publicKey = () =>
  walletCore.PublicKey.createWithData(Buffer.from(publicKeyHex, 'hex'), walletCore.PublicKeyType.ed25519)

describe('compileTonGaslessTx', () => {
  it('assembles the relay envelope with the signature at the tail and keys the output on the body hash', () => {
    const payload = buildPayload()
    const [hash] = getTonGaslessPreSigningHashes({
      keysignPayload: payload,
      walletCore,
    })
    const hashHex = Buffer.from(hash).toString('hex')

    const output = decodeSigningOutput(
      Chain.Ton,
      compileTonGaslessTx({
        keysignPayload: payload,
        walletCore,
        publicKey: publicKey(),
        signatures: { [hashHex]: signHash(hash) },
      })
    )

    expect(isTonGaslessRequest(output.encoded)).toBe(true)

    const message = loadMessage(Cell.fromBase64(output.encoded).beginParse())
    expect(message.info.type === 'external-in' && message.info.dest.equals(Address.parse(w5Address))).toBe(true)
    expect(message.init).toBeFalsy()

    const body = message.body.beginParse()
    const signingCell = buildTonGaslessSigningCell({
      validUntil: 1_800_000_000,
      seqno: 7,
      messages: getKeysignTonGasless(payload)!.messages,
    })
    expect(body.remainingBits).toBe(signingCell.bits.length + 512)
    body.skip(signingCell.bits.length)
    const signature = body.loadBuffer(64)
    expect(publicKey().verify(signature, hash)).toBe(true)

    expect(Buffer.from(output.hash).toString('hex')).toBe(message.body.hash().toString('hex'))
  })

  it('attaches the W5 StateInit on the first request so the relay can deploy the wallet', () => {
    const payload = buildPayload({ sequenceNumber: 0n })
    const [hash] = getTonGaslessPreSigningHashes({
      keysignPayload: payload,
      walletCore,
    })
    const hashHex = Buffer.from(hash).toString('hex')

    const output = decodeSigningOutput(
      Chain.Ton,
      compileTonGaslessTx({
        keysignPayload: payload,
        walletCore,
        publicKey: publicKey(),
        signatures: { [hashHex]: signHash(hash) },
      })
    )
    const message = loadMessage(Cell.fromBase64(output.encoded).beginParse())

    expect(message.init?.code?.hash().toString('hex')).toBe(
      '20834b7b72b112147e1b2fb457b84e74d1a30f04f737d4f62a668e9552d2b72f'
    )
  })

  it('refuses a missing or forged signature', () => {
    const payload = buildPayload()
    const [hash] = getTonGaslessPreSigningHashes({
      keysignPayload: payload,
      walletCore,
    })
    const hashHex = Buffer.from(hash).toString('hex')

    expect(() =>
      compileTonGaslessTx({
        keysignPayload: payload,
        walletCore,
        publicKey: publicKey(),
        signatures: {},
      })
    ).toThrow(/Missing signature/)

    const forged = { ...signHash(hash), r: 'ab'.repeat(32) }
    expect(() =>
      compileTonGaslessTx({
        keysignPayload: payload,
        walletCore,
        publicKey: publicKey(),
        signatures: { [hashHex]: forged },
      })
    ).toThrow(/Signature verification failed/)
  })
})

describe('the keysign pipeline routes a gasless payload around WalletCore', () => {
  it('encodes the payload itself as the signing input, hashes and compiles it through the gasless path', async () => {
    const payload = buildPayload()

    const [txInputData] = await getEncodedSigningInputs({
      keysignPayload: payload,
      walletCore,
    })
    expect(Buffer.from(txInputData).equals(Buffer.from(toBinary(KeysignPayloadSchema, payload)))).toBe(true)

    const hashes = getPreSigningHashes({
      walletCore,
      chain: Chain.Ton,
      txInputData,
      keysignPayload: payload,
    })
    expect(hashes).toHaveLength(1)
    expect(hashes[0]).toEqual(getTonGaslessPreSigningHashes({ keysignPayload: payload, walletCore })[0])

    const hashHex = Buffer.from(hashes[0]).toString('hex')
    const compiled = compileTx({
      publicKey: publicKey(),
      txInputData,
      signatures: { [hashHex]: signHash(hashes[0]) },
      chain: Chain.Ton,
      walletCore,
      keysignPayload: payload,
    })
    const output = decodeSigningOutput(Chain.Ton, compiled)

    expect(isTonGaslessRequest(output.encoded)).toBe(true)
    expect(await getTxHash({ chain: Chain.Ton, tx: output })).toBe(
      loadMessage(Cell.fromBase64(output.encoded).beginParse()).body.hash().toString('hex')
    )
  })

  it('never lets the WalletCore TON resolver build an external request for a gasless payload', () => {
    expect(() => getTonSigningInputs({ keysignPayload: buildPayload(), walletCore })).toThrow(
      /not a WalletCore signing input/
    )
  })
})

describe('fee of a gasless payload', () => {
  it('is the relay commission, denominated in the jetton being sent', async () => {
    const payload = buildPayload()

    expect(
      await tonFeeAmountResolver({
        keysignPayload: payload,
        walletCore,
        publicKey: publicKey(),
      })
    ).toBe(commission)
    expect(getKeysignFeeCoin(payload)).toMatchObject({
      chain: Chain.Ton,
      id: usdtMaster,
      ticker: 'USDT',
      decimals: 6,
    })
  })

  it('stays the TON reserve, in TON, for a direct jetton send', async () => {
    const payload = buildPayload()
    delete (payload.blockchainSpecific.value as { gasless?: TonGasless }).gasless

    expect(
      await tonFeeAmountResolver({
        keysignPayload: payload,
        walletCore,
        publicKey: publicKey(),
      })
    ).toBe(90_000_000n)
    expect(getKeysignFeeCoin(payload)).toMatchObject({
      chain: Chain.Ton,
      ticker: chainFeeCoin[Chain.Ton].ticker,
      decimals: 9,
    })
  })
})

describe('buildTonGaslessTransferBody', () => {
  it('builds the TEP-74 transfer the relay is asked to price, refunding excess to the relay', () => {
    const payload = buildPayload()
    const body = parseTonJettonTransferBody(
      buildTonGaslessTransferBody({
        keysignPayload: payload,
        relayAddress: relay,
        isActiveDestination: false,
      })
    )!

    expect(body.amount).toBe(amount)
    expect(body.destination.equals(Address.parse(receiver))).toBe(true)
    expect(body.responseDestination!.equals(Address.parse(relay))).toBe(true)
    expect(body.forwardTonAmount).toBe(0n)
    expect(body.comment).toBe(memo)
  })

  it('rejects a comment that would not fit the jetton cell', () => {
    expect(() =>
      buildTonGaslessTransferBody({
        keysignPayload: buildPayload({ memo: 'x'.repeat(60) }),
        relayAddress: relay,
        isActiveDestination: true,
      })
    ).toThrow(/at most/)
  })
})
