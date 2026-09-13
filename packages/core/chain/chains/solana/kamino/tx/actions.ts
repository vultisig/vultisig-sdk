import { HttpResponseError } from '@vultisig/lib-utils/fetch/HttpResponseError'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { isValidKaminoRequestAmount, kaminoAmountApiString, KaminoShareAmount, KaminoTokenAmount } from '../amount'
import { kaminoMaxBaseUnits } from '../baseUnits'
import { kaminoConfig } from '../config'
import { KaminoServiceError } from '../KaminoServiceError'
import { getKaminoVaultDescriptor } from '../registry'

/**
 * The build endpoints: `POST /ktx/kvault/{deposit,withdraw}`, each returning
 * a base64 unsigned Solana v0 transaction ready to inject, validate and
 * keysign.
 *
 * The API is a pure builder — it signs nothing and moves nothing — but it
 * also validates nothing: a below-minimum deposit builds a transaction that
 * fails on-chain, and a withdraw at or above the user's share balance is
 * silently rewritten to `u64::MAX`, meaning withdraw everything. So bounds
 * are enforced here, before the request leaves the device, and the returned
 * transaction must still pass the full validator before anything signs it.
 *
 * Builds are never retried: a POST carries no idempotence guarantee this app
 * is entitled to assume about somebody else's service.
 */

/** Body for `POST /ktx/kvault/{deposit,withdraw}`. */
type KaminoActionRequest = {
  wallet: string
  kvault: string
  /**
   * Human-units decimal string whose unit depends on the action: tokens for
   * deposit, shares for withdraw. The typed builders below are the only
   * intended way to construct this.
   */
  amount: string
}

type KaminoActionResponse = {
  /** Base64 unsigned transaction. */
  transaction: string
}

// `error` and `code` are optional because the guard below only proves the
// fields the envelope handling reads — a type claiming more than the guard
// checks would hand a later reader `undefined` with no type error.
type KaminoErrorBody = { statusCode: number; message: string; error?: string; code?: string }

const isKaminoErrorBody = (body: unknown): body is KaminoErrorBody =>
  typeof body === 'object' &&
  body !== null &&
  typeof (body as KaminoErrorBody).statusCode === 'number' &&
  typeof (body as KaminoErrorBody).message === 'string'

const buildTransaction = async (
  path: '/ktx/kvault/deposit' | '/ktx/kvault/withdraw',
  body: KaminoActionRequest
): Promise<string> => {
  try {
    const response = await queryUrl<KaminoActionResponse>(`${kaminoConfig.apiBaseUrl}${path}`, { body })
    // The type parameter asserts the response shape; it does not check it. A
    // 200 without a transaction would otherwise surface downstream as an
    // unreadable-transaction failure instead of naming the real cause.
    if (typeof response?.transaction !== 'string' || response.transaction.length === 0) {
      throw new KaminoServiceError({ api: { status: 200, message: `${path} response carried no transaction` } })
    }
    return response.transaction
  } catch (error) {
    if (error instanceof HttpResponseError && isKaminoErrorBody(error.body)) {
      throw new KaminoServiceError({
        api: { status: error.status, code: error.body.code, message: error.body.message },
      })
    }
    throw error
  }
}

const requireCuratedVault = (vaultAddress: string) => {
  const descriptor = getKaminoVaultDescriptor(vaultAddress)
  if (!descriptor) throw new KaminoServiceError({ vaultNotInRegistry: vaultAddress })
  return descriptor
}

const requireValidAmount = (amount: KaminoTokenAmount | KaminoShareAmount, label: string) => {
  if (!isValidKaminoRequestAmount(amount)) {
    throw new KaminoServiceError({
      invalidAmount: `${label} amount ${amount.baseUnits} at ${amount.decimals} decimals is out of range`,
    })
  }
}

/**
 * Builds an unsigned deposit transaction. The amount is in the vault's
 * underlying token — the type enforces it. The vault is resolved through the
 * registry, so an arbitrary address cannot reach Kamino through here.
 */
export const buildKaminoDepositTransaction = async ({
  owner,
  vaultAddress,
  amount,
}: {
  owner: string
  vaultAddress: string
  amount: KaminoTokenAmount
}): Promise<string> => {
  const descriptor = requireCuratedVault(vaultAddress)
  requireValidAmount(amount, 'deposit')
  return buildTransaction('/ktx/kvault/deposit', {
    wallet: owner,
    kvault: descriptor.address,
    amount: kaminoAmountApiString(amount),
  })
}

/**
 * Builds an unsigned withdraw transaction. The amount is in SHARES — the
 * inverse of deposit. This asymmetry is the API's, not ours, and the type is
 * what keeps the two from crossing.
 */
export const buildKaminoWithdrawTransaction = async ({
  owner,
  vaultAddress,
  shares,
}: {
  owner: string
  vaultAddress: string
  shares: KaminoShareAmount
}): Promise<string> => {
  const descriptor = requireCuratedVault(vaultAddress)
  requireValidAmount(shares, 'withdraw')
  // u64::MAX is the API's own "withdraw everything" sentinel: it is what a
  // request AT OR ABOVE the user's balance is silently rewritten to. No
  // legitimate share balance is 18.4 quintillion base units, so refusing the
  // value outright costs nothing and closes the one way this app could name
  // it directly. The spendable-balance rule in `parseKaminoSharePosition` is
  // what keeps every request strictly below the balance; the validator is
  // what refuses the response if a sentinel arrives anyway.
  if (shares.baseUnits >= kaminoMaxBaseUnits) {
    throw new KaminoServiceError({
      invalidAmount: `withdraw amount ${shares.baseUnits} is the withdraw-everything sentinel`,
    })
  }
  return buildTransaction('/ktx/kvault/withdraw', {
    wallet: owner,
    kvault: descriptor.address,
    amount: kaminoAmountApiString(shares),
  })
}
