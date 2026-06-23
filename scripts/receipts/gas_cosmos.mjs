/**
 * Runnable receipt for sdk.gas.cosmos (cosmos gas-fee label).
 *
 * Exercises the REAL shipped primitive
 * (`packages/sdk/src/tools/gas/cosmos.ts`) — no copy, no broadcast, no signing.
 * Computes `gas_limit × gas_price` cosmos swap fee labels for sample chains and
 * prints them.
 *
 *   Run: node --import tsx scripts/receipts/gas_cosmos.mjs
 */
import {
  COSMOS_SWAP_FEE_LABEL_CHAINS,
  COSMOS_SWAP_GAS_LIMIT,
  estimateCosmosSwapFeeLabel,
  getCosmosGasLimit,
  getCosmosSwapGasLimit,
} from '../../packages/sdk/src/tools/gas/cosmos.ts'

console.log('=== sdk.gas.cosmos receipt ===')
console.log(`COSMOS_SWAP_GAS_LIMIT (heuristic source-leg): ${COSMOS_SWAP_GAS_LIMIT}`)
console.log(`label-eligible chains: ${COSMOS_SWAP_FEE_LABEL_CHAINS.join(', ')}`)
console.log('')

console.log('-- estimateCosmosSwapFeeLabel (gas_limit x gas_price, ~<amt> <TICKER>) --')
for (const chain of ['Cosmos', 'Osmosis', 'Kujira', 'Terra', 'TerraClassic']) {
  const label = estimateCosmosSwapFeeLabel(chain)
  console.log(`  ${chain.padEnd(13)} -> "${label}"  (gasLimit=${getCosmosSwapGasLimit(chain)})`)
}

console.log('')
console.log('-- gasLimit override (Cosmos @ 700k) --')
console.log(`  Cosmos        -> "${estimateCosmosSwapFeeLabel('Cosmos', { gasLimit: 700_000n })}"`)

console.log('')
console.log('-- flat-fee / non-cosmos chains return "" (no regression) --')
for (const chain of ['THORChain', 'MayaChain', 'Ethereum', 'Bitcoin']) {
  console.log(`  ${chain.padEnd(13)} -> "${estimateCosmosSwapFeeLabel(chain)}"`)
}

console.log('')
console.log('-- getCosmosGasLimit (per-coin native limit, re-export from core-chain) --')
const samples = [
  { chain: 'Cosmos', id: 'uatom' },
  { chain: 'Osmosis', id: 'uosmo' },
  { chain: 'TerraClassic', id: 'uluna' },
  { chain: 'TerraClassic', id: 'uusd' }, // burn-tax override -> 1M
]
for (const coin of samples) {
  console.log(`  ${coin.chain}/${coin.id.padEnd(6)} -> ${getCosmosGasLimit(coin)} gas`)
}

console.log('')
console.log('OK: computed real cosmos gas-fee labels (no network, no signing, no broadcast)')
