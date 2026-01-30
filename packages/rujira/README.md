# @vultisig/rujira

TypeScript SDK for interacting with **Rujira (FIN)** on THORChain.

It provides:
- FIN **swap** quotes + execution (CosmWasm)
- **Secured asset** ("synth-like") deposit helpers (inbound address + memo)
- **Withdrawal** helpers (THORChain `MsgDeposit` withdrawal flow)
- Route discovery + convenience **easy routes**

> Status: Early/alpha. APIs may change.

---

## Installation

```bash
# npm
npm i @vultisig/rujira

# yarn
yarn add @vultisig/rujira

# pnpm
pnpm add @vultisig/rujira
```

If you are working inside this monorepo, use the workspace dependency:

```json
{
  "dependencies": {
    "@vultisig/rujira": "workspace:^"
  }
}
```

---

## Secured assets (what they are)

THORChain can custody L1 assets in inbound vaults and represent them on THORChain as **secured assets** (bank balances / denoms).

Typical flow:
1. You send an L1 transfer (e.g. BTC) to a THORChain inbound address
2. You include a memo that tells THORChain which THOR address should receive the secured asset
3. THORChain credits your THOR address with the corresponding secured denom
4. Those secured denoms can be swapped on FIN (Rujira orderbook DEX)
5. You can withdraw back to L1 by broadcasting a THORChain `MsgDeposit` with a withdraw memo

Notes:
- THORChain secured balances are commonly stored with **8 decimals**.
- This package accepts **human-friendly asset notation** like `BTC.BTC` / `ETH.ETH` and maps to FIN denoms when available via `@vultisig/assets`.

---

## Quick start (read-only)

```ts
import { RujiraClient } from '@vultisig/rujira'

const client = new RujiraClient({ network: 'mainnet' })
await client.connect()

// 1) Discover FIN routes / contracts
const quote = await client.swap.getQuote({
  fromAsset: 'THOR.RUNE',
  toAsset: 'BTC.BTC',
  amount: '100000000', // base units (example)
})

console.log('Expected out:', quote.expectedOutput)
```

---

## Quick start (with Vultisig signing)

To execute swaps/withdrawals you need a Cosmos signer. When using a Vultisig vault, use `VultisigRujiraProvider`.

```ts
import { Vultisig } from '@vultisig/sdk'
import { RujiraClient, VultisigRujiraProvider } from '@vultisig/rujira'

// 1) Initialize Vultisig SDK + pick a vault
const sdk = new Vultisig({ /* ... */ })
await sdk.initialize()
const vault = await sdk.getActiveVault()
if (!vault) throw new Error('No active vault')

// 2) Create a Rujira client with a Vultisig-backed signer
const signer = new VultisigRujiraProvider(vault)
const client = new RujiraClient({ network: 'mainnet', signer })
await client.connect()

// 3) FIN swap (secured denoms on THORChain)
const thorDestination = await vault.address('THORChain')

const quote = await client.swap.getQuote({
  fromAsset: 'BTC.BTC',
  toAsset: 'ETH.ETH',
  amount: '100000',
  destination: thorDestination,
  slippageBps: 100,
})

const swapResult = await client.swap.execute(quote, { slippageBps: 100 })
console.log('Swap tx hash:', swapResult.txHash)
```

---

## Deposits (secure L1 → THORChain)

### Get inbound address + memo

```ts
import { RujiraClient } from '@vultisig/rujira'

const client = new RujiraClient({ network: 'mainnet' })
await client.connect()

const deposit = await client.deposit.prepare({
  fromAsset: 'BTC.BTC',
  amount: '100000', // base units; used for validation / dust threshold checks
  thorAddress: 'thor1...',
})

console.log('Send to:', deposit.inboundAddress)
console.log('Memo:', deposit.memo)
```

### List all inbound addresses

```ts
const inbound = await client.deposit.getInboundAddresses()
console.log(inbound.map(i => ({ chain: i.chain, address: i.address })))
```

### Check secured balances on THORChain

```ts
const balances = await client.deposit.getBalances('thor1...')
console.log(balances)
```

---

## Withdrawals (THORChain → L1)

Withdrawals are executed on THORChain via `MsgDeposit` with a withdraw memo. When using Vultisig, withdrawal execution requires a `VultisigRujiraProvider` (it exposes vault access for MsgDeposit signing).

```ts
import { RujiraClient, VultisigRujiraProvider } from '@vultisig/rujira'

const client = new RujiraClient({ network: 'mainnet', signer: new VultisigRujiraProvider(vault) })
await client.connect()

const prepared = await client.withdraw.prepare({
  asset: 'BTC.BTC',
  amount: '100000',
  l1Address: 'bc1...',
})

const result = await client.withdraw.execute(prepared)
console.log('Withdraw tx hash:', result.txHash)
```

---

## Easy routes (convenience)

Use pre-defined routes to avoid thinking about pairs.

```ts
import { EASY_ROUTES, listEasyRoutes, getRoutesSummary } from '@vultisig/rujira'

console.log(getRoutesSummary())
console.log(listEasyRoutes())

const route = EASY_ROUTES.RUNE_TO_USDC
```

---

## API reference (high level)

### `new RujiraClient(options)`

```ts
export interface RujiraClientOptions {
  config?: Partial<RujiraConfig>
  signer?: RujiraSigner
  rpcEndpoint?: string
  contractCache?: {
    load?: () => Promise<Record<string, string>> | Record<string, string>
    save?: (finContracts: Record<string, string>) => Promise<void> | void
  }
  debug?: boolean
  swapOptions?: RujiraSwapOptions
}
```

Key methods:
- `connect()` / `disconnect()`
- `isConnected()` / `canSign()`
- `getAddress()`
- `getBalance(address, denom)` / `getAllBalances(address)`

Modules:
- `client.swap.getQuote(params)` / `client.swap.execute(quote, options)`
- `client.deposit.prepare(params)` / `client.deposit.getInboundAddresses()` / `client.deposit.getBalances(thorAddress)`
- `client.withdraw.prepare(params)` / `client.withdraw.execute(prepared)`

### `VultisigRujiraProvider`

A Cosmos signer implementation that delegates signing to a Vultisig vault.

```ts
import { VultisigRujiraProvider } from '@vultisig/rujira'

const signer = new VultisigRujiraProvider(vault /*, chainId? */)
```

---

## GraphQL / discovery rate limits (optional)

Rujira contract discovery may use GraphQL. If you run into HTTP 429 rate limits, you can provide an API token to the **GraphQL client** used by discovery.

```ts
import { RujiraDiscovery } from '@vultisig/rujira'

const discovery = new RujiraDiscovery({
  network: 'mainnet',
  graphql: { apiKey: process.env.RUJIRA_API_KEY },
})

const contracts = await discovery.discoverContracts()
```

---

## Examples

See:
- `packages/rujira/examples/`
- `packages/rujira/docs/`

---

## License

MIT
