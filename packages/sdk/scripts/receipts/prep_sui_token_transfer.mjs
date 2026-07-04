// Runnable receipt for sdk.prep.suiTokenTransfer.
//
// Builds an UNSIGNED Sui coin-object token-transfer KeysignPayload with
// throwaway inputs and prints its structure. It NEVER signs and NEVER
// broadcasts — vault.sign stays on-device.
//
// This drives the FULL real SDK build path (address/coin-type validation,
// getPublicKey, the Sui chain-specific resolver, and the token `Pay`
// signing-input shape). To stay deterministic + offline it:
//   - initializes wallet-core wasm locally (offline, no network, no signing)
//   - stubs `globalThis.fetch` to serve canned Sui JSON-RPC responses
//     (suix_getAllCoins / suix_getReferenceGasPrice) — so the resolver never
//     hits a real RPC. No real network egress; no broadcast.
//
// Run from packages/sdk:
//   node --import tsx scripts/receipts/prep_sui_token_transfer.mjs

import { initWasm } from '@trustwallet/wallet-core'

import { configureWasm } from '../../src/context/wasmRuntime.ts'
import { prepareSuiTokenTransferFromKeys } from '../../src/tools/prep/suiTokenTransfer.ts'

// ── Offline Sui RPC stub (canned coin objects; no real network) ─────────────
const COIN_TYPE = '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN'
const SUI_NATIVE = '0x2::sui::SUI'
const OWNER = '0x' + 'ab'.repeat(32)

// Sui object digests + tx digests are base58-encoded (32 bytes). Use valid
// base58 placeholders so the mysten client's digest validation accepts them.
const B58_DIGEST = '11111111111111111111111111111111' // 32x base58 '1' (== zero bytes)
const cannedCoin = (coinType, coinObjectId, balance) => ({
  coinType,
  coinObjectId,
  version: '12345',
  digest: B58_DIGEST,
  balance,
  previousTransaction: B58_DIGEST,
})

const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input?.url ?? ''
  if (url.includes('sui') && init?.body) {
    const req = JSON.parse(init.body)
    const reqs = Array.isArray(req) ? req : [req]
    const out = reqs.map(r => {
      if (r.method === 'suix_getAllCoins') {
        return {
          jsonrpc: '2.0',
          id: r.id,
          result: {
            data: [
              cannedCoin(SUI_NATIVE, '0x' + '01'.repeat(32), '1000000000'), // gas coin
              cannedCoin(COIN_TYPE, '0x' + '02'.repeat(32), '5000000'), // token coin
            ],
            hasNextPage: false,
            nextCursor: null,
          },
        }
      }
      if (r.method === 'suix_getReferenceGasPrice') {
        return { jsonrpc: '2.0', id: r.id, result: '1000' }
      }
      if (r.method === 'suix_getBalance') {
        return {
          jsonrpc: '2.0',
          id: r.id,
          result: { coinType: COIN_TYPE, coinObjectCount: 1, totalBalance: '5000000', lockedBalance: {} },
        }
      }
      return { jsonrpc: '2.0', id: r.id, result: null }
    })
    const body = Array.isArray(req) ? out : out[0]
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
  }
  return realFetch(input, init)
}

// Offline wallet-core init (no network, no key material, no signing).
configureWasm(() => initWasm())

// ── Throwaway, non-funded inputs ────────────────────────────────────────────
const identity = {
  ecdsaPublicKey: '023e4d7c8e9a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6071829384a5',
  eddsaPublicKey: 'cd'.repeat(32),
  hexChainCode: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef0',
  localPartyId: 'receipt-throwaway-AAAA',
  libType: 'DKLS',
}

const params = {
  coinType: COIN_TYPE,
  from: OWNER,
  to: '0x' + 'cd'.repeat(32),
  amount: 1_500_000n, // 1.5 token at 6 decimals
  decimals: 6,
  ticker: 'TKN',
}

const payload = await prepareSuiTokenTransferFromKeys(identity, params)

const replacer = (_k, v) => {
  if (typeof v === 'bigint') return v.toString()
  if (v instanceof Uint8Array) return '0x' + Buffer.from(v).toString('hex')
  return v
}

console.log('=== sdk.prep.suiTokenTransfer — UNSIGNED Sui token transfer ===')
console.log('chain               :', payload.coin?.chain)
console.log('coin.contractAddress:', payload.coin?.contractAddress, '(the Sui coinType → drives token `Pay`)')
console.log('coin.isNativeToken  :', payload.coin?.isNativeToken)
console.log('toAddress           :', payload.toAddress)
console.log('toAmount            :', payload.toAmount)
console.log('memo                :', payload.memo || '(none — Sui has no memo)')
console.log('libType             :', payload.libType)
console.log('blockchainSpecific  :', payload.blockchainSpecific?.case)
console.log('\nfull payload JSON:')
console.log(JSON.stringify(payload, replacer, 2))
console.log('\nsigned? NO. broadcast? NO. This is an unsigned KeysignPayload only.')

// ── Negative path: a wrong-family (EVM-shaped) recipient must be rejected ────
try {
  await prepareSuiTokenTransferFromKeys(identity, { ...params, to: '0x' + 'cd'.repeat(20) })
  console.error('\nFAIL: EVM-shaped recipient was NOT rejected')
  process.exit(1)
} catch (e) {
  console.log('\nguard OK — EVM-shaped recipient rejected:', e.message)
}

// ── Negative path: native SUI is not a token transfer ───────────────────────
try {
  await prepareSuiTokenTransferFromKeys(identity, { ...params, coinType: SUI_NATIVE })
  console.error('FAIL: native SUI was NOT rejected')
  process.exit(1)
} catch (e) {
  console.log('guard OK — native SUI rejected:', e.message)
}

// ── Negative path: address-equivalent native SUI (zero-padded package id) ────
// `0x02` / full `0x000…002` are the SAME on-chain address as `0x2` — the guard
// must normalize the struct tag, not rely on a literal string match.
for (const padded of ['0x02::sui::SUI', '0x' + '0'.repeat(63) + '2' + '::sui::SUI']) {
  try {
    await prepareSuiTokenTransferFromKeys(identity, { ...params, coinType: padded })
    console.error(`FAIL: address-equivalent native SUI (${padded}) was NOT rejected`)
    process.exit(1)
  } catch (e) {
    console.log(`guard OK — padded native SUI (${padded}) rejected:`, e.message)
  }
}

process.exit(0)
