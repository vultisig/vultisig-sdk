import type { Chain } from '@vultisig/core-chain/Chain'
import { getChainKind } from '@vultisig/core-chain/ChainKind'

import {
  canonicalizeSignableTransactionValue,
  hashSignableTransactionValue,
  hashSignableUnsignedPayloadV1,
} from './canonical'
import type {
  SignableActionV1,
  SignableApprovalInputV1,
  SignableApprovalV1,
  SignableDecodedTransactionV1,
  SignableDisplayBoundsV1,
  SignableDisplayV1,
  SignableIntentV1,
  SignableMaterialFieldV1,
  SignableTransactionChainFamily,
  SignableTransactionEnvelopeV1,
  SignableUnsignedPayloadV1,
} from './schema'
import {
  SIGNABLE_TRANSACTION_VERSION,
  signableActionV1Schema,
  signableApprovalInputV1Schema,
  signableApprovalV1Schema,
  signableDecodedTransactionV1Schema,
  signableDisplayV1Schema,
  signableTransactionEnvelopeV1Schema,
  signableUnsignedPayloadV1Schema,
  signableUtcTimestampV1Schema,
} from './schema'

type MaybePromise<T> = T | Promise<T>

const stripUndefinedValues = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripUndefinedValues)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, stripUndefinedValues(entry)])
  )
}

export type SignableTransactionDecodeContextV1 = {
  version: typeof SIGNABLE_TRANSACTION_VERSION
  chain: Chain
  sourceAccount: string
}

/**
 * A chain-family adapter deliberately has two phases. `decode` may return a
 * native AST; `normalize` must either produce the complete canonical action
 * union or explicitly return `unknown`. Partial semantics never become an
 * approved ordinary action.
 */
export type SignableTransactionDecoderV1<NativeDecoded = unknown> = {
  readonly family: SignableTransactionChainFamily
  decode(payload: SignableUnsignedPayloadV1, context: SignableTransactionDecodeContextV1): MaybePromise<NativeDecoded>
  normalize(
    decoded: NativeDecoded,
    context: SignableTransactionDecodeContextV1
  ): MaybePromise<SignableDecodedTransactionV1>
}

export class SignableTransactionContractError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'chain-family-mismatch'
      | 'unknown-semantics'
      | 'invalid-action'
      | 'action-context-mismatch'
      | 'intent-mismatch'
      | 'constraint-out-of-bounds'
  ) {
    super(message)
    this.name = 'SignableTransactionContractError'
  }
}

const exactEqual = (left: unknown, right: unknown): boolean =>
  canonicalizeSignableTransactionValue(left as never) === canonicalizeSignableTransactionValue(right as never)

const compareDecimal = (left: string, right: string): number => {
  const leftValue = BigInt(left)
  const rightValue = BigInt(right)
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0
}

const assertWithinBounds = (name: string, value: string, min: string, max: string): void => {
  if (compareDecimal(min, max) > 0 || compareDecimal(value, min) < 0 || compareDecimal(value, max) > 0) {
    throw new SignableTransactionContractError(
      `${name} value ${value} is outside the explicitly displayed bounds ${min}..${max}`,
      'constraint-out-of-bounds'
    )
  }
}

const flattenMaterialValue = (value: unknown, prefix: string, output: SignableMaterialFieldV1[]): void => {
  if (value === undefined) return
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    output.push({ key: prefix, value: String(value) })
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => flattenMaterialValue(entry, `${prefix}.${index}`, output))
    return
  }
  Object.keys(value as Record<string, unknown>)
    .sort()
    .forEach(key => flattenMaterialValue((value as Record<string, unknown>)[key], `${prefix}.${key}`, output))
}

export const getSignableMaterialFieldsV1 = (input: {
  intent: SignableIntentV1
  chain: Chain
  sourceAccount: string
  expiresAt: string
  actions: readonly SignableActionV1[]
}): SignableMaterialFieldV1[] => {
  const fields: SignableMaterialFieldV1[] = [
    { key: 'intent', value: input.intent },
    { key: 'chain', value: input.chain },
    { key: 'sourceAccount', value: input.sourceAccount },
    { key: 'expiresAt', value: input.expiresAt },
  ]
  input.actions.forEach((action, index) => flattenMaterialValue(action, `actions.${index}`, fields))
  return fields
}

const buildDisplay = (
  context: { intent: SignableIntentV1; chain: Chain; sourceAccount: string; expiresAt: string },
  decoded: Extract<SignableDecodedTransactionV1, { status: 'decoded' }>,
  bounds: SignableDisplayBoundsV1 = {}
): SignableDisplayV1 => {
  const constraints: SignableDisplayV1['constraints'] = {}

  if (decoded.constraints.fee) {
    if (decoded.constraints.fee.asset.chain !== context.chain) {
      throw new SignableTransactionContractError(
        'Decoded fee asset does not match the envelope chain',
        'action-context-mismatch'
      )
    }
    const feeBounds = bounds.fee ?? { min: decoded.constraints.fee.value, max: decoded.constraints.fee.value }
    assertWithinBounds('fee', decoded.constraints.fee.value, feeBounds.min, feeBounds.max)
    constraints.fee = { ...decoded.constraints.fee, ...feeBounds }
  } else if (bounds.fee) {
    throw new SignableTransactionContractError(
      'Fee bounds were supplied without a decoded fee value',
      'constraint-out-of-bounds'
    )
  }

  if (decoded.constraints.slippageBps !== undefined) {
    const slippageBounds = bounds.slippageBps ?? {
      min: decoded.constraints.slippageBps,
      max: decoded.constraints.slippageBps,
    }
    assertWithinBounds('slippageBps', decoded.constraints.slippageBps, slippageBounds.min, slippageBounds.max)
    constraints.slippageBps = { value: decoded.constraints.slippageBps, ...slippageBounds }
  } else if (bounds.slippageBps) {
    throw new SignableTransactionContractError(
      'Slippage bounds were supplied without a decoded slippage value',
      'constraint-out-of-bounds'
    )
  }

  return signableDisplayV1Schema.parse({
    materialFields: getSignableMaterialFieldsV1({ ...context, actions: decoded.actions }),
    constraints,
  })
}

/**
 * Canonical approval/display binding. Material fields and bounds are exact;
 * current fee/slippage values are checked against those bounds separately.
 */
export const hashSignableDisplayV1 = (displayInput: SignableDisplayV1): `sha256:${string}` => {
  const display = signableDisplayV1Schema.parse(stripUndefinedValues(displayInput))
  return hashSignableTransactionValue({
    materialFields: display.materialFields,
    constraints: {
      ...(display.constraints.fee
        ? {
            fee: {
              asset: display.constraints.fee.asset,
              min: display.constraints.fee.min,
              max: display.constraints.fee.max,
            },
          }
        : {}),
      ...(display.constraints.slippageBps
        ? {
            slippageBps: {
              min: display.constraints.slippageBps.min,
              max: display.constraints.slippageBps.max,
            },
          }
        : {}),
    },
  })
}

const assertActionContext = (
  actions: readonly SignableActionV1[],
  context: SignableTransactionDecodeContextV1,
  intent: SignableIntentV1
): void => {
  actions.forEach((action, index) => {
    const parsed = signableActionV1Schema.safeParse(action)
    if (!parsed.success) {
      throw new SignableTransactionContractError(
        `Decoded action ${index} does not satisfy the v1 action schema: ${parsed.error.message}`,
        'invalid-action'
      )
    }
    if (
      action.chain !== context.chain ||
      action.sourceAccount !== context.sourceAccount ||
      ('asset' in action && action.asset.chain !== context.chain)
    ) {
      throw new SignableTransactionContractError(
        `Decoded action ${index} does not match the envelope chain/source account`,
        'action-context-mismatch'
      )
    }
    if ('fromAsset' in action && action.fromAsset.chain !== context.chain) {
      throw new SignableTransactionContractError(
        `Decoded swap action ${index} source asset does not match the envelope chain`,
        'action-context-mismatch'
      )
    }
  })

  if (intent === 'batch') {
    if (actions.length < 2) {
      throw new SignableTransactionContractError(
        'Batch intent requires at least two decoded actions',
        'intent-mismatch'
      )
    }
  } else if (actions.length !== 1 || actions[0]?.type !== intent) {
    throw new SignableTransactionContractError(
      `Intent ${intent} must decode to exactly one matching action`,
      'intent-mismatch'
    )
  }
}

export const decodeSignableTransactionV1 = async <NativeDecoded>(input: {
  decoder: SignableTransactionDecoderV1<NativeDecoded>
  payload: SignableUnsignedPayloadV1
  chain: Chain
  sourceAccount: string
}): Promise<SignableDecodedTransactionV1> => {
  const payload = signableUnsignedPayloadV1Schema.parse(input.payload)
  const expectedFamily = getChainKind(input.chain)
  if (input.decoder.family !== expectedFamily) {
    throw new SignableTransactionContractError(
      `Decoder family ${input.decoder.family} cannot decode ${input.chain} (${expectedFamily})`,
      'chain-family-mismatch'
    )
  }
  const context: SignableTransactionDecodeContextV1 = {
    version: SIGNABLE_TRANSACTION_VERSION,
    chain: input.chain,
    sourceAccount: input.sourceAccount,
  }
  const nativeDecoded = await input.decoder.decode(payload, context)
  const decoded = signableDecodedTransactionV1Schema.parse(await input.decoder.normalize(nativeDecoded, context))
  return signableDecodedTransactionV1Schema.parse(stripUndefinedValues(decoded))
}

const approvalBindingHash = (input: {
  approval: SignableApprovalInputV1
  payloadHash: string
  displayHash: string
  expiresAt: string
  intent: SignableIntentV1
  chain: Chain
  sourceAccount: string
}): `sha256:${string}` =>
  hashSignableTransactionValue({
    version: SIGNABLE_TRANSACTION_VERSION,
    approvalId: input.approval.id,
    approvalNonce: input.approval.nonce,
    payloadHash: input.payloadHash,
    displayHash: input.displayHash,
    expiresAt: input.expiresAt,
    intent: input.intent,
    chain: input.chain,
    sourceAccount: input.sourceAccount,
  })

export const getSignableApprovalBindingKeyV1 = (approval: SignableApprovalInputV1): string =>
  hashSignableTransactionValue({
    version: SIGNABLE_TRANSACTION_VERSION,
    ...signableApprovalInputV1Schema.parse({ id: approval.id, nonce: approval.nonce }),
  })

export const createSignableTransactionEnvelopeV1 = async <NativeDecoded>(input: {
  intent: SignableIntentV1
  chain: Chain
  sourceAccount: string
  unsignedPayload: SignableUnsignedPayloadV1
  expiresAt: string
  approval: SignableApprovalInputV1
  decoder: SignableTransactionDecoderV1<NativeDecoded>
  displayBounds?: SignableDisplayBoundsV1
}): Promise<SignableTransactionEnvelopeV1> => {
  const unsignedPayload = signableUnsignedPayloadV1Schema.parse(input.unsignedPayload)
  const approvalInput = signableApprovalInputV1Schema.parse(input.approval)
  const decoded = await decodeSignableTransactionV1({
    decoder: input.decoder,
    payload: unsignedPayload,
    chain: input.chain,
    sourceAccount: input.sourceAccount,
  })
  if (decoded.status === 'unknown') {
    throw new SignableTransactionContractError(
      `Cannot approve unknown or incomplete transaction semantics: ${decoded.reason}`,
      'unknown-semantics'
    )
  }
  assertActionContext(
    decoded.actions,
    { version: SIGNABLE_TRANSACTION_VERSION, chain: input.chain, sourceAccount: input.sourceAccount },
    input.intent
  )

  const display = buildDisplay(input, decoded, input.displayBounds)
  const payloadHash = hashSignableUnsignedPayloadV1(unsignedPayload)
  const displayHash = hashSignableDisplayV1(display)
  const approval = {
    ...approvalInput,
    bindingHash: approvalBindingHash({ ...input, approval: approvalInput, payloadHash, displayHash }),
  }

  return signableTransactionEnvelopeV1Schema.parse({
    version: SIGNABLE_TRANSACTION_VERSION,
    intent: input.intent,
    chain: input.chain,
    sourceAccount: input.sourceAccount,
    unsignedPayload,
    payloadHash,
    actions: decoded.actions,
    display,
    displayHash,
    expiresAt: input.expiresAt,
    approval,
  })
}

export const SIGNABLE_VERIFICATION_ISSUE_CODES_V1 = [
  'invalid-envelope',
  'payload-divergence',
  'display-divergence',
  'decoded-actions-divergence',
  'chain-family-mismatch',
  'unknown-semantics',
  'constraint-out-of-bounds',
  'expired',
  'approval-divergence',
  'approval-binding-divergence',
  'approval-replay',
  'approval-reservation-failed',
  'invalid-verification-input',
] as const

export type SignableVerificationIssueCodeV1 = (typeof SIGNABLE_VERIFICATION_ISSUE_CODES_V1)[number]

export type SignableVerificationResultV1 =
  | { valid: true; envelope: SignableTransactionEnvelopeV1; approvalBindingKey: string }
  | { valid: false; issues: Array<{ code: SignableVerificationIssueCodeV1; message: string }> }

type SignableVerificationIssueV1 = Extract<SignableVerificationResultV1, { valid: false }>['issues'][number]

type SignableVerificationInputV1<NativeDecoded> = {
  envelope: unknown
  unsignedPayload: SignableUnsignedPayloadV1
  renderedDisplay: SignableDisplayV1
  /** Trusted approval receipt loaded independently of the candidate envelope. */
  approval: SignableApprovalV1
  now: Date | string
  decoder: SignableTransactionDecoderV1<NativeDecoded>
  /** Atomically reserves an unused binding key before this verifier may return valid. */
  reserveApprovalBinding: (approvalBindingKey: string) => MaybePromise<boolean>
}

type ParsedSignableVerificationInputV1 = {
  unsignedPayload: SignableUnsignedPayloadV1
  renderedDisplay: SignableDisplayV1
  approval: SignableApprovalV1
  now: Date
}

const parseSignableVerificationInputV1 = <NativeDecoded>(
  input: SignableVerificationInputV1<NativeDecoded>
): {
  parsed?: ParsedSignableVerificationInputV1
  issues: SignableVerificationIssueV1[]
} => {
  const issues: SignableVerificationIssueV1[] = []
  const parsedPayload = signableUnsignedPayloadV1Schema.safeParse(input.unsignedPayload)
  const parsedDisplay = signableDisplayV1Schema.safeParse(input.renderedDisplay)
  const parsedApproval = signableApprovalV1Schema.safeParse(input.approval)

  if (!parsedPayload.success) {
    issues.push({
      code: 'payload-divergence',
      message: `Candidate payload is invalid: ${parsedPayload.error.message}`,
    })
  }
  if (!parsedDisplay.success) {
    issues.push({
      code: 'display-divergence',
      message: `Candidate display is invalid: ${parsedDisplay.error.message}`,
    })
  }
  if (!parsedApproval.success) {
    issues.push({
      code: 'invalid-verification-input',
      message: `Trusted approval receipt is invalid: ${parsedApproval.error.message}`,
    })
  }
  if (typeof input.reserveApprovalBinding !== 'function') {
    issues.push({
      code: 'invalid-verification-input',
      message: 'An atomic approval-binding reservation function is required',
    })
  }

  const parsedTimestamp =
    input.now instanceof Date
      ? { success: Number.isFinite(input.now.getTime()), value: input.now }
      : (() => {
          const parsed = signableUtcTimestampV1Schema.safeParse(input.now)
          return {
            success: parsed.success,
            value: parsed.success ? new Date(parsed.data) : new Date(NaN),
          }
        })()
  if (!parsedTimestamp.success) {
    issues.push({
      code: 'invalid-verification-input',
      message: 'Verification time is invalid',
    })
  }

  if (!parsedPayload.success || !parsedDisplay.success || !parsedApproval.success || issues.length > 0) {
    return { issues }
  }
  return {
    issues,
    parsed: {
      unsignedPayload: parsedPayload.data,
      renderedDisplay: signableDisplayV1Schema.parse(stripUndefinedValues(parsedDisplay.data)),
      approval: parsedApproval.data,
      now: parsedTimestamp.value,
    },
  }
}

const collectEnvelopeBindingIssuesV1 = (input: {
  envelope: SignableTransactionEnvelopeV1
  unsignedPayload: SignableUnsignedPayloadV1
  renderedDisplay: SignableDisplayV1
  approval: SignableApprovalV1
  now: Date
}): SignableVerificationIssueV1[] => {
  const { envelope, unsignedPayload, renderedDisplay, approval, now } = input
  const issues: SignableVerificationIssueV1[] = []
  if (now.getTime() >= new Date(envelope.expiresAt).getTime()) {
    issues.push({
      code: 'expired',
      message: `Approval expired at ${envelope.expiresAt}`,
    })
  }
  if (
    envelope.approval.id !== approval.id ||
    envelope.approval.nonce !== approval.nonce ||
    envelope.approval.bindingHash !== approval.bindingHash
  ) {
    issues.push({
      code: 'approval-divergence',
      message: 'Approval id, nonce or trusted binding digest differs from the bound approval',
    })
  }

  const payloadHash = hashSignableUnsignedPayloadV1(unsignedPayload)
  if (!exactEqual(unsignedPayload, envelope.unsignedPayload) || payloadHash !== envelope.payloadHash) {
    issues.push({
      code: 'payload-divergence',
      message: 'Unsigned payload differs from the exact approved payload',
    })
  }
  if (hashSignableDisplayV1(envelope.display) !== envelope.displayHash) {
    issues.push({
      code: 'display-divergence',
      message: 'Approved display policy hash does not match the envelope',
    })
  }
  if (hashSignableDisplayV1(renderedDisplay) !== envelope.displayHash) {
    issues.push({
      code: 'display-divergence',
      message: 'Rendered material fields or explicit bounds differ from the approved display policy',
    })
  }

  const expectedBindingHash = approvalBindingHash({
    approval: { id: envelope.approval.id, nonce: envelope.approval.nonce },
    payloadHash: envelope.payloadHash,
    displayHash: envelope.displayHash,
    expiresAt: envelope.expiresAt,
    intent: envelope.intent,
    chain: envelope.chain,
    sourceAccount: envelope.sourceAccount,
  })
  if (expectedBindingHash !== envelope.approval.bindingHash) {
    issues.push({
      code: 'approval-binding-divergence',
      message: 'Approval binding hash does not match the envelope',
    })
  }
  return issues
}

const getApprovedDisplayBoundsV1 = (display: SignableDisplayV1): SignableDisplayBoundsV1 => ({
  ...(display.constraints.fee
    ? {
        fee: {
          min: display.constraints.fee.min,
          max: display.constraints.fee.max,
        },
      }
    : {}),
  ...(display.constraints.slippageBps
    ? {
        slippageBps: {
          min: display.constraints.slippageBps.min,
          max: display.constraints.slippageBps.max,
        },
      }
    : {}),
})

const compareDecodedDisplayV1 = (
  envelope: SignableTransactionEnvelopeV1,
  decoded: Extract<SignableDecodedTransactionV1, { status: 'decoded' }>,
  renderedDisplay: SignableDisplayV1
): SignableVerificationIssueV1[] => {
  try {
    const decodedDisplay = buildDisplay(envelope, decoded, getApprovedDisplayBoundsV1(envelope.display))
    return exactEqual(decodedDisplay, renderedDisplay)
      ? []
      : [
          {
            code: 'display-divergence',
            message: 'Rendered current fee/slippage values differ from the candidate decode',
          },
        ]
  } catch (error) {
    if (error instanceof SignableTransactionContractError && error.code === 'constraint-out-of-bounds') {
      return [{ code: 'constraint-out-of-bounds', message: error.message }]
    }
    throw error
  }
}

const decoderErrorToVerificationIssueV1 = (error: unknown): SignableVerificationIssueV1 => {
  if (!(error instanceof SignableTransactionContractError)) {
    return {
      code: 'unknown-semantics',
      message: `Decoder failed before complete canonical semantics were available: ${
        error instanceof Error ? error.message : String(error)
      }`,
    }
  }
  if (
    error.code === 'chain-family-mismatch' ||
    error.code === 'unknown-semantics' ||
    error.code === 'constraint-out-of-bounds'
  ) {
    return { code: error.code, message: error.message }
  }
  return { code: 'decoded-actions-divergence', message: error.message }
}

const verifyDecodedSemanticsV1 = async <NativeDecoded>(input: {
  envelope: SignableTransactionEnvelopeV1
  unsignedPayload: SignableUnsignedPayloadV1
  renderedDisplay: SignableDisplayV1
  decoder: SignableTransactionDecoderV1<NativeDecoded>
}): Promise<SignableVerificationIssueV1[]> => {
  try {
    const decoded = await decodeSignableTransactionV1({
      decoder: input.decoder,
      payload: input.unsignedPayload,
      chain: input.envelope.chain,
      sourceAccount: input.envelope.sourceAccount,
    })
    if (decoded.status === 'unknown') {
      return [{ code: 'unknown-semantics', message: decoded.reason }]
    }
    assertActionContext(
      decoded.actions,
      {
        version: SIGNABLE_TRANSACTION_VERSION,
        chain: input.envelope.chain,
        sourceAccount: input.envelope.sourceAccount,
      },
      input.envelope.intent
    )
    const issues = exactEqual(decoded.actions, input.envelope.actions)
      ? []
      : [
          {
            code: 'decoded-actions-divergence' as const,
            message: 'Candidate payload decodes to different material actions',
          },
        ]
    return [...issues, ...compareDecodedDisplayV1(input.envelope, decoded, input.renderedDisplay)]
  } catch (error) {
    return [decoderErrorToVerificationIssueV1(error)]
  }
}

const reserveSignableApprovalBindingV1 = async (
  approvalBindingKey: string,
  reserveApprovalBinding: (approvalBindingKey: string) => MaybePromise<boolean>
): Promise<SignableVerificationIssueV1[]> => {
  try {
    const reserved = await reserveApprovalBinding(approvalBindingKey)
    if (reserved === false) {
      return [
        {
          code: 'approval-replay',
          message: 'The one-time approval binding was already reserved or consumed',
        },
      ]
    }
    if (reserved !== true) {
      return [
        {
          code: 'approval-reservation-failed',
          message: 'Approval binding reservation must return exactly true or false',
        },
      ]
    }
    return []
  } catch (error) {
    return [
      {
        code: 'approval-reservation-failed',
        message: `Approval binding could not be atomically reserved: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
    ]
  }
}

export const verifySignableTransactionEnvelopeV1 = async <NativeDecoded>(
  input: SignableVerificationInputV1<NativeDecoded>
): Promise<SignableVerificationResultV1> => {
  const parsedEnvelope = signableTransactionEnvelopeV1Schema.safeParse(input.envelope)
  if (!parsedEnvelope.success) {
    return {
      valid: false,
      issues: [{ code: 'invalid-envelope', message: parsedEnvelope.error.message }],
    }
  }
  const envelope = signableTransactionEnvelopeV1Schema.parse(stripUndefinedValues(parsedEnvelope.data))
  const { parsed, issues: inputIssues } = parseSignableVerificationInputV1(input)
  if (!parsed) return { valid: false, issues: inputIssues }

  const issues = collectEnvelopeBindingIssuesV1({ envelope, ...parsed })
  issues.push(
    ...(await verifyDecodedSemanticsV1({
      envelope,
      unsignedPayload: parsed.unsignedPayload,
      renderedDisplay: parsed.renderedDisplay,
      decoder: input.decoder,
    }))
  )
  if (issues.length > 0) return { valid: false, issues }

  const approvalBindingKey = getSignableApprovalBindingKeyV1(parsed.approval)
  const reservationIssues = await reserveSignableApprovalBindingV1(approvalBindingKey, input.reserveApprovalBinding)
  return reservationIssues.length > 0
    ? { valid: false, issues: reservationIssues }
    : { valid: true, envelope, approvalBindingKey }
}
