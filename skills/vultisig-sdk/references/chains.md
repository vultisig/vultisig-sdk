# Supported Chains Reference

Vultisig SDK supports 36+ blockchains across multiple ecosystems.

## Chain Enum

```typescript
import { Chain } from '@vultisig/sdk'
```

## EVM Chains (13)

Ethereum-compatible chains using ECDSA signatures.

| Chain | Enum Value | Native Token | Decimals |
|-------|------------|--------------|----------|
| Ethereum | `Chain.Ethereum` | ETH | 18 |
| Polygon | `Chain.Polygon` | MATIC | 18 |
| BNB Smart Chain | `Chain.BSC` | BNB | 18 |
| Arbitrum | `Chain.Arbitrum` | ETH | 18 |
| Optimism | `Chain.Optimism` | ETH | 18 |
| Base | `Chain.Base` | ETH | 18 |
| Avalanche C-Chain | `Chain.Avalanche` | AVAX | 18 |
| Blast | `Chain.Blast` | ETH | 18 |
| Cronos | `Chain.CronosChain` | CRO | 18 |
| zkSync Era | `Chain.ZkSync` | ETH | 18 |
| Hyperliquid | `Chain.Hyperliquid` | HYPE | 18 |
| Mantle | `Chain.Mantle` | MNT | 18 |
| Sei | `Chain.Sei` | SEI | 18 |

**EVM chains support:**
- Native token transfers
- ERC-20 token transfers
- Smart contract interactions
- DEX swaps via 1inch aggregator

## UTXO Chains (6)

Bitcoin-like chains using UTXO model.

| Chain | Enum Value | Native Token | Decimals |
|-------|------------|--------------|----------|
| Bitcoin | `Chain.Bitcoin` | BTC | 8 |
| Litecoin | `Chain.Litecoin` | LTC | 8 |
| Dogecoin | `Chain.Dogecoin` | DOGE | 8 |
| Bitcoin Cash | `Chain.BitcoinCash` | BCH | 8 |
| Dash | `Chain.Dash` | DASH | 8 |
| Zcash | `Chain.Zcash` | ZEC | 8 |

**UTXO chains support:**
- Native transfers
- Cross-chain swaps via THORChain

## Cosmos Chains (10)

Cosmos SDK chains using Tendermint consensus.

| Chain | Enum Value | Native Token | Decimals |
|-------|------------|--------------|----------|
| Cosmos Hub | `Chain.Cosmos` | ATOM | 6 |
| THORChain | `Chain.THORChain` | RUNE | 8 |
| MayaChain | `Chain.MayaChain` | CACAO | 10 |
| Osmosis | `Chain.Osmosis` | OSMO | 6 |
| dYdX | `Chain.Dydx` | DYDX | 18 |
| Kujira | `Chain.Kujira` | KUJI | 6 |
| Terra | `Chain.Terra` | LUNA | 6 |
| Terra Classic | `Chain.TerraClassic` | LUNC | 6 |
| Noble | `Chain.Noble` | USDC | 6 |
| Akash | `Chain.Akash` | AKT | 6 |

**Cosmos chains support:**
- Native transfers
- IBC transfers
- SignAmino and SignDirect signing

## Other Chains (7)

Chains with unique architectures.

| Chain | Enum Value | Native Token | Decimals | Signature |
|-------|------------|--------------|----------|-----------|
| Solana | `Chain.Solana` | SOL | 9 | EdDSA |
| Sui | `Chain.Sui` | SUI | 9 | EdDSA |
| Polkadot | `Chain.Polkadot` | DOT | 10 | ECDSA |
| TON | `Chain.Ton` | TON | 9 | EdDSA |
| Ripple (XRP) | `Chain.Ripple` | XRP | 6 | ECDSA |
| Tron | `Chain.Tron` | TRX | 6 | ECDSA |
| Cardano | `Chain.Cardano` | ADA | 6 | EdDSA |

## Usage Examples

### Get Address for Chain

```typescript
const btcAddress = await vault.address(Chain.Bitcoin)
const ethAddress = await vault.address(Chain.Ethereum)
```

### Get Multiple Addresses

```typescript
const addresses = await vault.addresses([
  Chain.Bitcoin,
  Chain.Ethereum,
  Chain.Solana
])
// { Bitcoin: "bc1q...", Ethereum: "0x...", Solana: "9Wz..." }
```

### Check Balance

```typescript
const balance = await vault.balance(Chain.Ethereum)
console.log(`${balance.amount} ${balance.symbol}`)
```

### Add Chain to Vault

```typescript
await vault.addChain(Chain.Solana)
await vault.addChain(Chain.Polygon)
```

### Check Swap Support

```typescript
const canSwap = vault.isSwapSupported(Chain.Ethereum, Chain.Bitcoin)
// true - supported via THORChain
```

## Default Chains

New vaults start with these chains enabled:
- Bitcoin
- Ethereum
- THORChain
- Solana
- BSC

## Signature Types by Chain

| Signature Type | Chains |
|----------------|--------|
| ECDSA (secp256k1) | All EVM, UTXO, Cosmos, Polkadot, Ripple, Tron |
| EdDSA (Ed25519) | Solana, Sui, TON, Cardano |

The SDK automatically uses the correct signature algorithm based on the chain.
