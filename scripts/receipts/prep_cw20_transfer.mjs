/**
 * Runnable receipt for `sdk.prep.cw20Transfer` (buildCw20TransferMsg).
 *
 * Builds an UNSIGNED CosmWasm CW-20 transfer execute msg with throwaway inputs
 * and prints its structure. Does ZERO network I/O. NEVER signs, NEVER broadcasts.
 *
 * Run from the worktree root:
 *   node --import tsx scripts/receipts/prep_cw20_transfer.mjs
 */
import { buildCw20TransferMsg } from '../../packages/sdk/src/tools/prep/cw20Transfer.ts'

// Throwaway, valid-checksum osmo bech32 vectors. Never funded, never broadcast.
const params = {
  bech32Prefix: 'osmo',
  contract: 'osmo1kyekxn2qmcjt902sywxm42a2h2d35ssn9ljpvuf77mewevup4kds298e77',
  recipient: 'osmo12f8hyk2prj2f5w2j3at9ndrxw390ejkr5nt99h',
  amount: '1000000',
  sender: 'osmo1c3a7qq6trpvdver98agv6d9cqex94889k5ejr7',
}

console.log('=== sdk.prep.cw20Transfer — UNSIGNED CW-20 transfer (no broadcast) ===\n')
console.log('inputs:')
console.log(JSON.stringify(params, null, 2))

const result = buildCw20TransferMsg(params)

console.log('\nexecute_msg (stringified, CW-20 transfer):')
console.log(result.executeMsg)

console.log('\nMsgExecuteContract amino msg (feed into prepareSignAminoTxFromKeys):')
console.log(JSON.stringify({ type: result.msg.type, value: JSON.parse(result.msg.value) }, null, 2))

console.log('\nvalidated fields:')
console.log(JSON.stringify({
  sender: result.sender,
  contract: result.contract,
  recipient: result.recipient,
  amount: result.amount,
}, null, 2))

// Demonstrate the fund-safety guard: a validator address is rejected.
try {
  buildCw20TransferMsg({
    ...params,
    recipient: 'osmovaloper1jfqzr62sfzylq6uh66ch49k4dvm3jd4qn40lvc',
  })
  console.log('\n[FAIL] validator guard did not fire')
  process.exit(1)
} catch (err) {
  console.log('\nfund-safety guard (validator recipient rejected):')
  console.log('  ' + err.message)
}

console.log('\n=== receipt OK — unsigned msg built, nothing signed or broadcast ===')
