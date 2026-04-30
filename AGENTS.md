# Vultisig for AI Agents

Three ways to integrate Vultisig into an AI agent, depending on your architecture:

| Interface | Best for | Docs |
|-----------|----------|------|
| **CLI `agent ask`** | AI coding agents (Claude Code, Cursor, Opencode) that run shell commands | [CLI README — Agent Ask](clients/cli/README.md#agent-ask-one-shot-mode) |
| **CLI `--via-agent`** | Agent orchestrators that need a long-running NDJSON pipe | [CLI README — Pipe Protocol](clients/cli/README.md#pipe-protocol---via-agent) |
| **SDK (programmatic)** | Direct TypeScript integration — full control over vault lifecycle | [SDK README](packages/sdk/README.md) |

## Quick Examples

### CLI: One-shot query

```bash
vultisig agent ask "What is my ETH balance?" --password "$VAULT_PASSWORD" --json
```

### CLI: Pipe mode

```bash
echo '{"type":"message","content":"Send 0.01 ETH to 0x742d..."}' \
  | vultisig agent --via-agent --password "$VAULT_PASSWORD"
```

### SDK: Programmatic send

```typescript
import { Vultisig } from '@vultisig/sdk'

const sdk = new Vultisig()
await sdk.initialize()

const vault = await sdk.getVaultById(vaultId)
if (!vault) throw new Error('Vault not found')

if (vault.isEncrypted) await vault.unlock(password)

const result = await vault.send({
  chain: 'Ethereum',
  to: '0x742d35Cc6634C0532925a3b844Bc9e7595f42bEc',
  amount: '0.01',
})
console.log(`TX: ${result.txHash}`)
```

## Available Actions

When using `agent ask` or `--via-agent`, the agent backend proposes actions; the CLI **executor** runs the ones implemented in `clients/cli/src/agent/executor.ts`. Actions with no local implementation return a structured failure (`success: false`) and may still be handled by the backend in other modes.

| Action | Description | Runs where |
|--------|-------------|------------|
| `get_balances` | Fetch balances for all chains | local |
| `get_portfolio` | Multi-chain portfolio with fiat values | local |
| `get_market_price` | Token price lookup | backend |
| `search_token` | Search known token registry (SDK) | local |
| `build_send_tx` | Build a send transaction | local |
| `build_swap_tx` | Build a swap transaction | local |
| `build_custom_tx` | Build a custom contract call | local |
| `sign_tx` | Sign and broadcast (auto-triggered after build); may sign a server-built payload after `tx_ready` | both |
| `sign_typed_data` | EIP-712 typed data signing | local |
| `read_evm_contract` | Read EVM contract state | local |
| `scan_tx` | Security scan via Blockaid | backend |
| `add_chain` / `remove_chain` | Enable/disable chains | local |
| `add_coin` / `remove_coin` | Add/remove tokens | local |
| `address_book_add` / `address_book_remove` | Manage saved addresses | backend |
| `get_address_book` | List saved addresses (requires CLI `AgentConfig.vultisig`) | local |
| `build_tx` | Build a generic transaction | local |
| `list_vaults` | List available vaults | local |
| `thorchain_query` | Query THORChain state | backend |
| `thorchain_pool_info` | THORChain pool stats from Midgard (no signing) | local |
| `thorchain_add_liquidity` | Build RUNE-side LP add (`prepareSendTx` + `sign_tx`) | local |
| `thorchain_remove_liquidity` | Build LP withdraw memo + dust RUNE send (`prepareSendTx` + `sign_tx`) | local |

## Key Resources

| File | Purpose |
|------|---------|
| [CLI README](clients/cli/README.md) | Full CLI documentation |
| [SDK README](packages/sdk/README.md) | SDK API reference and examples |
| [SDK Users Guide](docs/SDK-USERS-GUIDE.md) | In-depth SDK tutorial |
| [Architecture](docs/architecture/ARCHITECTURE.md) | Design patterns and internals |
| [CLAUDE.md](CLAUDE.md) | Contributor guide for AI coding agents |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Setup, workflow, PR process |

## Receipts expected on PRs

Every vultisig-sdk PR MUST land with layered receipts proportional to what the diff touches. The SDK is upstream of every consumer (mcp-ts, vultiagent-app, vultisig-ios, vultisig-windows), so SDK-internal unit tests are NOT sufficient - they don't catch contract drift between repos.

### Layered receipts

1. **Static (mandatory always)**: `yarn build` clean, lint clean, unit tests pass across all workspaces.
2. **Repo-internal CLI runtime (mandatory for any user-visible change)**: build the SDK + the bundled CLI client (`clients/cli/`), run it against a real or mock backend, exercise the changed code path. Example:
   ```bash
   cd packages/sdk && yarn build
   cd ../../clients/cli && yarn build
   node dist/index.js agent ask "<test prompt>" --json
   ```
   Capture stdout, paste relevant excerpt into the PR body.
3. **Cross-repo (mandatory for any change consumed by mcp-ts or vultiagent-app)**: build a tarball, file:// pin (or `npm link`) into the consumer, exercise the consumer's flow end-to-end. Capture either a curl receipt (mcp-ts) or a screenshot (vultiagent-app).
4. **Math / encoding (mandatory for any signing / address / calldata change)**: regression test + comparison vs a known-good on-chain vector (etherscan / blockchair URL).

### Why CLI testing > SDK unit tests

The CLI in `clients/cli/` exercises the actual public-API surface contract. Internal `packages/sdk/` unit tests can pass while the public API silently breaks (typing drift, default param change, dropped re-export). Always run the CLI as the source-of-truth integration test.

### Receipt shape per finding class

| Finding class | Required receipt |
|---|---|
| Fund-safety / amount / chain-id | full-form comparison vs on-chain lookup |
| Public-API shape change | CLI invocation + stdout excerpt + version-bump entry in CHANGELOG |
| Cross-repo consumer break | file:// pin + downstream exercise (curl mcp-ts or app screenshot) |
| Signing / encoding / address derivation | regression test pinning a known-good vector |

### CR comments are receipts too

Before any merge, scan **both** the inline-review-comments endpoint AND the issue-conversation endpoint — CodeRabbit posts findings to both:

```bash
# Line-anchored review comments (most CR findings live here)
gh api /repos/vultisig/vultisig-sdk/pulls/<n>/comments --paginate \
  | jq '[.[] | select(.user.login == "coderabbitai[bot]")]'

# Conversation-thread comments (CR's top-level summaries + some Major flags land here)
gh api /repos/vultisig/vultisig-sdk/issues/<n>/comments --paginate \
  | jq '[.[] | select(.user.login == "coderabbitai[bot]")]'
```

Every CR finding from either endpoint gets a fix-commit or in-thread reply. NO merge with open CR threads.
