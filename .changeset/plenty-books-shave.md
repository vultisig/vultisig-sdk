---
'@vultisig/sdk': major
'@vultisig/cli': minor
---

Make token references resolve consistently across the vault and CLI surfaces.

**`@vultisig/sdk` — consumer-visible behaviour change on `send`, `swap` and `balance`:**

- A token reference (the `symbol` on `send`/`swap`, the `tokenId` on `balance`)
  now resolves by contract address / stored vault token id as well as by symbol
  or well-known ticker, through one shared resolver. Previously `send` matched
  by symbol only while `balance` treated the same value as a raw contract
  address, so no single value worked on both paths and an ERC-20 send could not
  be built at all.
- The change is additive. Symbol/ticker is still matched first and the vault's
  own tokens still shadow the well-known registry, so every reference that
  resolved before resolves to the same token and produces the same signed
  payload. Only references that previously threw now resolve. A reference
  matching nothing is still passed through to the balance layer untouched.
- `send({ dryRun: true })` gains `feeSymbol` and reports the network fee in the
  chain's native asset. For a token send, `fee` was previously formatted with
  the token's decimals and `total` was amount + fee — both meaningless when the
  fee is paid in a different asset. `total` is now denominated in the asset
  being sent. Native sends are unaffected.
- A `Balance` for a token is labelled by the same resolution. Previously the
  token was found by an exact match against the vault's stored token id, so a
  well-known token the vault does not track — or one added with an id that is
  not its bare contract address — fell through to a default of 18 decimals with
  the raw id as `symbol`. `formatBalance` now resolves the same way everything
  else does; a token in no registry still falls back as before.

**`@vultisig/cli`:**

- `send --token` works with either a contract address or a symbol, and its
  dry-run preview quotes the fee in the native asset. The preview also warns
  separately when the native balance cannot cover the fee — a token send draws
  its fee from a different balance than the one `total` is checked against.
- `portfolio`'s total now equals the sum of the breakdown printed under it, with
  each held token itemized as its own row (`chainBalances[].tokens`).
- `balance <chain> --tokens` returns token balances instead of silently
  ignoring the flag; without the flag the output is unchanged.
- `tokens --discover` documents that it saves discovered tokens to the vault.
