import { create, toBinary } from '@bufbuild/protobuf'
import { KeygenMessageSchema } from '@vultisig/core-mpc/types/vultisig/keygen/v1/keygen_message_pb'
import { LibType } from '@vultisig/core-mpc/types/vultisig/keygen/v1/lib_type_message_pb'
import { describe, expect, it, vi } from 'vitest'

import { parseKeygenQR } from '../../../src/utils/parseKeygenQR'

/** Minimal valid KeygenMessage; decompress is mocked to return this payload. */
const validKeygenBinary = toBinary(
  KeygenMessageSchema,
  create(KeygenMessageSchema, {
    sessionId: 'sess-parse-test',
    hexChainCode: 'cc'.repeat(32),
    serviceName: 'initiator-party',
    encryptionKeyHex: 'ee'.repeat(32),
    useVultisigRelay: true,
    vaultName: 'Test Vault',
    libType: LibType.DKLS,
    chains: [],
  })
)

const mockSevenZip = {
  FS: {
    writeFile: vi.fn(),
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

function qrWithQuery(tssBatchingPart: string): string {
  const jsonData = encodeURIComponent('YWFh')
  return `vultisig://?type=NewVault&tssType=Keygen&jsonData=${jsonData}${tssBatchingPart}`
}

describe('parseKeygenQR — tssBatching query propagation', () => {
  it('leaves tssBatching undefined when the query param is absent', async () => {
    const parsed = await parseKeygenQR(qrWithQuery(''))
    expect(parsed.tssBatching).toBeUndefined()
  })

  it('sets tssBatching true when tssBatching=1', async () => {
    const parsed = await parseKeygenQR(qrWithQuery('&tssBatching=1'))
    expect(parsed.tssBatching).toBe(true)
  })

  it('sets tssBatching false when tssBatching is present but not 1', async () => {
    const parsed = await parseKeygenQR(qrWithQuery('&tssBatching=0'))
    expect(parsed.tssBatching).toBe(false)
  })

  it('treats only the literal 1 as true (other truthy strings are false)', async () => {
    expect((await parseKeygenQR(qrWithQuery('&tssBatching=yes'))).tssBatching).toBe(false)
    expect((await parseKeygenQR(qrWithQuery('&tssBatching=true'))).tssBatching).toBe(false)
  })

  it('still parses core protobuf fields when batching flag is set', async () => {
    const parsed = await parseKeygenQR(qrWithQuery('&tssBatching=1'))
    expect(parsed.sessionId).toBe('sess-parse-test')
    expect(parsed.libType).toBe('DKLS')
    expect(parsed.vaultName).toBe('Test Vault')
  })
})
