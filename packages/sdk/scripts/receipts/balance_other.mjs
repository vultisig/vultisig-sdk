#!/usr/bin/env node
/**
 * Runnable receipt for sdk.balance.<chain> (sui/ton/tron/xrp/cardano/tao).
 *
 * Hits LIVE public RPC/API endpoints and prints real native + token balances.
 * Read-only — never signs or broadcasts. Run from the sdk package dir:
 *
 *   node scripts/receipts/balance_other.mjs
 *
 * Imports the built SDK dist so it exercises the actual published surface.
 */
import {
  getCardanoBalance,
  getSuiBalance,
  getTaoBalance,
  getTonBalance,
  getTrc20TokenBalance,
  getTrxBalance,
  getXrpBalance,
} from '../../dist/index.node.esm.js'

// Public, well-known addresses (treasury / foundation / docs examples). No keys.
const TON_ADDR = 'UQAQ3v4lZ3Yc6kj3dr6X2bm0u-V_oN7XJsYZ0o0Vw3qDjh8E' // TON Foundation-style wallet
const TON_FALLBACK = 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N' // TON bridge (always funded)
const TRON_ADDR = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' // USDT-TRC20 contract holds TRX/USDT
const USDT_TRC20 = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' // USDT TRC-20 contract
const TRON_HOLDER = 'TZ4UXDV5ZhNW7fb2AMSbgfAEZ7hWsnYS2g' // Binance hot wallet (always funded)
const XRP_ADDR = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh' // Bitstamp XRP hot wallet
const SUI_ADDR = '0x0000000000000000000000000000000000000000000000000000000000000005' // Sui system state
const ADA_ADDR =
  'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl3wmuyzs0zwdej' // docs example
const TAO_ADDR = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY' // Substrate Alice (SS58 42)

async function tryStep(label, fn) {
  try {
    const r = await fn()
    console.log(`\n[OK] ${label}`)
    console.log(JSON.stringify(r, null, 2))
    return r
  } catch (e) {
    console.log(`\n[ERR] ${label}: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

console.log('=== sdk.balance.<chain> live receipt ===')

// TON native (primary live target)
let ton = await tryStep('getTonBalance (TON)', () => getTonBalance(TON_FALLBACK))
if (!ton) await tryStep('getTonBalance (TON, alt)', () => getTonBalance(TON_ADDR))

// TRON native (primary live target)
await tryStep('getTrxBalance (TRON)', () => getTrxBalance(TRON_HOLDER))

// TRC-20 token balance (USDT on TRON)
await tryStep('getTrc20TokenBalance (USDT-TRC20)', () =>
  getTrc20TokenBalance(TRON_HOLDER, USDT_TRC20),
)

// XRP native
await tryStep('getXrpBalance (XRP)', () => getXrpBalance(XRP_ADDR))

// Sui native
await tryStep('getSuiBalance (SUI)', () => getSuiBalance(SUI_ADDR))

// Cardano native + native tokens
await tryStep('getCardanoBalance (ADA)', () => getCardanoBalance(ADA_ADDR))

// Bittensor native TAO (fund-safety gate runs before RPC)
await tryStep('getTaoBalance (TAO)', () => getTaoBalance(TAO_ADDR))

console.log('\n=== done (read-only; no signing/broadcast) ===')
