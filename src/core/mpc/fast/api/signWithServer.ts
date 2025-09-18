import { queryUrl } from '../../../../lib/utils/query/queryUrl'

import { fastVaultServerUrl } from '../config'

type Input = {
  public_key: string
  messages: string[]
  session: string
  hex_encryption_key: string
  derive_path: string
  is_ecdsa: boolean
  vault_password: string
}

export const signWithServer = async (input: Input) => {
  const response = await queryUrl(`${fastVaultServerUrl}/sign`, {
    body: input,
    responseType: 'text',
  }) as string
  
  // Clean up the response - remove quotes and all whitespace/newlines
  return response.trim().replace(/^["']|["']$/g, '')
}
