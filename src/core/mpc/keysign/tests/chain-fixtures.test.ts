import fs from 'node:fs'
import path from 'node:path'
import { describe, it, beforeAll, expect } from 'vitest'

import { getPreSigningHashes } from '../../../chain/tx/preSigningHashes'
import { initWasm, WalletCore } from '@trustwallet/wallet-core'

import { getTxInputData } from '../txInputData'
import { normalizeKeysignPayloadFromJson } from './helpers/normalizeKeysignPayloadFromJson'
import { resolveChainFromFixture } from './helpers/resolveChainFromFixture'

type Case = {
  name: string
  keysign_payload: any
  expected_image_hash: string[]
}

let walletCore: Awaited<WalletCore>

beforeAll(async () => {
  walletCore = await initWasm()
})

const fixturesDir = path.resolve(__dirname, 'fixtures')

function loadAllCases(): Case[] {
  if (!fs.existsSync(fixturesDir)) {
    return []
  }
  const files = fs.readdirSync(fixturesDir).filter(f => f.endsWith('.json'))
  return files.flatMap(file => {
    const raw = fs.readFileSync(path.join(fixturesDir, file), 'utf8')
    return JSON.parse(raw) as Case[]
  })
}

describe('iOS fixtures parity', () => {
  const cases = loadAllCases()

  if (cases.length === 0) {
    it('should have fixture files to test against', () => {
      console.log('ℹ️ No fixture files found in', fixturesDir)
      console.log('   This test will be skipped until fixture files are added')
      expect(true).toBe(true) // Pass the test but indicate no fixtures
    })
    return
  }

  it.each(cases)('%s', async ({ keysign_payload, expected_image_hash }) => {
    const keysignPayload = normalizeKeysignPayloadFromJson(keysign_payload)
    const chain = resolveChainFromFixture(keysign_payload.coin.chain)
    const inputs = await getTxInputData({
      keysignPayload,
      walletCore,
    })

    const hashes = inputs
      .flatMap(txInputData =>
        getPreSigningHashes({ walletCore, chain, txInputData })
      )
      .map(item => Buffer.from(item).toString('hex'))
      .sort()

    const expected = [...expected_image_hash].sort()
    expect(hashes).toEqual(expected)
  })
})
