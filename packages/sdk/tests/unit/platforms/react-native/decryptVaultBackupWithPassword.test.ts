import { describe, expect, it } from 'vitest'

import { decryptVaultBackupWithPassword } from '../../../../src/platforms/react-native/polyfills/decryptVaultBackupWithPassword'

describe('React Native decryptVaultBackupWithPassword', () => {
  it('detects the PBKDF2 header when subarray returns a plain Uint8Array', () => {
    const truncatedBackup = Uint8Array.from([0x56, 0x4c, 0x54, 0x02, 0x00]) as unknown as Buffer

    expect(() => decryptVaultBackupWithPassword('password', truncatedBackup)).toThrow(
      'Encrypted vault backup payload is truncated'
    )
  })
})
