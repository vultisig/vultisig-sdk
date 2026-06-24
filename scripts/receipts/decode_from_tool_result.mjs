/**
 * Runnable receipt for sdk.decode.fromToolResult — the canonical bytes oracle.
 *
 * Decodes a REAL ERC-20 transfer (EVM RLP, via viem) and a REAL Cosmos MsgSend
 * (proto3, via cosmjs-types) into the same chain-agnostic Envelope shape, prints
 * both, and asserts the recipient round-trips through the wire.
 *
 *   node scripts/receipts/decode_from_tool_result.mjs
 *
 * NO broadcast, NO signing — pure decode.
 */
import { MsgSend } from 'cosmjs-types/cosmos/bank/v1beta1/tx'
import { TxBody, TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx'
import { Any } from 'cosmjs-types/google/protobuf/any'
import { encodeFunctionData, getAddress, parseAbi, serializeTransaction } from 'viem'

import { decodeFromToolResult } from '../../packages/sdk/src/tools/decode/index.ts'

let failures = 0
const ok = (cond, label) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`)
  if (!cond) failures++
}

// ── 1) EVM: real ERC-20 transfer calldata wrapped in an unsigned EIP-1559 tx ──
const USDC = getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48') // mainnet USDC
const EVM_RECIPIENT = getAddress('0x70997970C51812dc3A010C7d01b50e0d17dc79C8')

const evmCalldata = encodeFunctionData({
  abi: parseAbi(['function transfer(address to, uint256 value)']),
  functionName: 'transfer',
  args: [EVM_RECIPIENT, 1_000_000n], // 1.0 USDC (6 decimals)
})
const evmUnsignedTx = serializeTransaction({
  to: USDC,
  value: 0n,
  data: evmCalldata,
  chainId: 8453, // Base — typed tx carries the chain id on the wire
  nonce: 0,
  gas: 60_000n,
  maxFeePerGas: 30_000_000_000n,
  maxPriorityFeePerGas: 1_000_000_000n,
  type: 'eip1559',
})

const evmEnv = decodeFromToolResult({
  toolName: 'build_erc20_tx',
  family: 'evm',
  chain: 'base',
  payload: evmUnsignedTx,
  args: { token: 'USDC' },
})

console.log('── EVM: ERC-20 transfer (USDC, 1.0) ──')
console.log('  unsigned tx bytes:', evmUnsignedTx)
console.log('  Envelope:', JSON.stringify(evmEnv, null, 2))
ok(evmEnv.decoded, 'evm decoded')
ok(evmEnv.recipient === EVM_RECIPIENT, `evm recipient round-trips (${evmEnv.recipient})`)
ok(evmEnv.recipient !== USDC, 'evm recipient is the calldata `to`, NOT the token contract')
ok(evmEnv.asset.contract === USDC, 'evm asset.contract is the token contract')
ok(evmEnv.amount === '1000000', `evm amount = 1000000 atomic (${evmEnv.amount})`)
ok(
  evmEnv.chain === 'base',
  `evm typed-tx chain id (8453) resolved to the symbolic name (${evmEnv.chain})`,
)

// ── 2) Cosmos: real MsgSend proto3 tx bytes ──
const COSMOS_FROM = 'cosmos1pkptre7fdkl6gfrzlesjjvhxhlc3r4gmmk8rs6'
const COSMOS_TO = 'cosmos1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu'

const msgSendAny = Any.fromPartial({
  typeUrl: '/cosmos.bank.v1beta1.MsgSend',
  value: MsgSend.encode(
    MsgSend.fromPartial({
      fromAddress: COSMOS_FROM,
      toAddress: COSMOS_TO,
      amount: [{ denom: 'uatom', amount: '2500000' }], // 2.5 ATOM
    })
  ).finish(),
})
const txBody = TxBody.fromPartial({ messages: [msgSendAny], memo: '' })
const txRaw = TxRaw.fromPartial({
  bodyBytes: TxBody.encode(txBody).finish(),
  authInfoBytes: new Uint8Array(),
  signatures: [],
})
const cosmosTxB64 = Buffer.from(TxRaw.encode(txRaw).finish()).toString('base64')

const cosmosEnv = decodeFromToolResult({
  toolName: 'execute_send',
  family: 'cosmos',
  chain: 'cosmoshub-4',
  payload: cosmosTxB64,
})

console.log('\n── Cosmos: MsgSend (ATOM, 2.5) ──')
console.log('  proto3 tx bytes (base64):', cosmosTxB64)
console.log('  Envelope:', JSON.stringify(cosmosEnv, null, 2))
ok(cosmosEnv.decoded, 'cosmos decoded')
ok(cosmosEnv.recipient === COSMOS_TO, `cosmos recipient round-trips (${cosmosEnv.recipient})`)
ok(cosmosEnv.amount === '2500000', `cosmos amount = 2500000 uatom (${cosmosEnv.amount})`)
ok(cosmosEnv.asset.symbol === 'ATOM', `cosmos symbol derived from denom (${cosmosEnv.asset.symbol})`)

// ── both produce the SAME Envelope shape ──
const sameShape = JSON.stringify(Object.keys(evmEnv).sort()) === JSON.stringify(Object.keys(cosmosEnv).sort())
console.log('\n── shared Envelope shape ──')
ok(sameShape, `EVM and Cosmos produce the identical Envelope keys: ${Object.keys(evmEnv).sort().join(', ')}`)

console.log(`\n${failures === 0 ? 'RECEIPT OK — all assertions passed' : `RECEIPT FAILED — ${failures} assertion(s) failed`}`)
process.exit(failures === 0 ? 0 : 1)
