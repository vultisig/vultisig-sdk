/** Curated Kamino Earn helpers. Builders return unsigned, unvalidated transactions. */

export type {
  KaminoAmount,
  KaminoShareAmount,
  KaminoTokenAmount,
} from '@vultisig/core-chain/chains/solana/kamino/amount'
export {
  isValidKaminoRequestAmount,
  kaminoShareAmount,
  kaminoShareAmountFromDecimalString,
  kaminoShareToTokenValue,
  kaminoShareToTokenValueRoundedUp,
  kaminoTokenAmount,
  kaminoTokenAmountFromBaseUnitString,
  kaminoTokenAmountFromDecimalString,
  kaminoTokenToShareAmount,
  kaminoTokenToShareAmountRoundedUp,
} from '@vultisig/core-chain/chains/solana/kamino/amount'
export { fetchKaminoUserPositions } from '@vultisig/core-chain/chains/solana/kamino/api'
export type { KaminoServiceErrorReason } from '@vultisig/core-chain/chains/solana/kamino/KaminoServiceError'
export { KaminoServiceError } from '@vultisig/core-chain/chains/solana/kamino/KaminoServiceError'
export type { KaminoUserPositionResponse, KaminoVaultInfo } from '@vultisig/core-chain/chains/solana/kamino/models'
export type { KaminoSharePosition } from '@vultisig/core-chain/chains/solana/kamino/position'
export { parseKaminoSharePosition } from '@vultisig/core-chain/chains/solana/kamino/position'
export type { KaminoRate } from '@vultisig/core-chain/chains/solana/kamino/rate'
export type { KaminoRiskTier, KaminoVaultDescriptor } from '@vultisig/core-chain/chains/solana/kamino/registry'
export { getKaminoVaultDescriptor, kaminoVaultRegistry } from '@vultisig/core-chain/chains/solana/kamino/registry'
export {
  buildKaminoDepositTransaction,
  buildKaminoWithdrawTransaction,
} from '@vultisig/core-chain/chains/solana/kamino/tx/actions'
export type {
  KaminoOperationIntent,
  KaminoPriorityFee,
  KaminoTransactionIntent,
  KaminoValidationFinding,
  KaminoWithdrawRequest,
} from '@vultisig/core-chain/chains/solana/kamino/tx/validate'
export {
  KaminoValidationError,
  validateKaminoTransaction,
  validateKaminoTransactionOnline,
} from '@vultisig/core-chain/chains/solana/kamino/tx/validate'
export { KaminoWireError, parseKaminoWireTransaction } from '@vultisig/core-chain/chains/solana/kamino/tx/wire'
export { fetchKaminoVaultInfo } from '@vultisig/core-chain/chains/solana/kamino/vaultInfo'
