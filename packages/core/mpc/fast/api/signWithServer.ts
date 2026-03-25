import { queryUrl } from '@lib/utils/query/queryUrl'

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
  /** When true, VultiServer runs ML-DSA keysign on the relay for this session (separate MPC from ECDSA/EdDSA). */
  mldsa?: boolean
  /** Override API base (e.g. `http://127.0.0.1:8080/vault` for local VultiServer). */
  vaultBaseUrl?: string
}

export const signWithServer = async (input: Input) => {
  const { vaultBaseUrl, ...body } = input
  const base = vaultBaseUrl ?? fastVaultServerUrl
  return queryUrl(`${base}/sign`, {
    body,
    responseType: 'none',
  })
}
