---
"@vultisig/sdk": minor
---

feat(tokens): add vault-free `Vultisig.discoverTokens({ chain, address })`

On-chain token discovery (1inch for EVM, Jupiter for Solana, LCD for
Cosmos) was only reachable as the instance method
`vault.discoverTokens(chain)`. Callers that hold a derived address but
no SDK `Vault` — the agent, a portfolio/dashboard screen, the
agent-backend — couldn't use it without constructing a full vault.

Adds a static, vault-free `Vultisig.discoverTokens({ chain, address })`
returning `DiscoveredToken[]`. It is a thin wrapper over the
already-vault-free `findCoins({ address, chain })` from
`@vultisig/core-chain/coin/find` — the exact same call + mapping
`vault.discoverTokens()` already does internally, minus the
`getAddress` step. No new discovery logic, no behavioural change to the
instance method, zero regression surface.

Lets vultiagent-app discover the long tail of held tokens (beyond
native + manually-added) on its existing vault-free balance path so the
dashboard + agent see the same token set as a wallet would.
