import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DklsMaliciousPartyError } from './error'
import { keysign } from './index'

const mocks = vi.hoisted(() => ({
  ensureSetupMessage: vi.fn(),
  finish: vi.fn(),
  fromMpcServerMessage: vi.fn(),
  getMpcRelayMessages: vi.fn(),
  initializeMpcLib: vi.fn(),
  inputMessage: vi.fn(),
  makeSignSession: vi.fn(),
  outputMessage: vi.fn(),
  setupMessageHash: vi.fn(),
}))

vi.mock('../lib/initialize', () => ({ initializeMpcLib: mocks.initializeMpcLib }))
vi.mock('../lib/signSession', () => ({
  makeSignSession: mocks.makeSignSession,
  SignSession: {
    ecdsa: { setupMessageHash: mocks.setupMessageHash },
  },
}))
vi.mock('../message/relay/get', () => ({ getMpcRelayMessages: mocks.getMpcRelayMessages }))
vi.mock('../message/server', () => ({ fromMpcServerMessage: mocks.fromMpcServerMessage }))
vi.mock('../message/setup/ensure', () => ({ ensureSetupMessage: mocks.ensureSetupMessage }))

describe('keysign', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.initializeMpcLib.mockResolvedValue(undefined)
    mocks.ensureSetupMessage.mockResolvedValue(Uint8Array.of(0))
    mocks.setupMessageHash.mockReturnValue(Uint8Array.of(0))
    mocks.makeSignSession.mockResolvedValue({
      finish: mocks.finish,
      inputMessage: mocks.inputMessage,
      outputMessage: mocks.outputMessage,
    })
    mocks.outputMessage.mockImplementation(() => {
      throw new Error('stop outbound processing')
    })
    mocks.getMpcRelayMessages.mockResolvedValue([{ body: 'body', from: 'peer', hash: 'hash' }])
    mocks.fromMpcServerMessage.mockReturnValue(Uint8Array.of(1))
    mocks.inputMessage.mockReturnValue(true)
  })

  it('maps ECDSA finish abort-and-ban codes to DklsMaliciousPartyError', async () => {
    mocks.finish.mockRejectedValue(new Error('signSessionFinish failed with error code 103'))

    const error = await keysign({
      keyShare: 'key-share',
      signatureAlgorithm: 'ecdsa',
      message: '00',
      chainPath: "m/44'/60'/0'/0/0",
      localPartyId: 'local',
      peers: ['peer'],
      serverUrl: 'https://relay.example',
      sessionId: 'session',
      hexEncryptionKey: '00',
      isInitiatingDevice: true,
    }).catch(error => error)

    expect(error).toBeInstanceOf(DklsMaliciousPartyError)
    expect(error).toMatchObject({ code: 103 })
    expect(mocks.finish).toHaveBeenCalledOnce()
  })
})
