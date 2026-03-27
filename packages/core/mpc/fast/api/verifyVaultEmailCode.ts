import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { fastVaultServerUrl } from '../config'

type VerifyVaultEmailCodeInput = {
  vaultId: string
  code: string
  /** Override API base (e.g. local `…/vault`). */
  vaultBaseUrl?: string
}

export const verifyVaultEmailCode = async ({
  vaultId,
  code,
  vaultBaseUrl,
}: VerifyVaultEmailCodeInput) =>
  queryUrl(`${vaultBaseUrl ?? fastVaultServerUrl}/verify/${vaultId}/${code}`, {
    responseType: 'none',
  })
