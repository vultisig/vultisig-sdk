import type { EvmChain } from '@vultisig/core-chain/Chain'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { encodeFunctionData, erc20Abi, keccak256, parseTransaction, serializeTransaction } from 'viem'
import { describe, expect, it } from 'vitest'

import {
  buildErc20TransferTx,
  buildEvmSendTx,
  getEvmNumericChainId,
} from '../../../../src/platforms/react-native/chains/evm/tx'
import { buildSolanaSendTx } from '../../../../src/platforms/react-native/chains/solana/tx'

type SolanaCrossEncoderFixture = {
  senderAddress: string
  recipientAddress: string
  recentBlockhash: string
  lamports: string
  expectedMessageHex: string
}
type EvmCrossEncoderFeeVariants = {
  legacy: { gasPriceWei: string; expectedSigningHashHex: string }
  eip1559: { maxFeePerGasWei: string; maxPriorityFeePerGasWei: string; expectedSigningHashHex: string }
}
type EvmNativeCrossEncoderFixture = EvmCrossEncoderFeeVariants & {
  chainName: string
  chainId: number
  nonce: number
  gasLimit: number
  toAddress: string
  valueWei: string
}
type EvmErc20CrossEncoderFixture = EvmCrossEncoderFeeVariants & {
  chainName: string
  chainId: number
  nonce: number
  gasLimit: number
  tokenAddress: string
  recipientAddress: string
  amountBaseUnits: string
}
const loadCrossEncoderFixture = <T>(name: string): T =>
  JSON.parse(readFileSync(resolve(__dirname, '../../../../../../testdata/cross-encoder-golden', name), 'utf8')) as T
const loadSolanaCrossEncoderFixture = (): SolanaCrossEncoderFixture =>
  loadCrossEncoderFixture<SolanaCrossEncoderFixture>('solana-transfer.json')

const SOLANA_FROM = '4wBqpZM9xaSheZzJSMawUKKwhdpChKbZ5eu5ky4Vigw'
const SOLANA_TO = '7ppk9w8NHnH6ehajvJyU31VcMafwZ3ybRtJWumSyD2wd'
const SOLANA_BLOCKHASH = 'EagX51WiJHRKUdxXouY1qMamNNrqr9N3KLyeh25xRaTs'
const SOLANA_LAMPORTS = 123_456_789n
const SOLANA_SIG_HEX =
  '030a11181f262d343b424950575e656c737a81888f969da4abb2b9c0c7ced5dce3eaf1f8ff060d141b222930373e454c535a61686f767d848b9299a0a7aeb5bc'
const SOLANA_SIGNATURE_BASE58 =
  '4XR92Zct9ZodXzisJ4kov3upmTvMotYVrg65MHP8aoCjSPJwUa7vjaXK5VhDF7ZiiF16v7cY5BPazCLnVqZ3yzb'

const SOLANA_SEND_MESSAGE_HEX =
  '010001030102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f2065666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f80818283840000000000000000000000000000000000000000000000000000000000000000c9c8c7c6c5c4c3c2c1c0bfbebdbcbbbab9b8b7b6b5b4b3b2b1b0afaeadacabaa01020200010c0200000015cd5b0700000000'
const SOLANA_SEND_RAW_BASE64 =
  'AQMKERgfJi00O0JJUFdeZWxzeoGIj5adpKuyucDHztXc4+rx+P8GDRQbIikwNz5FTFNaYWhvdn2Ei5KZoKeutbwBAAEDAQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyBlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDhAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAycjHxsXEw8LBwL++vby7urm4t7a1tLOysbCvrq2sq6oBAgIAAQwCAAAAFc1bBwAAAAA='
const SOLANA_SELF_TRANSFER_MESSAGE_HEX =
  '010001020102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f200000000000000000000000000000000000000000000000000000000000000000c9c8c7c6c5c4c3c2c1c0bfbebdbcbbbab9b8b7b6b5b4b3b2b1b0afaeadacabaa01010200000c0200000015cd5b0700000000'
const SOLANA_SELF_TRANSFER_RAW_BASE64 =
  'AQMKERgfJi00O0JJUFdeZWxzeoGIj5adpKuyucDHztXc4+rx+P8GDRQbIikwNz5FTFNaYWhvdn2Ei5KZoKeutbwBAAECAQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMnIx8bFxMPCwcC/vr28u7q5uLe2tbSzsrGwr66trKuqAQECAAAMAgAAABXNWwcAAAAA'

const EVM_SEND_UNSIGNED_HEX =
  '0x02f001078459682f008506fc23ac008252089422222222222222222222222222222222222222228801b69b4ba630f34e80c0'
const EVM_SEND_SIGNING_HASH = '0x8bb93443f4486451fbc9c7dcad660929f8a0c8bdc30e97e07837bad55d467000'
const EVM_SIG_HEX =
  '0x1111111111111111111111111111111111111111111111111111111111111111222222222222222222222222222222222222222222222222222222222222222201'
const EVM_SEND_SIGNED_HEX =
  '0x02f87301078459682f008506fc23ac008252089422222222222222222222222222222222222222228801b69b4ba630f34e80c001a01111111111111111111111111111111111111111111111111111111111111111a02222222222222222222222222222222222222222222222222222222222222222'
const EVM_SEND_TX_HASH = '0x4e5a9e0bc613a492af11e367e6a90455a95541f9941aff0e4d54f33cc47cef1e'

const ERC20_TRANSFER_CALLDATA =
  '0xa9059cbb00000000000000000000000055555555555555555555555555555555555555550000000000000000000000000000000000000000000000000db4da5f4415aa00'
const ERC20_TRANSFER_UNSIGNED_HEX =
  '0xf86a038509c765240082fde894444444444444444444444444444444444444444480b844a9059cbb00000000000000000000000055555555555555555555555555555555555555550000000000000000000000000000000000000000000000000db4da5f4415aa0081898080'
const ERC20_TRANSFER_SIGNING_HASH = '0x6af2740817e7cf4c0980e77931a791952b11ec6416d203c3c9411d9c85d01720'

// CROSS-ENCODER BINDING (Track B follow-up to VA-81's layer-1/layer-2 golden-vector
// work): the buildSolanaSendTx suite below self-checks against @solana/web3.js (this
// path's OWN reference) - but packages/core's compileTx.golden.test.ts independently
// self-checks the SAME logical Solana transfer against WalletCore/WASM (the OTHER real
// encoder the app can dispatch through). Until now the two suites never shared a single
// fixture, so the two encoders could silently diverge with nothing catching it - each
// path only proves itself internally consistent, not that they AGREE with each other.
//
// Reads testdata/cross-encoder-golden/solana-transfer.json - the SAME file packages/
// core/mpc/tx/compile/compileTx.golden.test.ts's 'matches the shared cross-encoder
// golden vector' test reads - via a plain readFileSync rather than an import
// (packages/sdk doesn't depend on packages/core). Both suites assert against the SAME
// fixture-provided expected message bytes, so editing the fixture file updates BOTH
// suites' expectation at once - no "keep two literals in sync via a comment" drift
// risk. senderAddress in the fixture is pre-derived from a private key via WalletCore
// (packages/core's suite re-derives it fresh each run; this unit suite reads the
// precomputed value directly to avoid adding a WASM wallet-core dependency here).
describe('cross-encoder binding (must match packages/core compileTx.golden.test.ts WalletCore path)', () => {
  it('produces the SAME message bytes as WalletCore for the identical Solana transfer', () => {
    const fx = loadSolanaCrossEncoderFixture()
    const tx = buildSolanaSendTx({
      from: fx.senderAddress,
      to: fx.recipientAddress,
      lamports: BigInt(fx.lamports),
      recentBlockhash: fx.recentBlockhash,
    })

    expect(tx.signingHashHex).toBe(fx.expectedMessageHex)
  })

  // EVM (sdk#1365 / plan 003): reads testdata/cross-encoder-golden/evm-native-transfer
  // .json + evm-erc20-transfer.json - the SAME files packages/core/mpc/tx/compile/
  // compileTx.golden.test.ts's 'matches the shared cross-encoder golden vector for an
  // EVM ...' tests read - and builds the identical transfers via THIS package's
  // viem-based builders. Both fee variants are exercised because legacy-vs-EIP-1559
  // type selection and gas-field ordering are exactly the divergence class that would
  // split a 2-of-2 RN + WalletCore keysign. fromAddress below is arbitrary: an EVM
  // sender never enters the unsigned envelope (it is recovered from the signature),
  // so it is deliberately NOT part of the shared fixture.
  //
  // IMPORTANT: because this RN builder is itself viem-based and the fixture hashes
  // were pinned via viem, THIS side of the EVM bind is a near-self-check. The
  // independent teeth are the core suite's two EVM cross-encoder tests, where
  // WalletCore's own WASM RLP recomputes the same fixture hashes. Never skip or
  // delete those without replacing the independent reference.
  it('produces the SAME signing hash as WalletCore for the identical EVM native transfer (legacy + eip1559)', () => {
    const fx = loadCrossEncoderFixture<EvmNativeCrossEncoderFixture>('evm-native-transfer.json')
    const chain = fx.chainName as EvmChain
    // Bind the RN chain-name -> chainId table to the fixture's chainId (the value
    // WalletCore consumed) before relying on it below.
    expect(getEvmNumericChainId(chain)).toBe(fx.chainId)

    const common = {
      chain,
      fromAddress: '0x1111111111111111111111111111111111111111' as const,
      toAddress: fx.toAddress as `0x${string}`,
      valueWei: BigInt(fx.valueWei),
      nonce: fx.nonce,
      gasLimit: BigInt(fx.gasLimit),
    }
    const legacyTx = buildEvmSendTx({
      ...common,
      gasPrice: BigInt(fx.legacy.gasPriceWei),
    })
    expect(legacyTx.signingHashHex).toBe(fx.legacy.expectedSigningHashHex)

    const eip1559Tx = buildEvmSendTx({
      ...common,
      maxFeePerGas: BigInt(fx.eip1559.maxFeePerGasWei),
      maxPriorityFeePerGas: BigInt(fx.eip1559.maxPriorityFeePerGasWei),
    })
    expect(eip1559Tx.signingHashHex).toBe(fx.eip1559.expectedSigningHashHex)
  })

  // On top of RLP/typed-envelope encoding this also cross-checks CALLDATA
  // construction: this path encodes transfer(recipient, amount) via viem's
  // encodeFunctionData, while WalletCore builds the same calldata internally from
  // its ERC20Transfer proto message - both must land on the same signing hash.
  it('produces the SAME signing hash as WalletCore for the identical ERC-20 transfer (legacy + eip1559)', () => {
    const fx = loadCrossEncoderFixture<EvmErc20CrossEncoderFixture>('evm-erc20-transfer.json')
    const chain = fx.chainName as EvmChain
    expect(getEvmNumericChainId(chain)).toBe(fx.chainId)

    const common = {
      chain,
      fromAddress: '0x3333333333333333333333333333333333333333' as const,
      tokenAddress: fx.tokenAddress as `0x${string}`,
      recipient: fx.recipientAddress as `0x${string}`,
      amount: BigInt(fx.amountBaseUnits),
      nonce: fx.nonce,
      gasLimit: BigInt(fx.gasLimit),
    }
    const legacyTx = buildErc20TransferTx({
      ...common,
      gasPrice: BigInt(fx.legacy.gasPriceWei),
    })
    expect(legacyTx.signingHashHex).toBe(fx.legacy.expectedSigningHashHex)

    const eip1559Tx = buildErc20TransferTx({
      ...common,
      maxFeePerGas: BigInt(fx.eip1559.maxFeePerGasWei),
      maxPriorityFeePerGas: BigInt(fx.eip1559.maxPriorityFeePerGasWei),
    })
    expect(eip1559Tx.signingHashHex).toBe(fx.eip1559.expectedSigningHashHex)
  })
})

describe('React Native transaction builder golden vectors', () => {
  describe('buildSolanaSendTx', () => {
    it('matches @solana/web3.js legacy SystemProgram.transfer bytes', async () => {
      const expected = await buildWeb3SolanaTransferVector(SOLANA_FROM, SOLANA_TO)
      expect(expected.messageHex).toBe(SOLANA_SEND_MESSAGE_HEX)
      expect(expected.rawBase64).toBe(SOLANA_SEND_RAW_BASE64)

      const tx = buildSolanaSendTx({
        from: SOLANA_FROM,
        to: SOLANA_TO,
        lamports: SOLANA_LAMPORTS,
        recentBlockhash: SOLANA_BLOCKHASH,
      })

      expect(tx.signingHashHex).toBe(SOLANA_SEND_MESSAGE_HEX)
      expect(tx.unsignedRawHex).toBe(SOLANA_SEND_MESSAGE_HEX)
      expect(tx.finalize(SOLANA_SIG_HEX)).toEqual({
        rawTxBase64: SOLANA_SEND_RAW_BASE64,
        signature: SOLANA_SIGNATURE_BASE58,
      })
      expect(() => tx.finalize(`${SOLANA_SIG_HEX.slice(0, -1)}g`)).toThrow(/non-hex/)
    })

    it('dedupes the sender account for self-transfers like @solana/web3.js', async () => {
      const expected = await buildWeb3SolanaTransferVector(SOLANA_FROM, SOLANA_FROM)
      expect(expected.messageHex).toBe(SOLANA_SELF_TRANSFER_MESSAGE_HEX)
      expect(expected.rawBase64).toBe(SOLANA_SELF_TRANSFER_RAW_BASE64)

      const tx = buildSolanaSendTx({
        from: SOLANA_FROM,
        to: SOLANA_FROM,
        lamports: SOLANA_LAMPORTS,
        recentBlockhash: SOLANA_BLOCKHASH,
      })

      expect(tx.signingHashHex).toBe(SOLANA_SELF_TRANSFER_MESSAGE_HEX)
      expect(tx.finalize(SOLANA_SIG_HEX).rawTxBase64).toBe(SOLANA_SELF_TRANSFER_RAW_BASE64)
    })
  })

  describe('EVM builders', () => {
    it('pins native EIP-1559 send unsigned bytes and finalized yParity handling', () => {
      const tx = buildEvmSendTx({
        chain: 'Ethereum',
        fromAddress: '0x1111111111111111111111111111111111111111',
        toAddress: '0x2222222222222222222222222222222222222222',
        valueWei: 123_456_789_012_345_678n,
        nonce: 7,
        gasLimit: 21_000n,
        maxFeePerGas: 30_000_000_000n,
        maxPriorityFeePerGas: 1_500_000_000n,
      })

      const viemUnsigned = serializeTransaction({
        type: 'eip1559',
        chainId: 1,
        nonce: 7,
        maxFeePerGas: 30_000_000_000n,
        maxPriorityFeePerGas: 1_500_000_000n,
        gas: 21_000n,
        to: '0x2222222222222222222222222222222222222222',
        value: 123_456_789_012_345_678n,
        data: '0x',
      })
      expect(viemUnsigned).toBe(EVM_SEND_UNSIGNED_HEX)

      expect(tx.unsignedRawHex).toBe(EVM_SEND_UNSIGNED_HEX)
      expect(tx.signingHashHex).toBe(EVM_SEND_SIGNING_HASH)
      expect(tx.signingHashHex).toBe(keccak256(viemUnsigned))

      const finalized = tx.finalize(EVM_SIG_HEX)
      expect(finalized).toEqual({
        rawTxHex: EVM_SEND_SIGNED_HEX,
        txHashHex: EVM_SEND_TX_HASH,
      })

      const parsed = parseTransaction(finalized.rawTxHex)
      expect(parsed.type).toBe('eip1559')
      expect(parsed.yParity).toBe(1)
      expect(parsed.v).toBe(28n)
      expect(() => tx.finalize(`${EVM_SIG_HEX.slice(0, -1)}g`)).toThrow(/non-hex/)
      expect(() => tx.finalize(`${EVM_SIG_HEX.slice(0, -2)}02`)).toThrow(/recoveryId must be 0 or 1/)
      expect(() => tx.finalize(`${EVM_SIG_HEX.slice(0, -2)}ff`)).toThrow(/recoveryId must be 0 or 1/)
    })

    it('pins ERC-20 transfer calldata and legacy unsigned transaction bytes', () => {
      const viemCalldata = encodeFunctionData({
        abi: erc20Abi,
        functionName: 'transfer',
        args: ['0x5555555555555555555555555555555555555555', 987_654_321_000_000_000n],
      })
      expect(viemCalldata).toBe(ERC20_TRANSFER_CALLDATA)

      const viemUnsigned = serializeTransaction({
        type: 'legacy',
        chainId: 137,
        nonce: 3,
        gasPrice: 42_000_000_000n,
        gas: 65_000n,
        to: '0x4444444444444444444444444444444444444444',
        value: 0n,
        data: viemCalldata,
      })
      expect(viemUnsigned).toBe(ERC20_TRANSFER_UNSIGNED_HEX)

      const tx = buildErc20TransferTx({
        chain: 'Polygon',
        fromAddress: '0x3333333333333333333333333333333333333333',
        tokenAddress: '0x4444444444444444444444444444444444444444',
        recipient: '0x5555555555555555555555555555555555555555',
        amount: 987_654_321_000_000_000n,
        nonce: 3,
        gasLimit: 65_000n,
        gasPrice: 42_000_000_000n,
      })

      expect(tx.unsignedRawHex).toBe(ERC20_TRANSFER_UNSIGNED_HEX)
      expect(tx.signingHashHex).toBe(ERC20_TRANSFER_SIGNING_HASH)
      expect(tx.signingHashHex).toBe(keccak256(viemUnsigned))
    })
  })
})

async function buildWeb3SolanaTransferVector(
  from: string,
  to: string
): Promise<{ messageHex: string; rawBase64: string }> {
  const { PublicKey, SystemProgram, Transaction } = await import('@solana/web3.js')
  const fromPubkey = new PublicKey(from)
  const toPubkey = new PublicKey(to)
  const signature = Buffer.from(SOLANA_SIG_HEX, 'hex')
  const tx = new Transaction({ recentBlockhash: SOLANA_BLOCKHASH, feePayer: fromPubkey })

  tx.add(
    SystemProgram.transfer({
      fromPubkey,
      toPubkey,
      lamports: SOLANA_LAMPORTS,
    })
  )

  const message = tx.serializeMessage()
  tx.signatures[0]!.signature = signature
  const raw = tx.serialize({ requireAllSignatures: true, verifySignatures: false })

  return {
    messageHex: Buffer.from(message).toString('hex'),
    rawBase64: Buffer.from(raw).toString('base64'),
  }
}
