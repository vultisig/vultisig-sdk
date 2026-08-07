import type { CosmosChain } from '@vultisig/core-chain/Chain'

export const cosmosTxFeeGasParityCases = [
  { chain: 'THORChain', feeDenom: 'rune', feeAmount: undefined, gasLimit: 20_000_000n },
  { chain: 'Cosmos', feeDenom: 'uatom', feeAmount: 7_500n, gasLimit: 200_000n },
  { chain: 'Osmosis', feeDenom: 'uosmo', feeAmount: 9_000n, gasLimit: 300_000n },
  { chain: 'MayaChain', feeDenom: 'cacao', feeAmount: 2_000_000_000n, gasLimit: 2_000_000_000n },
  { chain: 'Dydx', feeDenom: 'adydx', feeAmount: 2_500_000_000_000_000n, gasLimit: 200_000n },
  { chain: 'Kujira', feeDenom: 'ukuji', feeAmount: 7_500n, gasLimit: 200_000n },
  { chain: 'Terra', feeDenom: 'uluna', feeAmount: 7_500n, gasLimit: 300_000n },
  { chain: 'TerraClassic', feeDenom: 'uluna', feeAmount: 8_497_500n, gasLimit: 300_000n },
  { chain: 'Noble', feeDenom: 'uusdc', feeAmount: 30_000n, gasLimit: 200_000n },
  { chain: 'Akash', feeDenom: 'uakt', feeAmount: 200_000n, gasLimit: 200_000n },
] as const satisfies ReadonlyArray<{
  chain: CosmosChain
  feeDenom: string
  feeAmount: bigint | undefined
  gasLimit: bigint
}>
