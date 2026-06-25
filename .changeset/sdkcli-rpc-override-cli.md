---
'@vultisig/cli': patch
---

Add per-chain custom RPC override to the CLI. A headless operator can now point
the SDK's EVM / Cosmos chain ops (balance, quote, broadcast, tx-status) at a
private node via the repeatable `--rpc-override <chain>:<url>` flag or a
`VULTISIG_<CHAIN>_RPC` env var (e.g. `VULTISIG_ETHEREUM_RPC`). Overrides are
applied at SDK init through core-chain's existing `setCustomRpcOverride` engine;
only EVM and IBC Cosmos chains are eligible and unsupported/unknown/malformed
specs are ignored with a stderr warning. An optional `--rpc-check` flag probes
each endpoint for liveness/chain identity at startup.
