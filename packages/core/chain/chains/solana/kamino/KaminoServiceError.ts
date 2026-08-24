import { matchRecordUnion } from '@vultisig/lib-utils/matchRecordUnion'

/**
 * Why a Kamino service call was refused or failed, as a record union so
 * callers can branch with `matchRecordUnion`.
 */
export type KaminoServiceErrorReason =
  | {
      /**
       * A structured error from the API. `status` is retained alongside the
       * machine-readable `code` (`KVAULT_NOT_FOUND`, `TRANSACTION_SIZE_ERROR`,
       * …) because Kamino's error envelope carries a `statusCode` of its own
       * and a retryable 503 can arrive in the same body shape as a permanent
       * 400.
       */
      api: { status: number; code?: string; message: string }
    }
  | {
      /** A numeric field did not parse under the strict decimal rules. */
      malformedNumber: { field: string; value: string }
    }
  | {
      /**
       * An amount could not be sent: non-positive, beyond the `u64` an
       * on-chain instruction can carry, or at an implausible decimal scale.
       */
      invalidAmount: string
    }
  | {
      /**
       * A vault was described to the service in terms the registry does not
       * recognise. The curated entry is the app's record of a vault's
       * identity; anything else cannot be used to size or target a
       * transaction.
       */
      vaultNotInRegistry: string
    }
  | {
      /**
       * The API described a vault differently from the registry. Mints, their
       * decimals and the farm are immutable properties of a kVault, so a
       * disagreement is either the wrong vault or a response that cannot be
       * trusted to size or target a transaction.
       */
      vaultMetadataMismatch: { field: string; expected: string; actual: string }
    }

/**
 * Typed failure from the Kamino service boundary. Carries a structured
 * `reason` so callers branch on data instead of matching message text, and
 * `isRetryable` so a transient 429/5xx can be told apart from a permanent
 * refusal that arrived in the same shape.
 */
export class KaminoServiceError extends Error {
  readonly reason: KaminoServiceErrorReason

  constructor(reason: KaminoServiceErrorReason) {
    super(
      matchRecordUnion(reason, {
        api: ({ code, message }) => (code ? `${code}: ${message}` : message),
        malformedNumber: ({ field, value }) => `Malformed Kamino number for ${field}: ${value}`,
        invalidAmount: detail => `Invalid Kamino amount: ${detail}`,
        vaultNotInRegistry: address => `Kamino vault not in registry: ${address}`,
        vaultMetadataMismatch: ({ field, expected, actual }) =>
          `Kamino vault ${field} is "${actual}", registry pins "${expected}"`,
      })
    )
    this.name = 'KaminoServiceError'
    this.reason = reason
  }

  /** Whether retrying the same request could plausibly succeed. */
  get isRetryable(): boolean {
    if (!('api' in this.reason)) return false
    const { status } = this.reason.api
    return status === 429 || (status >= 500 && status <= 599)
  }
}
