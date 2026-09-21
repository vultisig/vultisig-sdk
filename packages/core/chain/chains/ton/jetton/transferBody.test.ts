import { Address, beginCell } from '@ton/core'
import { describe, expect, it } from 'vitest'

import { TonOp } from '../messageBody/opcodes'
import { buildTonJettonTransferBody, parseTonJettonTransferBody } from './transferBody'

const destination = 'UQDmLe6ticcY_uLZsfurdYONshNuCn8IS81KcJ8p6M6ISMcB'
const relay = '0:7ae5056c3fd9406f9bbbe7c7089cd4c40801d9075486cbedb7ce12df119eacf1'

describe('buildTonJettonTransferBody / parseTonJettonTransferBody', () => {
  it('round-trips every field, including an inline comment', () => {
    const body = buildTonJettonTransferBody({
      amount: 5_000_000n,
      destination,
      responseDestination: relay,
      forwardTonAmount: 1n,
      comment: 'hello',
      queryId: 42n,
    })

    const parsed = parseTonJettonTransferBody(body)

    expect(parsed).not.toBeNull()
    expect(parsed!.queryId).toBe(42n)
    expect(parsed!.amount).toBe(5_000_000n)
    expect(parsed!.destination.equals(Address.parse(destination))).toBe(true)
    expect(parsed!.responseDestination!.equals(Address.parse(relay))).toBe(true)
    expect(parsed!.forwardTonAmount).toBe(1n)
    expect(parsed!.comment).toBe('hello')
    expect(parsed!.hasForwardPayload).toBe(true)
    expect(parsed!.hasCustomPayload).toBe(false)
  })

  it('reports a custom payload', () => {
    const body = beginCell()
      .storeUint(TonOp.JETTON_TRANSFER, 32)
      .storeUint(0, 64)
      .storeCoins(1n)
      .storeAddress(Address.parse(destination))
      .storeAddress(Address.parse(relay))
      .storeMaybeRef(beginCell().storeUint(7, 8).endCell())
      .storeCoins(0n)
      .storeBit(false)
      .endCell()

    expect(parseTonJettonTransferBody(body)).toMatchObject({ hasCustomPayload: true, comment: null })
  })

  it('reports no comment and no forward payload when none was attached', () => {
    const parsed = parseTonJettonTransferBody(
      buildTonJettonTransferBody({
        amount: 1n,
        destination,
        responseDestination: relay,
        forwardTonAmount: 0n,
      })
    )

    expect(parsed).toMatchObject({
      comment: null,
      hasForwardPayload: false,
      forwardTonAmount: 0n,
    })
  })

  it('reads a comment carried in a referenced forward payload', () => {
    const body = beginCell()
      .storeUint(TonOp.JETTON_TRANSFER, 32)
      .storeUint(0, 64)
      .storeCoins(1n)
      .storeAddress(Address.parse(destination))
      .storeAddress(Address.parse(relay))
      .storeBit(false)
      .storeCoins(1n)
      .storeBit(true)
      .storeRef(beginCell().storeUint(0, 32).storeStringTail('by ref').endCell())
      .endCell()

    expect(parseTonJettonTransferBody(body)).toMatchObject({
      comment: 'by ref',
      hasForwardPayload: true,
    })
  })

  it('distinguishes a non-comment forward payload from no payload', () => {
    const body = beginCell()
      .storeUint(TonOp.JETTON_TRANSFER, 32)
      .storeUint(0, 64)
      .storeCoins(1n)
      .storeAddress(Address.parse(destination))
      .storeAddress(Address.parse(relay))
      .storeBit(false)
      .storeCoins(1n)
      .storeBit(false)
      .storeUint(0xdeadbeef, 32)
      .endCell()

    expect(parseTonJettonTransferBody(body)).toMatchObject({
      comment: null,
      hasForwardPayload: true,
    })
  })

  it('returns null for a body that is not a jetton transfer', () => {
    expect(
      parseTonJettonTransferBody(beginCell().storeUint(0, 32).storeStringTail('just a comment').endCell())
    ).toBeNull()
    expect(parseTonJettonTransferBody(beginCell().endCell())).toBeNull()
    expect(
      parseTonJettonTransferBody(beginCell().storeUint(TonOp.JETTON_TRANSFER, 32).storeUint(0, 64).endCell())
    ).toBeNull()
  })

  it('uses the same layout as WalletCore: inline forward payload after a zero custom-payload bit', () => {
    const slice = buildTonJettonTransferBody({
      amount: 1n,
      destination,
      responseDestination: relay,
      forwardTonAmount: 1n,
      comment: 'x',
    }).beginParse()

    expect(slice.loadUint(32)).toBe(TonOp.JETTON_TRANSFER)
    slice.loadUintBig(64)
    slice.loadCoins()
    slice.loadAddress()
    slice.loadAddress()
    expect(slice.loadBit()).toBe(false)
    slice.loadCoins()
    expect(slice.loadBit()).toBe(false)
    expect(slice.loadUint(32)).toBe(0)
    expect(slice.loadStringTail()).toBe('x')
    expect(slice.remainingRefs).toBe(0)
  })
})
