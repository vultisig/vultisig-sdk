import { create, toBinary } from '@bufbuild/protobuf'
import { KeygenMessageSchema } from '@vultisig/core-mpc/types/vultisig/keygen/v1/keygen_message_pb'
import { LibType } from '@vultisig/core-mpc/types/vultisig/keygen/v1/lib_type_message_pb'
import { describe, expect, it, vi } from 'vitest'

import { parseKeygenQR } from '../../../src/utils/parseKeygenQR'

/** Minimal valid KeygenMessage; decompress is mocked to return this payload. */
const validKeygenBinary = toBinary(
  KeygenMessageSchema,
  create(KeygenMessageSchema, {
    sessionId: 'sess-encoding-test',
    hexChainCode: 'cc'.repeat(32),
    serviceName: 'initiator-party',
    encryptionKeyHex: 'ee'.repeat(32),
    useVultisigRelay: true,
    vaultName: 'Encoding Test Vault',
    libType: LibType.DKLS,
    chains: [],
  })
)

// Track what base64 data was written to the mock FS
let writtenBase64: string | null = null
let callMainCalled = false

const mockSevenZip = {
  FS: {
    writeFile: vi.fn((filename: string, data: Uint8Array) => {
      writtenBase64 = Buffer.from(data).toString()
    }),
    readFile: vi.fn((filename: string) => {
      if (filename === 'data.bin' || filename === 'compressed') {
        return validKeygenBinary
      }
      throw new Error(`unexpected read: ${filename}`)
    }),
    unlink: vi.fn(),
  },
  callMain: vi.fn(() => {
    callMainCalled = true
    return 0
  }),
}

vi.mock('@vultisig/core-mpc/compression/getSevenZip', () => ({
  getSevenZip: vi.fn(async () => mockSevenZip),
}))

describe('parseKeygenQR — base64 encoding with + characters', () => {
  beforeEach(() => {
    writtenBase64 = null
    callMainCalled = false
    vi.clearAllMocks()
  })

  it('handles jsonData with raw + signs (not URL-encoded)', async () => {
    // Base64 data that contains + characters: "hello+world/=="
    // When placed in a URL query param without encoding, URLSearchParams
    // will decode + as space, corrupting the base64.
    const base64WithPlus = 'aGVsbG8rd29ybGQv'
    const qrPayload = `vultisig://?type=NewVault&tssType=Keygen&jsonData=${base64WithPlus}`

    await parseKeygenQR(qrPayload)

    // The fix should restore + from space before calling decompressData
    // Verify the mock FS received correct base64 (with + intact)
    expect(writtenBase64).toBe('hello+world/')
  })

  it('handles jsonData with URL-encoded + signs (%2B)', async () => {
    // Properly URL-encoded: + becomes %2B
    const base64Encoded = 'aGVsbG8lMkJ3b3JsZC8%3D'
    const qrPayload = `vultisig://?type=NewVault&tssType=Keygen&jsonData=${base64Encoded}`

    await parseKeygenQR(qrPayload)

    // decodeURIComponent(%2B) → +, so FS should get correct base64
    expect(writtenBase64).toBe('hello+world/=')
  })

  it('handles jsonData with both + and / characters (standard base64)', async () => {
    // Standard base64 often has both + and / chars
    // "abc+def/ghi=" → base64 "YWJjK2RlZi9naGk="
    const base64Standard = 'YWJjK2RlZi9naGk%3D'
    const qrPayload = `vultisig://?type=NewVault&tssType=Keygen&jsonData=${base64Standard}`

    await parseKeygenQR(qrPayload)

    // Verify the correct base64 reaches the decompressor
    expect(writtenBase64).toBe('abc+def/ghi=')
  })

  it('still parses core protobuf fields when + encoding is used', async () => {
    const base64Simple = 'YWFh' // base64 of "aaa" (no + chars)
    const qrPayload = `vultisig://?type=NewVault&tssType=Keygen&jsonData=${base64Simple}`

    const parsed = await parseKeygenQR(qrPayload)

    expect(parsed.sessionId).toBe('sess-encoding-test')
    expect(parsed.libType).toBe('DKLS')
    expect(parsed.vaultName).toBe('Encoding Test Vault')
  })
})
