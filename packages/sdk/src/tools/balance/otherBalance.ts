/**
 * Native + token balance reads for non-EVM, non-Cosmos chains:
 * XRP / TRON / TON / Sui / Cardano. Ported from mcp-ts `balance/other-balance.ts`
 * (0 SDK imports). Pure crypto: decode RPC responses, parse base units, format.
 * Read-only — nothing here signs or broadcasts.
 *
 * Each chain is not wired through the EVM `getEvmClient` rail, so these talk to
 * public RPC / API endpoints (and the Vultisig proxy) directly via `fetchJson`.
 */
import bs58 from 'bs58'

import { fetchJson, formatBalance, ROOT_API_URL } from './rpc'

// Tron base58check address: T-prefix + 33 base58 chars = 34 total. Format-only
// guard so an EVM 0x / cosmos bech32 address can't be silently treated as Tron.
const TRON_ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/

function assertTronAddress(addr: string): void {
  if (!TRON_ADDRESS_RE.test(addr)) {
    throw new Error(
      `'${addr}' is not a valid Tron address — expected a 34-character base58check ` +
        'address starting with T (e.g. "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"). ' +
        'Denoms, bech32 addresses, and 0x EVM addresses are not valid here.'
    )
  }
}

/**
 * ABI-encode a Tron base58check address as a 32-byte EVM word for a
 * triggersmartcontract `parameter`.
 *
 * A Tron `T…` address base58check-decodes to 21 bytes: a 0x41 prefix + the
 * 20-byte EVM-style address (the trailing 4 bytes are the checksum). The
 * `balanceOf(address)` ABI arg is that 20-byte address left-padded to 32 bytes.
 *
 * NOT a string substitution: `addr.replace(/^T/, '41')` leaves base58 characters
 * (G, U, Z, …) in the string, so the node rejects it as non-hex and returns an
 * error body with no `constant_result` — which the caller would then read as a
 * balance of 0. Every funded TRC-20 holder would report empty. Decode for real.
 */
function tronAddressToAbiParam(addr: string): string {
  const decoded = bs58.decode(addr)
  // 21-byte payload (0x41 + 20-byte address) + 4-byte checksum = 25 bytes.
  if (decoded.length !== 25 || decoded[0] !== 0x41) {
    throw new Error(`'${addr}' did not base58check-decode to a 21-byte Tron address payload.`)
  }
  const addr20 = Buffer.from(decoded.subarray(1, 21)).toString('hex')
  return addr20.padStart(64, '0')
}

// ── XRP ─────────────────────────────────────────────────────────────────────

export type XrpBalance = {
  address: string
  // Raw drops as the authoritative string. XRP supply (~1e17 drops) is well past
  // 2^53, so a `number` here would silently round large balances (e.g. a >9M-XRP
  // account) — keep it a string and parse with BigInt.
  balanceDrops: string
  balanceXrp: string
  note?: string
  asOf: string
}

// 1 XRP = 1e6 drops. Format via BigInt so a >2^53-drop balance never rounds.
function formatXrp(drops: bigint): string {
  const whole = drops / 1_000_000n
  const frac = drops % 1_000_000n
  return `${whole}.${frac.toString().padStart(6, '0')}`
}

/**
 * Query the native XRP balance of an XRP Ledger address.
 *
 * Only `actNotFound` (valid-shape but unfunded — 10 XRP reserve requirement)
 * resolves to a zero balance. Other XRPL error types (actMalformed, actBadSeed,
 * invalidParams) mean the caller passed something broken and are surfaced as
 * errors, so a mistyped address never reads as "you have 0 XRP".
 */
export async function getXrpBalance(address: string): Promise<XrpBalance> {
  if (!address) throw new Error('No XRP address provided.')
  const response = await fetchJson<{
    result: { account_data?: { Balance?: string }; error?: string; error_message?: string }
  }>('https://xrplcluster.com', {
    method: 'account_info',
    params: [{ account: address, ledger_index: 'current' }],
  })

  if (response.result?.error === 'actNotFound') {
    return {
      address,
      balanceDrops: '0',
      balanceXrp: '0.000000',
      note: 'Account not found on XRP Ledger. It may be unfunded (requires 10 XRP minimum reserve).',
      asOf: new Date().toISOString(),
    }
  }

  if (response.result?.error) {
    const msg = response.result.error_message ?? response.result.error
    throw new Error(`XRPL error (${response.result.error}): ${msg}`)
  }

  if (!response.result?.account_data?.Balance) {
    throw new Error('XRPL returned no account_data and no error — upstream response was malformed.')
  }

  const rawDrops = response.result.account_data.Balance
  // The XRPL wire format delivers Balance as a decimal string; parse with BigInt
  // so a large balance keeps full precision (Number() would round past 2^53).
  let drops: bigint
  try {
    drops = BigInt(rawDrops)
  } catch {
    throw new Error(`XRPL returned a non-integer Balance ("${rawDrops}") — malformed upstream response.`)
  }
  return {
    address,
    balanceDrops: drops.toString(),
    balanceXrp: formatXrp(drops),
    asOf: new Date().toISOString(),
  }
}

// ── TRON ────────────────────────────────────────────────────────────────────

export type TrxBalance = {
  address: string
  balanceSun: number
  balanceTrx: string
  asOf: string
}

/** Query the native TRX balance of a TRON address (base58, starts with T). */
export async function getTrxBalance(address: string): Promise<TrxBalance> {
  if (!address) throw new Error('No TRON address provided.')
  assertTronAddress(address)
  const response = await fetchJson<{ balance?: number }>('https://tron-rpc.publicnode.com/wallet/getaccount', {
    address,
    visible: true,
  })
  const sun = response.balance ?? 0
  return {
    address,
    balanceSun: sun,
    balanceTrx: formatBalance(BigInt(sun), 6),
    asOf: new Date().toISOString(),
  }
}

export type TronAccountResources = {
  address: string
  bandwidthUsed: number
  bandwidthLimit: number
  energyUsed: number
  energyLimit: number
}

/** Query bandwidth + energy resources of a TRON account. */
export async function getTronAccountResources(address: string): Promise<TronAccountResources> {
  if (!address) throw new Error('No TRON address provided.')
  assertTronAddress(address)
  const response = await fetchJson<{
    freeNetUsed?: number
    freeNetLimit?: number
    EnergyUsed?: number
    EnergyLimit?: number
    NetUsed?: number
    NetLimit?: number
  }>('https://tron-rpc.publicnode.com/wallet/getaccountresource', { address, visible: true })

  return {
    address,
    bandwidthUsed: (response.freeNetUsed ?? 0) + (response.NetUsed ?? 0),
    bandwidthLimit: (response.freeNetLimit ?? 0) + (response.NetLimit ?? 0),
    energyUsed: response.EnergyUsed ?? 0,
    energyLimit: response.EnergyLimit ?? 0,
  }
}

export type Trc20TokenBalance = {
  address: string
  contractAddress: string
  symbol: string
  balance: string
  decimals: number
  asOf: string
}

/**
 * Query a TRC-20 token balance for a TRON address via on-chain
 * triggersmartcontract reads (balanceOf / decimals / symbol).
 */
export async function getTrc20TokenBalance(address: string, contractAddress: string): Promise<Trc20TokenBalance> {
  if (!address) throw new Error('No TRON address provided.')
  assertTronAddress(address)
  assertTronAddress(contractAddress)

  const trigger = (functionSelector: string, parameter: string) =>
    fetchJson<{ constant_result?: string[] }>('https://tron-rpc.publicnode.com/wallet/triggersmartcontract', {
      owner_address: address,
      contract_address: contractAddress,
      function_selector: functionSelector,
      parameter,
      visible: true,
    })

  const [balResp, decResp, symResp] = await Promise.all([
    // ABI-encode the owner address: base58check-decode to its 20-byte form,
    // left-pad to 32 bytes. (A string replace leaves base58 chars and the node
    // rejects the call → no constant_result → a false zero balance.)
    trigger('balanceOf(address)', tronAddressToAbiParam(address)),
    trigger('decimals()', ''),
    trigger('symbol()', ''),
  ])

  // Fail closed: a reverted / malformed triggersmartcontract call returns an
  // HTTP-200 body with no `constant_result`. Reading that as 0 would report a
  // funded holder as empty (fund-visibility bug), so surface it as an error.
  const hexBalance = balResp.constant_result?.[0]
  if (hexBalance == null) {
    throw new Error(
      `Tron balanceOf read returned no constant_result for ${contractAddress} — ` +
        'malformed or reverted upstream response; refusing to report a false zero balance.'
    )
  }
  const balance = BigInt('0x' + (hexBalance || '0')).toString()
  const decRaw = decResp.constant_result?.[0]
  if (decRaw == null) {
    throw new Error(
      `Tron decimals() read returned no constant_result for ${contractAddress} — ` +
        'malformed or reverted upstream response; refusing to apply a default scale.'
    )
  }
  const decimals = parseInt(decRaw, 16)

  let symbol = 'UNKNOWN'
  try {
    const symHex = symResp.constant_result?.[0] ?? ''
    const strLen = parseInt(symHex.slice(64, 128), 16)
    symbol = Buffer.from(symHex.slice(128, 128 + strLen * 2), 'hex').toString('utf-8')
  } catch {
    // keep fallback
  }

  return {
    address,
    contractAddress,
    symbol,
    balance,
    decimals,
    asOf: new Date().toISOString(),
  }
}

// ── TON ─────────────────────────────────────────────────────────────────────

export type TonBalance = {
  chain: 'Ton'
  ticker: 'TON'
  address: string
  balanceNano: string
  balance: string
  status: string
  seqno: number
  asOf: string
}

/**
 * Get the native TON balance for a TON address via the Vultisig proxy's
 * getExtendedAddressInformation endpoint (balance + seqno + account state).
 */
export async function getTonBalance(address: string): Promise<TonBalance> {
  const extResp = await fetchJson<{
    result: { balance?: string; account_state?: { seqno?: number; '@type'?: string } }
  }>(`${ROOT_API_URL}/ton/v2/getExtendedAddressInformation?address=${encodeURIComponent(address)}`)

  const nanotons = extResp.result?.balance ?? '0'
  const seqno = extResp.result?.account_state?.seqno ?? 0

  const STATE_MAP: Record<string, string> = {
    'uninited.accountState': 'uninit',
    'raw.accountState': 'active',
    'frozen.accountState': 'frozen',
  }
  const rawStateType = extResp.result?.account_state?.['@type'] ?? ''
  const status = STATE_MAP[rawStateType] ?? (rawStateType || 'unknown')

  return {
    chain: 'Ton',
    ticker: 'TON',
    address,
    balanceNano: nanotons,
    balance: formatBalance(BigInt(nanotons), 9),
    status,
    seqno,
    asOf: new Date().toISOString(),
  }
}

export type TonJettonBalance = {
  jettonMaster: string
  balance: string
  walletAddress: string
  asOf: string
}

/** Get balance of a specific TON jetton token (base units + jetton wallet). */
export async function getTonJettonBalance(address: string, jettonMaster: string): Promise<TonJettonBalance> {
  const response = await fetchJson<{
    jetton_wallets?: { balance: string; address: string }[]
  }>(
    `${ROOT_API_URL}/ton/v3/jetton/wallets?owner_id=${encodeURIComponent(address)}` +
      `&jetton_master_id=${encodeURIComponent(jettonMaster)}`
  )

  const wallet = response.jetton_wallets?.[0]
  return {
    jettonMaster,
    balance: wallet?.balance ?? '0',
    walletAddress: wallet?.address ?? '',
    asOf: new Date().toISOString(),
  }
}

// ── Sui ─────────────────────────────────────────────────────────────────────

export type SuiBalance = {
  address: string
  chain: 'Sui'
  ticker: 'SUI'
  balance: string
  balanceMist: string
  asOf: string
}

/** Get the native SUI balance (1 SUI = 1e9 MIST). */
export async function getSuiBalance(address: string): Promise<SuiBalance> {
  const response = await fetchJson<{ result: { totalBalance: string } }>('https://sui-rpc.publicnode.com', {
    jsonrpc: '2.0',
    id: 1,
    method: 'suix_getBalance',
    params: [address],
  })
  const mist = response.result.totalBalance
  return {
    address,
    chain: 'Sui',
    ticker: 'SUI',
    balance: formatBalance(BigInt(mist), 9),
    balanceMist: mist,
    asOf: new Date().toISOString(),
  }
}

export type SuiTokenBalance = {
  address: string
  coinType: string
  balance: string
  asOf: string
}

/** Get balance of a specific fungible token on Sui (base units). */
export async function getSuiTokenBalance(address: string, coinType: string): Promise<SuiTokenBalance> {
  const response = await fetchJson<{ result: { totalBalance: string } }>('https://sui-rpc.publicnode.com', {
    jsonrpc: '2.0',
    id: 1,
    method: 'suix_getBalance',
    params: [address, coinType],
  })
  return {
    address,
    coinType,
    balance: response.result.totalBalance,
    asOf: new Date().toISOString(),
  }
}

export type SuiAllBalancesResult =
  | { ok: true; address: string; chain: 'Sui'; balances: SuiCoinBalance[]; asOf: string }
  | { ok: false; error: 'tokens_unavailable'; chain: 'Sui'; address: string; detail: string }

export type SuiCoinBalance = {
  coinType: string
  ticker: string
  isNative: boolean
  balance: string
  balanceBaseUnits: string
}

const SUI_NATIVE_TYPES = new Set([
  '0x2::sui::SUI',
  '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
])

/**
 * Get ALL coin balances for a Sui address in ONE call (native SUI + every
 * fungible token held) via suix_getAllBalances.
 *
 * A typo'd address, an upstream fault, or a non-integer balance returns a
 * deterministic `tokens_unavailable` signal rather than masking it as an empty
 * wallet — under-reporting a portfolio as if complete is a fund-visibility bug.
 */
export async function getSuiAllBalances(address: string): Promise<SuiAllBalancesResult> {
  let response: {
    result?: Array<{ coinType: string; totalBalance: string; coinObjectCount: number }>
    error?: { code?: number; message?: string }
  }
  try {
    response = await fetchJson('https://sui-rpc.publicnode.com', {
      jsonrpc: '2.0',
      id: 1,
      method: 'suix_getAllBalances',
      params: [address],
    })
  } catch (e) {
    return {
      ok: false,
      error: 'tokens_unavailable',
      chain: 'Sui',
      address,
      detail: e instanceof Error ? e.message : String(e),
    }
  }

  // Sui answers HTTP 200 even for a bad address, carrying { error } instead of
  // result — surface it as tokens_unavailable, not "you hold nothing".
  if (response.error) {
    return {
      ok: false,
      error: 'tokens_unavailable',
      chain: 'Sui',
      address,
      detail: response.error.message ?? `Sui RPC error${response.error.code != null ? ` ${response.error.code}` : ''}`,
    }
  }
  if (!Array.isArray(response.result)) {
    return {
      ok: false,
      error: 'tokens_unavailable',
      chain: 'Sui',
      address,
      detail: 'Sui RPC returned neither a result array nor an error — malformed upstream response.',
    }
  }

  const balances: SuiCoinBalance[] = []
  for (const b of response.result) {
    let amount: bigint
    try {
      amount = BigInt(b.totalBalance)
    } catch {
      return {
        ok: false,
        error: 'tokens_unavailable',
        chain: 'Sui',
        address,
        detail: `Sui RPC returned a non-integer balance for ${b.coinType} — refusing to report a partial portfolio.`,
      }
    }
    if (amount <= 0n) continue

    const native = SUI_NATIVE_TYPES.has(b.coinType)
    // Ticker = outer struct name; strip any generic type-arg suffix first
    // (…::lp::LP<0x2::sui::SUI,…> → …::lp::LP) so it doesn't read "SUI>".
    const bareType = b.coinType.split('<')[0]
    const ticker = native ? 'SUI' : bareType.split('::').pop() || b.coinType
    balances.push({
      coinType: b.coinType,
      ticker,
      isNative: native,
      balance: native ? formatBalance(amount, 9) : b.totalBalance,
      balanceBaseUnits: b.totalBalance,
    })
  }

  return { ok: true, address, chain: 'Sui', balances, asOf: new Date().toISOString() }
}

// ── Cardano ─────────────────────────────────────────────────────────────────

export type CardanoNativeToken = {
  unit: string
  policyId: string
  assetNameHex: string
  quantity: string
}

export type CardanoBalance = {
  address: string
  balanceLovelaces: string
  balanceAda: string
  nativeTokens: CardanoNativeToken[]
  asOf: string
}

/**
 * Query the native ADA balance + native-token holdings of a Cardano address
 * via two parallel Koios v1 reads through the Vultisig proxy.
 */
export async function getCardanoBalance(address: string): Promise<CardanoBalance> {
  if (!address) throw new Error('No Cardano address provided.')

  const [infoRes, assetsRes] = await Promise.all([
    fetchJson<{ address: string; balance: string }[]>(`${ROOT_API_URL}/cardano/address_info`, {
      _addresses: [address],
    }),
    fetchJson<{ address: string; asset_list: { policy_id: string; asset_name: string; quantity: string }[] }[]>(
      `${ROOT_API_URL}/cardano/address_assets`,
      { _addresses: [address] }
    ),
  ])

  const lovelaceStr = infoRes[0]?.balance ?? '0'
  const lovelaceBig = BigInt(lovelaceStr)
  const whole = lovelaceBig / 1_000_000n
  const frac = lovelaceBig % 1_000_000n
  const balanceAda = `${whole}.${frac.toString().padStart(6, '0')}`

  const assetList = assetsRes[0]?.asset_list ?? []
  const nativeTokens = assetList.map(a => ({
    unit: a.policy_id + a.asset_name,
    policyId: a.policy_id,
    assetNameHex: a.asset_name,
    quantity: a.quantity,
  }))

  return {
    address,
    balanceLovelaces: lovelaceStr,
    balanceAda,
    nativeTokens,
    asOf: new Date().toISOString(),
  }
}
