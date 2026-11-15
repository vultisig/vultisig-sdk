import { Chain } from '@vultisig/core-chain/Chain'

import { NameService, nameServices, nameServiceSuffix } from './NameService'

/** A recipient typed as a name: the service that owns its suffix, and the full name trimmed and lowercased. */
export type NameServiceName = {
  service: NameService
  name: string
}

// THORNode and MAYANode register names of 1-30 of these characters. ENS
// labels are left to `normalize`, which rejects what ENS cannot hold.
const labelPattern: Record<NameService, RegExp> = {
  ens: /^\S+$/,
  thorname: /^[a-z0-9+_-]{1,30}$/,
  mayaname: /^[a-z0-9+_-]{1,30}$/,
}

/**
 * Reads a typed recipient as a name-service name by its suffix (`.eth`,
 * `.thor`, `.maya`). Returns null for anything else, raw addresses included.
 */
export const getNameServiceName = (input: string): NameServiceName | null => {
  const name = input.trim().toLowerCase()

  const service = nameServices.find(service => {
    const suffix = `.${nameServiceSuffix[service]}`

    return name.endsWith(suffix) && labelPattern[service].test(name.slice(0, -suffix.length))
  })

  return service ? { service, name } : null
}

// The chain each name service belongs to, where its names may be typed
// without a suffix.
const bareNameService: Partial<Record<Chain, NameService>> = {
  [Chain.THORChain]: 'thorname',
  [Chain.MayaChain]: 'mayaname',
  [Chain.Ethereum]: 'ens',
}

type GetBareNameServiceNameInput = {
  input: string
  chain: Chain
}

/**
 * Reads a recipient typed without a suffix as a name of the chain's own name
 * service, returning the full suffixed name: `vi` is `vi.thor` on THORChain,
 * `vi.maya` on MayaChain and `vi.eth` on Ethereum. Null on any other chain,
 * where a name needs its suffix.
 *
 * Check that the input is not an address first: an Ethereum address reads as
 * an ENS label too.
 */
export const getBareNameServiceName = ({ input, chain }: GetBareNameServiceNameInput): NameServiceName | null => {
  const service = bareNameService[chain]
  const label = input.trim().toLowerCase()

  return service && labelPattern[service].test(label)
    ? { service, name: `${label}.${nameServiceSuffix[service]}` }
    : null
}
