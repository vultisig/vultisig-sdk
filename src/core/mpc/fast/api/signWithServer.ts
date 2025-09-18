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

export const signWithServer = async (input: Input): Promise<string> => {
  const sessionId = await queryUrl<string>(`${fastVaultServerUrl}/sign`, {
    body: input,
    responseType: 'json',
  })
  
  // Server returns the session ID as a JSON string (with quotes)
  // Remove quotes if present to get clean UUID
  return sessionId.replace(/^"|"$/g, '')
}
