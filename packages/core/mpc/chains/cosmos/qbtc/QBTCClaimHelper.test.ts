import { Buffer } from 'buffer'
import { describe, expect, it } from 'vitest'

import { buildClaimTxBody } from '@vultisig/core-chain/chains/cosmos/qbtc/claim/buildClaimTx'

import { getClaimPreSignedImageHash, getClaimSignedTransaction } from './QBTCClaimHelper'

const hexToBytes = (hex: string) => Uint8Array.from(Buffer.from(hex, 'hex'))
const bytesToHex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')

describe('QBTCClaimHelper', () => {
  const bodyBytes = buildClaimTxBody({
    claimer: 'qbtc1qpzry9x8gf2tvdw0s3jn54khce6mua7l',
    broadcaster: 'qbtc1qpzry9x8gf2tvdw0s3jn54khce6mua7l',
    utxos: [
      {
        txid: '00'.repeat(32),
        vout: 1,
      },
    ],
    proof: 'ab'.repeat(120),
    messageHash: '11'.repeat(32),
    addressHash: '22'.repeat(20),
    qbtcAddressHash: '33'.repeat(32),
    pubKeyHashSha256: '44'.repeat(32),
  })
  const mldsaPublicKey = hexToBytes('55'.repeat(16))
  const signature = hexToBytes('66'.repeat(32))

  it('builds the claim SignDoc hash and auth info bytes', () => {
    const { hash, authInfoBytes } = getClaimPreSignedImageHash({
      bodyBytes,
      accountNumber: 7n,
      mldsaPublicKey,
      sequence: 3n,
    })

    expect(bytesToHex(authInfoBytes)).toBe(
      '0a3b0a310a1b2f636f736d6f732e63727970746f2e6d6c6473612e5075624b657912120a105555555555555555555555555555555512040a0208011803120410e0a712'
    )
    expect(bytesToHex(hash)).toBe('33277af653254d3a74d0e761fb6e1925e4d82103be48169fdf2c10c7877f19db')
  })

  it('assembles signed claim transaction bytes and tx hash', () => {
    const { authInfoBytes } = getClaimPreSignedImageHash({
      bodyBytes,
      accountNumber: 7n,
      mldsaPublicKey,
      sequence: 3n,
    })

    const result = getClaimSignedTransaction({
      bodyBytes,
      authInfoBytes,
      signature,
    })

    expect(result.txBytesBase64).toBe(
      'Cp4FCpsFCh8vcWJ0Yy5xYnRjLnYxLk1zZ0NsYWltV2l0aFByb29mEvcECiVxYnRjMXFwenJ5OXg4Z2YydHZkdzBzM2puNTRraGNlNm11YTdsEkQKQDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAQARrwAWFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYiJAMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMSooMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjJAMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzpANDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NEolcWJ0YzFxcHpyeTl4OGdmMnR2ZHcwczNqbjU0a2hjZTZtdWE3bBJDCjsKMQobL2Nvc21vcy5jcnlwdG8ubWxkc2EuUHViS2V5EhIKEFVVVVVVVVVVVVVVVVVVVVUSBAoCCAEYAxIEEOCnEhogZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmY='
    )
    expect(result.txHash).toBe('2EF29D984BB9AD607362E97DBBFC7CAF6EB04DDB2C84B5BC24D44412D97DB2A5')
  })
})
