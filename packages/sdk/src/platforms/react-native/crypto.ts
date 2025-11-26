/**
 * React Native crypto implementation
 * Requires crypto polyfills (expo-crypto or react-native-get-random-values)
 */

import type { PlatformCrypto } from "../types";

export class ReactNativeCrypto implements PlatformCrypto {
  randomUUID(): string {
    return globalThis.crypto.randomUUID();
  }

  validateCrypto(): void {
    if (
      !globalThis.crypto ||
      typeof globalThis.crypto.randomUUID !== "function"
    ) {
      throw new Error(
        "Crypto API not available in React Native. " +
          "Please install and import crypto polyfills before using the SDK:\n" +
          "  - expo-crypto, OR\n" +
          "  - react-native-get-random-values + uuid polyfill",
      );
    }
  }
}
