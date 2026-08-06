import { describe, expect, it } from 'vitest'

import { buildCosmosWasmExecuteMsg } from '../../../../src/tools/prep/cosmosWasmExecute'

describe('buildCosmosWasmExecuteMsg', () => {
  it('builds the exact generic Amino envelope used by CLI execute', () => {
    const result = buildCosmosWasmExecuteMsg({
      sender: 'thor1sender',
      contract: 'thor1contract',
      msg: { swap: { minimum_output: '123' } },
      funds: [{ denom: 'rune', amount: '250000000' }],
    })

    expect(result).toEqual({
      type: 'wasm/MsgExecuteContract',
      value:
        '{"sender":"thor1sender","contract":"thor1contract","msg":{"swap":{"minimum_output":"123"}},"funds":[{"denom":"rune","amount":"250000000"}]}',
    })
  })

  it.each(['sender', 'contract'] as const)('rejects an empty %s', field => {
    expect(() =>
      buildCosmosWasmExecuteMsg({
        sender: field === 'sender' ? '  ' : 'thor1sender',
        contract: field === 'contract' ? '' : 'thor1contract',
        msg: {},
      })
    ).toThrow(`invalid CosmWasm execute ${field}: value is required`)
  })

  it('copies funds so later caller mutation cannot change the signed envelope', () => {
    const funds = [{ denom: 'urujira', amount: '7' }]
    const result = buildCosmosWasmExecuteMsg({
      sender: 'thor1sender',
      contract: 'thor1contract',
      msg: { deposit: {} },
      funds,
    })

    funds[0].amount = '999'
    expect(JSON.parse(result.value).funds).toEqual([{ denom: 'urujira', amount: '7' }])
  })

  it('rejects an undefined message instead of silently omitting the signed field', () => {
    expect(() =>
      buildCosmosWasmExecuteMsg({
        sender: 'thor1sender',
        contract: 'thor1contract',
        msg: undefined,
      })
    ).toThrow('invalid CosmWasm execute msg: value must be JSON-serializable')
  })
})
