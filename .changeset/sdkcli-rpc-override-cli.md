---
'@vultisig/cli': patch
---

Add per-chain custom RPC override to the CLI. A headless operator can now point
chain RPC at a private node via the repeatable `--rpc-override <chain>:<url>`
flag or a `VULTISIG_<CHAIN>_RPC` env var (e.g. `VULTISIG_ETHEREUM_RPC`).
Overrides are applied at SDK init through core-chain's existing
`setCustomRpcOverride` engine, in both command and interactive (`-i`) modes.

Coverage matches what the core-chain resolvers honor: **EVM** chains route every
op (balance, gas/nonce, broadcast, tx-status) through the override via
`getEvmRpcUrl`. **Cosmos** chains honor the override on the LCD/REST paths
(`getCosmosRpcUrl`: fee/min-gas, account info, LCD balance fallback, wasm smart
queries); the Tendermint-RPC client used for broadcast and tx-status keeps its
default endpoint by design (a custom RPC is treated as an LCD endpoint — a
different protocol).

Only EVM and IBC Cosmos chains are eligible; unsupported/unknown/malformed specs
are ignored with a stderr warning. Multi-word chains resolve from their env
spelling (`VULTISIG_CRONOS_CHAIN_RPC` → CronosChain). An optional `--rpc-check`
flag probes each endpoint at startup and aborts on a confirmed wrong-chain
identity mismatch.
