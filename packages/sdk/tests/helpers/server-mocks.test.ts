import { beforeEach, describe, expect, it } from 'vitest'

import {
  assertEndpointCalled,
  createFailingServerMock,
  createVultisigServerMock,
  getServerMockCallHistory,
  mockEmailVerificationResponse,
  mockRelayParticipants,
  mockVaultCreationResponse,
} from './server-mocks'

describe('Server Mocks', () => {
  let mockFetch: ReturnType<typeof createVultisigServerMock>

  beforeEach(() => {
    mockFetch = createVultisigServerMock()
    global.fetch = mockFetch as any
  })

  describe('createVultisigServerMock()', () => {
    it('should mock vault creation endpoint', async () => {
      const response = await fetch('https://api.vultisig.com/vault', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test Vault' }),
      })

      expect(response.ok).toBe(true)
      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data).toHaveProperty('session_id')
      expect(data).toHaveProperty('service_id')
      expect(data.status).toBe('pending')
    })

    it('should mock email verification endpoint', async () => {
      const response = await fetch(
        'https://api.vultisig.com/vault/verify/test-vault-id/123456',
        { method: 'GET' }
      )

      expect(response.ok).toBe(true)
      const data = await response.json()
      expect(data.status).toBe('verified')
      expect(data.verified).toBe(true)
    })

    it('should mock message relay participant list', async () => {
      const response = await fetch(
        'https://api.vultisig.com/router/session-123',
        { method: 'GET' }
      )

      expect(response.ok).toBe(true)
      const data = await response.json()
      expect(Array.isArray(data)).toBe(true)
      expect(data.length).toBeGreaterThan(0)
    })

    it('should mock health check endpoint', async () => {
      const response = await fetch('https://api.vultisig.com/ping')

      expect(response.ok).toBe(true)
      const data = await response.json()
      expect(data.status).toBe('healthy')
    })

    it('should return 404 for unknown endpoints', async () => {
      const response = await fetch('https://api.vultisig.com/unknown')

      expect(response.ok).toBe(false)
      expect(response.status).toBe(404)
    })
  })

  describe('createFailingServerMock()', () => {
    it('should throw network error', async () => {
      const failingMock = createFailingServerMock('network')
      global.fetch = failingMock as any

      await expect(fetch('https://api.vultisig.com/vault')).rejects.toThrow(
        'Network request failed'
      )
    })

    it('should return 500 error', async () => {
      const failingMock = createFailingServerMock('500')
      global.fetch = failingMock as any

      const response = await fetch('https://api.vultisig.com/vault')
      expect(response.status).toBe(500)
    })
  })

  describe('Helper functions', () => {
    it('mockVaultCreationResponse should return valid structure', () => {
      const response = mockVaultCreationResponse()

      expect(response).toHaveProperty('session_id')
      expect(response).toHaveProperty('service_id')
      expect(response.status).toBe('pending')
    })

    it('mockEmailVerificationResponse should return verified status', () => {
      const verified = mockEmailVerificationResponse(true)
      expect(verified.verified).toBe(true)
      expect(verified.status).toBe('verified')

      const pending = mockEmailVerificationResponse(false)
      expect(pending.verified).toBe(false)
      expect(pending.status).toBe('pending')
    })

    it('mockRelayParticipants should return participant list', () => {
      const participants = mockRelayParticipants('client-123', true)

      expect(Array.isArray(participants)).toBe(true)
      expect(participants).toContain('client-123')
      expect(participants.some(p => p.startsWith('Server-'))).toBe(true)
    })
  })

  describe('Assertion helpers', () => {
    it('assertEndpointCalled should verify endpoint was called', async () => {
      await fetch('https://api.vultisig.com/vault', { method: 'POST' })
      await fetch('https://api.vultisig.com/vault', { method: 'POST' })

      expect(() => {
        assertEndpointCalled(mockFetch, '/vault', 'POST', 2)
      }).not.toThrow()
    })

    it('assertEndpointCalled should throw if endpoint not called', () => {
      expect(() => {
        assertEndpointCalled(mockFetch, '/never-called', 'GET')
      }).toThrow('never called')
    })

    it('getServerMockCallHistory should return call information', async () => {
      await fetch('https://api.vultisig.com/vault', { method: 'POST' })
      await fetch('https://api.vultisig.com/ping')

      const history = getServerMockCallHistory(mockFetch)

      expect(history.totalCalls).toBe(2)
      expect(history.calls).toHaveLength(2)
      expect(history.calls[0].url).toContain('/vault')
      expect(history.calls[0].method).toBe('POST')
      expect(history.calls[1].url).toContain('/ping')
    })
  })
})
