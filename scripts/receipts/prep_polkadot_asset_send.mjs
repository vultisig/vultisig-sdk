/**
 * Runnable receipt for sdk.prep.polkadotAssetSend (preparePolkadotAssetSend).
 *
 * Builds an UNSIGNED Polkadot Asset Hub pallet_assets.transferKeepAlive call
 * body from throwaway public inputs and prints its structure. PURE CRYPTO:
 * deterministic, offline, no RPC, no price lookup. It NEVER signs and NEVER
 * broadcasts — the on-device vault.sign wraps + signs the call body.
 *
 * Run from the SDK repo root:
 *   node --import tsx scripts/receipts/prep_polkadot_asset_send.mjs
 */
import { preparePolkadotAssetSend } from '../../packages/sdk/src/tools/prep/polkadotAssetSend.ts'

// Throwaway well-known dev accounts (public, NEVER funded): Bob -> Alice.
const FROM = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty' // Bob
const TO = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY' // Alice

// 10 USDT on Asset Hub: assetId 1984, 6 decimals -> 10_000_000 base units.
const usdt = preparePolkadotAssetSend({
  assetId: 1984,
  from: FROM,
  to: TO,
  amount: 10_000_000n,
})

// 25.5 USDC: assetId 1337, 6 decimals -> 25_500_000 base units.
const usdc = preparePolkadotAssetSend({
  assetId: 1337,
  from: FROM,
  to: TO,
  amount: 25_500_000n,
})

console.log('=== sdk.prep.polkadotAssetSend — UNSIGNED Asset Hub transfer (pallet_assets.transferKeepAlive) ===\n')

console.log('USDT (assetId=1984), 10 USDT:')
console.log(JSON.stringify(usdt, null, 2))

console.log('\nUSDC (assetId=1337), 25.5 USDC:')
console.log(JSON.stringify(usdc, null, 2))

// Decode the call body to prove the SCALE layout the on-device signer validates.
const bytes = Buffer.from(usdt.callHex.replace(/^0x/, ''), 'hex')
console.log('\n--- USDT callHex byte breakdown ---')
console.log(`pallet_index : 0x${bytes[0].toString(16).padStart(2, '0')} (${bytes[0]} = pallet_assets)`)
console.log(`method_index : 0x${bytes[1].toString(16).padStart(2, '0')} (${bytes[1]} = transferKeepAlive)`)
console.log(`total length : ${bytes.length} bytes (unsigned call body only — no era/nonce/tip/signature)`)
console.log('\nNOTE: this is the UNSIGNED call body. vault.sign stays on-device. Nothing was broadcast.')
