import { rootApiUrl } from '@vultisig/core-config'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

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
    // Absent for an UNINITIALIZED wallet (received funds but never sent — its
    // contract deploys via StateInit on the first outgoing tx). Callers must
    // read `account_state?.seqno` defensively or the first send crashes.
    account_state?: {
      wallet_id: string
      seqno: number
    }
    revision: number
    '@extra': string
  }
}

export async function getTonAccountInfo(address: string) {
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
