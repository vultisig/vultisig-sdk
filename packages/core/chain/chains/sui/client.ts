import { memoize } from '@vultisig/lib-utils/memoize'
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'

// `@mysten/sui` evaluates `new Intl.PluralRules(...)` at module top-level
// (see `@mysten/sui/dist/client/utils.mjs`). Hermes ships without
// `Intl.PluralRules`, so importing eagerly crashes `sdk.initialize()`.
// Keep the import dynamic so the module graph only loads when a Sui
// call-site runs.
export const getSuiClient = memoize(
  async (): Promise<SuiJsonRpcClient> => {
    const { SuiJsonRpcClient } = await import('@mysten/sui/jsonRpc')
    return new SuiJsonRpcClient({
      url: 'https://sui-rpc.publicnode.com',
      network: 'mainnet',
    })
  }
)
