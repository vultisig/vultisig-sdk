import { randomBytes } from 'crypto'

import { create, fromBinary } from '@bufbuild/protobuf'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getSevenZip } from '@vultisig/core-mpc/compression/getSevenZip'
import { uploadPayloadToServer } from '@vultisig/core-mpc/keygen/server/uploadPayloadToServer'
import { CustomMessagePayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/custom_message_payload_pb'
import {
  KeysignMessageSchema,
  KeysignPayloadSchema,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'

import { getJoinKeysignUrl } from './getJoinKeysignUrl'

vi.mock('@vultisig/core-mpc/keygen/server/uploadPayloadToServer', () => ({
  uploadPayloadToServer: vi.fn().mockResolvedValue('uploaded-payload-id'),
}))

const decompress = async (base64: string) => {
  const sevenZip = await getSevenZip()
  sevenZip.FS.writeFile('data.xz', Buffer.from(base64, 'base64'))
  sevenZip.callMain(['x', 'data.xz', '-y'])
  const data = sevenZip.FS.readFile('data')
  // The module is a shared singleton; a leftover file would mask a failed extraction.
  sevenZip.FS.unlink('data')
  sevenZip.FS.unlink('data.xz')

  return data
}

// The link carries raw base64, so URLSearchParams would turn its `+` into spaces.
const keysignMessageFrom = async (qrUrl: string) => {
  const jsonData = qrUrl.match(/[?&]jsonData=([^&]+)/)?.[1]
  if (!jsonData) throw new Error('Link has no jsonData')

  return fromBinary(KeysignMessageSchema, await decompress(jsonData))
}

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

  describe('custom message dApp metadata', () => {
    const dappMetadata = {
      name: 'Polymarket',
      url: 'https://polymarket.com',
      iconUrl: 'https://polymarket.com/favicon.ico',
    }

    it('embeds it in the link when the payload fits', async () => {
      const payload = create(CustomMessagePayloadSchema, {
        method: 'personal_sign',
        message: '0x48656c6c6f',
        dappMetadata,
      })

      const qrUrl = await getJoinKeysignUrl({ ...baseParams, payload: { custom: payload } })

      expect(uploadPayloadToServer).not.toHaveBeenCalled()
      const { customMessagePayload } = await keysignMessageFrom(qrUrl)
      expect(customMessagePayload?.dappMetadata).toMatchObject(dappMetadata)
    })

    it('keeps it on the standalone payload uploaded to the relay when the link would be too long', async () => {
      const payload = create(CustomMessagePayloadSchema, {
        method: 'personal_sign',
        message: `0x${randomBytes(5000).toString('hex')}`,
        dappMetadata,
      })

      const qrUrl = await getJoinKeysignUrl({ ...baseParams, payload: { custom: payload } })

      expect(uploadPayloadToServer).toHaveBeenCalledTimes(1)
      const [{ payload: uploaded }] = vi.mocked(uploadPayloadToServer).mock.calls[0]
      const decoded = fromBinary(CustomMessagePayloadSchema, await decompress(uploaded))
      expect(decoded.message).toBe(payload.message)
      expect(decoded.dappMetadata).toMatchObject(dappMetadata)

      const keysignMessage = await keysignMessageFrom(qrUrl)
      expect(keysignMessage.customPayloadId).toBe('uploaded-payload-id')
      expect(keysignMessage.customMessagePayload).toBeUndefined()
    })
  })
})
