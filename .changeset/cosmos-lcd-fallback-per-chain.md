---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

`getCosmosAccountInfo` now retries against a registered fallback LCD when the primary endpoint fails. Without this, a single-provider degradation (e.g. `terra-classic-lcd.publicnode.com` outage on 2026-05-28) hard-failed every cosmos signing surface that touches this code path — there was no recovery.

Fallback URLs per chain (Polkachu mirrors where available; Hexxagon for `TerraClassic` since polkachu has no Terra Classic endpoint, verified 2026-05-28). Chains not in the map preserve fail-closed behaviour.

Parallel to vultiagent-app#1017 (app-side fix) + mcp-ts#266 (mcp-side fix).
