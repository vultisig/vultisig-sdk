---
"@vultisig/sdk": minor
---

feat: add vault-free tools layer for MCP TypeScript rewrite

New `tools/` module with vault-free chain utilities:
- `abiEncode` / `abiDecode` - ABI encoding/decoding via viem
- `evmCall` - read-only contract calls (eth_call)
- `evmTxInfo` - nonce, gas prices, chainId
- `evmCheckAllowance` - ERC-20 approval queries
- `resolveEns` - ENS name resolution
- `resolve4ByteSelector` - function signature lookup
- `searchToken` - CoinGecko search with multi-chain deployment mapping
- `deriveAddressFromKeys` - address derivation from raw ECDSA/EdDSA keys
- `findSwapQuote` - multi-provider swap quotes (THORChain, MayaChain, 1inch, LiFi, KyberSwap)
- `VerifierClient` - Vultisig Verifier REST API client

Also fixes SUI token balance queries (was ignoring coinType for non-native tokens).
