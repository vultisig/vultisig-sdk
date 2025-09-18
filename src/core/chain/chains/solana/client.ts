import { rootApiUrl } from '../../../config'
import { memoize } from '../../../../lib/utils/memoize'

export const solanaRpcUrl = `${rootApiUrl}/solana/`

export const getSolanaClient = memoize(async () => {
  // Dynamic import to handle Node.js vs browser differences
  const { Connection } = await import('@solana/web3.js')
  return new Connection(solanaRpcUrl)
})
