import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PushNotificationService } from '../../../src/services/PushNotificationService'
import { MemoryStorage } from '../../../src/storage/MemoryStorage'
import type { SigningNotification, WSConnectionState } from '../../../src/types/notifications'

const SERVER_URL = 'https://api.vultisig.com/notification'

/**
 * Mock WebSocket for testing. Simulates the browser WebSocket API.
 */
class MockWebSocket {
  static instances: MockWebSocket[] = []

  url: string
  readyState = 0 // CONNECTING
  onopen: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  sentMessages: string[] = []

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sentMessages.push(data)
  }

  close() {
    this.readyState = 3 // CLOSED
    this.onclose?.({ code: 1000, reason: '', wasClean: true } as CloseEvent)
  }

  // Test helpers
  simulateOpen() {
    this.readyState = 1 // OPEN
    this.onopen?.({} as Event)
  }

  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent)
  }

  simulateClose(code = 1006) {
    this.readyState = 3
    this.onclose?.({ code, reason: '', wasClean: code === 1000 } as CloseEvent)
  }

  simulateError() {
    this.onerror?.({} as Event)
  }
}

describe('PushNotificationService', () => {
  let service: PushNotificationService
  let storage: MemoryStorage
  let originalWebSocket: typeof globalThis.WebSocket

  beforeEach(() => {
    storage = new MemoryStorage()
    service = new PushNotificationService(storage, SERVER_URL)
    MockWebSocket.instances = []
    originalWebSocket = globalThis.WebSocket
    // @ts-expect-error -- mock WebSocket
    globalThis.WebSocket = MockWebSocket
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    service.disconnect()
    globalThis.WebSocket = originalWebSocket
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('fetchVapidPublicKey', () => {
    it('should fetch VAPID key from server', async () => {
      const mockKey = 'BNbxGYNMhEIi9eGlMi...'
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ public_key: mockKey }), { status: 200 })
      )

      const key = await service.fetchVapidPublicKey()

      expect(key).toBe(mockKey)
      expect(fetch).toHaveBeenCalledWith(`${SERVER_URL}/vapid-public-key`)
    })

    it('should throw on non-ok response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('', { status: 500, statusText: 'Internal Server Error' })
      )

      await expect(service.fetchVapidPublicKey()).rejects.toThrow('Failed to fetch VAPID public key')
    })
  })

  describe('registerDevice', () => {
    it('should POST to /register and persist locally', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 200 }))

      await service.registerDevice({
        vaultId: 'vault-123',
        partyName: 'device-1',
        token: 'apns-token-abc',
        deviceType: 'ios',
      })

      expect(fetch).toHaveBeenCalledWith(`${SERVER_URL}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vault_id: 'vault-123',
          party_name: 'device-1',
          token: 'apns-token-abc',
          device_type: 'apple',
        }),
      })

      // Should be persisted locally
      expect(await service.isVaultRegistered('vault-123')).toBe(true)
      const registrations = await service.getRegistrations()
      expect(registrations['vault-123']).toMatchObject({
        vaultId: 'vault-123',
        partyName: 'device-1',
      })
      expect(registrations['vault-123'].registeredAt).toBeGreaterThan(0)
    })

    it('should throw on non-ok response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 400, statusText: 'Bad Request' }))

      await expect(
        service.registerDevice({
          vaultId: 'vault-123',
          partyName: 'device-1',
          token: '',
          deviceType: 'ios',
        })
      ).rejects.toThrow('Failed to register device')
    })

    it('should map deviceType electron to web for the server', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 200 }))

      await service.registerDevice({
        vaultId: 'vault-el',
        partyName: 'd',
        token: 't',
        deviceType: 'electron',
      })

      const init = fetchMock.mock.calls[0][1] as RequestInit
      expect(JSON.parse(init.body as string).device_type).toBe('web')
    })
  })

  describe('unregisterVault', () => {
    it('should DELETE /unregister then remove registration from storage', async () => {
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 }))

      await service.registerDevice({
        vaultId: 'vault-123',
        partyName: 'device-1',
        token: 'token',
        deviceType: 'ios',
      })

      expect(await service.isVaultRegistered('vault-123')).toBe(true)

      await service.unregisterVault('vault-123')

      expect(fetchMock).toHaveBeenLastCalledWith(`${SERVER_URL}/unregister`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vault_id: 'vault-123', party_name: 'device-1' }),
      })
      expect(await service.isVaultRegistered('vault-123')).toBe(false)
    })

    it('should throw and preserve local registration when server unregister fails', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response('', { status: 500, statusText: 'Internal Server Error' }))

      await service.registerDevice({
        vaultId: 'vault-123',
        partyName: 'device-1',
        token: 'token',
        deviceType: 'web',
      })

      await expect(service.unregisterVault('vault-123')).rejects.toThrow('Failed to unregister from notification server')
      expect(await service.isVaultRegistered('vault-123')).toBe(true)
    })

    it('should handle unregistering non-existent vault gracefully', async () => {
      await service.unregisterVault('nonexistent')
      expect(await service.isVaultRegistered('nonexistent')).toBe(false)
    })
  })

  describe('isVaultRegistered', () => {
    it('should return false for unregistered vaults', async () => {
      expect(await service.isVaultRegistered('vault-123')).toBe(false)
    })
  })

  describe('hasRemoteRegistrations', () => {
    it('should return true on 200 response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 200 }))

      const result = await service.hasRemoteRegistrations('vault-123')

      expect(result).toBe(true)
      expect(fetch).toHaveBeenCalledWith(`${SERVER_URL}/vault/vault-123`)
    })

    it('should return false on 404 response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 404 }))

      const result = await service.hasRemoteRegistrations('vault-123')

      expect(result).toBe(false)
    })

    it('should return false on 204 response (legacy)', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 204 }))

      const result = await service.hasRemoteRegistrations('vault-123')

      expect(result).toBe(false)
    })

    it('should throw on error response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('', { status: 500, statusText: 'Internal Server Error' })
      )

      await expect(service.hasRemoteRegistrations('vault-123')).rejects.toThrow('Failed to check vault registrations')
    })
  })

  describe('notifyVaultMembers', () => {
    it('should POST to /notify with correct body', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 204 }))

      await service.notifyVaultMembers({
        vaultId: 'vault-123',
        vaultName: 'My Vault',
        localPartyId: 'device-1',
        qrCodeData: 'vultisig://keysign?session=abc',
      })

      expect(fetch).toHaveBeenCalledWith(`${SERVER_URL}/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vault_id: 'vault-123',
          vault_name: 'My Vault',
          local_party_id: 'device-1',
          qr_code_data: 'vultisig://keysign?session=abc',
        }),
      })
    })

    it('should throw on non-ok response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('', { status: 500, statusText: 'Internal Server Error' })
      )

      await expect(
        service.notifyVaultMembers({
          vaultId: 'vault-123',
          vaultName: 'My Vault',
          localPartyId: 'device-1',
          qrCodeData: 'data',
        })
      ).rejects.toThrow('Failed to notify vault members')
    })
  })

  describe('parseNotificationPayload', () => {
    it('should parse valid notification data', () => {
      const result = service.parseNotificationPayload({
        title: 'Vultisig Keysign request',
        subtitle: 'Vault: My Wallet',
        body: 'vultisig://keysign?session=abc123',
      })

      expect(result).toEqual({
        vaultName: 'My Wallet',
        qrCodeData: 'vultisig://keysign?session=abc123',
        raw: {
          title: 'Vultisig Keysign request',
          subtitle: 'Vault: My Wallet',
          body: 'vultisig://keysign?session=abc123',
        },
      })
    })

    it('should handle subtitle without "Vault: " prefix', () => {
      const result = service.parseNotificationPayload({
        title: 'Keysign',
        subtitle: 'Team Treasury',
        body: 'data',
      })

      expect(result?.vaultName).toBe('Team Treasury')
    })

    it('should return null for null data', () => {
      expect(service.parseNotificationPayload(null)).toBeNull()
    })

    it('should return null for non-object data', () => {
      expect(service.parseNotificationPayload('string')).toBeNull()
      expect(service.parseNotificationPayload(123)).toBeNull()
    })

    it('should return null for missing required fields', () => {
      expect(service.parseNotificationPayload({ title: 'test' })).toBeNull()
      expect(service.parseNotificationPayload({ title: 'test', subtitle: 'sub' })).toBeNull()
    })

    it('should return null for non-string fields', () => {
      expect(service.parseNotificationPayload({ title: 123, subtitle: 'sub', body: 'body' })).toBeNull()
    })
  })

  describe('onSigningRequest + handleIncomingPush', () => {
    it('should invoke registered handlers on valid push', () => {
      const handler = vi.fn()
      service.onSigningRequest(handler)

      service.handleIncomingPush({
        title: 'Vultisig Keysign request',
        subtitle: 'Vault: My Wallet',
        body: 'vultisig://keysign?session=abc',
      })

      expect(handler).toHaveBeenCalledOnce()
      const notification: SigningNotification = handler.mock.calls[0][0]
      expect(notification.vaultName).toBe('My Wallet')
      expect(notification.qrCodeData).toBe('vultisig://keysign?session=abc')
    })

    it('should invoke multiple handlers', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      service.onSigningRequest(handler1)
      service.onSigningRequest(handler2)

      service.handleIncomingPush({
        title: 'test',
        subtitle: 'Vault: V',
        body: 'data',
      })

      expect(handler1).toHaveBeenCalledOnce()
      expect(handler2).toHaveBeenCalledOnce()
    })

    it('should not invoke handlers after unsubscribe', () => {
      const handler = vi.fn()
      const unsubscribe = service.onSigningRequest(handler)

      unsubscribe()

      service.handleIncomingPush({
        title: 'test',
        subtitle: 'Vault: V',
        body: 'data',
      })

      expect(handler).not.toHaveBeenCalled()
    })

    it('should not invoke handlers for invalid push data', () => {
      const handler = vi.fn()
      service.onSigningRequest(handler)

      service.handleIncomingPush(null)
      service.handleIncomingPush({ invalid: true })

      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('ping', () => {
    it('should return true on 200', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Vultisig notification server is running', { status: 200 })
      )

      expect(await service.ping()).toBe(true)
      expect(fetch).toHaveBeenCalledWith(`${SERVER_URL}/ping`)
    })

    it('should return false on network error', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'))

      expect(await service.ping()).toBe(false)
    })

    it('should return false on non-ok response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 503 }))

      expect(await service.ping()).toBe(false)
    })
  })

  describe('WebSocket', () => {
    const wsOptions = {
      vaultId: 'vault-123',
      partyName: 'device-1',
      token: 'push-token-abc',
    }

    describe('connect', () => {
      it('should build correct WebSocket URL with query params', () => {
        service.connect(wsOptions)

        expect(MockWebSocket.instances).toHaveLength(1)
        const ws = MockWebSocket.instances[0]
        expect(ws.url).toBe(
          'wss://api.vultisig.com/notification/ws?vault_id=vault-123&party_name=device-1&token=push-token-abc'
        )
      })

      it('should set connectionState to connecting then connected', () => {
        const states: WSConnectionState[] = []
        service.onConnectionStateChange(s => states.push(s))

        service.connect(wsOptions)
        expect(service.connectionState).toBe('connecting')

        MockWebSocket.instances[0].simulateOpen()
        expect(service.connectionState).toBe('connected')
        expect(states).toEqual(['connecting', 'connected'])
      })

      it('should close previous connection when reconnecting', () => {
        service.connect(wsOptions)
        const firstWs = MockWebSocket.instances[0]
        firstWs.simulateOpen()

        service.connect({ ...wsOptions, vaultId: 'vault-456' })

        expect(MockWebSocket.instances).toHaveLength(2)
        expect(firstWs.readyState).toBe(3) // CLOSED
      })
    })

    describe('message handling', () => {
      it('should dispatch notification to onSigningRequest handlers', () => {
        const handler = vi.fn()
        service.onSigningRequest(handler)
        service.connect(wsOptions)
        MockWebSocket.instances[0].simulateOpen()

        MockWebSocket.instances[0].simulateMessage({
          type: 'notification',
          id: '1234567890-0',
          vault_name: 'My Vault',
          qr_code_data: 'vultisig://keysign?session=abc',
        })

        expect(handler).toHaveBeenCalledOnce()
        const notification: SigningNotification = handler.mock.calls[0][0]
        expect(notification.vaultName).toBe('My Vault')
        expect(notification.qrCodeData).toBe('vultisig://keysign?session=abc')
      })

      it('should send ACK after receiving notification', () => {
        service.connect(wsOptions)
        MockWebSocket.instances[0].simulateOpen()

        MockWebSocket.instances[0].simulateMessage({
          type: 'notification',
          id: '1234567890-0',
          vault_name: 'Test',
          qr_code_data: 'data',
        })

        const ws = MockWebSocket.instances[0]
        expect(ws.sentMessages).toHaveLength(1)
        expect(JSON.parse(ws.sentMessages[0])).toEqual({
          type: 'ack',
          id: '1234567890-0',
        })
      })

      it('should ignore non-notification messages', () => {
        const handler = vi.fn()
        service.onSigningRequest(handler)
        service.connect(wsOptions)
        MockWebSocket.instances[0].simulateOpen()

        MockWebSocket.instances[0].simulateMessage({ type: 'pong' })

        expect(handler).not.toHaveBeenCalled()
      })

      it('should ignore malformed JSON', () => {
        const handler = vi.fn()
        service.onSigningRequest(handler)
        service.connect(wsOptions)
        MockWebSocket.instances[0].simulateOpen()

        // Simulate raw non-JSON message
        MockWebSocket.instances[0].onmessage?.({ data: 'not json' } as MessageEvent)

        expect(handler).not.toHaveBeenCalled()
      })
    })

    describe('disconnect', () => {
      it('should close WebSocket and set state to disconnected', () => {
        service.connect(wsOptions)
        MockWebSocket.instances[0].simulateOpen()

        service.disconnect()

        expect(service.connectionState).toBe('disconnected')
      })

      it('should not auto-reconnect after manual disconnect', () => {
        service.connect(wsOptions)
        MockWebSocket.instances[0].simulateOpen()
        service.disconnect()

        vi.advanceTimersByTime(60_000)

        // Only the initial connection, no reconnect attempts
        expect(MockWebSocket.instances).toHaveLength(1)
      })

      it('should be idempotent', () => {
        service.disconnect()
        service.disconnect()
        expect(service.connectionState).toBe('disconnected')
      })
    })

    describe('auto-reconnect', () => {
      it('should reconnect on unexpected close', () => {
        service.connect(wsOptions)
        MockWebSocket.instances[0].simulateOpen()

        // Simulate unexpected disconnect
        MockWebSocket.instances[0].simulateClose(1006)

        expect(service.connectionState).toBe('reconnecting')

        // Advance past first backoff (1s)
        vi.advanceTimersByTime(1000)

        expect(MockWebSocket.instances).toHaveLength(2)
        expect(service.connectionState).toBe('connecting')
      })

      it('should use exponential backoff', () => {
        service.connect(wsOptions)
        MockWebSocket.instances[0].simulateOpen()

        // First disconnect
        MockWebSocket.instances[0].simulateClose(1006)
        vi.advanceTimersByTime(1000) // 1s backoff
        expect(MockWebSocket.instances).toHaveLength(2)

        // Second disconnect
        MockWebSocket.instances[1].simulateClose(1006)
        vi.advanceTimersByTime(1000) // Not enough — 2s backoff needed
        expect(MockWebSocket.instances).toHaveLength(2) // Still 2
        vi.advanceTimersByTime(1000) // Total 2s
        expect(MockWebSocket.instances).toHaveLength(3) // Now reconnected

        // Third disconnect
        MockWebSocket.instances[2].simulateClose(1006)
        vi.advanceTimersByTime(3000) // Not enough — 4s backoff needed
        expect(MockWebSocket.instances).toHaveLength(3)
        vi.advanceTimersByTime(1000) // Total 4s
        expect(MockWebSocket.instances).toHaveLength(4)
      })

      it('should reset backoff on successful connection', () => {
        service.connect(wsOptions)
        MockWebSocket.instances[0].simulateOpen()

        // Disconnect and reconnect
        MockWebSocket.instances[0].simulateClose(1006)
        vi.advanceTimersByTime(1000)
        MockWebSocket.instances[1].simulateOpen() // Success resets backoff

        // Disconnect again — should use 1s backoff (reset)
        MockWebSocket.instances[1].simulateClose(1006)
        vi.advanceTimersByTime(1000)
        expect(MockWebSocket.instances).toHaveLength(3) // Reconnected at 1s
      })

      it('should cap backoff at 30 seconds', () => {
        service.connect(wsOptions)
        MockWebSocket.instances[0].simulateOpen()

        // Simulate many disconnects to exceed cap
        for (let i = 0; i < 10; i++) {
          const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]
          ws.simulateClose(1006)
          vi.advanceTimersByTime(30_000)
        }

        // After many failures, backoff should be capped at 30s
        const lastWs = MockWebSocket.instances[MockWebSocket.instances.length - 1]
        lastWs.simulateClose(1006)
        vi.advanceTimersByTime(29_999)
        const countBefore = MockWebSocket.instances.length
        vi.advanceTimersByTime(1)
        expect(MockWebSocket.instances.length).toBe(countBefore + 1)
      })
    })

    describe('onConnectionStateChange', () => {
      it('should notify handlers of state changes', () => {
        const states: WSConnectionState[] = []
        service.onConnectionStateChange(s => states.push(s))

        service.connect(wsOptions)
        MockWebSocket.instances[0].simulateOpen()
        service.disconnect()

        expect(states).toEqual(['connecting', 'connected', 'disconnected'])
      })

      it('should support unsubscribe', () => {
        const states: WSConnectionState[] = []
        const unsub = service.onConnectionStateChange(s => states.push(s))

        service.connect(wsOptions)
        unsub()
        MockWebSocket.instances[0].simulateOpen()

        expect(states).toEqual(['connecting'])
      })
    })

    describe('URL derivation', () => {
      it('should handle http serverUrl', () => {
        const httpService = new PushNotificationService(storage, 'http://localhost:8080/push')
        httpService.connect(wsOptions)

        expect(MockWebSocket.instances[0].url).toContain('ws://localhost:8080/push/ws')
        httpService.disconnect()
      })

      it('should handle trailing slash in serverUrl', () => {
        const slashService = new PushNotificationService(storage, 'https://api.example.com/push/')
        slashService.connect(wsOptions)

        expect(MockWebSocket.instances[0].url).toContain('wss://api.example.com/push/ws')
        slashService.disconnect()
      })
    })
  })
})
