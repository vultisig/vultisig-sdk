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
  result?: {
    account_state?: { seqno?: number }
    balance?: string | number
  }
}

type ToncenterV3AddressInfo = {
  status?: TonWalletStatus
  balance?: string | number
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
 * Returns `{ seqno: 0, status: 'uninit' }` if either call fails — that
 * matches the observable on-chain state for a never-deployed wallet and
 * lets the caller attach a StateInit on the first transfer.
 */
export async function getTonWalletInfo(address: string, gatewayUrl: string): Promise<TonWalletInfo> {
  const [extRes, v3Res] = await Promise.all([
    fetch(`${gatewayUrl}/v2/getExtendedAddressInformation?address=${encodeURIComponent(address)}`).catch(() => null),
    fetch(`${gatewayUrl}/v3/addressInformation?address=${encodeURIComponent(address)}&use_v2=false`).catch(() => null),
  ])

  let seqno = 0
  let balance = 0n
  if (extRes && extRes.ok) {
    const ext = (await extRes.json().catch(() => ({}))) as ToncenterExtendedInfo
    seqno = ext.result?.account_state?.seqno ?? 0
    if (ext.result?.balance !== undefined) balance = toBigInt(ext.result.balance)
  }

  let status: TonWalletStatus = 'uninit'
  if (v3Res && v3Res.ok) {
    const v3 = (await v3Res.json().catch(() => ({}))) as ToncenterV3AddressInfo
    if (v3.status) status = v3.status
    if (v3.balance !== undefined && balance === 0n) balance = toBigInt(v3.balance)
  }

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
