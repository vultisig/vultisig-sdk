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
      '0a3e0a330a1d2f636f736d6f732e63727970746f2e6d6c64736136352e5075624b657912120a105555555555555555555555555555555512050a0308e8071803120410e0a712'
    )
    expect(bytesToHex(hash)).toBe('e02c29c12b67b5ca94721c2c20f0bb5a3712272904ea9612c9b0373149ce0e83')
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
      'Cp4FCpsFCh8vcWJ0Yy5xYnRjLnYxLk1zZ0NsYWltV2l0aFByb29mEvcECiVxYnRjMXFwenJ5OXg4Z2YydHZkdzBzM2puNTRraGNlNm11YTdsEkQKQDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAQARrwAWFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYiJAMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMSooMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjJAMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzpANDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NEolcWJ0YzFxcHpyeTl4OGdmMnR2ZHcwczNqbjU0a2hjZTZtdWE3bBJGCj4KMwodL2Nvc21vcy5jcnlwdG8ubWxkc2E2NS5QdWJLZXkSEgoQVVVVVVVVVVVVVVVVVVVVVRIFCgMI6AcYAxIEEOCnEhogZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmY='
    )
    expect(result.txHash).toBe('642C7416C7A7653FB8A2B8FEDB7CF985B87BBA361DC20BCFC0F1B58F01EF0243')
  })
})
