# Vultisig Claude Code Plugin

Manage your Vultisig MPC wallet directly from Claude Code — check balances, send tokens, swap across 40+ chains, and sign transactions.

## Installation

### From self-hosted marketplace

```bash
/plugin marketplace add https://raw.githubusercontent.com/vultisig/vultisig-sdk/main/clients/plugin/marketplace.json
/plugin install vultisig
```

### From local monorepo path

```bash
/plugin install --path clients/plugin
```

## Prerequisites

The plugin requires the Vultisig CLI (`vsig`) to be installed locally:

```bash
npm install -g @vultisig/cli
```

Use the `/vultisig:setup` skill for guided onboarding.

## Skills

| Skill | Description |
|-------|-------------|
| `/vultisig:setup` | Install vsig CLI and create your first vault |
| `/vultisig:vaults` | List all configured vaults |
| `/vultisig:vault-info` | Show detailed info for a vault |
| `/vultisig:balance` | Check token balances |
| `/vultisig:addresses` | Show wallet addresses per chain |
| `/vultisig:portfolio` | Portfolio overview with fiat values |
| `/vultisig:chains` | List supported blockchains |
| `/vultisig:tokens` | List tokens for a chain |
| `/vultisig:swap-quote` | Get a swap quote |
| `/vultisig:swap` | Execute a cross-chain swap |
| `/vultisig:send` | Send tokens to an address |
| `/vultisig:sign` | Sign arbitrary bytes |
| `/vultisig:broadcast` | Broadcast a signed transaction |

## Security

All operations are local. The plugin instructs Claude to invoke the `vsig` binary on your machine — no remote API calls are made by the plugin itself. Sensitive values like vault passwords should be passed via environment variables (e.g. `VAULT_PASSWORD`) rather than command-line arguments.
