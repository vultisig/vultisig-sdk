export type Eip2612PermitMessage = {
  owner: string
  spender: string
  value: string
  nonce: number
  deadline: number
}

export type Eip2612PermitDomain = {
  name: string
  version: string
  chainId: number
  verifyingContract: string
}

export type Eip2612PermitTypedData = {
  primaryType: 'Permit'
  domain: Eip2612PermitDomain
  types: {
    Permit: Array<{ name: string; type: string }>
  }
  message: Eip2612PermitMessage
}

export type BuildEip2612PermitInput = {
  tokenAddress: string
  tokenName: string
  chainId: number
  owner: string
  spender: string
  value: bigint
  nonce: number
  deadline: number
}

const PERMIT_TYPES = [
  { name: 'owner', type: 'address' },
  { name: 'spender', type: 'address' },
  { name: 'value', type: 'uint256' },
  { name: 'nonce', type: 'uint256' },
  { name: 'deadline', type: 'uint256' },
]

/** Build EIP-2612 Permit typed data for a known-permit-token.
 * The token must be in KNOWN_PERMIT_TOKENS for the chain — callers are
 * responsible for checking eligibility before calling this function. */
export function buildEip2612Permit({
  tokenAddress,
  tokenName,
  chainId,
  owner,
  spender,
  value,
  nonce,
  deadline,
}: BuildEip2612PermitInput): Eip2612PermitTypedData {
  return {
    primaryType: 'Permit',
    domain: {
      name: tokenName,
      version: '1',
      chainId,
      verifyingContract: tokenAddress,
    },
    types: {
      Permit: PERMIT_TYPES,
    },
    message: {
      owner: owner.toLowerCase(),
      spender: spender.toLowerCase(),
      value: value.toString(),
      nonce,
      deadline,
    },
  }
}
