/**
 * React Native crypto implementation
 * Requires expo-crypto or react-native-crypto
 */
import type { PlatformCrypto } from '../../shared/platform-types'

export class ReactNativeCrypto implements PlatformCrypto {
  async initialize(): Promise<void> {
    // React Native crypto setup
    // Users should install expo-crypto or react-native-crypto
    // and set up polyfills as needed

    // Check if crypto is available
    if (typeof crypto === 'undefined') {
      console.warn('Crypto API not available. Please install expo-crypto or react-native-crypto')
    }
  }
}
