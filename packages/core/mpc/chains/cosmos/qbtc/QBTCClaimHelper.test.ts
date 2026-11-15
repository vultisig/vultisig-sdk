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
    expect(bytesToHex(hash)).toBe('da10eb06fa7ac20cb405a661843659326e68b6201b173ab0dbd625f05b0353d5')
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
      'CvADCu0DCh8vcWJ0Yy5xYnRjLnYxLk1zZ0NsYWltV2l0aFByb29mEskDCiVxYnRjMXFwenJ5OXg4Z2YydHZkdzBzM2puNTRraGNlNm11YTdsEkQKQDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAQARrwAWFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYiJANDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDIlcWJ0YzFxcHpyeTl4OGdmMnR2ZHcwczNqbjU0a2hjZTZtdWE3bBJDCjsKMQobL2Nvc21vcy5jcnlwdG8ubWxkc2EuUHViS2V5EhIKEFVVVVVVVVVVVVVVVVVVVVUSBAoCCAEYAxIEEOCnEhogZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmY='
    )
    expect(result.txHash).toBe('F7FBF3AC6B03D56691D8F9795E15CDCF14E30E54920736AE6F923A646B11CBF7')
  })
})
