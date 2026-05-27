import { createHash } from 'crypto'
import { Buffer } from 'buffer'

import { base64Encode } from '@vultisig/lib-utils/base64Encode'
import { decryptWithAesGcm } from '@vultisig/lib-utils/encryption/aesGcm/decryptWithAesGcm'
import { encryptWithAesGcm } from '@vultisig/lib-utils/encryption/aesGcm/encryptWithAesGcm'
import { encryptedEncoding, plainTextEncoding } from '@vultisig/lib-utils/encryption/config'

export const fromMpcServerMessage = (body: string, hexEncryptionKey: string) => {
  // Decode once so the diag log and the decrypt path observe identical bytes
  // and any decode failure attributes to a single site (cleaner stack trace
  // for the ghash investigation).
  const encryptedBuf = Buffer.from(body, encryptedEncoding)

  // Diagnostic logging for "aes/gcm: invalid ghash tag" investigation.
  // No behavior change — only logs body/key signature shapes when the env flag is set.
  // Enable via VULTISIG_DIAG_MPC_RELAY=1. Remove once root-cause is confirmed.
  //
  // key_fingerprint is a sha256-truncated digest of the relay key, NOT any
  // bits of the key itself. Identifies which key is in use across nodes for
  // cross-node correlation without putting key material in logs.
  if (process.env.VULTISIG_DIAG_MPC_RELAY === '1') {
    console.log(
      '[DIAG-MPC-RELAY]',
      JSON.stringify({
        body_len: body.length,
        decoded_len: encryptedBuf.length,
        nonce_hex: encryptedBuf.subarray(0, 12).toString('hex'),
        first32_hex: encryptedBuf.toString('hex').slice(0, 64),
        key_fingerprint: createHash('sha256').update(hexEncryptionKey).digest('hex').slice(0, 16),
      })
    )
  }

  return Buffer.from(
    decryptWithAesGcm({
      key: Buffer.from(hexEncryptionKey, 'hex'),
      value: encryptedBuf,
    }).toString(plainTextEncoding),
    'base64'
  )
}

export const toMpcServerMessage = (body: Uint8Array, hexEncryptionKey: string) =>
  encryptWithAesGcm({
    key: Buffer.from(hexEncryptionKey, 'hex'),
    value: Buffer.from(base64Encode(body)),
  }).toString(encryptedEncoding)
