/**
 * Smoke-test THORChain LP agent actions against a real imported vault.
 *
 * Usage from repo root:
 *   FIXTURE_ROOT=$(tr -d '\r\n' < .cursor/.vault-fixtures-root) && source "$FIXTURE_ROOT/.envrc"
 *   VAULT_PATH="$FIXTURE_ROOT/vaults/fast-vault-share1of2.vult" npx tsx clients/cli/scripts/thorchain-lp-smoke.ts
 *
 * Optional: TC_LP_SIGN=1 TC_LP_AMOUNT=0.05 — builds add-liquidity to BTC.BTC then signs and broadcasts.
 */
import { readFile } from 'node:fs/promises'

import { buildThorchainLpAddPayload, getThorchainPools } from '@vultisig/core-chain/chains/cosmos/thor/lp'
import { Chain, Vultisig } from '@vultisig/sdk'
import { parseUnits } from 'viem'

import { AgentExecutor } from '../src/agent/executor'

const vaultPath = process.env.VAULT_PATH
const password = process.env.FAST_VAULT_PASSWORD || process.env.VAULT_PASSWORD || ''
const pool = (process.env.TC_LP_POOL || 'BTC.BTC').toUpperCase()
const amount = process.env.TC_LP_AMOUNT || '0.0001'
const doSign = process.env.TC_LP_SIGN === '1'

async function main(): Promise<void> {
  if (!vaultPath) {
    console.error('Set VAULT_PATH to a .vult share')
    process.exit(1)
  }
  if (!password) {
    console.error('Set FAST_VAULT_PASSWORD or VAULT_PASSWORD')
    process.exit(1)
  }

  const raw = await readFile(vaultPath, 'utf8')
  const sdk = new Vultisig()
  await sdk.initialize()
  const vault = await sdk.importVault(raw, password)
  await vault.unlock(password)

  const thorAddress = await vault.address(Chain.THORChain)
  if (!thorAddress) {
    console.error('Vault did not derive a THORChain address')
    process.exit(1)
  }

  const pools = await getThorchainPools()
  const poolInfo = pools.find(item => item.asset === pool)
  if (!poolInfo) {
    console.error(`Pool not found or not available: ${pool}`)
    process.exit(1)
  }
  console.log('thorchain_pool_info:', JSON.stringify({ success: true, data: poolInfo }, null, 2))

  const payload = buildThorchainLpAddPayload({
    pool,
    amountRuneBaseUnits: parseUnits(amount, 8).toString(),
  })
  console.log('thorchain_add_liquidity (build):', JSON.stringify({ success: true, data: payload }, null, 2))

  if (doSign) {
    const exec = new AgentExecutor(vault, true)
    exec.setPassword(password)
    const stored = exec.storeServerTransaction({
      chain: Chain.THORChain,
      txArgs: {
        chain: Chain.THORChain,
        from: thorAddress,
        to: thorAddress,
        amount: payload.amount,
        symbol: 'RUNE',
        memo: payload.memo,
      },
    })
    if (!stored) {
      console.error('Failed to store LP add transaction for signing')
      process.exit(1)
    }
    const sign = await exec.signTxFromBuffer('smoke-sign')
    console.log('sign_tx:', JSON.stringify(sign, null, 2))
    if (!sign.success) {
      process.exit(1)
    }
  } else {
    console.log('Skip broadcast (set TC_LP_SIGN=1 TC_LP_AMOUNT=<rune> to sign and send).')
  }

  sdk.dispose()
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
