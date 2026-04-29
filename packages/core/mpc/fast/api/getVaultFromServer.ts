import { base64Encode } from '@vultisig/lib-utils/base64Encode'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { fastVaultServerUrl } from '../config'

/** Public vault fields from FastVault `GET /get/{public_key_ecdsa}` (after password check). No key shares. */
export type VaultFromServerResponse = {
  name: string
  publicKeyEcdsa: string
  publicKeyEddsa: string
  hexChainCode: string
  localPartyId: string
}

type GetVaultFromServerInput = {
  password: string
  vaultId: string
  /** Override API base (e.g. local `…/vault`). */
  vaultBaseUrl?: string
}

type VaultGetJson = {
  name?: unknown
  public_key_ecdsa?: unknown
  public_key_eddsa?: unknown
  hex_chain_code?: unknown
  local_party_id?: unknown
}

function requireNonEmptyString(field: string, value: unknown): string {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`FastVault GET /get: invalid or missing "${field}" in response`)
  }
  return value
}

function mapVaultGetJsonToResponse(data: unknown): VaultFromServerResponse {
  if (data === null || typeof data !== 'object') {
    throw new Error('FastVault GET /get: expected JSON object in response')
  }
  const o = data as VaultGetJson
  return {
    name: requireNonEmptyString('name', o.name),
    publicKeyEcdsa: requireNonEmptyString('public_key_ecdsa', o.public_key_ecdsa),
    publicKeyEddsa: requireNonEmptyString('public_key_eddsa', o.public_key_eddsa),
    hexChainCode: requireNonEmptyString('hex_chain_code', o.hex_chain_code),
    localPartyId: requireNonEmptyString('local_party_id', o.local_party_id),
  }
}

export const getVaultFromServer = async ({
  password,
  vaultId,
  vaultBaseUrl,
}: GetVaultFromServerInput): Promise<VaultFromServerResponse> => {
  const url = `${vaultBaseUrl ?? fastVaultServerUrl}/get/${vaultId}`

  const raw = await queryUrl<VaultGetJson>(url, {
    headers: {
      // VultiServer accepts standard base64 here, or plaintext if base64 decode fails.
      'x-password': base64Encode(password),
    },
    responseType: 'json',
  })

  return mapVaultGetJsonToResponse(raw)
}
