import type { Pubkey } from '@cosmjs/amino'
import { Chain, CosmosChain } from '@vultisig/core-chain/Chain'
import { ChainAccount } from '@vultisig/core-chain/ChainAccount'
import { getCosmosClient } from '@vultisig/core-chain/chains/cosmos/client'
import { getCosmosRpcUrl } from '@vultisig/core-chain/chains/cosmos/getCosmosRpcUrl'
import { parseUint64 } from '@vultisig/core-chain/chains/cosmos/parseUint64'
import { HttpResponseError } from '@vultisig/lib-utils/fetch/HttpResponseError'
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

// cosmjs/stargate 0.39 widened Account.accountNumber from `number` to
// `bigint` (Cosmos SDK 0.53+ GenerateID can exceed Number.MAX_SAFE_INTEGER)
// while keeping Account.sequence as `number`. Keep the legacy number for
// compatibility, but expose sequenceBigInt for signing consumers and recover
// unsafe values from the LCD's raw uint64 string.
type ParsedAccount = {
  address: string
  accountNumber: bigint
  sequence: number
  sequenceBigInt: bigint
}

const parseLcdAccount = (resp: LcdAccountResponse): ParsedAccount => {
  const acc = resp.account
  // An HTTP-success response without the auth account envelope is malformed,
  // not authoritative evidence that the account does not exist. Only a
  // transport-level not-found result (handled by tryLcd) may fall through to
  // the new-account sequence-zero default.
  if (!acc) throw new Error('Invalid Cosmos account data: missing account')
  const nestedBase = acc.base_vesting_account?.base_account ?? acc.base_account
  if (!nestedBase && acc['@type'] && acc['@type'] !== '/cosmos.auth.v1beta1.BaseAccount') {
    throw new Error(`Invalid Cosmos account data: unsupported account type ${acc['@type']}`)
  }
  const base = nestedBase ?? acc
  if (typeof base.address !== 'string' || base.address.length === 0) {
    throw new Error('Invalid Cosmos account data: missing address')
  }

  // ProtoJSON omits implicit-presence uint64 fields when their value is zero.
  // Once a supported account envelope/base-account shape is established,
  // absence therefore means 0n. Present malformed or out-of-range values must
  // still fail closed through parseUint64.
  const accountNumber =
    base.account_number === undefined
      ? 0n
      : parseUint64({
          value: base.account_number,
          field: 'account_number',
          context: 'Cosmos account',
        })
  const sequenceBigInt =
    base.sequence === undefined
      ? 0n
      : parseUint64({
          value: base.sequence,
          field: 'sequence',
          context: 'Cosmos account',
        })
  return { address: base.address, accountNumber, sequence: Number(sequenceBigInt), sequenceBigInt }
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
//
// SamYap timeout report (vultiagent-app#1017, 2026-05-28): the primary LCD
// for Terra Classic (terra-classic-lcd.publicnode.com) was degraded for
// hours, causing every cosmos signing surface that touches this code path
// to hard-fail. The single-URL design had no recovery. Add a fallback URL
// per chain so a publicnode degradation doesn't take out signing entirely.
//
// Polkachu mirrors per cosmos chain. Hexxagon for columbus-5 since polkachu
// has no Terra Classic endpoint (verified 2026-05-28 — see
// vultiagent-app#1017 + mcp-ts#266). Keys are the chain id used by
// cosmos-sdk; chains not in this map have no fallback (degrade fail-closed
// behaviour preserved).
const COSMOS_LCD_FALLBACK_URLS: Partial<Record<CosmosChain, string>> = {
  [Chain.Cosmos]: 'https://cosmos-api.polkachu.com',
  [Chain.Osmosis]: 'https://osmosis-api.polkachu.com',
  // rest.cosmos.directory/kujira proxies across multiple independent providers
  // (confirmed live 2026-06-16 via node_info + auth endpoint returning valid cosmos SDK JSON).
  // Distinct from the polkachu primary in cosmosRpcUrl.ts so a polkachu degradation
  // does not take out both legs simultaneously (the failure mode flagged in #735).
  [Chain.Kujira]: 'https://rest.cosmos.directory/kujira',
  [Chain.Terra]: 'https://terra-api.polkachu.com',
  [Chain.TerraClassic]: 'https://lcd.terra-classic.hexxagon.io',
  [Chain.THORChain]: 'https://thorchain-api.polkachu.com',
  [Chain.Noble]: 'https://noble-api.polkachu.com',
  [Chain.Dydx]: 'https://dydx-api.polkachu.com',
  [Chain.Akash]: 'https://akash-api.polkachu.com',
}

type LcdAttempt =
  | { status: 'found'; account: ParsedAccount }
  | { status: 'not-found' }
  | { status: 'unavailable'; error: unknown }

const tryLcd = async (base: string, address: string): Promise<LcdAttempt> => {
  let resp: LcdAccountResponse
  try {
    resp = await queryUrl<LcdAccountResponse>(`${base}/cosmos/auth/v1beta1/accounts/${address}`)
  } catch (error) {
    if (error instanceof HttpResponseError && error.status === 404) {
      return { status: 'not-found' }
    }
    return { status: 'unavailable', error }
  }

  // A transport failure can try another endpoint, but malformed response data
  // is an integrity failure. Propagate it so signing cannot silently fall
  // through to sequence 0.
  const account = parseLcdAccount(resp)
  if (account.address !== address) {
    throw new Error(`Invalid Cosmos account data: address mismatch (${account.address})`)
  }
  return { status: 'found', account }
}

const fetchAccountViaLcd = async (chain: CosmosChain, address: string): Promise<ParsedAccount | null> => {
  const base = getCosmosRpcUrl(chain)
  if (!base) return null
  const primary = await tryLcd(base, address)
  if (primary.status === 'found') return primary.account
  // A structured 404 is authoritative evidence that the account is absent;
  // this is the only LCD outcome allowed to use the new-account zero default.
  if (primary.status === 'not-found') return null

  // Network/5xx failure is not evidence that the account is absent. Try the
  // registered fallback, then propagate the failure if exact data is still
  // unavailable instead of silently constructing a sequence-zero payload.
  const fallback = COSMOS_LCD_FALLBACK_URLS[chain]
  if (!fallback) throw primary.error
  const secondary = await tryLcd(fallback, address)
  if (secondary.status === 'found') return secondary.account
  if (secondary.status === 'not-found') return null
  throw secondary.error
}

// Explicit return type so TS doesn't have to name the deeply-nested
// Pubkey path from `@cosmjs/stargate/node_modules/@cosmjs/amino` in the
// inferred export type (TS2883 against the 0.39 bump). `Pubkey | null`
// re-references the same shape via the surface package so the inferred
// type is portable.
type CosmosAccountInfo = {
  address: string
  pubkey: Pubkey | null
  accountNumber: bigint
  sequence: number
  sequenceBigInt: bigint
  latestBlock: string
}

export const getCosmosAccountInfo = async ({
  chain,
  address,
}: ChainAccount<CosmosChain>): Promise<CosmosAccountInfo> => {
  const client = await getCosmosClient(chain)
  const accountResultPromise = client.getAccount(address).then(
    value => ({ value, error: undefined }),
    (error: unknown) => ({ value: null, error })
  )
  const [accountResult, block] = await Promise.all([accountResultPromise, client.getBlock()])
  const accountInfo = accountResult.value

  let accountNumber: bigint | undefined = accountInfo?.accountNumber
  let sequence: number | undefined = accountInfo?.sequence
  let sequenceBigInt: bigint | undefined

  if (accountInfo && Number.isSafeInteger(accountInfo.sequence) && accountInfo.sequence >= 0) {
    sequenceBigInt = BigInt(accountInfo.sequence)
  } else {
    // RPC returned null or a sequence that its number-based API cannot
    // represent exactly. Prefer the LCD's raw uint64 string in both cases.
    let lcd: ParsedAccount | null
    try {
      lcd = await fetchAccountViaLcd(chain, address)
    } catch (error) {
      if (accountResult.error) throw accountResult.error
      if (accountInfo) {
        throw new Error('Cosmos account sequence cannot be represented exactly', { cause: error })
      }
      throw error
    }
    if (lcd) {
      accountNumber = lcd.accountNumber
      sequence = lcd.sequence
      sequenceBigInt = lcd.sequenceBigInt
    } else if (accountResult.error) {
      // CosmJS decodes sequence through Uint64.toNumber(), which rejects
      // before getAccount() can return when the chain value exceeds the
      // safe-number range. Recover through LCD, but retain the original RPC
      // failure when exact recovery is unavailable.
      throw accountResult.error
    } else if (accountInfo) {
      throw new Error('Cosmos account sequence cannot be represented exactly')
    }
  }

  const blockTimestampStr = block.header.time
  const blockTimestampNs = BigInt(new Date(blockTimestampStr).getTime()) * 1_000_000n

  const timeoutNs = blockTimestampNs + 600_000_000_000n // +10 minutes
  const latestBlock = `${block.header.height}_${timeoutNs}`

  return {
    address,
    pubkey: accountInfo?.pubkey ?? null,
    accountNumber: accountNumber ?? 0n,
    sequence: sequence ?? 0,
    sequenceBigInt: sequenceBigInt ?? 0n,
    latestBlock,
  }
}
