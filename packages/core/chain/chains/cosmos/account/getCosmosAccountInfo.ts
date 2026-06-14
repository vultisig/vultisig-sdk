import type { Pubkey } from '@cosmjs/amino'
import { Chain, CosmosChain } from '@vultisig/core-chain/Chain'
import { ChainAccount } from '@vultisig/core-chain/ChainAccount'
import { getCosmosClient } from '@vultisig/core-chain/chains/cosmos/client'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { getCosmosRpcUrl } from '../getCosmosRpcUrl'

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
// while keeping Account.sequence as `number`. Mirror that asymmetry here
// so the type flows cleanly through reassignment + the LCD fallback path;
// downstream consumers already wrap accountNumber in BigInt() and pass
// sequence through, so no callsite needs to change.
type ParsedAccount = {
  accountNumber: bigint
  sequence: number
}

const parseLcdAccount = (resp: LcdAccountResponse): ParsedAccount | null => {
  const acc = resp.account
  if (!acc) return null
  const base = acc.base_vesting_account?.base_account ?? acc.base_account ?? acc
  try {
    const accountNumber = BigInt(base.account_number ?? '0')
    const sequence = Number(base.sequence ?? '0')
    if (!Number.isFinite(sequence)) return null
    return { accountNumber, sequence }
  } catch {
    // BigInt() throws on malformed input (non-numeric string, decimal,
    // empty). Match the old Number.isFinite gate by failing closed.
    return null
  }
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
  [Chain.Kujira]: 'https://kujira-api.polkachu.com',
  [Chain.Terra]: 'https://terra-api.polkachu.com',
  [Chain.TerraClassic]: 'https://lcd.terra-classic.hexxagon.io',
  [Chain.THORChain]: 'https://thorchain-api.polkachu.com',
  [Chain.Noble]: 'https://noble-api.polkachu.com',
  [Chain.Dydx]: 'https://dydx-api.polkachu.com',
  [Chain.Akash]: 'https://akash-api.polkachu.com',
}

const tryLcd = async (base: string, address: string): Promise<ParsedAccount | null> => {
  try {
    const resp = await queryUrl<LcdAccountResponse>(`${base}/cosmos/auth/v1beta1/accounts/${address}`)
    return parseLcdAccount(resp)
  } catch {
    return null
  }
}

const fetchAccountViaLcd = async (chain: CosmosChain, address: string): Promise<ParsedAccount | null> => {
  const base = getCosmosRpcUrl(chain)
  if (!base) return null
  const primary = await tryLcd(base, address)
  if (primary) return primary
  // Primary failed (network / 5xx / shape mismatch). Try the registered
  // fallback for this chain. Both-failed surfaces as null and the caller
  // ships with sequence:0 default — same legacy behaviour, but only after
  // we've actually exhausted both endpoints.
  const fallback = COSMOS_LCD_FALLBACK_URLS[chain]
  if (!fallback) return null
  return tryLcd(fallback, address)
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
  latestBlock: string
}

export const getCosmosAccountInfo = async ({
  chain,
  address,
}: ChainAccount<CosmosChain>): Promise<CosmosAccountInfo> => {
  const client = await getCosmosClient(chain)
  const [accountInfo, block] = await Promise.all([client.getAccount(address), client.getBlock()])

  let accountNumber: bigint | undefined = accountInfo?.accountNumber
  let sequence: number | undefined = accountInfo?.sequence

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
    accountNumber: accountNumber ?? 0n,
    sequence: sequence ?? 0,
    latestBlock,
  }
}
