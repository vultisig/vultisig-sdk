import { base64Encode } from '@vultisig/lib-utils/base64Encode'
import { decryptWithAesGcm } from '@vultisig/lib-utils/encryption/aesGcm/decryptWithAesGcm'
import { encryptWithAesGcm } from '@vultisig/lib-utils/encryption/aesGcm/encryptWithAesGcm'
import {
  encryptedEncoding,
  plainTextEncoding,
} from '@vultisig/lib-utils/encryption/config'

export const fromMpcServerMessage = (body: string, hexEncryptionKey: string) =>
  Buffer.from(
    decryptWithAesGcm({
      key: Buffer.from(hexEncryptionKey, 'hex'),
      value: Buffer.from(body, encryptedEncoding),
    }).toString(plainTextEncoding),
    'base64'
  )

export const toMpcServerMessage = (
  body: Uint8Array,
  hexEncryptionKey: string
) =>
  encryptWithAesGcm({
    key: Buffer.from(hexEncryptionKey, 'hex'),
    value: Buffer.from(base64Encode(body)),
  }).toString(encryptedEncoding)
