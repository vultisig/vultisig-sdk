import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sdkMocks = vi.hoisted(() => {
  const registerDevice = vi.fn(async () => undefined)
  const connect = vi.fn()
  const onSigningRequest = vi.fn()
  const computeNotificationVaultId = vi.fn(async () => 'hashed-vault-id')

  class FakePushNotificationService {
    registerDevice = registerDevice
    connect = connect
    onSigningRequest = onSigningRequest
  }

  class FakeMemoryStorage {}

  return {
    registerDevice,
    connect,
    onSigningRequest,
    computeNotificationVaultId,
    FakePushNotificationService,
    FakeMemoryStorage,
  }
})

vi.mock('@vultisig/sdk', async importOriginal => {
  const actual = await importOriginal<typeof import('@vultisig/sdk')>()
  return {
    ...actual,
    PushNotificationService: sdkMocks.FakePushNotificationService,
    MemoryStorage: sdkMocks.FakeMemoryStorage,
    computeNotificationVaultId: sdkMocks.computeNotificationVaultId,
  }
})

vi.mock('../auth', () => ({
  authenticateVault: vi.fn(async () => ({ token: 'reauth-tok', expiresAt: 9_999_999_999, refreshToken: 'rt' })),
}))

vi.mock('../context', () => ({
  buildMinimalContext: vi.fn(async () => ({ addresses: {} })),
  buildMessageContext: vi.fn(async () => ({ addresses: {} })),
}))

import { AgentSession } from '../session'

const initialize = (AgentSession.prototype as any).initialize

function makeUi() {
  return {
    onError: vi.fn(),
    onNotification: vi.fn(),
    requestPassword: vi.fn(async () => 'pw'),
  } as any
}

function makeFakeThis() {
  return {
    client: {
      healthCheck: vi.fn(async () => true),
      setAuthToken: vi.fn(),
      getConversation: vi.fn(),
      createConversation: vi.fn(async () => ({ id: 'conv-default' })),
    },
    vault: {
      isEncrypted: false,
      publicKeys: { ecdsa: 'ecdsa-pubkey' },
      hexChainCode: 'chain-code-hex',
    },
    config: {
      askMode: true,
      notificationUrl: 'wss://push.example.test',
    },
    publicKey: 'ecdsa-pubkey',
    executor: { setPassword: vi.fn() },
    conversationId: null as string | null,
    historyMessages: [] as any[],
    cachedContext: null,
    pushService: null,
    withAuthRetry: (AgentSession.prototype as any).withAuthRetry,
    unlockEncryptedVault: (AgentSession.prototype as any).unlockEncryptedVault,
  }
}

describe('initialize — notification registration parity', () => {
  const originalWebSocket = globalThis.WebSocket

  beforeEach(() => {
    sdkMocks.registerDevice.mockClear()
    sdkMocks.connect.mockClear()
    sdkMocks.onSigningRequest.mockClear()
    sdkMocks.computeNotificationVaultId.mockClear()
    globalThis.WebSocket = class {} as any
  })

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket
  })

  it('registers and connects the CLI listener with the canonical hashed notification vault id', async () => {
    const ft = makeFakeThis()
    const ui = makeUi()

    await initialize.call(ft, ui)

    expect(sdkMocks.computeNotificationVaultId).toHaveBeenCalledWith('ecdsa-pubkey', 'chain-code-hex')
    expect(sdkMocks.registerDevice).toHaveBeenCalledWith({
      vaultId: 'hashed-vault-id',
      partyName: 'cli-agent',
      token: expect.any(String),
      deviceType: 'electron',
    })
    expect(sdkMocks.connect).toHaveBeenCalledWith({
      vaultId: 'hashed-vault-id',
      partyName: 'cli-agent',
      token: expect.any(String),
    })
  })
})
