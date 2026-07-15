/**
 * `agentErrorCodeToExitCode` mapping (audit F3 — typed exit codes for `agent ask`).
 *
 * Pins the AgentErrorCode → ExitCode taxonomy a headless caller branches on via
 * `$?`, so a change to a mapping is a conscious, reviewed edit rather than a
 * silent regression. DUPLICATE_BROADCAST → 9 (its own dedicated code, no longer
 * sharing 4 with generic invalid input), ACK_FAILED → 8, and
 * BROADCAST_COMMITTED → 13 are the fund-safety-relevant ones advertised in help.
 */
import { describe, expect, it } from 'vitest'

import { ExitCode } from '../../core/errors'
import { AgentErrorCode, agentErrorCodeToExitCode } from '../agentErrors'

describe('agentErrorCodeToExitCode', () => {
  const cases: Array<[AgentErrorCode, ExitCode]> = [
    [AgentErrorCode.ACK_FAILED, ExitCode.ACK_FAILED],
    [AgentErrorCode.BROADCAST_COMMITTED, ExitCode.BROADCAST_COMMITTED],
    [AgentErrorCode.AGENT_TURN_BLOCKED, ExitCode.AGENT_TURN_BLOCKED],
    [AgentErrorCode.AGENT_TURN_REFUSAL, ExitCode.AGENT_TURN_REFUSAL],
    [AgentErrorCode.AGENT_TURN_ERROR, ExitCode.USAGE],
    [AgentErrorCode.DUPLICATE_BROADCAST, ExitCode.DUPLICATE_BROADCAST],
    [AgentErrorCode.INVALID_INPUT, ExitCode.INVALID_INPUT],
    [AgentErrorCode.AUTH_FAILED, ExitCode.AUTH_REQUIRED],
    [AgentErrorCode.VAULT_LOCKED, ExitCode.AUTH_REQUIRED],
    [AgentErrorCode.PASSWORD_REQUIRED, ExitCode.AUTH_REQUIRED],
    [AgentErrorCode.BACKEND_UNREACHABLE, ExitCode.NETWORK],
    [AgentErrorCode.NETWORK_ERROR, ExitCode.NETWORK],
    [AgentErrorCode.TIMEOUT, ExitCode.NETWORK],
    [AgentErrorCode.SESSION_NOT_FOUND, ExitCode.RESOURCE_NOT_FOUND],
    [AgentErrorCode.TRANSACTION_FAILED, ExitCode.EXTERNAL_SERVICE],
    [AgentErrorCode.ACTION_NOT_IMPLEMENTED, ExitCode.USAGE],
    [AgentErrorCode.TOOL_UNSUPPORTED, ExitCode.USAGE],
    [AgentErrorCode.SESSION_NOT_INITIALIZED, ExitCode.USAGE],
    [AgentErrorCode.CONFIRMATION_REQUIRED, ExitCode.CONFIRMATION_REQUIRED],
    [AgentErrorCode.SIGNING_FAILED, ExitCode.UNKNOWN],
    [AgentErrorCode.LOOP_DEPTH_EXCEEDED, ExitCode.UNKNOWN],
    [AgentErrorCode.UNKNOWN_ERROR, ExitCode.UNKNOWN],
  ]

  it.each(cases)('%s → exit %d', (code, exit) => {
    expect(agentErrorCodeToExitCode(code)).toBe(exit)
  })

  it('maps every AgentErrorCode to a non-negative exit code (exhaustive)', () => {
    for (const code of Object.values(AgentErrorCode)) {
      const exit = agentErrorCodeToExitCode(code)
      expect(typeof exit).toBe('number')
      expect(exit).toBeGreaterThanOrEqual(0)
    }
  })
})
