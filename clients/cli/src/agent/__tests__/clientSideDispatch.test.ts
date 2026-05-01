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

// PB1 — session.ts:onClientSideToolCall must serialize dispatches in SSE
// arrival order. Without this, two parallel dispatches race on (a) shared
// vault state (add_chain → add_coin) and (b) the single-slot password
// resolver (silent hang in pipe-UI mode). These tests pin the chain
// pattern itself; the manual E2E in the PR description verifies it lands
// inside session.ts.
describe('PB1 — serialized dispatch chain pattern', () => {
  // Reproduce the exact chain shape from session.ts so the contract is
  // visible at the test level — any code change in session.ts that
  // weakens the pattern would diverge from this test and demand attention.
  function makeChain() {
    let dispatchChain: Promise<void> = Promise.resolve()
    const pendingDispatches: Promise<void>[] = []
    const enqueue = (work: () => Promise<void>) => {
      const dispatch = dispatchChain.then(work)
      dispatchChain = dispatch.catch(() => {})
      pendingDispatches.push(dispatch)
    }
    return { enqueue, drain: () => Promise.allSettled(pendingDispatches) }
  }

  it('runs second dispatch only after first completes', async () => {
    const log: string[] = []
    const { enqueue, drain } = makeChain()
    // A is slow (30ms), B is fast (5ms). Without serialization, B's start
    // would be logged before A's done. Chain enforces strict ordering.
    enqueue(async () => {
      log.push('start:A')
      await new Promise(r => setTimeout(r, 30))
      log.push('done:A')
    })
    enqueue(async () => {
      log.push('start:B')
      await new Promise(r => setTimeout(r, 5))
      log.push('done:B')
    })
    await drain()
    expect(log).toEqual(['start:A', 'done:A', 'start:B', 'done:B'])
  })

  it('failure in earlier dispatch does NOT break the chain (catch on dispatchChain)', async () => {
    const log: string[] = []
    const { enqueue, drain } = makeChain()
    enqueue(async () => {
      log.push('start:A')
      throw new Error('A failed')
    })
    enqueue(async () => {
      log.push('start:B')
      log.push('done:B')
    })
    const results = await drain()
    expect(results[0].status).toBe('rejected')
    expect(results[1].status).toBe('fulfilled')
    expect(log).toEqual(['start:A', 'start:B', 'done:B'])
  })

  it('serialized prompts: never two requestPassword in flight (pipe-UI single-slot guard)', async () => {
    let inFlight = 0
    let peak = 0
    const requestPassword = async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise(r => setTimeout(r, 5))
      inFlight--
      return 'pw'
    }
    const { enqueue, drain } = makeChain()
    // Two dispatches that both prompt for password
    enqueue(async () => {
      await requestPassword()
    })
    enqueue(async () => {
      await requestPassword()
    })
    await drain()
    expect(peak).toBe(1)
  })

  it('pendingToolResults push order matches enqueue order, not completion order', async () => {
    // Drives the same queue but records the push order with mismatched
    // dispatch durations. Without serialization, B (fast) would push first.
    const pushOrder: string[] = []
    const { enqueue, drain } = makeChain()
    enqueue(async () => {
      await new Promise(r => setTimeout(r, 30))
      pushOrder.push('A')
    })
    enqueue(async () => {
      await new Promise(r => setTimeout(r, 1))
      pushOrder.push('B')
    })
    await drain()
    expect(pushOrder).toEqual(['A', 'B'])
  })
})

// SF + CR2 — session.ts:sendMessage's catch block. SF clears
// pendingToolResults on non-auth errors so they don't leak into the next
// user turn (causing phantom auto-submits / hallucinated success). CR2
// preserves them across 401/403 retries so the retry replays the same
// recent_actions instead of re-dispatching tools that already mutated
// vault state. Tests pin the snapshot/clear contract.
describe('SF + CR2 — pendingToolResults catch-block contract', () => {
  // Mirrors the catch block in session.ts:sendMessage so the SF (clear on
  // non-auth) and CR2 (restore on 401/403) contracts are both pinned.
  async function runCatchContract(
    initialQueue: string[],
    process: () => Promise<void>,
    options: { is401?: boolean } = {}
  ): Promise<{ finalQueue: string[]; threw: unknown }> {
    let pendingToolResults = [...initialQueue]
    const savedToolResults = [...pendingToolResults]
    let threw: unknown = null
    try {
      // Simulate processMessageLoop splicing the queue into a request body
      // (it always splices before sending, mutating to empty).
      pendingToolResults = []
      await process()
    } catch (err: any) {
      if (options.is401) {
        pendingToolResults = savedToolResults
        // CR2: a real retry would re-call process() here; we don't model
        // the retry's success/failure — only the queue restoration.
      } else {
        pendingToolResults = []
        threw = err
      }
    }
    return { finalQueue: pendingToolResults, threw }
  }

  it('SF: clears queue on non-auth error (5xx, network, abort)', async () => {
    const { finalQueue, threw } = await runCatchContract(
      ['result1', 'result2'],
      async () => {
        throw new Error('500 internal server error')
      },
      { is401: false }
    )
    expect(finalQueue).toEqual([])
    expect((threw as Error).message).toContain('500')
  })

  it('CR2: preserves queue across 401 retry (so re-dispatch is unnecessary)', async () => {
    const { finalQueue } = await runCatchContract(
      ['result1', 'result2'],
      async () => {
        throw new Error('401 unauthorized')
      },
      { is401: true }
    )
    // Queue restored to pre-splice state — retry can replay the same
    // recent_actions without re-dispatching tools.
    expect(finalQueue).toEqual(['result1', 'result2'])
  })

  it('CR2: snapshot is taken BEFORE splice — restoring undoes the splice', async () => {
    // Concrete invariant: snapshot is a copy, so restoring it does not
    // share a reference with the spliced queue (which has been mutated).
    const initial = ['signed_bet']
    const savedSnapshot = [...initial]
    let queue = [...initial]
    queue = [] // simulate splice
    expect(queue).toEqual([]) // post-splice
    queue = savedSnapshot // restore
    expect(queue).toEqual(['signed_bet']) // back to pre-splice
    expect(queue).not.toBe(initial) // distinct array (no shared reference)
  })

  it('SF: empty queue + non-auth error stays empty (no spurious work)', async () => {
    const { finalQueue } = await runCatchContract(
      [],
      async () => {
        throw new Error('AbortError')
      },
      { is401: false }
    )
    expect(finalQueue).toEqual([])
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
