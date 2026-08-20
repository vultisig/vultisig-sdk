import { Buffer } from 'buffer'
import { readdirSync, readFileSync } from 'fs'
import { basename, join } from 'path'

import { blake2b } from '@noble/hashes/blake2b'
import { Chain, UtxoChain } from '@vultisig/core-chain/Chain'
import { initWasm, type WalletCore } from '@trustwallet/wallet-core'
import { beforeAll, describe, expect, it } from 'vitest'

import { getEncodedSigningInputs } from '../signingInputs'
import { getPreSigningHashes } from '../../tx/preSigningHashes'
import { normalizeKeysignPayloadFromJson } from './helpers/normalizeKeysignPayloadFromJson'
import { resolveChainFromFixture } from './helpers/resolveChainFromFixture'

type MobileFixtureCase = {
  name: string
  keysign_payload: unknown
  expected_image_hash: string[]
}

type LoadedFixtureCase = MobileFixtureCase & {
  fixtureFile: string
}

const fixturesDir = join(__dirname, 'fixtures/mobile')

const toHex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')

const getCardanoEnterpriseAddress = ({
  spendingKeyHex,
  walletCore,
}: {
  spendingKeyHex: string
  walletCore: WalletCore
}) => {
  const spendingKey = Buffer.from(spendingKeyHex, 'hex')
  if (spendingKey.length !== 32) {
    throw new Error(`Cardano fixture spending key must be 32 bytes, got ${spendingKey.length}`)
  }

  const addressData = new Uint8Array(29)
  addressData[0] = 0x61
  addressData.set(blake2b(spendingKey, { dkLen: 28 }), 1)

  return walletCore.Bech32.encode('addr', addressData)
}

const loadFixtureCases = (): LoadedFixtureCase[] =>
  readdirSync(fixturesDir)
    .filter(file => file.endsWith('.json'))
    .sort()
    .flatMap(file => {
      const fixturePath = join(fixturesDir, file)
      const cases = JSON.parse(readFileSync(fixturePath, 'utf8')) as MobileFixtureCase[]

      return cases.map(testCase => ({
        ...testCase,
        fixtureFile: file,
      }))
    })

const cases = loadFixtureCases()

const compareHashesAsSet = ({ chain, fixtureFile }: { chain: Chain; fixtureFile: string }) =>
  Object.values(UtxoChain).includes(chain as UtxoChain) || basename(fixtureFile) === 'mayaswap.json'

describe('mobile keysign pre-image hash golden fixtures', () => {
  let walletCore: WalletCore

  beforeAll(async () => {
    walletCore = await initWasm()
  })

  it(`loads the recovered Android/iOS fixture corpus (${cases.length} cases)`, () => {
    expect(cases.length).toBe(71)
    expect(new Set(cases.map(({ fixtureFile }) => fixtureFile)).size).toBe(23)
  })

  for (const testCase of cases) {
    const label = `${testCase.fixtureFile}: ${testCase.name}`

    it(label, async () => {
      const payload = normalizeKeysignPayloadFromJson(testCase.keysign_payload)
      const chain = resolveChainFromFixture(payload.coin?.chain ?? '')

      if (chain === Chain.Cardano) {
        const address = getCardanoEnterpriseAddress({
          spendingKeyHex: payload.coin?.hexPublicKey ?? '',
          walletCore,
        })
        if (payload.coin) {
          payload.coin.address = address
        }
        payload.toAddress = address
      }

      const signingInputs = await getEncodedSigningInputs({
        keysignPayload: payload,
        walletCore,
      })
      const actual = signingInputs.flatMap(input =>
        getPreSigningHashes({
          walletCore,
          chain,
          txInputData: input,
          keysignPayload: payload,
        }).map(toHex)
      )

      if (testCase.expected_image_hash.length === 0) {
        expect(actual).toHaveLength(1)
        expect(actual[0]).toMatch(/^[0-9a-f]{64}$/)
        return
      }

      const sortsHashes = compareHashesAsSet({ chain, fixtureFile: testCase.fixtureFile })
      const actualForAssert = sortsHashes ? [...actual].sort() : actual
      const expected = sortsHashes ? [...testCase.expected_image_hash].sort() : testCase.expected_image_hash

      expect(actualForAssert).toEqual(expected)
    })
  }
})
