import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { fastVaultServerUrl } from '../config'

type Input = {
  public_key: string
  messages: string[]
  session: string
  hex_encryption_key: string
  derive_path: string
  is_ecdsa: boolean
  vault_password: string
  chain: string
  /** Request MLDSA signing instead of ECDSA/EdDSA. */
  mldsa?: boolean
  /** Override API base (e.g. local `…/vault`). */
  vaultBaseUrl?: string
}

export const signWithServer = async ({ vaultBaseUrl, ...body }: Input) =>
  queryUrl(`${vaultBaseUrl ?? fastVaultServerUrl}/sign`, {
    body,
    responseType: 'none',
  })
