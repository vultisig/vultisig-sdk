import type { PlatformCrypto } from '../types'

export class ReactNativeCrypto implements PlatformCrypto {
  randomUUID(): string {
    // expo-crypto or react-native-get-random-values must be set up by the app
    return globalThis.crypto.randomUUID()
  }

  // No validateCrypto — polyfills may not be ready at module load time.
  // The app is responsible for setting up crypto.getRandomValues before using SDK operations.
}
