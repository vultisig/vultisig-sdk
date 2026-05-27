import { CosmosChain } from '@vultisig/core-chain/Chain'
import { ChainAccount } from '@vultisig/core-chain/ChainAccount'
import { getCosmosClient } from '@vultisig/core-chain/chains/cosmos/client'
import { cosmosRpcUrl } from '@vultisig/core-chain/chains/cosmos/cosmosRpcUrl'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

type LcdAccountResponse = {
  account?: {
    '@type'?: string
    address?: string
    pub_key?: { '@type'?: string; key?: string } | null
    account_number?: string
    sequence?: string
    // Vesting / module / wrapper accounts may nest a BaseAccount under
    // `base_account` or `base_vesting_account.base_account`. Read both
    // common shapes; fall through to the top-level fields when present.
    base_account?: {
      address?: string
      pub_key?: { '@type'?: string; key?: string } | null
      account_number?: string
      sequence?: string
    }
    base_vesting_account?: {
      base_account?: {
        address?: string
        pub_key?: { '@type'?: string; key?: string } | null
        account_number?: string
        sequence?: string
      }
    }
  }
}

type ParsedAccount = {
  accountNumber: number
  sequence: number
}

const parseLcdAccount = (resp: LcdAccountResponse): ParsedAccount | null => {
  const acc = resp.account
  if (!acc) return null
  const base = acc.base_vesting_account?.base_account ?? acc.base_account ?? acc
  const accountNumber = Number(base.account_number ?? '0')
  const sequence = Number(base.sequence ?? '0')
  if (!Number.isFinite(accountNumber) || !Number.isFinite(sequence)) return null
  return { accountNumber, sequence }
}

// LCD fallback for Tendermint-RPC account lookups that return null.
// Native @cosmjs/stargate.getAccount() returns null in TWO indistinguishable
// cases: (1) account genuinely doesn't exist on-chain, (2) the RPC response
// couldn't be decoded (custom account type, transient infra, etc.). For a
// send tx, the sender account MUST exist by definition — falling through
// to sequence:0 ships a tx guaranteed to fail at broadcast with
// "account sequence mismatch, expected N, got 0".
//
// LCD uses a different infra path (REST vs Tendermint RPC), supports
// extended account types (vesting, module wrappers) via JSON shape parsing,
// and gives us a second chance before we ship a doomed tx.
const fetchAccountViaLcd = async (chain: CosmosChain, address: string): Promise<ParsedAccount | null> => {
  const base = cosmosRpcUrl[chain]
  if (!base) return null
  try {
    const resp = await queryUrl<LcdAccountResponse>(`${base}/cosmos/auth/v1beta1/accounts/${address}`)
    return parseLcdAccount(resp)
  } catch {
    // 404 (account not found) or transient LCD error — caller decides.
    return null
  }
}

export const getCosmosAccountInfo = async ({ chain, address }: ChainAccount<CosmosChain>) => {
  const client = await getCosmosClient(chain)
  const [accountInfo, block] = await Promise.all([client.getAccount(address), client.getBlock()])

  let accountNumber = accountInfo?.accountNumber
  let sequence = accountInfo?.sequence

  // RPC returned null. Try the LCD shape parser before falling back to
  // sequence:0 — that fallback is correct only for accounts that have
  // genuinely never been funded, but ships a doomed tx for the much more
  // common case where RPC just couldn't decode an extended account type.
  if (accountInfo === null) {
    const lcd = await fetchAccountViaLcd(chain, address)
    if (lcd) {
      accountNumber = lcd.accountNumber
      sequence = lcd.sequence
    }
  }

  const blockTimestampStr = block.header.time
  const blockTimestampNs = BigInt(new Date(blockTimestampStr).getTime()) * 1_000_000n

  const timeoutNs = blockTimestampNs + 600_000_000_000n // +10 minutes
  const latestBlock = `${block.header.height}_${timeoutNs}`

  return {
    address,
    pubkey: accountInfo?.pubkey ?? null,
    accountNumber: accountNumber ?? 0,
    sequence: sequence ?? 0,
    latestBlock,
  }
}
