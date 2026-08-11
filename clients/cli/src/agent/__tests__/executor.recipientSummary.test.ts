import type { VaultBase } from '@vultisig/sdk'
import { Chain } from '@vultisig/sdk'
import { encodeFunctionData, erc20Abi, getAddress } from 'viem'
import { describe, expect, it } from 'vitest'

import { AgentExecutor } from '../executor'

const TOKEN_CONTRACT = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174'
const RECIPIENT_A = '0x58c4000000000000000000000000000000005c35'
const RECIPIENT_B = getAddress('0x742d35cc6634c0532925a3b844bc9e7595f42bec')

function createExecutor(): AgentExecutor {
  const vault = {
    name: 'mock-vault',
    id: 'vault-mock-1',
    type: 'secure',
    chains: [Chain.Ethereum, Chain.Base],
    isEncrypted: false,
  } as unknown as VaultBase
  return new AgentExecutor(vault)
}

function encodeTransfer(recipient: `0x${string}`): `0x${string}` {
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: 'transfer',
    args: [recipient, 500000n],
  })
}

describe('AgentExecutor ERC-20 recipient consent summary', () => {
  it('rejects a send when txArgs.to diverges from the calldata recipient', () => {
    const executor = createExecutor()
    expect(
      executor.storeServerTransaction({
        chain: 'Base',
        txArgs: {
          chain: 'Base',
          to: RECIPIENT_A,
          amount: '500000',
          tx: { to: TOKEN_CONTRACT, value: '0', data: encodeTransfer(RECIPIENT_B) },
        },
        resolved: { labels: { resolved_amount: '0.5 USDC', recipient_echo: RECIPIENT_A } },
      })
    ).toBe(true)

    expect(() => executor.getPendingSummary()).toThrow(/recipient mismatch — refusing to sign/i)
    expect(executor.hasPendingTransaction()).toBe(false)
  })

  it('uses the calldata recipient once when producer and calldata agree case-insensitively', () => {
    const executor = createExecutor()
    const lowercaseRecipient = RECIPIENT_B.toLowerCase()
    executor.storeServerTransaction({
      chain: 'Base',
      txArgs: {
        chain: 'Base',
        to: lowercaseRecipient,
        amount: '500000',
        tx: { to: TOKEN_CONTRACT, value: '0', data: encodeTransfer(RECIPIENT_B) },
      },
      resolved: { labels: { resolved_amount: '0.5 USDC', recipient_echo: lowercaseRecipient } },
    })

    const summary = executor.getPendingSummary()!
    expect(summary).toBe(`send 0.5 USDC on Base to ${RECIPIENT_B} (token contract ${TOKEN_CONTRACT})`)
    expect(summary.match(new RegExp(RECIPIENT_B, 'gi'))).toHaveLength(1)
  })

  it('leaves an EVM native send with empty calldata unchanged', () => {
    const executor = createExecutor()
    executor.storeServerTransaction({
      chain: 'Base',
      txArgs: {
        chain: 'Base',
        to: RECIPIENT_A,
        amount: '10000000000000000',
        tx: { to: RECIPIENT_A, value: '10000000000000000', data: '0x' },
      },
      resolved: { labels: { resolved_amount: '0.01 ETH', recipient_echo: RECIPIENT_A } },
    })

    expect(executor.getPendingSummary()).toBe(`send 0.01 ETH on Base to ${RECIPIENT_A}`)
  })

  it('leaves a non-EVM envelope without a nested tx unchanged', () => {
    const executor = createExecutor()
    executor.storeServerTransaction({
      chain: 'Bitcoin',
      txArgs: { chain: 'Bitcoin', to: 'bc1qrecipient', amount: '10000', memo: 'payment' },
      resolved: { labels: { resolved_amount: '0.0001 BTC', recipient_echo: 'bc1qrecipient' } },
    })

    expect(executor.getPendingSummary()).toBe('send 0.0001 BTC on Bitcoin to bc1qrecipient')
  })

  it('falls back to txArgs.to for non-transfer contract calldata', () => {
    const executor = createExecutor()
    executor.storeServerTransaction({
      chain: 'Base',
      txArgs: {
        chain: 'Base',
        to: RECIPIENT_A,
        amount: '0',
        tx: { to: TOKEN_CONTRACT, value: '0', data: `0x095ea7b3${'0'.repeat(120)}` },
      },
      resolved: { labels: { resolved_amount: '0 USDC', recipient_echo: RECIPIENT_A } },
    })

    expect(executor.getPendingSummary()).toBe(
      `send 0 USDC on Base to ${RECIPIENT_A} (token contract ${TOKEN_CONTRACT})`
    )
  })
})
