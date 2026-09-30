#!/usr/bin/env node
/**
 * Runnable receipt for sdk.bridge.cctp.
 *
 * Builds a REAL unsigned CCTP USDC bridge (burn) sequence base -> arbitrum
 * after verifying the registered destination contract on the live RPC, then
 * decodes the encoded selectors/args. Does not construct or execute a claim.
 *
 * Build-unsigned only — NOTHING is signed or broadcast.
 *
 * Run:  node --import tsx scripts/receipts/bridge_cctp.mjs
 *
 * Execute against the source builder and built shared packages. The source
 * builder now performs a mandatory, bounded destination eth_getCode request.
 */

import { getEvmClient } from '@vultisig/core-chain/chains/evm/client'
import { decodeFunctionData, keccak256, toFunctionSelector } from 'viem'

import {
  buildCctpBridge,
  cctpSupportedChains,
  getCctpChain,
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
const line = '─'.repeat(64)

console.log('CCTP supported chains:', cctpSupportedChains.join(', '))
console.log(line)

const destination = getCctpChain('Arbitrum')
const client = getEvmClient(destination.chain)
const readCode = client.getCode.bind(client)
client.getCode = async args => {
  const code = await readCode(args)
  console.log('LIVE destination MessageTransmitter code:', {
    chain: destination.chain,
    address: args.address,
    bytes: code ? (code.length - 2) / 2 : 0,
    codeHash: code && code !== '0x' ? keccak256(code) : null,
    observedAt: new Date().toISOString(),
  })
  return code
}

// ─── 1. BRIDGE (burn) base -> arbitrum, 10 USDC ──────────────────────
const bridge = await buildCctpBridge({
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

console.log('OK: validated live destination code and built/decoded unsigned CCTP bridge. Nothing signed/broadcast.')
