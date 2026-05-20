import { Connection } from '@solana/web3.js'
import { rootApiUrl } from '@vultisig/core-config'
import { memoize } from '@vultisig/lib-utils/memoize'

export const solanaRpcUrl = `${rootApiUrl}/solana/`

export const getSolanaClient = memoize(() => new Connection(solanaRpcUrl))
