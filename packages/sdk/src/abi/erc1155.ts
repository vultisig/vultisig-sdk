/**
 * ERC-1155 Multi-Token Standard ABI fragments.
 *
 * Use with vault.prepareContractCallTx() or vault.contractCall() for
 * ERC-1155 operations. The standard erc20ApprovePayload does NOT work
 * for ERC-1155 tokens — use these ABIs with the contract call methods instead.
 *
 * @example
 * ```typescript
 * import { ERC1155_ABI, Chain } from '@vultisig/sdk'
 *
 * // Approve an operator for all your ERC-1155 tokens
 * await vault.contractCall({
 *   chain: Chain.Polygon,
 *   contractAddress: '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045', // CTF token
 *   abi: ERC1155_ABI,
 *   functionName: 'setApprovalForAll',
 *   args: ['0xC5d563A36AE78145C45a50134d48A1215220f80a', true], // operator, approved
 * })
 * ```
 */
export const ERC1155_ABI = [
  {
    name: 'setApprovalForAll',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'approved', type: 'bool' },
    ],
    outputs: [],
  },
  {
    name: 'isApprovedForAll',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'operator', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'id', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'safeTransferFrom',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'id', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'safeBatchTransferFrom',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'ids', type: 'uint256[]' },
      { name: 'amounts', type: 'uint256[]' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [],
  },
] as const
