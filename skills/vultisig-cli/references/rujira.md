# Rujira / THORChain Secured Assets Guide

## What Are Secured Assets?

Secured assets are Layer-1 (L1) assets — BTC, ETH, USDC, etc. — deposited onto THORChain. They are:

- **Backed 1:1** by real assets held in THORChain vaults on the native chain
- **Tradeable** on THORChain's FIN DEX without bridging or wrapping
- **Withdrawable** back to the native L1 chain at any time

Secured assets are **not** liquidity pool (LP) positions. They are direct asset representations on THORChain.

## Asset Naming Convention

Assets use the format `CHAIN.SYMBOL` or `CHAIN.SYMBOL-CONTRACT`:

| Asset | Meaning |
|-------|---------|
| `BTC.BTC` | Native Bitcoin |
| `ETH.ETH` | Native Ether |
| `ETH.USDC-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48` | USDC on Ethereum |
| `THOR.RUNE` | Native RUNE on THORChain |
| `BSC.BNB` | Native BNB on BSC |

## Commands

### Check Secured Balances

```bash
# All THORChain balances
vultisig rujira balance -o json
```

```json
{
  "thorAddress": "thor1abc...",
  "balances": [
    {"asset": "BTC/BTC", "denom": "btc/btc", "formatted": "0.001", "amount": "100000"},
    {"asset": "THOR.RUNE", "denom": "rune", "formatted": "50.0", "amount": "5000000000"}
  ]
}
```

```bash
# Secured assets only (excludes native RUNE)
vultisig rujira balance --secured-only -o json
```

### List FIN Swap Routes

```bash
vultisig rujira routes -o json
```

Returns available trading pairs on the FIN DEX with liquidity info.

### Deposit L1 Assets to THORChain

Depositing is a two-step process:

**Step 1: Get deposit instructions**
```bash
vultisig rujira deposit --asset BTC.BTC --amount 100000 -o json
```

```json
{
  "thorAddress": "thor1abc...",
  "deposit": {
    "chain": "Bitcoin",
    "asset": "BTC.BTC",
    "inboundAddress": "bc1q...",
    "memo": "=:BTC/BTC:thor1abc...",
    "minimumAmount": "10000"
  }
}
```

**Step 2: Send from L1 chain** using the inbound address and memo:
```bash
vultisig send bitcoin bc1q... 0.001 --password "$VAULT_PASSWORD" -y -o json
```

Note: The memo must be included in the transaction for THORChain to process it. The CLI `send` command does not yet support custom memos — for now, use the SDK or broadcast a raw transaction.

### FIN Swap (Trade Secured Assets)

```bash
# Swap RUNE for secured ETH on FIN DEX
vultisig rujira swap \
  --from-asset THOR.RUNE \
  --to-asset ETH.ETH \
  --amount 100 \
  --password "$VAULT_PASSWORD" \
  -y -o json
```

```json
{
  "quote": {
    "expectedOutput": "0.05",
    "minimumOutput": "0.048",
    "contractAddress": "thor1..."
  },
  "result": {
    "txHash": "ABCDEF..."
  }
}
```

Options:
- `--slippage-bps <N>`: Slippage tolerance in basis points (100 = 1%)

### Withdraw Secured Assets to L1

```bash
# Withdraw secured BTC back to Bitcoin L1
vultisig rujira withdraw \
  --asset BTC.BTC \
  --amount 100000 \
  --l1-address bc1q... \
  --password "$VAULT_PASSWORD" \
  -y -o json
```

```json
{
  "prepared": {
    "asset": "BTC.BTC",
    "amount": "100000",
    "destination": "bc1q...",
    "memo": "-:BTC.BTC:bc1q...",
    "estimatedFee": "5000"
  },
  "result": {
    "txHash": "ABCDEF..."
  }
}
```

Options:
- `--max-fee-bps <N>`: Maximum fee in basis points

## Amounts

All amounts in Rujira commands are in **base units** (smallest denomination):

| Asset | Base Unit | Example |
|-------|-----------|---------|
| BTC | satoshi | 100000 = 0.001 BTC |
| ETH | wei (but THORChain uses 8 decimals) | 100000000 = 1 ETH |
| RUNE | 1e-8 RUNE | 5000000000 = 50 RUNE |

## Common Workflows

### Deposit BTC and Swap to ETH

```bash
# 1. Get deposit instructions for BTC
DEPOSIT=$(vultisig rujira deposit --asset BTC.BTC --amount 100000 -o json)

# 2. Send BTC to inbound address (requires memo support)
# ... send transaction with memo from deposit instructions ...

# 3. Wait for deposit confirmation, then swap
vultisig rujira swap --from-asset BTC/BTC --to-asset ETH/ETH --amount 100000 --password "$VAULT_PASSWORD" -y -o json

# 4. Withdraw ETH to L1
vultisig rujira withdraw --asset ETH.ETH --amount 5000000 --l1-address 0x... --password "$VAULT_PASSWORD" -y -o json
```
