import type { VaultBase } from '@vultisig/sdk'
import { privateKeyToAddress, sign } from 'viem/accounts'
import { describe, expect, it, vi } from 'vitest'

import { AgentClient } from '../client'
import { AgentExecutor } from '../executor'
import {
  computeHlDigest,
  formatHlConfirmation,
  type HlOrderSigningPayload,
  type HlOrderTransport,
  pollHlOrderStatus,
  validateHlSigningPayload,
} from '../hlOrder'
import { AgentSession } from '../session'

const PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const ADDRESS = privateKeyToAddress(PRIVATE_KEY)
const PUBLIC_KEY = `02${'a'.repeat(64)}`
const ORDER_REF = '12345678-1234-1234-1234-123456789abc'
const CONVERSATION_ID = '11111111-1111-1111-1111-111111111111'

const orderAction = {
  type: 'order',
  orders: [
    {
      a: 0,
      b: true,
      p: '30000.0',
      r: false,
      s: '0.001',
      t: { limit: { tif: 'Gtc' } },
    },
  ],
  grouping: 'na',
}

function payload(overrides: Partial<HlOrderSigningPayload> = {}): HlOrderSigningPayload {
  const freshOrderAction = structuredClone(orderAction)
  const orderStep = {
    kind: 'order' as const,
    action: freshOrderAction,
    nonce: 1000,
    is_mainnet: true,
  }
  const leverageStep = {
    kind: 'update_leverage' as const,
    action: { type: 'updateLeverage', asset: 0, isCross: true, leverage: 5 },
    nonce: 999,
    is_mainnet: true,
  }
  return {
    order_ref: ORDER_REF,
    conversation_id: CONVERSATION_ID,
    owner_public_key: PUBLIC_KEY,
    vault_address: ADDRESS,
    expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    summary: {
      operation: 'open',
      coin: 'BTC',
      asset_index: 0,
      side: 'long',
      size: '0.001',
      notional_usd: '30',
      order_type: 'limit',
      price_cap: '30000.0',
      limit_price: '30000.0',
      tif: 'Gtc',
      reduce_only: false,
      leverage: 5,
      margin_mode: 'cross',
    },
    asset_binding: { coin: 'BTC', asset_index: 0 },
    steps: [
      { ...leverageStep, digest: computeHlDigest(leverageStep) },
      { ...orderStep, digest: computeHlDigest(orderStep) },
    ],
    ...overrides,
  }
}

async function mockSign(hash: string) {
  const signature = await sign({
    hash: hash as `0x${string}`,
    privateKey: PRIVATE_KEY,
  })
  return {
    signature: `${signature.r}${signature.s.slice(2)}`,
    recovery: signature.yParity,
    format: 'ECDSA',
  }
}

function vault(): VaultBase {
  return {
    id: 'test-vault',
    name: 'test-vault',
    type: 'fast',
    chains: [],
    isEncrypted: false,
    publicKeys: { ecdsa: PUBLIC_KEY },
    address: vi.fn(async () => ADDRESS),
    signBytes: vi.fn(async ({ data }: { data: string }) => mockSign(data)),
  } as unknown as VaultBase
}

const expected = {
  orderRef: ORDER_REF,
  conversationId: CONVERSATION_ID,
  publicKey: PUBLIC_KEY,
}

describe('Hyperliquid signing payload validation', () => {
  const enumLocations: Array<[string, (candidate: any, value: unknown) => void]> = [
    [
      'summary.operation',
      (p, value) => {
        p.summary.operation = value
      },
    ],
    [
      'summary.side',
      (p, value) => {
        p.summary.side = value
      },
    ],
    [
      'summary.margin_mode',
      (p, value) => {
        p.summary.margin_mode = value
      },
    ],
    [
      'summary.order_type',
      (p, value) => {
        p.summary.order_type = value
      },
    ],
    [
      'summary.tif',
      (p, value) => {
        p.summary.tif = value
      },
    ],
    [
      'step.kind',
      (p, value) => {
        p.steps[0].kind = value
      },
    ],
    [
      'leverage action.type',
      (p, value) => {
        p.steps[0].action.type = value
      },
    ],
    [
      'order action.type',
      (p, value) => {
        p.steps[1].action.type = value
      },
    ],
    [
      'order action.grouping',
      (p, value) => {
        p.steps[1].action.grouping = value
      },
    ],
    [
      'nested order tif',
      (p, value) => {
        p.steps[1].action.orders[0].t.limit.tif = value
      },
    ],
  ]
  const coercibleEnumValues: Array<[string, unknown]> = [
    ['array', ['open']],
    ['object', {}],
    ['number', 1],
    ['boolean', true],
    ['null', null],
    ['String object', new String('open')],
  ]

  it.each(
    enumLocations.flatMap(([location, mutate]) =>
      coercibleEnumValues.map(([valueName, value]) => [location, valueName, mutate, value] as const)
    )
  )('rejects coercible runtime enum at %s: %s', async (_location, _valueName, mutate, value) => {
    const candidate: any = payload()
    mutate(candidate, value)
    // Rebind action mutations to their new digest so enum validation, rather
    // than the independent digest check, is the rejection boundary under test.
    for (const step of candidate.steps) step.digest = computeHlDigest(step)
    await expect(validateHlSigningPayload(candidate, expected, vault())).rejects.toThrow()
  })

  it.each([
    [
      'unknown operation',
      (p: any) => {
        p.summary.operation = 'hold'
      },
    ],
    [
      'unknown side',
      (p: any) => {
        p.summary.side = 'buy'
      },
    ],
    [
      'unknown margin mode',
      (p: any) => {
        p.summary.margin_mode = 'portfolio'
      },
    ],
    [
      'open reduce-only',
      (p: any) => {
        p.summary.reduce_only = true
        p.steps[1].action.orders[0].r = true
      },
    ],
    [
      'conflicting top-level operation',
      (p: any) => {
        p.operation = 'close'
      },
    ],
    [
      'conflicting nested side',
      (p: any) => {
        p.steps[1].action.side = 'short'
      },
    ],
  ])('rejects strict runtime invariant: %s', async (_name, mutate) => {
    const candidate: any = payload()
    mutate(candidate)
    await expect(validateHlSigningPayload(candidate, expected, vault())).rejects.toThrow()
  })
  it('matches the backend/Python reference digest exactly', () => {
    expect(payload().steps[1]?.digest).toBe('0x670fb12c6b39e9d2469fe74bb5fae5db5cb51051ec4882a9b7e1064fbd07a1ab')
  })

  it('accepts a bound, unexpired open payload', async () => {
    await expect(validateHlSigningPayload(payload(), expected, vault())).resolves.toBeUndefined()
  })

  it.each([
    ['null payload', null, 'HL_INVALID_PAYLOAD'],
    ['missing summary', { ...payload(), summary: null }, 'HL_INVALID_SUMMARY'],
    ['missing asset binding', { ...payload(), asset_binding: null }, 'HL_INVALID_ASSET_BINDING'],
    ['non-array steps', { ...payload(), steps: {} }, 'HL_INVALID_STEPS'],
    ['non-string owner', { ...payload(), owner_public_key: null }, 'HL_INVALID_OWNER_PUBLIC_KEY'],
    ['non-string vault address', { ...payload(), vault_address: null }, 'HL_INVALID_VAULT_ADDRESS'],
    ['non-string expiry', { ...payload(), expires_at: null }, 'HL_INVALID_EXPIRY'],
    [
      'non-string digest',
      { ...payload(), steps: [{ ...payload().steps[0]!, digest: null }, payload().steps[1]!] },
      'HL_INVALID_DIGEST',
    ],
    [
      'non-string coin',
      {
        ...payload(),
        summary: { ...payload().summary, coin: null },
        asset_binding: { ...payload().asset_binding, coin: null },
      },
      'HL_INVALID_COIN',
    ],
    [
      'non-integer asset index',
      {
        ...payload(),
        summary: { ...payload().summary, asset_index: 0.5 },
        asset_binding: { ...payload().asset_binding, asset_index: 0.5 },
      },
      'HL_INVALID_ASSET_INDEX',
    ],
  ])('rejects malformed network payload with a stable code: %s', async (_name, candidate, code) => {
    await expect(validateHlSigningPayload(candidate as any, expected, vault())).rejects.toThrow(code)
  })

  it('requires every signed step to use the same Hyperliquid network', async () => {
    const candidate = payload()
    candidate.steps[1]!.is_mainnet = false
    candidate.steps[1]!.digest = computeHlDigest(candidate.steps[1]!)
    await expect(validateHlSigningPayload(candidate, expected, vault())).rejects.toThrow('HL_NETWORK_MISMATCH')
  })

  it.each([
    ['cross-owner', { owner_public_key: `03${'b'.repeat(64)}` }, 'HL_OWNER_MISMATCH'],
    ['cross-conversation', { conversation_id: '22222222-2222-2222-2222-222222222222' }, 'HL_REFERENCE_MISMATCH'],
    ['expired', { expires_at: new Date(Date.now() - 1).toISOString() }, 'HL_ORDER_EXPIRED'],
    ['unbounded expiry', { expires_at: new Date(Date.now() + 11 * 60_000).toISOString() }, 'HL_EXPIRY_OUT_OF_RANGE'],
  ])('rejects %s payloads', async (_name, overrides, code) => {
    await expect(validateHlSigningPayload(payload(overrides), expected, vault())).rejects.toThrow(code)
  })

  it('rejects action tampering against the stored digest', async () => {
    const tampered = payload()
    ;(tampered.steps[1]!.action.orders as Array<Record<string, unknown>>)[0]!.s = '1.0'
    await expect(validateHlSigningPayload(tampered, expected, vault())).rejects.toThrow('HL_DIGEST_MISMATCH')
  })

  it.each([
    [
      'nested side alias',
      (order: any) => {
        order.side = 'long'
      },
    ],
    [
      'nested operation alias',
      (order: any) => {
        order.operation = 'open'
      },
    ],
    [
      'nested reduce-only alias',
      (order: any) => {
        order.reduce_only = false
      },
    ],
    [
      'unknown benign-looking field',
      (order: any) => {
        order.clientOrderLabel = 'vault-cli'
      },
    ],
    [
      'prototype-like constructor key',
      (order: any) => {
        order.constructor = 'order'
      },
    ],
    [
      'prototype-like JSON key',
      (order: any) => {
        Object.defineProperty(order, '__proto__', {
          value: { side: 'short' },
          enumerable: true,
        })
      },
    ],
    [
      'order type sibling',
      (order: any) => {
        order.t.trigger = { isMarket: true }
      },
    ],
    [
      'limit sibling',
      (order: any) => {
        order.t.limit.price = '30000.0'
      },
    ],
  ])('rejects recomputed-digest order schema extension: %s', async (_name, mutate) => {
    const candidate: any = payload()
    const orderStep = candidate.steps[1]
    mutate(orderStep.action.orders[0])
    orderStep.digest = computeHlDigest(orderStep)
    await expect(validateHlSigningPayload(candidate, expected, vault())).rejects.toThrow()
  })

  it.each([
    [
      'order action alias',
      (action: any) => {
        action.side = 'long'
      },
    ],
    [
      'order action unknown',
      (action: any) => {
        action.builder = null
      },
    ],
    [
      'leverage action alias',
      (action: any) => {
        action.margin_mode = 'cross'
      },
    ],
    [
      'leverage action unknown',
      (action: any) => {
        action.note = '5x'
      },
    ],
  ])('rejects recomputed-digest action schema extension: %s', async (_name, mutate) => {
    const candidate: any = payload()
    const step = _name.startsWith('leverage') ? candidate.steps[0] : candidate.steps[1]
    mutate(step.action)
    step.digest = computeHlDigest(step)
    await expect(validateHlSigningPayload(candidate, expected, vault())).rejects.toThrow()
  })

  it('rejects WYSIWYS size and side drift even when the backend digest is self-consistent', async () => {
    const wrongSize = payload({
      summary: { ...payload().summary, size: '0.002' },
    })
    await expect(validateHlSigningPayload(wrongSize, expected, vault())).rejects.toThrow('HL_ORDER_SIZE_MISMATCH')
    const wrongSide = payload({
      summary: { ...payload().summary, side: 'short' },
    })
    await expect(validateHlSigningPayload(wrongSide, expected, vault())).rejects.toThrow('HL_ORDER_SIDE_MISMATCH')
  })

  it.each([
    ['asset index', { asset_index: 1 }, 'HL_ASSET_BINDING_MISMATCH'],
    ['decimal size spelling', { size: '0.0010' }, 'HL_ORDER_SIZE_MISMATCH'],
    ['derived notional', { notional_usd: '30.01' }, 'HL_INVALID_ORDER_NOTIONAL'],
    ['price cap', { price_cap: '30001.0' }, 'HL_ORDER_PRICE_CAP_MISMATCH'],
    ['order type', { order_type: 'market' as const }, 'HL_ORDER_TYPE_MISMATCH'],
    ['limit price', { limit_price: '29999.0' }, 'HL_LIMIT_PRICE_MISMATCH'],
    ['time in force', { tif: 'Ioc' as const }, 'HL_TIF_MISMATCH'],
  ])('rejects adversarial %s summary drift', async (_name, summaryOverride, code) => {
    const tampered = payload({
      summary: { ...payload().summary, ...summaryOverride },
    })
    await expect(validateHlSigningPayload(tampered, expected, vault())).rejects.toThrow(code)
  })

  it('rejects a coin/index mismatch against the authenticated asset binding', async () => {
    const tampered = payload({
      summary: { ...payload().summary, coin: 'ETH' },
    })
    await expect(validateHlSigningPayload(tampered, expected, vault())).rejects.toThrow('HL_ASSET_BINDING_MISMATCH')
  })

  it('requires an open ceremony to contain exactly leverage then order', async () => {
    const missing = payload({
      steps: [payload().steps[1]!],
    })
    await expect(validateHlSigningPayload(missing, expected, vault())).rejects.toThrow('HL_INVALID_OPEN_CEREMONY')
    const reversed = payload({ steps: [...payload().steps].reverse() })
    await expect(validateHlSigningPayload(reversed, expected, vault())).rejects.toThrow('HL_INVALID_OPEN_CEREMONY')
    const missingSummary = payload({
      summary: {
        ...payload().summary,
        leverage: undefined,
        margin_mode: undefined,
      },
    })
    await expect(validateHlSigningPayload(missingSummary, expected, vault())).rejects.toThrow(
      'HL_INVALID_OPEN_CEREMONY'
    )
    const wrongAsset = payload()
    wrongAsset.steps[0]!.action.asset = 1
    wrongAsset.steps[0]!.digest = computeHlDigest(wrongAsset.steps[0]!)
    await expect(validateHlSigningPayload(wrongAsset, expected, vault())).rejects.toThrow('HL_LEVERAGE_ASSET_MISMATCH')
  })

  it('requires a close ceremony to contain exactly one reduce-only order and no leverage', async () => {
    const order = structuredClone(payload().steps[1]!)
    ;(order.action.orders as Array<Record<string, unknown>>)[0]!.r = true
    ;(order.action.orders as Array<Record<string, unknown>>)[0]!.b = false
    order.digest = computeHlDigest(order)
    const close = payload({
      summary: {
        ...payload().summary,
        operation: 'close',
        reduce_only: true,
        leverage: undefined,
        margin_mode: undefined,
      },
      steps: [order],
    })
    await expect(validateHlSigningPayload(close, expected, vault())).resolves.toBeUndefined()
    const extraLeverage = payload({
      summary: { ...close.summary, leverage: 5, margin_mode: 'cross' },
      steps: payload().steps,
    })
    await expect(validateHlSigningPayload(extraLeverage, expected, vault())).rejects.toThrow(
      'HL_INVALID_CLOSE_CEREMONY'
    )
  })
})

describe('Hyperliquid executor ceremony', () => {
  it('retrieves once, signs locally, submits directly, and keeps signatures out of chat result', async () => {
    const signingPayload = payload()
    const transport: HlOrderTransport = {
      retrieveHlOrderSigningPayload: vi.fn(async () => signingPayload),
      submitHlOrder: vi.fn(async () => ({
        state: 'filled' as const,
        order_id: 'oid-1',
        filled_size: '0.001',
      })),
      getHlOrderStatus: vi.fn(),
    }
    const executor = new AgentExecutor(vault(), false, PUBLIC_KEY)
    const retrieved = await executor.retrieveHlOrder(
      transport,
      { order_ref: ORDER_REF, digest: signingPayload.steps[1]!.digest },
      CONVERSATION_ID
    )
    const recent = await executor.signAndSubmitHlOrder(transport, retrieved)

    expect(recent).toEqual({
      tool: 'hl_order',
      success: true,
      data: expect.objectContaining({
        order_ref: ORDER_REF,
        state: 'filled',
        order_id: 'oid-1',
      }),
    })
    expect(JSON.stringify(recent)).not.toMatch(/signature|\br\b|\bs\b/)
    expect(transport.submitHlOrder).toHaveBeenCalledWith(ORDER_REF, CONVERSATION_ID, PUBLIC_KEY, [
      expect.objectContaining({
        kind: 'update_leverage',
        digest: signingPayload.steps[0]!.digest,
      }),
      expect.objectContaining({
        kind: 'order',
        digest: signingPayload.steps[1]!.digest,
        r: expect.any(String),
        s: expect.any(String),
        v: expect.any(Number),
      }),
    ])
    await expect(executor.retrieveHlOrder(transport, { order_ref: ORDER_REF }, CONVERSATION_ID)).rejects.toThrow(
      'HL_ORDER_REFERENCE_REPLAYED'
    )
  })

  it('polls accepted orders until the venue reports a terminal/resting state', async () => {
    const transport = {
      getHlOrderStatus: vi
        .fn()
        .mockResolvedValueOnce({ state: 'accepted' })
        .mockResolvedValueOnce({ state: 'resting', order_id: 'oid-2' }),
    } as unknown as HlOrderTransport
    const status = await pollHlOrderStatus(
      transport,
      {
        orderRef: ORDER_REF,
        conversationId: CONVERSATION_ID,
        publicKey: PUBLIC_KEY,
      },
      { state: 'submitting' },
      { attempts: 3, intervalMs: 0, sleep: async () => undefined }
    )
    expect(status).toEqual({ state: 'resting', order_id: 'oid-2' })
  })

  it('continues after transient poll errors and preserves the last submitted state when exhausted', async () => {
    const recoveredTransport = {
      getHlOrderStatus: vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({ state: 'resting' }),
    } as unknown as HlOrderTransport
    await expect(
      pollHlOrderStatus(
        recoveredTransport,
        { orderRef: ORDER_REF, conversationId: CONVERSATION_ID, publicKey: PUBLIC_KEY },
        { state: 'accepted' },
        { attempts: 3, intervalMs: 0, sleep: async () => undefined }
      )
    ).resolves.toEqual({ state: 'resting' })

    const failingTransport = {
      getHlOrderStatus: vi.fn().mockRejectedValue(new Error('temporary status outage')),
    } as unknown as HlOrderTransport
    await expect(
      pollHlOrderStatus(
        failingTransport,
        { orderRef: ORDER_REF, conversationId: CONVERSATION_ID, publicKey: PUBLIC_KEY },
        { state: 'submitting' },
        { attempts: 3, intervalMs: 0, sleep: async () => undefined }
      )
    ).resolves.toEqual({ state: 'submitting' })
  })

  it('reports a venue rejection as failure despite HTTP success', async () => {
    const signingPayload = payload()
    const transport: HlOrderTransport = {
      retrieveHlOrderSigningPayload: vi.fn(async () => signingPayload),
      submitHlOrder: vi.fn(async () => ({
        state: 'rejected' as const,
        reason: 'insufficient margin',
      })),
      getHlOrderStatus: vi.fn(),
    }
    const executor = new AgentExecutor(vault(), false, PUBLIC_KEY)
    const recent = await executor.signAndSubmitHlOrder(transport, signingPayload)
    expect(recent.success).toBe(false)
    expect(recent.data?.error).toContain('HL_ORDER_REJECTED')
  })

  it('renders a high-distrust confirmation with leverage and reduce-only truth', () => {
    const p = payload({
      summary: { ...payload().summary, leverage: 3, margin_mode: 'cross' },
    })
    expect(formatHlConfirmation(p)).toContain('3x cross')
    expect(formatHlConfirmation(p)).toContain('Hyperliquid Mainnet')
    expect(formatHlConfirmation(p)).toContain('asset #0')
    expect(formatHlConfirmation(p)).toContain('signed notional $30')
    expect(formatHlConfirmation(p)).toContain('limit/Gtc')
    expect(formatHlConfirmation(p)).toContain('limit $30000.0')
    expect(formatHlConfirmation(p)).toContain('signs and submits a live leveraged order')
    expect(formatHlConfirmation(p)).toContain('reduce-only=false')

    const testnet = payload({ steps: payload().steps.map(step => ({ ...step, is_mainnet: false })) })
    expect(formatHlConfirmation(testnet)).toContain('Hyperliquid Testnet')
  })

  it('displays and validates the exact signed IOC maximum execution price', async () => {
    const marketAction = structuredClone(orderAction)
    marketAction.orders[0]!.t.limit.tif = 'Ioc'
    const marketStep = {
      kind: 'order' as const,
      action: marketAction,
      nonce: 1000,
      is_mainnet: true,
    }
    const market = payload({
      summary: {
        ...payload().summary,
        order_type: 'market',
        tif: 'Ioc',
        price_cap: '30000.0',
        limit_price: null,
      },
      steps: [payload().steps[0]!, { ...marketStep, digest: computeHlDigest(marketStep) }],
    })
    await expect(validateHlSigningPayload(market, expected, vault())).resolves.toBeUndefined()
    expect(formatHlConfirmation(market)).toContain('market max execution price $30000.0')
    const mismatched = {
      ...market,
      summary: { ...market.summary, price_cap: '30001.0' },
    }
    await expect(validateHlSigningPayload(mismatched, expected, vault())).rejects.toThrow('HL_ORDER_PRICE_CAP_MISMATCH')
  })

  it('routes hl_order through explicit confirmation before any signing or submission', async () => {
    const signingPayload = payload()
    const signAndSubmitHlOrder = vi.fn()
    const ui = {
      requestConfirmation: vi.fn(async () => false),
      requestPassword: vi.fn(),
      onToolCall: vi.fn(),
      onToolResult: vi.fn(),
    }
    const fakeThis = {
      conversationId: CONVERSATION_ID,
      config: { password: 'pw' },
      vault: { isEncrypted: false },
      client: {},
      executor: {
        retrieveHlOrder: vi.fn(async () => signingPayload),
        signAndSubmitHlOrder,
        getPendingSummary: vi.fn(),
        clearPendingTransaction: vi.fn(),
        hasPassword: vi.fn(() => true),
      },
      pendingToolResults: [],
      runPasswordGatedTool: (AgentSession.prototype as any).runPasswordGatedTool,
    }
    await (AgentSession.prototype as any).dispatchClientSideTool.call(
      fakeThis,
      'call-hl',
      'hl_order',
      { order_ref: ORDER_REF },
      ui
    )
    expect(ui.requestConfirmation).toHaveBeenCalledWith(formatHlConfirmation(signingPayload))
    expect(signAndSubmitHlOrder).not.toHaveBeenCalled()
    expect(fakeThis.pendingToolResults).toEqual([])
    expect((fakeThis as any).terminalHlConfirmation).toBe(true)
  })

  it('bridges the authenticated NL backend builder frame to exact confirmation before MPC', async () => {
    const signingPayload = payload({
      summary: {
        ...payload().summary,
        leverage: 3,
        margin_mode: 'cross',
        order_type: 'market',
        tif: 'Ioc',
        price_cap: '64557.825000000004',
        limit_price: null,
        size: '0.00016',
        notional_usd: '10.32925200000000064',
      },
    })
    const marketAction = structuredClone(orderAction)
    marketAction.orders[0]!.p = '64557.825000000004'
    marketAction.orders[0]!.s = '0.00016'
    marketAction.orders[0]!.t.limit.tif = 'Ioc'
    const marketStep = {
      kind: 'order' as const,
      action: marketAction,
      nonce: 1000,
      is_mainnet: true,
    }
    signingPayload.steps = [{ ...marketStep, digest: computeHlDigest(marketStep) }]
    const signAndSubmitHlOrder = vi.fn()
    const fakeThis = {
      conversationId: CONVERSATION_ID,
      config: { password: 'pw' },
      vault: { isEncrypted: false },
      client: {},
      executor: {
        retrieveHlOrder: vi.fn(async () => signingPayload),
        signAndSubmitHlOrder,
        hasPassword: vi.fn(() => true),
      },
      pendingToolResults: [],
      runPasswordGatedTool: (AgentSession.prototype as any).runPasswordGatedTool,
    }
    const ui = {
      requestConfirmation: vi.fn(async () => false),
      requestPassword: vi.fn(),
      onToolCall: vi.fn(),
      onToolResult: vi.fn(),
    }
    const builderResult = {
      surface: 'hyperliquid_order',
      action: 'open',
      coin: 'BTC',
      asset_index: 0,
      wire_size: '0.00016',
      price_cap: '64557.825000000004',
      wire_notional_usd: '10.32925200000000064',
      tif: 'Ioc',
      reduce_only: false,
      order_ref: ORDER_REF,
      status: 'ready_to_sign',
    }
    const frames = [
      {
        type: 'tool-input-start',
        toolCallId: 'nl-hl-1',
        toolName: 'build_hyperliquid_open_position',
      },
      {
        type: 'tool-input-available',
        toolCallId: 'nl-hl-1',
        toolName: 'build_hyperliquid_open_position',
        input: { coin: 'BTC', side: 'buy', size_usd: 10, leverage: 3 },
      },
      {
        type: 'tool-output-available',
        toolCallId: 'nl-hl-1',
        output: JSON.stringify(builderResult),
      },
      { type: 'finish' },
    ]
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(
      async () =>
        new Response(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join(''), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
    ) as typeof fetch
    const dispatches: Promise<void>[] = []
    try {
      await new AgentClient('http://example.com').sendMessageStream(
        CONVERSATION_ID,
        { public_key: PUBLIC_KEY, content: 'open $10 BTC long 3x' },
        {
          onClientSideToolCall: (id, name, input) => {
            dispatches.push((AgentSession.prototype as any).dispatchClientSideTool.call(fakeThis, id, name, input, ui))
          },
        }
      )
      await Promise.all(dispatches)
    } finally {
      globalThis.fetch = originalFetch
    }

    expect(fakeThis.executor.retrieveHlOrder).toHaveBeenCalledWith(
      fakeThis.client,
      { order_ref: ORDER_REF },
      CONVERSATION_ID
    )
    expect(ui.requestConfirmation).toHaveBeenCalledWith(formatHlConfirmation(signingPayload))
    expect(formatHlConfirmation(signingPayload)).toContain('BTC (asset #0')
    expect(formatHlConfirmation(signingPayload)).toContain('0.00016')
    expect(formatHlConfirmation(signingPayload)).toContain('market max execution price $64557.825000000004')
    expect(formatHlConfirmation(signingPayload)).toContain('signed notional $10.32925200000000064')
    expect(formatHlConfirmation(signingPayload)).toContain('3x cross')
    expect(formatHlConfirmation(signingPayload)).toContain('market/Ioc')
    expect(formatHlConfirmation(signingPayload)).toContain('reduce-only=false')
    expect(signAndSubmitHlOrder).not.toHaveBeenCalled()
    expect(fakeThis.pendingToolResults).toEqual([])
    expect((fakeThis as any).terminalHlConfirmation).toBe(true)
  })

  it('terminates the authenticated AgentClient→Session ceremony after one builder/order dispatch', async () => {
    const signingPayload = payload()
    const requests: Array<{ url: string; authorization: string | null }> = []
    const frames = [
      {
        type: 'tool-input-start',
        toolCallId: 'wire-builder-1',
        toolName: 'build_hyperliquid_open_position',
      },
      {
        type: 'tool-output-available',
        toolCallId: 'wire-builder-1',
        output: JSON.stringify({
          surface: 'hyperliquid_order',
          status: 'ready_to_sign',
          action: 'open',
          coin: 'BTC',
          asset_index: 0,
          wire_size: signingPayload.summary.size,
          price_cap: signingPayload.summary.price_cap,
          wire_notional_usd: signingPayload.summary.notional_usd,
          tif: signingPayload.summary.tif,
          reduce_only: false,
          order_ref: ORDER_REF,
        }),
      },
      { type: 'finish' },
    ]
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      requests.push({
        url: String(url),
        authorization: headers.get('authorization'),
      })
      if (String(url).endsWith('/signing-payload')) {
        return new Response(JSON.stringify(signingPayload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join(''), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    }) as typeof fetch
    const client = new AgentClient('http://example.com')
    client.setAuthToken('wire-jwt')
    client.setClientSideToolNames(new Set(['hl_order']))
    const signAndSubmitHlOrder = vi.fn()
    const fakeThis: any = {
      conversationId: CONVERSATION_ID,
      publicKey: PUBLIC_KEY,
      cachedContext: {},
      config: { password: 'pw', askMode: true, verbose: false },
      pendingToolResults: [],
      abortController: null,
      terminalHlConfirmation: false,
      seenHlOrderRefs: new Set(),
      client,
      executor: {
        retrieveHlOrder: vi.fn(async (_client, input) => {
          fakeThis.pendingToolResults.push(
            { tool: 'vault_coin', success: true, data: { action: 'add', chain: 'Ethereum' } },
            { tool: 'hl_order', success: false, data: { code: 'CONFIRMATION_REQUIRED' } }
          )
          return client.retrieveHlOrderSigningPayload(String(input.order_ref), CONVERSATION_ID, PUBLIC_KEY)
        }),
        signAndSubmitHlOrder,
        hasPassword: vi.fn(() => true),
        storeServerTransaction: vi.fn(() => false),
      },
      withAuthRetry: (AgentSession.prototype as any).withAuthRetry,
      processMessageLoop: (AgentSession.prototype as any).processMessageLoop,
      dispatchClientSideTool: (AgentSession.prototype as any).dispatchClientSideTool,
      runPasswordGatedTool: (AgentSession.prototype as any).runPasswordGatedTool,
      selectAndBufferSignable: (AgentSession.prototype as any).selectAndBufferSignable,
      renderEchoedBalanceCard: (AgentSession.prototype as any).renderEchoedBalanceCard,
    }
    const ui: any = {
      onTextDelta: vi.fn(),
      onToolCall: vi.fn(),
      onToolResult: vi.fn(),
      onAssistantMessage: vi.fn(),
      onSuggestions: vi.fn(),
      onTxStatus: vi.fn(),
      onError: vi.fn(),
      onDone: vi.fn(),
      onHlOrderConfirmation: vi.fn(),
      requestPassword: vi.fn(),
      requestConfirmation: vi.fn(async () => false),
    }
    try {
      await (AgentSession.prototype as any).processMessageLoop.call(fakeThis, 'open $10 BTC long 3x', ui, 0)
    } finally {
      globalThis.fetch = originalFetch
    }
    expect(requests.filter(r => r.url.includes('/messages'))).toHaveLength(1)
    expect(requests.filter(r => r.url.endsWith('/signing-payload'))).toHaveLength(1)
    expect(requests.every(r => r.authorization === 'Bearer wire-jwt')).toBe(true)
    expect(signAndSubmitHlOrder).not.toHaveBeenCalled()
    expect(ui.onHlOrderConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        order_ref: ORDER_REF,
        status: 'confirmation_required',
      })
    )
    expect(ui.onAssistantMessage).not.toHaveBeenCalled()
    expect(fakeThis.pendingToolResults).toEqual([
      { tool: 'vault_coin', success: true, data: { action: 'add', chain: 'Ethereum' } },
    ])
  })

  it.each([
    ['refusal', false],
    ['--yes', true],
  ])('claims only the first distinct Hyperliquid order in one SSE turn under %s', async (_mode, approved) => {
    const secondOrderRef = '87654321-4321-4321-4321-cba987654321'
    const signingPayload = payload()
    const builderOutput = (orderRef: string) => ({
      surface: 'hyperliquid_order',
      status: 'ready_to_sign',
      action: 'open',
      coin: 'BTC',
      asset_index: 0,
      wire_size: signingPayload.summary.size,
      price_cap: signingPayload.summary.price_cap,
      wire_notional_usd: signingPayload.summary.notional_usd,
      tif: signingPayload.summary.tif,
      reduce_only: false,
      order_ref: orderRef,
    })
    const firstTurnFrames = [
      {
        type: 'tool-input-start',
        toolCallId: 'builder-first',
        toolName: 'build_hyperliquid_open_position',
      },
      {
        type: 'tool-output-available',
        toolCallId: 'builder-first',
        output: JSON.stringify(builderOutput(ORDER_REF)),
      },
      {
        type: 'tool-input-start',
        toolCallId: 'builder-second',
        toolName: 'build_hyperliquid_open_position',
      },
      {
        type: 'tool-output-available',
        toolCallId: 'builder-second',
        output: JSON.stringify(builderOutput(secondOrderRef)),
      },
      { type: 'finish' },
    ]
    let messageRequests = 0
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/signing-payload')) {
        return new Response(JSON.stringify(signingPayload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      messageRequests += 1
      const frames = messageRequests === 1 ? firstTurnFrames : [{ type: 'finish' }]
      return new Response(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join(''), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    }) as typeof fetch
    const client = new AgentClient('http://example.com')
    client.setAuthToken('wire-jwt')
    client.setClientSideToolNames(new Set(['hl_order']))
    const retrieveHlOrder = vi.fn(async () => signingPayload)
    const signAndSubmitHlOrder = vi.fn(async () => ({
      tool: 'hl_order',
      success: true,
      data: { order_ref: ORDER_REF, state: 'accepted' },
    }))
    const fakeThis: any = {
      conversationId: CONVERSATION_ID,
      publicKey: PUBLIC_KEY,
      cachedContext: {},
      config: { password: 'pw', askMode: true, verbose: false },
      pendingToolResults: [],
      abortController: null,
      terminalHlConfirmation: false,
      firstHlOrderRef: null,
      seenHlOrderRefs: new Set(),
      client,
      executor: {
        retrieveHlOrder,
        signAndSubmitHlOrder,
        hasPassword: vi.fn(() => true),
        storeServerTransaction: vi.fn(() => false),
      },
      withAuthRetry: (AgentSession.prototype as any).withAuthRetry,
      processMessageLoop: (AgentSession.prototype as any).processMessageLoop,
      dispatchClientSideTool: (AgentSession.prototype as any).dispatchClientSideTool,
      runPasswordGatedTool: (AgentSession.prototype as any).runPasswordGatedTool,
      selectAndBufferSignable: (AgentSession.prototype as any).selectAndBufferSignable,
      renderEchoedBalanceCard: (AgentSession.prototype as any).renderEchoedBalanceCard,
    }
    const ui: any = {
      onTextDelta: vi.fn(),
      onToolCall: vi.fn(),
      onToolResult: vi.fn(),
      onAssistantMessage: vi.fn(),
      onSuggestions: vi.fn(),
      onTxStatus: vi.fn(),
      onError: vi.fn(),
      onDone: vi.fn(),
      onHlOrderConfirmation: vi.fn(),
      requestPassword: vi.fn(),
      requestConfirmation: vi.fn(async () => approved),
    }
    try {
      await (AgentSession.prototype as any).processMessageLoop.call(fakeThis, 'open two distinct BTC orders', ui, 0)
    } finally {
      globalThis.fetch = originalFetch
    }

    expect(retrieveHlOrder).toHaveBeenCalledTimes(1)
    expect(retrieveHlOrder).toHaveBeenCalledWith(client, { order_ref: ORDER_REF }, CONVERSATION_ID)
    expect(ui.requestConfirmation).toHaveBeenCalledTimes(1)
    expect(signAndSubmitHlOrder).toHaveBeenCalledTimes(approved ? 1 : 0)
    expect(ui.onHlOrderConfirmation).toHaveBeenCalledTimes(approved ? 0 : 1)
    expect(fakeThis.firstHlOrderRef).toBe(ORDER_REF)
  })
})
