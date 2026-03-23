/**
 * E2E: Push notification client against an in-process mock of the notification API.
 * No real vault file or production services required.
 */
import { MockNotificationServer } from '@helpers/mock-notification-server'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  computeNotificationVaultId,
  MemoryStorage,
  PushNotificationService,
  type SigningNotification,
} from '@/index'

import { testUtils } from '../setup'

/** Deterministic inputs; SHA256(utf8(ecdsa + chainCode)) pre-computed via Node crypto. */
const VAULT_ID_VECTOR_ECDSA = '04testEcdsaPubKeyHex'
const VAULT_ID_VECTOR_CHAIN = '00112233445566778899aabbccddeeff'
const VAULT_ID_VECTOR_EXPECTED =
  '456168d997f217cd775b746980ec0b41ae48660bab1e8334c10209a6ea6564cc'

describe('E2E: Push notifications (mock server)', () => {
  const mock = new MockNotificationServer()

  beforeAll(async () => {
    await mock.start()
  })

  afterAll(async () => {
    await mock.stop()
  })

  beforeEach(() => {
    mock.clearState()
  })

  describe('registration and remote checks', () => {
    let storage: MemoryStorage
    let service: PushNotificationService

    beforeEach(() => {
      storage = new MemoryStorage()
      service = new PushNotificationService(storage, mock.baseUrl)
    })

    afterEach(() => {
      service.disconnect()
    })

    it('registerDevice → isVaultRegistered → hasRemoteRegistrations', async () => {
      const vaultId = 'vault-reg-1'
      await service.registerDevice({
        vaultId,
        partyName: 'party-a',
        token: 'token-reg-1',
        deviceType: 'web',
      })

      expect(await service.isVaultRegistered(vaultId)).toBe(true)
      expect(await service.hasRemoteRegistrations(vaultId)).toBe(true)
    })

    it('hasRemoteRegistrations returns false when vault has no registrations (404)', async () => {
      expect(await service.hasRemoteRegistrations('vault-never-registered')).toBe(false)
    })
  })

  describe('notify payload', () => {
    it('notifyVaultMembers sends expected JSON body', async () => {
      const storage = new MemoryStorage()
      const svc = new PushNotificationService(storage, mock.baseUrl)
      const vaultId = 'vault-notify-1'
      await svc.registerDevice({
        vaultId,
        partyName: 'p1',
        token: 't1',
        deviceType: 'android',
      })

      await svc.notifyVaultMembers({
        vaultId,
        vaultName: 'Treasury',
        localPartyId: 'p1',
        qrCodeData: 'vultisig://keysign?session=abc',
      })

      expect(mock.notifyLog).toHaveLength(1)
      expect(mock.notifyLog[0]).toMatchObject({
        vault_id: vaultId,
        vault_name: 'Treasury',
        local_party_id: 'p1',
        qr_code_data: 'vultisig://keysign?session=abc',
      })
      svc.disconnect()
    })
  })

  describe('WebSocket delivery, ACK, and reconnect', () => {
    let storage: MemoryStorage
    let service: PushNotificationService

    beforeEach(() => {
      storage = new MemoryStorage()
      service = new PushNotificationService(storage, mock.baseUrl)
    })

    afterEach(() => {
      service.disconnect()
    })

    it('connect → notify → onSigningRequest + ACK', async () => {
      const vaultId = 'vault-ws-1'
      const token = 'ws-token-1'
      await service.registerDevice({
        vaultId,
        partyName: 'signer',
        token,
        deviceType: 'web',
      })

      const handler = vi.fn()
      service.onSigningRequest(handler)
      service.connect({ vaultId, partyName: 'signer', token })

      await testUtils.waitFor(() => service.connectionState === 'connected', 10_000)

      await service.notifyVaultMembers({
        vaultId,
        vaultName: 'WS Vault',
        localPartyId: 'signer',
        qrCodeData: 'qr-data-ws',
      })

      await testUtils.waitFor(() => handler.mock.calls.length > 0, 10_000)
      const n = handler.mock.calls[0][0] as SigningNotification
      expect(n.vaultName).toBe('WS Vault')
      expect(n.qrCodeData).toBe('qr-data-ws')

      await testUtils.waitFor(() => mock.ackLog.length > 0, 5000)
    })

    it('closes server-side socket → client reconnects → new notify delivered', async () => {
      const vaultId = 'vault-ws-reconnect'
      const token = 'ws-token-recon'
      await service.registerDevice({
        vaultId,
        partyName: 'peer',
        token,
        deviceType: 'web',
      })

      const handler = vi.fn()
      service.onSigningRequest(handler)
      service.connect({ vaultId, partyName: 'peer', token })

      await testUtils.waitFor(() => service.connectionState === 'connected', 10_000)

      mock.terminateVaultSockets(vaultId)
      // onclose is async; avoid treating the pre-terminate "connected" as the post-reconnect one
      await testUtils.waitFor(() => service.connectionState !== 'connected', 5000)
      await testUtils.waitFor(() => service.connectionState === 'connected', 15_000)

      await service.notifyVaultMembers({
        vaultId,
        vaultName: 'After reconnect',
        localPartyId: 'peer',
        qrCodeData: 'qr-reconnect',
      })

      await testUtils.waitFor(
        () =>
          handler.mock.calls.some(
            (call: [SigningNotification]) => call[0].qrCodeData === 'qr-reconnect'
          ),
        10_000
      )
    })
  })

  describe('push parsing and VAPID', () => {
    let service: PushNotificationService

    beforeEach(() => {
      service = new PushNotificationService(new MemoryStorage(), mock.baseUrl)
    })

    afterEach(() => {
      service.disconnect()
    })

    it('handleIncomingPush invokes callbacks with parsed SigningNotification', () => {
      const handler = vi.fn()
      service.onSigningRequest(handler)
      service.handleIncomingPush({
        title: 'Vultisig Keysign request',
        subtitle: 'Vault: Parsed Vault',
        body: 'vultisig://keysign?x=1',
      })
      expect(handler).toHaveBeenCalledOnce()
      expect((handler.mock.calls[0][0] as SigningNotification).vaultName).toBe('Parsed Vault')
      expect((handler.mock.calls[0][0] as SigningNotification).qrCodeData).toBe('vultisig://keysign?x=1')
    })

    it('fetchVapidPublicKey returns mock server key', async () => {
      const key = await service.fetchVapidPublicKey()
      expect(key).toBe(mock.vapidPublicKey)
    })
  })

  describe('computeNotificationVaultId', () => {
    it('matches iOS-style SHA256(pubKeyECDSA + hexChainCode)', async () => {
      const id = await computeNotificationVaultId(VAULT_ID_VECTOR_ECDSA, VAULT_ID_VECTOR_CHAIN)
      expect(id).toBe(VAULT_ID_VECTOR_EXPECTED)
    })
  })

  describe('unregister and device type mapping', () => {
    let storage: MemoryStorage
    let service: PushNotificationService

    beforeEach(() => {
      storage = new MemoryStorage()
      service = new PushNotificationService(storage, mock.baseUrl)
    })

    afterEach(() => {
      service.disconnect()
    })

    it('unregisterVault clears server and local state', async () => {
      const vaultId = 'vault-unreg'
      await service.registerDevice({
        vaultId,
        partyName: 'solo',
        token: 'tok',
        deviceType: 'web',
      })
      expect(await service.hasRemoteRegistrations(vaultId)).toBe(true)

      await service.unregisterVault(vaultId)

      expect(await service.isVaultRegistered(vaultId)).toBe(false)
      expect(await service.hasRemoteRegistrations(vaultId)).toBe(false)
    })

    it('maps deviceType ios → apple on the wire', async () => {
      await service.registerDevice({
        vaultId: 'vault-ios-map',
        partyName: 'ios-party',
        token: 'apns-tok',
        deviceType: 'ios',
      })
      expect(mock.registerLog[mock.registerLog.length - 1]?.device_type).toBe('apple')
    })

    it('maps deviceType electron → web on the wire', async () => {
      await service.registerDevice({
        vaultId: 'vault-el',
        partyName: 'el-party',
        token: 'electron-tok',
        deviceType: 'electron',
      })
      expect(mock.registerLog[mock.registerLog.length - 1]?.device_type).toBe('web')
    })
  })
})
