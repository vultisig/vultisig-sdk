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
    expect(result.toolCalls[0]).toMatchObject({
      action: 'get_balances',
      success: true,
      data: { x: 1 },
    })
    expect(result.toolCalls[1]).toMatchObject({
      action: 'list_vaults',
      success: false,
      error: 'failed',
    })
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
      {
        hash: '0xhash1',
        chain: 'Ethereum',
        explorerUrl: 'https://explorer.example/1',
        status: 'pending',
      },
      {
        hash: '0xhash2',
        chain: 'Bitcoin',
        explorerUrl: undefined,
        status: 'pending',
      },
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
      {
        hash: '0xhash1',
        chain: 'Ethereum',
        explorerUrl: 'https://explorer.example/1',
        status: 'confirmed',
      },
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

  // Error-latching precedence (review #875 M1). SSE/stream `error` frames are
  // non-terminal — sendMessageStream can emit onError and keep parsing, and the
  // loop can recurse into later turns. So a transient earlier frame must not mask
  // the TERMINAL error that actually ended the turn (e.g. LOOP_DEPTH_EXCEEDED).
  it('lets a terminal LOOP_DEPTH_EXCEEDED override a prior NON-terminal error code', async () => {
    const session = {
      getConversationId: () => 'conv-1',
      sendMessage: vi.fn().mockImplementation(async (_message: string, ui: UICallbacks) => {
        // An earlier, non-terminal SSE error frame fires mid-turn...
        ui.onError('transient backend hiccup', AgentErrorCode.NETWORK_ERROR)
        // ...then the loop runs away and the depth cap truncates the turn.
        ui.onError('conversation truncated', AgentErrorCode.LOOP_DEPTH_EXCEEDED)
      }),
    } as unknown as AgentSession

    const ask = new AskInterface(session)
    const result = await ask.ask('go')

    // Red-then-green lock: the old `if (!this.error)` latch kept NETWORK_ERROR
    // (first wins) and the envelope named the wrong failure. The fix surfaces the
    // terminal depth-cap code so the headline claim ("ask surfaces loop truncation
    // as a typed depth-cap error") actually holds.
    expect(result.error?.code).toBe(AgentErrorCode.LOOP_DEPTH_EXCEEDED)
  })

  it('does NOT let a later non-terminal error overwrite an already-recorded terminal error', async () => {
    const session = {
      getConversationId: () => 'conv-1',
      sendMessage: vi.fn().mockImplementation(async (_message: string, ui: UICallbacks) => {
        ui.onError('conversation truncated', AgentErrorCode.LOOP_DEPTH_EXCEEDED)
        ui.onError('late hiccup', AgentErrorCode.NETWORK_ERROR)
      }),
    } as unknown as AgentSession

    const ask = new AskInterface(session)
    const result = await ask.ask('go')

    expect(result.error?.code).toBe(AgentErrorCode.LOOP_DEPTH_EXCEEDED)
  })

  it('keeps the FIRST non-terminal error when no terminal error follows (latch unchanged)', async () => {
    const session = {
      getConversationId: () => 'conv-1',
      sendMessage: vi.fn().mockImplementation(async (_message: string, ui: UICallbacks) => {
        ui.onError('first', AgentErrorCode.NETWORK_ERROR)
        ui.onError('second', AgentErrorCode.TIMEOUT)
      }),
    } as unknown as AgentSession

    const ask = new AskInterface(session)
    const result = await ask.ask('go')

    expect(result.error?.code).toBe(AgentErrorCode.NETWORK_ERROR)
  })
})
