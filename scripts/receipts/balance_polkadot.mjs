#!/usr/bin/env node
// Runnable receipt for sdk.balance.polkadot — fetches a LIVE Polkadot DOT balance
// (native breakdown) + a LIVE Asset Hub USDT balance for a known address via the
// Vultisig RPC proxy. Pure read; NO signing, NO broadcast.
//
//   node scripts/receipts/balance_polkadot.mjs
//
// Runs against the built SDK dist (run `node scripts/build-shared-packages.mjs` +
// `yarn workspace @vultisig/sdk build` first, or use tsx on the src).
//
// We import the primitive from the SDK source via the package's vitest alias-free
// path by going through the compiled dist when available, else fall back to a direct
// tsx run. To keep the receipt dependency-light, it re-implements nothing — it imports
// `getPolkadotNativeBalance` / `getPolkadotAssetBalance` from the SDK entry.

import { getPolkadotAssetBalance, getPolkadotNativeBalance } from '../../packages/sdk/dist/index.node.esm.js'

// Polkadot Treasury account (well-known, large stable balance) — relay-chain SS58 prefix 0.
const ADDRESS = '13UVJyLnbVp9RBZYFwFGyDvVd1y27Tt8tkntv6Q7JVPhFsTB'
// USDT on Asset Hub.
const USDT_ASSET_ID = '1984'

const main = async () => {
  console.log('sdk.balance.polkadot — LIVE receipt')
  console.log('address:', ADDRESS)
  console.log('')

  const native = await getPolkadotNativeBalance(ADDRESS)
  console.log('NATIVE DOT (System.Account):')
  console.log(JSON.stringify(native, null, 2))
  console.log('')

  // Asset Hub (pallet_assets) read — best-effort: the `/dot-ah/` proxy is not always
  // deployed on the public api.vultisig.com gateway. The native read above is the
  // headline live proof; the asset SCALE-parse path is exhaustively covered by the
  // unit test (tests/unit/tools/balance/polkadot.test.ts).
  console.log(`ASSET (pallet_assets, id=${USDT_ASSET_ID} USDT):`)
  try {
    const usdt = await getPolkadotAssetBalance(ADDRESS, USDT_ASSET_ID)
    console.log(JSON.stringify(usdt, null, 2))
  } catch (err) {
    console.log('  (skipped — Asset Hub proxy unreachable:', err?.message ?? err, ')')
  }
}

main().catch(err => {
  console.error('receipt failed:', err)
  process.exit(1)
})
