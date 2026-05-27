import { COW_SETTLEMENT_ADDRESS } from '../config'

export type Eip712Domain = {
  name: string
  version: string
  chainId: number
  verifyingContract: string
}

/** Build the EIP-712 domain separator for CowSwap GPv2. */
export function buildEip712Domain(chainId: number): Eip712Domain {
  return {
    name: 'Gnosis Protocol',
    version: 'v2',
    chainId,
    verifyingContract: COW_SETTLEMENT_ADDRESS,
  }
}
