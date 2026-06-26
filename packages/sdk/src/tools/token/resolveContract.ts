import { PublicKey } from '@solana/web3.js'
import { CosmosChain, EvmChain } from '@vultisig/core-chain/Chain'
import { getCosmosWasmTokenInfoUrl } from '@vultisig/core-chain/chains/cosmos/cosmosRpcUrl'
import { getEvmClient } from '@vultisig/core-chain/chains/evm/client'
import { getSolanaClient } from '@vultisig/core-chain/chains/solana/client'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import bs58 from 'bs58'
import { erc20Abi } from 'viem'

/**
 * On-chain token metadata probe (symbol / decimals / name) for a contract or
 * mint address. Use this for long-tail tokens that registry search (CoinGecko /
 * `searchToken`) misses — it queries the contract directly over RPC.
 *
 * Supported token standards / chains:
 *  - ERC-20 (EVM): every {@link EvmChain} (Ethereum, Base, Arbitrum, Polygon, …)
 *  - CW20 (CosmWasm): TerraClassic, Terra, Osmosis, Kujira. Cosmos Hub is
 *    intentionally excluded — Gaia ships no CosmWasm module, so
 *    `/cosmwasm/wasm/v1/...` 404s for every address there.
 *  - SPL (Solana): reads the mint account via the parsed-account RPC. SPL mints
 *    do not embed symbol/name on-chain (that lives in the Metaplex metadata
 *    PDA), so only `decimals` is returned for Solana.
 *
 * Fails closed: if the address is not a recognized token contract / mint, this
 * rejects — it never fabricates a symbol or decimals.
 *
 * @example
 * ```ts
 * const usdc = await resolveContract(
 *   'Ethereum',
 *   '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
 * )
 * // => { chain: 'Ethereum', contractAddress: '0xa0b8...', symbol: 'USDC',
 * //      decimals: 6, name: 'USD Coin', tokenStandard: 'erc20' }
 * ```
 */

export type TokenStandard = 'erc20' | 'cw20' | 'spl'

export type ResolveContractResult = {
  chain: EvmChain | CosmosChain | 'Solana'
  contractAddress: string
  decimals: number
  tokenStandard: TokenStandard
  /** Absent for SPL mints (symbol lives off-chain in the Metaplex PDA). */
  symbol?: string
  /** Absent for SPL mints; defaults to `symbol` for CW20/ERC-20 when unset. */
  name?: string
  /** Present when the contract exposes total supply (CW20 / SPL). */
  totalSupply?: string
}

// CW20 metadata probe is only meaningful on CosmWasm-enabled cosmos chains.
// Cosmos Hub (Gaia) has no CosmWasm module → excluded.
const CW20_CHAINS = [CosmosChain.TerraClassic, CosmosChain.Terra, CosmosChain.Osmosis, CosmosChain.Kujira] as const
type Cw20Chain = (typeof CW20_CHAINS)[number]

// Expected bech32 HRP per CW20 chain. Used to fail closed on wrong-chain
// confusion: a `terra1…` address passed with `chain: 'Osmosis'` must reject
// BEFORE any RPC fires, instead of querying the Osmosis LCD with a Terra
// address (which would 404 against a different contract namespace, or worse,
// silently hit a same-shaped address on the wrong chain). Mirrors mcp-ts's
// `validateBech32Contract(addr, expectedPrefix)` prefix guard.
const CW20_CHAIN_PREFIX: Record<Cw20Chain, string> = {
  [CosmosChain.TerraClassic]: 'terra',
  [CosmosChain.Terra]: 'terra',
  [CosmosChain.Osmosis]: 'osmo',
  [CosmosChain.Kujira]: 'kujira',
}

const isEvmChain = (chain: string): chain is EvmChain => Object.values(EvmChain).includes(chain as EvmChain)

const isCw20Chain = (chain: string): chain is Cw20Chain => (CW20_CHAINS as readonly string[]).includes(chain)

// decimals is the fund-relevant field: downstream builders/balances scale
// amounts by 10**decimals, so a fractional / negative / absurd value silently
// corrupts every amount. CW20 (u8 in the CW20 spec) and SPL (u8 mint decimals)
// are both byte-typed on-chain, so a valid decimals is an integer in [0, 255].
// ERC-20 keeps its own (stricter, mcp-ts-parity) <=77 cap inline. This guards
// the CW20/SPL paths, which previously only checked `typeof === 'number'` and
// would have let a JSON `6.5` / `-1` / `300` (or NaN-free float) through.
const isValidByteDecimals = (d: unknown): d is number =>
  typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 255

// ── ERC-20 ──────────────────────────────────────────────────────────────────

const SYMBOL_SELECTOR = '0x95d89b41'
const NAME_SELECTOR = '0x06fdde03'

/**
 * Decode an ABI-encoded `string` return value, with a bytes32 fallback for
 * legacy tokens (MKR / SAI class) that return a right-padded bytes32 from
 * `symbol()` / `name()` instead of a canonical dynamic string.
 */
const decodeAbiString = (hex: string): string | null => {
  const raw = hex.startsWith('0x') ? hex.slice(2) : hex
  // Canonical dynamic string: offset(32) + length(32) + data. The first word is
  // the byte-offset to the length word; for a single returned `string` it is
  // always 0x20 (32). Validate it rather than blindly assuming the framing, so a
  // contract returning a bogus offset / length-lie can't be mis-decoded into a
  // plausible-looking symbol (these feed the fund-relevant resolver result).
  if (raw.length >= 128) {
    const offset = parseInt(raw.slice(0, 64), 16)
    const strLen = parseInt(raw.slice(64, 128), 16)
    if (offset === 32 && Number.isFinite(strLen) && 128 + strLen * 2 <= raw.length) {
      const strHex = raw.slice(128, 128 + strLen * 2)
      const decoded = Buffer.from(strHex, 'hex').toString('utf-8').replace(/\0+$/, '')
      if (decoded) return decoded
    }
  }
  // bytes32 fallback: exactly 32 bytes, right-padded with null bytes.
  if (raw.length === 64) {
    const decoded = Buffer.from(raw, 'hex').toString('utf-8').replace(/\0+$/, '')
    if (decoded) return decoded
  }
  return null
}

const resolveErc20 = async (chain: EvmChain, contractAddress: string): Promise<ResolveContractResult> => {
  if (!/^0x[0-9a-fA-F]{40}$/.test(contractAddress)) {
    throw new Error(
      `invalid contractAddress for ${chain}: expected a 0x-prefixed 20-byte hex address, got "${contractAddress}"`
    )
  }
  const address = contractAddress.toLowerCase() as `0x${string}`
  const client = getEvmClient(chain)

  // decimals() is a uint8 — viem's typed read is the robust path here. symbol()
  // / name() go through a raw eth_call so we can fall back to bytes32 decoding
  // for legacy tokens that viem's strict string decoder would reject.
  const [decimals, symbolHex, nameHex] = await Promise.all([
    client.readContract({ address, abi: erc20Abi, functionName: 'decimals' }),
    client.call({ to: address, data: SYMBOL_SELECTOR }),
    // name() is optional in ERC-20 and some contracts revert on it; tolerate
    // failures here and fall back to symbol below.
    client.call({ to: address, data: NAME_SELECTOR }).catch(() => ({ data: undefined })),
  ])

  if (
    typeof decimals !== 'number' ||
    !Number.isInteger(decimals) ||
    !Number.isFinite(decimals) ||
    decimals < 0 ||
    decimals > 77
  ) {
    throw new Error(`contract on ${chain} did not return valid ERC-20 decimals (not an ERC-20 contract?)`)
  }

  const symbol = symbolHex.data ? decodeAbiString(symbolHex.data) : null
  if (!symbol) {
    throw new Error(`contract on ${chain} did not return a valid ERC-20 symbol (not an ERC-20 contract?)`)
  }

  const name = (nameHex.data ? decodeAbiString(nameHex.data) : null) ?? symbol

  return {
    chain,
    contractAddress: address,
    symbol,
    decimals,
    name,
    tokenStandard: 'erc20',
  }
}

// ── CW20 ────────────────────────────────────────────────────────────────────

type CW20TokenInfo = {
  name: string
  symbol: string
  decimals: number
  total_supply: string
}

// CosmWasm smart-query responses are wrapped in a `{ data: ... }` envelope.
type SmartQueryEnvelope<T> = { data: T }

const resolveCw20 = async (chain: Cw20Chain, contractAddress: string): Promise<ResolveContractResult> => {
  const id = contractAddress.trim()
  // bech32 charset + prefix sanity check. We avoid a full bech32 decode (no
  // declared dep) and fail closed: the LCD smart query rejects a malformed id.
  const m = /^([a-z]+)1([02-9ac-hj-np-z]{20,80})$/.exec(id)
  if (!m) {
    throw new Error(
      `invalid contractAddress for ${chain}: expected a bech32 CosmWasm contract address (e.g. terra1..., osmo1...), got "${contractAddress}"`
    )
  }
  // Wrong-chain guard: reject an address whose HRP doesn't match the requested
  // chain (e.g. a terra1… passed with chain='Osmosis') BEFORE any RPC fires.
  const expectedPrefix = CW20_CHAIN_PREFIX[chain]
  if (m[1] !== expectedPrefix) {
    throw new Error(
      `invalid contractAddress for ${chain}: address prefix "${m[1]}" does not match expected "${expectedPrefix}" for this chain — are you on the right chain?`
    )
  }

  let info: CW20TokenInfo
  try {
    const url = getCosmosWasmTokenInfoUrl({ chain, id })
    const resp = await queryUrl<SmartQueryEnvelope<CW20TokenInfo>>(url)
    info = resp.data
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`not a recognized CW20 token contract on ${chain}: ${msg}`)
  }

  if (!info?.symbol || !isValidByteDecimals(info.decimals)) {
    throw new Error(`contract on ${chain} did not return a valid CW20 token_info (not a CW20 contract?)`)
  }

  return {
    chain,
    contractAddress: id,
    symbol: info.symbol,
    decimals: info.decimals,
    name: info.name ?? info.symbol,
    tokenStandard: 'cw20',
    ...(info.total_supply ? { totalSupply: info.total_supply } : {}),
  }
}

// ── SPL ─────────────────────────────────────────────────────────────────────

type ParsedMintInfo = {
  decimals: number
  supply: string
}

const resolveSpl = async (mintAddress: string): Promise<ResolveContractResult> => {
  const mint = mintAddress.trim()
  let decoded: Uint8Array
  try {
    decoded = bs58.decode(mint)
  } catch {
    throw new Error(`invalid contractAddress for Solana: not a base58 address ("${mintAddress}")`)
  }
  if (decoded.length !== 32) {
    throw new Error(
      `invalid contractAddress for Solana: expected a base58-encoded 32-byte mint address, got "${mintAddress}"`
    )
  }

  const client = getSolanaClient()
  const resp = await client.getParsedAccountInfo(new PublicKey(mint))
  const value = resp.value
  if (!value) {
    throw new Error(`not a recognized SPL token mint on Solana: account not found`)
  }

  const data = value.data
  if (!('parsed' in data) || data.parsed?.type !== 'mint') {
    const type = 'parsed' in data ? data.parsed?.type : 'raw'
    throw new Error(`not a recognized SPL token mint on Solana: account is not a mint (type=${type ?? 'unknown'})`)
  }

  const info = data.parsed.info as ParsedMintInfo
  if (!isValidByteDecimals(info?.decimals)) {
    throw new Error(`SPL mint account on Solana did not expose valid decimals`)
  }

  // SPL mints don't embed symbol/name on-chain (Metaplex token-metadata PDA),
  // so we return only what the mint account holds rather than fabricate.
  return {
    chain: 'Solana',
    contractAddress: mint,
    decimals: info.decimals,
    tokenStandard: 'spl',
    ...(info.supply ? { totalSupply: info.supply } : {}),
  }
}

// ── entrypoint ──────────────────────────────────────────────────────────────

/**
 * Resolve on-chain token metadata for a contract / mint address.
 *
 * @param chain - Chain to probe. Any {@link EvmChain}, the CosmWasm chains
 *   (TerraClassic / Terra / Osmosis / Kujira), or Solana.
 * @param contractAddress - Contract / mint address (0x hex for EVM, bech32 for
 *   CosmWasm, base58 for Solana).
 * @throws if the chain is unsupported or the address is not a recognized token
 *   contract — never returns fabricated metadata.
 */
export const resolveContract = async (
  chain: EvmChain | Cw20Chain | 'Solana',
  contractAddress: string
): Promise<ResolveContractResult> => {
  if (isEvmChain(chain)) {
    return resolveErc20(chain, contractAddress.trim())
  }
  if (isCw20Chain(chain)) {
    return resolveCw20(chain, contractAddress)
  }
  if (chain === 'Solana') {
    return resolveSpl(contractAddress)
  }
  throw new Error(
    `unsupported chain for resolveContract: "${chain}". Supported: EVM chains, ` +
      `CosmWasm (TerraClassic/Terra/Osmosis/Kujira), and Solana.`
  )
}
