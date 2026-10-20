import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { toLibType } from '../../types/utils/libType'
import { fastVaultServerUrl } from '../config'

type Input = {
  name: string
  session_id: string
  hex_encryption_key: string
  hex_chain_code: string
  local_party_id: string
  encryption_password: string
  email: string
  protocols: string[]
  public_key?: string
  /** Override API base (e.g. local `…/vault`). */
  vaultBaseUrl?: string
}

export const setupVaultWithServer = async ({ vaultBaseUrl, ...body }: Input) =>
  queryUrl(`${vaultBaseUrl ?? fastVaultServerUrl}/batch/keygen`, {
    // VultiServer stores an omitted lib_type as GG20, and then fast signing never completes.
    body: { ...body, lib_type: toLibType('DKLS') },
    responseType: 'none',
  })
