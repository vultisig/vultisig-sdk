# Supported Chains Reference

Vultisig supports 36+ blockchains across multiple ecosystems.

## EVM Chains (13)

Ethereum-compatible chains using ECDSA signatures.

| Chain | CLI Name | Native Token | Decimals |
|-------|----------|--------------|----------|
| Ethereum | `ethereum` | ETH | 18 |
| Polygon | `polygon` | MATIC | 18 |
| BNB Smart Chain | `bsc` | BNB | 18 |
| Arbitrum | `arbitrum` | ETH | 18 |
| Optimism | `optimism` | ETH | 18 |
| Base | `base` | ETH | 18 |
| Avalanche C-Chain | `avalanche` | AVAX | 18 |
| Blast | `blast` | ETH | 18 |
| Cronos | `cronoschain` | CRO | 18 |
| zkSync Era | `zksync` | ETH | 18 |
| Hyperliquid | `hyperliquid` | HYPE | 18 |
| Mantle | `mantle` | MNT | 18 |
| Sei | `sei` | SEI | 18 |

**EVM chains support:**
- Native token transfers
- ERC-20 token transfers
- Smart contract interactions
- DEX swaps via 1inch aggregator

## UTXO Chains (6)

Bitcoin-like chains using UTXO model.

| Chain | CLI Name | Native Token | Decimals |
|-------|----------|--------------|----------|
| Bitcoin | `bitcoin` | BTC | 8 |
| Litecoin | `litecoin` | LTC | 8 |
| Dogecoin | `dogecoin` | DOGE | 8 |
| Bitcoin Cash | `bitcoincash` | BCH | 8 |
| Dash | `dash` | DASH | 8 |
| Zcash | `zcash` | ZEC | 8 |

**UTXO chains support:**
- Native transfers
- Cross-chain swaps via THORChain

## Cosmos Chains (10)

Cosmos SDK chains using Tendermint consensus.

| Chain | CLI Name | Native Token | Decimals |
|-------|----------|--------------|----------|
| Cosmos Hub | `cosmos` | ATOM | 6 |
| THORChain | `thorchain` | RUNE | 8 |
| MayaChain | `mayachain` | CACAO | 10 |
| Osmosis | `osmosis` | OSMO | 6 |
| dYdX | `dydx` | DYDX | 18 |
| Kujira | `kujira` | KUJI | 6 |
| Terra | `terra` | LUNA | 6 |
| Terra Classic | `terraclassic` | LUNC | 6 |
| Noble | `noble` | USDC | 6 |
| Akash | `akash` | AKT | 6 |

**Cosmos chains support:**
- Native transfers
- IBC transfers (where applicable)
- Staking operations
- Governance voting

## Other Chains (7)

Chains with unique architectures.

| Chain | CLI Name | Native Token | Decimals | Signature |
|-------|----------|--------------|----------|-----------|
| Solana | `solana` | SOL | 9 | EdDSA |
| Sui | `sui` | SUI | 9 | EdDSA |
| Polkadot | `polkadot` | DOT | 10 | ECDSA |
| TON | `ton` | TON | 9 | EdDSA |
| Ripple (XRP) | `ripple` | XRP | 6 | ECDSA |
| Tron | `tron` | TRX | 6 | ECDSA |
| Cardano | `cardano` | ADA | 6 | EdDSA |

## Chain Name Matching

The CLI accepts case-insensitive chain names:

```bash
# All equivalent
vultisig balance Bitcoin
vultisig balance bitcoin
vultisig balance BITCOIN
```

## Default Chains

New vaults start with these chains enabled:
- Bitcoin
- Ethereum
- THORChain
- Solana
- BSC

Enable all chains:
```bash
vultisig chains --add-all
```

## Swap Support by Chain

Cross-chain swaps are supported via THORChain/MayaChain for:

| From/To | BTC | ETH | SOL | ATOM | RUNE |
|---------|-----|-----|-----|------|------|
| BTC | - | Yes | Yes | Yes | Yes |
| ETH | Yes | - | Yes | Yes | Yes |
| SOL | Yes | Yes | - | Yes | Yes |
| ATOM | Yes | Yes | Yes | - | Yes |
| RUNE | Yes | Yes | Yes | Yes | - |

Same-chain EVM swaps supported via 1inch on:
- Ethereum, Polygon, BSC, Arbitrum, Optimism, Base, Avalanche

Check supported swap routes:
```bash
vultisig swap-chains
```
