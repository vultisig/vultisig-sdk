import { describe, expect, it, vi } from 'vitest'

import { AgentSession } from '../session'

function makeUi() {
  return {
    onTextDelta: vi.fn(),
    onToolCall: vi.fn(),
    onToolResult: vi.fn(),
    onAssistantMessage: vi.fn(),
    onSuggestions: vi.fn(),
    onTxStatus: vi.fn(),
    onError: vi.fn(),
    onDone: vi.fn(),
    requestPassword: vi.fn(async () => 'pw'),
    requestConfirmation: vi.fn(async () => true),
  }
}

describe('AgentSession turn idempotency key lifetime', () => {
  it('reuses one key for an auth re-POST but creates a new key for the next turn attempt', async () => {
    let call = 0
    const sendMessageStream = vi.fn(async () => {
      call++
      if (call === 1) throw new Error('Request failed (401): unauthorized')
      return {
        fullText: '',
        suggestions: [],
        message: null,
        finished: true,
        disconnected: false,
        serverNow: null,
      }
    })
    const fakeThis: any = {
      conversationId: 'conv-1',
      publicKey: 'pk',
      cachedContext: { addresses: {} },
      config: { askMode: true, verbose: false },
      pendingToolResults: [],
      abortController: null,
      client: { sendMessageStream },
      executor: { storeServerTransaction: vi.fn(() => false) },
      withAuthRetry: async (request: () => Promise<unknown>) => {
        try {
          return await request()
        } catch {
          return request()
        }
      },
      dispatchClientSideTool: vi.fn(),
      reportDeferredSignable: vi.fn(),
      selectAndBufferSignable: vi.fn(() => false),
      renderEchoedBalanceCard: vi.fn((text: string) => text),
    }

    await (AgentSession.prototype as any).processMessageLoop.call(fakeThis, 'first', makeUi(), 0)
    await (AgentSession.prototype as any).processMessageLoop.call(fakeThis, 'second', makeUi(), 0)

    const calls = sendMessageStream.mock.calls as unknown as Array<[unknown, unknown, unknown, unknown, string]>
    const firstPostKey = calls[0]?.[4]
    const authRetryKey = calls[1]?.[4]
    const nextAttemptKey = calls[2]?.[4]
    expect(firstPostKey).toMatch(/^[\x21-\x7e]{1,255}$/)
    expect(authRetryKey).toBe(firstPostKey)
    expect(nextAttemptKey).not.toBe(firstPostKey)
  })
})
