import { EvmChain } from '@vultisig/core-chain/Chain'
import { getEvmClient } from '@vultisig/core-chain/chains/evm/client'
import { attempt } from '@vultisig/lib-utils/attempt'
import { encodeFunctionData, erc20Abi } from 'viem'

import { AccountCoinKey } from '../../../coin/AccountCoin'
import { Token } from '../../../coin/Coin'

type IsErc20AllowanceResetRequiredInput = Token<AccountCoinKey<EvmChain>> & {
  spender: string
  amount: bigint
}

/**
 * Whether `approve(spender, amount)` must be preceded by `approve(spender, 0)`.
 * USDT-style tokens revert on a non-zero -> non-zero approve while a stale
 * allowance remains, so the approve is simulated from the owner's address and
 * a revert means the reset leg is needed. Only meaningful when the current
 * allowance is already non-zero; callers gate on that. A failed simulation for
 * any other reason also answers `true`: an extra `approve(0)` is always safe,
 * a reverted approve is not.
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

  return 'error' in simulation
}
