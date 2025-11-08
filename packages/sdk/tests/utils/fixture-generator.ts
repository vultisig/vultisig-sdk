/**
 * Fixture Generator for Vultisig SDK Tests
 *
 * Generates test fixtures for all supported blockchain chains.
 * Each chain gets 4 fixture files:
 * - addresses.json: Valid and invalid addresses
 * - transactions.json: Sample transactions
 * - balances.json: Sample balance queries
 * - rpc-responses.json: Mock RPC responses
 *
 * Phase 1: Foundation - Tier 1 chains (Bitcoin, Ethereum, Solana, THORChain, Ripple)
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

/**
 * Chain Tier Classification
 * Based on TEST_DATA_SPEC.md
 */
export const CHAIN_TIERS = {
  tier1: ['bitcoin', 'ethereum', 'solana', 'thorchain', 'ripple'],
  tier2: [
    'bnb-smart-chain',
    'polygon',
    'avalanche',
    'arbitrum',
    'optimism',
    'base',
    'blast',
    'cronos',
    'zksync',
  ],
  tier3: [
    'doge',
    'litecoin',
    'bitcoin-cash',
    'dash',
    'cosmos',
    'kujira',
    'maya',
    'sui',
    'polkadot',
    'noble',
    'ton',
  ],
} as const

export type ChainTier = 'tier1' | 'tier2' | 'tier3'
export type ChainName = (typeof CHAIN_TIERS)[ChainTier][number]

/**
 * Chain Family Classification
 */
export enum ChainFamily {
  UTXO = 'utxo',
  EVM = 'evm',
  EDDSA = 'eddsa',
  COSMOS = 'cosmos',
  OTHER = 'other',
}

/**
 * Chain Configuration
 */
export interface ChainConfig {
  name: ChainName
  family: ChainFamily
  tier: ChainTier
  nativeToken: string
  derivationPath: string
  addressPrefix?: string
  // Sample data for fixture generation
  sampleAddress?: string
  sampleTxHash?: string
  samplePublicKey?: string
}

/**
 * All Chain Configurations
 */
export const CHAIN_CONFIGS: Record<string, ChainConfig> = {
  // Tier 1 Chains
  bitcoin: {
    name: 'bitcoin',
    family: ChainFamily.UTXO,
    tier: 'tier1',
    nativeToken: 'BTC',
    derivationPath: "m/84'/0'/0'/0/0",
    sampleAddress: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
    sampleTxHash:
      'a1075db55d416d3ca199f55b6084e2115b9345e16c5cf302fc80e9d5fbf5d48d',
    samplePublicKey:
      '0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798',
  },
  ethereum: {
    name: 'ethereum',
    family: ChainFamily.EVM,
    tier: 'tier1',
    nativeToken: 'ETH',
    derivationPath: "m/44'/60'/0'/0/0",
    sampleAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb8',
    sampleTxHash:
      '0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060',
    samplePublicKey:
      '0x0479BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8',
  },
  solana: {
    name: 'solana',
    family: ChainFamily.EDDSA,
    tier: 'tier1',
    nativeToken: 'SOL',
    derivationPath: "m/44'/501'/0'/0'",
    sampleAddress: '7EqQdEULxWcraVx3mXKFjc84LhCkMGZCkRuDpvcMwJeK',
    sampleTxHash:
      '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW',
    samplePublicKey:
      '7EqQdEULxWcraVx3mXKFjc84LhCkMGZCkRuDpvcMwJeK',
  },
  thorchain: {
    name: 'thorchain',
    family: ChainFamily.COSMOS,
    tier: 'tier1',
    nativeToken: 'RUNE',
    derivationPath: "m/44'/931'/0'/0/0",
    addressPrefix: 'thor',
    sampleAddress: 'thor1xvj8z9fqm9v2xqy2z8z9fqm9v2xqy2z8z9fqm',
    sampleTxHash:
      'A8B5E9D1F2C3A4B5E9D1F2C3A4B5E9D1F2C3A4B5E9D1F2C3A4B5E9D1F2C3A4B5',
    samplePublicKey:
      '03A8B5E9D1F2C3A4B5E9D1F2C3A4B5E9D1F2C3A4B5E9D1F2C3A4B5E9D1F2C3A4',
  },
  ripple: {
    name: 'ripple',
    family: ChainFamily.OTHER,
    tier: 'tier1',
    nativeToken: 'XRP',
    derivationPath: "m/44'/144'/0'/0/0",
    addressPrefix: 'r',
    sampleAddress: 'rN7n7otQDd6FczFgLdlqtyMVrn3VxZvnav',
    sampleTxHash:
      '93EF1F1E99A9D2F7C3B8E4D5A1C2B3A4E5D6F7C8A9B0C1D2E3F4A5B6C7D8E9F0',
    samplePublicKey:
      '02A8B5E9D1F2C3A4B5E9D1F2C3A4B5E9D1F2C3A4B5E9D1F2C3A4B5E9D1F2C3A4',
  },

  // Tier 2 Chains (EVM-compatible)
  'bnb-smart-chain': {
    name: 'bnb-smart-chain',
    family: ChainFamily.EVM,
    tier: 'tier2',
    nativeToken: 'BNB',
    derivationPath: "m/44'/60'/0'/0/0",
  },
  polygon: {
    name: 'polygon',
    family: ChainFamily.EVM,
    tier: 'tier2',
    nativeToken: 'MATIC',
    derivationPath: "m/44'/60'/0'/0/0",
  },
  avalanche: {
    name: 'avalanche',
    family: ChainFamily.EVM,
    tier: 'tier2',
    nativeToken: 'AVAX',
    derivationPath: "m/44'/60'/0'/0/0",
  },
  arbitrum: {
    name: 'arbitrum',
    family: ChainFamily.EVM,
    tier: 'tier2',
    nativeToken: 'ETH',
    derivationPath: "m/44'/60'/0'/0/0",
  },
  optimism: {
    name: 'optimism',
    family: ChainFamily.EVM,
    tier: 'tier2',
    nativeToken: 'ETH',
    derivationPath: "m/44'/60'/0'/0/0",
  },
  base: {
    name: 'base',
    family: ChainFamily.EVM,
    tier: 'tier2',
    nativeToken: 'ETH',
    derivationPath: "m/44'/60'/0'/0/0",
  },
  blast: {
    name: 'blast',
    family: ChainFamily.EVM,
    tier: 'tier2',
    nativeToken: 'ETH',
    derivationPath: "m/44'/60'/0'/0/0",
  },
  cronos: {
    name: 'cronos',
    family: ChainFamily.EVM,
    tier: 'tier2',
    nativeToken: 'CRO',
    derivationPath: "m/44'/60'/0'/0/0",
  },
  zksync: {
    name: 'zksync',
    family: ChainFamily.EVM,
    tier: 'tier2',
    nativeToken: 'ETH',
    derivationPath: "m/44'/60'/0'/0/0",
  },

  // Tier 3 Chains
  doge: {
    name: 'doge',
    family: ChainFamily.UTXO,
    tier: 'tier3',
    nativeToken: 'DOGE',
    derivationPath: "m/44'/3'/0'/0/0",
  },
  litecoin: {
    name: 'litecoin',
    family: ChainFamily.UTXO,
    tier: 'tier3',
    nativeToken: 'LTC',
    derivationPath: "m/84'/2'/0'/0/0",
  },
  'bitcoin-cash': {
    name: 'bitcoin-cash',
    family: ChainFamily.UTXO,
    tier: 'tier3',
    nativeToken: 'BCH',
    derivationPath: "m/44'/145'/0'/0/0",
  },
  dash: {
    name: 'dash',
    family: ChainFamily.UTXO,
    tier: 'tier3',
    nativeToken: 'DASH',
    derivationPath: "m/44'/5'/0'/0/0",
  },
  cosmos: {
    name: 'cosmos',
    family: ChainFamily.COSMOS,
    tier: 'tier3',
    nativeToken: 'ATOM',
    derivationPath: "m/44'/118'/0'/0/0",
    addressPrefix: 'cosmos',
  },
  kujira: {
    name: 'kujira',
    family: ChainFamily.COSMOS,
    tier: 'tier3',
    nativeToken: 'KUJI',
    derivationPath: "m/44'/118'/0'/0/0",
    addressPrefix: 'kujira',
  },
  maya: {
    name: 'maya',
    family: ChainFamily.COSMOS,
    tier: 'tier3',
    nativeToken: 'CACAO',
    derivationPath: "m/44'/931'/0'/0/0",
    addressPrefix: 'maya',
  },
  sui: {
    name: 'sui',
    family: ChainFamily.EDDSA,
    tier: 'tier3',
    nativeToken: 'SUI',
    derivationPath: "m/44'/784'/0'/0'/0'",
  },
  polkadot: {
    name: 'polkadot',
    family: ChainFamily.EDDSA,
    tier: 'tier3',
    nativeToken: 'DOT',
    derivationPath: "//polkadot//0",
  },
  noble: {
    name: 'noble',
    family: ChainFamily.COSMOS,
    tier: 'tier3',
    nativeToken: 'USDC',
    derivationPath: "m/44'/118'/0'/0/0",
    addressPrefix: 'noble',
  },
  ton: {
    name: 'ton',
    family: ChainFamily.OTHER,
    tier: 'tier3',
    nativeToken: 'TON',
    derivationPath: "m/44'/607'/0'",
  },
}

/**
 * Generate address fixtures for a chain
 */
export function generateAddressFixtures(config: ChainConfig): any {
  const fixtures = {
    valid: [] as any[],
    invalid: [] as any[],
    metadata: {
      chain: config.name,
      family: config.family,
      generatedAt: new Date().toISOString(),
    },
  }

  // Generate valid addresses
  if (config.sampleAddress) {
    fixtures.valid.push({
      address: config.sampleAddress,
      publicKey: config.samplePublicKey,
      derivationPath: config.derivationPath,
      type: getAddressType(config),
      network: 'mainnet',
      description: 'Standard mainnet address',
    })
  }

  // Add family-specific valid patterns
  switch (config.family) {
    case ChainFamily.UTXO:
      fixtures.invalid.push(
        'invalid_address',
        '1InvalidBTC',
        'bc1invalid',
        '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb8', // Wrong family
        ''
      )
      break
    case ChainFamily.EVM:
      fixtures.invalid.push(
        'invalid_address',
        '0xinvalid',
        '0x123', // Too short
        'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', // Wrong family
        ''
      )
      break
    case ChainFamily.EDDSA:
      fixtures.invalid.push(
        'invalid_address',
        '1InvalidSolana',
        'invalid_base58',
        '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb8', // Wrong family
        ''
      )
      break
    case ChainFamily.COSMOS:
      fixtures.invalid.push(
        'invalid_address',
        `${config.addressPrefix}1invalid`,
        'cosmos1invalid', // Wrong prefix
        '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb8', // Wrong family
        ''
      )
      break
  }

  return fixtures
}

/**
 * Generate transaction fixtures for a chain
 */
export function generateTransactionFixtures(config: ChainConfig): any {
  const fixtures = {
    unsigned: [] as any[],
    signed: [] as any[],
    metadata: {
      chain: config.name,
      family: config.family,
      generatedAt: new Date().toISOString(),
    },
  }

  // Add family-specific transaction templates
  switch (config.family) {
    case ChainFamily.UTXO:
      fixtures.unsigned.push({
        from: config.sampleAddress,
        to: 'recipient_address_placeholder',
        amount: '100000', // 0.001 BTC (satoshis)
        fee: '1000', // 0.00001 BTC
        inputs: [],
        outputs: [],
        description: 'Basic UTXO transaction',
      })
      break
    case ChainFamily.EVM:
      fixtures.unsigned.push({
        from: config.sampleAddress,
        to: '0x0000000000000000000000000000000000000000',
        value: '1000000000000000000', // 1 ETH (wei)
        gasLimit: '21000',
        gasPrice: '20000000000', // 20 gwei
        nonce: 0,
        chainId: 1,
        data: '0x',
        description: 'Basic ETH transfer',
      })
      break
    case ChainFamily.EDDSA:
      fixtures.unsigned.push({
        from: config.sampleAddress,
        to: 'recipient_address_placeholder',
        amount: '1000000000', // 1 SOL (lamports)
        recentBlockhash: 'blockhash_placeholder',
        description: 'Basic Solana transaction',
      })
      break
    case ChainFamily.COSMOS:
      fixtures.unsigned.push({
        from: config.sampleAddress,
        to: `${config.addressPrefix}1recipient`,
        amount: '1000000', // 1 token (micro-units)
        denom: config.nativeToken.toLowerCase(),
        gas: '200000',
        memo: '',
        description: 'Basic Cosmos transaction',
      })
      break
  }

  return fixtures
}

/**
 * Generate balance fixtures for a chain
 */
export function generateBalanceFixtures(config: ChainConfig): any {
  return {
    queries: [
      {
        address: config.sampleAddress,
        expectedBalance: '1000000000000000000', // 1 token in smallest unit
        token: config.nativeToken,
        description: 'Native token balance',
      },
      {
        address: config.sampleAddress,
        expectedBalance: '0',
        token: config.nativeToken,
        description: 'Zero balance',
      },
    ],
    metadata: {
      chain: config.name,
      family: config.family,
      generatedAt: new Date().toISOString(),
    },
  }
}

/**
 * Generate RPC response fixtures for a chain
 */
export function generateRpcResponseFixtures(config: ChainConfig): any {
  const fixtures = {
    getBalance: {
      request: {
        address: config.sampleAddress,
      },
      response: {
        balance: '1000000000000000000',
        token: config.nativeToken,
      },
    },
    getTransactionCount: {
      request: {
        address: config.sampleAddress,
      },
      response: {
        count: 42,
      },
    },
    metadata: {
      chain: config.name,
      family: config.family,
      generatedAt: new Date().toISOString(),
    },
  }

  return fixtures
}

/**
 * Get address type based on chain config
 */
function getAddressType(config: ChainConfig): string {
  switch (config.family) {
    case ChainFamily.UTXO:
      if (config.name === 'bitcoin') return 'p2wpkh'
      return 'standard'
    case ChainFamily.EVM:
      return 'eoa' // Externally Owned Account
    case ChainFamily.EDDSA:
      return 'ed25519'
    case ChainFamily.COSMOS:
      return 'bech32'
    default:
      return 'standard'
  }
}

/**
 * Generate all fixtures for a specific chain
 */
export function generateChainFixtures(
  chainName: string,
  outputDir: string
): void {
  const config = CHAIN_CONFIGS[chainName]
  if (!config) {
    throw new Error(`Unknown chain: ${chainName}`)
  }

  console.log(`📦 Generating fixtures for ${chainName}...`)

  // Create chain directory
  const chainDir = join(outputDir, chainName)
  if (!existsSync(chainDir)) {
    mkdirSync(chainDir, { recursive: true })
  }

  // Generate and write each fixture file
  const fixtures = {
    'addresses.json': generateAddressFixtures(config),
    'transactions.json': generateTransactionFixtures(config),
    'balances.json': generateBalanceFixtures(config),
    'rpc-responses.json': generateRpcResponseFixtures(config),
  }

  for (const [filename, data] of Object.entries(fixtures)) {
    const filePath = join(chainDir, filename)
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
    console.log(`  ✅ ${filename}`)
  }

  console.log(`✅ Fixtures generated for ${chainName}\n`)
}

/**
 * Generate fixtures for a specific tier
 */
export function generateTierFixtures(
  tier: ChainTier,
  outputDir: string
): void {
  const chains = CHAIN_TIERS[tier]
  console.log(`\n🎯 Generating Tier ${tier.toUpperCase()} fixtures...\n`)

  for (const chain of chains) {
    generateChainFixtures(chain, outputDir)
  }

  console.log(
    `\n✅ All Tier ${tier.toUpperCase()} fixtures generated (${chains.length} chains)\n`
  )
}

/**
 * Generate fixtures for all chains
 */
export function generateAllFixtures(outputDir: string): void {
  console.log('\n🚀 Generating fixtures for ALL chains...\n')

  const allTiers: ChainTier[] = ['tier1', 'tier2', 'tier3']
  for (const tier of allTiers) {
    generateTierFixtures(tier, outputDir)
  }

  console.log('✅ All fixtures generated successfully!\n')
}

// Export all functions for use in scripts
// This module is meant to be imported, not run directly
