import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { parseTxReadyEnvelope, TxReadyParseError } from '../../../src/tx'

const EVM_TX = {
  to: '0x000000000000000000000000000000000000dEaD',
  value: '1000000000000000',
  data: '0x',
}

describe('parseTxReadyEnvelope', () => {
  it('parses a top-level tx_ready EVM envelope', () => {
    const parsed = parseTxReadyEnvelope({ chain: 'Ethereum', tx: EVM_TX })

    expect(parsed).toMatchObject({
      kind: 'raw-evm',
      chain: Chain.Ethereum,
      legs: [{ role: 'single', tx: EVM_TX }],
    })
  })

  it('parses a single-leg execute-prep EVM envelope', () => {
    const parsed = parseTxReadyEnvelope({
      stepperConfig: { flow: 'send' },
      txArgs: { chain: 'Polygon', chain_id: '137', tx_encoding: 'evm-tx', tx: EVM_TX },
    })

    expect(parsed.kind).toBe('raw-evm')
    expect(parsed.chain).toBe(Chain.Polygon)
    if (parsed.kind === 'raw-evm') expect(parsed.legs[0].txArgs?.tx_encoding).toBe('evm-tx')
  })

  it('parses an execute-prep approval/main pair in signing order', () => {
    const approval = { ...EVM_TX, to: '0x0000000000000000000000000000000000000001' }
    const main = { ...EVM_TX, to: '0x0000000000000000000000000000000000000002' }
    const parsed = parseTxReadyEnvelope({
      chain: 'BSC',
      approvalTxArgs: { chain: 'BSC', chain_id: '56', tx: approval },
      txArgs: { chain: 'BSC', chain_id: '56', tx: main },
    })

    expect(parsed).toMatchObject({
      kind: 'raw-evm',
      chain: Chain.BSC,
      legs: [
        { role: 'approval', tx: approval },
        { role: 'main', tx: main },
      ],
    })
  })

  it('parses a non-EVM execute-send envelope into vault.send units', () => {
    const parsed = parseTxReadyEnvelope({
      chain: 'Bitcoin',
      resolved: { labels: { token_resolved: 'BTC' } },
      txArgs: {
        chain: 'Bitcoin',
        tx_encoding: 'utxo-psbt',
        to: 'bc1qrecipient',
        amount: '1000',
        memo: '',
      },
    })

    expect(parsed).toMatchObject({
      kind: 'send',
      chain: Chain.Bitcoin,
      to: 'bc1qrecipient',
      amount: '0.00001',
    })
    if (parsed.kind === 'send') {
      expect(parsed.symbol).toBeUndefined()
      expect(parsed.memo).toBeUndefined()
    }
  })

  it('uses known token decimals for non-native sends', () => {
    const parsed = parseTxReadyEnvelope({
      chain: 'Solana',
      resolved: { labels: { token_resolved: 'USDC' } },
      txArgs: {
        chain: 'Solana',
        tx_encoding: 'solana-tx',
        to: 'solana-recipient',
        amount: '1000000',
      },
    })

    expect(parsed).toMatchObject({
      kind: 'send',
      chain: Chain.Solana,
      amount: '1',
      symbol: 'USDC',
    })
  })

  it('uses configured token decimals and rejects unresolved token sends', () => {
    const envelope = {
      chain: 'Solana',
      resolved: { labels: { token_resolved: 'CUSTOM' } },
      txArgs: { chain: 'Solana', to: 'solana-recipient', amount: '123456' },
    }

    expect(
      parseTxReadyEnvelope(envelope, {
        tokens: [
          {
            id: 'custom-mint',
            symbol: 'CUSTOM',
            name: 'Custom',
            decimals: 5,
            chainId: Chain.Solana,
          },
        ],
      })
    ).toMatchObject({ kind: 'send', amount: '1.23456', symbol: 'CUSTOM' })

    expect(() => parseTxReadyEnvelope(envelope)).toThrow(/token decimals unavailable/)
  })

  it('parses a THORChain swap deposit into canonical vault.swap args', () => {
    const parsed = parseTxReadyEnvelope({
      chain: 'THORChain',
      txArgs: {
        chain: 'THORChain',
        tx_encoding: 'cosmos-msg',
        msg_type: 'deposit',
        amount: '1000000',
        memo: '=:BTC.BTC:bc1qrecipient::v0:50',
      },
    })

    expect(parsed).toMatchObject({
      kind: 'thor-swap-deposit',
      chain: Chain.THORChain,
      fromSymbol: 'RUNE',
      toChain: Chain.Bitcoin,
      toSymbol: 'BTC',
      amountBaseUnits: '1000000',
      recipient: 'bc1qrecipient',
    })
  })

  it('parses a MayaChain LP deposit without changing base units or memo', () => {
    const parsed = parseTxReadyEnvelope({
      chain: 'MayaChain',
      txArgs: {
        chain: 'MayaChain',
        tx_encoding: 'cosmos-msg',
        msg_type: 'deposit',
        amount: '10000000000',
        memo: '+:BTC.BTC:bc1qpaired',
      },
    })

    expect(parsed).toMatchObject({
      kind: 'thor-lp-deposit',
      chain: Chain.MayaChain,
      amountBaseUnits: '10000000000',
      memo: '+:BTC.BTC:bc1qpaired',
    })
  })

  it('rejects parent/inner chain drift', () => {
    expect(() =>
      parseTxReadyEnvelope({
        chain: 'THORChain',
        txArgs: { chain: 'Bitcoin', to: 'bc1qrecipient', amount: '1000' },
      })
    ).toThrow(/disagrees/)
  })

  it('rejects self-conflicting chain names and IDs', () => {
    expect(() =>
      parseTxReadyEnvelope({
        chain: 'Base',
        chain_id: 1,
        tx: EVM_TX,
      })
    ).toThrow(/chain references disagree/)
  })

  it('rejects raw transaction chainId drift from envelope metadata', () => {
    expect(() =>
      parseTxReadyEnvelope({
        chain: 'Base',
        tx: { ...EVM_TX, chainId: 1 },
      })
    ).toThrow(/disagrees with transaction chainId/)
  })

  it('rejects nested approval transaction chainId drift in a multi-leg envelope', () => {
    expect(() =>
      parseTxReadyEnvelope({
        chain: 'Base',
        approvalTxArgs: { chain: 'Base', chain_id: 8453, tx: { ...EVM_TX, chainId: 1 } },
        txArgs: { chain: 'Base', chain_id: 8453, tx: { ...EVM_TX, chainId: 8453 } },
      })
    ).toThrow(/multi-leg transaction chain mismatch/)
  })

  it('rejects a multi-leg envelope whose approval transaction is not signable', () => {
    expect(() =>
      parseTxReadyEnvelope({
        chain: 'Base',
        approvalTxArgs: { chain: 'Base', chain_id: 8453, tx: { value: '0', data: '0x' } },
        txArgs: { chain: 'Base', chain_id: 8453, tx: { ...EVM_TX, chainId: 8453 } },
      })
    ).toThrow(/approval transaction is missing required 'to' field/)
  })

  it('rejects an unrecognized provided chain reference instead of falling back', () => {
    try {
      parseTxReadyEnvelope({
        chain: 'Bitcoin',
        chain_id: 'not-a-chain',
        txArgs: { to: 'bc1qrecipient', amount: '1000' },
      })
      expect.fail('expected parse failure')
    } catch (error) {
      expect(error).toBeInstanceOf(TxReadyParseError)
      expect((error as TxReadyParseError).code).toBe('UNKNOWN_CHAIN')
    }
  })

  it('rejects unsupported MsgDeposit memo families with a typed error', () => {
    try {
      parseTxReadyEnvelope({
        chain: 'THORChain',
        txArgs: { chain: 'THORChain', msg_type: 'deposit', amount: '1', memo: 'BOND:thornode1' },
      })
      expect.fail('expected parse failure')
    } catch (error) {
      expect(error).toBeInstanceOf(TxReadyParseError)
      expect((error as TxReadyParseError).code).toBe('UNSUPPORTED_DEPOSIT')
    }
  })

  it('rejects an oversized base-unit amount', () => {
    expect(() =>
      parseTxReadyEnvelope({
        chain: 'Bitcoin',
        txArgs: { chain: 'Bitcoin', to: 'bc1qrecipient', amount: '1'.padEnd(27, '0') },
      })
    ).toThrow(/exceeds 26-digit safety bound/)
  })

  it.each(['-1', '1e3', '0x10', ' 1'])('rejects non-decimal base-unit amount %j', amount => {
    expect(() =>
      parseTxReadyEnvelope({
        chain: 'Bitcoin',
        txArgs: { chain: 'Bitcoin', to: 'bc1qrecipient', amount },
      })
    ).toThrow(/unsigned base-10 integer string/)
  })

  it('supports an explicit consumer fallback for legacy chainless envelopes', () => {
    const parsed = parseTxReadyEnvelope({ tx: EVM_TX }, { defaultChain: Chain.Ethereum })
    expect(parsed.kind).toBe('raw-evm')
    expect(parsed.chain).toBe(Chain.Ethereum)
  })
})
