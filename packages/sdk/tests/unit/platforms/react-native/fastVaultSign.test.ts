import { afterEach, describe, expect, it, vi } from 'vitest'

// Mock the MPC keysign + the relay-session helpers so the test never hits the
// network. The assertions focus on fastVaultSign's signature-assembly logic.
vi.mock('@vultisig/core-mpc/keysign', () => ({
  keysign: vi.fn(),
}))
vi.mock('../../../../src/platforms/react-native/mpc/relay', () => ({
  joinRelaySession: vi.fn(async () => {}),
  startRelaySession: vi.fn(async () => {}),
  waitForParties: vi.fn(async () => ['local', 'server']),
}))

const { keysign } = await import('@vultisig/core-mpc/keysign')
const { fastVaultSign } = await import('../../../../src/platforms/react-native/mpc/fastVaultSign')

const BASE_OPTS = {
  keyshareBase64: 'ZmFrZQ==',
  messageHashHex: '00'.repeat(32),
  serverDerivePath: "m/44'/60'/0'/0/0",
  localDerivePath: "m/44'/60'/0'/0/0",
  localPartyId: 'local',
  vaultPassword: 'pw',
  publicKeyEcdsa: 'aa'.repeat(33),
  vultiServerUrl: 'https://api.vultisig.com/vault',
  relayUrl: 'https://api.vultisig.com/router',
  maxAttempts: 1,
}

describe('fastVaultSign — ECDSA recovery_id handling', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.mocked(keysign).mockReset()
  })

  it('throws when MPC returns ECDSA signature without recovery_id', async () => {
    // VultiServer POST — respond 200 so the flow reaches keysign.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 200 }))
    )
    vi.mocked(keysign).mockResolvedValueOnce({
      r: 'aa'.repeat(32),
      s: 'bb'.repeat(32),
      // no recovery_id — this is the bug scenario
    } as never)

    await expect(fastVaultSign({ ...BASE_OPTS, isEcdsa: true })).rejects.toThrow(
      /recovery_id/
    )
  })

  it('throws when recovery_id is an empty string', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 200 }))
    )
    vi.mocked(keysign).mockResolvedValueOnce({
      r: 'aa'.repeat(32),
      s: 'bb'.repeat(32),
      recovery_id: '',
    } as never)

    await expect(fastVaultSign({ ...BASE_OPTS, isEcdsa: true })).rejects.toThrow(
      /recovery_id/
    )
  })

  it('normalises single-char recovery_id to two hex chars', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 200 }))
    )
    vi.mocked(keysign).mockResolvedValueOnce({
      r: 'aa'.repeat(32),
      s: 'bb'.repeat(32),
      recovery_id: '1', // engine may emit single char — normalise without dropping
    } as never)

    const sig = await fastVaultSign({ ...BASE_OPTS, isEcdsa: true })
    expect(sig).toBe('aa'.repeat(32) + 'bb'.repeat(32) + '01')
  })

  it('returns r||s without recovery_id for EdDSA signatures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 200 }))
    )
    vi.mocked(keysign).mockResolvedValueOnce({
      r: 'aa'.repeat(32),
      s: 'bb'.repeat(32),
    } as never)

    const sig = await fastVaultSign({ ...BASE_OPTS, isEcdsa: false })
    expect(sig).toBe('aa'.repeat(32) + 'bb'.repeat(32))
  })
})
