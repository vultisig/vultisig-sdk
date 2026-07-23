import { parseUint64 } from '@vultisig/core-chain/chains/cosmos/parseUint64'
import { qbtcRestUrl } from '@vultisig/core-chain/chains/cosmos/qbtc/tendermintRpcUrl'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

type AccountResponse = {
  account: {
    address: string
    account_number: unknown
    sequence: unknown
  }
}

type BlockResponse = {
  block: {
    header: {
      height: string
      time: string
    }
  }
}

export const getQbtcAccountInfo = async ({ address }: { address: string }) => {
  const [accountData, blockData] = await Promise.all([
    queryUrl<AccountResponse>(`${qbtcRestUrl}/cosmos/auth/v1beta1/accounts/${address}`),
    queryUrl<BlockResponse>(`${qbtcRestUrl}/cosmos/base/tendermint/v1beta1/blocks/latest`),
  ])

  const accountNumberBigInt = parseUint64({
    value: accountData.account.account_number,
    field: 'account_number',
    context: 'QBTC',
  })
  const sequenceBigInt = parseUint64({
    value: accountData.account.sequence,
    field: 'sequence',
    context: 'QBTC',
  })
  const blockTimestampStr = blockData.block.header.time
  const blockTimestampNs = BigInt(new Date(blockTimestampStr).getTime()) * 1_000_000n
  const timeoutNs = blockTimestampNs + 600_000_000_000n
  const latestBlock = `${blockData.block.header.height}_${timeoutNs}`

  return {
    address,
    accountNumber: Number(accountNumberBigInt),
    sequence: Number(sequenceBigInt),
    accountNumberBigInt,
    sequenceBigInt,
    latestBlock,
  }
}
