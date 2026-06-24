import { MsgSend } from 'cosmjs-types/cosmos/bank/v1beta1/tx'
import { MsgDelegate, MsgUndelegate } from 'cosmjs-types/cosmos/staking/v1beta1/tx'
import { TxBody, TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx'
import { Any } from 'cosmjs-types/google/protobuf/any'
import { type Address, encodeFunctionData, getAddress, type Hex, parseAbi, serializeTransaction } from 'viem'
import { describe, expect, it } from 'vitest'

import { decodeFromToolResult } from '@/tools/decode'

/**
 * The keystone bytes-oracle: `decodeFromToolResult` is the ONE decoder shared by
 * every safety surface (isolate hostValidate, CLI WYSIWYS, app decoded-intent
 * card, co-sign gate, shadow-diff). These tests pin its contract on real
 * on-the-wire bytes — EVM RLP (viem) and Cosmos proto3 (cosmjs-types) — so the
 * recipient/amount it lifts can never silently drift from what was encoded.
 *
 * Ported from the Go reference internal/safety/envelope.go.
 */

const USDC = getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
const RECIPIENT = getAddress('0x70997970C51812dc3A010C7d01b50e0d17dc79C8')

/** Build an unsigned EIP-1559 (typed) tx carrying `data` to `to`. */
function buildEvmTx(to: Address, data: Hex, value = 0n, chainId = 1): Hex {
  return serializeTransaction({
    to,
    value,
    data,
    chainId,
    nonce: 0,
    gas: 60_000n,
    maxFeePerGas: 30_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
    type: 'eip1559',
  })
}

/** Build an unsigned legacy (type-0) EIP-155 tx carrying `data` to `to`. */
function buildLegacyEvmTx(to: Address, data: Hex, value = 0n, chainId = 1): Hex {
  return serializeTransaction({
    to,
    value,
    data,
    chainId,
    nonce: 0,
    gas: 60_000n,
    gasPrice: 30_000_000_000n,
    type: 'legacy',
  })
}

/** Wrap proto3 messages into TxRaw wire bytes (base64). */
function buildCosmosTx(messages: Any[]): string {
  const body = TxBody.fromPartial({ messages, memo: '' })
  const raw = TxRaw.fromPartial({
    bodyBytes: TxBody.encode(body).finish(),
    authInfoBytes: new Uint8Array(),
    signatures: [],
  })
  return Buffer.from(TxRaw.encode(raw).finish()).toString('base64')
}

describe('decodeFromToolResult — EVM half (viem)', () => {
  it('decodes an ERC-20 transfer: tx.to is the token contract, recipient + amount from calldata', () => {
    const data = encodeFunctionData({
      abi: parseAbi(['function transfer(address to, uint256 value)']),
      functionName: 'transfer',
      args: [RECIPIENT, 1_000_000n],
    })
    const payload = buildEvmTx(USDC, data)

    const env = decodeFromToolResult({ family: 'evm', chain: 'ethereum', payload, args: { token: 'USDC' } })

    expect(env.decoded).toBe(true)
    expect(env.kind).toBe('transfer')
    // Recipient is the calldata `to`, NOT the token contract.
    expect(env.recipient).toBe(RECIPIENT)
    expect(env.recipient).not.toBe(USDC)
    expect(env.asset.contract).toBe(USDC)
    expect(env.amount).toBe('1000000')
    expect(env.asset.symbol).toBe('USDC')
    // Typed tx carries the chain id on the wire — resolved to the symbolic
    // chain name (1 -> "ethereum") so the policy layer can match it.
    expect(env.chain).toBe('ethereum')
  })

  it('round-trips the recipient: decode(encode(recipient)) === recipient', () => {
    const data = encodeFunctionData({
      abi: parseAbi(['function transfer(address to, uint256 value)']),
      functionName: 'transfer',
      args: [RECIPIENT, 42n],
    })
    const env = decodeFromToolResult({ family: 'evm', chain: 'ethereum', payload: buildEvmTx(USDC, data) })
    expect(getAddress(env.recipient)).toBe(RECIPIENT)
    expect(env.amount).toBe('42')
  })

  it('decodes a native ETH send: tx.to is the recipient, tx.value the amount', () => {
    const payload = buildEvmTx(RECIPIENT, '0x', 5_000_000_000_000_000_000n)
    const env = decodeFromToolResult({ family: 'evm', chain: 'ethereum', payload })
    expect(env.decoded).toBe(true)
    expect(env.kind).toBe('transfer')
    expect(env.recipient).toBe(RECIPIENT)
    expect(env.amount).toBe('5000000000000000000')
    expect(env.asset.contract).toBe('') // native
  })

  it('decodes approve: spender + amount, recipient empty', () => {
    const data = encodeFunctionData({
      abi: parseAbi(['function approve(address spender, uint256 value)']),
      functionName: 'approve',
      args: [RECIPIENT, 2n ** 256n - 1n],
    })
    const env = decodeFromToolResult({ family: 'evm', chain: 'ethereum', payload: buildEvmTx(USDC, data) })
    expect(env.kind).toBe('approve')
    expect(env.spender).toBe(RECIPIENT)
    expect(env.asset.contract).toBe(USDC)
    expect(env.recipient).toBe('')
  })

  it('classifies an unrecognised contract call: recipient stays the contract', () => {
    const env = decodeFromToolResult({
      family: 'evm',
      chain: 'ethereum',
      payload: buildEvmTx(USDC, '0xdeadbeef'),
    })
    expect(env.decoded).toBe(true)
    expect(env.kind).toBe('contractCall')
    expect(env.recipient).toBe(USDC)
  })

  it('pulls the payload from args.unsigned_payload when `payload` is omitted', () => {
    const data = encodeFunctionData({
      abi: parseAbi(['function transfer(address to, uint256 value)']),
      functionName: 'transfer',
      args: [RECIPIENT, 7n],
    })
    const env = decodeFromToolResult({
      family: 'evm',
      chain: 'ethereum',
      args: { unsigned_payload: buildEvmTx(USDC, data) },
    })
    expect(env.recipient).toBe(RECIPIENT)
    expect(env.amount).toBe('7')
  })

  it('fails closed (decoded=false) on malformed EVM bytes — never throws', () => {
    const env = decodeFromToolResult({ family: 'evm', chain: 'ethereum', payload: '0xabcd' })
    expect(env.decoded).toBe(false)
    expect(env.decodeError).toContain('evm')
  })
})

describe('decodeFromToolResult — Cosmos half (cosmjs-types proto3)', () => {
  const FROM = 'cosmos1pkptre7fdkl6gfrzlesjjvhxhlc3r4gmmk8rs6'
  const TO = 'cosmos1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu'

  it('decodes a MsgSend: recipient + amount + denom from proto3 bytes', () => {
    const any = Any.fromPartial({
      typeUrl: '/cosmos.bank.v1beta1.MsgSend',
      value: MsgSend.encode(
        MsgSend.fromPartial({ fromAddress: FROM, toAddress: TO, amount: [{ denom: 'uatom', amount: '2500000' }] })
      ).finish(),
    })
    const env = decodeFromToolResult({ family: 'cosmos', chain: 'cosmoshub-4', payload: buildCosmosTx([any]) })

    expect(env.decoded).toBe(true)
    expect(env.kind).toBe('transfer')
    expect(env.recipient).toBe(TO)
    expect(env.amount).toBe('2500000')
    expect(env.asset.contract).toBe('uatom')
    expect(env.asset.symbol).toBe('ATOM')
    // proto3 carries no chain id — the hint stands.
    expect(env.chain).toBe('cosmoshub-4')
  })

  it('round-trips the recipient across the proto3 wire', () => {
    const any = Any.fromPartial({
      typeUrl: '/cosmos.bank.v1beta1.MsgSend',
      value: MsgSend.encode(
        MsgSend.fromPartial({ fromAddress: FROM, toAddress: TO, amount: [{ denom: 'uosmo', amount: '1' }] })
      ).finish(),
    })
    const env = decodeFromToolResult({ family: 'cosmos', chain: 'osmosis-1', payload: buildCosmosTx([any]) })
    expect(env.recipient).toBe(TO)
  })

  it('decodes a MsgDelegate: validator recipient + amount', () => {
    const any = Any.fromPartial({
      typeUrl: '/cosmos.staking.v1beta1.MsgDelegate',
      value: MsgDelegate.encode(
        MsgDelegate.fromPartial({
          delegatorAddress: FROM,
          validatorAddress: 'cosmosvaloper1abc',
          amount: { denom: 'uatom', amount: '1000000' },
        })
      ).finish(),
    })
    const env = decodeFromToolResult({ family: 'cosmos', chain: 'cosmoshub-4', payload: buildCosmosTx([any]) })
    expect(env.kind).toBe('delegate')
    expect(env.recipient).toBe('cosmosvaloper1abc')
    expect(env.amount).toBe('1000000')
  })

  it('pulls base64 payload from args.cosmos_payload', () => {
    const any = Any.fromPartial({
      typeUrl: '/cosmos.bank.v1beta1.MsgSend',
      value: MsgSend.encode(
        MsgSend.fromPartial({ fromAddress: FROM, toAddress: TO, amount: [{ denom: 'uatom', amount: '9' }] })
      ).finish(),
    })
    const env = decodeFromToolResult({
      family: 'cosmos',
      chain: 'cosmoshub-4',
      args: { cosmos_payload: buildCosmosTx([any]) },
    })
    expect(env.recipient).toBe(TO)
    expect(env.amount).toBe('9')
  })

  it('fails closed on a multi-message tx (would let drift ride through)', () => {
    const send = Any.fromPartial({
      typeUrl: '/cosmos.bank.v1beta1.MsgSend',
      value: MsgSend.encode(
        MsgSend.fromPartial({ fromAddress: FROM, toAddress: TO, amount: [{ denom: 'uatom', amount: '1' }] })
      ).finish(),
    })
    const env = decodeFromToolResult({ family: 'cosmos', chain: 'cosmoshub-4', payload: buildCosmosTx([send, send]) })
    expect(env.decoded).toBe(false)
    expect(env.decodeError).toContain('multi-message')
  })

  it('fails closed on garbage cosmos bytes — never throws', () => {
    const env = decodeFromToolResult({
      family: 'cosmos',
      chain: 'cosmoshub-4',
      payload: Buffer.from('not a real tx').toString('base64'),
    })
    expect(env.decoded).toBe(false)
  })
})

describe('decodeFromToolResult — EVM multicall batch (fail-closed on >1 value-moving call)', () => {
  const transferAbi = parseAbi(['function transfer(address to, uint256 value)'])
  const approveAbi = parseAbi(['function approve(address spender, uint256 value)'])
  const ATTACKER = getAddress('0x000000000000000000000000000000000000dEaD')
  const encTransfer = (to: Address, value: bigint) =>
    encodeFunctionData({ abi: transferAbi, functionName: 'transfer', args: [to, value] })
  const encMulticall = (inner: Hex[]) =>
    encodeFunctionData({
      abi: parseAbi(['function multicall(bytes[] data)']),
      functionName: 'multicall',
      args: [inner],
    })

  it('surfaces the single value-moving call in a multicall (the rest are non-value-moving)', () => {
    // multicall wrapping ONE transfer — safe to surface.
    const env = decodeFromToolResult({
      family: 'evm',
      chain: 'ethereum',
      payload: buildEvmTx(USDC, encMulticall([encTransfer(RECIPIENT, 1_000_000n)])),
    })
    expect(env.decoded).toBe(true)
    expect(env.kind).toBe('transfer')
    expect(env.recipient).toBe(RECIPIENT)
    expect(env.amount).toBe('1000000')
  })

  it('FAILS CLOSED on a multicall hiding a second transfer (drain) behind a benign first', () => {
    // The exploit: multicall([transfer(decoy, 1), transfer(attacker, 1e12)]).
    // Surfacing only the first transfer would report a clean 1-wei send to the
    // decoy while the real drain to the attacker rides through invisibly →
    // downstream policy (fail-open on dropped fields) would PASS it.
    const env = decodeFromToolResult({
      family: 'evm',
      chain: 'ethereum',
      payload: buildEvmTx(USDC, encMulticall([encTransfer(RECIPIENT, 1n), encTransfer(ATTACKER, 1_000_000_000_000n)])),
    })
    expect(env.decoded).toBe(false)
    expect(env.decodeError).toContain('multi-call')
    // The drain recipient/amount must NOT be surfaced as a clean Envelope.
    expect(env.recipient).toBe('')
    expect(env.amount).toBe('')
  })

  it('FAILS CLOSED on a multicall mixing approve + transfer (both value-moving)', () => {
    const approve = encodeFunctionData({
      abi: approveAbi,
      functionName: 'approve',
      args: [ATTACKER, 2n ** 256n - 1n],
    })
    const env = decodeFromToolResult({
      family: 'evm',
      chain: 'ethereum',
      payload: buildEvmTx(USDC, encMulticall([approve, encTransfer(ATTACKER, 1_000_000_000_000n)])),
    })
    expect(env.decoded).toBe(false)
    expect(env.decodeError).toContain('multi-call')
  })
})

describe('decodeFromToolResult — EVM chain resolution (audit: numeric chain id -> symbol)', () => {
  const data = encodeFunctionData({
    abi: parseAbi(['function transfer(address to, uint256 value)']),
    functionName: 'transfer',
    args: [RECIPIENT, 1n],
  })

  it('resolves a typed Base tx (8453) to the symbolic "base", not the numeric id', () => {
    // Regression for the spurious-BLOCK bug: env.chain="8453" would fail
    // chainsMatch("base","8453") downstream → BLOCK every legitimate typed tx.
    const env = decodeFromToolResult({ family: 'evm', chain: 'base', payload: buildEvmTx(USDC, data, 0n, 8453) })
    expect(env.decoded).toBe(true)
    expect(env.chain).toBe('base')
  })

  it('resolves a typed Arbitrum tx (42161) to "arbitrum"', () => {
    const env = decodeFromToolResult({ family: 'evm', chain: 'arbitrum', payload: buildEvmTx(USDC, data, 0n, 42161) })
    expect(env.chain).toBe('arbitrum')
  })

  it('typed tx chain id is authoritative: overrides a mismatched caller hint', () => {
    // Wrong-chain detection: caller claims optimism, bytes say base → the
    // bytes win so the policy can catch the mismatch.
    const env = decodeFromToolResult({ family: 'evm', chain: 'optimism', payload: buildEvmTx(USDC, data, 0n, 8453) })
    expect(env.chain).toBe('base')
  })

  it('falls back to the numeric id for a typed tx on an unmapped chain', () => {
    const env = decodeFromToolResult({
      family: 'evm',
      chain: 'somechain',
      payload: buildEvmTx(USDC, data, 0n, 1313161554),
    })
    expect(env.chain).toBe('1313161554')
  })

  it('legacy (type-0) tx keeps the caller chain hint — chain id not overridden', () => {
    // Go only overrides chain for typed (DynamicFee/AccessList) txs; legacy
    // EIP-155 txs keep the symbolic hint (the wire id is not authoritative the
    // same way). Force-setting "1" here would clobber a valid "ethereum" hint.
    const env = decodeFromToolResult({ family: 'evm', chain: 'ethereum', payload: buildLegacyEvmTx(USDC, data, 0n, 1) })
    expect(env.decoded).toBe(true)
    expect(env.chain).toBe('ethereum')
  })

  it('legacy tx hint stands even when its EIP-155 chain id differs from the hint', () => {
    const env = decodeFromToolResult({ family: 'evm', chain: 'base', payload: buildLegacyEvmTx(USDC, data, 0n, 8453) })
    expect(env.chain).toBe('base')
  })
})

describe('decodeFromToolResult — cosmos undelegate kind (audit)', () => {
  const FROM = 'cosmos1pkptre7fdkl6gfrzlesjjvhxhlc3r4gmmk8rs6'

  it('labels MsgUndelegate as "undelegate", not "delegate"', () => {
    const any = Any.fromPartial({
      typeUrl: '/cosmos.staking.v1beta1.MsgUndelegate',
      value: MsgUndelegate.encode(
        MsgUndelegate.fromPartial({
          delegatorAddress: FROM,
          validatorAddress: 'cosmosvaloper1abc',
          amount: { denom: 'uatom', amount: '500000' },
        })
      ).finish(),
    })
    const env = decodeFromToolResult({ family: 'cosmos', chain: 'cosmoshub-4', payload: buildCosmosTx([any]) })
    expect(env.decoded).toBe(true)
    expect(env.kind).toBe('undelegate')
    expect(env.recipient).toBe('cosmosvaloper1abc')
    expect(env.amount).toBe('500000')
  })
})

describe('decodeFromToolResult — dispatch / guards', () => {
  it('infers EVM family from a known chain hint', () => {
    const data = encodeFunctionData({
      abi: parseAbi(['function transfer(address to, uint256 value)']),
      functionName: 'transfer',
      args: [RECIPIENT, 1n],
    })
    const env = decodeFromToolResult({ chain: 'base', payload: buildEvmTx(USDC, data) })
    expect(env.family).toBe('evm')
    expect(env.recipient).toBe(RECIPIENT)
  })

  it('fails closed when neither family nor a known chain is given', () => {
    const env = decodeFromToolResult({ payload: '0x1234' })
    expect(env.decoded).toBe(false)
    expect(env.decodeError).toContain('family')
  })
})
