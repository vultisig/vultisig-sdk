#!/usr/bin/env node
/**
 * Runnable receipt for sdk.token.resolveContract (on-chain token metadata).
 *
 * Fires a LIVE RPC call — this is the curl-equivalent proof that the primitive
 * resolves real on-chain metadata. Resolves USDC on Ethereum (ERC-20) and
 * prints {symbol, decimals, name}.
 *
 * Run:
 *   node packages/sdk/scripts/receipts/token_resolve_contract.mjs
 *
 * It loads the TypeScript source directly via tsx so the receipt exercises the
 * exact shipped code path (no separate build step).
 */
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { tsImport } from 'tsx/esm/api'

const here = dirname(fileURLToPath(import.meta.url))
const srcPath = resolve(here, '../../src/tools/token/resolveContract.ts')

const { resolveContract } = await tsImport(srcPath, import.meta.url)

// Canonical USDC on Ethereum mainnet.
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'

console.log(`resolveContract('Ethereum', '${USDC}')`)
const res = await resolveContract('Ethereum', USDC)
console.log(JSON.stringify(res, null, 2))

if (res.symbol !== 'USDC' || res.decimals !== 6) {
  console.error(`\nUNEXPECTED: expected USDC/6, got ${res.symbol}/${res.decimals}`)
  process.exit(1)
}
console.log('\nOK — resolved real on-chain USDC metadata (symbol=USDC, decimals=6).')
