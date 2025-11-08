#!/usr/bin/env tsx
/**
 * Fixture Generation Script
 * Easy wrapper around the fixture generator
 */

import { generateAllFixtures, generateTierFixtures, generateChainFixtures, ChainTier } from '../packages/sdk/tests/utils/fixture-generator'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const command = process.argv[2]
const target = process.argv[3]

const outputDir = join(__dirname, '../packages/sdk/tests/fixtures/chains')

switch (command) {
  case 'chain':
    if (!target) {
      console.error('❌ Please specify a chain name')
      process.exit(1)
    }
    generateChainFixtures(target, outputDir)
    break

  case 'tier':
    if (!target || !['tier1', 'tier2', 'tier3'].includes(target)) {
      console.error('❌ Please specify a valid tier (tier1, tier2, or tier3)')
      process.exit(1)
    }
    generateTierFixtures(target as ChainTier, outputDir)
    break

  case 'all':
    generateAllFixtures(outputDir)
    break

  default:
    console.log('Vultisig SDK Fixture Generator')
    console.log('')
    console.log('Usage:')
    console.log('  yarn generate-fixtures chain <chain-name>   - Generate fixtures for one chain')
    console.log('  yarn generate-fixtures tier <tier1|2|3>     - Generate fixtures for a tier')
    console.log('  yarn generate-fixtures all                  - Generate all fixtures')
    console.log('')
    console.log('Examples:')
    console.log('  yarn generate-fixtures chain bitcoin')
    console.log('  yarn generate-fixtures tier tier1')
    console.log('  yarn generate-fixtures all')
    break
}
