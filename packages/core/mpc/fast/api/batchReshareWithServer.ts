import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { fastVaultServerUrl } from '../config'

type Input = {
  name?: string
  session_id: string
  public_key?: string
  hex_encryption_key: string
  hex_chain_code?: string
  local_party_id: string
  old_parties: string[]
  old_reshare_prefix?: string
  encryption_password: string
  email?: string
  reshare_type?: number
  lib_type?: number
  protocols: string[]
  vaultBaseUrl?: string
}

export const batchReshareWithServer = async ({
  vaultBaseUrl,
  ...body
}: Input) =>
  queryUrl(`${vaultBaseUrl ?? fastVaultServerUrl}/batch/reshare`, {
    body,
    responseType: 'none',
  })
