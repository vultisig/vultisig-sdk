import { SuiGrpcClient } from '@mysten/sui/grpc'
import { memoize } from '@vultisig/lib-utils/memoize'

import { suiGrpcUrl, suiNetwork } from './config'

/**
 * The Sui client every callsite programs against.
 *
 * `SuiGrpcClient` and `SuiGraphQLClient` both implement
 * `SuiClientTypes.TransportMethods`, so the React Native override
 * (`platforms/react-native/overrides/suiClient.ts`) can swap in the GraphQL
 * client without touching a single caller.
 */
export type SuiClient = SuiGrpcClient

export const getSuiClient = memoize(
  (): SuiClient =>
    new SuiGrpcClient({
      network: suiNetwork,
      baseUrl: suiGrpcUrl,
    })
)
