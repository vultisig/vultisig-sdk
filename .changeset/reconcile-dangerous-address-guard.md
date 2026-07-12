---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

Reconcile and publicly export the dangerous/burn-address guard.

The SDK's `dangerousAddresses.ts` list had drifted from its own authoritative
parity source (mcp-ts `src/lib/dangerous-addresses.ts`) and from
agent-backend-ts's copy — the exact drift class the file's own header documents
via the CCTP `mintRecipient` burn incident. Reconciled to the **union** of all
three copies (additive/tightening only, never weakening an existing entry):

- Solana: added the SPL Token Program and Wrapped SOL mint (from mcp-ts), kept
  the Solana Incinerator (which only this SDK copy carried).
- UTXO (Bitcoin/Litecoin/Dogecoin/Bitcoin-Cash/Dash/Zcash): added the Bitcoin
  null-script and eater burn addresses.
- XRP (Ripple): added the ACCOUNT_ZERO black-hole and ACCOUNT_ONE reserved
  system account.

The guard (`assertSafeDestination`, `assertSafeEvmDestination`,
`isEvmBurnAddress`, `getEvmDangerousReason`, `getChainDangerousReason`, and the
per-family tables) is now exported from the SDK's public API so the app and
agent-backend-ts can consume the single source of truth instead of maintaining
divergent copies. Non-EVM lists stay chain-family-scoped, so a burn address for
one family never blocks an unrelated chain.

The canonical table now lives in `@vultisig/core-chain`
(`security/dangerousAddresses`) — re-exported unchanged from the SDK — so the
lower-level core-chain swap guard can share it too (core-chain cannot depend on
the SDK). Two in-repo siblings that still held private, incomplete copies now
route through it:

- `recipientSanity.isNullAddress` (SDK) previously missed the SPL Token
  Program + Wrapped SOL mint, the Bitcoin/XRP burns, and the third EVM variant;
  it now flags all of them.
- `findSwapQuote`'s custom-recipient guard (core-chain) previously vetted only
  the EVM zero + `…dEaD` addresses; it now rejects the `0xdead…42069` variant
  and the base58 (Solana / UTXO / XRP) family burns on the destination chain.

The shared EVM shape check is now case-insensitive on the `0x` prefix, so a
`0X…`-prefixed burn can't slip past (parity with the Go guard).
