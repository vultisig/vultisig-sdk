import { Chain } from "@vultisig/core-chain/Chain";
import { chainFeeCoin } from "@vultisig/core-chain/coin/chainFeeCoin";

/**
 * Thrown when a chain string cannot be resolved to a known Chain.
 * Error message lists the canonical chain names to help LLM callers recover.
 */
export class UnknownChainError extends Error {
  override readonly name = "UnknownChainError";

  constructor(input: string, known: string[]) {
    super(`Unknown chain "${input}". Known chains: ${known.join(", ")}.`);
  }
}

// Alias table: lowercase key -> Chain value.
// Layer 1: auto-derive from chainFeeCoin tickers only (skip keys that resolve to
//   multiple chains — e.g. ETH covers all L2s sharing the ether metadata).
//   priceProviderId is deliberately NOT used — it conflates coins with chains
//   (e.g. USDC's priceProviderId "usd-coin" lives on many chains, not just Noble).
// Layer 2: hand-curated nicknames that aren't tickers or canonical enum names.
// Layer 3: canonical Chain enum values (always win).
const aliasToChain: Record<string, Chain> = {};

const ownersByAlias = new Map<string, Set<Chain>>();
const claim = (alias: string, chain: Chain) => {
  const key = alias.toLowerCase();
  const owners = ownersByAlias.get(key) ?? new Set<Chain>();
  owners.add(chain);
  ownersByAlias.set(key, owners);
};
for (const [chainKey, meta] of Object.entries(chainFeeCoin)) {
  const chain = chainKey as Chain;
  claim(meta.ticker, chain);
}
for (const [alias, owners] of ownersByAlias) {
  if (owners.size !== 1) continue;
  for (const only of owners) {
    aliasToChain[alias] = only;
    break;
  }
}

// Hand-curated nicknames not covered by tickers or canonical enum names.
Object.assign(aliasToChain, {
  eth: Chain.Ethereum, // ticker collides across all L2s sharing `ether`
  bitcoincash: Chain.BitcoinCash, // canonical `Bitcoin-Cash` has a hyphen; this is the un-hyphenated form
  binance: Chain.BSC,
  binancesmartchain: Chain.BSC,
  matic: Chain.Polygon, // legacy ticker; current fee-coin ticker is POL
  arb: Chain.Arbitrum, // L2 tickers collide via shared ether metadata
  op: Chain.Optimism,
  zk: Chain.Zksync,
  cronos: Chain.CronosChain,
  thor: Chain.THORChain,
  maya: Chain.MayaChain,
});

// Also accept each canonical Chain enum value (case-insensitive). Runs last to override.
for (const value of Object.values(Chain)) {
  aliasToChain[value.toLowerCase()] = value;
}

/**
 * Resolve a case-insensitive chain string (canonical name, ticker, or common
 * alias) to the SDK's canonical Chain value.
 *
 * Accepts:
 * - Canonical Chain enum values (`"Ethereum"`, `"Bitcoin"`, `"Bitcoin-Cash"`, ...)
 * - Tickers (`"btc"`, `"eth"`, `"sol"`, ...)
 * - Common aliases (`"bitcoin"`, `"binance"`, `"thorchain"`, ...)
 *
 * Accepts nullish input because this utility is commonly called with
 * LLM-sourced strings that may be missing — such inputs throw
 * `UnknownChainError` with a blank input rather than a `TypeError`.
 *
 * @throws {UnknownChainError} When the input cannot be resolved.
 */
export const normalizeChain = (input: string | null | undefined): Chain => {
  const key = input?.trim().toLowerCase() ?? "";
  const resolved = aliasToChain[key];
  if (resolved) return resolved;

  const known = Object.values(Chain).map((c) => c.toLowerCase());
  throw new UnknownChainError(key, known);
};
