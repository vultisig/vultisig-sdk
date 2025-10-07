import { rootApiUrl } from '@core/config'
import { memoize } from '@lib/utils/memoize'
import * as web3 from '@solana/web3.js'
const { Connection } = web3

export const solanaRpcUrl = `${rootApiUrl}/solana/`

export const getSolanaClient = memoize(() => {
  return new Connection(solanaRpcUrl)
})
