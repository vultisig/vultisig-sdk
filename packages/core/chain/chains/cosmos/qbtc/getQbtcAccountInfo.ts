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

const maxUint64 = (1n << 64n) - 1n

const parseUint64 = (value: unknown, field: string): bigint => {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new Error(`Invalid QBTC ${field}: expected an unsigned integer`)
  }

  const parsed = BigInt(value)
  if (parsed > maxUint64) {
    throw new Error(`Invalid QBTC ${field}: exceeds uint64`)
  }

  return parsed
}

export const getQbtcAccountInfo = async ({ address }: { address: string }) => {
  const [accountData, blockData] = await Promise.all([
    queryUrl<AccountResponse>(`${qbtcRestUrl}/cosmos/auth/v1beta1/accounts/${address}`),
    queryUrl<BlockResponse>(`${qbtcRestUrl}/cosmos/base/tendermint/v1beta1/blocks/latest`),
  ])

  const accountNumberBigInt = parseUint64(accountData.account.account_number, 'account_number')
  const sequenceBigInt = parseUint64(accountData.account.sequence, 'sequence')
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
