---
"@vultisig/sdk": minor
---

feat(address): `deriveAddressFromKeys` accepts optional `chainPublicKeys` map

Callers holding pre-derived hardened per-chain pubkeys (e.g. from KeyImport vaults or the agent-backend's `VaultInfo.ChainPublicKeys`) can now pass them through directly, bypassing the non-hardened BIP32 fallback path that produces a different address. Bidirectional Terra ↔ TerraClassic alias is built-in (both share coin_type 330). Existing callers passing no `chainPublicKeys` are unaffected — the non-hardened path remains the default.

Unlocks the Luna boundary fix (mcp-ts get_address + agent-backend VaultInfo + vultiagent-app agentContext) so the agent chat path resolves the same Terra/TerraClassic address the in-process wallet derives.
