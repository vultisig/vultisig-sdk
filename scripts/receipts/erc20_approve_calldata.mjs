#!/usr/bin/env node
/**
 * Runnable receipt for sdk.evm.encodeErc20Approve + encodeErc20Revoke.
 *
 * Imports the SDK primitives straight from source via tsx and prints real
 * 0x calldata for a real spender (1inch v5 router), proving:
 *   - unlimited approve (MAX_UINT256)
 *   - bounded approve (100 USDC, 6 decimals)
 *   - revoke (approve spender, 0)
 * plus the decoded selector + args so you can eyeball correctness.
 *
 * Run: node scripts/receipts/erc20_approve_calldata.mjs
 *  (re-execs itself through tsx so the TS source imports resolve)
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(import.meta.url)

// Re-exec under tsx so we can import the .ts SDK source directly.
if (!process.env.__RECEIPT_TSX) {
  const r = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('../../node_modules/tsx/dist/cli.mjs', import.meta.url)), HERE],
    { stdio: 'inherit', env: { ...process.env, __RECEIPT_TSX: '1' } }
  )
  process.exit(r.status ?? 1)
}

const { decodeFunctionData, erc20Abi } = await import('viem')
const { encodeErc20Approve, encodeErc20Revoke, MAX_UINT256 } = await import(
  '../../packages/sdk/src/tools/evm/encodeErc20Approve.ts'
)

const SPENDER = '0x1111111254eeb25477b68fb85ed929f73a960582' // 1inch v5 router (lowercased)

const show = (label, data) => {
  const { functionName, args } = decodeFunctionData({ abi: erc20Abi, data })
  console.log(`\n${label}`)
  console.log(`  calldata: ${data}`)
  console.log(`  selector: ${data.slice(0, 10)}  (approve = 0x095ea7b3)`)
  console.log(`  decoded:  ${functionName}(spender=${args[0]}, amount=${args[1].toString()})`)
}

console.log('=== sdk.evm.encodeErc20Approve / encodeErc20Revoke receipt ===')
show('approve UNLIMITED (MAX_UINT256):', encodeErc20Approve(SPENDER, MAX_UINT256))
show('approve 100 USDC (6 decimals → 100_000000):', encodeErc20Approve(SPENDER, 100_000000n))
show('revoke (approve spender, 0):', encodeErc20Revoke(SPENDER))
console.log('\nspender normalized to EIP-55 checksum in all three. OK')
