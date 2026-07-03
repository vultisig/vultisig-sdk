import { beforeEach, describe, expect, it, vi } from 'vitest'

import { waitForRelayPeerCommittee } from '../../../src/services/waitForRelayPeerCommittee'
import { VaultErrorCode } from '../../../src/vault/VaultError'

const queryUrlMock = vi.hoisted(() => vi.fn())

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: (...args: unknown[]) => queryUrlMock(...args),
}))

describe('waitForRelayPeerCommittee', () => {
  beforeEach(() => {
    queryUrlMock.mockReset()
  })

  it('returns the sorted committee when exactly the required devices joined', async () => {
    queryUrlMock.mockResolvedValue(['device-b', 'device-a', 'device-a'])

    await expect(
      waitForRelayPeerCommittee({
        relayUrl: 'https://relay.example',
        sessionId: 'session-1',
        requiredDevices: 2,
        createTimeoutError: () => new Error('timed out'),
      })
    ).resolves.toEqual(['device-a', 'device-b'])

    expect(queryUrlMock).toHaveBeenCalledWith('https://relay.example/session-1')
  })

  it('rejects oversized committees instead of returning ghost peers', async () => {
    queryUrlMock.mockResolvedValue(['device-a', 'device-b', 'device-c'])

    await expect(
      waitForRelayPeerCommittee({
        relayUrl: 'https://relay.example',
        sessionId: 'session-1',
        requiredDevices: 2,
        createTimeoutError: () => new Error('timed out'),
      })
    ).rejects.toMatchObject({
      code: VaultErrorCode.NetworkError,
      message: 'Too many devices joined. Got 3/2 devices.',
    })
  })
})
