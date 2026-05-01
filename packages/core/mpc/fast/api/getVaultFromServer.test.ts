import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getVaultFromServer } from './getVaultFromServer'

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: vi.fn(),
}))

import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

describe('getVaultFromServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls GET /get with password header and maps JSON to camelCase fields', async () => {
    vi.mocked(queryUrl).mockResolvedValue({
      name: 'my vault',
      public_key_ecdsa: '04aa',
      public_key_eddsa: 'bb',
      hex_chain_code: 'cc',
      local_party_id: 'Server-1',
    })

    const result = await getVaultFromServer({
      vaultId: 'vault-id',
      password: 'secret',
      vaultBaseUrl: 'https://example.com/vault',
    })

    expect(queryUrl).toHaveBeenCalledWith('https://example.com/vault/get/vault-id', {
      headers: expect.objectContaining({
        'x-password': expect.any(String),
      }),
      responseType: 'json',
    })
    expect(result).toEqual({
      name: 'my vault',
      publicKeyEcdsa: '04aa',
      publicKeyEddsa: 'bb',
      hexChainCode: 'cc',
      localPartyId: 'Server-1',
    })
  })

  it('throws when the response is not a vault object', async () => {
    vi.mocked(queryUrl).mockResolvedValue(null)
    await expect(
      getVaultFromServer({ vaultId: 'v', password: 'p', vaultBaseUrl: 'https://x/vault' })
    ).rejects.toThrow(/expected JSON object/)
  })

  it('throws when required string fields are missing', async () => {
    vi.mocked(queryUrl).mockResolvedValue({ name: 'only-name' })
    await expect(
      getVaultFromServer({ vaultId: 'v', password: 'p', vaultBaseUrl: 'https://x/vault' })
    ).rejects.toThrow(/public_key_ecdsa/)
  })
})
