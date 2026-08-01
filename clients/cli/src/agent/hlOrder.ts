import { encode as msgpackEncode } from '@msgpack/msgpack'
import type { VaultBase } from '@vultisig/sdk'
import { Chain } from '@vultisig/sdk'
import { concat, hashTypedData, hexToBytes, keccak256 } from 'viem'

export type HlOrderSummary = {
  operation: 'open' | 'close'
  coin: string
  asset_index: number
  side: 'long' | 'short'
  size: string
  notional_usd: string
  order_type: 'market' | 'limit'
  price_cap: string
  limit_price: string | null
  tif: 'Ioc' | 'Gtc' | 'Alo'
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
  asset_binding: { coin: string; asset_index: number }
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
  state: 'submitting' | 'accepted' | 'resting' | 'filled' | 'rejected' | 'cancelled'
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
  if (!summary.coin.trim()) throw new Error('HL_INVALID_COIN')
  if (action.type !== 'order' || !Array.isArray(action.orders) || action.orders.length !== 1) {
    throw new Error('HL_INVALID_ORDER_ACTION')
  }
  const order = action.orders[0] as Record<string, unknown>
  if (!Number.isInteger(order.a) || typeof order.b !== 'boolean') throw new Error('HL_INVALID_ORDER_ACTION')
  if (order.a !== summary.asset_index) throw new Error('HL_ASSET_MISMATCH')
  if (typeof order.p !== 'string' || !Number.isFinite(Number(order.p)) || Number(order.p) <= 0) {
    throw new Error('HL_INVALID_ORDER_PRICE')
  }
  if (typeof order.s !== 'string' || !Number.isFinite(Number(order.s)) || Number(order.s) <= 0) {
    throw new Error('HL_INVALID_ORDER_SIZE')
  }
  if (summary.size !== order.s) {
    throw new Error('HL_ORDER_SIZE_MISMATCH')
  }
  if (summary.notional_usd !== multiplyDecimalStrings(order.p, order.s)) {
    throw new Error('HL_INVALID_ORDER_NOTIONAL')
  }
  if (summary.price_cap !== order.p) throw new Error('HL_ORDER_PRICE_CAP_MISMATCH')
  const tif = (order.t as { limit?: { tif?: unknown } } | undefined)?.limit?.tif
  if (tif !== summary.tif || !['Ioc', 'Gtc', 'Alo'].includes(String(tif))) throw new Error('HL_TIF_MISMATCH')
  const expectedOrderType = tif === 'Ioc' ? 'market' : 'limit'
  if (summary.order_type !== expectedOrderType) throw new Error('HL_ORDER_TYPE_MISMATCH')
  if (summary.limit_price !== (expectedOrderType === 'limit' ? order.p : null))
    throw new Error('HL_LIMIT_PRICE_MISMATCH')
  if (order.r !== summary.reduce_only) throw new Error('HL_REDUCE_ONLY_MISMATCH')
  if (summary.operation === 'close' && order.r !== true) throw new Error('HL_CLOSE_NOT_REDUCE_ONLY')
  const expectedBuy = summary.operation === 'open' ? summary.side === 'long' : summary.side === 'short'
  if (order.b !== expectedBuy) throw new Error('HL_ORDER_SIDE_MISMATCH')
}

export function multiplyDecimalStrings(left: unknown, right: unknown): string {
  const parse = (value: unknown): { digits: bigint; scale: number } => {
    if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) throw new Error('HL_INVALID_DECIMAL')
    const [whole, fraction = ''] = value.split('.')
    return { digits: BigInt(`${whole}${fraction}`), scale: fraction.length }
  }
  const a = parse(left)
  const b = parse(right)
  const scale = a.scale + b.scale
  const raw = (a.digits * b.digits).toString().padStart(scale + 1, '0')
  if (scale === 0) return raw
  const whole = raw.slice(0, -scale)
  const fraction = raw.slice(-scale).replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole
}

function validateLeverageAction(action: Record<string, unknown>, summary: HlOrderSummary): void {
  if (action.type !== 'updateLeverage' || !Number.isInteger(action.asset) || !Number.isInteger(action.leverage)) {
    throw new Error('HL_INVALID_LEVERAGE_ACTION')
  }
  if (typeof action.isCross !== 'boolean' || action.leverage !== summary.leverage) {
    throw new Error('HL_LEVERAGE_MISMATCH')
  }
  if (action.asset !== summary.asset_index) throw new Error('HL_LEVERAGE_ASSET_MISMATCH')
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
  if (payload.summary.operation === 'open') {
    if (
      payload.steps.length !== 2 ||
      payload.steps[0]?.kind !== 'update_leverage' ||
      payload.steps[1]?.kind !== 'order' ||
      leverageSteps.length !== 1 ||
      orderSteps.length !== 1 ||
      payload.summary.leverage === undefined ||
      payload.summary.margin_mode === undefined
    ) throw new Error('HL_INVALID_OPEN_CEREMONY')
  } else if (
    payload.steps.length !== 1 ||
    payload.steps[0]?.kind !== 'order' ||
    orderSteps.length !== 1 ||
    leverageSteps.length !== 0 ||
    payload.summary.leverage !== undefined ||
    payload.summary.margin_mode !== undefined ||
    payload.summary.reduce_only !== true
  ) throw new Error('HL_INVALID_CLOSE_CEREMONY')
  if (
    payload.asset_binding.coin !== payload.summary.coin ||
    payload.asset_binding.asset_index !== payload.summary.asset_index
  )
    throw new Error('HL_ASSET_BINDING_MISMATCH')

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
  const price = s.limit_price === null ? `market max execution price $${s.price_cap}` : `limit $${s.limit_price}`
  return `Hyperliquid ${s.operation} ${s.side} ${s.size} ${s.coin} (asset #${s.asset_index}, signed notional $${s.notional_usd})${leverage}; ${s.order_type}/${s.tif}, ${price}, reduce-only=${s.reduce_only}. This signs and submits a live leveraged order.`
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
  if (initial.state !== 'accepted' && initial.state !== 'submitting') return initial
  const attempts = options.attempts ?? 20
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  let status = initial
  for (let i = 1; i < attempts && (status.state === 'accepted' || status.state === 'submitting'); i++) {
    await sleep(options.intervalMs ?? 1_000)
    status = await transport.getHlOrderStatus(params.orderRef, params.conversationId, params.publicKey)
  }
  return status
}

export function isHlOrderFailure(status: HlOrderStatus): boolean {
  return status.state === 'rejected' || status.state === 'cancelled'
}
