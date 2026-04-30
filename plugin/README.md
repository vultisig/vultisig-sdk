# Vultisig Claude Code Plugin

Manage your Vultisig MPC wallet directly from Claude Code — check balances, send tokens, swap across 40+ chains, and sign transactions.

## Installation

### From self-hosted marketplace

```bash
/plugin marketplace add https://github.com/vultisig/vultisig-sdk
/plugin install vultisig
```

### From local path (manual install)

Launch Claude Code with the `--plugin-dir` flag pointing to the plugin folder:

```bash
claude --plugin-dir ./plugin
```

That's it — no copying files or editing JSON configs needed.

## Prerequisites

The plugin requires the Vultisig CLI (`vultisig`) to be installed locally:

```bash
npm install -g @vultisig/cli
```

## Supported Chains (36+)

### EVM Chains (13)
Ethereum, Polygon, BSC, Arbitrum, Optimism, Base, Avalanche, Blast, Cronos, zkSync, Hyperliquid, Mantle, Sei

### UTXO Chains (6)
Bitcoin, Litecoin, Dogecoin, Bitcoin Cash, Dash, Zcash

### Cosmos Chains (10)
Cosmos, THORChain, MayaChain, Osmosis, dYdX, Kujira, Terra, Terra Classic, Noble, Akash

### Other Chains (7)
Solana, Sui, Polkadot, TON, Ripple, Tron, Cardano

## Security

The plugin instructs Claude to invoke the `vultisig` binary on your machine — no remote API calls are made by the plugin itself. However, the `vultisig` binary may contact external services (RPC nodes, indexers, quote providers) for balance checks, swaps, and broadcasts. Sensitive values like vault passwords should be passed via environment variables (e.g. `VAULT_PASSWORD`) rather than command-line arguments.
