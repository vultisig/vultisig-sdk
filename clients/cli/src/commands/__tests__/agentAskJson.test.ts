// `agent ask --json` output-contract tests (vultisig-sdk fix-06).
//
// Asserts the stable v1 envelope on stdout for both success and error, that
// IDs (conversation_id + per-tool-call id) are carried, and that a backend/
// stream `error` frame makes the command exit non-zero instead of reporting
// false success.
//
// The (real) AskInterface is exercised end-to-end; only AgentSession is mocked
// so a test can drive the callbacks deterministically without a vault/network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentErrorCode } from '../../agent/agentErrors'
import type { UICallbacks } from '../../agent/types'
import { resetOutput } from '../../lib/output'

// Mutable driver shared with the hoisted AgentSession mock below.
const driver = vi.hoisted(() => ({
  run: null as null | ((cb: UICallbacks) => void | Promise<void>),
  conversationId: 'conv-abc',
}))

vi.mock('../../agent', async importOriginal => {
  const actual = await importOriginal<typeof import('../../agent')>()
  class FakeSession {
    async initialize(): Promise<void> {}
    getVaultAddresses(): Record<string, string> {
      return {}
    }
    getConversationId(): string {
      return driver.conversationId
    }
    async sendMessage(_message: string, callbacks: UICallbacks): Promise<void> {
      if (driver.run) await driver.run(callbacks)
    }
  }
  return { ...actual, AgentSession: FakeSession }
})

// Imported after the mock declaration; vitest hoists vi.mock so the command's
// `import { AgentSession } from '../agent'` resolves to FakeSession.
import { executeAgentAsk } from '../agent'

class ExitError extends Error {
  constructor(public exitCode: number) {
    super(`process.exit(${exitCode})`)
  }
}

describe('agent ask --json output contract', () => {
  let stdout: string[]
  let stderr: string[]
  const fakeVault = { name: 'test-vault', publicKeys: { ecdsa: 'pk-ecdsa', eddsa: 'pk-eddsa' } }
  const ctx = { sdk: {}, ensureActiveVault: vi.fn(async () => fakeVault) } as never

  beforeEach(() => {
    stdout = []
    stderr = []
    driver.run = null
    driver.conversationId = 'conv-abc'
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new ExitError(code ?? 0)
    }) as never)
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
      stdout.push(String(chunk))
      return true
    }) as never)
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
      stderr.push(String(chunk))
      return true
    }) as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    resetOutput()
  })

  async function runAsk(): Promise<{ exitCode: number }> {
    try {
      await executeAgentAsk(ctx, 'hello', { json: true })
      return { exitCode: 0 }
    } catch (e) {
      if (e instanceof ExitError) return { exitCode: e.exitCode }
      throw e
    }
  }

  it('success → v1 envelope on stdout with conversation/tool IDs; envelope not on stderr; exit 0', async () => {
    driver.run = cb => {
      cb.onToolResult('tool-call-1', 'vault_balance', true, { amount: '1.0' })
      cb.onAssistantMessage('You have 1.0 ETH')
    }

    const { exitCode } = await runAsk()
    expect(exitCode).toBe(0)

    const envelope = JSON.parse(stdout.join(''))
    expect(envelope.success).toBe(true)
    expect(envelope.v).toBe(1)
    expect(envelope.data.conversation_id).toBe('conv-abc')
    expect(envelope.data.session_id).toBe('conv-abc')
    expect(envelope.data.response).toBe('You have 1.0 ETH')
    expect(envelope.data.tool_calls[0].id).toBe('tool-call-1')
    expect(envelope.data.tool_calls[0].action).toBe('vault_balance')

    // The structured envelope must NOT leak onto stderr (the wrong-stream bug).
    expect(stderr.join('')).not.toContain('"success"')
  })

  it('SSE/backend error frame → error envelope on stdout with conversation_id; exit non-zero', async () => {
    driver.run = cb => {
      cb.onError('backend stream failed', AgentErrorCode.TRANSACTION_FAILED)
    }

    const { exitCode } = await runAsk()
    expect(exitCode).not.toBe(0)

    const envelope = JSON.parse(stdout.join(''))
    expect(envelope.success).toBe(false)
    expect(envelope.v).toBe(1)
    expect(envelope.error.message).toContain('backend stream failed')
    expect(envelope.error.code).toBe(AgentErrorCode.TRANSACTION_FAILED)
    expect(envelope.error.conversation_id).toBe('conv-abc')
  })

  it('broadcast THEN SSE error → exit non-zero AND error envelope still carries the tx hash', async () => {
    // A turn that broadcasts a tx (onTxStatus) and then hits a mid-stream backend
    // `error` frame (onError) must NOT lose the hash: exit-1 is correct, but a
    // headless caller still needs the identifier to track/recover the moved funds.
    // Regression guard for the error envelope dropping result.transactions (F1).
    driver.run = cb => {
      cb.onToolResult('tool-call-1', 'execute_send', true, { to: '0xrecipient' })
      cb.onTxStatus('0xdeadbeef', 'ethereum', 'broadcast', 'https://etherscan.io/tx/0xdeadbeef')
      cb.onError('confirmation indexer failed after broadcast', AgentErrorCode.TRANSACTION_FAILED)
    }

    const { exitCode } = await runAsk()
    // Exit non-zero: the turn ended in an error frame.
    expect(exitCode).not.toBe(0)

    const envelope = JSON.parse(stdout.join(''))
    expect(envelope.success).toBe(false)
    expect(envelope.v).toBe(1)
    expect(envelope.error.code).toBe(AgentErrorCode.TRANSACTION_FAILED)
    expect(envelope.error.conversation_id).toBe('conv-abc')

    // The broadcast tx record survives into the error envelope's data block.
    expect(envelope.data).toBeDefined()
    expect(envelope.data.transactions).toHaveLength(1)
    expect(envelope.data.transactions[0].hash).toBe('0xdeadbeef')
    expect(envelope.data.transactions[0].chain).toBe('ethereum')
    expect(envelope.data.transactions[0].status).toBe('broadcast')
    expect(envelope.data.transactions[0].explorerUrl).toBe('https://etherscan.io/tx/0xdeadbeef')
    // The partial tool_calls are carried too, for correlation/de-dup.
    expect(envelope.data.tool_calls[0].id).toBe('tool-call-1')
  })

  it('broadcast THEN thrown follow-up failure → exit non-zero AND error envelope still carries the tx hash (catch path)', async () => {
    // A successful sign always triggers a recursive follow-up request to report
    // recent_actions; an HTTP/timeout/5xx failure there REJECTS sendMessage, so
    // ask() throws instead of returning. The catch path must still recover the
    // already-broadcast hash from the partial turn — otherwise exit-1 strands the
    // funds with no identifier. Regression guard for the thrown-after-broadcast
    // path (the SSE-error-frame path is covered by the test above).
    driver.run = cb => {
      cb.onToolResult('tool-call-1', 'execute_send', true, { to: '0xrecipient' })
      cb.onTxStatus('0xcafef00d', 'ethereum', 'broadcast', 'https://etherscan.io/tx/0xcafef00d')
      throw new Error('backend 503 reporting recent_actions after broadcast')
    }

    const { exitCode } = await runAsk()
    expect(exitCode).not.toBe(0)

    const envelope = JSON.parse(stdout.join(''))
    expect(envelope.success).toBe(false)
    expect(envelope.v).toBe(1)
    // conversation_id recovered from the session even though ask() threw.
    expect(envelope.error.conversation_id).toBe('conv-abc')
    // The broadcast tx survives into the error envelope's data block.
    expect(envelope.data.transactions).toHaveLength(1)
    expect(envelope.data.transactions[0].hash).toBe('0xcafef00d')
    expect(envelope.data.transactions[0].status).toBe('broadcast')
    expect(envelope.data.tool_calls[0].id).toBe('tool-call-1')
  })
})
