import { Chain } from '@vultisig/core-chain/Chain'
import type { ChainKind } from '@vultisig/core-chain/ChainKind'
import { z } from 'zod'

export const SIGNABLE_TRANSACTION_VERSION = 1 as const

const nonEmptyString = z.string().trim().min(1)
const decimalInteger = z.string().regex(/^(0|[1-9]\d*)$/, 'Expected a non-negative base-10 integer string')
const sha256Digest = z.string().regex(/^sha256:[0-9a-f]{64}$/, 'Expected a lowercase sha256:<hex> digest')
export const signableUtcTimestampV1Schema = z
  .string()
  .datetime({ offset: false, precision: 3 })
  .refine(value => value.endsWith('Z'), 'Expected a canonical UTC timestamp')
const chainSchema = z.enum(Object.values(Chain) as [Chain, ...Chain[]])
const base64Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export const signableAssetV1Schema = z
  .object({
    chain: chainSchema,
    symbol: nonEmptyString,
    tokenId: nonEmptyString.optional(),
  })
  .strict()

const signableNativeAssetV1Schema = z
  .object({
    chain: chainSchema,
    symbol: nonEmptyString,
  })
  .strict()

const signableActionBase = {
  chain: chainSchema,
  sourceAccount: nonEmptyString,
}

const sendAction = z
  .object({
    type: z.literal('send'),
    ...signableActionBase,
    recipient: nonEmptyString,
    asset: signableNativeAssetV1Schema,
    amount: decimalInteger,
    memo: z.string().optional(),
  })
  .strict()

const tokenSendAction = z
  .object({
    type: z.literal('token-send'),
    ...signableActionBase,
    recipient: nonEmptyString,
    asset: signableAssetV1Schema.extend({ tokenId: nonEmptyString }),
    amount: decimalInteger,
    memo: z.string().optional(),
  })
  .strict()

const approvalAction = z
  .object({
    type: z.literal('approval'),
    ...signableActionBase,
    asset: signableAssetV1Schema.extend({ tokenId: nonEmptyString }),
    spender: nonEmptyString,
    allowance: decimalInteger,
  })
  .strict()

const swapAction = z
  .object({
    type: z.literal('swap'),
    ...signableActionBase,
    recipient: nonEmptyString,
    fromAsset: signableAssetV1Schema,
    toAsset: signableAssetV1Schema,
    amount: decimalInteger,
    minOut: decimalInteger,
    memo: z.string().optional(),
  })
  .strict()

const contractCallAction = z
  .object({
    type: z.literal('contract-call'),
    ...signableActionBase,
    contract: nonEmptyString,
    calldataHash: sha256Digest,
    value: decimalInteger,
    method: nonEmptyString.optional(),
  })
  .strict()

const depositAction = z
  .object({
    type: z.literal('deposit'),
    ...signableActionBase,
    protocol: nonEmptyString,
    recipient: nonEmptyString,
    asset: signableAssetV1Schema,
    amount: decimalInteger,
    memo: z.string().optional(),
  })
  .strict()

const withdrawAction = z
  .object({
    type: z.literal('withdraw'),
    ...signableActionBase,
    protocol: nonEmptyString,
    recipient: nonEmptyString,
    asset: signableAssetV1Schema,
    amount: decimalInteger,
    positionId: nonEmptyString.optional(),
    minOut: decimalInteger.optional(),
  })
  .strict()

const redeemAction = z
  .object({
    type: z.literal('redeem'),
    ...signableActionBase,
    protocol: nonEmptyString,
    recipient: nonEmptyString,
    asset: signableAssetV1Schema,
    amount: decimalInteger,
    positionId: nonEmptyString,
    minOut: decimalInteger.optional(),
  })
  .strict()

export const signableActionV1Schema = z.discriminatedUnion('type', [
  sendAction,
  tokenSendAction,
  approvalAction,
  swapAction,
  contractCallAction,
  depositAction,
  withdrawAction,
  redeemAction,
])

export const signableIntentV1Schema = z.enum([
  'send',
  'token-send',
  'approval',
  'swap',
  'contract-call',
  'deposit',
  'withdraw',
  'redeem',
  'batch',
])

export const signableUnsignedPayloadV1Schema = z
  .object({
    encoding: z.enum(['hex', 'base64', 'utf8']),
    value: z.string().min(1),
  })
  .strict()
  .superRefine((payload, context) => {
    if (payload.encoding === 'hex' && (!/^(?:[0-9a-f]{2})*$/.test(payload.value) || payload.value.length === 0)) {
      context.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'Hex payloads must be non-empty, lowercase, even-length bytes without a 0x prefix',
      })
    }
    if (payload.encoding === 'base64') {
      const hasCanonicalShape =
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload.value) &&
        payload.value.length > 0
      const padding = payload.value.endsWith('==') ? 2 : payload.value.endsWith('=') ? 1 : 0
      const lastDataIndex = payload.value.length - padding - 1
      const lastSextet = hasCanonicalShape ? base64Alphabet.indexOf(payload.value[lastDataIndex]!) : -1
      const hasCanonicalPaddingBits =
        padding === 2 ? (lastSextet & 0x0f) === 0 : padding === 1 ? (lastSextet & 0x03) === 0 : true

      if (!hasCanonicalShape || !hasCanonicalPaddingBits) {
        context.addIssue({
          code: 'custom',
          path: ['value'],
          message: 'Base64 payloads must use canonical padded base64 with zero unused padding bits',
        })
      }
    }
  })

export const signableMaterialFieldV1Schema = z
  .object({
    key: nonEmptyString,
    value: z.string(),
  })
  .strict()

const boundedDecimal = z
  .object({
    value: decimalInteger,
    min: decimalInteger,
    max: decimalInteger,
  })
  .strict()

export const signableDisplayV1Schema = z
  .object({
    materialFields: z.array(signableMaterialFieldV1Schema).min(1),
    constraints: z
      .object({
        fee: boundedDecimal.extend({ asset: signableAssetV1Schema }).optional(),
        slippageBps: boundedDecimal.optional(),
      })
      .strict(),
  })
  .strict()

export const signableApprovalV1Schema = z
  .object({
    id: nonEmptyString,
    nonce: nonEmptyString,
    bindingHash: sha256Digest,
  })
  .strict()

export const signableApprovalInputV1Schema = signableApprovalV1Schema.pick({ id: true, nonce: true })

export const signableTransactionEnvelopeV1Schema = z
  .object({
    version: z.literal(SIGNABLE_TRANSACTION_VERSION),
    intent: signableIntentV1Schema,
    chain: chainSchema,
    sourceAccount: nonEmptyString,
    unsignedPayload: signableUnsignedPayloadV1Schema,
    payloadHash: sha256Digest,
    actions: z.array(signableActionV1Schema).min(1),
    display: signableDisplayV1Schema,
    displayHash: sha256Digest,
    expiresAt: signableUtcTimestampV1Schema,
    approval: signableApprovalV1Schema,
  })
  .strict()

export const signableDecodedTransactionV1Schema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('decoded'),
      actions: z.array(signableActionV1Schema).min(1),
      constraints: z
        .object({
          fee: z.object({ asset: signableAssetV1Schema, value: decimalInteger }).strict().optional(),
          slippageBps: decimalInteger.optional(),
        })
        .strict()
        .default({}),
    })
    .strict(),
  z
    .object({
      status: z.literal('unknown'),
      reason: nonEmptyString,
      code: nonEmptyString.optional(),
    })
    .strict(),
])

export type SignableAssetV1 = z.infer<typeof signableAssetV1Schema>
export type SignableActionV1 = z.infer<typeof signableActionV1Schema>
export type SignableIntentV1 = z.infer<typeof signableIntentV1Schema>
export type SignableUnsignedPayloadV1 = z.infer<typeof signableUnsignedPayloadV1Schema>
export type SignableMaterialFieldV1 = z.infer<typeof signableMaterialFieldV1Schema>
export type SignableDisplayV1 = z.infer<typeof signableDisplayV1Schema>
export type SignableApprovalV1 = z.infer<typeof signableApprovalV1Schema>
export type SignableTransactionEnvelopeV1 = z.infer<typeof signableTransactionEnvelopeV1Schema>
export type SignableDecodedTransactionV1 = z.infer<typeof signableDecodedTransactionV1Schema>
export type SignableTransactionChainFamily = ChainKind

export type SignableDisplayBoundsV1 = {
  fee?: { min: string; max: string }
  slippageBps?: { min: string; max: string }
}

export type SignableApprovalInputV1 = z.infer<typeof signableApprovalInputV1Schema>
