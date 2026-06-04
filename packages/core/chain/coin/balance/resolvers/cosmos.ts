import { CosmosChain } from '@vultisig/core-chain/Chain'
import { getCosmosClient } from '@vultisig/core-chain/chains/cosmos/client'
import {
  cosmosRpcUrl,
  getCosmosWasmTokenBalanceUrl,
  isCosmosWasmTokenId,
} from '@vultisig/core-chain/chains/cosmos/cosmosRpcUrl'
import { getDenom } from '@vultisig/core-chain/coin/utils/getDenom'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { CoinBalanceResolver } from '../resolver'

type LcdBalanceResponse = {
  balance?: {
    denom?: string
    amount?: string
  }
}

// LCD fallback for Tendermint-RPC bank lookups that return 0n. Native
// @cosmjs/stargate.getBalance() can return `{denom, amount: "0"}` in two
// indistinguishable cases: (1) the account genuinely holds none of the
// queried denom, (2) the StargateClient ABCI query path failed to decode
// the response (Hermes/React-Native packaging discrepancies with cosmjs's
// internal HTTP layer have produced false-zero returns in production,
// see Terra/TerraClassic balance discrepancy on iOS sim 2026-05-27 where
// LCD returned 4_800_000_000 uluna while StargateClient returned 0n for
// the same address+denom).
//
// LCD uses a different infra path (REST vs Tendermint RPC) and gives us
// a second chance before we ship a "you have 0" UX that contradicts the
// on-chain reality.
const fetchBalanceViaLcd = async (chain: CosmosChain, address: string, denom: string): Promise<bigint | null> => {
  const base = cosmosRpcUrl[chain]
  if (!base) return null
  try {
    const resp = await queryUrl<LcdBalanceResponse>(
      `${base}/cosmos/bank/v1beta1/balances/${address}/by_denom?denom=${encodeURIComponent(denom)}`
    )
    const amount = resp.balance?.amount
    if (!amount) return null
    const parsed = BigInt(amount)
    if (parsed < 0n) return null
    return parsed
  } catch {
    return null
  }
}

export const getCosmosCoinBalance: CoinBalanceResolver<CosmosChain> = async input => {
  if (isCosmosWasmTokenId(input.id)) {
    const url = getCosmosWasmTokenBalanceUrl(input)
    const { data } = await queryUrl<WasmQueryResponse>(url)
    return BigInt(data.balance ?? 0)
  }

  const client = await getCosmosClient(input.chain)

  const denom = getDenom(input)

  const balance = await client.getBalance(input.address, denom)
  const rpcAmount = BigInt(balance.amount)

  // RPC returned 0 — could be a genuinely empty wallet OR a silent decode
  // failure (cosmjs in Hermes has bitten us here). Confirm via LCD before
  // trusting the zero. If LCD also returns 0 / null, fall through.
  if (rpcAmount === 0n) {
    const lcdAmount = await fetchBalanceViaLcd(input.chain, input.address, denom)
    if (lcdAmount !== null && lcdAmount > 0n) {
      return lcdAmount
    }
  }

  return rpcAmount
}

type WasmQueryResponse = {
  data: {
    balance: string
  }
}
