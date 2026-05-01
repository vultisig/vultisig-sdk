import * as ExpoCrypto from 'expo-crypto'

import type { PlatformCrypto } from '../types'

export class ReactNativeCrypto implements PlatformCrypto {
  randomUUID(): string {
    return ExpoCrypto.randomUUID()
  }

  validateCrypto(): void {
    if (typeof ExpoCrypto.randomUUID !== 'function') {
      throw new Error(
        'expo-crypto.randomUUID is not available. Ensure expo-crypto is installed and linked in the RN app.'
      )
    }
  }
}
