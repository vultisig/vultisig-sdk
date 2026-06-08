import { encodeFunctionData, erc20Abi, keccak256, parseTransaction, serializeTransaction } from 'viem'
import { describe, expect, it } from 'vitest'

import { buildErc20TransferTx, buildEvmSendTx } from '../../../../src/platforms/react-native/chains/evm/tx'
import { buildSolanaSendTx } from '../../../../src/platforms/react-native/chains/solana/tx'

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
