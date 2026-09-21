import { Address, beginCell, Cell, comment, external, loadMessage, loadOutList, storeMessage } from '@ton/core'
import { describe, expect, it } from 'vitest'

import { tonV5R1WalletId } from '../walletV5R1'
import {
  attachTonGaslessSignature,
  buildTonGaslessExternalMessage,
  buildTonGaslessSigningCell,
  isTonGaslessRequest,
  tonGaslessSendMode,
  tonV5R1InternalSignedOpcode,
  toTonGaslessInternalMessage,
} from './request'

const jettonWallet = 'EQCIcjES4cQET0z6nRixZ0MdvTB4u3_8triztLSrIIrDkpgJ'
const wallet = 'UQCvaZohosTA0ak9ZFMs-cvL1JrXqogqJH8sI2uO6k8clJpn'
const payload = comment('hi').toBoc().toString('base64')

const messages = [
  { to: jettonWallet, amount: '80000000', payload },
  {
    to: jettonWallet,
    amount: '50000000',
    payload: comment('fee').toBoc().toString('hex'),
  },
]

describe('buildTonGaslessSigningCell', () => {
  it('lays out a W5 internal_signed request: opcode, wallet id, deadline, seqno, send actions, no extensions', () => {
    const cell = buildTonGaslessSigningCell({
      validUntil: 1_800_000_000,
      seqno: 7,
      messages,
    })
    const slice = cell.beginParse()

    expect(slice.loadUint(32)).toBe(tonV5R1InternalSignedOpcode)
    expect(slice.loadInt(32)).toBe(tonV5R1WalletId)
    expect(slice.loadUint(32)).toBe(1_800_000_000)
    expect(slice.loadUint(32)).toBe(7)

    const outList = slice.loadMaybeRef()
    expect(outList).not.toBeNull()
    expect(slice.loadBit()).toBe(false)
    expect(slice.remainingBits).toBe(0)

    const actions = loadOutList(outList!.beginParse())
    expect(actions).toHaveLength(2)
    for (const [index, action] of actions.entries()) {
      expect(action.type).toBe('sendMsg')
      if (action.type !== 'sendMsg') throw new Error('unreachable')
      expect(action.mode).toBe(tonGaslessSendMode)
      expect(action.outMsg.info.type).toBe('internal')
      if (action.outMsg.info.type !== 'internal') throw new Error('unreachable')
      expect(action.outMsg.info.dest.equals(Address.parse(jettonWallet))).toBe(true)
      expect(action.outMsg.info.value.coins).toBe(BigInt(messages[index].amount))
      expect(action.outMsg.info.bounce).toBe(true)
    }
  })

  it('keeps the quoted order: the actions come back in the order the messages were given', () => {
    const cell = buildTonGaslessSigningCell({
      validUntil: 1,
      seqno: 0,
      messages,
    })
    const actions = loadOutList(cell.beginParse().skip(128).loadRef().beginParse())

    const bodies = actions.map(action =>
      action.type === 'sendMsg' ? action.outMsg.body.beginParse().skip(32).loadStringTail() : ''
    )
    expect(bodies).toEqual(['hi', 'fee'])
  })

  it('carries PAY_GAS_SEPARATELY and IGNORE_ERRORS, the same mode as a direct W5 send', () => {
    expect(tonGaslessSendMode).toBe(3)
  })

  it('hashes differently when any signed field changes', () => {
    const base = buildTonGaslessSigningCell({
      validUntil: 1_800_000_000,
      seqno: 7,
      messages,
    })
      .hash()
      .toString('hex')

    expect(
      buildTonGaslessSigningCell({
        validUntil: 1_800_000_001,
        seqno: 7,
        messages,
      })
        .hash()
        .toString('hex')
    ).not.toBe(base)
    expect(
      buildTonGaslessSigningCell({
        validUntil: 1_800_000_000,
        seqno: 8,
        messages,
      })
        .hash()
        .toString('hex')
    ).not.toBe(base)
    expect(
      buildTonGaslessSigningCell({
        validUntil: 1_800_000_000,
        seqno: 7,
        messages: [messages[0]],
      })
        .hash()
        .toString('hex')
    ).not.toBe(base)
    expect(
      buildTonGaslessSigningCell({
        validUntil: 1_800_000_000,
        seqno: 7,
        messages,
        walletId: 1,
      })
        .hash()
        .toString('hex')
    ).not.toBe(base)
  })

  it('refuses an empty request and one beyond the 255-action limit', () => {
    expect(() => buildTonGaslessSigningCell({ validUntil: 1, seqno: 0, messages: [] })).toThrow(/between 1 and 255/)
    expect(() =>
      buildTonGaslessSigningCell({
        validUntil: 1,
        seqno: 0,
        messages: Array.from({ length: 256 }, () => messages[0]),
      })
    ).toThrow(/between 1 and 255/)
  })
})

describe('toTonGaslessInternalMessage', () => {
  it('derives the bounce flag from the destination address tag, like a TonConnect message', () => {
    const bounceable = toTonGaslessInternalMessage({
      to: jettonWallet,
      amount: '1',
    })
    const nonBounceable = toTonGaslessInternalMessage({
      to: wallet,
      amount: '1',
    })

    expect(bounceable.info.type === 'internal' && bounceable.info.bounce).toBe(true)
    expect(nonBounceable.info.type === 'internal' && nonBounceable.info.bounce).toBe(false)
  })

  it('accepts hex and base64 payloads alike', () => {
    const fromBase64 = toTonGaslessInternalMessage({
      to: jettonWallet,
      amount: '1',
      payload,
    })
    const fromHex = toTonGaslessInternalMessage({
      to: jettonWallet,
      amount: '1',
      payload: comment('hi').toBoc().toString('hex'),
    })

    expect(fromBase64.body.hash().toString('hex')).toBe(fromHex.body.hash().toString('hex'))
  })
})

describe('attachTonGaslessSignature / buildTonGaslessExternalMessage / isTonGaslessRequest', () => {
  const signingCell = buildTonGaslessSigningCell({
    validUntil: 1_800_000_000,
    seqno: 7,
    messages,
  })
  const signature = new Uint8Array(64).fill(0xab)

  it('appends the 64-byte signature after the request, where W5 reads it', () => {
    const body = attachTonGaslessSignature({ signingCell, signature })
    const slice = body.beginParse()

    expect(slice.remainingBits).toBe(signingCell.bits.length + 512)
    slice.skip(signingCell.bits.length)
    expect(slice.loadBuffer(64)).toEqual(Buffer.from(signature))
    expect(body.refs).toHaveLength(signingCell.refs.length)
  })

  it('rejects a signature of the wrong length', () => {
    expect(() => attachTonGaslessSignature({ signingCell, signature: new Uint8Array(63) })).toThrow(/64 bytes/)
  })

  it('wraps the body in an external message to the wallet, with the StateInit only when given', () => {
    const body = attachTonGaslessSignature({ signingCell, signature })
    const plain = loadMessage(
      buildTonGaslessExternalMessage({
        walletAddress: wallet,
        body,
      }).beginParse()
    )

    expect(plain.info.type).toBe('external-in')
    if (plain.info.type !== 'external-in') throw new Error('unreachable')
    expect(plain.info.dest.equals(Address.parse(wallet))).toBe(true)
    expect(plain.init).toBeFalsy()
    expect(plain.body.hash().toString('hex')).toBe(body.hash().toString('hex'))

    const stateInit = {
      code: beginCell().storeUint(1, 8).endCell(),
      data: beginCell().storeUint(2, 8).endCell(),
    }
    const deploying = loadMessage(
      buildTonGaslessExternalMessage({
        walletAddress: wallet,
        body,
        stateInit,
      }).beginParse()
    )
    expect(deploying.init?.code?.hash().toString('hex')).toBe(stateInit.code.hash().toString('hex'))
  })

  it('recognizes a relayed request by its opcode and nothing else', () => {
    const body = attachTonGaslessSignature({ signingCell, signature })
    const relayed = buildTonGaslessExternalMessage({
      walletAddress: wallet,
      body,
    })
      .toBoc()
      .toString('base64')
    expect(isTonGaslessRequest(relayed)).toBe(true)

    // The same request under the external opcode is a direct send.
    const direct = beginCell()
      .storeUint(0x7369676e, 32)
      .storeSlice(signingCell.beginParse().skip(32))
      .storeBuffer(Buffer.from(signature))
      .endCell()
    const directBoc = beginCell()
      .store(storeMessage(external({ to: wallet, body: direct })))
      .endCell()
      .toBoc()
      .toString('base64')
    expect(isTonGaslessRequest(directBoc)).toBe(false)

    expect(
      isTonGaslessRequest(
        beginCell()
          .store(storeMessage(external({ to: wallet })))
          .endCell()
          .toBoc()
          .toString('base64')
      )
    ).toBe(false)
    expect(isTonGaslessRequest('not a boc')).toBe(false)
    expect(isTonGaslessRequest(Cell.EMPTY.toBoc().toString('base64'))).toBe(false)
  })
})
