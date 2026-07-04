/**
 * Deterministic cosmos validator-address guard (fund safety).
 *
 * Cosmos-SDK derives several bech32 address types from the same chain HRP by
 * appending a role suffix to the account HRP:
 *
 *   - account:   `cosmos1...`           (spendable wallet — `MsgSend` recipient)
 *   - validator: `cosmosvaloper1...`    (operator key — `MsgDelegate` target)
 *   - consensus: `cosmosvalcons1...`    (tendermint consensus key)
 *
 * A validator operator (`...valoper1...`) or consensus (`...valcons1...`)
 * address is NOT a spendable account. Funds bank-sent to a `valoper`/`valcons`
 * are, for all practical purposes, unrecoverable by the user — the operator
 * key is not a wallet the user controls and the consensus key has no bank
 * balance semantics at all. An LLM that confuses "the validator I'm staking
 * to" with "where to send the tokens" can route a plain transfer to a
 * `valoper` and the user loses the funds.
 *
 * This guard works HRP-suffix-wise so it covers EVERY cosmos chain (including
 * ones not yet in a per-chain table) and every send/swap recipient boundary
 * uniformly.
 */

/**
 * Classify a decoded bech32 HRP as a validator role, or `null` if it is a
 * plain account HRP.
 */
export function validatorRoleForHrp(hrp: string): 'operator' | 'consensus' | null {
  const lower = hrp.toLowerCase()
  if (lower.endsWith('valoper')) return 'operator'
  if (lower.endsWith('valcons')) return 'consensus'
  return null
}

/**
 * Throw a fund-safety error if a decoded bech32 HRP belongs to a validator
 * (operator or consensus) key. Call this on any field that must be a SPENDABLE
 * ACCOUNT address (a swap from/to address, a `MsgSend` recipient/sender).
 *
 * @param hrp   the decoded bech32 prefix (e.g. `cosmosvaloper`)
 * @param field the caller-facing field name for the error message
 */
export function assertNotValidatorHrp(hrp: string, field: string): void {
  const role = validatorRoleForHrp(hrp)
  if (role === null) return
  const what =
    role === 'operator'
      ? 'a validator OPERATOR address (a staking target, not a spendable wallet)'
      : 'a validator CONSENSUS address (a tendermint key, not a spendable wallet)'
  throw new Error(
    `invalid ${field}: "${hrp}1..." is ${what}. ` +
      `Bank transfers and account-side fields require a plain account address ` +
      `("${hrp.toLowerCase().replace(/(valoper|valcons)$/, '')}1..."). ` +
      `Funds sent to a validator key address are not recoverable.`
  )
}
