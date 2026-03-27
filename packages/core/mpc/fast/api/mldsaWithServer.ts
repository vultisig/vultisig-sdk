import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { fastVaultServerUrl } from '../config'

type Input = {
  public_key: string
  session_id: string
  hex_encryption_key: string
  encryption_password: string
  email: string
  /** Override API base (e.g. local `…/vault`). */
  vaultBaseUrl?: string
}

export const mldsaWithServer = async ({ vaultBaseUrl, ...body }: Input) =>
  queryUrl(`${vaultBaseUrl ?? fastVaultServerUrl}/mldsa`, {
    body,
    responseType: 'none',
  })
