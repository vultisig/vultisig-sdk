// Shim: tiny-secp256k1 uses WASM which cannot run on React Native.
// Bitcoin UTXO operations use WalletCore natively instead.
// Any code path that reaches this module directly has bypassed the native
// WalletCore integration and will not work correctly on React Native.
const unavailable = new Proxy(
  {},
  {
    get(_target, prop) {
      throw new Error(
        `tiny-secp256k1 is not available on React Native (attempted to access property "${String(prop)}"). ` +
          "Use the WalletCore-backed Bitcoin implementation provided by @vultisig/sdk instead."
      )
    },
  }
)

export default unavailable
