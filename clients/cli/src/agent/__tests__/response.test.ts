import { describe, expect, it } from 'vitest'

import { resolveResponseText } from '../response'

describe('resolveResponseText', () => {
  it('prefers the final message content over partial streamed text', () => {
    expect(
      resolveResponseText({
        fullText: 'world',
        message: {
          id: 'm1',
          conversation_id: 'c1',
          role: 'assistant',
          content: 'Hello world',
          content_type: 'text',
          created_at: '2026-04-09T00:00:00Z',
        },
      })
    ).toBe('Hello world')
  })

  it('falls back to accumulated streamed text when no final message exists', () => {
    expect(
      resolveResponseText({
        fullText: 'Hello world',
        message: null,
      })
    ).toBe('Hello world')
  })
})
