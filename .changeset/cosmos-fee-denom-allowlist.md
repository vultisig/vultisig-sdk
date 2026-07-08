---
"@vultisig/sdk": patch
---

Add cosmos per-chain fee-denom allowlist helpers (`getCosmosAllowedFeeDenoms`, `isCosmosFeeDenomAllowed`) as the single source of truth for which denoms a cosmos chain's ante handler accepts as a gas fee, consolidating copies previously maintained independently in agent-backend-ts (execute_send.ts, astroport-classic-swap.ts, cosmos-staking.ts).
