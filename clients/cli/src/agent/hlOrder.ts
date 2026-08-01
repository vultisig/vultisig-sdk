import { encode as msgpackEncode } from '@msgpack/msgpack'
import type { VaultBase } from '@vultisig/sdk'
import { Chain } from '@vultisig/sdk'
import { concat, hashTypedData, hexToBytes, keccak256 } from 'viem'

export type HlOrderSummary = {
  operation: 'open' | 'close'
  coin: string
  side: 'long' | 'short'
  size: string
  notional_usd: string
  reduce_only: boolean
  leverage?: number
  margin_mode?: 'cross' | 'isolated'
}

export type HlSigningStep = {
  kind: 'update_leverage' | 'order'
  action: Record<string, unknown>
  nonce: number
  vault_address?: string
  is_mainnet: boolean
  digest: `0x${string}`
}

export type HlOrderSigningPayload = {
  order_ref: string
  conversation_id: string
  owner_public_key: string
  vault_address: string
  expires_at: string
  summary: HlOrderSummary
  steps: HlSigningStep[]
}

export type HlOrderSignature = {
  kind: HlSigningStep['kind']
  digest: `0x${string}`
  r: `0x${string}`
  s: `0x${string}`
  v: number
}

export type HlOrderStatus = {
  state: 'accepted' | 'resting' | 'filled' | 'rejected' | 'cancelled'
  order_id?: string
  filled_size?: string
  average_price?: string
  reason?: string
}

export type HlOrderTransport = {
  retrieveHlOrderSigningPayload(
    orderRef: string,
    conversationId: string,
    publicKey: string
  ): Promise<HlOrderSigningPayload>
  submitHlOrder(
    orderRef: string,
    conversationId: string,
    publicKey: string,
    signatures: HlOrderSignature[]
  ): Promise<HlOrderStatus>
  getHlOrderStatus(orderRef: string, conversationId: string, publicKey: string): Promise<HlOrderStatus>
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const
const HL_AGENT_TYPES = {
  Agent: [
    { name: 'source', type: 'string' },
    { name: 'connectionId', type: 'bytes32' },
  ],
} as const

function nonceBytes(nonce: number): Uint8Array {
  if (!Number.isSafeInteger(nonce) || nonce < 0) throw new Error('HL_INVALID_NONCE')
  const bytes = new Uint8Array(8)
  let value = BigInt(nonce)
  for (let i = 7; i >= 0; i--) {
    bytes[i] = Number(value & 0xffn)
    value >>= 8n
  }
  return bytes
}

function vaultMarker(vaultAddress?: string): Uint8Array {
  if (!vaultAddress) return new Uint8Array([0])
  if (!/^0x[0-9a-f]{40}$/i.test(vaultAddress)) throw new Error('HL_INVALID_VAULT_ADDRESS')
  return concat([new Uint8Array([1]), hexToBytes(vaultAddress as `0x${string}`)])
}

export function computeHlDigest(step: Omit<HlSigningStep, 'digest' | 'kind'>): `0x${string}` {
  const packed = msgpackEncode(step.action, { forceIntegerToFloat: false })
  const connectionId = keccak256(concat([packed, nonceBytes(step.nonce), vaultMarker(step.vault_address)]))
  return hashTypedData({
    domain: {
      name: 'Exchange',
      version: '1',
      chainId: 1337,
      verifyingContract: ZERO_ADDRESS,
    },
    types: HL_AGENT_TYPES,
    primaryType: 'Agent',
    message: { source: step.is_mainnet ? 'a' : 'b', connectionId },
  })
}

function validateOrderAction(action: Record<string, unknown>, summary: HlOrderSummary): void {
  if (action.type !== 'order' || !Array.isArray(action.orders) || action.orders.length !== 1) {
    throw new Error('HL_INVALID_ORDER_ACTION')
  }
  const order = action.orders[0] as Record<string, unknown>
  if (!Number.isInteger(order.a) || typeof order.b !== 'boolean') throw new Error('HL_INVALID_ORDER_ACTION')
  if (typeof order.p !== 'string' || !Number.isFinite(Number(order.p)) || Number(order.p) <= 0) {
    throw new Error('HL_INVALID_ORDER_PRICE')
  }
  if (typeof order.s !== 'string' || !Number.isFinite(Number(order.s)) || Number(order.s) <= 0) {
    throw new Error('HL_INVALID_ORDER_SIZE')
  }
  if (!Number.isFinite(Number(summary.size)) || Number(summary.size) !== Number(order.s)) {
    throw new Error('HL_ORDER_SIZE_MISMATCH')
  }
  if (!Number.isFinite(Number(summary.notional_usd)) || Number(summary.notional_usd) <= 0) {
    throw new Error('HL_INVALID_ORDER_NOTIONAL')
  }
  if (order.r !== summary.reduce_only) throw new Error('HL_REDUCE_ONLY_MISMATCH')
  if (summary.operation === 'close' && order.r !== true) throw new Error('HL_CLOSE_NOT_REDUCE_ONLY')
  const expectedBuy = summary.operation === 'open' ? summary.side === 'long' : summary.side === 'short'
  if (order.b !== expectedBuy) throw new Error('HL_ORDER_SIDE_MISMATCH')
}

function validateLeverageAction(action: Record<string, unknown>, summary: HlOrderSummary): void {
  if (action.type !== 'updateLeverage' || !Number.isInteger(action.asset) || !Number.isInteger(action.leverage)) {
    throw new Error('HL_INVALID_LEVERAGE_ACTION')
  }
  if (typeof action.isCross !== 'boolean' || action.leverage !== summary.leverage) {
    throw new Error('HL_LEVERAGE_MISMATCH')
  }
  if ((action.leverage as number) < 1 || (action.leverage as number) > 100) {
    throw new Error('HL_INVALID_LEVERAGE')
  }
  const expectedCross = summary.margin_mode !== 'isolated'
  if (action.isCross !== expectedCross) throw new Error('HL_MARGIN_MODE_MISMATCH')
}

export async function validateHlSigningPayload(
  payload: HlOrderSigningPayload,
  expected: {
    orderRef: string
    conversationId: string
    publicKey: string
    digest?: string
  },
  vault: VaultBase,
  now = Date.now()
): Promise<void> {
  if (payload.order_ref !== expected.orderRef || payload.conversation_id !== expected.conversationId) {
    throw new Error('HL_REFERENCE_MISMATCH')
  }
  if (payload.owner_public_key.toLowerCase() !== expected.publicKey.toLowerCase()) throw new Error('HL_OWNER_MISMATCH')
  const localAddress = await vault.address(Chain.Ethereum)
  if (payload.vault_address.toLowerCase() !== localAddress.toLowerCase()) throw new Error('HL_VAULT_ADDRESS_MISMATCH')
  const expiry = Date.parse(payload.expires_at)
  if (!Number.isFinite(expiry) || expiry <= now) throw new Error('HL_ORDER_EXPIRED')
  if (expiry - now > 10 * 60_000) throw new Error('HL_EXPIRY_OUT_OF_RANGE')
  if (payload.steps.length < 1 || payload.steps.length > 2) throw new Error('HL_INVALID_STEP_COUNT')
  const orderSteps = payload.steps.filter(step => step.kind === 'order')
  const leverageSteps = payload.steps.filter(step => step.kind === 'update_leverage')
  if (orderSteps.length !== 1 || leverageSteps.length > 1) throw new Error('HL_INVALID_STEP_SEQUENCE')
  if (payload.summary.leverage !== undefined && leverageSteps.length !== 1) throw new Error('HL_LEVERAGE_NOT_APPLIED')
  if (leverageSteps.length && payload.steps[0]?.kind !== 'update_leverage') throw new Error('HL_INVALID_STEP_SEQUENCE')

  for (const step of payload.steps) {
    const computed = computeHlDigest(step)
    if (computed.toLowerCase() !== step.digest.toLowerCase()) throw new Error('HL_DIGEST_MISMATCH')
    if (step.kind === 'order') validateOrderAction(step.action, payload.summary)
    else validateLeverageAction(step.action, payload.summary)
  }
  if (expected.digest && orderSteps[0]?.digest.toLowerCase() !== expected.digest.toLowerCase()) {
    throw new Error('HL_EXPECTED_DIGEST_MISMATCH')
  }
}

export function formatHlConfirmation(payload: HlOrderSigningPayload): string {
  const s = payload.summary
  const leverage = s.leverage === undefined ? '' : ` at ${s.leverage}x ${s.margin_mode ?? 'cross'}`
  return `Hyperliquid ${s.operation} ${s.side} ${s.size} ${s.coin} (~$${s.notional_usd})${leverage}; reduce-only=${s.reduce_only}. This signs and submits a live leveraged order.`
}

export async function pollHlOrderStatus(
  transport: HlOrderTransport,
  params: { orderRef: string; conversationId: string; publicKey: string },
  initial: HlOrderStatus,
  options: {
    attempts?: number
    intervalMs?: number
    sleep?: (ms: number) => Promise<void>
  } = {}
): Promise<HlOrderStatus> {
  if (initial.state !== 'accepted') return initial
  const attempts = options.attempts ?? 20
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  let status = initial
  for (let i = 1; i < attempts && status.state === 'accepted'; i++) {
    await sleep(options.intervalMs ?? 1_000)
    status = await transport.getHlOrderStatus(params.orderRef, params.conversationId, params.publicKey)
  }
  return status
}

export function isHlOrderFailure(status: HlOrderStatus): boolean {
  return status.state === 'rejected' || status.state === 'cancelled'
}
