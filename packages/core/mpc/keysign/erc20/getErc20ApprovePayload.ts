import { create } from '@bufbuild/protobuf'
import { EvmChain } from '@vultisig/core-chain/Chain'
import { getErc20Allowance } from '@vultisig/core-chain/chains/evm/erc20/getErc20Allowance'
import { isErc20AllowanceResetRequired } from '@vultisig/core-chain/chains/evm/erc20/isErc20AllowanceResetRequired'
import { AccountCoinKey } from '@vultisig/core-chain/coin/AccountCoin'
import { Token } from '@vultisig/core-chain/coin/Coin'

import { Erc20ApprovePayloadSchema } from '../../types/vultisig/keysign/v1/erc20_approve_payload_pb'

type GetErc20ApprovePayloadInput = Token<AccountCoinKey<EvmChain>> & {
  spender: string
  amount: bigint
}

/**
 * The `erc20ApprovePayload` a keysign needs so `spender` can pull `amount`,
 * or `undefined` when the current allowance already covers it. When a stale
 * non-zero allowance is too small, the approve is simulated: tokens such as
 * USDT reject a non-zero -> non-zero approve, and for those the payload asks
 * every signer to send `approve(0)` first (`resetAllowanceFirst`).
 */
export const getErc20ApprovePayload = async ({ spender, amount, ...token }: GetErc20ApprovePayloadInput) => {
  const allowance = await getErc20Allowance({ ...token, spender })

  if (allowance < amount) {
    const resetAllowanceFirst = allowance > 0n && (await isErc20AllowanceResetRequired({ ...token, spender, amount }))

    return create(Erc20ApprovePayloadSchema, {
      amount: amount.toString(),
      spender,
      resetAllowanceFirst,
    })
  }

  return undefined
}
