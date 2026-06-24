// Runnable receipt: build an UNSIGNED 3Jane USDC supply tx via the SDK and print
// its structure + decoded calldata. NO signing, NO broadcast, NO network IO.
//
// Run (from packages/sdk):  node --import tsx scripts/receipts/defi_3jane.mjs
// The `tsx` import hook lets this .mjs pull the real builder straight from src.
import { decodeFunctionData, erc20Abi } from 'viem'

import { buildThreeJaneSupplyUsdc, THREE_JANE_ADDRESSES } from '../../src/tools/defi/threeJane/index.ts'

const helperDepositAbi = [
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'hop', type: 'bool' },
    ],
    outputs: [{ type: 'uint256' }],
  },
]

const SAMPLE = {
  from: '0x1111111111111111111111111111111111111111',
  amount: '1500.5',
  tranche: 'usd3',
  // receiver omitted -> defaults to `from` (neutral / self-only; no affiliate baked in)
}

const result = buildThreeJaneSupplyUsdc(SAMPLE)

const [approve, deposit] = result.transactions
const approveDecoded = decodeFunctionData({ abi: erc20Abi, data: approve.data })
const depositDecoded = decodeFunctionData({ abi: helperDepositAbi, data: deposit.data })

const json = (v) => JSON.stringify(v, (_k, val) => (typeof val === 'bigint' ? val.toString() : val), 2)

console.log('=== 3Jane USDC supply — UNSIGNED build receipt (no broadcast) ===\n')
console.log('Inputs:', json(SAMPLE), '\n')
console.log('Pinned addresses:', json(THREE_JANE_ADDRESSES), '\n')
console.log('Result summary:')
console.log(
  json({
    chain: result.chain,
    chainId: result.chainId,
    protocol: result.protocol,
    fromSymbol: result.fromSymbol,
    toSymbol: result.toSymbol,
    fromAddress: result.fromAddress,
    receiver: result.receiver,
    tranche: result.tranche,
    amountRaw: result.amountRaw,
    amountUsdc: result.amountUsdc,
    minDepositUsdc: result.minDepositUsdc,
    txCount: result.transactions.length,
  }),
  '\n',
)

console.log('--- Step 1: ERC-20 approve (raw + decoded) ---')
console.log(json({ to: approve.to, value: approve.value, action: approve.action, data: approve.data }))
console.log('decoded:', json({ fn: approveDecoded.functionName, args: approveDecoded.args }), '\n')

console.log('--- Step 2: 3Jane Helper.deposit (raw + decoded) ---')
console.log(json({ to: deposit.to, value: deposit.value, action: deposit.action, data: deposit.data }))
console.log('decoded:', json({ fn: depositDecoded.functionName, args: depositDecoded.args }), '\n')

// Hard assertions so the receipt FAILS loudly if the build ever drifts.
const assert = (cond, msg) => {
  if (!cond) {
    console.error('RECEIPT ASSERTION FAILED:', msg)
    process.exit(1)
  }
}
assert(result.transactions.length === 2, 'expected exactly 2 unsigned txs')
assert(approveDecoded.functionName === 'approve', 'step 1 must be approve')
assert(depositDecoded.functionName === 'deposit', 'step 2 must be Helper.deposit')
assert(depositDecoded.args[0] === 1_500_500_000n, 'deposit amount must equal parsed raw USDC')
assert(
  depositDecoded.args[1].toLowerCase() === SAMPLE.from.toLowerCase(),
  'receiver must default to the funder',
)
assert(depositDecoded.args[2] === false, 'usd3 tranche must set hop=false')
assert(!json(result).toLowerCase().includes('station'), 'no station/affiliate may be hardcoded')

console.log('OK — unsigned 3Jane supply tx built + decoded, all assertions passed.')
