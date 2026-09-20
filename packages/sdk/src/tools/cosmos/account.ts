/** Numeric account fields returned by Cosmos SDK auth endpoints. */
export type AuthAccountFields = {
  account_number?: string | number
  sequence?: string | number
}

/**
 * Account shapes understood by {@link parseAuthAccount}.
 *
 * Cosmos chains may return a BaseAccount directly, wrap it in `base_account`
 * (for example ModuleAccount and EthAccount), or nest it below a vesting
 * account. Unknown fields are retained in the type so callers can pass an LCD
 * response without first narrowing its concrete protobuf account type.
 */
export type AuthAccountResponse = {
  account?: AuthAccountFields & {
    base_account?: AuthAccountFields
    base_vesting_account?: {
      base_account?: AuthAccountFields
    }
    [key: string]: unknown
  }
}

/** Account state required when preparing a Cosmos transaction. */
export type ParsedAuthAccount = {
  accountNumber: string
  sequence: string
}

/**
 * Read account number and sequence from the Cosmos auth-account shapes used by
 * BaseAccount, base-account wrappers, and vesting accounts.
 *
 * Vesting state takes precedence over a `base_account` wrapper, which takes
 * precedence over top-level fields. The selected account must contain both
 * values; incomplete or unsupported shapes return `null`. Decimal strings are
 * never parsed as numbers, so their precision remains exact.
 */
export function parseAuthAccount(resp: AuthAccountResponse): ParsedAuthAccount | null {
  const acct = resp.account
  if (!acct) return null

  const vesting = acct.base_vesting_account?.base_account
  if (vesting?.account_number != null) {
    if (vesting.sequence == null) return null
    return { accountNumber: String(vesting.account_number), sequence: String(vesting.sequence) }
  }

  const moduleBase = acct.base_account
  if (moduleBase?.account_number != null) {
    if (moduleBase.sequence == null) return null
    return { accountNumber: String(moduleBase.account_number), sequence: String(moduleBase.sequence) }
  }

  if (acct.account_number != null) {
    if (acct.sequence == null) return null
    return { accountNumber: String(acct.account_number), sequence: String(acct.sequence) }
  }

  return null
}
