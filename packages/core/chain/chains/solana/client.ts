import { rootApiUrl } from '@vultisig/core-config'
import { memoize } from '@vultisig/lib-utils/memoize'
import type { Connection } from '@solana/web3.js'

export const solanaRpcUrl = `${rootApiUrl}/solana/`

// `@solana/web3.js` transitively imports `rpc-websockets`, which does
// `import WebSocketImpl from 'ws'` at module top-level. React Native's
// Hermes runtime has no `ws` module, so evaluating this eagerly hangs
// `sdk.initialize()` before any Solana RPC is ever called. Keep the import
// dynamic so the module graph only loads when a Solana call-site executes.
export const getSolanaClient = memoize(
  async (): Promise<Connection> => {
    const { Connection } = await import('@solana/web3.js')
    return new Connection(solanaRpcUrl)
  }
)
