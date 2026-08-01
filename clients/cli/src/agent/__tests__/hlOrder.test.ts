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
    },
    asset_binding: { coin: 'BTC', asset_index: 0 },
    steps: [{ ...orderStep, digest: computeHlDigest(orderStep) }],
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
  it('matches the backend/Python reference digest exactly', () => {
    expect(payload().steps[0]?.digest).toBe('0x670fb12c6b39e9d2469fe74bb5fae5db5cb51051ec4882a9b7e1064fbd07a1ab')
  })

  it('accepts a bound, unexpired open payload', async () => {
    await expect(validateHlSigningPayload(payload(), expected, vault())).resolves.toBeUndefined()
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
    ;(tampered.steps[0]!.action.orders as Array<Record<string, unknown>>)[0]!.s = '1.0'
    await expect(validateHlSigningPayload(tampered, expected, vault())).rejects.toThrow('HL_DIGEST_MISMATCH')
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

  it('requires a real leverage-update step before an order advertised at leverage', async () => {
    const missing = payload({
      summary: { ...payload().summary, leverage: 5, margin_mode: 'cross' },
    })
    await expect(validateHlSigningPayload(missing, expected, vault())).rejects.toThrow('HL_LEVERAGE_NOT_APPLIED')

    const leverage = {
      type: 'updateLeverage',
      asset: 0,
      isCross: true,
      leverage: 5,
    }
    const leverageStep = {
      kind: 'update_leverage' as const,
      action: leverage,
      nonce: 999,
      is_mainnet: true,
    }
    const complete = payload({
      summary: { ...payload().summary, leverage: 5, margin_mode: 'cross' },
      steps: [{ ...leverageStep, digest: computeHlDigest(leverageStep) }, payload().steps[0]!],
    })
    await expect(validateHlSigningPayload(complete, expected, vault())).resolves.toBeUndefined()
  })

  it('requires every close to be reduce-only', async () => {
    const close = payload({
      summary: { ...payload().summary, operation: 'close', reduce_only: true },
    })
    await expect(validateHlSigningPayload(close, expected, vault())).rejects.toThrow('HL_REDUCE_ONLY_MISMATCH')
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
      { order_ref: ORDER_REF, digest: signingPayload.steps[0]!.digest },
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
        kind: 'order',
        digest: signingPayload.steps[0]!.digest,
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
    expect(formatHlConfirmation(p)).toContain('asset #0')
    expect(formatHlConfirmation(p)).toContain('signed notional $30')
    expect(formatHlConfirmation(p)).toContain('limit/Gtc')
    expect(formatHlConfirmation(p)).toContain('limit $30000.0')
    expect(formatHlConfirmation(p)).toContain('signs and submits a live leveraged order')
    expect(formatHlConfirmation(p)).toContain('reduce-only=false')
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
      steps: [{ ...marketStep, digest: computeHlDigest(marketStep) }],
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
    expect(fakeThis.pendingToolResults[0]).toMatchObject({
      tool: 'hl_order',
      success: false,
      data: { code: 'CONFIRMATION_REQUIRED' },
    })
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
    const marketStep = { kind: 'order' as const, action: marketAction, nonce: 1000, is_mainnet: true }
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
      { type: 'tool-input-start', toolCallId: 'nl-hl-1', toolName: 'build_hyperliquid_open_position' },
      {
        type: 'tool-input-available',
        toolCallId: 'nl-hl-1',
        toolName: 'build_hyperliquid_open_position',
        input: { coin: 'BTC', side: 'buy', size_usd: 10, leverage: 3 },
      },
      { type: 'tool-output-available', toolCallId: 'nl-hl-1', output: JSON.stringify(builderResult) },
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
    expect(fakeThis.pendingToolResults).toEqual([
      expect.objectContaining({
        tool: 'hl_order',
        success: false,
        data: expect.objectContaining({ code: 'CONFIRMATION_REQUIRED' }),
      }),
    ])
  })
})
