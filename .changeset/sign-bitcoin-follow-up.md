---
'@vultisig/core-chain': patch
'@vultisig/core-mpc': patch
---

fix: harden PSBT signing (SignBitcoin) - follow-up on PR #174

- parameterize network in buildSignBitcoinFromPsbt (was hardcoded to mainnet)
- harden detectScriptType: full P2PKH template check, add P2WSH detection
- fail early for unsupported script types with descriptive BIP-referenced errors
- add fee snipe mitigation (cross-validate witnessUtxo vs nonWitnessUtxo)
- rename computeBip143Sighashes -> computePreSigningHashes for extensibility
- use @noble/hashes/sha256 instead of Node.js crypto (cross-platform)
- use unsigned int64 for Bitcoin amounts (writeBigUInt64LE)
- fix varint encoding for output script lengths in sighash computation
- refactor compileSignBitcoinTx to use bitcoinjs-lib Transaction class
- fix libType regression in commVault.ts for key-import vaults
- fix variable shadowing in compileTx.ts
- skip Blockaid simulation for PSBT flows (incompatible with WalletCore compiler)
- augment change detection with BIP32 derivation on outputs
- add 10 unit tests cross-validating sighash against bitcoinjs-lib v7
