---
'@vultisig/core-chain': minor
'@vultisig/core-mpc': patch
---

feat(cowswap): add CowSwap RFQ as swap provider for same-chain EVM trades (phase 1 sdk scaffold)

New `cowswap` module under `packages/core/chain/swap/general/cowswap/`:
- `config.ts` - chain configs (Ethereum, Arbitrum, Base, Avalanche), static EIP-2612 permit allowlist, app code / affiliate constants
- `types.ts` - CowSwap API response types
- `sign/buildCowSwapOrder.ts` - builds the EIP-712 CowSwap order struct; exports `buildCowSwapAppData` and `keccak256Hex` (uses viem)
- `sign/buildEip712Domain.ts` - EIP-712 domain for GPv2 settlement contract
- `api/getCowSwapQuote.ts` - POSTs to `/api/v1/quote`, returns `GeneralSwapQuote` with new `cowswap_order` tx arm
- `api/submitCowSwapOrder.ts` - POSTs signed order to `/api/v1/orders`
- `api/getCowSwapOrderStatus.ts` - polls order status
- `permit/buildEip2612Permit.ts` - builds EIP-2612 permit typed data for permit-eligible sell tokens

`GeneralSwapTx` union extended with `cowswap_order` arm.
`GeneralSwapProvider` extended with `'cowswap'`.
CowSwap is intentionally NOT registered as a live `findSwapQuote` fetcher (nor in
`aggregatorPreferenceOrder`) in phase 1 — the consumer build/sign path is wired in phase 2.
All `matchRecordUnion` call-sites over `GeneralSwapTx` updated for exhaustiveness.

No live fetcher registration, no mcp-ts wiring, no app UI changes. Consumer (mcp-ts) is responsible for USD threshold gating in phase 2.
