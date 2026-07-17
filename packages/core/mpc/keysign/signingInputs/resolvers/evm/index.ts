import { Buffer } from 'buffer'
import { create } from '@bufbuild/protobuf'
import { getEvmTwFeeFields, GetEvmTwFeeFieldsInput } from '@vultisig/core-chain/chains/evm/tx/fee/tw/getEvmTwFeeFields'
import { incrementKeysignPayloadNonce } from './incrementKeysignPayloadNonce'
import { getEvmTwChainId } from '@vultisig/core-chain/chains/evm/tx/tw/getEvmTwChainId'
import { getEvmTwNonce } from '@vultisig/core-chain/chains/evm/tx/tw/getEvmTwNonce'
import { toEvmTwAmount } from '@vultisig/core-chain/chains/evm/tx/tw/toEvmTwAmount'
import { toEvmTxData } from '@vultisig/core-chain/chains/evm/tx/tw/toEvmTxData'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { matchRecordUnion } from '@vultisig/lib-utils/matchRecordUnion'
import { maxBigInt } from '@vultisig/lib-utils/math/maxBigInt'
import { assertField } from '@vultisig/lib-utils/record/assertField'
import { TW } from '@trustwallet/wallet-core'

import { KeysignPayloadSchema } from '../../../../types/vultisig/keysign/v1/keysign_message_pb'
import { assertKnownAggregatorRouterOnSigningPath } from '@vultisig/core-chain/swap/general/knownAggregatorRouters'

import { getBlockchainSpecificValue } from '../../../chainSpecific/KeysignChainSpecific'
import { getKeysignSwapPayload } from '../../../swap/getKeysignSwapPayload'
import { KeysignSwapPayload } from '../../../swap/KeysignSwapPayload'
import { toTwAddress } from '../../../tw/toTwAddress'
import { getIsGenericContractCall } from '../../../utils/getIsGenericContractCall'
import { getKeysignChain } from '../../../utils/getKeysignChain'
import { SigningInputsResolver } from '../../resolver'
import { getErc20ApproveSigningInput } from './erc20'

const memoToTxData = (memo: string) => (memo.startsWith('0x') ? toEvmTxData(memo) : Buffer.from(memo, 'utf8'))

export const getEvmSigningInputs: SigningInputsResolver<'evm'> = async ({ keysignPayload, walletCore }) => {
  const chain = getKeysignChain<'evm'>(keysignPayload)
  const coin = assertField(keysignPayload, 'coin')

  const { erc20ApprovePayload, ...restOfKeysignPayload } = keysignPayload

  if (erc20ApprovePayload) {
    const approveSigningInput = getErc20ApproveSigningInput({
      keysignPayload,
      walletCore,
    })

    const restOfSigningInputs = await getEvmSigningInputs({
      keysignPayload: incrementKeysignPayloadNonce(create(KeysignPayloadSchema, restOfKeysignPayload)),
      walletCore,
    })

    return [approveSigningInput, ...restOfSigningInputs]
  }

  const evmSpecific = getBlockchainSpecificValue(keysignPayload.blockchainSpecific, 'ethereumSpecific')

  const { nonce } = evmSpecific

  const swapPayload = getKeysignSwapPayload(keysignPayload)

  // sdk#1358 fund-safety: re-assert the aggregator router allow-list HERE, on the co-signer
  // signing-input path, not only at quote construction. quote.tx.to becomes this SigningInput's
  // destination (getToAddress/getTransaction general arms below) AND the ERC-20 approval spender
  // (build.ts) - a compromised initiator can hand a co-signer a payload whose tx.to was never
  // quote-checked, and every co-signer independently rebuilds the input from that payload. Fail
  // closed for enforced providers (1inch/kyber); log-only for the unenforced ones, matching the
  // quote-time policy. A pure gate: it throws or no-ops, never changes the signed bytes, so it
  // cannot desync the cross-device pre-signing hash.
  if (swapPayload && 'general' in swapPayload) {
    const { provider, quote } = swapPayload.general
    // Pass the raw (possibly empty) destination unconditionally: for an enforced provider an empty
    // `to` must ALSO fail closed (the helper rejects it as unrecognized), not be silently skipped.
    assertKnownAggregatorRouterOnSigningPath(provider, quote?.tx?.to ?? '', chain)
  }

  // A token coin carrying raw `0x` calldata with a zero `toAmount` (and no swap)
  // is a generic contract call (e.g. staking depositFor, whose token amount lives
  // in the calldata) rather than a plain ERC-20 transfer: send the calldata to
  // `toAddress` instead of building a transfer to `coin.contractAddress`. Shared
  // with the fee-quote and Blockaid resolvers so they target the same call.
  const isGenericContractCall = getIsGenericContractCall(keysignPayload)

  const getToAddress = () => {
    if (swapPayload) {
      return matchRecordUnion<KeysignSwapPayload, string>(swapPayload, {
        native: ({ vaultAddress, routerAddress }) =>
          coin.isNativeToken ? vaultAddress : shouldBePresent(routerAddress),
        general: ({ quote }) => shouldBePresent(quote?.tx?.to),
      })
    }

    if (coin.isNativeToken || isGenericContractCall) {
      return keysignPayload.toAddress
    }

    return coin.contractAddress
  }

  const getTransaction = (): TW.Ethereum.Proto.ITransaction => {
    if (swapPayload) {
      return matchRecordUnion<KeysignSwapPayload, TW.Ethereum.Proto.ITransaction>(swapPayload, {
        native: ({ fromCoin, fromAmount, vaultAddress, expirationTime }) => {
          const { isNativeToken } = shouldBePresent(fromCoin)

          const memo = shouldBePresent(keysignPayload.memo)

          if (isNativeToken) {
            return {
              transfer: TW.Ethereum.Proto.Transaction.Transfer.create({
                amount: toEvmTwAmount(fromAmount),
                data: memoToTxData(memo),
              }),
            }
          }

          const abiFunction = walletCore.EthereumAbiFunction.createWithString('depositWithExpiry')

          abiFunction.addParamAddress(
            toTwAddress({
              address: vaultAddress,
              walletCore,
              chain,
            }),
            false
          )
          abiFunction.addParamAddress(
            toTwAddress({
              address: shouldBePresent(fromCoin?.contractAddress),
              walletCore,
              chain,
            }),
            false
          )
          abiFunction.addParamUInt256(toEvmTwAmount(fromAmount), false)
          abiFunction.addParamString(memo, false)
          abiFunction.addParamUInt256(toEvmTwAmount(expirationTime), false)

          const data = walletCore.EthereumAbi.encode(abiFunction)

          return {
            contractGeneric: TW.Ethereum.Proto.Transaction.ContractGeneric.create({
              amount: toEvmTwAmount(0),
              data,
            }),
          }
        },
        general: ({ quote }) => {
          const { data, value } = shouldBePresent(quote?.tx)

          return {
            contractGeneric: TW.Ethereum.Proto.Transaction.ContractGeneric.create({
              amount: toEvmTwAmount(value),
              data: toEvmTxData(data),
            }),
          }
        },
      })
    }

    const amount = toEvmTwAmount(keysignPayload.toAmount)

    if (coin.isNativeToken) {
      return {
        transfer: TW.Ethereum.Proto.Transaction.Transfer.create({
          amount,
          data: keysignPayload.memo ? memoToTxData(shouldBePresent(keysignPayload.memo)) : undefined,
        }),
      }
    }

    if (isGenericContractCall) {
      return {
        contractGeneric: TW.Ethereum.Proto.Transaction.ContractGeneric.create({
          amount,
          data: toEvmTxData(shouldBePresent(keysignPayload.memo)),
        }),
      }
    }

    return {
      erc20Transfer: TW.Ethereum.Proto.Transaction.ERC20Transfer.create({
        amount,
        to: keysignPayload.toAddress,
      }),
    }
  }

  const getFeeFields = () => {
    const input: GetEvmTwFeeFieldsInput = {
      chain,
      maxFeePerGasWei: BigInt(evmSpecific.maxFeePerGasWei),
      priorityFee: BigInt(evmSpecific.priorityFee),
      gasLimit: BigInt(evmSpecific.gasLimit),
    }
    if (swapPayload && 'general' in swapPayload) {
      const { gasPrice, gas } = shouldBePresent(swapPayload.general.quote?.tx)
      input.maxFeePerGasWei = maxBigInt(BigInt(gasPrice), input.maxFeePerGasWei)
      if (BigInt(gas) > input.gasLimit) {
        input.gasLimit = BigInt(gas)
      }
    }

    return getEvmTwFeeFields(input)
  }

  const input = TW.Ethereum.Proto.SigningInput.create({
    toAddress: getToAddress(),
    transaction: TW.Ethereum.Proto.Transaction.create(getTransaction()),
    chainId: getEvmTwChainId({
      walletCore,
      chain,
    }),
    nonce: getEvmTwNonce(nonce),
    ...getFeeFields(),
  })

  return [input]
}
