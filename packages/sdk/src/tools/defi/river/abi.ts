/**
 * Hand-rolled viem ABIs for the River Omni-CDP (Satoshi) contracts.
 *
 * Per the DeFi lib-vs-handroll decision, River ships no RN-safe SDK, so we
 * encode calldata directly from the public contract ABIs via viem.
 */

export const RIVER_FACTORY_ABI = [
  { type: 'function', name: 'troveManagerCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    type: 'function',
    name: 'troveManagers',
    stateMutability: 'view',
    inputs: [{ type: 'uint256' }],
    outputs: [{ type: 'address' }],
  },
  { type: 'function', name: 'gasCompensation', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const

export const RIVER_TROVE_MANAGER_ABI = [
  { type: 'function', name: 'collateralToken', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'sortedTroves', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'MCR', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    type: 'function',
    name: 'getTroveOwnersCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getTroveStatus',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getEntireDebtAndColl',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
  },
  { type: 'function', name: 'fetchPrice', stateMutability: 'nonpayable', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    type: 'function',
    name: 'getCurrentICR',
    stateMutability: 'view',
    inputs: [{ type: 'address' }, { type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getBorrowingFeeWithDecay',
    stateMutability: 'view',
    inputs: [{ type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getNominalICR',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getTroveCollAndDebt',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'uint256' }, { type: 'uint256' }],
  },
] as const

export const RIVER_SORTED_TROVES_ABI = [
  { type: 'function', name: 'getFirst', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  {
    type: 'function',
    name: 'getNext',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'address' }],
  },
] as const

export const RIVER_BORROWER_OPS_ABI = [
  {
    type: 'function',
    name: 'isApprovedDelegate',
    stateMutability: 'view',
    inputs: [{ type: 'address' }, { type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'setDelegateApproval',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'address' }, { type: 'bool' }],
    outputs: [],
  },
  { type: 'function', name: 'minNetDebt', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const

export const RIVER_PERIPHERY_ABI = [
  {
    type: 'function',
    name: 'openTrove',
    stateMutability: 'payable',
    inputs: [
      { type: 'address', name: 'troveManager' },
      { type: 'uint256', name: 'maxFeePercentage' },
      { type: 'uint256', name: 'collAmount' },
      { type: 'uint256', name: 'debtAmount' },
      { type: 'address', name: 'upperHint' },
      { type: 'address', name: 'lowerHint' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'closeTrove',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'address', name: 'troveManager' }],
    outputs: [],
  },
] as const
