/**
 * Fast vault server route selection for TSS batching vs sequential fallback.
 * Validates URL paths and batch vs sequential request body shapes (no live server).
 *
 * Manual / E2E matrix (credentials + relay + VultiServer required):
 * - Fast create: tssBatching on → /batch/keygen + batched relay ids; off → /create
 * - Fast seed import: batch → /batch/import (no hex_chain_code in body type); sequential → /import
 * - Reshare: batch → /batch/reshare (optional hex_chain_code); sequential → reshareWithServer path
 * - Secure create/join: initiator QR carries &tssBatching=1; joiner uses qrParams.tssBatching ?? false
 */
import { describe, expect, it, vi } from 'vitest'

const queryUrlMock = vi.hoisted(() =>
  vi.fn(async (_url: string | URL, _opts?: unknown): Promise<void> => undefined)
)

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: queryUrlMock,
}))

// Import after mock so fast/api modules bind to the mock
import { batchReshareWithServer } from '@vultisig/core-mpc/fast/api/batchReshareWithServer'
import { createVaultWithServer } from '@vultisig/core-mpc/fast/api/createVaultWithServer'
import { keyImportWithServer } from '@vultisig/core-mpc/fast/api/keyImportWithServer'
import { reshareWithServer } from '@vultisig/core-mpc/fast/api/reshareWithServer'
import { sequentialKeyImportWithServer } from '@vultisig/core-mpc/fast/api/sequentialKeyImportWithServer'
import { setupVaultWithServer } from '@vultisig/core-mpc/fast/api/setupVaultWithServer'

describe('Fast vault batch vs sequential HTTP contracts', () => {
  it('setupVaultWithServer posts to /batch/keygen', async () => {
    queryUrlMock.mockClear()
    await setupVaultWithServer({
      name: 'n',
      session_id: 'sid',
      hex_encryption_key: 'hexenc',
      hex_chain_code: 'hexcc',
      local_party_id: 'lp',
      encryption_password: 'pw',
      email: 'a@b.c',
      protocols: ['ecdsa', 'eddsa'],
      vaultBaseUrl: 'https://vault.example/vault',
    })
    expect(queryUrlMock).toHaveBeenCalledTimes(1)
    const url = String(queryUrlMock.mock.calls[0][0])
    expect(url).toBe('https://vault.example/vault/batch/keygen')
    expect(queryUrlMock.mock.calls[0][1]).toMatchObject({
      body: expect.objectContaining({
        protocols: ['ecdsa', 'eddsa'],
        hex_chain_code: 'hexcc',
      }),
      responseType: 'none',
    })
  })

  it('createVaultWithServer posts to /create', async () => {
    queryUrlMock.mockClear()
    await createVaultWithServer({
      name: 'n',
      session_id: 'sid',
      hex_encryption_key: 'hexenc',
      hex_chain_code: 'hexcc',
      local_party_id: 'lp',
      encryption_password: 'pw',
      email: 'a@b.c',
      lib_type: 1,
      vaultBaseUrl: 'https://vault.example/vault',
    })
    expect(String(queryUrlMock.mock.calls[0][0])).toBe('https://vault.example/vault/create')
  })

  it('keyImportWithServer posts to /batch/import without hex_chain_code in typed body', async () => {
    queryUrlMock.mockClear()
    await keyImportWithServer({
      name: 'n',
      session_id: 'sid',
      hex_encryption_key: 'hexenc',
      local_party_id: 'lp',
      encryption_password: 'pw',
      email: 'a@b.c',
      lib_type: 1,
      chains: ['Ethereum', 'Bitcoin'],
      protocols: ['ecdsa', 'eddsa'],
      vaultBaseUrl: 'https://vault.example/vault',
    })
    expect(String(queryUrlMock.mock.calls[0][0])).toBe('https://vault.example/vault/batch/import')
    const body = queryUrlMock.mock.calls[0][1] as { body: Record<string, unknown> }
    expect(body.body).not.toHaveProperty('hex_chain_code')
    expect(body.body.chains).toEqual(['Ethereum', 'Bitcoin'])
  })

  it('sequentialKeyImportWithServer posts to /import and includes hex_chain_code', async () => {
    queryUrlMock.mockClear()
    await sequentialKeyImportWithServer({
      name: 'n',
      session_id: 'sid',
      hex_encryption_key: 'hexenc',
      hex_chain_code: 'chaincodehex',
      local_party_id: 'lp',
      encryption_password: 'pw',
      email: 'a@b.c',
      lib_type: 1,
      chains: ['Ethereum'],
      vaultBaseUrl: 'https://vault.example/vault',
    })
    expect(String(queryUrlMock.mock.calls[0][0])).toBe('https://vault.example/vault/import')
    const body = queryUrlMock.mock.calls[0][1] as { body: Record<string, unknown> }
    expect(body.body.hex_chain_code).toBe('chaincodehex')
  })

  it('reshareWithServer posts to /reshare (sequential path)', async () => {
    queryUrlMock.mockClear()
    await reshareWithServer({
      name: 'vault',
      session_id: 'sid',
      public_key: 'pk',
      hex_encryption_key: 'hek',
      hex_chain_code: 'hcc',
      local_party_id: 'lp',
      old_parties: ['a', 'b'],
      old_reshare_prefix: '',
      encryption_password: 'pw',
    })
    expect(String(queryUrlMock.mock.calls[0][0])).toMatch(/\/reshare$/)
  })

  it('batchReshareWithServer posts to /batch/reshare with protocols and legacy-friendly fields', async () => {
    queryUrlMock.mockClear()
    await batchReshareWithServer({
      session_id: 'sid',
      hex_encryption_key: 'hek',
      local_party_id: 'lp',
      old_parties: ['a', 'b'],
      encryption_password: 'pw',
      protocols: ['ecdsa', 'eddsa'],
      name: 'vault',
      public_key: 'pk',
      hex_chain_code: 'hcc',
      old_reshare_prefix: '',
      reshare_type: 1,
      lib_type: 1,
      vaultBaseUrl: 'https://vault.example/vault',
    })
    expect(String(queryUrlMock.mock.calls[0][0])).toBe('https://vault.example/vault/batch/reshare')
    const body = queryUrlMock.mock.calls[0][1] as { body: Record<string, unknown> }
    expect(body.body).toMatchObject({
      protocols: ['ecdsa', 'eddsa'],
      hex_chain_code: 'hcc',
      public_key: 'pk',
    })
  })
})
