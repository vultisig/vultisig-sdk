import { describe, expect, it, vi } from 'vitest'

import { AgentErrorCode } from '../agentErrors'
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

  it('onTxStatus accumulates transactions and records status', async () => {
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
      { hash: '0xhash1', chain: 'Ethereum', explorerUrl: 'https://explorer.example/1', status: 'pending' },
      { hash: '0xhash2', chain: 'Bitcoin', explorerUrl: undefined, status: 'pending' },
    ])
  })

  it('onTxStatus dedups by hash and updates status in place (pending → confirmed)', async () => {
    const session = {
      getConversationId: () => 'c1',
      sendMessage: vi.fn().mockImplementation(async (_message: string, ui: UICallbacks) => {
        ui.onTxStatus('0xhash1', 'Ethereum', 'pending', 'https://explorer.example/1')
        ui.onTxStatus('0xhash1', 'Ethereum', 'confirmed', 'https://explorer.example/1')
      }),
    } as unknown as AgentSession

    const ask = new AskInterface(session)
    const result = await ask.ask('send')

    expect(result.transactions).toEqual([
      { hash: '0xhash1', chain: 'Ethereum', explorerUrl: 'https://explorer.example/1', status: 'confirmed' },
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

  it('requestConfirmation defaults to DENY (no --yes) so a misrouted prompt cannot sign', async () => {
    const ask = createAsk() // autoApprove defaults to false
    const ui = ask.getCallbacks()
    await expect(ui.requestConfirmation('swap 0.01 USDC → ETH on Base')).resolves.toBe(false)
  })

  it('requestConfirmation returns true only when autoApprove (--yes) is set', async () => {
    const session = {
      getConversationId: () => 'conv-1',
      sendMessage: vi.fn(),
    } as unknown as AgentSession
    const ask = new AskInterface(session, false, true) // --yes
    const ui = ask.getCallbacks()
    await expect(ui.requestConfirmation('send 0.001 ETH on Base')).resolves.toBe(true)
  })

  it('requestPassword throws without --password', async () => {
    const ask = createAsk()
    const ui = ask.getCallbacks()
    await expect(ui.requestPassword()).rejects.toThrow(/password/i)
  })

  // initialize() runs getCallbacks() BEFORE the first ask(); a stale --session
  // fallback fires onError(SESSION_NOT_FOUND) there. These two cases pin the
  // priority ordering of that init-time signal vs. a real first-turn error.
  it('init-time SESSION_NOT_FOUND survives a CLEAN first turn (lowest-priority fallback)', async () => {
    const session = {
      getConversationId: () => 'conv-new',
      sendMessage: vi.fn().mockImplementation(async (_message: string, ui: UICallbacks) => {
        ui.onAssistantMessage('You have 1.0 ETH')
      }),
    } as unknown as AgentSession

    const ask = new AskInterface(session)
    // Simulate initialize() firing onError before the first ask().
    ask.getCallbacks().onError('stale session not found; started new', AgentErrorCode.SESSION_NOT_FOUND)

    const result = await ask.ask('hello')

    expect(result.error?.code).toBe(AgentErrorCode.SESSION_NOT_FOUND)
  })

  it('a REAL first-turn error overrides the init-time SESSION_NOT_FOUND', async () => {
    const session = {
      getConversationId: () => 'conv-new',
      sendMessage: vi.fn().mockImplementation(async (_message: string, ui: UICallbacks) => {
        ui.onError('backend stream failed', AgentErrorCode.TRANSACTION_FAILED)
      }),
    } as unknown as AgentSession

    const ask = new AskInterface(session)
    ask.getCallbacks().onError('stale session not found; started new', AgentErrorCode.SESSION_NOT_FOUND)

    const result = await ask.ask('hello')

    expect(result.error?.code).toBe(AgentErrorCode.TRANSACTION_FAILED)
    expect(result.error?.code).not.toBe(AgentErrorCode.SESSION_NOT_FOUND)
  })

  it('init-time signal does NOT carry into a LATER turn', async () => {
    const session = {
      getConversationId: () => 'conv-new',
      sendMessage: vi.fn().mockImplementation(async (_message: string, ui: UICallbacks) => {
        ui.onAssistantMessage('ok')
      }),
    } as unknown as AgentSession

    const ask = new AskInterface(session)
    ask.getCallbacks().onError('stale session not found; started new', AgentErrorCode.SESSION_NOT_FOUND)

    await ask.ask('first') // first turn carries the init signal
    const second = await ask.ask('second') // later turn must be clean

    expect(second.error).toBeUndefined()
  })
})
