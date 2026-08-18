/**
 * XRPL Payment confirmation amount.
 *
 * Under `tfPartialPayment`, the transaction `Amount` field is a *ceiling*, not
 * a delivery. Credit / history / confirmation MUST read metadata
 * `delivered_amount` (legacy alias `DeliveredAmount`). Falling back to `Amount`
 * is the classic over-credit exploit.
 *
 * @see https://xrpl.org/docs/concepts/payment-types/partial-payments
 */
export type RippleDeliveredAmount =
  | { type: 'xrp'; drops: bigint }
  | { type: 'issued'; currency: string; issuer: string; value: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseDeliveredAmountField(raw: unknown): RippleDeliveredAmount | null {
  if (typeof raw === 'string') {
    if (!/^\d+$/.test(raw)) return null
    return { type: 'xrp', drops: BigInt(raw) }
  }

  if (
    isRecord(raw) &&
    typeof raw.currency === 'string' &&
    raw.currency.length > 0 &&
    typeof raw.issuer === 'string' &&
    raw.issuer.length > 0 &&
    typeof raw.value === 'string' &&
    raw.value.length > 0
  ) {
    return { type: 'issued', currency: raw.currency, issuer: raw.issuer, value: raw.value }
  }

  return null
}

/**
 * Extract the delivered value from XRPL `tx` metadata.
 *
 * Returns `null` when the field is absent or malformed. Never consults
 * `Amount` / `amount` — callers that need a confirmed value must fail closed
 * on `null` rather than substitute the send-side ceiling.
 */
export function readRippleDeliveredAmount(meta: unknown): RippleDeliveredAmount | null {
  if (!isRecord(meta)) return null

  if ('delivered_amount' in meta) {
    return parseDeliveredAmountField(meta.delivered_amount)
  }
  if ('DeliveredAmount' in meta) {
    return parseDeliveredAmountField(meta.DeliveredAmount)
  }
  return null
}
