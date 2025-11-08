#!/usr/bin/env node
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const FIXTURES_DIR = path.join(
  __dirname,
  '../packages/sdk/tests/fixtures/chains'
)

async function validateFixtures() {
  const requiredFiles = [
    'addresses.json',
    'transactions.json',
    'balances.json',
    'rpc-responses.json',
  ]

  try {
    const chainDirs = await fs.readdir(FIXTURES_DIR)
    let errors = 0

    for (const chainDir of chainDirs) {
      const chainPath = path.join(FIXTURES_DIR, chainDir)
      const stats = await fs.stat(chainPath)

      if (!stats.isDirectory()) continue

      console.log(`Validating ${chainDir}...`)

      for (const file of requiredFiles) {
        const filePath = path.join(chainPath, file)

        try {
          const content = await fs.readFile(filePath, 'utf-8')
          JSON.parse(content) // Validate JSON
          console.log(`  ✓ ${file}`)
        } catch (error) {
          console.error(`  ✗ ${file}: ${error.message}`)
          errors++
        }
      }
    }

    if (errors > 0) {
      console.error(`\n❌ Found ${errors} fixture validation errors`)
      process.exit(1)
    }

    console.log('\n✅ All fixtures are valid')
  } catch (error) {
    console.error('Validation failed:', error)
    process.exit(1)
  }
}

validateFixtures()
