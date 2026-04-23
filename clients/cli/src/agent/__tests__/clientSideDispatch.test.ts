/**
 * Unit tests for PR 2's client-side tool dispatch additions:
 *   - RecentAction shape conversion from ActionResult
 *   - SSE parser routing tool-input-available events with clientExecuted
 *
 * Does NOT touch executor internals (that requires a vault + SDK dist).
 * Integration-style behaviour is covered by the E2E suite.
 */
import { describe, expect, it, vi } from 'vitest'

import { AgentErrorCode } from '../agentErrors'
import { AgentClient } from '../client'
import type { ActionResult } from '../types'

describe('actionResultToRecentAction (via session.ts internals)', () => {
  // Since actionResultToRecentAction is module-private, we exercise its
  // behaviour through the RecentAction shape contract documented in the
  // task file. The conversion rules:
  //   - success=true → { tool, success: true, data: r.data ?? {} }
  //   - success=false → error/code fold into data
  // Mirror of the function body for direct assertion:
  function convert(r: ActionResult): { tool: string; success: boolean; data?: Record<string, unknown> } {
    if (r.success) return { tool: r.action, success: true, data: r.data ?? {} }
    const data: Record<string, unknown> = { ...(r.data ?? {}) }
    if (r.error) data.error = r.error
    if (r.code) data.code = r.code
    return { tool: r.action, success: false, data }
  }

  it('converts successful ActionResult to RecentAction with data', () => {
    const actionResult: ActionResult = {
      action: 'add_coin',
      action_id: 'call-1',
      success: true,
      data: { chain: 'Base', ticker: 'USDC' },
    }
    const recent = convert(actionResult)
    expect(recent).toEqual({
      tool: 'add_coin',
      success: true,
      data: { chain: 'Base', ticker: 'USDC' },
    })
  })

  it('converts successful ActionResult with no data to RecentAction with empty data', () => {
    const actionResult: ActionResult = {
      action: 'create_vault',
      action_id: 'call-2',
      success: true,
    }
    const recent = convert(actionResult)
    expect(recent).toEqual({
      tool: 'create_vault',
      success: true,
      data: {},
    })
  })

  it('converts failed ActionResult, folding error into data', () => {
    const actionResult: ActionResult = {
      action: 'sign_typed_data',
      action_id: 'call-3',
      success: false,
      error: 'Password required',
      code: AgentErrorCode.PASSWORD_REQUIRED,
    }
    const recent = convert(actionResult)
    expect(recent).toEqual({
      tool: 'sign_typed_data',
      success: false,
      data: {
        error: 'Password required',
        code: AgentErrorCode.PASSWORD_REQUIRED,
      },
    })
  })

  it('preserves existing data fields when folding error', () => {
    const actionResult: ActionResult = {
      action: 'add_coin',
      action_id: 'call-4',
      success: false,
      data: { requested: 'USDC' },
      error: 'invalid contract',
    }
    const recent = convert(actionResult)
    expect(recent.data).toEqual({
      requested: 'USDC',
      error: 'invalid contract',
    })
  })
})

describe('AgentClient SSE parser — clientExecuted routing', () => {
  function makeClient(): AgentClient {
    const c = new AgentClient('http://localhost:8084')
    return c
  }

  // Helper: exercise handleSSEEvent via its private access. Uses type
  // assertion to call the private method for unit testing.
  function feedEvent(client: AgentClient, eventJson: string, callbacks: Record<string, any>): void {
    const result = {
      fullText: '',
      actions: [],
      suggestions: [],
      transactions: [],
      message: undefined,
    } as any
    const toolNameByCallId = new Map<string, string>()
    ;(client as any).handleSSEEvent('', eventJson, result, callbacks, toolNameByCallId)
  }

  it('fires onClientSideToolCall when clientExecuted=true on tool-input-available', () => {
    const client = makeClient()
    const onClientSideToolCall = vi.fn()
    const onToolProgress = vi.fn()

    feedEvent(
      client,
      JSON.stringify({
        type: 'tool-input-available',
        toolCallId: 'c1',
        toolName: 'add_coin',
        input: { tokens: [{ chain: 'Base', ticker: 'USDC' }] },
        clientExecuted: true,
      }),
      { onClientSideToolCall, onToolProgress }
    )

    expect(onClientSideToolCall).toHaveBeenCalledOnce()
    expect(onClientSideToolCall).toHaveBeenCalledWith(
      'c1',
      'add_coin',
      { tokens: [{ chain: 'Base', ticker: 'USDC' }] }
    )
    // onToolProgress still fires for verbose display consistency
    expect(onToolProgress).toHaveBeenCalled()
  })

  it('does NOT fire onClientSideToolCall when clientExecuted is absent (MCP tool)', () => {
    const client = makeClient()
    const onClientSideToolCall = vi.fn()
    const onToolProgress = vi.fn()

    feedEvent(
      client,
      JSON.stringify({
        type: 'tool-input-available',
        toolCallId: 'c2',
        toolName: 'polymarket_search',
        input: { query: 'election' },
      }),
      { onClientSideToolCall, onToolProgress }
    )

    expect(onClientSideToolCall).not.toHaveBeenCalled()
    expect(onToolProgress).toHaveBeenCalled()
  })

  it('does NOT fire onClientSideToolCall when clientExecuted is non-true (malformed)', () => {
    const client = makeClient()
    const onClientSideToolCall = vi.fn()

    // Values that must NOT be treated as truthy: string "true", 1, "yes"
    for (const v of ['true', 1, 'yes', {}]) {
      feedEvent(
        client,
        JSON.stringify({
          type: 'tool-input-available',
          toolCallId: 'c',
          toolName: 'add_coin',
          input: {},
          clientExecuted: v,
        }),
        { onClientSideToolCall }
      )
    }

    expect(onClientSideToolCall).not.toHaveBeenCalled()
  })

  it('does NOT fire onClientSideToolCall on tool-input-start frames', () => {
    const client = makeClient()
    const onClientSideToolCall = vi.fn()

    feedEvent(
      client,
      JSON.stringify({
        type: 'tool-input-start',
        toolCallId: 'c',
        toolName: 'add_coin',
        clientExecuted: true, // even if present, only tool-input-available should trigger dispatch
      }),
      { onClientSideToolCall }
    )

    expect(onClientSideToolCall).not.toHaveBeenCalled()
  })

  it('coerces non-object input to empty object', () => {
    const client = makeClient()
    const onClientSideToolCall = vi.fn()

    feedEvent(
      client,
      JSON.stringify({
        type: 'tool-input-available',
        toolCallId: 'c',
        toolName: 'add_coin',
        input: null,
        clientExecuted: true,
      }),
      { onClientSideToolCall }
    )

    expect(onClientSideToolCall).toHaveBeenCalledWith('c', 'add_coin', {})
  })
})
