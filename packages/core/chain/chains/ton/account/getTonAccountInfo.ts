import { rootApiUrl } from '@vultisig/core-config'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { isTonV5R1Code, readTonV5R1Seqno } from '../walletV5R1'

/**
 * The `account_state` toncenter attaches to an address. It decodes the wallet
 * contracts it knows (V3/V4) into a typed state carrying the seqno; any other
 * deployed contract — W5 included — comes back raw, as code and data cells,
 * and a wallet that has received funds but never sent has no state at all
 * (its contract deploys via StateInit on the first outgoing message).
 */
type TonAccountState = {
  '@type'?: string
  wallet_id?: string
  seqno?: number
  /** Base64 BOC of the deployed code, on a `raw.accountState`. */
  code?: string
  /** Base64 BOC of the deployed data, on a `raw.accountState`. */
  data?: string
  frozen_hash?: string
}

type TonAccountInfoResponse = {
  ok: boolean
  result: {
    address: {
      account_address: string
    }
    balance: string
    last_transaction_id: {
      lt: string
      hash: string
    }
    block_id: {
      workchain: number
      shard: string
      seqno: number
      root_hash: string
      file_hash: string
    }
    sync_utime: number
    account_state?: TonAccountState
    revision: number
    '@extra': string
  }
}

export type TonAccountInfo = TonAccountInfoResponse['result']

export async function getTonAccountInfo(address: string): Promise<TonAccountInfo> {
  const url = `${rootApiUrl}/ton/v2/getExtendedAddressInformation?address=${address}`
  const response = await queryUrl<TonAccountInfoResponse>(url)

  // `assertFetchResponse` only checks the HTTP status, not the toncenter-style
  // `{ "ok": false, "result": null }` body shape, so a transient RPC failure
  // slips through as a 200 with a null `result`. Returning that null lets the
  // caller crash on a destructure (`const { account_state } = undefined`) with a
  // cryptic TypeError that aborts the whole keysign chain-specific step. Fail
  // closed with a descriptive error instead — a genuinely uninitialized wallet
  // still returns `ok: true` with an `uninited.accountState` result, so this only
  // trips on a real fetch/RPC failure where signing with a guessed seqno would be
  // wrong anyway.
  if (!response?.ok || !response.result) {
    throw new Error(`TON getExtendedAddressInformation returned no result for ${address}`)
  }

  return response.result
}

const uninitializedAccountState = 'uninited.accountState'

/**
 * The wallet's current seqno — the nonce every outgoing request must carry.
 *
 * Toncenter only decodes a seqno for the wallet contracts it knows; a W5
 * account arrives as raw code and data, and the seqno is read out of the data
 * cell after checking the code really is W5. An account with no state, or an
 * explicitly uninitialized one, has never sent, so its seqno is 0 (the first
 * request then deploys it). Any other state this cannot read — an unknown
 * contract, a frozen account, a raw state missing its cells — is refused
 * rather than assumed fresh: signing seqno 0 for a wallet that has moved on is
 * rejected on chain as a replay.
 */
export const getTonAccountSeqno = ({ account_state }: Pick<TonAccountInfo, 'account_state'>): number => {
  if (!account_state || account_state['@type'] === uninitializedAccountState) {
    return 0
  }
  if (account_state.seqno !== undefined) {
    return account_state.seqno
  }
  if (account_state.code && account_state.data) {
    if (!isTonV5R1Code(account_state.code)) {
      throw new Error('Cannot read the seqno of a TON account that is neither a known wallet nor W5')
    }

    return readTonV5R1Seqno(account_state.data)
  }

  throw new Error(`Cannot read the seqno of a TON account in state ${account_state['@type'] ?? 'unknown'}`)
}
