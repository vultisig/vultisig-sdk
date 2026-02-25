import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PushNotificationService } from '../../../src/services/PushNotificationService'
import { MemoryStorage } from '../../../src/storage/MemoryStorage'
import type { SigningNotification } from '../../../src/types/notifications'

const SERVER_URL = 'https://api.vultisig.com/push'

describe('PushNotificationService', () => {
  let service: PushNotificationService
  let storage: MemoryStorage

  beforeEach(() => {
    storage = new MemoryStorage()
    service = new PushNotificationService(storage, SERVER_URL)
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
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
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 204 }))

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
          device_type: 'ios',
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
  })

  describe('unregisterVault', () => {
    it('should remove registration from storage', async () => {
      // Set up a registration first
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 204 }))
      await service.registerDevice({
        vaultId: 'vault-123',
        partyName: 'device-1',
        token: 'token',
        deviceType: 'ios',
      })

      expect(await service.isVaultRegistered('vault-123')).toBe(true)

      await service.unregisterVault('vault-123')

      expect(await service.isVaultRegistered('vault-123')).toBe(false)
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

    it('should return false on 204 response', async () => {
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
})
