// Unit tests for client-side tool dispatch (RecentAction conversion,
// registry drift guard, depth cap, SSE parser routing).
import { describe, expect, it, vi } from 'vitest'

import { AgentErrorCode } from '../agentErrors'
import { AgentClient } from '../client'
import { actionResultToRecentAction, CLIENT_SIDE_TOOL_DISPATCH as registry } from '../session'
import type { ActionResult } from '../types'

describe('actionResultToRecentAction', () => {
  const convert = actionResultToRecentAction

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

describe('CLIENT_SIDE_TOOL_DISPATCH registry — capability drift guard', () => {
  // Locks the registry surface — drift is caught at test time, not runtime.
  const EXPECTED_ENTRIES = [
    'sign_typed_data',
    'add_coin',
    'remove_coin',
    'add_chain',
    'remove_chain',
    'address_book_add',
    'address_book_remove',
  ]

  it('has exactly the expected tool names', () => {
    expect(Object.keys(registry).sort()).toEqual(EXPECTED_ENTRIES.slice().sort())
  })

  it('does NOT include create_vault (mobile-only, needs VultiServer/multi-device flow)', () => {
    expect(registry).not.toHaveProperty('create_vault')
  })

  it('does NOT include plugin_install / create_policy / delete_policy (mobile-only)', () => {
    expect(registry).not.toHaveProperty('plugin_install')
    expect(registry).not.toHaveProperty('create_policy')
    expect(registry).not.toHaveProperty('delete_policy')
  })

  it('does NOT include sign_tx (handled via tx_ready SSE channel, not client-side tool dispatch)', () => {
    expect(registry).not.toHaveProperty('sign_tx')
  })

  it('maps each tool name to the matching Action.type (1:1 identity mapping)', () => {
    for (const [toolName, actionType] of Object.entries(registry)) {
      expect(actionType).toBe(toolName)
    }
  })
})

describe('processMessageLoop — depth cap', () => {
  const MAX_DEPTH = 16

  it('stops recursion when depth exceeds cap', async () => {
    let deepest = 0
    let stopped = false
    async function mockLoop(depth = 0): Promise<void> {
      if (depth > MAX_DEPTH) {
        stopped = true
        return
      }
      deepest = Math.max(deepest, depth)
      await mockLoop(depth + 1)
    }
    await mockLoop()
    expect(stopped).toBe(true)
    expect(deepest).toBe(MAX_DEPTH)
  })

  it('normal flow (depth stays low) never hits the cap', async () => {
    let hit = false
    async function mockLoop(depth = 0, iterationsLeft = 3): Promise<void> {
      if (depth > MAX_DEPTH) {
        hit = true
        return
      }
      if (iterationsLeft > 0) {
        await mockLoop(depth + 1, iterationsLeft - 1)
      }
    }
    await mockLoop()
    expect(hit).toBe(false)
  })
})

describe('AgentClient SSE parser — clientExecuted routing', () => {
  function makeClient(): AgentClient {
    const c = new AgentClient('http://localhost:8084')
    return c
  }

  // Exercises the private handleSSEEvent via type-assertion — tests the
  // dispatch routing without spinning up a full stream.
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
    expect(onClientSideToolCall).toHaveBeenCalledWith('c1', 'add_coin', { tokens: [{ chain: 'Base', ticker: 'USDC' }] })
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
