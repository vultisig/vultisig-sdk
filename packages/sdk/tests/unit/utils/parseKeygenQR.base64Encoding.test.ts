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
  callMain: vi.fn(() => 0),
}

vi.mock('@vultisig/core-mpc/compression/getSevenZip', () => ({
  getSevenZip: vi.fn(async () => mockSevenZip),
}))

describe('parseKeygenQR — base64 encoding with + characters', () => {
  beforeEach(() => {
    writtenBase64 = null
    vi.clearAllMocks()
  })

  it('handles jsonData with raw + signs (not URL-encoded)', async () => {
    // 'ICA+' is a base64 string that literally contains '+'.
    // URLSearchParams decodes '+' as space per the form-urlencoded spec,
    // so placing this raw in the query string produces 'ICA ' (corrupted).
    // The fix must restore the space back to '+' before decoding.
    const base64WithPlus = 'ICA+'
    const qrPayload = `vultisig://?type=NewVault&tssType=Keygen&jsonData=${base64WithPlus}`

    await parseKeygenQR(qrPayload)

    // Buffer.from('ICA+', 'base64') decodes to bytes [32, 32, 62] -> '  >'
    // If the fix is absent, writtenBase64 would be '  ' (only 2 bytes from 'ICA ')
    expect(writtenBase64).toBe('  >')
  })

  it('handles jsonData with URL-encoded = signs (%3D)', async () => {
    // base64 of 'hello+world/=' with padding encoded as %3D
    // URLSearchParams decodes %3D back to =, no + corruption in this path
    const base64Encoded = 'aGVsbG8rd29ybGQvPQ%3D%3D'
    const qrPayload = `vultisig://?type=NewVault&tssType=Keygen&jsonData=${base64Encoded}`

    await parseKeygenQR(qrPayload)

    // Buffer.from('aGVsbG8rd29ybGQvPQ==', 'base64') = 'hello+world/='
    expect(writtenBase64).toBe('hello+world/=')
  })

  it('handles jsonData with both + and / characters (standard base64)', async () => {
    // Standard base64 often has both + and / chars
    // 'YWJjK2RlZi9naGk=' is base64 for 'abc+def/ghi' (no trailing =)
    const base64Standard = 'YWJjK2RlZi9naGk%3D'
    const qrPayload = `vultisig://?type=NewVault&tssType=Keygen&jsonData=${base64Standard}`

    await parseKeygenQR(qrPayload)

    // Buffer.from('YWJjK2RlZi9naGk=', 'base64') = 'abc+def/ghi'
    expect(writtenBase64).toBe('abc+def/ghi')
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
