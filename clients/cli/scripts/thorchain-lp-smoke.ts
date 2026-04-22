/**
 * Smoke-test THORChain LP agent actions against a real imported vault.
 *
 * Usage from repo root (env from ops .envrc):
 *   OPS_ROOT=$(tr -d '\r\n' < .cursor/.ops-source) && source "$OPS_ROOT/.envrc"
 *   VAULT_PATH="$OPS_ROOT/vaults/fast-vault-share1of2.vult" npx tsx clients/cli/scripts/thorchain-lp-smoke.ts
 *
 * Optional: TC_LP_SIGN=1 TC_LP_AMOUNT=0.05 — builds add-liquidity to BTC.BTC then signs and broadcasts.
 */
import { readFile } from 'node:fs/promises'

import { Vultisig } from '@vultisig/sdk'

import { AgentExecutor } from '../src/agent/executor'

const vaultPath = process.env.VAULT_PATH
const password = process.env.FAST_VAULT_PASSWORD || process.env.VAULT_PASSWORD || ''
const pool = (process.env.TC_LP_POOL || 'BTC.BTC').toUpperCase()
const amount = process.env.TC_LP_AMOUNT || '0.0001'
const doSign = process.env.TC_LP_SIGN === '1'

async function main(): Promise<void> {
  if (!vaultPath) {
    console.error('Set VAULT_PATH to a .vult share (e.g. $OPS_ROOT/vaults/fast-vault-share1of2.vult)')
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

  const exec = new AgentExecutor(vault, true)
  exec.setPassword(password)

  const poolInfo = await exec.executeAction({
    id: 'smoke-pool',
    type: 'thorchain_pool_info',
    title: 'pool',
    params: { pool, limit: 3 },
  })
  console.log('thorchain_pool_info:', JSON.stringify(poolInfo, null, 2))
  if (!poolInfo.success) {
    process.exit(1)
  }

  const build = await exec.executeAction({
    id: 'smoke-add',
    type: 'thorchain_add_liquidity',
    title: 'add',
    params: { pool, amount, auto_pair: false },
  })
  console.log('thorchain_add_liquidity (build):', JSON.stringify(build, null, 2))
  if (!build.success) {
    process.exit(1)
  }

  if (doSign) {
    const sign = await exec.executeAction({
      id: 'smoke-sign',
      type: 'sign_tx',
      title: 'sign',
      params: { keysign_payload: build.data?.keysign_payload },
    })
    console.log('sign_tx:', JSON.stringify(sign, null, 2))
    if (!sign.success) {
      process.exit(1)
    }
  } else {
    console.log('Skip broadcast (set TC_LP_SIGN=1 TC_LP_AMOUNT=<rune> to sign and send).')
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
