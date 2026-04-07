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
  to: '0x742d35Cc6634C0532925a3b844Bc9e7595f42bE',
  amount: '0.01',
})
console.log(`TX: ${result.txHash}`)
```

## Available Actions

When using `agent ask` or `--via-agent`, the agent backend can execute these actions locally on the CLI:

| Action | Description |
|--------|-------------|
| `get_balances` | Fetch balances for all chains |
| `get_portfolio` | Multi-chain portfolio with fiat values |
| `get_market_price` | Token price lookup (backend-side) |
| `search_token` | Search token registry |
| `build_send_tx` | Build a send transaction |
| `build_swap_tx` | Build a swap transaction |
| `build_custom_tx` | Build a custom contract call |
| `sign_tx` | Sign and broadcast (auto-triggered after build) |
| `sign_typed_data` | EIP-712 typed data signing |
| `read_evm_contract` | Read EVM contract state |
| `scan_tx` | Security scan via Blockaid |
| `add_chain` / `remove_chain` | Enable/disable chains |
| `add_coin` / `remove_coin` | Add/remove tokens |
| `address_book_add` / `address_book_remove` | Manage saved addresses |
| `get_address_book` | List saved addresses |
| `build_tx` | Build a generic transaction |
| `list_vaults` | List available vaults |
| `thorchain_query` | Query THORChain state (backend-side) |

## Key Resources

| File | Purpose |
|------|---------|
| [CLI README](clients/cli/README.md) | Full CLI documentation |
| [SDK README](packages/sdk/README.md) | SDK API reference and examples |
| [SDK Users Guide](docs/SDK-USERS-GUIDE.md) | In-depth SDK tutorial |
| [Architecture](docs/architecture/ARCHITECTURE.md) | Design patterns and internals |
| [CLAUDE.md](CLAUDE.md) | Contributor guide for AI coding agents |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Setup, workflow, PR process |
