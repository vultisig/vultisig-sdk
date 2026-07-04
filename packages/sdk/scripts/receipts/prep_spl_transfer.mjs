// Runnable receipt for sdk.prep.splTransfer (buildSplTransfer).
//
// Builds an UNSIGNED, ATA-aware Solana SPL transfer of 1 USDC to a throwaway
// address and prints the full structure (derived ATAs + unsigned instruction).
// PURE CRYPTO — no RPC, no signing, NO broadcast. Run with:
//
//   yarn workspace @vultisig/sdk tsx scripts/receipts/prep_spl_transfer.mjs
//
import { buildSplTransfer } from '../../src/tools/prep/splTransfer.ts'

// Well-known mainnet USDC mint + throwaway owner/recipient addresses.
// Never funded, never signed, never broadcast.
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const FROM = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
const TO = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'

const tx = buildSplTransfer({
  mint: USDC_MINT,
  from: FROM,
  to: TO,
  amount: 1_000_000n, // 1 USDC (6 decimals)
  decimals: 6,
})

console.log('=== sdk.prep.splTransfer — UNSIGNED SPL transfer (1 USDC) ===')
console.log(JSON.stringify(tx, null, 2))
console.log('\n=== derived ATAs (pure PDA math, no RPC) ===')
console.log('from ATA:', tx.fromTokenAccount)
console.log('to   ATA:', tx.toTokenAccount)
console.log('program :', tx.programId, tx.isToken2022 ? '(Token-2022)' : '(legacy Token Program)')
console.log('\n=== instruction account metas ===')
for (const k of tx.instruction.keys) {
  console.log(`  ${k.pubkey}  signer=${k.isSigner} writable=${k.isWritable}`)
}
console.log('\nNOTE: no signatures, no blockhash, no broadcast. vault.sign attaches those on-device.')
