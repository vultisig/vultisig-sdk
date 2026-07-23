import { TxBody, TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx'
import { MsgExecuteContract } from 'cosmjs-types/cosmwasm/wasm/v1/tx'
import { Any } from 'cosmjs-types/google/protobuf/any'
import { describe, expect, it } from 'vitest'

import { decodeCosmosTx } from '@/tools/decode'
import { buildCw20TransferMsg } from '@/tools/prep/cw20Transfer'

const SENDER = 'osmo1c3a7qq6trpvdver98agv6d9cqex94889k5ejr7'
const RECIPIENT = 'osmo12f8hyk2prj2f5w2j3at9ndrxw390ejkr5nt99h'
const CONTRACT = 'osmo1kyekxn2qmcjt902sywxm42a2h2d35ssn9ljpvuf77mewevup4kds298e77'

const encodeExecute = (msg: Uint8Array, funds: { amount: string; denom: string }[] = []): Uint8Array => {
  const execute = MsgExecuteContract.fromPartial({ sender: SENDER, contract: CONTRACT, msg, funds })
  const body = TxBody.fromPartial({
    messages: [
      Any.fromPartial({
        typeUrl: '/cosmwasm.wasm.v1.MsgExecuteContract',
        value: MsgExecuteContract.encode(execute).finish(),
      }),
    ],
  })
  return TxRaw.encode(
    TxRaw.fromPartial({
      bodyBytes: TxBody.encode(body).finish(),
      authInfoBytes: new Uint8Array(),
      signatures: [],
    })
  ).finish()
}

const decodeExecute = (payload: unknown, funds: { amount: string; denom: string }[] = []) =>
  decodeCosmosTx(encodeExecute(Buffer.from(JSON.stringify(payload), 'utf8'), funds), 'osmosis-1')

const decodeRawExecute = (payload: string) => decodeCosmosTx(encodeExecute(Buffer.from(payload, 'utf8')), 'osmosis-1')

describe('decodeCosmosTx — CW20 transfer', () => {
  it('round-trips the production CW20 builder through protobuf bytes', () => {
    const built = buildCw20TransferMsg({
      bech32Prefix: 'osmo',
      contract: CONTRACT,
      recipient: RECIPIENT,
      amount: '0001000',
      sender: SENDER,
    })

    const envelope = decodeCosmosTx(encodeExecute(Buffer.from(built.executeMsg, 'utf8')), 'osmosis-1')

    expect(envelope).toMatchObject({
      decoded: true,
      kind: 'transfer',
      recipient: RECIPIENT,
      amount: '0001000',
      asset: { contract: CONTRACT, symbol: '', decimals: 0 },
    })
  })

  it('keeps alternate CosmWasm actions generic', () => {
    expect(decodeExecute({ burn: { amount: '1000' } })).toMatchObject({
      decoded: true,
      kind: 'contractCall',
      recipient: CONTRACT,
    })
  })

  it('keeps transfer-shaped calls with extra fields generic', () => {
    expect(decodeExecute({ transfer: { recipient: RECIPIENT, amount: '1000', hidden: 'effect' } })).toMatchObject({
      decoded: true,
      kind: 'contractCall',
      recipient: CONTRACT,
    })
  })

  it.each([
    `{"transfer":{"recipient":"${RECIPIENT}","amount":"1","recipient":"evil"}}`,
    `{"transfer":{"recipient":"${RECIPIENT}","amount":"1"},"transfer":{"recipient":"evil","amount":"2"}}`,
    ` {"transfer":{"recipient":"${RECIPIENT}","amount":"1"}}`,
  ])('keeps ambiguous/noncanonical raw JSON generic', payload => {
    expect(decodeRawExecute(payload)).toMatchObject({
      decoded: true,
      kind: 'contractCall',
      recipient: CONTRACT,
    })
  })

  it('keeps a transfer with attached native funds generic', () => {
    expect(
      decodeExecute({ transfer: { recipient: RECIPIENT, amount: '1000' } }, [{ denom: 'uosmo', amount: '7' }])
    ).toMatchObject({
      decoded: true,
      kind: 'contractCall',
      recipient: CONTRACT,
      amount: '7',
      asset: { contract: 'uosmo', symbol: 'OSMO' },
    })
  })

  it.each([
    { transfer: { recipient: '', amount: '1000' } },
    { transfer: { recipient: 'not-an-address', amount: '1000' } },
    { transfer: { recipient: 'kujira1sjv9es79h9s50tsn6dq0k67whk5xdcxd9jq2u2', amount: '1000' } },
    { transfer: { recipient: '\ud800', amount: '1000' } },
    { transfer: { recipient: RECIPIENT, amount: '0' } },
    { transfer: { recipient: RECIPIENT, amount: 1000 } },
    { transfer: { recipient: RECIPIENT, amount: ((1n << 128n) + 1n).toString() } },
  ])('keeps non-canonical transfer payload %# generic', payload => {
    expect(decodeExecute(payload)).toMatchObject({
      decoded: true,
      kind: 'contractCall',
      recipient: CONTRACT,
    })
  })

  it('rejects invalid UTF-8 as a generic contract call', () => {
    const invalidUtf8 = Uint8Array.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d])
    expect(decodeCosmosTx(encodeExecute(invalidUtf8), 'osmosis-1')).toMatchObject({
      decoded: true,
      kind: 'contractCall',
      recipient: CONTRACT,
    })
  })
})
