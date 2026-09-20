import { Connection } from '@solana/web3.js'
import { memoize } from '@vultisig/lib-utils/memoize'

import { solanaRpcUrl } from './config'

export { solanaRpcUrl } from './config'

export const getSolanaClient = memoize(() => new Connection(solanaRpcUrl))
