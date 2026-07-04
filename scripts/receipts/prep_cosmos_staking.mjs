#!/usr/bin/env node
/**
 * Runnable receipt for `sdk.prep.cosmosStaking`.
 *
 * Builds a REAL unsigned `cosmos.staking.v1beta1.MsgDelegate` (5 OSMO) against
 * a LIVE Osmosis validator pulled from the public LCD, then prints the proto-Any
 * envelope + the decoded tx-body intent. Pure crypto: NO signing, NO broadcast.
 *
 * Run:  node --import tsx scripts/receipts/prep_cosmos_staking.mjs
 */
import { Buffer } from 'node:buffer'

import { bech32 } from 'bech32'

import {
  cosmosStaking,
} from '../../packages/sdk/src/tools/prep/cosmosStaking.ts'

const OSMO_LCD = 'https://lcd.osmosis.zone'
const DELEGATOR = 'osmo1runz6dpmgfy4q467v4k8x75p3z8ed8dyxqlpht' // demo account (no funds)
const AMOUNT_OSMO = 5
const DENOM = 'uosmo'
const DECIMALS = 6
const amountBaseUnits = String(AMOUNT_OSMO * 10 ** DECIMALS)

// --- tiny proto reader to prove the wire bytes round-trip (wire types 0/2) ---
function readVarint(buf, pos) {
  let value = 0, shift = 0, p = pos
  for (;;) {
    const b = buf[p++]
    value |= (b & 0x7f) << shift
    if ((b & 0x80) === 0) break
    shift += 7
  }
  return { value: value >>> 0, pos: p }
}
function decode(buf) {
  const out = []
  let pos = 0
  while (pos < buf.length) {
    const tag = readVarint(buf, pos); pos = tag.pos
    const num = tag.value >>> 3, wire = tag.value & 7
    const len = readVarint(buf, pos); pos = len.pos
    out.push({ num, value: buf.slice(pos, pos + len.value) }); pos += len.value
  }
  return out
}
const str = b => new TextDecoder().decode(b)

async function pickLiveValidator() {
  const url =
    `${OSMO_LCD}/cosmos/staking/v1beta1/validators` +
    `?status=BOND_STATUS_BONDED&pagination.limit=1`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`LCD ${res.status}`)
  const json = await res.json()
  const v = json.validators?.[0]
  if (!v?.operator_address) throw new Error('no bonded validator returned')
  return { address: v.operator_address, moniker: v.description?.moniker ?? '(unknown)' }
}

async function main() {
  let validator
  try {
    validator = await pickLiveValidator()
    console.log(`[live] Osmosis LCD bonded validator: ${validator.moniker} (${validator.address})`)
  } catch (err) {
    // Offline fallback so the receipt is deterministic even without network.
    validator = {
      address: 'osmovaloper18ez5c566v95x7anasj9e9xdq57htt0xrztjrg0',
      moniker: '(offline fallback)',
    }
    console.log(`[offline] LCD unreachable (${err.message}); using fallback validator`)
  }

  const env = cosmosStaking.delegate({
    delegatorAddress: DELEGATOR,
    validatorAddress: validator.address,
    amount: amountBaseUnits,
    denom: DENOM,
    accountPrefix: 'osmo',
    validatorPrefix: 'osmovaloper',
  })

  console.log('\n=== unsigned MsgDelegate envelope (proto Any) ===')
  console.log(JSON.stringify(env, null, 2))

  // Decode the wire bytes to show the human-readable tx intent.
  const fields = decode(new Uint8Array(Buffer.from(env.valueBase64, 'base64')))
  const coin = decode(fields.find(f => f.num === 3).value)
  const decoded = {
    typeUrl: env.typeUrl,
    delegator_address: str(fields.find(f => f.num === 1).value),
    validator_address: str(fields.find(f => f.num === 2).value),
    amount: {
      denom: str(coin.find(f => f.num === 1).value),
      amount: str(coin.find(f => f.num === 2).value),
    },
  }
  console.log('\n=== decoded tx intent (delegate 5 OSMO) ===')
  console.log(JSON.stringify(decoded, null, 2))

  // sanity assertions
  bech32.decode(decoded.delegator_address)
  bech32.decode(decoded.validator_address)
  if (decoded.amount.amount !== '5000000') throw new Error('amount mismatch')
  if (decoded.typeUrl !== '/cosmos.staking.v1beta1.MsgDelegate') throw new Error('typeUrl mismatch')

  console.log('\nOK — built an unsigned MsgDelegate (5 OSMO) from live validator data. No signing, no broadcast.')
}

main().catch(err => {
  console.error('receipt failed:', err)
  process.exit(1)
})
