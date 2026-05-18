---
"@vultisig/cli": patch
---

agent: forward vault `chain_public_keys` in the chat request context

The CLI agent client now sends the vault's per-chain hardened-derived public
keys (`vault.data.chainPublicKeys`) to agent-backend, nested in the message
`context` as `chain_public_keys`. This matches agent-backend's
`MessageContext.ChainPublicKeys` contract and closes the last parity gap with
vultiagent-app: hardened-derivation chains (Solana, Sui, Polkadot, Terra) now
get the correct address via the CLI agent path instead of the fallback BIP32
derivation. Standard MPC vaults omit the field entirely (no empty `{}`).
