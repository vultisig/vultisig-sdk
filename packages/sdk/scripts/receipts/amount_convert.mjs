/**
 * Runnable receipt for sdk.amount.convert (base↔human, fiat↔crypto).
 *
 * Run from packages/sdk:
 *   node --import tsx scripts/receipts/amount_convert.mjs
 *
 * The convertAmount module is PURE (no SDK/walletcore/network imports), so we
 * import the TypeScript source directly via the `tsx` loader and exercise the
 * real exported functions — this is what proves the primitive works.
 */
import {
  convertAmount,
  cryptoToFiat,
  fiatToCrypto,
  toBaseUnits,
  toHumanUnits,
} from '../../src/utils/convertAmount.ts'

const line = (label, value) => console.log(`${label.padEnd(46)} ${value}`)

console.log('=== sdk.amount.convert — runnable receipt ===\n')

console.log('-- base ↔ human (pure string math, precision-exact) --')
line('1.5 ETH  → wei (decimals=18)', toBaseUnits('1.5', 18))
line('100 USDC base-units → human (decimals=6)', toHumanUnits('100000000', 6))
line('1 wei → ETH (decimals=18)', toHumanUnits('1', 18))
line('convertAmount to_base 0.05 ETH', convertAmount({ amount: '0.05', decimals: 18, direction: 'to_base' }))

console.log('\n-- precision beyond Number.MAX_SAFE_INTEGER --')
const bigHuman = '123456789.123456789'
const bigBase = toBaseUnits(bigHuman, 18)
line(`${bigHuman} ETH → wei`, bigBase)
line('round-trip wei → ETH', toHumanUnits(bigBase, 18))

console.log('\n-- fiat ↔ crypto (price supplied as input) --')
line('$100 of ETH @ $2000 → ETH', fiatToCrypto({ fiatValue: 100, price: 2000, decimals: 18 }))
line('0.05 ETH @ $2000 → USD', cryptoToFiat({ amount: 0.05, price: 2000 }))

console.log('\n-- assertions --')
const checks = [
  ['toBaseUnits 1.5/18', toBaseUnits('1.5', 18), '1500000000000000000'],
  ['toHumanUnits 100e6/6', toHumanUnits('100000000', 6), '100'],
  ['bigBase precision', bigBase, '123456789123456789000000000'],
  ['fiatToCrypto', fiatToCrypto({ fiatValue: 100, price: 2000, decimals: 18 }), '0.05'],
  ['cryptoToFiat', cryptoToFiat({ amount: 0.05, price: 2000 }), '100'],
]
let ok = true
for (const [name, got, want] of checks) {
  const pass = got === want
  ok = ok && pass
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}  got=${got} want=${want}`)
}
console.log(`\n${ok ? 'ALL RECEIPT CHECKS PASS ✅' : 'RECEIPT CHECKS FAILED ❌'}`)
process.exit(ok ? 0 : 1)
