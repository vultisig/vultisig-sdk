import { describe, expect, it } from 'vitest'

import { buildCw20TransferMsg } from '@/tools/prep/cw20Transfer'

// Throwaway, well-formed bech32 addresses (osmo prefix). These are deterministic
// test vectors only — never funded, never broadcast.
const OSMO_SENDER = 'osmo1c3a7qq6trpvdver98agv6d9cqex94889k5ejr7'
const OSMO_RECIPIENT = 'osmo12f8hyk2prj2f5w2j3at9ndrxw390ejkr5nt99h'
const OSMO_CONTRACT = 'osmo1kyekxn2qmcjt902sywxm42a2h2d35ssn9ljpvuf77mewevup4kds298e77'

describe('buildCw20TransferMsg', () => {
  it('builds a MsgExecuteContract amino msg with stringified transfer payload', () => {
    const result = buildCw20TransferMsg({
      bech32Prefix: 'osmo',
      contract: OSMO_CONTRACT,
      recipient: OSMO_RECIPIENT,
      amount: '1000000',
      sender: OSMO_SENDER,
    })

    expect(result.msg.type).toBe('wasm/MsgExecuteContract')
    expect(result.executeMsg).toBe(JSON.stringify({ transfer: { recipient: OSMO_RECIPIENT, amount: '1000000' } }))

    const value = JSON.parse(result.msg.value)
    expect(value).toEqual({
      sender: OSMO_SENDER,
      contract: OSMO_CONTRACT,
      msg: { transfer: { recipient: OSMO_RECIPIENT, amount: '1000000' } },
      funds: [],
    })
    expect(result.recipient).toBe(OSMO_RECIPIENT)
    expect(result.contract).toBe(OSMO_CONTRACT)
    expect(result.sender).toBe(OSMO_SENDER)
    expect(result.amount).toBe('1000000')
  })

  it('carries the recipient (not the contract) in the transfer body', () => {
    const { msg } = buildCw20TransferMsg({
      bech32Prefix: 'osmo',
      contract: OSMO_CONTRACT,
      recipient: OSMO_RECIPIENT,
      amount: '42',
      sender: OSMO_SENDER,
    })
    const value = JSON.parse(msg.value)
    // Fund-safety: transfer.recipient must be the human recipient, never the contract.
    expect(value.msg.transfer.recipient).toBe(OSMO_RECIPIENT)
    expect(value.msg.transfer.recipient).not.toBe(OSMO_CONTRACT)
  })

  it('preserves the trimmed amount byte-for-byte (no leading-zero strip) for mcp-ts parity', () => {
    // Byte-parity with mcp-ts's shared validateBaseUnitAmount, which returns the
    // trimmed string unchanged. The amount is embedded verbatim into the signed
    // execute_msg JSON, so stripping leading zeros here would produce a different
    // signed wire payload than the mcp-ts source for the same input.
    const result = buildCw20TransferMsg({
      bech32Prefix: 'osmo',
      contract: OSMO_CONTRACT,
      recipient: OSMO_RECIPIENT,
      amount: '0001000',
      sender: OSMO_SENDER,
    })
    expect(result.amount).toBe('0001000')
    // The verbatim amount also flows into the signed execute_msg + amino value.
    expect(result.executeMsg).toBe(JSON.stringify({ transfer: { recipient: OSMO_RECIPIENT, amount: '0001000' } }))
    expect(JSON.parse(result.msg.value).msg.transfer.amount).toBe('0001000')
  })

  it('trims surrounding whitespace but keeps the inner digits verbatim', () => {
    const { amount } = buildCw20TransferMsg({
      bech32Prefix: 'osmo',
      contract: OSMO_CONTRACT,
      recipient: OSMO_RECIPIENT,
      amount: '  010  ',
      sender: OSMO_SENDER,
    })
    expect(amount).toBe('010')
  })

  it('rejects a zero amount', () => {
    expect(() =>
      buildCw20TransferMsg({
        bech32Prefix: 'osmo',
        contract: OSMO_CONTRACT,
        recipient: OSMO_RECIPIENT,
        amount: '0',
        sender: OSMO_SENDER,
      })
    ).toThrow(/greater than zero/)
  })

  it('rejects a non-integer amount', () => {
    expect(() =>
      buildCw20TransferMsg({
        bech32Prefix: 'osmo',
        contract: OSMO_CONTRACT,
        recipient: OSMO_RECIPIENT,
        amount: '1.5',
        sender: OSMO_SENDER,
      })
    ).toThrow(/positive integer/)
  })

  it('rejects a prefix mismatch (recipient on wrong chain)', () => {
    expect(() =>
      buildCw20TransferMsg({
        bech32Prefix: 'osmo',
        contract: OSMO_CONTRACT,
        recipient: 'kujira1sjv9es79h9s50tsn6dq0k67whk5xdcxd9jq2u2',
        amount: '1',
        sender: OSMO_SENDER,
      })
    ).toThrow(/expected osmo prefix/)
  })

  it('rejects a validator (valoper) address before a generic prefix mismatch', () => {
    expect(() =>
      buildCw20TransferMsg({
        bech32Prefix: 'osmo',
        contract: OSMO_CONTRACT,
        recipient: 'osmovaloper1jfqzr62sfzylq6uh66ch49k4dvm3jd4qn40lvc',
        amount: '1',
        sender: OSMO_SENDER,
      })
    ).toThrow(/validator address/)
  })

  it('rejects malformed bech32', () => {
    expect(() =>
      buildCw20TransferMsg({
        bech32Prefix: 'osmo',
        contract: OSMO_CONTRACT,
        recipient: 'not-an-address',
        amount: '1',
        sender: OSMO_SENDER,
      })
    ).toThrow(/invalid recipient/)
  })

  it('rejects a native bank denom routed as a contract', () => {
    expect(() =>
      buildCw20TransferMsg({
        bech32Prefix: 'terra',
        contract: 'uluna',
        recipient: 'terra1pfp2hrw36ynx5nzvzgcq3tzrkxy90uj9guduky',
        amount: '1',
        sender: 'terra1qgnxhg63j7ccc8krqr70terryynydu9al47rhz',
        nativeDenoms: ['uluna', 'uusd'],
      })
    ).toThrow(/native_denom_use_cosmos_send/)
  })
})
