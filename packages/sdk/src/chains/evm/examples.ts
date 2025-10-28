/**
 * EVM Module Usage Examples
 *
 * These examples demonstrate common use cases for the EVM module.
 * Copy and adapt these examples for your own applications.
 */

import { Vultisig } from '../../VultisigSDK'
import { EvmChain } from '@core/chain/Chain'
import {
  parseEvmTransaction,
  buildEvmKeysignPayload,
  estimateTransactionGas,
  formatGasPriceAuto,
  getTokenBalance,
  getTokenMetadata,
  formatTokenWithSymbol,
  Erc20Parser,
  UniswapParser,
  OneInchParser,
  getNativeToken,
  getCommonToken,
} from './index'

/**
 * Example 1: Parse and inspect an EVM transaction
 */
export async function example1_parseTransaction() {
  const vultisig = new Vultisig()
  await vultisig.initialize()

  // Raw transaction hex (example)
  const rawTx = '0x02f8...' // Your transaction hex

  // Parse it
  const parsed = await parseEvmTransaction(
    await vultisig.getWalletCore(),
    rawTx
  )

  console.log('=== Transaction Details ===')
  console.log('Type:', parsed.type)
  console.log('From:', parsed.from)
  console.log('To:', parsed.to)
  console.log('Value:', parsed.value.toString())
  console.log('Chain ID:', parsed.chainId)
  console.log('Nonce:', parsed.nonce)
  console.log('Gas Limit:', parsed.gasLimit.toString())

  // Type-specific details
  if (parsed.type === 'transfer' && parsed.transfer) {
    console.log('\n=== Transfer Details ===')
    if (parsed.transfer.token) {
      console.log('Token:', parsed.transfer.token.symbol)
    } else {
      console.log('Native token transfer')
    }
    console.log('Amount:', parsed.transfer.amount.toString())
    console.log('Recipient:', parsed.transfer.recipient)
  }

  if (parsed.type === 'swap' && parsed.swap) {
    console.log('\n=== Swap Details ===')
    console.log('Input:', parsed.swap.inputToken.symbol)
    console.log('Output:', parsed.swap.outputToken.symbol)
    console.log('Input Amount:', parsed.swap.inputAmount.toString())
    console.log('Output Amount:', parsed.swap.outputAmount.toString())
    console.log('Protocol:', parsed.swap.protocol)
  }

  return parsed
}

/**
 * Example 2: Parse protocol-specific transactions
 */
export function example2_protocolParsing(to: string, data: string) {
  console.log('=== Protocol Detection ===')

  // ERC-20
  if (Erc20Parser.isErc20Transaction(data)) {
    console.log('ERC-20 transaction detected')
    const parsed = Erc20Parser.parse(data)
    console.log('Details:', parsed)
  }

  // Uniswap
  if (UniswapParser.isUniswapTransaction(to, data)) {
    console.log('Uniswap transaction detected')
    const swap = UniswapParser.parseSwap(data)
    const tokens = UniswapParser.getTokensFromSwap(swap)
    console.log('Tokens:', tokens)
  }

  // 1inch
  if (OneInchParser.is1inchTransaction(to, data)) {
    console.log('1inch transaction detected')
    const swap = OneInchParser.parseSwap(data)
    console.log('Swap:', swap)
  }
}

/**
 * Example 3: Build keysign payload and sign
 */
export async function example3_signTransaction() {
  const vultisig = new Vultisig()
  await vultisig.initialize()

  const vault = await vultisig.getVault('my-vault', 'password')
  const walletCore = await vultisig.getWalletCore()

  // Raw transaction to sign
  const rawTx = '0x02f8...'

  // Parse transaction
  const parsed = await parseEvmTransaction(walletCore, rawTx)

  // Build keysign payload
  const keysignPayload = await buildEvmKeysignPayload({
    parsedTransaction: parsed,
    rawTransaction: rawTx,
    vaultPublicKey: vault.getVaultData().publicKeys.ecdsa,
    skipBroadcast: false,
    memo: 'Example transaction',
  })

  // Sign using fast vault
  const signature = await vault.sign('fast', keysignPayload, 'password')

  console.log('=== Signature ===')
  console.log('Signature:', signature.signature)
  console.log('TX Hash:', signature.txHash)

  return signature
}

/**
 * Example 4: Estimate gas for a transaction
 */
export async function example4_estimateGas() {
  const chain = EvmChain.Ethereum
  const transaction = {
    to: '0x...',
    from: '0x...',
    data: '0x...',
    value: 0n,
  }

  const gasEstimate = await estimateTransactionGas(chain, transaction)

  console.log('=== Gas Estimate ===')
  console.log('Base Fee:', formatGasPriceAuto(gasEstimate.baseFeePerGas))
  console.log('Priority Fee:', formatGasPriceAuto(gasEstimate.maxPriorityFeePerGas))
  console.log('Max Fee:', formatGasPriceAuto(gasEstimate.maxFeePerGas))
  console.log('Gas Limit:', gasEstimate.gasLimit.toString())
  console.log('Total Cost:', formatGasPriceAuto(gasEstimate.totalCost))

  return gasEstimate
}

/**
 * Example 5: Query token balances
 */
export async function example5_tokenBalances() {
  const chain = EvmChain.Ethereum
  const accountAddress = '0x...'

  // Get USDC balance
  const usdcToken = getCommonToken(chain, 'USDC')
  if (!usdcToken) {
    throw new Error('USDC not found')
  }

  const balance = await getTokenBalance(chain, usdcToken.address, accountAddress)
  const metadata = await getTokenMetadata(chain, usdcToken.address)

  console.log('=== Token Balance ===')
  console.log('Token:', metadata.name)
  console.log('Symbol:', metadata.symbol)
  console.log('Balance:', formatTokenWithSymbol(balance, metadata.decimals, metadata.symbol, 2))

  return balance
}

/**
 * Example 6: Working with native tokens
 */
export function example6_nativeTokens() {
  // Get native token for different chains
  const eth = getNativeToken(EvmChain.Ethereum)
  const matic = getNativeToken(EvmChain.Polygon)
  const avax = getNativeToken(EvmChain.Avalanche)

  console.log('=== Native Tokens ===')
  console.log('Ethereum:', eth.symbol, eth.decimals)
  console.log('Polygon:', matic.symbol, matic.decimals)
  console.log('Avalanche:', avax.symbol, avax.decimals)

  return { eth, matic, avax }
}

/**
 * Example 7: Multi-chain operations
 */
export async function example7_multiChain() {
  const chains = [EvmChain.Ethereum, EvmChain.Arbitrum, EvmChain.Polygon]
  const accountAddress = '0x...'

  console.log('=== Multi-Chain Balances ===')

  for (const chain of chains) {
    const nativeToken = getNativeToken(chain)
    const usdcToken = getCommonToken(chain, 'USDC')

    console.log(`\n${chain}:`)
    console.log(`  Native: ${nativeToken.symbol}`)

    if (usdcToken) {
      try {
        const balance = await getTokenBalance(chain, usdcToken.address, accountAddress)
        console.log(`  USDC Balance: ${formatTokenWithSymbol(balance, 6, 'USDC', 2)}`)
      } catch (error) {
        console.log(`  USDC: Error fetching balance`)
      }
    }
  }
}

/**
 * Example 8: Complete workflow - Parse, estimate, and sign
 */
export async function example8_completeWorkflow() {
  const vultisig = new Vultisig()
  await vultisig.initialize()

  const vault = await vultisig.getVault('my-vault', 'password')
  const walletCore = await vultisig.getWalletCore()
  const rawTx = '0x02f8...' // Your transaction

  // Step 1: Parse transaction
  console.log('Step 1: Parsing transaction...')
  const parsed = await parseEvmTransaction(walletCore, rawTx)
  console.log('✓ Transaction type:', parsed.type)

  // Step 2: Estimate gas (for display purposes)
  console.log('\nStep 2: Estimating gas...')
  const gasEstimate = await estimateTransactionGas(
    EvmChain.Ethereum,
    {
      to: parsed.to,
      from: parsed.from,
      data: parsed.data,
      value: parsed.value,
    }
  )
  console.log('✓ Total cost:', formatGasPriceAuto(gasEstimate.totalCost))

  // Step 3: Build keysign payload
  console.log('\nStep 3: Building keysign payload...')
  const keysignPayload = await buildEvmKeysignPayload({
    parsedTransaction: parsed,
    rawTransaction: rawTx,
    vaultPublicKey: vault.getVaultData().publicKeys.ecdsa,
    skipBroadcast: false,
  })
  console.log('✓ Keysign payload ready')

  // Step 4: Sign
  console.log('\nStep 4: Signing transaction...')
  const signature = await vault.sign('fast', keysignPayload, 'password')
  console.log('✓ Transaction signed')
  console.log('✓ TX Hash:', signature.txHash)

  return signature
}

// Export all examples
export const examples = {
  parseTransaction: example1_parseTransaction,
  protocolParsing: example2_protocolParsing,
  signTransaction: example3_signTransaction,
  estimateGas: example4_estimateGas,
  tokenBalances: example5_tokenBalances,
  nativeTokens: example6_nativeTokens,
  multiChain: example7_multiChain,
  completeWorkflow: example8_completeWorkflow,
}
