import { productRootDomain } from '@vultisig/core-config'

import { queryBlockaid } from '../core/query'
import type { BlockaidAddressScanResult } from './core'

type BlockaidAddressScanResponse = {
  result_type: 'Benign' | 'Warning' | 'Malicious'
  features?: string[]
}

export const scanAddressWithBlockaid = async (address: string, chain: string): Promise<BlockaidAddressScanResult> => {
  const { result_type, features } = await queryBlockaid<BlockaidAddressScanResponse>('/evm/address/scan', {
    address,
    chain,
    metadata: { domain: productRootDomain },
  })
  return { resultType: result_type, features: features ?? [] }
}
