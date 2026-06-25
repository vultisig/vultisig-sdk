import { Chain } from '@vultisig/core-chain/Chain'
import { setCustomRpcOverride } from '@vultisig/core-chain/chains/customRpc/customRpcOverrides'
import { isCustomRpcSupported } from '@vultisig/core-chain/chains/customRpc/customRpcSupportedChains'
import { probeRpcHealth, type RpcHealthResult } from '@vultisig/core-chain/chains/customRpc/rpcHealthProbe'

/**
 * CLI wiring for per-chain custom RPC overrides.
 *
 * The override engine (`setCustomRpcOverride`) already lives in core-chain and
 * is honored by the EVM / Cosmos URL resolvers. The only gap was a way for a
 * headless CLI operator to set those overrides; this module resolves them from
 * `--rpc-override <chain>:<url>` flags and `VULTISIG_<CHAIN>_RPC` env vars and
 * applies them at SDK init.
 *
 * Coverage tracks what the resolvers actually read: EVM chains route every op
 * (balance, gas/nonce, broadcast, tx-status) through `getEvmRpcUrl`. Cosmos
 * chains honor the override on the LCD/REST paths (`getCosmosRpcUrl`: fee,
 * account info, LCD balance fallback, wasm queries); the Tendermint-RPC client
 * used for Cosmos broadcast / tx-status keeps its default endpoint by design (a
 * custom RPC is treated as an LCD endpoint — a different protocol).
 *
 * Only EVM and IBC-enabled Cosmos chains accept an override (per
 * `isCustomRpcSupported`); THORChain / MayaChain / UTXO / QBTC are excluded by
 * construction and any override targeting them is ignored with a warning. The
 * Rujira / THORChain `--rpc` subcommand flag is a separate, command-scoped
 * endpoint override and is unaffected by this module.
 */

const ENV_PREFIX = 'VULTISIG_'
const ENV_SUFFIX = '_RPC'

/**
 * Lowercased aliases for the common EVM chains an operator is likely to type.
 * Mirrors the alias set used by the agent's `resolveChain`, scoped to the
 * override-eligible chains. Exact (case-insensitive) `Chain` enum names always
 * win first, so this only needs the short forms.
 */
const CHAIN_ALIASES: Record<string, Chain> = {
  eth: Chain.Ethereum,
  bnb: Chain.BSC,
  bsc: Chain.BSC,
  avax: Chain.Avalanche,
  matic: Chain.Polygon,
  poly: Chain.Polygon,
  arb: Chain.Arbitrum,
  op: Chain.Optimism,
  atom: Chain.Cosmos,
}

/** A single resolved + validated override ready to apply. */
export type RpcOverride = { chain: Chain; url: string }

export type RpcOverrideResolution = {
  /** Overrides that resolved to a supported chain, de-duped (flag beats env). */
  applied: RpcOverride[]
  /** Human-readable reasons individual specs were ignored. */
  warnings: string[]
}

/** Result of applying an override, including an optional liveness probe. */
export type AppliedRpcOverride = RpcOverride & { health?: RpcHealthResult }

/** Strip `_` / `-` so multi-word chains resolve from env var spelling. */
const stripSeparators = (value: string): string => value.replace(/[_-]/g, '')

/**
 * Resolve a user-supplied chain token (enum name or short alias) to a `Chain`.
 * Separators are ignored on both sides so an env spelling like `CRONOS_CHAIN`
 * (from `VULTISIG_CRONOS_CHAIN_RPC`) or `TERRA_CLASSIC` resolves to the
 * separator-free enum value (`CronosChain`, `TerraClassic`).
 */
function resolveChainToken(token: string): Chain | undefined {
  const lower = token.trim().toLowerCase()
  if (!lower) return undefined
  const normalized = stripSeparators(lower)
  for (const value of Object.values(Chain)) {
    if (typeof value === 'string' && stripSeparators(value.toLowerCase()) === normalized) {
      return value as Chain
    }
  }
  return CHAIN_ALIASES[lower] ?? CHAIN_ALIASES[normalized]
}

/**
 * Parse a `--rpc-override` spec of the form `<chain>:<url>`. Splits on the
 * FIRST colon only, so the `https://` in the URL is preserved. Returns
 * `undefined` for a malformed spec (missing chain or url).
 */
export function parseRpcOverrideSpec(spec: string): { chain: string; url: string } | undefined {
  const idx = spec.indexOf(':')
  if (idx <= 0) return undefined
  const chain = spec.slice(0, idx).trim()
  const url = spec.slice(idx + 1).trim()
  if (!chain || !url) return undefined
  return { chain, url }
}

/**
 * Read `--rpc-override <spec>` (repeatable) and `--rpc-check` straight from
 * argv. Interactive mode builds its SDK before Commander parses the program,
 * so it can't read `program.opts()` — it mirrors `server-endpoints`' argv
 * parsing the same way.
 */
export function parseRpcOverrideArgsFromArgv(args: string[]): { specs: string[]; check: boolean } {
  const specs: string[] = []
  let check = false
  const flag = '--rpc-override'
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--rpc-check') {
      check = true
    } else if (arg === flag) {
      const next = args[i + 1]
      if (next && !next.startsWith('-')) {
        specs.push(next)
        i += 1
      }
    } else if (arg.startsWith(`${flag}=`)) {
      const value = arg.slice(flag.length + 1)
      if (value) specs.push(value)
    }
  }
  return { specs, check }
}

/** Collect `VULTISIG_<CHAIN>_RPC` pairs from an environment map. */
function collectEnvSpecs(env: NodeJS.ProcessEnv): { chain: string; url: string; envKey: string }[] {
  const out: { chain: string; url: string; envKey: string }[] = []
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith(ENV_PREFIX) || !key.endsWith(ENV_SUFFIX)) continue
    const chain = key.slice(ENV_PREFIX.length, key.length - ENV_SUFFIX.length)
    const url = value?.trim()
    if (!chain || !url) continue
    out.push({ chain, url, envKey: key })
  }
  return out
}

/**
 * Resolve overrides from CLI specs and environment variables. Env is ingested
 * first and CLI flags second, so a `--rpc-override` flag overrides the env var
 * for the same chain. Unknown / unsupported / malformed specs are dropped with
 * a warning rather than throwing, so a stray override never aborts a command.
 */
export function resolveRpcOverrides(args: { specs?: string[]; env?: NodeJS.ProcessEnv } = {}): RpcOverrideResolution {
  const env = args.env ?? process.env
  const warnings: string[] = []
  const byChain = new Map<Chain, string>()

  const ingest = (rawChain: string, url: string, source: string): void => {
    const chain = resolveChainToken(rawChain)
    if (!chain) {
      warnings.push(`Ignoring ${source}: unknown chain "${rawChain}"`)
      return
    }
    if (!isCustomRpcSupported(chain)) {
      warnings.push(
        `Ignoring ${source}: custom RPC overrides are only supported for EVM and IBC Cosmos chains (got ${chain})`
      )
      return
    }
    byChain.set(chain, url)
  }

  for (const { chain, url, envKey } of collectEnvSpecs(env)) {
    ingest(chain, url, envKey)
  }
  for (const spec of args.specs ?? []) {
    const parsed = parseRpcOverrideSpec(spec)
    if (!parsed) {
      warnings.push(`Ignoring malformed --rpc-override "${spec}" (expected <chain>:<url>)`)
      continue
    }
    ingest(parsed.chain, parsed.url, `--rpc-override ${spec}`)
  }

  const applied = [...byChain.entries()].map(([chain, url]) => ({ chain, url }))
  return { applied, warnings }
}

/**
 * Apply resolved overrides into the in-memory override mirror. When `probe` is
 * set, each endpoint is checked for liveness / chain identity and the result is
 * attached so the caller can warn on an unreachable or wrong-chain endpoint.
 * Probing never blocks application — the override is set regardless.
 */
export async function applyRpcOverrides(
  resolution: RpcOverrideResolution,
  opts: { probe?: boolean } = {}
): Promise<AppliedRpcOverride[]> {
  const results: AppliedRpcOverride[] = []
  for (const { chain, url } of resolution.applied) {
    setCustomRpcOverride(chain, url)
    const health = opts.probe ? await probeRpcHealth({ chain, url }) : undefined
    results.push(health ? { chain, url, health } : { chain, url })
  }
  return results
}
