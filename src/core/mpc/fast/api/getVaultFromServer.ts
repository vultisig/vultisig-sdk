import { base64Encode } from '../../../../lib/utils/base64Encode'
import { queryUrl } from '../../../../lib/utils/query/queryUrl'

import { fastVaultServerUrl } from '../config'

type GetVaultFromServerInput = {
  password: string
  vaultId: string
}

type ServerVaultResponse = {
  name: string
  public_key_ecdsa: string
  public_key_eddsa: string
  hex_chain_code: string
  local_party_id: string
  signers?: string[]
  created_at?: number
  lib_type?: string
  is_backed_up?: boolean
  order?: number
}

export const getVaultFromServer = async ({
  password,
  vaultId,
}: GetVaultFromServerInput) => {
  const url = `${fastVaultServerUrl}/get/${vaultId}`

  const response = await queryUrl<ServerVaultResponse>(url, {
    headers: {
      'x-password': base64Encode(password),
    },
    responseType: 'json',
  })

  return {
    name: response.name,
    publicKeys: {
      ecdsa: response.public_key_ecdsa,
      eddsa: response.public_key_eddsa,
    },
    signers: response.signers || [],
    hexChainCode: response.hex_chain_code,
    createdAt: response.created_at,
    localPartyId: response.local_party_id,
    libType: response.lib_type === 'DKLS' ? 'DKLS' : 'GG20',
    isBackedUp: response.is_backed_up || false,
    order: response.order || 0,
    keyShares: {
      ecdsa: '',
      eddsa: '',
    },
    lastPasswordVerificationTime: Date.now(),
  }
}
