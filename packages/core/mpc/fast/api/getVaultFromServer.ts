import { base64Encode } from '@vultisig/lib-utils/base64Encode'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { fastVaultServerUrl } from '../config'

type GetVaultFromServerInput = {
  password: string
  vaultId: string
}

export const getVaultFromServer = async ({
  password,
  vaultId,
}: GetVaultFromServerInput) => {
  const url = `${fastVaultServerUrl}/get/${vaultId}`

  await queryUrl(url, {
    headers: {
      'x-password': base64Encode(password),
    },
    responseType: 'json',
  })

  return {
    password,
  }
}
