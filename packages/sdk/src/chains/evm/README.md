# EVM Chain Module

Comprehensive utilities for working with EVM-compatible blockchains in the Vultisig SDK.

## Supported Chains

- **Ethereum** (L1)
- **L2s**: Arbitrum, Base, Blast, Optimism, Zksync, Mantle
- **Other EVM**: Polygon, Avalanche, BSC, Cronos

## Features

### Transaction Parsing
Parse and decode EVM transactions including:
- Native token transfers
- ERC-20 token transfers
- Uniswap V2/V3 swaps
- 1inch aggregator swaps
- NFT transfers (ERC-721, ERC-1155)
- Generic contract interactions

### Keysign Payload Building
Build MPC keysign payloads for secure multi-party signing of EVM transactions.

### Gas Utilities
- Estimate transaction gas costs
- Format gas prices (wei/gwei/eth)
- Compare gas estimates

### Token Utilities
- Query ERC-20 balances and allowances
- Fetch token metadata (name, symbol, decimals)
- Format token amounts

## Usage Examples

### Transaction Parsing

```typescript
import { parseEvmTransaction } from '@vultisig/sdk'

// Parse a raw EVM transaction
const parsed = await parseEvmTransaction(walletCore, rawTxHex)

console.log('Transaction type:', parsed.type)
console.log('From:', parsed.from)
console.log('To:', parsed.to)
console.log('Value:', parsed.value)

// Check if it's a swap
if (parsed.type === 'swap' && parsed.swap) {
  console.log('Swap detected!')
  console.log('Input:', parsed.swap.inputToken.symbol, parsed.swap.inputAmount)
  console.log('Output:', parsed.swap.outputToken.symbol, parsed.swap.outputAmount)
}

// Check if it's an ERC-20 transfer
if (parsed.type === 'transfer' && parsed.transfer?.token) {
  console.log('ERC-20 transfer detected!')
  console.log('Token:', parsed.transfer.token.symbol)
  console.log('Amount:', parsed.transfer.amount)
  console.log('Recipient:', parsed.transfer.recipient)
}
```

### Protocol-Specific Parsing

```typescript
import { Erc20Parser, UniswapParser, OneInchParser, NftParser } from '@vultisig/sdk'

// Parse ERC-20 transfer
if (Erc20Parser.isTransfer(data)) {
  const { recipient, amount } = Erc20Parser.parseTransfer(data)
  console.log(`Transfer ${amount} to ${recipient}`)
}

// Parse Uniswap swap
if (UniswapParser.isUniswapTransaction(to, data)) {
  const swap = UniswapParser.parseSwap(data)
  const tokens = UniswapParser.getTokensFromSwap(swap)
  console.log(`Swap ${tokens.inputAmount} of ${tokens.inputToken}`)
  console.log(`  for ${tokens.minOutputAmount} of ${tokens.outputToken}`)
}

// Parse 1inch swap
if (OneInchParser.is1inchTransaction(to, data)) {
  const swap = OneInchParser.parseSwap(data)
  console.log(`1inch swap: ${swap.amount} ${swap.srcToken} -> ${swap.dstToken}`)
}

// Parse NFT transfer
if (NftParser.isNftTransaction(data)) {
  const nft = NftParser.parse(data)
  console.log(`NFT transfer: ${nft.standard}`)
  console.log(`From ${nft.from} to ${nft.to}`)
  console.log(`Token ID: ${nft.tokenId}`)
}
```

### Building Keysign Payloads

```typescript
import { parseEvmTransaction, buildEvmKeysignPayload } from '@vultisig/sdk'

// Parse transaction
const parsed = await parseEvmTransaction(walletCore, rawTx)

// Build keysign payload for MPC signing
const keysignPayload = await buildEvmKeysignPayload({
  parsedTransaction: parsed,
  rawTransaction: rawTx,
  vaultPublicKey: vault.publicKeys.ecdsa,
  skipBroadcast: false,
  memo: 'My transaction',
})

// Use with vault signing
const signature = await vault.sign('fast', keysignPayload, password)
```

### Gas Estimation

```typescript
import { estimateTransactionGas, formatGasPrice, formatGasPriceAuto } from '@vultisig/sdk'
import { EvmChain } from '@vultisig/core/chain/Chain'

// Estimate gas for a transaction
const gasEstimate = await estimateTransactionGas(EvmChain.Ethereum, {
  to: '0x...',
  from: '0x...',
  data: '0x...',
  value: 0n,
})

console.log('Gas estimate:')
console.log('  Base fee:', formatGasPriceAuto(gasEstimate.baseFeePerGas))
console.log('  Priority fee:', formatGasPriceAuto(gasEstimate.maxPriorityFeePerGas))
console.log('  Max fee:', formatGasPriceAuto(gasEstimate.maxFeePerGas))
console.log('  Gas limit:', gasEstimate.gasLimit.toString())
console.log('  Total cost:', formatGasPriceAuto(gasEstimate.totalCost))

// Format gas prices in different units
const formatted = formatGasPrice(gasEstimate.maxFeePerGas)
console.log(`Gas price: ${formatted.gwei} gwei (${formatted.eth} ETH)`)
```

### Token Operations

```typescript
import {
  getTokenBalance,
  getTokenAllowance,
  getTokenMetadata,
  formatTokenAmount,
  formatTokenWithSymbol,
} from '@vultisig/sdk'
import { EvmChain } from '@vultisig/core/chain/Chain'

// Get token balance
const balance = await getTokenBalance(
  EvmChain.Ethereum,
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
  '0x...' // account address
)

// Get token metadata
const metadata = await getTokenMetadata(
  EvmChain.Ethereum,
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
)
console.log(`Token: ${metadata.name} (${metadata.symbol})`)
console.log(`Decimals: ${metadata.decimals}`)

// Format balance
const formatted = formatTokenWithSymbol(balance, metadata.decimals, metadata.symbol, 2)
console.log(`Balance: ${formatted}`) // e.g., "1234.56 USDC"

// Check allowance
const allowance = await getTokenAllowance(
  EvmChain.Ethereum,
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  '0x...', // owner
  '0x...'  // spender
)
console.log('Allowance:', formatTokenAmount(allowance, metadata.decimals))
```

### Working with Common Tokens

```typescript
import { COMMON_TOKENS, getCommonToken, getNativeToken } from '@vultisig/sdk'
import { EvmChain } from '@vultisig/core/chain/Chain'

// Get USDC on Ethereum
const usdc = getCommonToken(EvmChain.Ethereum, 'USDC')
console.log('USDC address:', usdc?.address)

// Get native token
const eth = getNativeToken(EvmChain.Ethereum)
console.log('Native token:', eth.symbol) // "ETH"

// Access all common tokens for a chain
const ethTokens = COMMON_TOKENS[EvmChain.Ethereum]
console.log('Available tokens:', Object.keys(ethTokens)) // ["WETH", "USDC", "USDT", "DAI"]
```

### Chain Configuration

```typescript
import { EVM_CHAIN_IDS, getChainId, getChainFromId, isEvmChain } from '@vultisig/sdk'
import { EvmChain } from '@vultisig/core/chain/Chain'

// Get chain ID
const chainId = getChainId(EvmChain.Ethereum) // 1
const arbChainId = getChainId(EvmChain.Arbitrum) // 42161

// Get chain from ID
const chain = getChainFromId(1) // EvmChain.Ethereum

// Check if a string is an EVM chain
if (isEvmChain('Ethereum')) {
  console.log('Valid EVM chain')
}

// Access all chain IDs
console.log('All EVM chains:', EVM_CHAIN_IDS)
```

### DEX Router Addresses

```typescript
import { DEX_ROUTERS } from '@vultisig/sdk'

console.log('Uniswap V2:', DEX_ROUTERS.UNISWAP_V2_ROUTER)
console.log('Uniswap V3:', DEX_ROUTERS.UNISWAP_V3_ROUTER)
console.log('1inch V5:', DEX_ROUTERS.ONEINCH_V5_ROUTER)
```

### Function Selectors

```typescript
import { ERC20_SELECTORS, ERC721_SELECTORS, ERC1155_SELECTORS, getFunctionSelector } from '@vultisig/sdk'

// Get function selector from calldata
const selector = getFunctionSelector(data) // e.g., "0xa9059cbb"

// Check against known selectors
if (selector === ERC20_SELECTORS.TRANSFER) {
  console.log('ERC-20 transfer detected')
}
if (selector === ERC721_SELECTORS.SAFE_TRANSFER_FROM) {
  console.log('ERC-721 safeTransferFrom detected')
}
```

## API Reference

### Transaction Parsing

- `parseEvmTransaction(walletCore, rawTx)` - Parse any EVM transaction
- `parseErc20TransferFrom(data)` - Parse ERC-20 transferFrom
- `getFunctionSelector(data)` - Extract function selector from calldata

### Protocol Parsers

#### Erc20Parser
- `isErc20Transaction(data)` - Check if ERC-20 transaction
- `parseTransfer(data)` - Parse transfer
- `parseApprove(data)` - Parse approve
- `parseTransferFrom(data)` - Parse transferFrom

#### UniswapParser
- `isUniswapTransaction(to, data)` - Check if Uniswap transaction
- `parseSwap(data)` - Parse any Uniswap swap
- `getTokensFromSwap(swap)` - Extract token details

#### OneInchParser
- `is1inchTransaction(to, data)` - Check if 1inch transaction
- `parseSwap(data)` - Parse 1inch swap
- `getSwapDetails(data)` - Get swap details

#### NftParser
- `isNftTransaction(data)` - Check if NFT transaction
- `parse(data)` - Parse any NFT transfer
- `getTransferSummary(transfer)` - Get transfer summary

### Keysign

- `buildEvmKeysignPayload(options)` - Build keysign payload
- `getEvmSpecific(payload)` - Extract EVM-specific data
- `updateEvmSpecific(payload, updates)` - Update EVM-specific fields

### Gas Utilities

- `estimateTransactionGas(chain, tx)` - Estimate gas
- `calculateMaxGasCost(gasLimit, maxFeePerGas)` - Calculate max cost
- `formatGasPrice(wei)` - Format to wei/gwei/eth
- `formatGasPriceAuto(wei)` - Auto-format to best unit
- `weiToGwei(wei)` / `gweiToWei(gwei)` - Unit conversions
- `weiToEth(wei)` / `ethToWei(eth)` - Unit conversions

### Token Utilities

- `getTokenBalance(chain, token, account)` - Get ERC-20 balance
- `getTokenAllowance(chain, token, owner, spender)` - Get allowance
- `getTokenMetadata(chain, token)` - Get name/symbol/decimals
- `buildToken(chain, address)` - Build complete token object
- `getNativeToken(chain)` - Get native token
- `formatTokenAmount(amount, decimals)` - Format amount
- `parseTokenAmount(amount, decimals)` - Parse amount
- `formatTokenWithSymbol(amount, decimals, symbol)` - Format with symbol

## Types

See [types.ts](./types.ts) for complete type definitions.

Key types:
- `ParsedEvmTransaction` - Parsed transaction structure
- `EvmToken` - Token metadata
- `EvmKeysignOptions` - Keysign options
- `EvmGasEstimate` - Gas estimate result
- `EvmSwapParams` - Swap details
- `EvmTransferParams` - Transfer details
- `EvmNftParams` - NFT details

## Architecture

The EVM module follows the same pattern as the Solana module:

- **Types** (`types.ts`) - TypeScript interfaces
- **Config** (`config.ts`) - Constants and addresses
- **Parsers** (`parsers/`) - Transaction parsing logic
- **Keysign** (`keysign.ts`) - MPC payload builders
- **Gas** (`gas/`) - Gas estimation and pricing
- **Tokens** (`tokens/`) - Token operations

All functionality wraps core blockchain operations with user-friendly interfaces while maintaining zero modifications to upstream `@core` and `@lib` packages.
