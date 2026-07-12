import { AccountLinesTrustline } from 'xrpl'

import { getRippleClient } from '../client'

/**
 * Every trust line held by `address`, following `account_lines` pagination to
 * completion. The XRP Ledger returns trust lines in pages, so a single request
 * would silently truncate the set of an account with many lines and hide token
 * balances rather than fail.
 *
 * Balances are signed from `address`'s perspective: a negative balance means
 * `address` is the issuer and owes the counterparty, not that it holds the token.
 * @see https://xrpl.org/docs/references/http-websocket-apis/public-api-methods/account-methods/account_lines
 */
export const getRippleAccountLines = async (address: string): Promise<AccountLinesTrustline[]> => {
  const client = await getRippleClient()

  const lines: AccountLinesTrustline[] = []
  let marker: unknown = undefined

  do {
    const { result } = await client.request({
      command: 'account_lines',
      account: address,
      ledger_index: 'current',
      ...(marker === undefined ? {} : { marker }),
    })

    lines.push(...result.lines)
    marker = result.marker
  } while (marker !== undefined)

  return lines
}
