import { Buffer } from 'buffer'
import { createHash } from 'crypto'
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

const fixtureFiles = readdirSync(fixturesDir)
  .filter(file => file.endsWith('.json'))
  .sort()

const fixtureCases: LoadedFixtureCase[] = fixtureFiles.flatMap(file => {
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

// Length-prefixes each payload before hashing so the digest is sensitive to
// where one payload ends and the next begins (not just their concatenation).
const digestOfSerializedCorpus = (payloads: Uint8Array[]) => {
  const hash = createHash('sha256')

  payloads.forEach(bytes => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(bytes.length)
    hash.update(length)
    hash.update(Buffer.from(bytes))
  })

  return hash.digest('hex')
}

const stakeRujiWireHex =
  '0a98010a0954484f52436861696e120452554a491a2b74686f723138616c74707832677774346334656a7235757a6461346b797a737564796e39713536666e6e672206782f72756a692808320472756e6542423032336534623736383631323839616434353238623333633266643231623361353136306364333762333239343233343931346532316566623665643461343532624a0452554a49123f74686f7231336738336e6e35656634717a716561667030353038646e766b766d307a717233736a37656566636e35756d75363567716c757573726d6c3563721a0731303030303030320e08c0c407100118c09a0c20012808aa0113626f6e643a782f72756a693a31303030303030fa01423032336534623736383631323839616434353238623333633266643231623361353136306364333762333239343233343931346532316566623665643461343532628a0204444b4c539a02a0010a2b74686f723138616c74707832677774346334656a7235757a6461346b797a737564796e39713536666e6e67123f74686f7231336738336e6e35656634717a716561667030353038646e766b766d307a717233736a37656566636e35756d75363567716c757573726d6c3563721a1d7b20226163636f756e74223a207b2022626f6e64223a207b7d207d207d22110a06782f72756a69120731303030303030'

// Corpus-wide wire-format pin: a sha256 digest computed over every fixture's
// serialized bytes (length-prefixed, in the fixed fixtureFiles order), plus a
// per-fixture-file digest so a mismatch narrows straight to the offending
// fixture file instead of just "something in the corpus changed". Any change
// to serializer-path code (e.g. normalizeKeysignPayloadFromJson,
// mapSwapPayload) that alters wire bytes for ANY fixture - not just the one
// rich fixture pinned below - will fail here.
const expectedCorpusDigest = 'fda94444dfb5a9c55cef8b0531961ff66d45b50fad1b3e79b734aedf194118a3'

const expectedPerFileDigests: Record<string, string> = {
  'arb.json': 'b11f8989372fd8a51909c37b5da0d79138a647359685b916a2e905973d585e1f',
  'bittensor.json': '5ea72af2b407caf4edc58daaf37fb414853aee1c38b99c7d8ddbc1c65ec73c74',
  'bsc.json': '123820d49abf4400c28d42789d9f5aee1191bd06ec5010cc800c360d53efbfb9',
  'cardano.json': '9b6946664b8c02fe093bddfe12b8755eb5d17af14c50279bb7856aafa3adf1f6',
  'cosmos-chain-matrix.json': 'dfab960ec87c6ef0f5d2524519ac66ef5921d2953de2844b17a8f470d4df34dc',
  'cosmos-sdk-sign-amino.json': '18b4811f7b03e6026c409445f1a37fc63a107842e15091de5af4f55e4c0c1a84',
  'cosmos-sdk-sign-direct.json': '658ce08b15e5f3d9fb0688ea44a93819064bcf1d3f7a996f435e1f73b607bd25',
  'cosmos.json': 'ec8f609e3ef9534f51fb03c3646787ca7df758ba1e0932d81c290c121f415f28',
  'dot.json': 'af6442b0a6125d1681bd4aae90e660b602670da67f16af18108ce4640fb8d824',
  'evm-chain-matrix.json': '4e2619390c7ca2f8bf584b02c2880e4e42d21aaa855726d5c60e33d319e8b1d8',
  'evm.json': '3b61ed0c368f8afbae14536f45c18c24af8bcd726a3b0b048f2ca257025da216',
  'lifiswap.json': 'ed5b2c7c2626d70d31055996e756fedc45a654c3f3455f1e78ef35c406abc546',
  'maya.json': 'c7ee0a247cec74133b02b055f2a0702bacb59fc1726c2da236ff5b3f2ae0637a',
  'mayaswap.json': 'f9599bc5efca0d9c41432dc634554de4a72d7748d9322448803d5cc730c3390f',
  'pol.json': 'aa7b14a348278e1643b91c0867ea86cc18d957462925b6acdf75ba0b46eca692',
  'qbtc.json': '786e2604a16df4e98d6ceca1600ac61642da3dba6459820779df92b8676ece4b',
  'sei.json': '17735eac74aeb8cc2875fdb313171a4edc806279b825f14f5f1dec19b107f6f8',
  'solana-sign-data.json': 'bda741f10fa685f826efaf940808f2b42f600ae74fbf5dce972adbf85fc0faf9',
  'solana.json': '23dcfaa798ad22c8a2dff994aee8e95dd1f341f41079cf83ad0768c7fb106cff',
  'sui.json': 'd7180a0b499cb3fcde9261d8af68fdbba9a0a18720468f07c6a918583687cd10',
  'tcy.json': 'daf02668aebb3e20c83d1c97f49d5c6ae5f6a1f582b9ede0dde3a87af9c0db99',
  'terra.json': '2e5ff8bc01a57a040259b0786741ad8f43de691d05dc0205e0adac70fc23423a',
  'thorchain.json': 'a0977a61b4ff18c658d12f80db97eac23a183b45fdc9bdc6e410a0304297f040',
  'thorchainswap-limit-order.json': 'af3cc397c771205997adf0a22428b9622c796dc55d27aca0f5cf3ff3d1319b9f',
  'thorchainswap.json': '01b8c4ec266f5e4f5ad542c2f417bcf11279a5dae011cc7f186b7ffd73db80dd',
  'ton.json': 'ea54f2cfa7107549ee9ee4f26d2bcf11d41bfecbd1c0186ec441047cf63c901d',
  'tron.json': '0e3417c4f955b4205123b5543f14a69887b35fec7113bdba0581fe5367467494',
  'utxo-dash-zcash.json': 'da41de2fed8d6ea3da57752a47fc311ff560d671e7661565c0b6e94238a60e17',
  'utxo.json': 'b819fb70f391c42578cfc506dd008510af5d8f882809ac35415ff18fd624fa9a',
  'xrp.json': 'ccf00ff50c5cecf5a9b5d333757539b2e3462c4b11b5e63660e942f8f1b6fc93',
}

describe('KeysignPayload protobuf wire contract', () => {
  it('serializes the complete mobile fixture corpus', () => {
    const serialized = fixtureCases.map(serializeFixture)

    expect(serialized).toHaveLength(90)
    expect(serialized.every(bytes => bytes.length > 0)).toBe(true)
  })

  it('pins the exact wire bytes of a rich mobile fixture', () => {
    const testCase = fixtureCases.find(
      ({ fixtureFile, name }) => fixtureFile === 'thorchain.json' && name === 'Stake Ruji'
    )

    expect(testCase).toBeDefined()
    expect(Buffer.from(serializeFixture(testCase!)).toString('hex')).toBe(stakeRujiWireHex)
  })

  it('pins the wire-format digest of the full fixture corpus', () => {
    const serialized = fixtureCases.map(serializeFixture)

    expect(digestOfSerializedCorpus(serialized)).toBe(expectedCorpusDigest)
  })

  it.each(fixtureFiles)('pins the wire-format digest of %s', file => {
    const serialized = fixtureCases.filter(testCase => testCase.fixtureFile === file).map(serializeFixture)

    expect(digestOfSerializedCorpus(serialized)).toBe(expectedPerFileDigests[file])
  })
})
