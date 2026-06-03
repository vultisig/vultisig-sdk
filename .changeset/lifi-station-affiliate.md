---
'@vultisig/core-chain': minor
'@vultisig/sdk': minor
---

feat(swap/lifi): consumer-supplied LI.FI integrator + apiUrl override

Adds `SwapAffiliateConfig.lifi: LifiAffiliateConfig` so consumers (e.g. Station via `vultisig/mcp-ts`) can redirect LI.FI affiliate fees to their own portal integrator instead of the SDK-default `vultisig-0`.

New surface:
- `LifiAffiliateConfig` type — `{ integratorName: string; apiUrl?: string }`
- `setupLifi(config?)` — global LI.FI SDK bootstrap; idempotent first-caller-wins. Consumers call this once at module boot to set both the global `integrator` and (optional) `apiUrl` proxy.
- `getLifiSwapQuote` now accepts an optional `lifiAffiliateConfig` and uses its `integratorName` as the per-call `integrator` in `getQuote(...)`, overriding the global default for THIS quote without mutating the module-level `lifiConfig`.
- `findSwapQuote` threads `affiliateConfig?.lifi` into `getLifiSwapQuote`.

No behaviour change for callers that don't supply a `lifi` config — `getLifiSwapQuote` still routes through the existing `vultisig-0` default.
