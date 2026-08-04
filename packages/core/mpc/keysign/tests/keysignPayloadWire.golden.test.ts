import { Buffer } from 'buffer'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

import { toBinary } from '@bufbuild/protobuf'
import { describe, expect, it } from 'vitest'

import { KeysignPayloadSchema } from '../../types/vultisig/keysign/v1/keysign_message_pb'
import { normalizeKeysignPayloadFromJson } from './helpers/normalizeKeysignPayloadFromJson'

type MobileFixtureCase = {
  name: string
  keysign_payload: unknown
}

type LoadedFixtureCase = MobileFixtureCase & {
  fixtureFile: string
}

const fixturesDir = join(__dirname, 'fixtures/mobile')

const fixtureCases: LoadedFixtureCase[] = readdirSync(fixturesDir)
  .filter(file => file.endsWith('.json'))
  .sort()
  .flatMap(file => {
    const cases = JSON.parse(readFileSync(join(fixturesDir, file), 'utf8')) as MobileFixtureCase[]

    return cases.map(testCase => ({
      ...testCase,
      fixtureFile: file,
    }))
  })

const serializeFixture = (testCase: LoadedFixtureCase) => {
  try {
    return toBinary(KeysignPayloadSchema, normalizeKeysignPayloadFromJson(testCase.keysign_payload))
  } catch (error) {
    throw new Error(`Failed to serialize ${testCase.fixtureFile}: ${testCase.name}`, { cause: error })
  }
}

const stakeRujiWireHex =
  '0a98010a0954484f52436861696e120452554a491a2b74686f723138616c74707832677774346334656a7235757a6461346b797a737564796e39713536666e6e672206782f72756a692808320472756e6542423032336534623736383631323839616434353238623333633266643231623361353136306364333762333239343233343931346532316566623665643461343532624a0452554a49123f74686f7231336738336e6e35656634717a716561667030353038646e766b766d307a717233736a37656566636e35756d75363567716c757573726d6c3563721a0731303030303030320e08c0c407100118c09a0c20012808aa0113626f6e643a782f72756a693a31303030303030fa01423032336534623736383631323839616434353238623333633266643231623361353136306364333762333239343233343931346532316566623665643461343532628a0204444b4c539a02a0010a2b74686f723138616c74707832677774346334656a7235757a6461346b797a737564796e39713536666e6e67123f74686f7231336738336e6e35656634717a716561667030353038646e766b766d307a717233736a37656566636e35756d75363567716c757573726d6c3563721a1d7b20226163636f756e74223a207b2022626f6e64223a207b7d207d207d22110a06782f72756a69120731303030303030'

describe('KeysignPayload protobuf wire contract', () => {
  it('serializes the complete mobile fixture corpus', () => {
    const serialized = fixtureCases.map(serializeFixture)

    expect(serialized).toHaveLength(71)
    expect(serialized.every(bytes => bytes.length > 0)).toBe(true)
  })

  it('pins the exact wire bytes of a rich mobile fixture', () => {
    const testCase = fixtureCases.find(
      ({ fixtureFile, name }) => fixtureFile === 'thorchain.json' && name === 'Stake Ruji'
    )

    expect(testCase).toBeDefined()
    expect(Buffer.from(serializeFixture(testCase!)).toString('hex')).toBe(stakeRujiWireHex)
  })
})
