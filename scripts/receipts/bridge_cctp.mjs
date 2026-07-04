#!/usr/bin/env node
/**
 * Runnable receipt for sdk.bridge.cctp.
 *
 * Builds a REAL unsigned CCTP USDC bridge (burn) sequence base -> arbitrum
 * and a real claim tx, decodes the encoded selectors/args, and pings
 * Circle's live attestation API to prove the endpoint is reachable.
 *
 * Build-unsigned only — NOTHING is signed or broadcast.
 *
 * Run:  node --import tsx scripts/receipts/bridge_cctp.mjs
 *
 * The bridge module is pure crypto (viem + a static registry that imports
 * only the `EvmChain` const enum), so tsx can execute the TS source
 * directly against the built `@vultisig/core-chain` dist.
 */

import { decodeFunctionData, toFunctionSelector } from 'viem'

import {
  buildCctpBridge,
  buildCctpClaim,
  cctpAttestationApiBase,
  cctpSupportedChains,
} from '../../packages/sdk/src/tools/bridge/index.ts'

const SENDER = '0x1111111111111111111111111111111111111111'

const erc20ApproveAbi = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
]
const tokenMessengerAbi = [
  {
    name: 'depositForBurn',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'destinationDomain', type: 'uint32' },
      { name: 'mintRecipient', type: 'bytes32' },
      { name: 'burnToken', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint64' }],
  },
]
const messageTransmitterAbi = [
  {
    name: 'receiveMessage',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'message', type: 'bytes' },
      { name: 'attestation', type: 'bytes' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
]

const line = '─'.repeat(64)

console.log('CCTP supported chains:', cctpSupportedChains.join(', '))
console.log(line)

// ─── 1. BRIDGE (burn) base -> arbitrum, 10 USDC ──────────────────────
const bridge = buildCctpBridge({
  sourceChain: 'Base',
  destinationChain: 'Arbitrum',
  amount: '10',
  from: SENDER,
})

console.log('BRIDGE  base -> arbitrum  (10 USDC)')
console.log('  provider          :', bridge.provider)
console.log('  source chainId    :', bridge.chainId)
console.log('  destinationDomain :', bridge.destinationDomain, '(CCTP domain, not EVM chain id)')
console.log('  recipient         :', bridge.recipient)
console.log('  amountRaw         :', bridge.amountRaw)

for (const tx of bridge.transactions) {
  const abi = tx.action === 'approve' ? erc20ApproveAbi : tokenMessengerAbi
  const fnName = tx.action === 'approve' ? 'approve' : 'depositForBurn'
  const selector = toFunctionSelector(abi[0])
  const decoded = decodeFunctionData({ abi, data: tx.data })
  console.log(`  tx[${tx.action}]`)
  console.log('    to       :', tx.to)
  console.log('    selector :', selector, `(${decoded.functionName})`)
  console.log('    args     :', JSON.stringify(decoded.args.map(String)))
  if (decoded.functionName !== fnName) {
    throw new Error(`receipt FAILED: expected ${fnName}, decoded ${decoded.functionName}`)
  }
}
console.log(line)

// ─── 2. CLAIM (mint) on arbitrum ─────────────────────────────────────
// Realistic shapes: an even-length message + a single 65-byte V1 attestation.
const message = '0x' + 'ab'.repeat(216)
const attestation = '0x' + 'cd'.repeat(65)
const claim = buildCctpClaim({
  destinationChain: 'Arbitrum',
  message,
  attestation,
})

const claimSelector = toFunctionSelector(messageTransmitterAbi[0])
const decodedClaim = decodeFunctionData({ abi: messageTransmitterAbi, data: claim.tx.data })
console.log('CLAIM   arbitrum  (receiveMessage)')
console.log('  dest chainId      :', claim.chainId)
console.log('  to (transmitter)  :', claim.tx.to)
console.log('  selector          :', claimSelector, `(${decodedClaim.functionName})`)
console.log('  message bytes     :', (message.length - 2) / 2)
console.log('  attestation bytes :', (attestation.length - 2) / 2, '(must be n*65)')
if (decodedClaim.functionName !== 'receiveMessage') {
  throw new Error('receipt FAILED: claim did not encode receiveMessage')
}
console.log(line)

// ─── 3. LIVE Circle attestation API reachability ─────────────────────
// Pure read; no signing. A random hash returns 404 with a JSON body,
// which proves the endpoint resolves + serves (vs a DNS/connection fail).
const randomHash = '0x' + 'ee'.repeat(32)
const url = `${cctpAttestationApiBase}/attestations/${randomHash}`
try {
  const resp = await fetch(url)
  const body = await resp.text()
  console.log('LIVE    Circle attestation API')
  console.log('  GET', url)
  console.log('  HTTP', resp.status, '->', body.slice(0, 120))
} catch (err) {
  console.log('LIVE    Circle attestation API unreachable (offline):', String(err))
}
console.log(line)
console.log('OK: built + decoded CCTP bridge(burn) + claim(mint). Nothing signed/broadcast.')
