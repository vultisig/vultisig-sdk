import { Buffer } from 'buffer'
import { describe, expect, it } from 'vitest'

import { buildClaimTxBody } from '@vultisig/core-chain/chains/cosmos/qbtc/claim/buildClaimTx'

import { getClaimPreSignedImageHash, getClaimSignedTransaction } from './QBTCClaimHelper'

const hexToBytes = (hex: string) => Uint8Array.from(Buffer.from(hex, 'hex'))
const bytesToHex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')

describe('QBTCClaimHelper', () => {
  const bodyBytes = buildClaimTxBody({
    claimer: 'qbtc1qpzry9x8gf2tvdw0s3jn54khce6mua7l',
    bitcoinAddress: 'bc1qatknmeca5p0fy5decdj5704hf7prt47e0e7e9n',
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
    expect(bytesToHex(hash)).toBe('eb1659d213e87b68a299aa72f051822c960cf9230bbcd49c1fa6c5e3c5df26a7')
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
      'CpwECpkECh8vcWJ0Yy5xYnRjLnYxLk1zZ0NsYWltV2l0aFByb29mEvUDCiVxYnRjMXFwenJ5OXg4Z2YydHZkdzBzM2puNTRraGNlNm11YTdsEkQKQDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAQARrwAWFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYiJANDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDIlcWJ0YzFxcHpyeTl4OGdmMnR2ZHcwczNqbjU0a2hjZTZtdWE3bEIqYmMxcWF0a25tZWNhNXAwZnk1ZGVjZGo1NzA0aGY3cHJ0NDdlMGU3ZTluEkMKOwoxChsvY29zbW9zLmNyeXB0by5tbGRzYS5QdWJLZXkSEgoQVVVVVVVVVVVVVVVVVVVVVRIECgIIARgDEgQQ4KcSGiBmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZg=='
    )
    expect(result.txHash).toBe('7378A0077071FC1A3D10E16B9C022BD6E78AC4E702331B41AA2CDD5E870A61A2')
  })
})
