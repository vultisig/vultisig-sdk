import { EvmChain } from '@vultisig/core-chain/Chain'
import { getEvmClient } from '@vultisig/core-chain/chains/evm/client'
import { attempt } from '@vultisig/lib-utils/attempt'
import { BaseError, encodeFunctionData, erc20Abi, ExecutionRevertedError } from 'viem'

import { AccountCoinKey } from '../../../coin/AccountCoin'
import { Token } from '../../../coin/Coin'

type IsErc20AllowanceResetRequiredInput = Token<AccountCoinKey<EvmChain>> & {
  spender: string
  amount: bigint
}

// viem folds every node's "execution reverted" report, whatever JSON-RPC code
// or message shape the RPC uses, into an ExecutionRevertedError on the cause chain.
const isExecutionReverted = (error: unknown) =>
  error instanceof BaseError && Boolean(error.walk(cause => cause instanceof ExecutionRevertedError))

/**
 * Whether `approve(spender, amount)` must be preceded by `approve(spender, 0)`.
 * USDT-style tokens revert on a non-zero -> non-zero approve while a stale
 * allowance remains, so the approve is simulated from the owner's address and
 * a revert means the reset leg is needed. Only meaningful when the current
 * allowance is already non-zero; callers gate on that. A simulation that fails
 * for any other reason (transport, rate limit, node error) is no answer either
 * way and propagates, like the allowance read before it, rather than adding a
 * reset leg on a guess.
 */
export const isErc20AllowanceResetRequired = async ({
  chain,
  id,
  address,
  spender,
  amount,
}: IsErc20AllowanceResetRequiredInput) => {
  const publicClient = getEvmClient(chain)

  // A raw eth_call rather than simulateContract: only revert vs. success
  // matters here, and USDT-style `approve` returns no data, which decoding
  // against the standard ERC-20 ABI would misreport as a failed call.
  const simulation = await attempt(() =>
    publicClient.call({
      account: address as `0x${string}`,
      to: id as `0x${string}`,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [spender as `0x${string}`, amount],
      }),
    })
  )

  if ('data' in simulation) {
    return false
  }

  if (isExecutionReverted(simulation.error)) {
    return true
  }

  throw simulation.error
}
