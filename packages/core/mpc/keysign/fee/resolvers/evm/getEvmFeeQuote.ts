import { Chain, EvmChain } from '@vultisig/core-chain/Chain'
import { evmChainInfo } from '@vultisig/core-chain/chains/evm/chainInfo'
import { getEvmClient } from '@vultisig/core-chain/chains/evm/client'
import { evmChainTxFeeFormat } from '@vultisig/core-chain/chains/evm/tx/fee'
import { getEvmBaseFee } from '@vultisig/core-chain/tx/fee/evm/baseFee'
import { clampEvmPriorityFee } from '@vultisig/core-chain/tx/fee/evm/clampEvmPriorityFee'
import {
  evmRouterDepositGasLimit,
  getEvmContractCallGasLimit,
  getEvmTransferGasLimit,
} from '@vultisig/core-chain/tx/fee/evm/evmGasLimit'
import { getEvmGasPrice } from '@vultisig/core-chain/tx/fee/evm/gasPrice'
import { getEvmMaxPriorityFeePerGas } from '@vultisig/core-chain/tx/fee/evm/maxPriorityFeePerGas'
import { FeeSettings } from '@vultisig/core-mpc/keysign/chainSpecific/FeeSettings'
import { getKeysignSwapPayload } from '@vultisig/core-mpc/keysign/swap/getKeysignSwapPayload'
import { KeysignSwapPayload } from '@vultisig/core-mpc/keysign/swap/KeysignSwapPayload'
import { getIsGenericContractCall } from '@vultisig/core-mpc/keysign/utils/getIsGenericContractCall'
import { getKeysignAmount } from '@vultisig/core-mpc/keysign/utils/getKeysignAmount'
import { getKeysignCoin } from '@vultisig/core-mpc/keysign/utils/getKeysignCoin'
import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { attempt, withFallback } from '@vultisig/lib-utils/attempt'
import { bigIntMax } from '@vultisig/lib-utils/bigint/bigIntMax'
import { formatDataToHex } from '@vultisig/lib-utils/formatDataToHex'
import { match } from '@vultisig/lib-utils/match'
import { matchRecordUnion } from '@vultisig/lib-utils/matchRecordUnion'
import { encodeFunctionData, erc20Abi, isHex } from 'viem'
import { publicActionsL2 } from 'viem/zksync'

/**
 * What a transaction does on-chain, which decides how much headroom its gas
 * limit and its gas price are signed with.
 */
type EvmTxKind = 'transfer' | 'contractCall' | 'swap' | 'routerDeposit'

type EvmFeeQuote = {
  gasLimit: bigint
  baseFeePerGas: bigint
  maxPriorityFeePerGas: bigint
}

type GetEvmFeeQuoteInput = {
  keysignPayload: KeysignPayload
  feeSettings?: FeeSettings<'evm'>
  /** Gas limit the transaction's author (a dApp, an aggregator route) asks for. */
  thirdPartyGasLimitEstimation?: bigint
  /** Extra floor on the fallback taken when the transaction cannot be simulated. */
  minimumGasLimit?: bigint
}

const percentOf = (value: bigint, percent: bigint) => (value * percent) / 100n

// Half again on top of a simulated contract call: a route that turns out to need
// slightly more gas than its simulation would otherwise revert and forfeit the gas.
const inflateGasLimit = (value: bigint) => value + value / 2n

const getEvmTxKind = (keysignPayload: KeysignPayload, swapPayload: KeysignSwapPayload | undefined): EvmTxKind => {
  if (swapPayload) {
    return 'general' in swapPayload ? 'swap' : 'routerDeposit'
  }

  const { memo } = keysignPayload

  if (getIsGenericContractCall(keysignPayload) || (memo && isHex(memo))) {
    return 'contractCall'
  }

  return 'transfer'
}

export const getEvmFeeQuote = async ({
  keysignPayload,
  feeSettings,
  thirdPartyGasLimitEstimation,
  minimumGasLimit,
}: GetEvmFeeQuoteInput): Promise<EvmFeeQuote> => {
  const coin = getKeysignCoin<EvmChain>(keysignPayload)
  const { chain, address } = coin
  const client = getEvmClient(chain)
  const amount = getKeysignAmount(keysignPayload)
  const receiver = keysignPayload.toAddress
  const data = keysignPayload.memo ? formatDataToHex(keysignPayload.memo) : undefined
  const swapPayload = getKeysignSwapPayload(keysignPayload)
  const kind = getEvmTxKind(keysignPayload, swapPayload)

  const fallbackGasLimit = bigIntMax(
    match(kind, {
      transfer: () => getEvmTransferGasLimit(coin),
      contractCall: () => getEvmContractCallGasLimit(chain),
      swap: () => getEvmContractCallGasLimit(chain),
      routerDeposit: () => evmRouterDepositGasLimit,
    }),
    minimumGasLimit ?? 0n
  )
  const requestedGasLimit = thirdPartyGasLimitEstimation ?? 0n

  const resolveGasLimit = (estimatedGasLimit: bigint | undefined): bigint =>
    match(kind, {
      // A transfer costs what its simulation says, raised to the per-chain floor.
      transfer: () => bigIntMax(estimatedGasLimit ?? 0n, fallbackGasLimit, requestedGasLimit),
      // A contract call gets headroom over its simulation (or the fallback), and
      // never less than what its author asked for.
      contractCall: () => inflateGasLimit(bigIntMax(estimatedGasLimit ?? fallbackGasLimit, requestedGasLimit)),
      // A swap is signed with the larger of the route's own gas and the inflated
      // simulation; a route that carries no gas figure counts as the fallback.
      swap: () =>
        bigIntMax(
          requestedGasLimit > 0n ? requestedGasLimit : fallbackGasLimit,
          inflateGasLimit(estimatedGasLimit ?? fallbackGasLimit)
        ),
      routerDeposit: () => bigIntMax(fallbackGasLimit, requestedGasLimit),
    })

  const isLegacyPriced = evmChainTxFeeFormat[chain] === 'legacy'

  // Headroom against the base fee rising while the keysign runs: 20% on
  // everything, plus 10% on aggregator swaps, whose quotes go stale fastest
  // and whose reverts cost the most.
  const withBaseFeeHeadroom = (baseFee: bigint) =>
    kind === 'swap' ? percentOf(percentOf(baseFee, 110n), 120n) : percentOf(baseFee, 120n)

  // A legacy-priced chain has a single gas price; a swap gets 10% on top of it.
  const withGasPriceHeadroom = (gasPrice: bigint) => (kind === 'swap' ? percentOf(gasPrice, 110n) : gasPrice)

  const getBaseFeePerGas = async () =>
    isLegacyPriced ? withGasPriceHeadroom(await getEvmGasPrice(chain)) : withBaseFeeHeadroom(await getEvmBaseFee(chain))

  const getMaxPriorityFeePerGas = async () =>
    isLegacyPriced ? 0n : clampEvmPriorityFee(chain, await getEvmMaxPriorityFeePerGas(chain))

  const getEstimateGasParams = async () => {
    if (swapPayload) {
      return matchRecordUnion<
        KeysignSwapPayload,
        {
          to: `0x${string}`
          value: bigint
          data: `0x${string}`
        } | null
      >(swapPayload, {
        native: () => null,
        general: ({ quote }) => {
          // A token route cannot be simulated until its allowance exists, so it
          // is sized from the route's own gas and the swap fallback instead.
          if (coin.id || !quote?.tx) {
            return null
          }

          const { to, data, value } = quote.tx

          if (!to || !data) {
            return null
          }

          const txValue = value?.startsWith('0x') ? BigInt(value) : value ? BigInt(value) : 0n

          return {
            to: to as `0x${string}`,
            value: txValue,
            data: data as `0x${string}`,
          }
        },
      })
    }

    if (!receiver) {
      return null
    }

    // Native send, or a generic contract call (e.g. staking depositFor): estimate
    // against `memo` calldata sent to `toAddress`. For a generic call `amount` is
    // 0 (zero toAmount), so this also covers its zero value — and crucially avoids
    // estimating a synthetic ERC-20 transfer to coin.id.
    if (getIsGenericContractCall(keysignPayload) || !coin.id) {
      return {
        to: receiver as `0x${string}`,
        value: amount,
        data,
      }
    }

    const transferData = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [receiver as `0x${string}`, amount],
    })

    return {
      to: coin.id as `0x${string}`,
      value: 0n,
      data: transferData,
    }
  }

  const getFeeData = async (): Promise<EvmFeeQuote> => {
    if (feeSettings) {
      return {
        gasLimit: feeSettings.gasLimit,
        baseFeePerGas: await getBaseFeePerGas(),
        maxPriorityFeePerGas: feeSettings.maxPriorityFeePerGas,
      }
    }

    if (chain === Chain.Zksync) {
      const estimateGasParams = await getEstimateGasParams()
      if (estimateGasParams) {
        const result = await attempt(
          client.extend(publicActionsL2()).estimateFee({
            chain: evmChainInfo[chain as EvmChain],
            account: coin.address as `0x${string}`,
            to: estimateGasParams.to,
            value: estimateGasParams.value,
            data: estimateGasParams.data,
          })
        )
        if (result.data) {
          const { gasLimit, maxFeePerGas, maxPriorityFeePerGas } = result.data
          return {
            gasLimit: resolveGasLimit(gasLimit),
            // Floor at 0: on the zkSync path baseFeePerGas is derived from the
            // raw split, but downstream maxFeePerGas is rebuilt as
            // baseFeePerGas + clamp(priority). A compromised RPC returning a
            // malformed tuple (maxFee < priority, the exact clamp-attack case)
            // would otherwise yield a negative baseFeePerGas and a negative
            // signed maxFeePerGas. Flooring keeps the rebuilt maxFee >= the
            // clamped tip and preserves the "never emits a malformed value"
            // contract (NeOMakinG preferably-blocking on #1078 / SDK2-01).
            baseFeePerGas: bigIntMax(0n, maxFeePerGas - maxPriorityFeePerGas),
            maxPriorityFeePerGas: clampEvmPriorityFee(chain, maxPriorityFeePerGas),
          }
        }
      }
    }
    const estimateGasParams = await getEstimateGasParams()

    const estimatedGasLimit = estimateGasParams
      ? await withFallback(
          attempt(
            client.estimateGas({
              account: address as `0x${string}`,
              to: estimateGasParams.to,
              value: estimateGasParams.value,
              data: estimateGasParams.data,
            })
          ),
          undefined
        )
      : undefined

    const [baseFeePerGas, maxPriorityFeePerGas] = await Promise.all([getBaseFeePerGas(), getMaxPriorityFeePerGas()])

    return {
      gasLimit: resolveGasLimit(estimatedGasLimit),
      baseFeePerGas,
      maxPriorityFeePerGas,
    }
  }

  return await getFeeData()
}
