import { randomBytes } from 'crypto'

import { create } from '@bufbuild/protobuf'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { uploadPayloadToServer } from '@vultisig/core-mpc/keygen/server/uploadPayloadToServer'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'

import { getJoinKeysignUrl } from './getJoinKeysignUrl'

vi.mock('@vultisig/core-mpc/keygen/server/uploadPayloadToServer', () => ({
  uploadPayloadToServer: vi.fn().mockResolvedValue('uploaded-payload-id'),
}))

describe('getJoinKeysignUrl', () => {
  const customRelayUrl = 'https://relay.example.test/router'
  const baseParams = {
    serverType: 'relay' as const,
    serverUrl: customRelayUrl,
    serviceName: 'sdk-party',
    sessionId: 'session-id',
    hexEncryptionKey: 'a'.repeat(64),
    vaultId: 'vault-public-key',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('includes a custom relay URL in the signing deep link', async () => {
    const qrUrl = await getJoinKeysignUrl(baseParams)

    const url = new URL(qrUrl)
    expect(url.searchParams.get('type')).toBe('SignTransaction')
    expect(url.searchParams.get('serverUrl')).toBe(customRelayUrl)
  })

  it('uploads oversized payloads to the custom relay URL', async () => {
    const payload = create(KeysignPayloadSchema, {
      toAddress: `0x${randomBytes(5000).toString('hex')}`,
      toAmount: '1',
    })

    const qrUrl = await getJoinKeysignUrl({
      ...baseParams,
      payload: { keysign: payload },
    })

    expect(uploadPayloadToServer).toHaveBeenCalledWith({
      payload: expect.any(String),
      serverUrl: customRelayUrl,
    })
    expect(new URL(qrUrl).searchParams.get('serverUrl')).toBe(customRelayUrl)
  })
})
