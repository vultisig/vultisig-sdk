/**
 * TON RPC helpers (toncenter v2/v3).
 *
 * Pure `fetch`-based — RN-safe. The consumer passes the gateway base URL.
 * In the Vultisig stack this is typically `${vultisigApiUrl}/ton` but any
 * toncenter-compatible endpoint works (public toncenter.com, self-hosted
 * proxy, etc.).
 */

export type TonWalletStatus = 'active' | 'uninit' | 'frozen' | string

export type TonWalletInfo = {
  /** Current seqno (0 if the wallet contract is not yet deployed). */
  seqno: number
  /** Balance in nanotons. */
  balance: bigint
  /** Wallet account status reported by toncenter. */
  status: TonWalletStatus
}

type ToncenterExtendedInfo = {
  ok?: boolean
  result?: {
    account_state?: { seqno?: number }
    balance?: string | number
  }
  error?: string
}

type ToncenterV3AddressInfo = {
  ok?: boolean
  status?: TonWalletStatus
  balance?: string | number
  error?: string
}

type ToncenterSendBoc = {
  ok?: boolean
  error?: string
  result?: { hash?: string }
}

function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number') return BigInt(Math.trunc(value))
  if (typeof value === 'string' && value.length > 0) {
    try {
      return BigInt(value)
    } catch {
      return 0n
    }
  }
  return 0n
}

/**
 * Fetch balance (nanotons) for a user-friendly (EQ.../UQ...) address.
 * Accepts any toncenter-compatible gateway (v2 `getAddressBalance`).
 */
export async function getTonBalance(address: string, gatewayUrl: string): Promise<bigint> {
  const url = `${gatewayUrl}/v2/getAddressBalance?address=${encodeURIComponent(address)}`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`toncenter getAddressBalance failed: ${res.status} ${res.statusText}`)
  }
  const json = (await res.json()) as { result?: string | number }
  return toBigInt(json.result)
}

/**
 * Fetch seqno + status for a user-friendly address. Uses v2
 * `getExtendedAddressInformation` (the only endpoint that returns seqno)
 * and v3 `addressInformation` for the wallet status.
 *
 * A genuinely uninitialized wallet (received funds, never sent) still gets
 * a 200 OK from both endpoints — it just carries no `account_state` /
 * reports `status: 'uninit'`. That case legitimately resolves with
 * `{ seqno: 0, status: 'uninit' }` so the caller can attach a StateInit on
 * the first transfer.
 *
 * A transient RPC/network failure (fetch throw, non-OK response, or body-level
 * `{ ok: false, result: null }`) is a
 * DIFFERENT case and must not collapse into the same shape: doing so
 * previously defeated the sender's stale-seqno guard (a failed lookup
 * signed as if the wallet were fresh) and force-disabled the recipient's
 * bounce-safety flag (a failed lookup looked "uninit", stripping the
 * refund-on-failure net for what might be a live contract). Fail closed
 * instead — mirrors `getTonAccountInfo`'s `ok`/`result` check.
 */
export async function getTonWalletInfo(address: string, gatewayUrl: string): Promise<TonWalletInfo> {
  const [extRes, v3Res] = await Promise.all([
    fetch(`${gatewayUrl}/v2/getExtendedAddressInformation?address=${encodeURIComponent(address)}`),
    fetch(`${gatewayUrl}/v3/addressInformation?address=${encodeURIComponent(address)}&use_v2=false`),
  ])

  if (!extRes.ok) {
    throw new Error(`toncenter getExtendedAddressInformation failed: ${extRes.status} ${extRes.statusText}`)
  }
  const ext = (await extRes.json()) as ToncenterExtendedInfo
  if (ext.ok === false || !ext.result) {
    throw new Error('toncenter getExtendedAddressInformation returned no result')
  }
  const seqno = ext.result?.account_state?.seqno ?? 0
  let balance = ext.result?.balance !== undefined ? toBigInt(ext.result.balance) : 0n

  if (!v3Res.ok) {
    throw new Error(`toncenter addressInformation failed: ${v3Res.status} ${v3Res.statusText}`)
  }
  const v3 = (await v3Res.json()) as ToncenterV3AddressInfo
  if (v3.ok === false) {
    throw new Error('toncenter addressInformation returned an error')
  }
  const status: TonWalletStatus = v3.status ?? 'uninit'
  if (v3.balance !== undefined && balance === 0n) balance = toBigInt(v3.balance)

  return { seqno, balance, status }
}

/**
 * Broadcast a signed BOC (base64-encoded) and return the tx hash reported
 * by toncenter. Throws on HTTP or TonCenter-reported errors so callers can
 * surface them verbatim.
 */
export async function broadcastTonTx(signedBocBase64: string, gatewayUrl: string): Promise<{ hash?: string }> {
  const res = await fetch(`${gatewayUrl}/v2/sendBocReturnHash`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ boc: signedBocBase64 }),
  })
  const json = (await res.json().catch(() => ({}))) as ToncenterSendBoc
  if (!res.ok || (json.ok === false && json.error)) {
    throw new Error(`toncenter sendBocReturnHash failed: ${json.error ?? res.statusText}`)
  }
  return { hash: json.result?.hash }
}
