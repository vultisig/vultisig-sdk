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
 * Both terms fail open independently. A pre-Isthmus oracle reverts on
 * `getOperatorFee`, and letting that failure take the L1 data fee down with it
 * would leave the chain reserving nothing at all — a fee that cannot be read
 * must never block a send that worked before. A negative answer is nonsense from
 * a fee oracle and is floored rather than passed on to widen a max amount.
 */
export const getOpStackFeeSurcharge = async ({
  chain,
  gasLimit,
  callDataSize,
}: GetOpStackFeeSurchargeInput): Promise<bigint> => {
  const client = getEvmClient(chain)

  const l1DataFee = withFallback(
    attempt(
      client.readContract({
        address: gasPriceOracleAddress,
        abi: gasPriceOracleAbi,
        functionName: 'getL1Fee',
        args: [l1FeeProbeData(unsignedTxEnvelopeSize + callDataSize)],
      })
    ),
    0n
  )

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

  const terms = await Promise.all([l1DataFee, operatorFee])

  return terms.reduce((total, term) => total + bigIntMax(0n, term), 0n)
}
