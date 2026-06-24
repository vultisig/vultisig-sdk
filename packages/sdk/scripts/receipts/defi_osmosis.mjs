/**
 * Runnable receipt for sdk.defi.osmosis.
 *
 * Builds two UNSIGNED Osmosis messages from sample inputs — a GAMM swap and a
 * CL create-position — and prints their proto-Any typeUrls + the decoded wire
 * fields so a reviewer can eyeball that the encoding matches the on-chain proto
 * layout. NO signing, NO broadcast, NO network.
 *
 * Run:  yarn dlx tsx scripts/receipts/defi_osmosis.mjs
 *   (or, from the sdk package: node_modules/.bin/tsx scripts/receipts/defi_osmosis.mjs)
 */
import { BinaryReader } from 'cosmjs-types/binary'
import { Coin } from 'cosmjs-types/cosmos/base/v1beta1/coin'
import { Any } from 'cosmjs-types/google/protobuf/any'

import { osmosis } from '../../src/tools/defi/index.ts'

const SENDER = 'osmo1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5helwsw'
const UOSMO = 'uosmo'
const IBC_USDC = 'ibc/498A0751C7AB1E5DF00ED54C3C8F11B1B0FE3A9CCDD80B73F2B7E03CB5BC4E78'

const td = new TextDecoder()

/** Minimal proto3 field walker for display. */
function walk(bytes) {
  const r = new BinaryReader(bytes)
  const fields = {}
  while (r.pos < bytes.length) {
    const tag = r.uint32()
    const num = tag >>> 3
    const wt = tag & 7
    let val
    if (wt === 0) val = BigInt(r.uint64().toString())
    else if (wt === 2) val = r.bytes()
    else throw new Error(`wire type ${wt}`)
    ;(fields[num] ??= []).push({ wt, val })
  }
  return fields
}

const hex = u8 => Buffer.from(u8).toString('hex')

function describeCoin(u8) {
  const c = Coin.decode(u8)
  return `${c.amount}${c.denom}`
}

console.log('='.repeat(72))
console.log('sdk.defi.osmosis — UNSIGNED message build receipt (no signing/broadcast)')
console.log('='.repeat(72))

// --- 1) GAMM swap -----------------------------------------------------------
const swap = osmosis.buildSwapExactAmountIn({
  sender: SENDER,
  routes: [{ poolId: '1', tokenOutDenom: UOSMO }],
  tokenIn: { denom: IBC_USDC, amount: '1000000' },
  tokenOutMinAmount: '950000',
})

console.log('\n[1] GAMM MsgSwapExactAmountIn')
console.log('    typeUrl :', swap.typeUrl)
console.log('    body    :', swap.value.length, 'bytes  (hex:', hex(swap.value).slice(0, 48) + '...)')
{
  const f = walk(swap.value)
  console.log('    decoded :')
  console.log('      #1 sender            =', td.decode(f[1][0].val))
  const rf = walk(f[2][0].val)
  console.log('      #2 route[0].poolId   =', rf[1][0].val.toString())
  console.log('      #2 route[0].outDenom =', td.decode(rf[2][0].val))
  console.log('      #3 tokenIn           =', describeCoin(f[3][0].val))
  console.log('      #4 tokenOutMinAmount =', td.decode(f[4][0].val))
}
const swapAny = osmosis.toAny(swap)
console.log('    Any     :', swapAny.length, 'bytes ->', Any.decode(swapAny).typeUrl)

// --- 2) CL create position --------------------------------------------------
const pos = osmosis.buildCreatePosition({
  sender: SENDER,
  poolId: '1066',
  lowerTick: '-887200',
  upperTick: '887200',
  tokensProvided: [
    { denom: UOSMO, amount: '5000000' },
    { denom: IBC_USDC, amount: '5000000' },
  ],
  tokenMinAmount0: '0',
  tokenMinAmount1: '0',
})

console.log('\n[2] Concentrated Liquidity MsgCreatePosition')
console.log('    typeUrl :', pos.typeUrl)
console.log('    body    :', pos.value.length, 'bytes  (hex:', hex(pos.value).slice(0, 48) + '...)')
{
  const f = walk(pos.value)
  console.log('    decoded :')
  console.log('      #1 poolId            =', f[1][0].val.toString())
  console.log('      #2 sender            =', td.decode(f[2][0].val))
  console.log('      #3 lowerTick         =', BigInt.asIntN(64, f[3][0].val).toString())
  console.log('      #4 upperTick         =', BigInt.asIntN(64, f[4][0].val).toString())
  console.log('      #5 tokensProvided    =', f[5].map(e => describeCoin(e.val)).join(', '))
  console.log('      #6 tokenMinAmount0   =', td.decode(f[6][0].val))
  console.log('      #7 tokenMinAmount1   =', td.decode(f[7][0].val))
}
const posAny = osmosis.toAny(pos)
console.log('    Any     :', posAny.length, 'bytes ->', Any.decode(posAny).typeUrl)

console.log('\n' + '='.repeat(72))
console.log('proto-Any typeUrls built:')
console.log('  -', swap.typeUrl)
console.log('  -', pos.typeUrl)
console.log('OK — 2 unsigned Osmosis msgs built + Any-wrapped, nothing signed/sent.')
console.log('='.repeat(72))
