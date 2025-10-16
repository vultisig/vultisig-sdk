import { memoize } from '../../../../lib/utils/memoize'
import { rootApiUrl } from '../../../config'

export const solanaRpcUrl = `${rootApiUrl}/solana/`

export const getSolanaClient = memoize(async (customRpcUrl?: string) => {
  // Dynamic import to handle Node.js vs browser differences
  const { Connection } = await import('@solana/web3.js')
  const rpcUrl = customRpcUrl || solanaRpcUrl
  return new Connection(rpcUrl)
})
