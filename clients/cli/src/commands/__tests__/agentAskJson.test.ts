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
import { ExitCode } from '../../core/errors'
import { resetOutput } from '../../lib/output'

// Mutable driver shared with the hoisted AgentSession mock below.
const driver = vi.hoisted(() => ({
  run: null as null | ((cb: UICallbacks) => void | Promise<void>),
  // initialize()-time driver: lets a test simulate initialize() firing a
  // callback (e.g. the stale --session → new-convo fallback's onError(
  // SESSION_NOT_FOUND)) BEFORE the first ask() runs.
  initRun: null as null | ((cb: UICallbacks) => void | Promise<void>),
  conversationId: 'conv-abc',
  // Drives FakeSession.hasUnacknowledgedBroadcast(): the F1 gate the ACK_FAILED
  // re-tag now consults. Default true so a throw-after-broadcast still exits 8;
  // a test flips it false to model a broadcast that WAS acked before a later
  // (unrelated) failure.
  unacknowledgedBroadcast: true,
}))

vi.mock('../../agent', async importOriginal => {
  const actual = await importOriginal<typeof import('../../agent')>()
  class FakeSession {
    async initialize(callbacks: UICallbacks): Promise<void> {
      if (driver.initRun) await driver.initRun(callbacks)
    }
    getVaultAddresses(): Record<string, string> {
      return {}
    }
    getConversationId(): string {
      return driver.conversationId
    }
    async sendMessage(_message: string, callbacks: UICallbacks): Promise<void> {
      if (driver.run) await driver.run(callbacks)
    }
    hasUnacknowledgedBroadcast(): boolean {
      return driver.unacknowledgedBroadcast
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
  const fakeVault = {
    name: 'test-vault',
    publicKeys: { ecdsa: 'pk-ecdsa', eddsa: 'pk-eddsa' },
  }
  const ctx = {
    sdk: {},
    ensureActiveVault: vi.fn(async () => fakeVault),
  } as never

  beforeEach(() => {
    stdout = []
    stderr = []
    driver.run = null
    driver.initRun = null
    driver.conversationId = 'conv-abc'
    driver.unacknowledgedBroadcast = true
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

  async function runAsk(json = true): Promise<{ exitCode: number }> {
    try {
      await executeAgentAsk(ctx, 'hello', { json })
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

  // a2a-02: the typed turn-outcome discriminator drives an ADDITIVE exit-code map
  // (success→0, blocked→10, refusal→11, frame-less error→1) and rides the top-level
  // `outcome` field of the JSON envelope so a headless caller never parses prose.
  it('turn_outcome=success → exit 0 + envelope.outcome', async () => {
    driver.run = cb => {
      cb.onAssistantMessage('Your balance is 1.0 ETH')
      cb.onTurnOutcome?.({ kind: 'success' })
    }
    const { exitCode } = await runAsk()
    expect(exitCode).toBe(ExitCode.SUCCESS)
    const envelope = JSON.parse(stdout.join(''))
    expect(envelope.success).toBe(true)
    expect(envelope.data.outcome).toEqual({ kind: 'success' })
  })

  it('turn_outcome=blocked → exit 10 (AGENT_TURN_BLOCKED) + outcome on the envelope', async () => {
    driver.run = cb => {
      cb.onAssistantMessage("I can't complete that safely — please try again.")
      cb.onTurnOutcome?.({ kind: 'blocked', code: 'broadcast-claim', detail: 'unverifiable broadcast' })
    }
    const { exitCode } = await runAsk()
    expect(exitCode).toBe(ExitCode.AGENT_TURN_BLOCKED)
    expect(exitCode).toBe(10)
    const envelope = JSON.parse(stdout.join(''))
    expect(envelope.success).toBe(false)
    expect(envelope.error.code).toBe(AgentErrorCode.AGENT_TURN_BLOCKED)
    expect(envelope.data.outcome).toMatchObject({ kind: 'blocked', code: 'broadcast-claim' })
  })

  it('broadcast + turn_outcome=blocked → BROADCAST_COMMITTED with transactions and outcome preserved', async () => {
    driver.run = cb => {
      cb.onToolResult('approval-call', 'execute_swap', true, { phase: 'approval' })
      cb.onTxStatus('0xapproval', 'ethereum', 'broadcast', 'https://etherscan.io/tx/0xapproval')
      cb.onAssistantMessage("I couldn't complete the swap. Please try again.")
      cb.onTurnOutcome?.({ kind: 'blocked', code: 'broadcast-claim', detail: 'unverifiable broadcast' })
    }

    const { exitCode } = await runAsk()
    expect(exitCode).toBe(ExitCode.BROADCAST_COMMITTED)
    expect(exitCode).toBe(13)

    const envelope = JSON.parse(stdout.join(''))
    expect(envelope.success).toBe(false)
    expect(envelope.error.code).toBe(AgentErrorCode.BROADCAST_COMMITTED)
    expect(envelope.data.outcome).toMatchObject({ kind: 'blocked', code: 'broadcast-claim' })
    expect(envelope.data.transactions).toEqual([
      {
        hash: '0xapproval',
        chain: 'ethereum',
        status: 'broadcast',
        explorerUrl: 'https://etherscan.io/tx/0xapproval',
      },
    ])
    // Approval was only one leg: the nonzero partial-success envelope must not
    // claim that the full swap completed.
    expect(envelope.data.tool_calls[0].data.phase).toBe('approval')
  })

  it('pending transaction + turn_outcome=error → BROADCAST_COMMITTED instead of generic retryable failure', async () => {
    driver.run = cb => {
      cb.onTxStatus('0xpending', 'polygon', 'pending', 'https://polygonscan.com/tx/0xpending')
      cb.onTurnOutcome?.({ kind: 'error', code: 'follow_up_failed' })
    }

    const { exitCode } = await runAsk()
    expect(exitCode).toBe(ExitCode.BROADCAST_COMMITTED)
    const envelope = JSON.parse(stdout.join(''))
    expect(envelope.error.code).toBe(AgentErrorCode.BROADCAST_COMMITTED)
    expect(envelope.data.transactions[0].status).toBe('pending')
    expect(envelope.data.outcome).toEqual({ kind: 'error', code: 'follow_up_failed' })
  })

  it('confirmation timeout + turn_outcome=error remains committed because the transaction may still confirm', async () => {
    driver.run = cb => {
      cb.onTxStatus('0xtimeout', 'polygon', 'timeout', 'https://polygonscan.com/tx/0xtimeout')
      cb.onTurnOutcome?.({ kind: 'error', code: 'confirmation_timeout' })
    }

    const { exitCode } = await runAsk()
    expect(exitCode).toBe(ExitCode.BROADCAST_COMMITTED)
    const envelope = JSON.parse(stdout.join(''))
    expect(envelope.error.code).toBe(AgentErrorCode.BROADCAST_COMMITTED)
    expect(envelope.data.transactions[0].status).toBe('timeout')
  })

  it('confirmed transaction + fabricated-tool-failure-style outcome stays partial, not false overall success', async () => {
    driver.run = cb => {
      cb.onTxStatus('0xconfirmed', 'polygon', 'confirmed', 'https://polygonscan.com/tx/0xconfirmed')
      cb.onAssistantMessage('No transaction was sent. Please try again.')
      cb.onTurnOutcome?.({ kind: 'blocked', code: 'fabricated_tool_failure' })
    }

    const { exitCode } = await runAsk()
    expect(exitCode).toBe(ExitCode.BROADCAST_COMMITTED)
    const envelope = JSON.parse(stdout.join(''))
    expect(envelope.success).toBe(false)
    expect(envelope.error.code).toBe(AgentErrorCode.BROADCAST_COMMITTED)
    expect(envelope.data.transactions[0].status).toBe('confirmed')
    expect(envelope.data.response).toContain('No transaction was sent')
    expect(envelope.data.outcome.code).toBe('fabricated_tool_failure')
  })

  it('turn_outcome=refusal → exit 11 (AGENT_TURN_REFUSAL)', async () => {
    driver.run = cb => {
      cb.onAssistantMessage('Which chain would you like to use?')
      cb.onTurnOutcome?.({ kind: 'refusal', code: 'clarify' })
    }
    const { exitCode } = await runAsk()
    expect(exitCode).toBe(ExitCode.AGENT_TURN_REFUSAL)
    expect(exitCode).toBe(11)
    const envelope = JSON.parse(stdout.join(''))
    expect(envelope.success).toBe(false)
    expect(envelope.error.code).toBe(AgentErrorCode.AGENT_TURN_REFUSAL)
  })

  it('broadcast + turn_outcome=refusal → BROADCAST_COMMITTED instead of the no-action-taken contract', async () => {
    driver.run = cb => {
      cb.onTxStatus('0xrefusal', 'base', 'confirmed', 'https://basescan.org/tx/0xrefusal')
      cb.onAssistantMessage('Which route would you like me to try next?')
      cb.onTurnOutcome?.({ kind: 'refusal', code: 'clarify_remaining_step' })
    }

    const { exitCode } = await runAsk()
    expect(exitCode).toBe(ExitCode.BROADCAST_COMMITTED)
    const envelope = JSON.parse(stdout.join(''))
    expect(envelope.success).toBe(false)
    expect(envelope.error.code).toBe(AgentErrorCode.BROADCAST_COMMITTED)
    expect(envelope.data.transactions[0].hash).toBe('0xrefusal')
    expect(envelope.data.outcome).toEqual({ kind: 'refusal', code: 'clarify_remaining_step' })
  })

  it('turn_outcome=error with no stream error frame → exit 1 (not a false 0)', async () => {
    driver.run = cb => {
      cb.onAssistantMessage('Sorry, I ran into a problem completing that.')
      cb.onTurnOutcome?.({ kind: 'error', code: 'no_output' })
    }
    const { exitCode } = await runAsk()
    expect(exitCode).toBe(ExitCode.USAGE)
    expect(exitCode).toBe(1)
    const envelope = JSON.parse(stdout.join(''))
    expect(envelope.success).toBe(false)
    expect(envelope.error.code).toBe(AgentErrorCode.AGENT_TURN_ERROR)
    expect(envelope.data.outcome.kind).toBe('error')
  })

  it('a stream error frame keeps its specific exit code; the outcome still rides the error envelope', async () => {
    driver.run = cb => {
      cb.onError('backend stream failed', AgentErrorCode.TRANSACTION_FAILED)
      cb.onTurnOutcome?.({ kind: 'error', code: 'stream_error' })
    }
    const { exitCode } = await runAsk()
    // The error-frame taxonomy wins (EXTERNAL_SERVICE=6), NOT the generic outcome=1.
    expect(exitCode).toBe(ExitCode.EXTERNAL_SERVICE)
    const envelope = JSON.parse(stdout.join(''))
    expect(envelope.success).toBe(false)
    // Same relative slot as the success envelope: data.outcome (not top-level).
    expect(envelope.data.outcome).toEqual({ kind: 'error', code: 'stream_error' })
  })

  it('no turn_outcome (older backend) → exit 0 unchanged', async () => {
    driver.run = cb => {
      cb.onAssistantMessage('legacy backend answer')
    }
    const { exitCode } = await runAsk()
    expect(exitCode).toBe(0)
    const envelope = JSON.parse(stdout.join(''))
    expect(envelope.data.outcome).toBeUndefined()
  })

  it('failed sign without turn_outcome → typed error envelope and non-zero exit', async () => {
    driver.run = cb => {
      cb.onToolResult(
        'sign-call',
        'sign_tx',
        false,
        { error: 'Password not provided', code: AgentErrorCode.PASSWORD_REQUIRED },
        'Password not provided',
        AgentErrorCode.PASSWORD_REQUIRED
      )
      cb.onAssistantMessage('The transaction was cancelled.')
    }

    const { exitCode } = await runAsk()
    expect(exitCode).toBe(ExitCode.AUTH_REQUIRED)
    const envelope = JSON.parse(stdout.join(''))
    expect(envelope.success).toBe(false)
    expect(envelope.error.code).toBe(AgentErrorCode.PASSWORD_REQUIRED)
    expect(envelope.data.transactions).toBeUndefined()
    expect(envelope.data.tool_calls[0]).toMatchObject({
      action: 'sign_tx',
      success: false,
      code: AgentErrorCode.PASSWORD_REQUIRED,
    })
  })

  // A failed leg AFTER one already landed must never exit on the failure's own
  // code: TRANSACTION_FAILED→6 and TIMEOUT→3 are documented retryable, so an
  // orchestrator honoring them would replay the request and re-broadcast the leg
  // that succeeded. 13 is the non-retryable partial slot (#1233).
  it('failed second sign leg after a committed broadcast → exit 13, not the leg error’s retryable code', async () => {
    driver.run = cb => {
      cb.onToolResult('sign-approve', 'sign_tx', true, { tx_hash: '0xapproved', chain: 'ethereum' })
      cb.onTxStatus('0xapproved', 'ethereum', 'pending', 'https://etherscan.io/tx/0xapproved')
      cb.onToolResult(
        'sign-swap',
        'sign_tx',
        false,
        { error: 'Failed to broadcast: node unavailable', code: AgentErrorCode.TRANSACTION_FAILED },
        'Failed to broadcast: node unavailable',
        AgentErrorCode.TRANSACTION_FAILED
      )
    }

    const { exitCode } = await runAsk()
    expect(exitCode).toBe(ExitCode.BROADCAST_COMMITTED)
    expect(exitCode).not.toBe(ExitCode.EXTERNAL_SERVICE)
    const envelope = JSON.parse(stdout.join(''))
    expect(envelope.success).toBe(false)
    expect(envelope.error.code).toBe(AgentErrorCode.BROADCAST_COMMITTED)
    // The landed hash and the original diagnostic both survive for recovery.
    expect(envelope.data.transactions[0].hash).toBe('0xapproved')
    expect(envelope.data.original_error.code).toBe(AgentErrorCode.TRANSACTION_FAILED)
  })

  // Same guard on an older backend that never emits turn_outcome — the absent
  // outcome must not let a committed broadcast bypass the 13 slot.
  it('failed sign after a committed broadcast with NO turn_outcome → still exit 13', async () => {
    driver.run = cb => {
      cb.onTxStatus('0xsent', 'ethereum', 'pending', 'https://etherscan.io/tx/0xsent')
      cb.onToolResult('sign-2', 'sign_tx', false, { error: 'receipt polling timed out' }, 'receipt polling timed out')
    }

    const { exitCode } = await runAsk()
    expect(exitCode).toBe(ExitCode.BROADCAST_COMMITTED)
    expect(exitCode).not.toBe(ExitCode.NETWORK)
    const envelope = JSON.parse(stdout.join(''))
    expect(envelope.error.code).toBe(AgentErrorCode.BROADCAST_COMMITTED)
    expect(envelope.data.transactions[0].hash).toBe('0xsent')
  })

  // The other direction of the lie: a failed sign that a later sign superseded.
  // The failed result is queued and recursed so the LLM can re-emit a corrected
  // tx (session.ts:704), so an earlier failure is not the turn's verdict.
  it('failed sign superseded by a later successful sign → exit 0, not a false failure', async () => {
    driver.run = cb => {
      cb.onToolResult(
        'sign-1',
        'sign_tx',
        false,
        { error: 'gas price too low', code: AgentErrorCode.TRANSACTION_FAILED },
        'gas price too low',
        AgentErrorCode.TRANSACTION_FAILED
      )
      cb.onToolResult('sign-2', 'sign_tx', true, { tx_hash: '0xretried', chain: 'ethereum' })
      cb.onTxStatus('0xretried', 'ethereum', 'confirmed', 'https://etherscan.io/tx/0xretried')
      cb.onTurnOutcome?.({ kind: 'success' })
      cb.onAssistantMessage('Sent 0.1 ETH.')
    }

    const { exitCode } = await runAsk()
    expect(exitCode).toBe(ExitCode.SUCCESS)
    const envelope = JSON.parse(stdout.join(''))
    expect(envelope.success).toBe(true)
    expect(envelope.data.transactions[0].hash).toBe('0xretried')
  })

  it('declined sign without turn_outcome → confirmation-required envelope and exit 12', async () => {
    driver.run = cb => {
      cb.onToolResult(
        'sign-call',
        'sign_tx',
        false,
        { error: 'Transaction not confirmed', code: AgentErrorCode.CONFIRMATION_REQUIRED },
        'Transaction not confirmed',
        AgentErrorCode.CONFIRMATION_REQUIRED
      )
    }

    const { exitCode } = await runAsk()
    expect(exitCode).toBe(ExitCode.CONFIRMATION_REQUIRED)
    const envelope = JSON.parse(stdout.join(''))
    expect(envelope.success).toBe(false)
    expect(envelope.error.code).toBe(AgentErrorCode.CONFIRMATION_REQUIRED)
  })

  it('failed sign human output is non-zero and error-shaped', async () => {
    driver.run = cb => {
      cb.onToolResult(
        'sign-call',
        'sign_typed_data',
        false,
        { error: 'Signing failed', code: AgentErrorCode.SIGNING_FAILED },
        'Signing failed',
        AgentErrorCode.SIGNING_FAILED
      )
    }

    const { exitCode } = await runAsk(false)
    expect(exitCode).toBe(ExitCode.UNKNOWN)
    expect(stdout.join('')).toBe('')
    expect(stderr.join('')).toContain('Signing failed')
    expect(stderr.join('')).toContain(`[${AgentErrorCode.SIGNING_FAILED}]`)
  })

  it('SSE/backend error frame → error envelope on stdout with conversation_id; exit non-zero', async () => {
    driver.run = cb => {
      cb.onError('backend stream failed', AgentErrorCode.TRANSACTION_FAILED)
    }

    const { exitCode } = await runAsk()
    // The backend/stream error code maps onto the ExitCode taxonomy (F3) rather
    // than a blanket 1 — TRANSACTION_FAILED → EXTERNAL_SERVICE (retryable).
    expect(exitCode).toBe(ExitCode.EXTERNAL_SERVICE)

    const envelope = JSON.parse(stdout.join(''))
    expect(envelope.success).toBe(false)
    expect(envelope.v).toBe(1)
    expect(envelope.error.message).toContain('backend stream failed')
    expect(envelope.error.code).toBe(AgentErrorCode.TRANSACTION_FAILED)
    expect(envelope.error.conversation_id).toBe('conv-abc')
  })

  it('broadcast THEN SSE error → BROADCAST_COMMITTED and preserves the original diagnostic', async () => {
    driver.run = cb => {
      cb.onToolResult('tool-call-1', 'execute_send', true, {
        to: '0xrecipient',
      })
      cb.onTxStatus('0xdeadbeef', 'ethereum', 'broadcast', 'https://etherscan.io/tx/0xdeadbeef')
      cb.onError('confirmation indexer failed after broadcast', AgentErrorCode.TRANSACTION_FAILED)
    }

    const { exitCode } = await runAsk()
    expect(exitCode).toBe(ExitCode.BROADCAST_COMMITTED)

    const envelope = JSON.parse(stdout.join(''))
    expect(envelope.success).toBe(false)
    expect(envelope.v).toBe(1)
    expect(envelope.error.code).toBe(AgentErrorCode.BROADCAST_COMMITTED)
    expect(envelope.error.conversation_id).toBe('conv-abc')
    expect(envelope.data.original_error).toEqual({
      message: 'confirmation indexer failed after broadcast',
      code: AgentErrorCode.TRANSACTION_FAILED,
    })
    expect(envelope.data.transactions).toHaveLength(1)
    expect(envelope.data.transactions[0]).toEqual({
      hash: '0xdeadbeef',
      chain: 'ethereum',
      status: 'broadcast',
      explorerUrl: 'https://etherscan.io/tx/0xdeadbeef',
    })
    expect(envelope.data.tool_calls[0].id).toBe('tool-call-1')
  })

  it('unacknowledged broadcast THEN thrown follow-up → preserves ACK_FAILED compatibility and original diagnostic', async () => {
    driver.run = cb => {
      cb.onToolResult('tool-call-1', 'execute_send', true, {
        to: '0xrecipient',
      })
      cb.onTxStatus('0xcafef00d', 'ethereum', 'broadcast', 'https://etherscan.io/tx/0xcafef00d')
      throw new Error('backend 503 reporting recent_actions after broadcast')
    }

    const { exitCode } = await runAsk()
    expect(exitCode).toBe(ExitCode.ACK_FAILED)

    const envelope = JSON.parse(stdout.join(''))
    expect(envelope.success).toBe(false)
    expect(envelope.v).toBe(1)
    expect(envelope.error.code).toBe(AgentErrorCode.ACK_FAILED)
    expect(envelope.error.conversation_id).toBe('conv-abc')
    expect(envelope.data.original_error).toEqual({
      message: 'backend 503 reporting recent_actions after broadcast',
      code: AgentErrorCode.UNKNOWN_ERROR,
    })
    expect(envelope.data.transactions).toHaveLength(1)
    expect(envelope.data.transactions[0].hash).toBe('0xcafef00d')
    expect(envelope.data.transactions[0].status).toBe('broadcast')
    expect(envelope.data.tool_calls[0].id).toBe('tool-call-1')
  })

  it('confirmed broadcast followed by a later thrown network failure remains non-retryable partial success', async () => {
    driver.unacknowledgedBroadcast = false
    driver.run = cb => {
      cb.onToolResult('tool-call-1', 'execute_send', true, { to: '0xrecipient' })
      cb.onTxStatus('0xacked', 'ethereum', 'confirmed', 'https://etherscan.io/tx/0xacked')
      throw new Error('fetch failed talking to backend')
    }

    const { exitCode } = await runAsk()
    expect(exitCode).toBe(ExitCode.BROADCAST_COMMITTED)

    const envelope = JSON.parse(stdout.join(''))
    expect(envelope.success).toBe(false)
    expect(envelope.error.code).toBe(AgentErrorCode.BROADCAST_COMMITTED)
    expect(envelope.data.original_error.code).toBe(AgentErrorCode.NETWORK_ERROR)
    expect(envelope.data.transactions[0].hash).toBe('0xacked')
  })

  it('failed-only transaction set retains the original failure classification', async () => {
    driver.run = cb => {
      cb.onTxStatus('0xfailed', 'ethereum', 'failed', 'https://etherscan.io/tx/0xfailed')
      cb.onError('transaction reverted', AgentErrorCode.TRANSACTION_FAILED)
      cb.onTurnOutcome?.({ kind: 'error', code: 'reverted' })
    }

    const { exitCode } = await runAsk()
    expect(exitCode).toBe(ExitCode.EXTERNAL_SERVICE)

    const envelope = JSON.parse(stdout.join(''))
    expect(envelope.error.code).toBe(AgentErrorCode.TRANSACTION_FAILED)
    expect(envelope.data.original_error).toBeUndefined()
    expect(envelope.data.transactions[0].status).toBe('failed')
  })

  it('mixed failed/live transaction statuses use BROADCAST_COMMITTED and preserve every leg', async () => {
    driver.run = cb => {
      cb.onTxStatus('0xfailed-leg', 'ethereum', 'failed', 'https://etherscan.io/tx/0xfailed-leg')
      cb.onTxStatus('0xlive-leg', 'ethereum', 'pending', 'https://etherscan.io/tx/0xlive-leg')
      cb.onError('compound flow failed after approval', AgentErrorCode.TRANSACTION_FAILED)
    }

    const { exitCode } = await runAsk()
    expect(exitCode).toBe(ExitCode.BROADCAST_COMMITTED)

    const envelope = JSON.parse(stdout.join(''))
    expect(envelope.error.code).toBe(AgentErrorCode.BROADCAST_COMMITTED)
    expect(envelope.data.transactions).toEqual([
      {
        hash: '0xfailed-leg',
        chain: 'ethereum',
        status: 'failed',
        explorerUrl: 'https://etherscan.io/tx/0xfailed-leg',
      },
      {
        hash: '0xlive-leg',
        chain: 'ethereum',
        status: 'pending',
        explorerUrl: 'https://etherscan.io/tx/0xlive-leg',
      },
    ])
    expect(envelope.data.original_error.code).toBe(AgentErrorCode.TRANSACTION_FAILED)
  })

  it('human partial-success output prints status/hash and replaces bare retry prose with a warning', async () => {
    driver.run = cb => {
      cb.onTxStatus('0xhuman', 'polygon', 'confirmed', 'https://polygonscan.com/tx/0xhuman')
      cb.onAssistantMessage('Please try again.')
      cb.onTurnOutcome?.({ kind: 'blocked', code: 'broadcast-claim' })
    }

    const { exitCode } = await runAsk(false)
    expect(exitCode).toBe(ExitCode.BROADCAST_COMMITTED)
    expect(stdout.join('')).toBe('')

    const output = stderr.join('')
    expect(output).toContain('Broadcast committed:')
    expect(output).toContain('tx:polygon:0xhuman')
    expect(output).toContain('status:confirmed')
    expect(output).toContain('explorer:https://polygonscan.com/tx/0xhuman')
    expect(output).toContain('DO NOT blindly retry')
    expect(output).not.toContain('Please try again.')
  })

  it('stale --session fails closed before executing the first turn', async () => {
    driver.conversationId = ''
    driver.initRun = () => {
      throw Object.assign(
        new Error('Session stale-id could not be resumed (not found); refusing to execute without context'),
        { code: AgentErrorCode.SESSION_NOT_FOUND }
      )
    }
    driver.run = vi.fn()

    const { exitCode } = await runAsk()
    expect(exitCode).toBe(ExitCode.RESOURCE_NOT_FOUND)
    expect(driver.run).not.toHaveBeenCalled()

    const envelope = JSON.parse(stdout.join(''))
    expect(envelope.success).toBe(false)
    expect(envelope.v).toBe(1)
    expect(envelope.error.code).toBe(AgentErrorCode.SESSION_NOT_FOUND)
    expect(envelope.error.message).toContain('could not be resumed')
    expect(envelope.error.conversation_id).toBe('')
    expect(envelope.data).toBeUndefined()
  })

  it('stale --session human output fails closed on stderr', async () => {
    driver.initRun = () => {
      throw Object.assign(new Error('Session stale-id could not be resumed; refusing to execute without context'), {
        code: AgentErrorCode.SESSION_NOT_FOUND,
      })
    }
    driver.run = vi.fn()

    const { exitCode } = await runAsk(false)
    expect(exitCode).toBe(ExitCode.RESOURCE_NOT_FOUND)
    expect(driver.run).not.toHaveBeenCalled()
    expect(stdout.join('')).toBe('')
    expect(stderr.join('')).toContain(AgentErrorCode.SESSION_NOT_FOUND)
  })
})
