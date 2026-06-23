/**
 * Runnable receipt for sdk.validate.chainPrefix + sdk.address.classify/isValidFor.
 *
 * Pure FORMAT validation — no network, no signing. Classifies real mainnet
 * addresses to their chain family and flags an osmo-address-claimed-as-ethereum
 * HRP mismatch (the fund-safety case ported from the Go agent backend).
 *
 * Run:
 *   node --import tsx packages/sdk/scripts/receipts/validate_chain_prefix.mjs
 */

import { address, validate } from '../../src/utils/addressValidation.ts'

const KNOWN = [
  { label: 'ethereum (vitalik.eth)', addr: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' },
  { label: 'osmosis', addr: 'osmo1z0qrq605sjgcqpylfl4aa6s90x738j7m58wyat' },
  { label: 'solana', addr: '7EYnhQoR9YM3N7UoaKRoA44Uy8JeaZV3qyouov87awMs' },
  { label: 'bitcoin (bech32)', addr: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq' },
]

console.log('=== sdk.address.classify (real mainnet addresses) ===')
for (const { label, addr } of KNOWN) {
  console.log(
    `  ${label.padEnd(22)} -> ${address.classify(addr).padEnd(8)} (${addr.slice(0, 10)}…)`
  )
}

console.log('\n=== sdk.validate.chainPrefix — mismatch detection ===')
const osmoOnEth = validate.chainPrefix(
  'osmo1z0qrq605sjgcqpylfl4aa6s90x738j7m58wyat',
  'ethereum'
)
console.log('  osmo address claimed as ethereum:')
console.log('   ', JSON.stringify(osmoOnEth))

const ethOnEth = validate.chainPrefix(
  '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  'ethereum'
)
console.log('  eth address on ethereum:')
console.log('   ', JSON.stringify(ethOnEth))

console.log('\n=== valoper field-aware routing (cosmos staking, ported from Go cosmosValopers) ===')
const COSMOS_DELEGATOR = 'cosmos1qnk2n4nlkpw9xfqntladh74er2xa62wgas5zg'
const COSMOS_VALOPER = 'cosmosvaloper1clpqr4nrk4khgkxj78fcwwh6dl3uw4epsluffn'
const delegatorAsValidator = validate.chainPrefix(COSMOS_DELEGATOR, 'cosmos', 'validator')
const valoperAsValidator = validate.chainPrefix(COSMOS_VALOPER, 'cosmos', 'validator')
console.log('  cosmos1… delegator on a validator_address field (must be blocked):')
console.log('   ', JSON.stringify(delegatorAsValidator))
console.log('  cosmosvaloper1… operator on a validator_address field (must pass):')
console.log('   ', JSON.stringify(valoperAsValidator))

console.log('\n=== assertions ===')
const checks = [
  ['osmo->cosmos', address.classify('osmo1z0qrq605sjgcqpylfl4aa6s90x738j7m58wyat') === 'cosmos'],
  ['eth->evm', address.classify('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045') === 'evm'],
  ['sol->solana', address.classify('7EYnhQoR9YM3N7UoaKRoA44Uy8JeaZV3qyouov87awMs') === 'solana'],
  ['btc->btc', address.classify('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq') === 'btc'],
  ['osmo-as-eth is mismatch', osmoOnEth.valid === false && osmoOnEth.reason === 'mismatch'],
  ['eth-on-eth is match', ethOnEth.valid === true && ethOnEth.reason === 'match'],
  // valoper fund-safety: a cosmos1… delegator must NOT pass as a validator, a
  // cosmosvaloper1… operator MUST pass. Account role keeps account semantics.
  ['cosmos1 delegator blocked on validator field', delegatorAsValidator.valid === false && delegatorAsValidator.reason === 'mismatch'],
  ['cosmosvaloper1 operator passes on validator field', valoperAsValidator.valid === true && valoperAsValidator.reason === 'match'],
  ['valoper rejected under account role', address.isValidFor(COSMOS_VALOPER, 'cosmos') === false],
  ['valoper string not misread as solana', address.classify(COSMOS_VALOPER) !== 'solana'],
]
let ok = true
for (const [name, pass] of checks) {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}`)
  if (!pass) ok = false
}

if (!ok) {
  console.error('\nRECEIPT FAILED')
  process.exit(1)
}
console.log('\nRECEIPT OK — all checks passed')
