import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { fastVaultServerUrl } from '../config'

type Input = {
  name: string
  session_id: string
  hex_encryption_key: string
  local_party_id: string
  encryption_password: string
  email: string
  lib_type: number
  chains: string[]
  protocols: string[]
  vaultBaseUrl?: string
}

export const keyImportWithServer = async ({ vaultBaseUrl, ...body }: Input) =>
  queryUrl(`${vaultBaseUrl ?? fastVaultServerUrl}/batch/import`, {
    body,
    responseType: 'none',
  })
