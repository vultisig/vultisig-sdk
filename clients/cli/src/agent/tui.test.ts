import { afterEach, describe, expect, it, vi } from 'vitest'

import { ChatTUI } from './tui'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ChatTUI terminal assistant messages', () => {
  function captureTurn(deltas: string[], content: string) {
    const writes: string[] = []
    const logs: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation(chunk => {
      writes.push(String(chunk))
      return true
    })
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' ') + '\n')
    })

    const tui = Object.create(ChatTUI.prototype) as ChatTUI
    const callbacks = tui.getCallbacks()
    for (const delta of deltas) callbacks.onTextDelta?.(delta)
    callbacks.onAssistantMessage?.(content)

    return { logs, output: [...writes, ...logs].join(''), writes }
  }

  it('renders the authoritative refusal instead of replaced streamed prose', () => {
    const { output } = captureTurn(
      ['Here are your balances:\n', '- Cosmos: 42 ATOM\n'],
      "I can't complete that safely -- I could not verify the balances I was about to show. Retrying usually resolves this."
    )

    expect(output).toContain(
      "I can't complete that safely -- I could not verify the balances I was about to show. Retrying usually resolves this."
    )
    expect(output).not.toContain('Here are your balances')
    expect(output).not.toContain('42 ATOM')
  })

  it('renders matching terminal content exactly once', () => {
    const content = 'Your ETH balance is 1.5 ETH.'
    const { logs, output, writes } = captureTurn([content], content)

    expect(output.split(content)).toHaveLength(2)
    expect(writes).toHaveLength(2)
    expect(writes[1]).toBe(`${content}\n`)
    expect(logs).toEqual([])
  })

  it('falls back to streamed text when the terminal content is empty', () => {
    const buffered = 'Fallback streamed response.'
    const { writes } = captureTurn([buffered], '')

    expect(writes[1]).toBe(`${buffered}\n`)
  })
})
