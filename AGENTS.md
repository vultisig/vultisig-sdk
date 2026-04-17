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

## Key Resources

| File | Purpose |
|------|---------|
| [CLI README](clients/cli/README.md) | Full CLI documentation |
| [SDK README](packages/sdk/README.md) | SDK API reference and examples |
| [SDK Users Guide](docs/SDK-USERS-GUIDE.md) | In-depth SDK tutorial |
| [Architecture](docs/architecture/ARCHITECTURE.md) | Design patterns and internals |
| [CLAUDE.md](CLAUDE.md) | Contributor guide for AI coding agents |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Setup, workflow, PR process |
