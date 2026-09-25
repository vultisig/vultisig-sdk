import { EvmChain } from '@vultisig/core-chain/Chain'
import { getEvmClient } from '@vultisig/core-chain/chains/evm/client'
import { attempt, withFallback } from '@vultisig/lib-utils/attempt'
import { bigIntMax } from '@vultisig/lib-utils/bigint/bigIntMax'

import { l1FeeProbeData } from './l1FeeProbeData'
import { OpStackChain } from './opStackChains'

/** Canonical `GasPriceOracle` predeploy address, identical on every OP-stack rollup. */
const gasPriceOracleAddress = '0x420000000000000000000000000000000000000F'

// `getL1Fee(bytes)` is preferred over the purpose-built `getL1FeeUpperBound(uint256)`,
// which only exists from Fjord onwards — Blast's oracle predates it, while
// `getL1Fee` has been there since Bedrock. `getOperatorFee(uint256)` arrives with
// Isthmus and simply reverts on older oracles, which reads the same as "this chain
// charges no operator fee".
const gasPriceOracleAbi = [
  {
    name: 'getL1Fee',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_data', type: 'bytes' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getOperatorFee',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_gasUsed', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'tokenRatio',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

// Serialized size, in bytes, that the L1-fee probe stands in for on top of the
// transaction's own calldata. The oracle wants the UNSIGNED transaction and adds
// its own 68-byte allowance for the signature, so this models the ~70-byte
// unsigned EIP-1559 envelope with deliberate margin: the transaction is not built
// yet when its fee has to be reserved, and over-reserving leaves dust behind
// where under-reserving costs a broadcast rejected after the keysign ceremony has
// already run.
const unsignedTxEnvelopeSize = 160

type GetOpStackFeeSurchargeInput = {
  chain: OpStackChain
  gasLimit: bigint
  callDataSize: number
}

/**
 * The two terms op-geth adds to the balance check it runs before executing a
 * transaction: the L1 data-availability cost and, from Isthmus onwards, the
 * operator fee. The chain requires
 * `value + gasLimit * maxFeePerGas + l1Cost + operatorCost` to be covered, so an
 * amount that leaves only the gas term behind is rejected by exactly this much.
 *
 * Outside Mantle, both terms fail open independently. A pre-Isthmus oracle reverts on
 * `getOperatorFee`, and letting that failure take the L1 data fee down with it
 * would leave the chain reserving nothing at all — a fee that cannot be read
 * must never block a send that worked before. A negative answer is nonsense from
 * a fee oracle and is floored rather than passed on to widen a max amount.
 * Mantle's node multiplies the oracle's L1 answer by `tokenRatio` during its
 * balance check. Both reads must succeed there; an unscaled fallback would
 * produce a max amount that the sequencer rejects after signing. Give that
 * dynamic L1 term the same 20% headroom as the EVM base fee during signing.
 */
export const getOpStackFeeSurcharge = async ({
  chain,
  gasLimit,
  callDataSize,
}: GetOpStackFeeSurchargeInput): Promise<bigint> => {
  const client = getEvmClient(chain)

  const l1DataFeeRead = client.readContract({
    address: gasPriceOracleAddress,
    abi: gasPriceOracleAbi,
    functionName: 'getL1Fee',
    args: [l1FeeProbeData(unsignedTxEnvelopeSize + callDataSize)],
  })
  const l1DataFee = chain === EvmChain.Mantle ? l1DataFeeRead : withFallback(attempt(l1DataFeeRead), 0n)

  const l1FeeMultiplier =
    chain === EvmChain.Mantle
      ? client.readContract({
          address: gasPriceOracleAddress,
          abi: gasPriceOracleAbi,
          functionName: 'tokenRatio',
        })
      : Promise.resolve(1n)

  const operatorFee =
    gasLimit > 0n
      ? withFallback(
          attempt(
            client.readContract({
              address: gasPriceOracleAddress,
              abi: gasPriceOracleAbi,
              functionName: 'getOperatorFee',
              args: [gasLimit],
            })
          ),
          0n
        )
      : Promise.resolve(0n)

  const [unscaledL1Fee, ratio, operatorCost] = await Promise.all([l1DataFee, l1FeeMultiplier, operatorFee])
  if (ratio <= 0n) throw new Error('Invalid Mantle token ratio')

  const l1Fee = bigIntMax(0n, unscaledL1Fee) * ratio
  const l1FeeWithHeadroom = chain === EvmChain.Mantle ? (l1Fee * 120n + 99n) / 100n : l1Fee

  return l1FeeWithHeadroom + bigIntMax(0n, operatorCost)
}
