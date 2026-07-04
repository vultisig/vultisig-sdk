// Arkis lender-side ABIs.
//
// Two supply paths are supported, mirroring the production Arkis app:
//   - ERC-4626 vaults: `deposit(uint256 assets, address receiver)`
//   - Standard Agreements: `deposit(uint128 amount)`
//
// We hand-roll the minimal ABI fragments (viem `encodeFunctionData`) rather
// than dragging an Arkis SDK — there is no RN/Hermes-safe official package, and
// the supply surface is a two-call ERC-20-approve + ERC-4626-deposit sequence.
//
// Read fragments (`asset`, `maxDeposit`, `decimals`, …) are used only by the
// optional on-chain resolver helpers; the calldata builder itself is pure.

export const erc4626WriteAbi = [
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'receiver', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const

export const erc4626ReadAbi = [
  {
    name: 'asset',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    name: 'maxDeposit',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'receiver', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const

export const standardAgreementWriteAbi = [
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint128' }],
    outputs: [],
  },
] as const
