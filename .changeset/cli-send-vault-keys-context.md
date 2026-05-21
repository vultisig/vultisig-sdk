---
"@vultisig/cli": patch
---

agent: send ecdsa/eddsa/chain_code in MessageContext so MCP receives vault info

The CLI's `MessageContext` was missing `ecdsa_public_key`, `eddsa_public_key`,
and `hex_chain_code` — fields vultiagent-app's `agentContext.ts` has always
sent. agent-backend reads these via `extractVaultInfoFromContext` to build
`req.VaultInfo`, which is then injected into MCP tool calls flagged with
`_meta.inject_vault_args: true`. Without them, every such tool errors with
"Vault not configured" at the MCP layer — currently observable for the
unified `show_receive_request` (vultisig/mcp#179, vultisig/agent-backend#554),
but the same gap will break any future `inject_vault_args` tool dispatched
through the CLI. `buildMessageContext` and `buildMinimalContext` now populate
the three fields from `vault.publicKeys.{ecdsa,eddsa}` + `vault.hexChainCode`.

Also picks up Ehsan's review nit on #500: removes the stray `/**` opener on
`client.ts:43` (the line above `isErrorPayloadObject`'s docblock).
