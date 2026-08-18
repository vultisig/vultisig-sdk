import type { VaultBase } from '@vultisig/sdk'
import { Chain } from '@vultisig/sdk'
import { encodeFunctionData, erc20Abi, getAddress } from 'viem'
import { describe, expect, it } from 'vitest'

import { AgentExecutor } from '../executor'

const USDC_CONTRACT = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const UNKNOWN_CONTRACT = '0x1111111111111111111111111111111111111111'
const RECIPIENT = getAddress('0x742d35cc6634c0532925a3b844bc9e7595f42bec')
const NATIVE_RECIPIENT = '0x58c4000000000000000000000000000000005c35'

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

function encodeTransfer(recipient: `0x${string}`, amount: bigint): `0x${string}` {
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: 'transfer',
    args: [recipient, amount],
  })
}

describe('AgentExecutor ERC-20 consent amount summary', () => {
  it('known token: renders the decoded calldata amount, ignoring a lying resolved_amount label', () => {
    const executor = createExecutor()
    executor.storeServerTransaction({
      chain: 'Ethereum',
      txArgs: {
        chain: 'Ethereum',
        to: RECIPIENT,
        amount: '5000000',
        tx: { to: USDC_CONTRACT, value: '0', data: encodeTransfer(RECIPIENT, 5000000n) },
      },
      resolved: { labels: { resolved_amount: '0.5 USDC', recipient_echo: RECIPIENT } },
    })

    const summary = executor.getPendingSummary()!
    expect(summary).toContain(`send 5 USDC on Ethereum to ${RECIPIENT}`)
    expect(summary).not.toContain('0.5')
  })

  it('unknown token: renders base units with a decimals-unverified marker and never throws', () => {
    const executor = createExecutor()
    executor.storeServerTransaction({
      chain: 'Base',
      txArgs: {
        chain: 'Base',
        to: RECIPIENT,
        amount: '5000000',
        tx: { to: UNKNOWN_CONTRACT, value: '0', data: encodeTransfer(RECIPIENT, 5000000n) },
      },
      resolved: { labels: { resolved_amount: '0.5 USDC', recipient_echo: RECIPIENT } },
    })

    expect(() => executor.getPendingSummary()).not.toThrow()
    const summary = executor.getPendingSummary()!
    expect(summary).toContain(`5000000 base units of token ${UNKNOWN_CONTRACT} (decimals unverified)`)
    expect(summary).not.toContain('0.5 USDC')
  })

  it('agreement: known token with an honest label renders the decoded amount once, no error', () => {
    const executor = createExecutor()
    executor.storeServerTransaction({
      chain: 'Ethereum',
      txArgs: {
        chain: 'Ethereum',
        to: RECIPIENT,
        amount: '500000',
        tx: { to: USDC_CONTRACT, value: '0', data: encodeTransfer(RECIPIENT, 500000n) },
      },
      resolved: { labels: { resolved_amount: '0.5 USDC', recipient_echo: RECIPIENT } },
    })

    expect(() => executor.getPendingSummary()).not.toThrow()
    expect(executor.getPendingSummary()).toBe(
      `send 0.5 USDC on Ethereum to ${RECIPIENT} (token contract ${USDC_CONTRACT})`
    )
  })

  it('guards unchanged: native EVM and non-EVM sends retain their label-based summaries', () => {
    const nativeExecutor = createExecutor()
    nativeExecutor.storeServerTransaction({
      chain: 'Base',
      txArgs: {
        chain: 'Base',
        to: NATIVE_RECIPIENT,
        amount: '10000000000000000',
        tx: { to: NATIVE_RECIPIENT, value: '10000000000000000', data: '0x' },
      },
      resolved: { labels: { resolved_amount: '0.01 ETH', recipient_echo: NATIVE_RECIPIENT } },
    })
    expect(nativeExecutor.getPendingSummary()).toBe(`send 0.01 ETH on Base to ${NATIVE_RECIPIENT}`)

    const nonEvmExecutor = createExecutor()
    nonEvmExecutor.storeServerTransaction({
      chain: 'Bitcoin',
      txArgs: { chain: 'Bitcoin', to: 'bc1qrecipient', amount: '10000', memo: 'payment' },
      resolved: { labels: { resolved_amount: '0.0001 BTC', recipient_echo: 'bc1qrecipient' } },
    })
    expect(nonEvmExecutor.getPendingSummary()).toBe('send 0.0001 BTC on Bitcoin to bc1qrecipient')
  })
})
