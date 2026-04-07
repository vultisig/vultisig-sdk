import type { Chain } from '@vultisig/core-chain/Chain'
import type { FeeSettings } from '@vultisig/core-mpc/keysign/chainSpecific/FeeSettings'
import type { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'

/**
 * Parameters for preparing a raw EVM contract call transaction.
 *
 * Uses viem-compatible ABI types — pass standard Solidity ABI fragments
 * or a full ABI array.
 */
export type ContractCallTxParams = {
  /** EVM chain to execute on */
  chain: Chain
  /** Target contract address (checksummed) */
  contractAddress: string
  /** Contract ABI (full ABI array or single-function fragment) */
  abi: readonly unknown[]
  /** Function name to call */
  functionName: string
  /** Function arguments (positional) */
  args?: readonly unknown[]
  /** Native token value to send with the call (default: 0n) */
  value?: bigint
  /** Sender address (vault's address on the target chain) */
  senderAddress: string
  /** Optional custom fee settings */
  feeSettings?: FeeSettings
}

/**
 * Result of the high-level contractCall() method.
 */
export type ContractCallResult =
  | { dryRun: false; txHash: string; chain: Chain }
  | { dryRun: true; keysignPayload: KeysignPayload }
