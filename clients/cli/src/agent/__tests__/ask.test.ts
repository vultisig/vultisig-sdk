import { describe, expect, it, vi } from 'vitest'

import { AskInterface } from '../ask'
import type { AgentSession } from '../session'
import type { UICallbacks } from '../types'

describe('AskInterface.getCallbacks', () => {
  function createAsk(): AskInterface {
    const session = {
      getConversationId: () => 'conv-1',
      sendMessage: vi.fn(),
    } as unknown as AgentSession
    return new AskInterface(session, false)
  }

  it('onToolResult accumulates tool calls for ask()', async () => {
    const session = {
      getConversationId: () => 'sess-99',
      sendMessage: vi.fn().mockImplementation(async (_message: string, ui: UICallbacks) => {
        ui.onToolResult('id-1', 'get_balances', true, { x: 1 })
        ui.onToolResult('id-2', 'list_vaults', false, undefined, 'failed')
      }),
    } as unknown as AgentSession

    const ask = new AskInterface(session)
    const result = await ask.ask('hello')

    expect(result.toolCalls).toHaveLength(2)
    expect(result.toolCalls[0]).toMatchObject({ action: 'get_balances', success: true, data: { x: 1 } })
    expect(result.toolCalls[1]).toMatchObject({ action: 'list_vaults', success: false, error: 'failed' })
  })

  it('onTxStatus accumulates transactions', async () => {
    const session = {
      getConversationId: () => 'c1',
      sendMessage: vi.fn().mockImplementation(async (_message: string, ui: UICallbacks) => {
        ui.onTxStatus('0xhash1', 'Ethereum', 'pending', 'https://explorer.example/1')
        ui.onTxStatus('0xhash2', 'Bitcoin', 'pending')
      }),
    } as unknown as AgentSession

    const ask = new AskInterface(session)
    const result = await ask.ask('send')

    expect(result.transactions).toEqual([
      { hash: '0xhash1', chain: 'Ethereum', explorerUrl: 'https://explorer.example/1' },
      { hash: '0xhash2', chain: 'Bitcoin', explorerUrl: undefined },
    ])
  })

  it('onAssistantMessage keeps the last non-empty response', async () => {
    const session = {
      getConversationId: () => 'c1',
      sendMessage: vi.fn().mockImplementation(async (_message: string, ui: UICallbacks) => {
        ui.onAssistantMessage('first draft')
        ui.onAssistantMessage('')
        ui.onAssistantMessage('final answer')
      }),
    } as unknown as AgentSession

    const ask = new AskInterface(session)
    const result = await ask.ask('q')

    expect(result.response).toBe('final answer')
  })

  it('requestConfirmation auto-returns true', async () => {
    const ask = createAsk()
    const ui = ask.getCallbacks()
    await expect(ui.requestConfirmation('Proceed?')).resolves.toBe(true)
  })

  it('requestPassword throws without --password', async () => {
    const ask = createAsk()
    const ui = ask.getCallbacks()
    await expect(ui.requestPassword()).rejects.toThrow(/password/i)
  })
})
