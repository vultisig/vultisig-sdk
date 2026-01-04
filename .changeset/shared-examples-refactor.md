---
"@vultisig/sdk": patch
---

feat: shared examples package and electron adapter parity

- Created `examples/shared` package with shared components and adapters for browser and electron examples
- Implemented adapter pattern (ISDKAdapter, IFileAdapter) for platform-agnostic code
- Added full Electron IPC handlers for token, portfolio, and swap operations
- Fixed BigInt serialization for Electron IPC (prepareSendTx, sign, swap operations)
- Fixed SecureVault threshold calculation using correct 2/3 majority formula
- Added event subscriptions in Electron app for balance, chain, transaction, and error events
- Reduced code duplication between browser and electron examples by ~1400 lines
