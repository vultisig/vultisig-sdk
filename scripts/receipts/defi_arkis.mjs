#!/usr/bin/env node
// Runnable receipt for sdk.defi.arkis (lender supply).
//
// Builds an UNSIGNED Arkis approve+supply transaction sequence for both the
// ERC-4626 vault path and the standard Agreement path, with sample inputs, and
// prints the decoded calldata. NO network I/O, NO signing, NO broadcast.
//
// Run from the SDK package root:
//   node --import tsx scripts/receipts/defi_arkis.mjs
//
// The build calldata is pure (viem encodeFunctionData), so this is fully
// deterministic and offline.
import { decodeFunctionData, erc20Abi } from 'viem'

import { ARKIS_OFFICIAL_ADDRESSES } from '../../packages/sdk/src/tools/defi/arkis/addresses.ts'
import { buildArkisSupplyTx } from '../../packages/sdk/src/tools/defi/arkis/buildSupplyTx.ts'

const SENDER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const VAULT_POOL = '0x2222222222222222222222222222222222222222'
const AGREEMENT_POOL = '0x1111111111111111111111111111111111111111'
const USDC = '0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'

const erc4626DepositAbi = [
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'receiver', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
]
const agreementDepositAbi = [
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint128' }],
    outputs: [],
  },
]

function decodeLeg(tx) {
  if (tx.action === 'approve') {
    const { args } = decodeFunctionData({ abi: erc20Abi, data: tx.data })
    return `approve(spender=${args[0]}, amount=${args[1].toString()})`
  }
  const abi = tx.data.length > 74 ? erc4626DepositAbi : agreementDepositAbi
  const { args } = decodeFunctionData({ abi, data: tx.data })
  return args.length === 2
    ? `deposit(assets=${args[0].toString()}, receiver=${args[1]})`
    : `deposit(amount=${args[0].toString()})`
}

function printBuilt(label, built) {
  console.log(`\n=== ${label} ===`)
  console.log(`protocol=${built.protocol} chain=${built.chain} chainId=${built.chainId} poolKind=${built.poolKind}`)
  console.log(`pool=${built.poolAddress} token=${built.tokenAddress} from=${built.from} receiver=${built.receiver}`)
  console.log(`amountRaw=${built.amountRaw} affiliate=${built.affiliate ?? '(neutral/off)'}`)
  built.transactions.forEach((tx, i) => {
    console.log(`  tx[${i}] ${tx.action.toUpperCase()}  to=${tx.to} value=${tx.value}`)
    console.log(`         decoded: ${decodeLeg(tx)}`)
    console.log(`         data:    ${tx.data}`)
  })
}

console.log('sdk.defi.arkis — UNSIGNED lender supply receipt (no broadcast)')
console.log(`Arkis dispatcher (official): ${ARKIS_OFFICIAL_ADDRESSES.dispatcher}`)

// 1) ERC-4626 vault path: deposit(assets, receiver), receiver fixed to self.
printBuilt(
  'ERC-4626 vault supply — 1500 USDC',
  buildArkisSupplyTx({
    poolKind: 'erc4626_vault',
    poolAddress: VAULT_POOL,
    tokenAddress: USDC,
    from: SENDER,
    amount: '1500',
    decimals: 6,
  })
)

// 2) Standard Agreement path: deposit(uint128).
printBuilt(
  'Agreement supply — 2500.25 USDC',
  buildArkisSupplyTx({
    poolKind: 'agreement',
    poolAddress: AGREEMENT_POOL,
    tokenAddress: USDC,
    from: SENDER,
    amount: '2500.25',
    decimals: 6,
  })
)

// 3) Injectable affiliate: metadata-only, must NOT change the calldata.
const neutral = buildArkisSupplyTx({
  poolKind: 'agreement',
  poolAddress: AGREEMENT_POOL,
  tokenAddress: USDC,
  from: SENDER,
  amountRaw: 1_000_000n,
})
const tagged = buildArkisSupplyTx({
  poolKind: 'agreement',
  poolAddress: AGREEMENT_POOL,
  tokenAddress: USDC,
  from: SENDER,
  amountRaw: 1_000_000n,
  affiliate: 'example-consumer',
})
const calldataUnchanged =
  neutral.transactions[0].data === tagged.transactions[0].data &&
  neutral.transactions[1].data === tagged.transactions[1].data
console.log('\n=== Injectable affiliate (multi-consumer, default off) ===')
console.log(`neutral.affiliate=${neutral.affiliate ?? '(undefined)'}  tagged.affiliate=${tagged.affiliate}`)
console.log(`calldata identical regardless of affiliate: ${calldataUnchanged}`)

if (!calldataUnchanged) {
  console.error('FAIL: affiliate leaked into calldata')
  process.exit(1)
}
console.log('\nOK — unsigned Arkis approve+supply sequences built and decoded. No signing, no broadcast.')
