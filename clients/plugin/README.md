# Vultisig Claude Code Plugin

Manage your Vultisig MPC wallet directly from Claude Code — check balances, send tokens, swap across 40+ chains, and sign transactions.

## Installation

### From self-hosted marketplace

```bash
/plugin marketplace add https://github.com/vultisig/vultisig-sdk
/plugin install vultisig
```

### From local path (manual install)

The `/plugin install` command only supports marketplace installs. To test locally, copy the plugin into Claude's cache and register it manually:

```bash
# Copy plugin files into Claude's plugin cache
mkdir -p ~/.claude/plugins/cache/local/vultisig/dev
cp -r clients/plugin/.claude-plugin ~/.claude/plugins/cache/local/vultisig/dev/
```

Then add the entry to `~/.claude/plugins/installed_plugins.json` under `"plugins"`:

```json
"vultisig@local": [
  {
    "scope": "user",
    "installPath": "/Users/<you>/.claude/plugins/cache/local/vultisig/dev",
    "version": "dev",
    "installedAt": "2024-01-01T00:00:00.000Z",
    "lastUpdated": "2024-01-01T00:00:00.000Z",
    "gitCommitSha": "local"
  }
]
```

And enable it in `~/.claude/settings.json`:

```json
{
  "enabledPlugins": {
    "vultisig@local": true
  }
}
```

## Prerequisites

The plugin requires the Vultisig CLI (`vultisig`) to be installed locally:

```bash
npm install -g @vultisig/cli
```

Use the `/vultisig:setup` skill for guided onboarding.

## Skills

| Skill | Description |
|-------|-------------|
| `/vultisig:setup` | Install vultisig CLI and create your first vault |
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

The plugin instructs Claude to invoke the `vultisig` binary on your machine — no remote API calls are made by the plugin itself. However, the `vultisig` binary may contact external services (RPC nodes, indexers, quote providers) for balance checks, swaps, and broadcasts. Sensitive values like vault passwords should be passed via environment variables (e.g. `VAULT_PASSWORD`) rather than command-line arguments.
