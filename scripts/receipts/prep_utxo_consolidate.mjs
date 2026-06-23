/**
 * Runnable receipt for sdk.prep.utxoConsolidate (prepareUtxoConsolidateTxFromKeys).
 *
 * Builds an UNSIGNED Bitcoin consolidation KeysignPayload from throwaway
 * sample UTXOs + a public, throwaway vault identity and prints its structure.
 *
 * PURE CRYPTO ONLY: this BUILDS an unsigned KeysignPayload. It NEVER signs and
 * NEVER broadcasts — vault.sign() stays on-device.
 *
 * Run:
 *   node --import tsx scripts/receipts/prep_utxo_consolidate.mjs
 */

// Import the node platform entry so WalletCore WASM is configured.
import '../../packages/sdk/src/platforms/node/index.ts'
import { prepareUtxoConsolidateTxFromKeys } from '../../packages/sdk/src/tools/prep/utxoConsolidate.ts'

// Throwaway public identity. The ecdsa pubkey is the secp256k1 generator point
// G (a publicly-known, valid compressed pubkey) — derivation produces a real
// BTC pubkey. NEVER fund anything derived from this; there is no private key.
const identity = {
  ecdsaPublicKey: '0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798',
  eddsaPublicKey: '0000000000000000000000000000000000000000000000000000000000000000',
  hexChainCode: '0000000000000000000000000000000000000000000000000000000000000001',
  localPartyId: 'receipt-device',
  libType: 'DKLS',
}

// Sample throwaway UTXOs (sweep three small outputs into one).
const utxos = [
  { hash: 'a'.repeat(64), index: 0, value: 50_000n },
  { hash: 'b'.repeat(64), index: 1, value: 30_000n },
  { hash: 'c'.repeat(64), index: 2, value: 20_000n },
]

const byteFee = 12n // sat/vB

const result = await prepareUtxoConsolidateTxFromKeys(identity, {
  coin: { chain: 'Bitcoin', address: 'PLACEHOLDER_SELF_ADDRESS', decimals: 8, ticker: 'BTC' },
  utxos,
  byteFee,
})

const p = result.keysignPayload

console.log('=== sdk.prep.utxoConsolidate — UNSIGNED consolidation KeysignPayload ===')
console.log('chain          :', p.coin?.chain)
console.log('inputCount     :', result.inputCount)
console.log('totalInput sats:', result.totalInput.toString())
console.log('byteFee  sat/vB:', byteFee.toString())
console.log('fee        sats:', result.fee.toString())
console.log('outputAmount   :', result.outputAmount.toString())
console.log('toAddress      :', p.toAddress, '(send-to-self === from)')
console.log('toAmount       :', p.toAmount)
console.log('hexPublicKey   :', p.coin?.hexPublicKey)
console.log('sendMaxAmount  :', p.blockchainSpecific.case === 'utxoSpecific' ? p.blockchainSpecific.value.sendMaxAmount : '(n/a)')
console.log('byteFee(payload):', p.blockchainSpecific.case === 'utxoSpecific' ? p.blockchainSpecific.value.byteFee : '(n/a)')
console.log('inputs (utxoInfo):')
for (const u of p.utxoInfo) {
  console.log(`  - ${u.hash.slice(0, 8)}…:${u.index}  ${u.amount.toString()} sats`)
}
console.log('outputs        : 1 ->', p.toAddress, `(${p.toAmount} sats)`)
console.log('signed?        : NO — unsigned payload, vault.sign() stays on-device')
