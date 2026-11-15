import { Chain } from '@vultisig/core-chain/Chain'

import { NameServiceName } from './getNameServiceName'
import { NameService } from './NameService'
import { NameServiceResolution } from './NameServiceResolution'
import { NameServiceResolver } from './resolver'
import { ensResolver } from './resolvers/ens'
import { mayanameResolver } from './resolvers/mayaname'
import { thornameResolver } from './resolvers/thorname'

const resolvers: Record<NameService, NameServiceResolver> = {
  ens: ensResolver,
  thorname: thornameResolver,
  mayaname: mayanameResolver,
}

type IsNameServiceChainInput = {
  service: NameService
  chain: Chain
}

/** Whether a name service can hold an address for a chain at all. */
export const isNameServiceChain = ({ service, chain }: IsNameServiceChainInput): boolean =>
  resolvers[service].isChainSupported(chain)

type ResolveNameServiceNameInput = NameServiceName & {
  chain: Chain
}

/**
 * Looks a name up in its service and picks its address on `chain`. Throws only
 * when the service could not be reached, so an outage is never reported as a
 * missing name. A chain the service cannot hold resolves to
 * `noAddressForChain` without a request.
 */
export const resolveNameServiceName = async ({
  service,
  name,
  chain,
}: ResolveNameServiceNameInput): Promise<NameServiceResolution> => {
  const resolver = resolvers[service]

  if (!resolver.isChainSupported(chain)) {
    return { kind: 'noAddressForChain' }
  }

  return resolver.resolve({ name, chain })
}
