import { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentErrorCode } from '../agentErrors'
import { PipeInterface } from '../pipe'
import type { AgentSession } from '../session'
import type { PipeInputCommand, PipeOutputEvent, UICallbacks } from '../types'

const { createInterfaceMock } = vi.hoisted(() => ({
  createInterfaceMock: vi.fn(),
}))

vi.mock('node:readline', () => ({
  createInterface: createInterfaceMock,
}))

class FakeReadline extends EventEmitter {
  private closed = false

  close(): void {
    if (this.closed) return
    this.closed = true
    this.emit('close')
  }
}

type FakeSession = Pick<AgentSession, 'dispose' | 'getConversationId' | 'getHistoryMessages' | 'sendMessage'>

const withTimeout = async <T>(promise: Promise<T>, timeoutMs = 1_000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const waitUntil = async (predicate: () => boolean, timeoutMs = 500): Promise<void> => {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) throw new Error(`Condition not met after ${timeoutMs}ms`)
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

describe('PipeInterface NDJSON input loop', () => {
  let rl: FakeReadline
  let events: PipeOutputEvent[]
  let pipes: PipeInterface[]
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>
  let stdinPauseSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    rl = new FakeReadline()
    events = []
    pipes = []
    createInterfaceMock.mockReturnValue(rl)
    stdinPauseSpy = vi.spyOn(process.stdin, 'pause').mockImplementation(() => process.stdin)
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      events.push(JSON.parse(chunk.toString().trim()) as PipeOutputEvent)
      return true
    }) as typeof process.stdout.write)
  })

  afterEach(() => {
    for (const pipe of pipes) pipe.stop()
    stdoutWriteSpy.mockRestore()
    stdinPauseSpy.mockRestore()
    createInterfaceMock.mockReset()
  })

  const startPipe = (sendMessage: FakeSession['sendMessage']) => {
    const session: FakeSession = {
      dispose: vi.fn(),
      getConversationId: vi.fn(() => 'conversation-1'),
      getHistoryMessages: vi.fn(() => []),
      sendMessage,
    }
    const pipe = new PipeInterface(session as AgentSession)
    pipes.push(pipe)
    return { pipe, started: pipe.start('Test Vault', { Ethereum: '0x123' }) }
  }

  const send = (cmd: PipeInputCommand): void => {
    rl.emit('line', JSON.stringify(cmd))
  }

  const sendRaw = (line: string): void => {
    rl.emit('line', line)
  }

  it('routes confirm(true) to a message awaiting confirmation and completes the turn', async () => {
    const sendMessage = vi.fn(async (_content: string, ui: UICallbacks) => {
      ui.onToolCall('sign-1', 'sign_tx')
      const confirmed = await ui.requestConfirmation('Sign transaction?')
      if (confirmed) {
        ui.onToolResult('sign-1', 'sign_tx', true, { txHash: '0xabc' })
        ui.onDone()
      }
    })
    const { started } = startPipe(sendMessage)

    send({ type: 'message', content: 'send funds' })
    await waitUntil(() =>
      events.some(event => event.type === 'error' && event.code === AgentErrorCode.CONFIRMATION_REQUIRED)
    )
    send({ type: 'confirm', confirmed: true })
    rl.close()

    await withTimeout(started)
    const confirmationIndex = events.findIndex(
      event => event.type === 'error' && event.code === AgentErrorCode.CONFIRMATION_REQUIRED
    )
    const resultIndex = events.findIndex(event => event.type === 'tool_result' && event.success)
    const doneIndex = events.findIndex(event => event.type === 'done')
    expect(confirmationIndex).toBeGreaterThan(-1)
    expect(resultIndex).toBeGreaterThan(confirmationIndex)
    expect(doneIndex).toBeGreaterThan(resultIndex)
  })

  it('routes confirm(false), emits the declined outcome, and processes the next message', async () => {
    const calls: string[] = []
    const sendMessage = vi.fn(async (content: string, ui: UICallbacks) => {
      calls.push(content)
      if (content === 'first') {
        const confirmed = await ui.requestConfirmation('Sign transaction?')
        if (!confirmed) {
          ui.onToolResult(
            'sign-1',
            'sign_tx',
            false,
            undefined,
            'Transaction declined',
            AgentErrorCode.CONFIRMATION_REQUIRED
          )
          ui.onDone()
        }
        return
      }
      ui.onAssistantMessage('second handled')
      ui.onDone()
    })
    const { started } = startPipe(sendMessage)

    send({ type: 'message', content: 'first' })
    await waitUntil(() =>
      events.some(event => event.type === 'error' && event.code === AgentErrorCode.CONFIRMATION_REQUIRED)
    )
    send({ type: 'message', content: 'second' })
    send({ type: 'confirm', confirmed: false })
    rl.close()

    await withTimeout(started)
    expect(calls).toEqual(['first', 'second'])
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'tool_result',
        action: 'sign_tx',
        success: false,
        error: 'Transaction declined',
        code: AgentErrorCode.CONFIRMATION_REQUIRED,
      })
    )
    expect(events).toContainEqual({ type: 'assistant', content: 'second handled' })
  })

  it('rejects non-boolean confirmations without consuming the pending prompt', async () => {
    let authorized = false
    const sendMessage = vi.fn(async (_content: string, ui: UICallbacks) => {
      const confirmed = await ui.requestConfirmation('Sign transaction?')
      authorized = confirmed
      ui.onDone()
    })
    const { started } = startPipe(sendMessage)

    send({ type: 'message', content: 'send funds' })
    await waitUntil(() =>
      events.some(event => event.type === 'error' && event.code === AgentErrorCode.CONFIRMATION_REQUIRED)
    )

    const invalidReplies = [
      '{"type":"confirm","confirmed":"false"}',
      '{"type":"confirm","confirmed":1}',
      '{"type":"confirm","confirmed":{}}',
      '{"type":"confirm"}',
    ]
    for (const [index, reply] of invalidReplies.entries()) {
      sendRaw(reply)
      await waitUntil(
        () =>
          events.filter(event => event.type === 'error' && event.code === AgentErrorCode.INVALID_INPUT).length ===
          index + 1
      )
      expect(authorized).toBe(false)
    }

    send({ type: 'confirm', confirmed: true })
    rl.close()

    await withTimeout(started)
    expect(authorized).toBe(true)
    expect(events).toContainEqual({ type: 'done' })
  })

  it('emits an error for confirm with no pending prompt and remains responsive', async () => {
    const sendMessage = vi.fn(async (_content: string, ui: UICallbacks) => {
      ui.onAssistantMessage('still responsive')
      ui.onDone()
    })
    const { started } = startPipe(sendMessage)

    send({ type: 'confirm', confirmed: true })
    send({ type: 'message', content: 'ping' })
    rl.close()

    await withTimeout(started)
    expect(sendMessage).toHaveBeenCalledOnce()
    expect(events).toContainEqual({
      type: 'error',
      message: 'Invalid input: No pending confirmation for this reply',
      code: AgentErrorCode.INVALID_INPUT,
    })
    expect(events).toContainEqual({ type: 'assistant', content: 'still responsive' })
  })

  it('denies an early confirmation before an asynchronously registered prompt', async () => {
    let authorized = false
    const sendMessage = vi.fn(async (_content: string, ui: UICallbacks) => {
      await new Promise(resolve => setTimeout(resolve, 10))
      authorized = await ui.requestConfirmation('Sign transaction?')
      ui.onDone()
    })
    const { started } = startPipe(sendMessage)

    send({ type: 'message', content: 'send funds' })
    send({ type: 'confirm', confirmed: true })

    await waitUntil(() =>
      events.some(
        event =>
          event.type === 'error' &&
          event.code === AgentErrorCode.INVALID_INPUT &&
          event.message.includes('No pending confirmation')
      )
    )
    await waitUntil(() =>
      events.some(event => event.type === 'error' && event.code === AgentErrorCode.CONFIRMATION_REQUIRED)
    )
    expect(authorized).toBe(false)

    send({ type: 'confirm', confirmed: true })
    rl.close()

    await withTimeout(started)
    expect(authorized).toBe(true)
  })

  it('reports malformed control-looking input promptly while a confirmation remains pending', async () => {
    let authorized = false
    const sendMessage = vi.fn(async (_content: string, ui: UICallbacks) => {
      authorized = await ui.requestConfirmation('Sign transaction?')
      ui.onDone()
    })
    const { started } = startPipe(sendMessage)

    send({ type: 'message', content: 'send funds' })
    await waitUntil(() =>
      events.some(event => event.type === 'error' && event.code === AgentErrorCode.CONFIRMATION_REQUIRED)
    )
    sendRaw('{"type":"confirm","confirmed":tru}')

    await waitUntil(() => events.some(event => event.type === 'error' && event.code === AgentErrorCode.INVALID_INPUT))
    expect(authorized).toBe(false)

    send({ type: 'confirm', confirmed: true })
    rl.close()

    await withTimeout(started)
    expect(authorized).toBe(true)
  })

  it('parses each ordinary input line only once before queueing it', async () => {
    const sendMessage = vi.fn(async (_content: string, ui: UICallbacks) => {
      ui.onDone()
    })
    const { started } = startPipe(sendMessage)
    const line = '{"type":"message","content":"ping"}'
    const parseSpy = vi.spyOn(JSON, 'parse')

    sendRaw(line)
    rl.close()

    await withTimeout(started)
    expect(parseSpy.mock.calls.filter(([input]) => input === line)).toHaveLength(1)
    parseSpy.mockRestore()
  })

  it('settles a pending confirmation as declined when stdin closes', async () => {
    const sendMessage = vi.fn(async (_content: string, ui: UICallbacks) => {
      const confirmed = await ui.requestConfirmation('Sign transaction?')
      if (!confirmed) {
        ui.onToolResult(
          'sign-1',
          'sign_tx',
          false,
          undefined,
          'Transaction declined',
          AgentErrorCode.CONFIRMATION_REQUIRED
        )
        ui.onDone()
      }
    })
    const { started } = startPipe(sendMessage)

    send({ type: 'message', content: 'send funds' })
    await waitUntil(() =>
      events.some(event => event.type === 'error' && event.code === AgentErrorCode.CONFIRMATION_REQUIRED)
    )
    rl.close()

    await withTimeout(started)
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'tool_result',
        action: 'sign_tx',
        success: false,
        error: 'Transaction declined',
      })
    )
    expect(events).toContainEqual({ type: 'done' })
  })

  it('routes password replies to a message awaiting a password', async () => {
    const sendMessage = vi.fn(async (_content: string, ui: UICallbacks) => {
      const password = await ui.requestPassword()
      ui.onAssistantMessage(`received ${password.length} characters`)
      ui.onDone()
    })
    const { started } = startPipe(sendMessage)

    send({ type: 'message', content: 'unlock vault' })
    await waitUntil(() =>
      events.some(event => event.type === 'error' && event.code === AgentErrorCode.PASSWORD_REQUIRED)
    )
    send({ type: 'password', password: 'secret' })
    rl.close()

    await withTimeout(started)
    expect(events).toContainEqual({ type: 'assistant', content: 'received 6 characters' })
  })

  it('rejects a non-string password without echoing it or consuming the pending prompt', async () => {
    const sendMessage = vi.fn(async (_content: string, ui: UICallbacks) => {
      const password = await ui.requestPassword()
      ui.onAssistantMessage(`received ${password.length} characters`)
      ui.onDone()
    })
    const { started } = startPipe(sendMessage)

    send({ type: 'message', content: 'unlock vault' })
    await waitUntil(() =>
      events.some(event => event.type === 'error' && event.code === AgentErrorCode.PASSWORD_REQUIRED)
    )
    sendRaw('{"type":"password","password":{"secret":"do-not-echo"}}')

    await waitUntil(() => events.some(event => event.type === 'error' && event.code === AgentErrorCode.INVALID_INPUT))
    expect(JSON.stringify(events)).not.toContain('do-not-echo')

    send({ type: 'password', password: 'secret' })
    rl.close()

    await withTimeout(started)
    expect(events).toContainEqual({ type: 'assistant', content: 'received 6 characters' })
  })

  it('does not echo malformed password input and leaves the pending prompt answerable', async () => {
    const sendMessage = vi.fn(async (_content: string, ui: UICallbacks) => {
      const password = await ui.requestPassword()
      ui.onAssistantMessage(`received ${password.length} characters`)
      ui.onDone()
    })
    const { started } = startPipe(sendMessage)

    send({ type: 'message', content: 'unlock vault' })
    await waitUntil(() =>
      events.some(event => event.type === 'error' && event.code === AgentErrorCode.PASSWORD_REQUIRED)
    )
    sendRaw('{"type":"password","password":do-not-echo}')

    await waitUntil(() => events.some(event => event.type === 'error' && event.code === AgentErrorCode.INVALID_INPUT))
    expect(JSON.stringify(events)).not.toContain('do-not-echo')

    send({ type: 'password', password: 'secret' })
    rl.close()

    await withTimeout(started)
    expect(events).toContainEqual({ type: 'assistant', content: 'received 6 characters' })
  })

  it('rejects a pending password request cleanly when stdin closes', async () => {
    const sendMessage = vi.fn(async (_content: string, ui: UICallbacks) => {
      await ui.requestPassword()
    })
    const { started } = startPipe(sendMessage)

    send({ type: 'message', content: 'unlock vault' })
    await waitUntil(() =>
      events.some(event => event.type === 'error' && event.code === AgentErrorCode.PASSWORD_REQUIRED)
    )
    rl.close()

    await withTimeout(started)
    expect(events).toContainEqual({
      type: 'error',
      message: 'Password input closed before a reply was received',
      code: AgentErrorCode.PASSWORD_REQUIRED,
    })
    expect(events).toContainEqual({ type: 'done' })
  })

  it('clears an armed confirmation when the turn fails', async () => {
    let confirmation: Promise<boolean> | undefined
    const sendMessage = vi.fn(async (_content: string, ui: UICallbacks) => {
      confirmation = ui.requestConfirmation('Sign transaction?')
      throw new Error('stream failed')
    })
    const { started } = startPipe(sendMessage)

    send({ type: 'message', content: 'send funds' })
    await waitUntil(() => events.some(event => event.type === 'error' && event.message === 'stream failed'))
    send({ type: 'confirm', confirmed: true })
    await expect(confirmation).resolves.toBe(false)
    rl.close()

    await withTimeout(started)
    expect(events).toContainEqual({
      type: 'error',
      message: 'Invalid input: No pending confirmation for this reply',
      code: AgentErrorCode.INVALID_INPUT,
    })
  })

  it('clears an armed password request when the turn fails', async () => {
    let password: Promise<string> | undefined
    const sendMessage = vi.fn(async (_content: string, ui: UICallbacks) => {
      password = ui.requestPassword()
      throw new Error('stream failed')
    })
    const { started } = startPipe(sendMessage)

    send({ type: 'message', content: 'unlock vault' })
    await waitUntil(() => events.some(event => event.type === 'error' && event.message === 'stream failed'))
    send({ type: 'password', password: 'late-secret' })
    await expect(password).rejects.toMatchObject({
      message: 'Password request cancelled because the turn ended',
      code: AgentErrorCode.PASSWORD_REQUIRED,
    })
    rl.close()

    await withTimeout(started)
    expect(events).toContainEqual({
      type: 'error',
      message: 'Invalid input: No pending password request for this reply',
      code: AgentErrorCode.INVALID_INPUT,
    })
    expect(JSON.stringify(events)).not.toContain('late-secret')
  })

  it('keeps message handlers strictly ordered', async () => {
    let releaseFirst: (() => void) | undefined
    const firstBlocked = new Promise<void>(resolve => {
      releaseFirst = resolve
    })
    const calls: string[] = []
    const sendMessage = vi.fn(async (content: string, ui: UICallbacks) => {
      calls.push(content)
      if (content === 'first') await firstBlocked
      ui.onDone()
    })
    const { started } = startPipe(sendMessage)

    send({ type: 'message', content: 'first' })
    send({ type: 'message', content: 'second' })
    rl.close()
    await waitUntil(() => calls.length === 1)
    expect(calls).toEqual(['first'])
    releaseFirst?.()

    await withTimeout(started)
    expect(calls).toEqual(['first', 'second'])
  })
})
