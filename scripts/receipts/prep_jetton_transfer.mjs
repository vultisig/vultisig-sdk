/**
 * Runnable receipt for `prepareJettonTransferTxFromKeys` (TON Jetton transfer).
 *
 * Run with (from repo root):  npx tsx scripts/receipts/prep_jetton_transfer.mjs
 *  tsx transpiles the imported .ts source on the fly — no dist build / no WASM
 *  needed since the helper only touches @ton/core.
 *
 * Builds an UNSIGNED jetton transfer with THROWAWAY inputs and prints the
 * unsigned-tx structure (signing hash, from-address, decoded body cell).
 * It NEVER signs and NEVER broadcasts — finalize() is left untouched.
 */
import { Address, Cell } from '@ton/core'

import { prepareJettonTransferTxFromKeys } from '../../packages/sdk/src/tools/prep/jettonTransfer.ts'

// THROWAWAY deterministic Ed25519 pubkey (all 0x01) — never a real vault key.
const identity = {
  ecdsaPublicKey: '02deadbeefdeadbeef',
  eddsaPublicKey: '01'.repeat(32),
  hexChainCode: 'deadbeefdeadbeefdeadbeefdeadbeef',
  localPartyId: 'receipt-throwaway',
  libType: 'DKLS', // unused by this TON-pure helper; field is required by VaultIdentity
}

const RECIPIENT = 'UQCXhTIYi7zucgALWCxYRAHjwJbLDyZVUZVOa-FzD7UA5P5O'
const JETTON_WALLET = 'EQAtiFQ15MZBgpAGwD1jfJm6maz5otBOPefyw9Wc3MVmMgzp'
const AMOUNT = 1_000_000n // 1.0 of a 6-decimal jetton (e.g. USDT)

const tx = prepareJettonTransferTxFromKeys(identity, {
  receiver: RECIPIENT,
  jettonWalletAddress: JETTON_WALLET,
  amount: AMOUNT,
  memo: 'receipt-demo',
  seqno: 0, // first send -> StateInit auto-attached on finalize
  validUntil: 1_700_000_000, // pinned so the receipt is reproducible
})

// Decode the unsigned signing-payload BoC down to the jetton transfer body:
//   signingPayload -> ref(innerMsg) -> ref(jettonBody)
const root = Cell.fromBoc(Buffer.from(tx.unsignedBocHex, 'hex'))[0]
const innerMsg = root.refs[0]
const jettonBody = innerMsg.refs[0]
const s = jettonBody.beginParse()
const op = s.loadUint(32)
const queryId = s.loadUintBig(64)
const jettonAmount = s.loadCoins()
const destination = s.loadAddress()

console.log('=== prepareJettonTransferTxFromKeys — UNSIGNED TON Jetton transfer ===')
console.log('from (derived from pubkey):', tx.fromAddress)
console.log('signingHashHex           :', tx.signingHashHex)
console.log('unsignedBoc bytes        :', tx.unsignedBocHex.length / 2)
console.log('finalize is a closure    :', typeof tx.finalize === 'function', '(NOT called — no sign, no broadcast)')
console.log('--- decoded jetton transfer body cell ---')
console.log('op (transfer 0xf8a7ea5)  :', '0x' + op.toString(16))
console.log('query_id                 :', queryId.toString())
console.log('jetton amount (base)     :', jettonAmount.toString())
console.log('destination              :', destination.toString())
console.log('destination matches arg  :', destination.toString() === Address.parse(RECIPIENT).toString())
console.log('signing-payload BoC (hex):', tx.unsignedBocHex)
console.log('=== done — nothing signed, nothing broadcast ===')
