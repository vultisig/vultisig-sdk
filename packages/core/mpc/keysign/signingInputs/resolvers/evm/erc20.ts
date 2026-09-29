import { EvmChain } from '@vultisig/core-chain/Chain'
import { getEvmTwFeeFields } from '@vultisig/core-chain/chains/evm/tx/fee/tw/getEvmTwFeeFields'
import { getEvmTwChainId } from '@vultisig/core-chain/chains/evm/tx/tw/getEvmTwChainId'
import { getEvmTwNonce } from '@vultisig/core-chain/chains/evm/tx/tw/getEvmTwNonce'
import { toEvmTwAmount } from '@vultisig/core-chain/chains/evm/tx/tw/toEvmTwAmount'
import { EthereumSpecific } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { TW, WalletCore } from '@trustwallet/wallet-core'

import { getErc20ApproveAmounts } from '../../../erc20/getErc20ApproveAmounts'
import { incrementKeysignPayloadNonce } from './incrementKeysignPayloadNonce'

type Input = {
  keysignPayload: KeysignPayload
  walletCore: WalletCore
}

const buildErc20ApproveSigningInput = ({ keysignPayload, walletCore, amount }: Input & { amount: bigint }) => {
  const { spender } = shouldBePresent(keysignPayload.erc20ApprovePayload)

  const coin = shouldBePresent(keysignPayload.coin)
  const chain = coin.chain as EvmChain

  const { blockchainSpecific } = keysignPayload

  const evmSpecific = blockchainSpecific.value as EthereumSpecific

  const { nonce, maxFeePerGasWei, priorityFee, gasLimit } = evmSpecific

  return TW.Ethereum.Proto.SigningInput.create({
    transaction: {
      erc20Approve: {
        amount: toEvmTwAmount(amount),
        spender,
      },
    },
    chainId: getEvmTwChainId({
      walletCore,
      chain,
    }),
    nonce: getEvmTwNonce(nonce),
    toAddress: shouldBePresent(keysignPayload.coin).contractAddress,
    ...getEvmTwFeeFields({
      chain,
      maxFeePerGasWei: BigInt(maxFeePerGasWei),
      priorityFee: BigInt(priorityFee),
      gasLimit: BigInt(gasLimit),
    }),
  })
}

/**
 * The `approve(spender, amount)` signing input for the payload's
 * `erc20ApprovePayload`, at the payload's own nonce.
 */
export const getErc20ApproveSigningInput = ({ keysignPayload, walletCore }: Input) => {
  const { amount } = shouldBePresent(keysignPayload.erc20ApprovePayload)

  return buildErc20ApproveSigningInput({ keysignPayload, walletCore, amount: BigInt(amount) })
}

/**
 * Every approve leg the payload's `erc20ApprovePayload` asks for, in nonce
 * order: an `approve(spender, 0)` reset first when `resetAllowanceFirst` is
 * set (USDT-style tokens reject a non-zero -> non-zero approve), then
 * `approve(spender, amount)`. Each leg consumes one nonce; `nextKeysignPayload`
 * carries the nonce the transaction that follows the approvals must use.
 */
export const getErc20ApproveSigningInputs = ({ keysignPayload, walletCore }: Input) => {
  const amounts = getErc20ApproveAmounts(shouldBePresent(keysignPayload.erc20ApprovePayload))

  let nextKeysignPayload = keysignPayload
  const signingInputs = amounts.map(amount => {
    const signingInput = buildErc20ApproveSigningInput({
      keysignPayload: nextKeysignPayload,
      walletCore,
      amount: BigInt(amount),
    })
    nextKeysignPayload = incrementKeysignPayloadNonce(nextKeysignPayload)
    return signingInput
  })

  return { signingInputs, nextKeysignPayload }
}
