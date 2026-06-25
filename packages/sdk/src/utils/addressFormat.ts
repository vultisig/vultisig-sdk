/**
 * Pure address-format validation primitives.
 *
 * Canonical port of the FORMAT rules from the agent backend's
 * chain-prefix / per-family address validators
 * (agent-backend internal/service/agent/validator/chain_prefix_extractor.go
 * and validator/address/*.go) and the abt src/mastra/chainPrefix.ts mirror.
 *
 * Scope: FORMAT ONLY — regex shape, bech32 HRP, base58-decode length.
 * This module answers two questions:
 *   1. `classifyAddress(addr)` -> which chain family does this address belong to?
 *   2. `isAddressValidForChain(addr, chain)` -> is this address a valid format
 *      for the given chain (HRP/prefix match)?
 *
 * It deliberately does NOT do:
 *   - intent-match (does the address match what the user asked for)
 *   - grounding (is the address present in tool output)
 *   - prompt-injection / fabrication detection
 *   - checksum verification (shape-valid is the contract here, same as the
 *     backend extractors which validate shape, not cryptographic checksum)
 * Those stay in the agent backend's judgement layer. This is pure crypto
 * format-validation, RN-safe (bs58 is pure JS), no network, no signing.
 */

import bs58 from 'bs58'

/**
 * Coarse chain-family tag. Mirrors the backend `address.Family` enum.
 * `unknown` is returned when an address matches no known family format.
 */
export type AddressFamily =
  | 'evm'
  | 'cosmos'
  | 'solana'
  | 'btc'
  | 'bitcoincash'
  | 'litecoin'
  | 'dogecoin'
  | 'dash'
  | 'sui'
  | 'ton'
  | 'tron'
  | 'xrp'
  | 'cardano'
  | 'polkadot'
  | 'bittensor'
  | 'zcash'
  | 'unknown'

// ---------------------------------------------------------------------------
// FORMAT regexes — ported verbatim from chain_prefix_extractor.go (anchored
// full-string variants, NOT the \b-bounded scanning regexes from extract.go).
// ---------------------------------------------------------------------------

/** 0x + exactly 40 hex chars (EVM addresses). */
const reEVM = /^0x[0-9a-fA-F]{40}$/
/** bc1... native SegWit + Taproot. */
const reBTCNativeSegWit = /^bc1[02-9ac-hj-np-z]{25,70}$/
/** P2PKH (1...) and P2SH (3...) legacy Bitcoin. */
const reBTCLegacy = /^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/
/** Bitcoin Cash cashaddr (q/p prefix, 41 chars, optional scheme). */
const reBCH = /^(?:bitcoincash:)?[qp][a-z0-9]{41}$/
/** Litecoin bech32 (ltc1...). */
const reLTCBech32 = /^ltc1[02-9ac-hj-np-z]{25,70}$/
/** Litecoin legacy (L or M prefix). */
const reLTCLegacy = /^[LM][1-9A-HJ-NP-Za-km-z]{25,34}$/
/** Dogecoin (D prefix). */
const reDOGE = /^D[5-9A-HJ-NP-U][1-9A-HJ-NP-Za-km-z]{25,34}$/
/** Dash (X prefix). */
const reDASH = /^X[1-9A-HJ-NP-Za-km-z]{25,34}$/
/** XRP classic (r + base58, 25-34 chars). */
const reXRP = /^r[1-9A-HJ-NP-Za-km-z]{24,33}$/
/** TON user-friendly base64url (EQ.../UQ..., 48 chars). */
const reTON = /^[EU]Q[A-Za-z0-9_-]{46}$/
/** Zcash transparent (t1/t3 + base58). */
const reZcashT = /^t[13][1-9A-HJ-NP-Za-km-z]{32,34}$/
/** Zcash shielded (zs1 + bech32-like). */
const reZcashZ = /^zs1[0-9a-z]{75,80}$/
/** Sui (0x + exactly 64 hex chars). */
const reSui = /^0x[0-9a-fA-F]{64}$/
/** Tron mainnet ('T' + 33 base58, 34 chars total). */
const reTron = /^T[1-9A-HJ-NP-Za-km-z]{33}$/
/** Polkadot SS58 prefix-0 ('1' + 46-47 base58). */
const rePolkadot = /^1[1-9A-HJ-NP-Za-km-z]{46,47}$/
/** Bittensor SS58 prefix-42 ('5' + 46-47 base58). */
const reBittensor = /^5[1-9A-HJ-NP-Za-km-z]{46,47}$/
/** Cardano across Shelley + Byron era families. */
const reCardano =
  /^(addr1[a-z0-9]{50,}|addr_test1[a-z0-9]{50,}|Ae2[1-9A-HJ-NP-Za-km-z]{50,}|DdzFF[1-9A-HJ-NP-Za-km-z]{50,})$/
/** base58-alphabet pre-filter (32-44 chars) before the more expensive decode. */
const reSolanaBase58Alphabet = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

/**
 * Well-known bech32 HRPs that, when a base58-decodable string starts with one,
 * mean it is NOT a Solana key even if it decodes to 32 bytes by coincidence.
 * Ported from chain_prefix_extractor.go knownBech32HRPs.
 */
const knownBech32HRPs = [
  // Account HRPs — verbatim from Go knownBech32HRPs.
  'cosmos1',
  'osmo1',
  'thor1',
  'maya1',
  'kujira1',
  'noble1',
  'inj1',
  'celestia1',
  'dydx1',
  'akash1',
  'stride1',
  'terra1',
  'sei1',
  'kava1',
  'persistence1',
  'axelar1',
  'secret1',
  'cre1',
  'stars1',
  'juno1',
  // Validator-operator (valoper) HRPs — Go carries these so a valoper bech32
  // string that happens to base58-decode to 32 bytes is never misread as a
  // Solana key. Ported 1:1 from Go knownBech32HRPs (chain_prefix_extractor.go).
  'cosmosvaloper1',
  'osmovaloper1',
  'kujivaloper1',
  'dydxvaloper1',
  'akashvaloper1',
  'stridevaloper1',
  'terravaloper1',
  'seivaloper1',
  'kavavaloper1',
  'persistencevaloper1',
  'axelarvaloper1',
  'secretvaloper1',
  'starsvaloper1',
  'junovaloper1',
  // qbtc is SDK-local (Go's base list lacks it); the qbtc account HRP is part
  // of chainHRPMap below so we keep it here too for the Solana-decode guard.
  'qbtc1',
]

/**
 * isSolanaAddress mirrors the backend's isSolanaAddress: base58-alphabet
 * pre-filter, NOT a known bech32 HRP, and base58-decodes to exactly 32 bytes
 * (Ed25519 key size).
 */
export function isSolanaAddress(addr: string): boolean {
  if (!reSolanaBase58Alphabet.test(addr)) return false
  for (const hrp of knownBech32HRPs) {
    if (addr.startsWith(hrp)) return false
  }
  try {
    return bs58.decode(addr).length === 32
  } catch {
    return false
  }
}

/**
 * Cosmos-family HRP table: canonical chain tag -> bech32 human-readable part.
 * Ported from chainHRPMap (cosmosHRP entries) in chain_prefix_extractor.go.
 * An address valid for one of these is `<hrp>1` + 25-70 bech32 chars.
 */
const cosmosHRPByChain: Record<string, string> = {
  cosmos: 'cosmos',
  osmosis: 'osmo',
  thorchain: 'thor',
  mayachain: 'maya',
  kujira: 'kujira',
  noble: 'noble',
  injective: 'inj',
  celestia: 'celestia',
  dydx: 'dydx',
  akash: 'akash',
  stride: 'stride',
  terra: 'terra',
  terraclassic: 'terra',
  sei: 'sei',
  kava: 'kava',
  persistence: 'persistence',
  axelar: 'axelar',
  secret: 'secret',
  crescent: 'cre',
  stargaze: 'stars',
  juno: 'juno',
  qbtc: 'qbtc',
}

/**
 * Cosmos validator-operator (valoper) HRP table: canonical chain tag ->
 * valoper bech32 HRP. Ported 1:1 from Go `cosmosValopers`
 * (chain_prefix_extractor.go).
 *
 * Staking builds carry the validator address under `validator_address`,
 * `validator_src_address`, `validator_dst_address` — those fields use the
 * valoper prefix (`<chain>valoper1…`), NOT the account prefix (`<chain>1…`).
 * Validating a validator field against the ACCOUNT rule is a fund-safety
 * regression: it silently passes a `cosmos1…` delegator address where a
 * validator operator is required, and wrongly rejects a valid
 * `cosmosvaloper1…` operator address.
 *
 * Chains with no public staking validators (thorchain, mayachain, noble,
 * injective, celestia, crescent, qbtc) are intentionally omitted to match Go
 * and avoid false-block risk on non-standard/permissioned staking surfaces.
 */
const cosmosValoperByChain: Record<string, string> = {
  cosmos: 'cosmosvaloper',
  osmosis: 'osmovaloper',
  kujira: 'kujivaloper',
  dydx: 'dydxvaloper',
  akash: 'akashvaloper',
  stride: 'stridevaloper',
  terra: 'terravaloper',
  terraclassic: 'terravaloper',
  sei: 'seivaloper',
  kava: 'kavavaloper',
  persistence: 'persistencevaloper',
  axelar: 'axelarvaloper',
  secret: 'secretvaloper',
  stargaze: 'starsvaloper',
  juno: 'junovaloper',
}

/** All cosmos HRP bodies (deduped) for family classification — includes both account and valoper HRPs. */
const cosmosHRPs = Array.from(new Set([...Object.values(cosmosHRPByChain), ...Object.values(cosmosValoperByChain)]))

/** Build the anchored cosmos bech32 regex for a given HRP. */
function cosmosHRPRegex(hrp: string): RegExp {
  const escaped = hrp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped}1[0-9a-z]{25,70}$`)
}

/** True when addr is a valid cosmos bech32 for ANY known HRP. */
function isAnyCosmosAddress(addr: string): boolean {
  for (const hrp of cosmosHRPs) {
    if (cosmosHRPRegex(hrp).test(addr)) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Per-chain FORMAT rule table. Maps canonical chain tag -> matcher(s).
// Ported from chainHRPMap. EVM-family chains share evmRule, etc.
// ---------------------------------------------------------------------------

type Matcher = (addr: string) => boolean
const re =
  (r: RegExp): Matcher =>
  (addr: string) =>
    r.test(addr)

const evmRule = re(reEVM)

const evmChains = [
  'ethereum',
  'base',
  'polygon',
  'bsc',
  'arbitrum',
  'optimism',
  'avalanche',
  'hyperevm',
  'hyperliquid',
  'katana',
  'plasma',
  'mantle',
  'blast',
  'cronos',
  'zksync',
  'linea',
  'scroll',
]

/**
 * chainFormatRules maps a canonical chain tag to the FORMAT rule(s) valid for
 * that chain. Mirrors chainHRPMap. An address that matches none of a chain's
 * rules is a format/prefix mismatch for that chain.
 */
const chainFormatRules: Record<string, Matcher[]> = {
  // Cosmos family — each chain its own HRP.
  ...Object.fromEntries(Object.entries(cosmosHRPByChain).map(([chain, hrp]) => [chain, [re(cosmosHRPRegex(hrp))]])),
  // EVM family — all share 0x + 40 hex.
  ...Object.fromEntries(evmChains.map(chain => [chain, [evmRule]])),
  solana: [isSolanaAddress],
  bitcoin: [re(reBTCNativeSegWit), re(reBTCLegacy)],
  bitcoincash: [re(reBCH)],
  litecoin: [re(reLTCBech32), re(reLTCLegacy)],
  dogecoin: [re(reDOGE)],
  dash: [re(reDASH)],
  ripple: [re(reXRP)],
  ton: [re(reTON)],
  zcash: [re(reZcashT), re(reZcashZ)],
  sui: [re(reSui)],
  tron: [re(reTron)],
  polkadot: [re(rePolkadot)],
  bittensor: [re(reBittensor)],
  cardano: [re(reCardano)],
}

/**
 * Aliases -> canonical chain tag understood by chainFormatRules.
 * Covers the common tickers / nicknames an LLM or caller may pass. Anything
 * not here is lowercased and looked up directly.
 */
const chainAlias: Record<string, string> = {
  eth: 'ethereum',
  matic: 'polygon',
  pol: 'polygon',
  binance: 'bsc',
  bnb: 'bsc',
  bnbchain: 'bsc',
  arb: 'arbitrum',
  op: 'optimism',
  avax: 'avalanche',
  zk: 'zksync',
  cronoschain: 'cronos',
  cro: 'cronos',
  hype: 'hyperliquid',
  sol: 'solana',
  btc: 'bitcoin',
  bch: 'bitcoincash',
  ltc: 'litecoin',
  doge: 'dogecoin',
  atom: 'cosmos',
  cosmoshub: 'cosmos',
  osmo: 'osmosis',
  thor: 'thorchain',
  maya: 'mayachain',
  kuji: 'kujira',
  inj: 'injective',
  'terra-classic': 'terraclassic',
  'terra classic': 'terraclassic',
  lunc: 'terraclassic',
  ustc: 'terraclassic',
  xrp: 'ripple',
  xrpl: 'ripple',
  zec: 'zcash',
  trx: 'tron',
  dot: 'polkadot',
  tao: 'bittensor',
  ada: 'cardano',
  stars: 'stargaze',
}

/** Resolve an arbitrary chain string to a canonical tag in chainFormatRules. */
export function canonicalChainTag(chain: string): string {
  const key = chain.trim().toLowerCase()
  return chainAlias[key] ?? key
}

/**
 * Ordered family matchers for classification. Order matters: Sui (64-hex) must
 * be checked BEFORE EVM (40-hex) is irrelevant here since both are anchored
 * full-string, but cosmos is checked before the generic base58 Solana decode
 * to avoid a bech32 string coincidentally decoding to 32 bytes.
 */
const familyMatchers: Array<{ family: AddressFamily; match: Matcher }> = [
  { family: 'cosmos', match: isAnyCosmosAddress },
  { family: 'sui', match: re(reSui) },
  { family: 'evm', match: re(reEVM) },
  { family: 'solana', match: isSolanaAddress },
  { family: 'bitcoincash', match: re(reBCH) },
  { family: 'litecoin', match: addr => reLTCBech32.test(addr) || reLTCLegacy.test(addr) },
  { family: 'dogecoin', match: re(reDOGE) },
  { family: 'dash', match: re(reDASH) },
  { family: 'btc', match: addr => reBTCNativeSegWit.test(addr) || reBTCLegacy.test(addr) },
  { family: 'cardano', match: re(reCardano) },
  { family: 'ton', match: re(reTON) },
  { family: 'tron', match: re(reTron) },
  { family: 'xrp', match: re(reXRP) },
  { family: 'zcash', match: addr => reZcashT.test(addr) || reZcashZ.test(addr) },
  { family: 'polkadot', match: re(rePolkadot) },
  { family: 'bittensor', match: re(reBittensor) },
]

/**
 * classifyAddress returns the coarse chain family an address's FORMAT belongs
 * to, or `unknown` when it matches no known family.
 *
 * Note: EVM and Sui both use `0x`-hex; they're disambiguated by length
 * (40 vs 64 hex). Cosmos HRPs and Solana base58 are disambiguated by the
 * known-HRP guard inside isSolanaAddress.
 */
export function classifyAddress(address: string): AddressFamily {
  const addr = address.trim()
  if (addr === '') return 'unknown'
  for (const { family, match } of familyMatchers) {
    if (match(addr)) return family
  }
  return 'unknown'
}

/**
 * Address role within a tool call. Mirrors the Go validator's field-aware
 * routing (chain_prefix_extractor.go):
 *  - `account`   — a normal account/recipient address (default). Validated
 *    against the chain's account HRP (`<chain>1…`).
 *  - `validator` — a validator-operator address (staking `validator_address`,
 *    `validator_src_address`, `validator_dst_address`). On cosmos chains with a
 *    valoper HRP, validated against the valoper rule (`<chain>valoper1…`).
 */
export type AddressRole = 'account' | 'validator'

/**
 * isAddressValidForChain returns true when `address` is a valid FORMAT for
 * `chain` (HRP / prefix / regex match), false on a format/prefix mismatch, and
 * `undefined` when `chain` has no FORMAT rule in the table (caller cannot
 * decide — same semantics as the backend's `!ok` skip on chainHRPMap).
 *
 * When `role === 'validator'` and the (cosmos) chain defines a valoper HRP, the
 * address is validated against the valoper rule (`<chain>valoper1…`) instead of
 * the account rule. This ports the Go `cosmosValopers` / `validatorAddressFields`
 * switch: a staking validator field must carry a `cosmosvaloper1…` operator
 * address, NOT a `cosmos1…` delegator address. Chains without a valoper entry
 * fall back to the account rules (matches Go's `effectiveRules = rules` default).
 */
export function isAddressValidForChain(
  address: string,
  chain: string,
  role: AddressRole = 'account'
): boolean | undefined {
  const tag = canonicalChainTag(chain)
  const rules = chainFormatRules[tag]
  if (!rules) return undefined
  const addr = address.trim()
  if (role === 'validator') {
    const valoperHRP = cosmosValoperByChain[tag]
    if (valoperHRP) {
      return cosmosHRPRegex(valoperHRP).test(addr)
    }
  }
  return rules.some(rule => rule(addr))
}

/** List of canonical chain tags that have a FORMAT rule (for introspection). */
export function supportedChainTags(): string[] {
  return Object.keys(chainFormatRules).sort()
}
