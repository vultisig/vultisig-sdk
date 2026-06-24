#!/usr/bin/env node
/**
 * Runnable receipt for sdk.knownContracts (canonical contract / token registry).
 *
 * Looks up real, publicly-documented contract constants across EVM, Solana,
 * and Tron and prints the resolved canonical addresses. NO broadcast, NO
 * signing — pure registry reads.
 *
 * Run with:  yarn workspace @vultisig/sdk dlx tsx scripts/receipts/known_contracts.mjs
 *       or:  npx tsx scripts/receipts/known_contracts.mjs   (from packages/sdk)
 */

import {
  canonicalEvmContracts,
  canonicalSolanaAddresses,
  canonicalTronContracts,
  isCanonicalEvmContract,
  isKnownContract,
} from '../../src/utils/knownContracts.ts'

const line = (label, value) => console.log(`${label.padEnd(40)} ${value}`)

console.log('=== sdk.knownContracts — canonical registry receipt ===\n')

line('Registry size (EVM)', canonicalEvmContracts.size)
line('Registry size (Solana)', canonicalSolanaAddresses.size)
line('Registry size (Tron)', canonicalTronContracts.size)
console.log('')

// 1) USDC on Ethereum (canonical token contract), via checksum-cased input.
const usdcEthChecksummed = '0xA0b86991c6218b36c1D19D4a2e9Eb0cE3606eB48'
line('USDC on Ethereum (input, checksummed)', usdcEthChecksummed)
line('  -> isCanonicalEvmContract', isCanonicalEvmContract(usdcEthChecksummed))
line('  -> isKnownContract', isKnownContract(usdcEthChecksummed))
console.log('')

// 2) A known router by chain: LI.FI Diamond (multi-chain aggregator router).
const lifiDiamond = '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae'
line('LI.FI Diamond router (multi-chain)', lifiDiamond)
line('  -> isKnownContract', isKnownContract(lifiDiamond))
console.log('')

// 3) Cross-chain canonical lookups (Solana SPL mint + Tron TRC-20 + ellipsized).
line('USDC SPL mint (Solana)', isKnownContract('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'))
line('USDT TRC-20 (Tron)', isKnownContract('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'))
line('Ellipsized USDC (0xA0b8…eB48)', isKnownContract('0xA0b8…eB48'))
console.log('')

// 4) Negative control: a non-canonical "wallet-shaped" EVM address must miss.
const burner = '0x000000000000000000000000000000000000dEaD'
line('Unknown address (negative control)', burner)
line('  -> isKnownContract', isKnownContract(burner))

console.log('\n=== receipt OK — no signing, no broadcast ===')
