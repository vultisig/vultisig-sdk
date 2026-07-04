#!/usr/bin/env node
/**
 * Runnable receipt for sdk.prep.trc20Transfer (prepareTrc20TransferFromKeys).
 *
 * Builds an UNSIGNED TRON TRC-20 (USDT) transfer with throwaway inputs and
 * prints its structure + the decoded ABI params. Pure crypto: NO RPC, NO
 * signing, NO broadcast. vault.sign stays on-device.
 *
 * Run:  yarn workspace @vultisig/sdk dlx tsx scripts/receipts/prep_trc20_transfer.mjs
 *   or: node --import tsx scripts/receipts/prep_trc20_transfer.mjs   (from packages/sdk)
 */
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const sdkSrc = resolve(here, '../../packages/sdk/src')

const { prepareTrc20TransferFromKeys, TRC20_TRANSFER_SELECTOR } = await import(
  resolve(sdkSrc, 'tools/prep/trc20.ts')
)
const { tronHexToBase58 } = await import(resolve(sdkSrc, 'abi/tron.ts'))

// Throwaway-but-real (base58check-valid) TRON mainnet inputs.
const INPUTS = {
  contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', // USDT TRC-20
  from: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
  to: 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH',
  amount: '1000000', // 1.000000 USDT (6 decimals)
  memo: 'SWAP:BTC.BTC:bc1qexampledestination:0',
}

const tx = prepareTrc20TransferFromKeys(INPUTS)

// Decode the ABI parameter back out to prove the calldata is correct.
const recipientWord = tx.parameter.slice(0, 64)
const amountWord = tx.parameter.slice(64)
const decodedRecipientHex = `41${recipientWord.slice(-40)}`
const decodedRecipient = tronHexToBase58(decodedRecipientHex)
const decodedAmount = BigInt(`0x${amountWord}`)

console.log('=== sdk.prep.trc20Transfer — UNSIGNED TRC-20 transfer ===\n')
console.log('inputs:')
console.log(JSON.stringify(INPUTS, null, 2))
console.log('\nunsigned tx descriptor:')
console.log(JSON.stringify(tx, null, 2))
console.log('\ndecoded ABI params (transfer(address,uint256)):')
console.log(`  selector string : ${TRC20_TRANSFER_SELECTOR}`)
console.log(`  recipient (word): ${recipientWord}`)
console.log(`  recipient (b58) : ${decodedRecipient}  ${decodedRecipient === INPUTS.to ? 'OK matches `to`' : 'MISMATCH!'}`)
console.log(`  amount    (word): ${amountWord}`)
console.log(`  amount    (dec) : ${decodedAmount.toString()}  ${decodedAmount === BigInt(INPUTS.amount) ? 'OK matches `amount`' : 'MISMATCH!'}`)

// Fund-safety assertions — the receipt fails loudly if the calldata drifts.
if (decodedRecipient !== INPUTS.to) throw new Error('recipient calldata does not round-trip')
if (decodedAmount !== BigInt(INPUTS.amount)) throw new Error('amount calldata does not round-trip')
if (tx.parameter.length !== 128) throw new Error('parameter is not 128 hex chars')

console.log('\nNO signing material emitted (keys):', Object.keys(tx).join(', '))
console.log('PASS — unsigned, deterministic, round-trips. Not signed, not broadcast.')
