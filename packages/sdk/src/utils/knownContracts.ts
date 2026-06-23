/**
 * knownContracts — canonical contract / token registry.
 *
 * A single SDK-owned table of well-known public-infrastructure addresses:
 * canonical stablecoin / token contracts (USDC, USDT, WETH, DAI, WBTC…),
 * DEX / aggregator / bridge routers (LI.FI Diamond, 1inch, 0x, Uniswap
 * V4 deployments, Permit2…), Solana program IDs + SPL mints, and Tron
 * TRC-20 / SUNSwap contracts.
 *
 * These are FIXED, publicly-documented protocol constants — never user
 * wallet addresses. Consumers use this table to tell "public protocol
 * contract" apart from "a wallet address the agent may have invented":
 *
 *   - mcp-ts `search_token` canonical-token overlay folds into this table.
 *   - agent-backend's fabricated_address validator uses an equivalent Go
 *     table (validator/address/canonical_{contracts,solana,tron}.go) as a
 *     pre-grounding bypass for named public constants. This is the TS port
 *     of that data so the registry lives in one place.
 *
 * This module is PURE DATA + format-validating lookup helpers. It never
 * signs, never broadcasts, and never makes a judgement about agent intent —
 * it only answers "is this address a known canonical contract?".
 *
 * Address-form conventions (mirrors the Go source):
 *   - EVM: stored lowercase, looked up case-insensitively (checksum variants
 *     all collapse to one canonical lowercase entry). Format-validated as
 *     0x + exactly 40 hex chars before lookup.
 *   - Solana: base58, case-sensitive — stored + matched verbatim.
 *   - Tron: base58check, case-sensitive — stored + matched verbatim.
 *
 * Each set additionally supports an ELLIPSIZED match (e.g. "0xA0b8…eB48" /
 * "EPjFWd...Dt1v") because tool envelopes and narrations render contracts in
 * display-truncated form. The ellipsized check matches by prefix + suffix,
 * the same semantics the agent-backend grounding layer uses.
 */

// ----------------------------------------------------------------------------
// Canonical EVM contracts (lowercase hex). Ported from
// validator/address/canonical_contracts.go.
// ----------------------------------------------------------------------------

/**
 * Set of known mainnet/L2 EVM contract addresses, stored as lowercase hex
 * (0x + 40 hex digits). Tokens + routers across the supported EVM chains.
 */
export const canonicalEvmContracts: ReadonlySet<string> = new Set([
  // --- Stablecoins / tokens ---
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC — Ethereum
  '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT — Ethereum
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH9 — Ethereum
  '0x66a1e37c9b0eaddca17d3662d6c05f4decf3e110', // Polymarket CTF Exchange — Polygon
  '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', // USDC (native) — Polygon
  '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', // Bridged USDC.e — Polygon
  '0x0b2c639c533813f4aa9d7837caf62653d097ff85', // USDC — Optimism
  '0xaf88d065e77c8cc2239327c5edb3a432268e5831', // USDC — Arbitrum One
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC — Base
  '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e', // USDC — Avalanche C-Chain
  '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', // USDC — BNB Smart Chain
  '0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7', // USDT — Avalanche C-Chain
  '0x056fd409e1d7a124bd7017459dfea2f387b6d5cd', // GUSD (Gemini Dollar) — Ethereum
  '0x8e870d67f660d95d5be530380d0ec0bd388289e1', // USDP (Pax Dollar) — Ethereum
  '0x0001a500a6b18995b03f44bb040a5ffc28e45cb0', // OLAS (Autonolas) — Ethereum
  '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI — Ethereum
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', // WBTC — Ethereum
  '0x55d398326f99059ff775485246999027b3197955', // Binance-Peg USDT — BSC
  '0xb788144df611029c60b859df47e79b7726c4deba', // VULT — Ethereum
  '0xcacd6fd266af91b8aed52accc382b4e165586e29', // FRXUSD (Frax USD) — Ethereum

  // --- DEX / aggregator / bridge routers ---
  '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae', // LI.FI Diamond (multi-chain)
  '0xdef1c0ded9bec7f1a1670819833240f027b25eff', // 0x ExchangeProxy v4 — Ethereum
  '0x1111111254eeb25477b68fb85ed929f73a960582', // 1inch Aggregation Router v5 — Ethereum
  '0x1111111254fb6c44bac0bed2854e76f90643097d', // 1inch Aggregation Router v4 — Ethereum
  '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45', // Uniswap SwapRouter02 — Ethereum
  '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad', // Uniswap Universal Router — Ethereum
  '0x000000000022d473030f116ddee9f6b43ac78ba3', // Uniswap Permit2 (every chain)

  // --- Uniswap V4 PoolManager (per chain) ---
  '0x000000000004444c5dc75cb358380d2e3de08a90', // Ethereum
  '0x360e68faccca8ca495c1b759fd9eee466db9fb32', // Arbitrum
  '0x06380c0e0912312b5150364b9dc4542ba0dbbc85', // Avalanche
  '0x28e2ea090877bf75740558f6bfb36a5ffee9e9df', // BSC
  '0x498581ff718922c3f8e6a244956af099b2652b2b', // Base
  '0x1631559198a9e474033433b2958dabc135ab6446', // Blast
  '0x9a13f98cb987694c9f086b1f5eb990eea8264ec3', // Optimism
  '0x67366782805870060151383f4bbff9dab53e5cd6', // Polygon

  // --- Uniswap V4 PositionManager (per chain) ---
  '0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e', // Ethereum
  '0xd88f38f930b7952f2db2432cb002e7abbf3dd869', // Arbitrum
  '0xb74b1f14d2754acfcbbe1a221023a5cf50ab8acd', // Avalanche
  '0x7a4a5c919ae2541aed11041a1aeee68f1287f95b', // BSC
  '0x7c5f5a4bbd8fd63184577525326123b519429bdc', // Base
  '0x4ad2f4cca2682cbb5b950d660dd458a1d3f1baad', // Blast
  '0x3c3ea4b57a46241e54610e5f022e5c45859a1017', // Optimism
  '0x1ec2ebf4f37e7363fdfe3551602425af0b3ceef9', // Polygon

  // --- Uniswap V4 Quoter (per chain) ---
  '0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203', // Ethereum
  '0x3972c00f7ed4885e145823eb7c655375d275a1c5', // Arbitrum
  '0xbe40675bb704506a3c2ccfb762dcfd1e979845c2', // Avalanche
  '0x9f75dd27d6664c475b90e105573e550ff69437b0', // BSC
  '0x0d5e0f971ed27fbff6c2837bf31316121532048d', // Base
  '0x6f71cdcb0d119ff72c6eb501abceb576fbf62bcf', // Blast
  '0x1f3131a13296fb91c90870043742c3cdbff1a8d7', // Optimism
  '0xb3d5c3dfc3a7aebff71895a7191796bffc2c81b9', // Polygon

  // --- Uniswap V4 StateView (per chain) ---
  '0x7ffe42c4a5deea5b0fec41c94c136cf115597227', // Ethereum
  '0x76fd297e2d437cd7f76d50f01afe6160f86e9990', // Arbitrum
  '0xc3c9e198c735a4b97e3e683f391ccbdd60b69286', // Avalanche
  '0xd13dd3d6e93f276fafc9db9e6bb47c1180aee0c4', // BSC
  '0xa3c0c9b65bad0b08107aa264b0f3db444b867a71', // Base
  '0x12a88ae16f46dce4e8b15368008ab3380885df30', // Blast
  '0xc18a3169788f4f75a170290584eca6395c75ecdb', // Optimism
  '0x5ea1bd7974c8a611cbab0bdcafcb1d9cc9b3ba5a', // Polygon

  // --- Uniswap V4 Universal Router 2.0 (per chain) ---
  '0x66a9893cc07d91d95644aedd05d03f95e1dba8af', // Ethereum
  '0xa51afafe0263b40edaef0df8781ea9aa03e381a3', // Arbitrum
  '0x94b75331ae8d42c1b61065089b7d48fe14aa73b7', // Avalanche
  '0x1906c1d672b88cd1b9ac7593301ca990f94eae07', // BSC
  '0x6ff5693b99212da76ad316178a184ab56d299b43', // Base
  '0xeabbcb3e8e415306207ef514f660a3f820025be3', // Blast
  '0x851116d9223fabed8e56c0e6b8ad0c31d98b3507', // Optimism
  '0x1095692a6237d83c6a72f3f5efedb9a670c49223', // Polygon

  // --- Uniswap V4 Universal Router 2.1.1 ---
  '0x8b844f885672f333bc0042cb669255f93a4c1e6b', // shared Arbitrum/Avalanche/BSC/Blast/Optimism/Polygon
  '0xfdf682f51fe81aa4898f0ae2163d8a55c127fbc7', // Base-specific
  '0x4c82d1fbfe28c977cbb58d8c7ff8fcf9f70a2cca', // Ethereum-specific

  // --- GLIF / ICN (Filecoin liquid staking) — Base ---
  '0xe0cd4cacddcbf4f36e845407ce53e87717b6601d', // ICNT token
  '0xaed7c2ed7bb84396afcb55ff72c8f8e87ffb68f3', // GLIF ICN pool

  // --- Ultrayield ERC-4626 vaults — Ethereum ---
  '0x8ecc0b419dfe3ae197bc96f2a03636b5e1be91db',
  '0x472425cc95be779126afa4aa17980210d299914f',
  '0x546329a16dcedc46e93f7b03a65f49a84700bca1',
  '0xaa3cb36be406e6cf208d218fd214e0f1a71e957d',
  '0xfacaa225fcfcd8644a77f2cce833907537198ae9',
  '0xc46efcc8e39c8f02425e367423871cd4633b7908',
  '0x36bdaefd92579da58bfe207e16dafa39835bbcb3',

  // --- Clearstar Morpho ERC-4626 vaults ---
  '0x62fe596d59fb077c2df736df212e0affb522dc78', // USDC Reactor — Ethereum
  '0xa3fc33543beee52bc60babc80af3d29789637b6d', // Reactor ETH — Ethereum
  '0xa1ff9c28ebc160c1dcde4b9aa9551f617880c6fb', // Re Ecosystem USDC — Ethereum
  '0x1d3b1cd0a0f242d598834b3f2d126dc6bd774657', // USDC Reactor — Base
  '0xe74c499fa461af1844fca84204490877787ced56', // Yield Clearstar USDC — Base
  '0x09832347586e238841f49149c84d121bc2191c53', // ETH Reactor — Base
  '0x43e623ff7d14d5b105f7be9c488f36dbf11d1f46', // Boring USDC — Base
  '0x64ca76e2525fc6ab2179300c15e343d73e42f958', // High Yield USDC — Arbitrum
])

// ----------------------------------------------------------------------------
// Canonical Solana program IDs + SPL mints (base58, case-sensitive).
// Ported from validator/address/canonical_solana.go.
// ----------------------------------------------------------------------------

/**
 * Set of canonical Solana program IDs and SPL token mints, stored verbatim
 * (base58 is case-sensitive, so no normalization).
 */
export const canonicalSolanaAddresses: ReadonlySet<string> = new Set([
  // --- Jupiter aggregator ---
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // V6 router
  'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB', // V4 router (legacy)
  // --- Canonical SPL token mints ---
  'So11111111111111111111111111111111111111112', // Wrapped SOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC (Circle)
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT (Tether)
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', // JUP (Jupiter)
  // --- Solana system / token programs ---
  '11111111111111111111111111111111', // System Program
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token program
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', // SPL Token-2022 program
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // Associated Token Account program
  'ComputeBudget111111111111111111111111111111', // Compute Budget program
])

// ----------------------------------------------------------------------------
// Canonical Tron TRC-20 / SUNSwap contracts (base58check, case-sensitive).
// Ported from validator/address/canonical_tron.go.
// ----------------------------------------------------------------------------

/**
 * Set of canonical Tron mainnet TRC-20 token + SUNSwap V3 contracts, stored
 * verbatim (base58check is case-sensitive).
 */
export const canonicalTronContracts: ReadonlySet<string> = new Set([
  'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', // USDT (TRC-20)
  'TThJt8zaJzJMhCEScH7zWKnp5buVZqys9x', // SUNSwap V3 factory
  'TQAvWQpT9H916GckwWDJNhYZvQMkuRL7PN', // SUNSwap V3 swap router
  'TLSWrv7eC1AZCXkRjpqMZUmvgd99cj7pPF', // SUNSwap V3 nonfungible position manager
  'TLhZ48yfHygMLM2uZr87zJJusHjGen97gh', // SUNSwap V3 quoter
  'TBBjWiPHouzEx2QRjBzTw9EA8YjG43XiAi', // SUNSwap V3 tick lens
  'TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR', // Wrapped TRX (WTRX)
])

// ----------------------------------------------------------------------------
// Lookup helpers
// ----------------------------------------------------------------------------

// Ellipsized display rendering: a head, an ellipsis (… or ...), and a tail.
// Mirrors the agent-backend reTrunc semantics. Captures head + tail.
const ELLIPSIZED_RE = /^([A-Za-z0-9]+)(?:\.{3}|…)([A-Za-z0-9]+)$/

/**
 * Returns true when `addr` is a well-formed EVM address (0x + exactly 40 hex
 * chars). Used to reject malformed input before a lookup.
 */
export function isEvmAddressFormat(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr)
}

/**
 * Returns true when `addr` is a known canonical EVM contract. Validates EVM
 * address format first, then does a case-insensitive lookup (checksum
 * variants collapse to the lowercase canonical entry).
 */
export function isCanonicalEvmContract(addr: string): boolean {
  if (!addr || !isEvmAddressFormat(addr)) return false
  return canonicalEvmContracts.has(addr.toLowerCase())
}

/**
 * Returns true when an ELLIPSIZED EVM display rendering ("0xA0b8…eB48" /
 * "0xA0b8...eB48") matches a canonical EVM contract by prefix + suffix.
 * Comparison is case-insensitive (EVM hex).
 */
export function isCanonicalEvmContractEllipsized(addr: string): boolean {
  const m = ELLIPSIZED_RE.exec((addr ?? '').trim())
  if (!m) return false
  const head = m[1].toLowerCase()
  const tail = m[2].toLowerCase()
  for (const full of canonicalEvmContracts) {
    if (full.startsWith(head) && full.endsWith(tail)) return true
  }
  return false
}

/**
 * Returns true when `addr` is a known canonical Solana program ID or SPL
 * mint. Base58 is case-sensitive, so this is an exact lookup.
 */
export function isCanonicalSolanaAddress(addr: string): boolean {
  if (!addr) return false
  return canonicalSolanaAddresses.has(addr)
}

/**
 * Returns true when an ELLIPSIZED Solana display rendering ("EPjFWd...Dt1v")
 * matches a canonical Solana address by prefix + suffix. Case-sensitive
 * (base58).
 */
export function isCanonicalSolanaAddressEllipsized(addr: string): boolean {
  const m = ELLIPSIZED_RE.exec((addr ?? '').trim())
  if (!m) return false
  const head = m[1]
  const tail = m[2]
  for (const full of canonicalSolanaAddresses) {
    if (full.startsWith(head) && full.endsWith(tail)) return true
  }
  return false
}

/**
 * Returns true when `addr` is a known canonical Tron TRC-20 / SUNSwap
 * contract. Base58check is case-sensitive, so this is an exact lookup.
 */
export function isCanonicalTronContract(addr: string): boolean {
  if (!addr) return false
  return canonicalTronContracts.has(addr)
}

/**
 * Chain-agnostic predicate: returns true when `addr` is any known canonical
 * contract (EVM full or ellipsized, Solana full or ellipsized, or Tron).
 *
 * This is the TS equivalent of the Go `IsKnownContract` exported predicate.
 * It is the address-format / registry layer ONLY — it makes no judgement
 * about whether the address is being used legitimately in context. That
 * intent decision stays in the agent backend.
 */
export function isKnownContract(addr: string): boolean {
  return (
    isCanonicalEvmContract(addr) ||
    isCanonicalEvmContractEllipsized(addr) ||
    isCanonicalSolanaAddress(addr) ||
    isCanonicalSolanaAddressEllipsized(addr) ||
    isCanonicalTronContract(addr)
  )
}

/**
 * Namespaced facade — `sdk.knownContracts`. Groups the registry sets + lookup
 * helpers so consumers can do `knownContracts.isKnownContract(addr)` or read
 * `knownContracts.canonicalEvmContracts` directly.
 */
export const knownContracts = {
  canonicalEvmContracts,
  canonicalSolanaAddresses,
  canonicalTronContracts,
  isEvmAddressFormat,
  isCanonicalEvmContract,
  isCanonicalEvmContractEllipsized,
  isCanonicalSolanaAddress,
  isCanonicalSolanaAddressEllipsized,
  isCanonicalTronContract,
  isKnownContract,
} as const
