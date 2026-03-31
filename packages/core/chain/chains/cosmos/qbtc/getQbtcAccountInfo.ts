import { StargateClient } from '@cosmjs/stargate'
import { qbtcTendermintRpcUrl } from '@vultisig/core-chain/chains/cosmos/qbtc/tendermintRpcUrl'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'

export const getQbtcAccountInfo = async ({ address }: { address: string }) => {
  const client = await StargateClient.connect(qbtcTendermintRpcUrl)
  const accountInfo = shouldBePresent(await client.getAccount(address))
  const block = await client.getBlock()
  const blockTimestampStr = block.header.time
  const blockTimestampNs =
    BigInt(new Date(blockTimestampStr).getTime()) * 1_000_000n

  const timeoutNs = blockTimestampNs + 600_000_000_000n
  const latestBlock = `${block.header.height}_${timeoutNs}`

  return {
    ...accountInfo,
    latestBlock,
  }
}
