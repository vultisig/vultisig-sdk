import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { bittensorRpcUrl } from '@vultisig/core-chain/chains/bittensor/client'
import { bittensorConfig } from '@vultisig/core-chain/chains/bittensor/config'
import { getBittensorCoinBalance } from '@vultisig/core-chain/coin/balance/resolvers/bittensor'
import { PolkadotSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { attempt, withFallback } from '@vultisig/lib-utils/attempt'
import { parseNonNegativeBigInt } from '@vultisig/lib-utils/bigint/parseNonNegativeBigInt'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { BuildKeysignPayloadError } from '../../../error'
import { getKeysignCoin } from '../../../utils/getKeysignCoin'
import { GetChainSpecificResolver } from '../../resolver'
import { refineBittensorChainSpecific } from './refine'

type RpcResponse<T> = {
  jsonrpc: string
  id: number
  result?: T
  error?: { code: number; message: string }
}

const rpc = async <T>(method: string, params: unknown[] = []) => {
  const response = await queryUrl<RpcResponse<T>>(bittensorRpcUrl, {
    body: { jsonrpc: '2.0', method, params, id: 1 },
  })
  if (response.error) {
    throw new Error(`Bittensor RPC ${method} failed: ${response.error.message ?? `code ${response.error.code}`}`)
  }
  return response.result as T
}

type AssertDestinationStaysAliveInput = {
  toAddress: string
  toAmount: string
}

/**
 * Rejects a transfer the chain would refuse with `ExistentialDeposit`: one that
 * leaves the destination holding less than the 500 rao minimum, which is only
 * possible when the account is new or already reaped. Raised as a
 * [BuildKeysignPayloadError] because it is bad input, not a transient failure,
 * so callers stop retrying and show it before the ceremony.
 */
const assertDestinationStaysAlive = async ({ toAddress, toAmount }: AssertDestinationStaysAliveInput) => {
  const amount = parseNonNegativeBigInt(toAmount)
  const { existentialDeposit } = bittensorConfig
  if (amount >= existentialDeposit) {
    return
  }

  const destinationBalance = await getBittensorCoinBalance({ chain: Chain.Bittensor, address: toAddress })
  if (destinationBalance + amount < existentialDeposit) {
    throw new BuildKeysignPayloadError(
      'bittensor-destination-below-existential-deposit',
      `Cannot send ${amount} rao to ${toAddress}: the destination would hold less than the ` +
        `${existentialDeposit} rao existential deposit and Bittensor rejects the transfer.`
    )
  }
}

export const getBittensorChainSpecific: GetChainSpecificResolver<'polkadotSpecific'> = async ({ keysignPayload }) => {
  const { address } = getKeysignCoin(keysignPayload)

  const [runtimeVersion, blockHash, nonce, header, genesisHash] = await Promise.all([
    rpc<{ specVersion: number; transactionVersion: number }>('state_getRuntimeVersion'),
    rpc<string>('chain_getBlockHash'),
    rpc<number>('system_accountNextIndex', [address]),
    rpc<{ number: string }>('chain_getHeader'),
    rpc<string>('chain_getBlockHash', [0]),
    assertDestinationStaysAlive({ toAddress: keysignPayload.toAddress, toAmount: keysignPayload.toAmount }),
  ])

  const chainSpecific = create(PolkadotSpecificSchema, {
    recentBlockHash: blockHash,
    nonce: BigInt(nonce),
    currentBlockNumber: String(parseInt(header.number, 16)),
    specVersion: runtimeVersion.specVersion,
    transactionVersion: runtimeVersion.transactionVersion,
    genesisHash,
    gas: bittensorConfig.fee,
  })

  return withFallback(
    attempt(
      refineBittensorChainSpecific({
        keysignPayload,
        chainSpecific,
      })
    ),
    chainSpecific
  )
}
