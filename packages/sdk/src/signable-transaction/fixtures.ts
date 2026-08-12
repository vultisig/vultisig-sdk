import { z } from 'zod'

import type { SignableTransactionDecoderV1, SignableVerificationResultV1 } from './contract'
import { SIGNABLE_VERIFICATION_ISSUE_CODES_V1, verifySignableTransactionEnvelopeV1 } from './contract'
import type { SignableTransactionChainFamily } from './schema'
import {
  SIGNABLE_TRANSACTION_VERSION,
  signableApprovalV1Schema,
  signableDecodedTransactionV1Schema,
  signableDisplayV1Schema,
  signableTransactionEnvelopeV1Schema,
  signableUnsignedPayloadV1Schema,
} from './schema'

export const signableTransactionFixtureV1Schema = z
  .object({
    version: z.literal(SIGNABLE_TRANSACTION_VERSION),
    name: z.string().min(1),
    envelope: signableTransactionEnvelopeV1Schema,
    candidate: z
      .object({
        unsignedPayload: signableUnsignedPayloadV1Schema,
        decoded: signableDecodedTransactionV1Schema,
        renderedDisplay: signableDisplayV1Schema,
        approval: signableApprovalV1Schema,
        now: z.string().datetime({ offset: false, precision: 3 }),
        consumedApprovalBindings: z.array(z.string()).optional(),
      })
      .strict(),
    expected: z
      .object({
        valid: z.boolean(),
        issueCodes: z.array(z.enum(SIGNABLE_VERIFICATION_ISSUE_CODES_V1)),
      })
      .strict(),
  })
  .strict()

export type SignableTransactionFixtureV1 = z.infer<typeof signableTransactionFixtureV1Schema>

/** Execute the data-only shared fixture format with a deterministic fixture decoder. */
export const runSignableTransactionFixtureV1 = async (
  fixtureInput: SignableTransactionFixtureV1,
  family: SignableTransactionChainFamily
): Promise<SignableVerificationResultV1> => {
  const fixture = signableTransactionFixtureV1Schema.parse(fixtureInput)
  const decoder: SignableTransactionDecoderV1<typeof fixture.candidate.decoded> = {
    family,
    decode: () => fixture.candidate.decoded,
    normalize: decoded => decoded,
  }
  const reservedApprovalBindings = new Set(fixture.candidate.consumedApprovalBindings ?? [])
  return verifySignableTransactionEnvelopeV1({
    envelope: fixture.envelope,
    unsignedPayload: fixture.candidate.unsignedPayload,
    renderedDisplay: fixture.candidate.renderedDisplay,
    approval: fixture.candidate.approval,
    now: fixture.candidate.now,
    decoder,
    reserveApprovalBinding: approvalBindingKey => {
      if (reservedApprovalBindings.has(approvalBindingKey)) return false
      reservedApprovalBindings.add(approvalBindingKey)
      return true
    },
  })
}
