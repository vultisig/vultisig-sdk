import { Buffer } from 'buffer'

import { base64Encode } from '@vultisig/lib-utils/base64Encode'
import { decryptWithAesGcm } from '@vultisig/lib-utils/encryption/aesGcm/decryptWithAesGcm'
import { encryptWithAesGcm } from '@vultisig/lib-utils/encryption/aesGcm/encryptWithAesGcm'
import { encryptedEncoding, plainTextEncoding } from '@vultisig/lib-utils/encryption/config'

export const fromMpcServerMessage = (body: string, hexEncryptionKey: string) => {
  // Diagnostic logging for "aes/gcm: invalid ghash tag" investigation.
  // No behavior change — only logs body/key signature shapes when the env flag is set.
  // Enable via VULTISIG_DIAG_MPC_RELAY=1. Remove once root-cause is confirmed.
  if (process.env.VULTISIG_DIAG_MPC_RELAY === '1') {
    const decoded = Buffer.from(body, encryptedEncoding)
    console.log(
      '[DIAG-MPC-RELAY]',
      JSON.stringify({
        body_len: body.length,
        decoded_len: decoded.length,
        nonce_hex: decoded.subarray(0, 12).toString('hex'),
        first32_hex: decoded.toString('hex').slice(0, 64),
        key_first16: hexEncryptionKey.slice(0, 16),
      })
    )
  }

  return Buffer.from(
    decryptWithAesGcm({
      key: Buffer.from(hexEncryptionKey, 'hex'),
      value: Buffer.from(body, encryptedEncoding),
    }).toString(plainTextEncoding),
    'base64'
  )
}

export const toMpcServerMessage = (body: Uint8Array, hexEncryptionKey: string) =>
  encryptWithAesGcm({
    key: Buffer.from(hexEncryptionKey, 'hex'),
    value: Buffer.from(base64Encode(body)),
  }).toString(encryptedEncoding)
