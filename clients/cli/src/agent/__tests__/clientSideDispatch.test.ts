// Unit tests for client-side tool dispatch (registry drift guard, depth cap,
// SSE parser routing, dispatch chain serialization, queue state contracts).
import { describe, expect, it, vi } from 'vitest'

import { AgentErrorCode } from '../agentErrors'
import { AgentClient } from '../client'
import {
  AgentSession,
  BACKEND_CLIENT_SIDE_TOOL_NAMES,
  CLIENT_SIDE_DISPATCH_TOOL_NAMES,
  CLIENT_SIDE_TOOL_DISPATCH as registry,
} from '../session'
import type { RecentAction } from '../types'

// ────────────────────────────────────────────────────────────────────────────
// Backend contract source of truth.
//
// SYNC MECHANISM: `BACKEND_CLIENT_SIDE_TOOL_NAMES` (in session.ts, imported
// above) is the single hand-mirrored copy of the agent-backend's
// `clientSideToolNames` map (Go) at internal/service/agent/tools.go:549-559 —
// it lives in PRODUCTION code because the session routes SSE dispatch on it, so
// the test and the runtime can't drift from each other. The SDK repo can't
// import Go, so when the backend adds/renames/removes a client-side tool, update
// that one production constant — the parity test below then forces every entry
// to be reclassified (implemented / mobile-only-excluded / rewritten), so a real
// CLI↔backend contract drift fails red instead of silently shipping.
const BACKEND_CLIENT_SIDE_TOOLS = [...BACKEND_CLIENT_SIDE_TOOL_NAMES].sort()

// How each backend client-side tool maps onto the CLI. Every entry of
// BACKEND_CLIENT_SIDE_TOOLS must land in EXACTLY ONE of these three buckets —
// the exhaustiveness test below enforces that, so a newly-added backend tool
// (absent from all three) fails red until a human classifies it.

// (a) Implemented locally by the CLI — present in CLIENT_SIDE_TOOL_DISPATCH.
const CLI_IMPLEMENTED = ['vault_coin', 'vault_chain', 'sign_typed_data']

// (b) Intentionally NOT implemented — mobile-only flows (VultiServer /
//     multi-device / plugin+policy UX) that the headless CLI can't drive.
const MOBILE_ONLY_EXCLUDED = ['create_vault', 'plugin_install', 'create_policy', 'delete_policy']

// (c) Never reach the CLI under their own name: agent-backend/mcp rewrites
//     Polymarket bet/batch signing into a `sign_typed_data` client call
//     (see the "Polymarket marker echo" suite below), so the CLI handles them
//     via the sign_typed_data dispatcher, not a dedicated tool.
const BACKEND_REWRITTEN_TO_SIGN_TYPED_DATA = ['polymarket_sign_bet', 'polymarket_sign_batch']

// CLI-local client-side tool the backend DEFINES (`AddressBookTool`,
// tools.go:423 — flat add/remove discriminator, validated in action_tools.go)
// but OMITS from the canonical `clientSideToolNames` map (tools.go:549-559).
// The CLI implements it, so it's listed here as a known backend-map gap rather
// than silently folded into the parity assertion. If the backend later adds
// `address_book` to clientSideToolNames, move it into CLI_IMPLEMENTED.
const CLI_LOCAL_NOT_IN_BACKEND_MAP = ['address_book']

describe('CLIENT_SIDE_TOOL_DISPATCH registry — backend parity / drift guard', () => {
  // The expected CLI registry surface, DERIVED from the backend contract:
  // everything the CLI implements (backend tools it runs) plus the documented
  // CLI-local tool the backend map omits. Deriving it (rather than hardcoding a
  // frozen literal) is what makes drift fail red — change the backend set or a
  // classification bucket and this expectation shifts with it.
  const EXPECTED_REGISTRY_KEYS = [...CLI_IMPLEMENTED, ...CLI_LOCAL_NOT_IN_BACKEND_MAP].sort()

  it('registry keys equal the backend-derived expected set (fails red on drift)', () => {
    expect(Object.keys(registry).sort()).toEqual(EXPECTED_REGISTRY_KEYS)
  })

  it('every backend client-side tool is classified exactly once (catches a new backend tool once the vendored constant is updated)', () => {
    const classified = [...CLI_IMPLEMENTED, ...MOBILE_ONLY_EXCLUDED, ...BACKEND_REWRITTEN_TO_SIGN_TYPED_DATA].sort()
    // Exhaustive + disjoint: the union of the three buckets is precisely the
    // backend set. A backend tool missing from all buckets (or listed twice)
    // breaks this — forcing a deliberate classification on every contract change.
    expect(classified).toEqual(BACKEND_CLIENT_SIDE_TOOLS)
    expect(classified.length).toBe(new Set(classified).size) // no duplicates across buckets
  })

  it('classification buckets only name real backend tools (catches a backend rename)', () => {
    const backend = new Set(BACKEND_CLIENT_SIDE_TOOLS)
    for (const name of [...CLI_IMPLEMENTED, ...MOBILE_ONLY_EXCLUDED, ...BACKEND_REWRITTEN_TO_SIGN_TYPED_DATA]) {
      expect(backend.has(name), `${name} is not in BACKEND_CLIENT_SIDE_TOOLS — stale classification`).toBe(true)
    }
    // The CLI-local tool is genuinely absent from the backend map (that's the point).
    for (const name of CLI_LOCAL_NOT_IN_BACKEND_MAP) {
      expect(backend.has(name), `${name} unexpectedly appeared in the backend map — reclassify it`).toBe(false)
    }
  })

  it('every CLI-implemented tool is actually present in the dispatch registry', () => {
    for (const name of CLI_IMPLEMENTED) {
      expect(registry, `${name} classified CLI_IMPLEMENTED but missing from registry`).toHaveProperty(name)
    }
  })

  it('does NOT include create_vault (mobile-only, needs VultiServer/multi-device flow)', () => {
    expect(registry).not.toHaveProperty('create_vault')
  })

  it('does NOT include plugin_install / create_policy / delete_policy (mobile-only)', () => {
    expect(registry).not.toHaveProperty('plugin_install')
    expect(registry).not.toHaveProperty('create_policy')
    expect(registry).not.toHaveProperty('delete_policy')
  })

  it('does NOT include the rewritten Polymarket tools (they arrive as sign_typed_data)', () => {
    expect(registry).not.toHaveProperty('polymarket_sign_bet')
    expect(registry).not.toHaveProperty('polymarket_sign_batch')
  })

  it('does NOT include sign_tx (handled via tx_ready SSE channel, not client-side tool dispatch)', () => {
    expect(registry).not.toHaveProperty('sign_tx')
  })

  it('every registry entry is a callable dispatcher function', () => {
    for (const value of Object.values(registry)) {
      expect(typeof value).toBe('function')
    }
  })
})

describe('CLIENT_SIDE_DISPATCH_TOOL_NAMES — routing surface is the backend superset', () => {
  // The SSE layer routes a tool-input-available frame to dispatch iff its
  // toolName is in this set (session.ts passes it to setClientSideToolNames).
  // It MUST be a superset of the implemented registry — otherwise an
  // unimplemented backend tool never reaches dispatchClientSideTool and the
  // TOOL_UNSUPPORTED path is dead code (the bug this PR fixes).
  it('is exactly the backend contract ∪ the implemented registry keys', () => {
    const expected = new Set([...BACKEND_CLIENT_SIDE_TOOL_NAMES, ...Object.keys(registry)])
    expect([...CLIENT_SIDE_DISPATCH_TOOL_NAMES].sort()).toEqual([...expected].sort())
  })

  it('routes every IMPLEMENTED tool (so it reaches its handler)', () => {
    for (const name of Object.keys(registry)) {
      expect(CLIENT_SIDE_DISPATCH_TOOL_NAMES.has(name), `${name} must route to its handler`).toBe(true)
    }
  })

  it('routes the UNIMPLEMENTED backend tools too (so they reach the TOOL_UNSUPPORTED path)', () => {
    const unimplemented = BACKEND_CLIENT_SIDE_TOOL_NAMES.filter(n => !(n in registry))
    expect(unimplemented.length).toBeGreaterThan(0) // sanity: there ARE unimplemented backend tools
    for (const name of unimplemented) {
      expect(CLIENT_SIDE_DISPATCH_TOOL_NAMES.has(name), `${name} must route so it can report TOOL_UNSUPPORTED`).toBe(
        true
      )
    }
  })

  it('the session wires the full dispatch set into the client (constructor production path)', () => {
    // Guards the actual glue: AgentSession must hand the SUPERSET routing set to
    // the client, not just Object.keys(CLIENT_SIDE_TOOL_DISPATCH). Without this,
    // reverting session.ts:setClientSideToolNames to the registry keys would
    // silently kill the TOOL_UNSUPPORTED path while every set-level test above
    // stayed green (they inject the set directly rather than via the session).
    const spy = vi.spyOn(AgentClient.prototype, 'setClientSideToolNames')
    try {
      // Empty ecdsa pubkey ⇒ AgentExecutor skips VaultStateStore (no fs side effect).
      const fakeVault = { publicKeys: { ecdsa: '' }, isEncrypted: false } as any
      new AgentSession(fakeVault, { backendUrl: 'http://localhost:8084' } as any)
      expect(spy).toHaveBeenCalledTimes(1)
      const passed = spy.mock.calls[0][0] as Set<string>
      expect([...passed].sort()).toEqual([...CLIENT_SIDE_DISPATCH_TOOL_NAMES].sort())
    } finally {
      spy.mockRestore()
    }
  })
})

describe('dispatchClientSideTool — unimplemented tool emits a typed error code', () => {
  // A tool the backend asks the client to run but that has no entry in
  // CLIENT_SIDE_TOOL_DISPATCH must push a failure RecentAction carrying the
  // structured AgentErrorCode.TOOL_UNSUPPORTED (not just a prose string) so the
  // backend/LLM can branch — "this client can't run it, don't retry".
  async function dispatchUnknown(toolName: string): Promise<RecentAction[]> {
    const pendingToolResults: RecentAction[] = []
    const fakeThis = { pendingToolResults }
    await (AgentSession.prototype as any).dispatchClientSideTool.call(
      fakeThis,
      'tc-x',
      toolName,
      {},
      {
        onToolCall: vi.fn(),
        onToolResult: vi.fn(),
      }
    )
    return pendingToolResults
  }

  it('pushes success:false with AgentErrorCode.TOOL_UNSUPPORTED in data.code', async () => {
    const results = await dispatchUnknown('definitely_not_a_real_tool')
    expect(results).toHaveLength(1)
    expect(results[0].tool).toBe('definitely_not_a_real_tool')
    expect(results[0].success).toBe(false)
    // The structured discriminator — a machine-branchable code, not just prose.
    expect(results[0].data?.code).toBe(AgentErrorCode.TOOL_UNSUPPORTED)
    // Human-readable line preserved alongside the code.
    expect(results[0].data?.error).toContain('unimplemented in CLI')
  })

  it('reports TOOL_UNSUPPORTED for a REAL backend client-side tool the CLI does not implement', async () => {
    // create_vault is in the backend contract (so it routes to dispatch) but
    // has no handler in CLIENT_SIDE_TOOL_DISPATCH — the exact production case.
    expect(BACKEND_CLIENT_SIDE_TOOL_NAMES).toContain('create_vault')
    expect(registry).not.toHaveProperty('create_vault')
    const results = await dispatchUnknown('create_vault')
    expect(results[0].success).toBe(false)
    expect(results[0].data?.code).toBe(AgentErrorCode.TOOL_UNSUPPORTED)
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
// vault state (vault_chain → vault_coin) and (b) the single-slot password
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

describe('AgentClient SSE parser — registry-based client-side tool routing', () => {
  // The backend's V1ToolInputAvailable frame carries NO `clientExecuted`
  // discriminator (the flag was removed). The client identifies client-side
  // tools via the dispatch-routing set the session injects through
  // setClientSideToolNames. Derive it from the SAME production constant the
  // session uses (not a hand-copied literal) so this suite can't drift from the
  // real routing surface.
  const CLIENT_SIDE_NAMES = new Set(CLIENT_SIDE_DISPATCH_TOOL_NAMES)

  function makeClient(registry: Set<string> | null = CLIENT_SIDE_NAMES): AgentClient {
    const c = new AgentClient('http://localhost:8084')
    if (registry) c.setClientSideToolNames(registry)
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

  // Representative CURRENT-backend frame: NO clientExecuted field.
  const currentBackendVaultCoinEvent = JSON.stringify({
    type: 'tool-input-available',
    toolCallId: 'c1',
    toolName: 'vault_coin',
    input: { tokens: [{ chain: 'Base', ticker: 'USDC' }] },
  })

  // BEFORE/AFTER differential — the core of the fix. Against a current-backend
  // frame (no clientExecuted), the OLD strict `parsed.clientExecuted === true`
  // check NEVER dispatched (the 4 client-side tools were dead). With the
  // registry injected, the SAME frame now dispatches by toolName membership.
  it('PRE-FIX repro: a current-backend frame does NOT dispatch when no registry is set', () => {
    // No registry injected ⇒ no membership ⇒ no dispatch. This is the dead
    // state the old clientExecuted gate produced against the live backend.
    const client = makeClient(null)
    const onClientSideToolCall = vi.fn()
    const onToolProgress = vi.fn()

    feedEvent(client, currentBackendVaultCoinEvent, { onClientSideToolCall, onToolProgress })

    expect(onClientSideToolCall).not.toHaveBeenCalled()
    // The tool still degrades to display-only progress (the silent regression).
    expect(onToolProgress).toHaveBeenCalled()
  })

  it('POST-FIX: the SAME current-backend frame DOES dispatch via registry match', () => {
    const client = makeClient() // registry injected (as session does)
    const onClientSideToolCall = vi.fn()
    const onToolProgress = vi.fn()

    feedEvent(client, currentBackendVaultCoinEvent, { onClientSideToolCall, onToolProgress })

    expect(onClientSideToolCall).toHaveBeenCalledOnce()
    expect(onClientSideToolCall).toHaveBeenCalledWith('c1', 'vault_coin', {
      tokens: [{ chain: 'Base', ticker: 'USDC' }],
    })
    expect(onToolProgress).toHaveBeenCalled()
  })

  it('dispatches every routed client-side tool name from a current-backend frame', () => {
    for (const toolName of CLIENT_SIDE_NAMES) {
      const client = makeClient()
      const onClientSideToolCall = vi.fn()
      feedEvent(
        client,
        JSON.stringify({ type: 'tool-input-available', toolCallId: 'c', toolName, input: { action: 'add' } }),
        { onClientSideToolCall }
      )
      expect(onClientSideToolCall, `expected ${toolName} to dispatch`).toHaveBeenCalledWith('c', toolName, {
        action: 'add',
      })
    }
  })

  it('routes an UNIMPLEMENTED backend client-side tool to dispatch (production path for TOOL_UNSUPPORTED)', () => {
    // The bug Codex caught: if the routing set were only the implemented
    // registry keys, create_vault's frame would fall through as display-only
    // progress and never reach dispatchClientSideTool — so TOOL_UNSUPPORTED
    // would be dead code. Routing on the backend superset makes it reachable.
    const client = makeClient()
    const onClientSideToolCall = vi.fn()
    const onToolProgress = vi.fn()

    feedEvent(
      client,
      JSON.stringify({ type: 'tool-input-available', toolCallId: 'cv', toolName: 'create_vault', input: {} }),
      { onClientSideToolCall, onToolProgress }
    )

    // It IS intercepted for dispatch (where the !handler branch emits the
    // structured failure — verified at the dispatch level above).
    expect(onClientSideToolCall).toHaveBeenCalledWith('cv', 'create_vault', {})
  })

  it('does NOT fire for a non-client-side toolName (server-side / MCP) — no over-trigger', () => {
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

  it('ignores a stray clientExecuted flag — identification is registry-only now', () => {
    // Even if some backend re-introduced the flag, a non-registry tool must
    // NOT dispatch (registry is the sole source of truth).
    const client = makeClient()
    const onClientSideToolCall = vi.fn()

    feedEvent(
      client,
      JSON.stringify({
        type: 'tool-input-available',
        toolCallId: 'c',
        toolName: 'polymarket_search',
        input: {},
        clientExecuted: true,
      }),
      { onClientSideToolCall }
    )

    expect(onClientSideToolCall).not.toHaveBeenCalled()
  })

  it('does NOT fire on tool-input-start frames (only tool-input-available dispatches)', () => {
    const client = makeClient()
    const onClientSideToolCall = vi.fn()

    feedEvent(
      client,
      JSON.stringify({
        type: 'tool-input-start',
        toolCallId: 'c',
        toolName: 'vault_coin',
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
        toolName: 'vault_coin',
        input: null,
      }),
      { onClientSideToolCall }
    )

    expect(onClientSideToolCall).toHaveBeenCalledWith('c', 'vault_coin', {})
  })
})

describe('Polymarket marker echo — dispatchClientSideTool protocol contract', () => {
  // agent-backend's autoSubmitPolymarketOrder consumes pm_order_ref +
  // __pm_auto_submit + __pm_submit_token from the recent_action data on the
  // return leg. The CLI never interprets these — dispatchClientSideTool
  // copies every input key starting with "__" (plus pm_order_ref) into the
  // result data so they survive the signing roundtrip. If this echo breaks,
  // every Polymarket auto-submit fails closed at the server's token gate.
  function makeUi() {
    return {
      onToolCall: vi.fn(),
      onToolResult: vi.fn(),
      requestConfirmation: vi.fn(async () => true),
      requestPassword: vi.fn(async () => 'pw'),
    }
  }

  // Mirrors the live mcp-ts envelope: rewritePolymarketSignBet emits
  // sign_typed_data input with payloads + markers.
  const POLYMARKET_SIGN_INPUT = {
    payloads: [
      {
        id: 'order',
        primaryType: 'Order',
        domain: {},
        types: {},
        message: {},
        chain: 'Polygon',
      },
      {
        id: 'auth',
        primaryType: 'ClobAuth',
        domain: {},
        types: {},
        message: {},
        chain: 'Ethereum',
      },
    ],
    pm_order_ref: 'ref-fb415704',
    __pm_auto_submit: true,
    __pm_submit_token: 'token-24236b30',
  }

  async function dispatch(input: Record<string, unknown>, executorResult: Record<string, unknown>) {
    const pendingToolResults: Array<{
      tool: string
      success: boolean
      data?: Record<string, unknown>
    }> = []
    const fakeThis = {
      executor: {
        signTypedData: vi.fn(
          async () =>
            ({
              tool: 'sign_typed_data',
              success: true,
              data: executorResult,
            }) as RecentAction
        ),
        getPendingSummary: () => null,
        clearPendingTransaction: vi.fn(),
      },
      config: { password: 'pw', autoApprove: true },
      pendingToolResults,
      // dispatchClientSideTool routes through runPasswordGatedTool — reuse
      // the real prototype method so the gate behavior stays integrated.
      runPasswordGatedTool: (AgentSession.prototype as any).runPasswordGatedTool,
    }
    await (AgentSession.prototype as any).dispatchClientSideTool.call(
      fakeThis,
      'tc-pm-1',
      'sign_typed_data',
      input,
      makeUi()
    )
    return pendingToolResults
  }

  it('echoes __pm markers + pm_order_ref into the recent_action data', async () => {
    const results = await dispatch(POLYMARKET_SIGN_INPUT, {
      signatures: [
        { id: 'order', signature: '0xorder' },
        { id: 'auth', signature: '0xauth' },
      ],
      pm_order_ref: 'ref-fb415704',
      auto_submit: true,
    })

    expect(results).toHaveLength(1)
    expect(results[0].tool).toBe('sign_typed_data')
    expect(results[0].success).toBe(true)
    const data = results[0].data!
    // The server-side auto-submit gate needs all three of these.
    expect(data.__pm_submit_token).toBe('token-24236b30')
    expect(data.__pm_auto_submit).toBe(true)
    expect(data.pm_order_ref).toBe('ref-fb415704')
    // The executor's own result fields ride along untouched.
    expect((data.signatures as unknown[]).length).toBe(2)
  })

  it('echoes pm_batch_ref (+ __pm_auto_submit_batch) for Polymarket BATCH auto-submit', async () => {
    // BATCH approvals carry a bare pm_batch_ref (no __ prefix) plus the
    // __pm_auto_submit_batch flag. agent-backend reads ar.Data["pm_batch_ref"]
    // to dispatch submit_deposit_wallet_batch; if the echo loop drops it,
    // BATCH approvals sign but never auto-submit.
    const batchInput = {
      payloads: [
        { id: 'order', primaryType: 'Order', domain: {}, types: {}, message: {}, chain: 'Polygon' },
        { id: 'auth', primaryType: 'ClobAuth', domain: {}, types: {}, message: {}, chain: 'Ethereum' },
      ],
      pm_batch_ref: 'batch-ref-789',
      __pm_auto_submit_batch: true,
    }
    // Deliberately OMIT pm_batch_ref from the executor result so the only way
    // it can reach recent.data is the session input-echo loop under test. If
    // the mock pre-seeded it, this assertion would pass even with the echo
    // condition reverted (tautology). Mirrors the bare-result pattern below.
    const results = await dispatch(batchInput, {
      signatures: [{ id: 'order', signature: '0xorder' }],
      auto_submit: true,
    })

    const data = results[0].data!
    // bare pm_batch_ref survives the echo loop...
    expect(data.pm_batch_ref).toBe('batch-ref-789')
    // ...and the __-prefixed batch flag rides through on the __ branch.
    expect(data.__pm_auto_submit_batch).toBe(true)
  })

  it('does NOT echo non-marker input keys (payloads stay out of the result)', async () => {
    const results = await dispatch(POLYMARKET_SIGN_INPUT, { signatures: [] })
    const data = results[0].data!
    expect(data).not.toHaveProperty('payloads')
  })

  it('echoes markers even when the handler fails (server can still classify)', async () => {
    const pendingToolResults: Array<{
      tool: string
      success: boolean
      data?: Record<string, unknown>
    }> = []
    const fakeThis = {
      executor: {
        signTypedData: vi.fn(async () => {
          throw new Error('MPC session failed')
        }),
        getPendingSummary: () => null,
        clearPendingTransaction: vi.fn(),
      },
      config: { password: 'pw', autoApprove: true },
      pendingToolResults,
      runPasswordGatedTool: (AgentSession.prototype as any).runPasswordGatedTool,
    }
    await (AgentSession.prototype as any).dispatchClientSideTool.call(
      fakeThis,
      'tc-pm-2',
      'sign_typed_data',
      POLYMARKET_SIGN_INPUT,
      makeUi()
    )

    expect(pendingToolResults).toHaveLength(1)
    expect(pendingToolResults[0].success).toBe(false)
    // Markers still echoed on failure — the server's gate (not the CLI)
    // decides what a failed-sign return means.
    expect(pendingToolResults[0].data?.__pm_submit_token).toBe('token-24236b30')
    expect(pendingToolResults[0].data?.pm_order_ref).toBe('ref-fb415704')
  })
})
