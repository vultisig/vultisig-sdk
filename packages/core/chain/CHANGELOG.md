# @vultisig/core-chain

## 2.27.0

### Minor Changes

- [#1499](https://github.com/vultisig/vultisig-sdk/pull/1499) [`3bc880a`](https://github.com/vultisig/vultisig-sdk/commit/3bc880a06b90fa64793983ba498f11fdc55e2115) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - Expose `getThorchainMemoAsset`, a `Coin` -> THORChain memo-asset converter, plus `isThorchainRoutable` and `isThorchainSecuredAssetId`, from `@vultisig/core-chain/swap/native/thorchainMemoAsset`.

  `buildLimitSwapMemo` takes `source_asset` / `target_asset` as pre-formatted THORChain notation, but nothing produced those strings from a `Coin`. Market swaps never needed it — the memo comes back on the server quote — but limit swaps build the memo locally, so every consumer had to derive the notation itself. Since the memo _is_ the order, a divergence there misroutes funds.

  Notation is derived from `toNativeSwapAsset`, the converter the market-swap path already uses, so the package has exactly one definition of a THORChain asset string. The only thing layered on top is abbreviating an L1 contract to its last 6 characters: memo bytes are capped at 80 on UTXO sources, while the swap API is given the full address. Secured assets are left un-abbreviated because the trailing address is part of the denom that identifies them.

  `limitSwapMemo`'s prefix -> chain map is now derived by inverting the new chain -> prefix map rather than being hand-maintained alongside it, so the two directions cannot drift. Behaviour is unchanged — the inversion reproduces the previous map exactly.

  `@vultisig/sdk` is bumped because it bundles `packages/core/chain` source rather than depending on the published package, so it needs a fresh tarball to carry this change. The helper is not re-exported from the SDK's public API, hence a patch rather than a minor.

  Note: `buildLimitSwapMemo` still does not accept secured assets — its `assertValidPoolId` check requires dotted `CHAIN.ASSET` notation and rejects the `CHAIN-ASSET` form. That gap predates this helper (iOS has the same one) and is tracked separately; a regression test pins it so it cannot change silently.

### Patch Changes

- [#1432](https://github.com/vultisig/vultisig-sdk/pull/1432) [`5d46269`](https://github.com/vultisig/vultisig-sdk/commit/5d46269396fd0dbcf9d84f0201a494dffafc1a36) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - Fix the Bittensor broadcast assuming success on a malformed RPC response. `broadcastBittensorTx` only inspected `response.error`; a body with neither `error` nor `result` (truncated / malformed gateway response) fell through and returned `undefined` — reported as a successful broadcast. It now forces hash verification when `result` is absent, mirroring the Polkadot resolver's JSON-RPC 2.0 guard.

- [#1461](https://github.com/vultisig/vultisig-sdk/pull/1461) [`9d50ac5`](https://github.com/vultisig/vultisig-sdk/commit/9d50ac5c586d058aabdbfb413e7be163a222da89) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Resolve Cardano transaction status through the existing Koios proxy instead of the unsupported Blockchair route.

- [#1474](https://github.com/vultisig/vultisig-sdk/pull/1474) [`c443b9c`](https://github.com/vultisig/vultisig-sdk/commit/c443b9ce699ef76f1407d0386ed20fbc7e3f253f) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Route SwapKit transaction links through its public tracker across the shared core and SDK APIs.

- [#1462](https://github.com/vultisig/vultisig-sdk/pull/1462) [`a4d8bbe`](https://github.com/vultisig/vultisig-sdk/commit/a4d8bbe81a94019aea5193a411a091ccb2e98682) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - Close a co-signer swap-guard gap where enforcement was keyed purely on the untrusted `provider` string (sdk#1457). CowSwap is now an enforced provider - its swap-leg destination and ERC-20 approval spender are always the same fixed GPv2VaultRelayer contract, so it is exactly as allow-listable as 1inch/Kyber's routers, and a payload can no longer relabel itself `cowswap` to dodge a router check. The log-only fallback for unenforced providers is now a closed list of the values the codebase actually produces (`li.fi`, `swapkit`, and the legacy unattributed `''` some historical mobile payloads carry) instead of accepting any string - a `provider` outside every known value is rejected fail-closed. The CowSwap allow-list entry is CHAIN-SCOPED to `cowSwapSupportedChains` (Ethereum/Arbitrum/Base/Avalanche): the GPv2VaultRelayer is a deterministic address that resolves on every EVM chain, but CoW has not deployed the stack on the others (`eth_getCode` is `0x` on CronosChain/zkSync/Blast), so accepting it chain-agnostically would have let a payload relabelled `cowswap` on an unsupported chain pass both guards and have the co-signer sign an ERC-20 approve to an address anyone can later claim. `li.fi`/`swapkit` (and the legacy `''`, which is also the proto3 default an attacker gets simply by clearing the field) remain the residual gap (they legitimately route through many different contracts and cannot be address-allow-listed); fully closing that needs the provider identity to be a trusted proto oneof discriminant rather than a free string, which is a larger cross-repo, cross-consumer schema change tracked separately in sdk#1457.

- [#1316](https://github.com/vultisig/vultisig-sdk/pull/1316) [`69a3f75`](https://github.com/vultisig/vultisig-sdk/commit/69a3f75c265e19682e6dbdac0fdb640c53d73b33) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - Stop reporting Cosmos broadcast as successful when the transaction is included on-chain but execution failed (DeliverTx code !== 0), and make sure the broadcast retry wrapper never misreads that failure as a transient transport error and resends it.

- [#1273](https://github.com/vultisig/vultisig-sdk/pull/1273) [`e3d8568`](https://github.com/vultisig/vultisig-sdk/commit/e3d8568a04a6dcd977ccaeeeb5bcf5da080fd275) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Return the Cosmos transaction hash when CosmJS accepts a broadcast but times out waiting for indexing, leaving confirmation to status polling instead of reporting broadcast failure.

- [#1427](https://github.com/vultisig/vultisig-sdk/pull/1427) [`47a63df`](https://github.com/vultisig/vultisig-sdk/commit/47a63dfc8613405b7be1105233627e66a163d7c7) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - Re-check the CowSwap order receiver at the signing (EIP-712 digest construction) step, not only at quote time. `assertValidCustomRecipient` rejects a zero/burn/malformed receiver when a quote is built, but an MPC co-signer never sees the quote — it decodes a `cowswap-order:` blob from the KeysignPayload (shape-validated only) and builds the digest to sign. `buildCowSwapOrderTypedData` now refuses a zero, burn (`0x…dead`), or malformed-non-EVM receiver, so a hand-built payload can't be signed into an order that sends the buy tokens to an unrecoverable address. vultisig always sets an explicit receiver (never CowSwap's `address(0)` sentinel), so no legitimately-produced order is affected.

- [#1399](https://github.com/vultisig/vultisig-sdk/pull/1399) [`ceccf56`](https://github.com/vultisig/vultisig-sdk/commit/ceccf5633ebd7d838e26e2fcbac151c52d26af85) Thanks [@NeOMakinG](https://github.com/NeOMakinG)! - Fix a `0X`-prefixed (uppercase-X) burn recipient slipping the custom-recipient
  guard on native THOR/Maya cross-chain swaps.

  `findSwapQuote`'s `isEvmAddress` shape check was case-sensitive on the `0x`
  prefix, so a recipient like `0X000…dEaD` failed the check, skipped the
  zero/burn-address branch, and — on a native route where the CowSwap format
  gate is unreachable — passed straight through as the swap destination, an
  unrecoverable sink. The gate is now case-insensitive on the prefix (`/i`),
  matching the Go guard; the burn comparison already lowercases, so this only
  closes the bypass without changing any accepted address.

- [#1472](https://github.com/vultisig/vultisig-sdk/pull/1472) [`b5f880a`](https://github.com/vultisig/vultisig-sdk/commit/b5f880a2dea1e06239b6ccb1a35fbdb4994d5917) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Align Bittensor broadcast error handling with the shared Substrate safeguards.

- [#895](https://github.com/vultisig/vultisig-sdk/pull/895) [`0c4a090`](https://github.com/vultisig/vultisig-sdk/commit/0c4a090bc4f3868e2a3a20c9f12742344cf8350e) Thanks [@NeOMakinG](https://github.com/NeOMakinG)! - fix(swap): expose inner-executor approvalAddress on EVM swap routes (LiFi + SwapKit)

  EVM aggregator routes (LI.FI, SwapKit) can delegate the ERC-20 `transferFrom` to an
  inner executor contract that is distinct from the outer `tx.to` router. Approving only
  `tx.to` leads to an "ERC20: transfer amount exceeds allowance" revert on-chain.

  This fix threads the route's real spender address through as `evm.approvalAddress` on
  `GeneralSwapTx`. Consumers building an ERC-20 approve leg MUST use this field as the
  spender when present, falling back to `to` only when absent.

- [#1285](https://github.com/vultisig/vultisig-sdk/pull/1285) [`8a0bca6`](https://github.com/vultisig/vultisig-sdk/commit/8a0bca688ec606292df587559115cafcc3287fcf) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Fix fiat pricing for known non-EVM token identifiers.

- [#1431](https://github.com/vultisig/vultisig-sdk/pull/1431) [`8c02c8c`](https://github.com/vultisig/vultisig-sdk/commit/8c02c8c7e8463b5d57fbd5c338a1f95c6129feb2) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - Reject a non-zero `tx.value` from a 1inch quote for a token-source swap. 1inch's `tx.value` flows through from the untrusted quote response verbatim (unlike Kyber, which constructs `value` itself), so a compromised/buggy response could set a non-zero value on a token→token swap and move native gas-coin the user never authorized alongside the swap. A token-source swap pulls the sell token via ERC-20 allowance, so `value` must be `0`; native-source swaps (where `value` is legitimately the sell amount) are unaffected.

- [#1415](https://github.com/vultisig/vultisig-sdk/pull/1415) [`01a66cf`](https://github.com/vultisig/vultisig-sdk/commit/01a66cf5c0110ea1ea439ddbca8e6b75179fc0c5) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Preserve exact uint64 Cosmos account sequences through account lookup and signing payload construction.

- [#1429](https://github.com/vultisig/vultisig-sdk/pull/1429) [`7226d49`](https://github.com/vultisig/vultisig-sdk/commit/7226d49d42cec673465aac5b49b54d4e47628ab6) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - Fix the QBTC send broadcast reporting a false success on a DeliverTx failure. `broadcastQbtcTx` uses `BROADCAST_MODE_SYNC`, which only surfaces the CheckTx (mempool-admission) code — a DeliverTx execution failure (out-of-gas, revert) still returns `code: 0` at broadcast time — and the resolver returned success after only that check, with no inclusion poll. It also read `data.tx_response?.code && …`, treating a missing `tx_response` as success. The resolver now polls for inclusion and re-checks the DeliverTx `code` (mirroring the QBTC claim helper, whose `waitForTxInclusion` is extracted to a shared `waitForQbtcTxInclusion`): a confirmed DeliverTx failure throws a non-retryable error, an unconfirmable inclusion (timeout / transient RPC error) is left in-flight for the status resolver, and a missing/failed CheckTx code is verified by hash instead of trusted.

- [#1428](https://github.com/vultisig/vultisig-sdk/pull/1428) [`0de8684`](https://github.com/vultisig/vultisig-sdk/commit/0de8684706f1b538a459acca0e55bf15c95a91f3) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - Fix the React Native LiFi quote override applying a flat 1% slippage and discarding the caller's slippage. `platforms/react-native/overrides/getLifiSwapQuote.ts` hardcoded `slippage: 0.01` and had no `slippage`/`ticker` input, so on RN (most users) every LiFi quote used 1% — stable pairs that get the 0.3% tier on the core path got 1% (a wider MEV/loss surface), and an explicit tight-tolerance request was silently dropped (LiFi bakes `minAmountOut` from it). The tiered/override resolution (`resolveLifiSlippage`) is now extracted to a shared `lifi/api/lifiSlippage` module that both the core path and the RN override use, so they resolve slippage identically.

- [#1377](https://github.com/vultisig/vultisig-sdk/pull/1377) [`a971dfa`](https://github.com/vultisig/vultisig-sdk/commit/a971dfa99274b419863f83a078868f25a8241235) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - Re-assert the aggregator router allow-list (1inch/kyber) and the Solana Jupiter
  program + fund-movement guard on the MPC co-signer signing-input path, not only
  at quote construction. Every co-signer independently rebuilds the signing input
  from the shared KeysignPayload, so a compromised initiator could otherwise hand
  a co-signer an unvalidated swap destination (EVM `quote.tx.to`) or a spliced
  drain instruction (Solana `quote.tx.data`) and have it signed verbatim. Both
  guards are pure gates: they fail closed for enforced providers or no-op, and
  never mutate the signed bytes, so cross-device pre-signing hash agreement is
  unchanged.

- [#1430](https://github.com/vultisig/vultisig-sdk/pull/1430) [`d01ac2e`](https://github.com/vultisig/vultisig-sdk/commit/d01ac2ee87d080def76454adcf5313726a916ed8) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - Fix the Sui broadcast reporting a false success for a transaction that aborted on-chain (sdk#1398). `broadcastSuiTx` called `executeTransactionBlock` without requesting effects, so a tx that executed but aborted (MoveAbort / InsufficientGas) resolved with a digest — an RPC-level success that is not execution success — and was returned as a successful broadcast. It now requests `showEffects` and throws unless `effects.status.status === 'success'` — mirroring the Sui status resolver, so a missing or unknown status fails closed instead of defaulting to success. The throw is a `DeliverTxFailedError` so the transient-retry wrapper cannot re-broadcast an already-aborted transaction. An RPC-level error still falls through to `verifyBroadcastByHash` unchanged.

- [#1413](https://github.com/vultisig/vultisig-sdk/pull/1413) [`358c27b`](https://github.com/vultisig/vultisig-sdk/commit/358c27ba3bdd94813d00ec966ba43c8cc46f49e0) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Fix `RawBroadcastService`'s Sui raw-broadcast path reporting a false success for a transaction that failed on-chain (sdk#1398). It called `executeTransactionBlock` without requesting effects, so a tx that reverted (MoveAbort / InsufficientGas) resolved with a digest — an RPC-level success that is not execution success — and was returned as broadcast. It now requests `showEffects` and asserts the effects status via the shared `assertSuiTxSucceeded` helper (extracted from the `broadcastSuiTx` resolver, which already guarded against this), throwing a non-retryable error on a failed execution instead of reporting success.

- [#1377](https://github.com/vultisig/vultisig-sdk/pull/1377) [`a971dfa`](https://github.com/vultisig/vultisig-sdk/commit/a971dfa99274b419863f83a078868f25a8241235) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - Bind the ERC-20 approval spender to the verified swap router on the co-signer signing-input path for enforced aggregator providers (1inch/kyber). Follow-up to the signing-path router guard: `quote.tx.to` was re-asserted, but `erc20ApprovePayload.spender` is a separate wire field the approve resolver reads verbatim, so a payload could pass the router check yet still carry an approve granting an attacker an allowance (approval-drain). The bind runs in the approve branch (where the field is still present) and requires `spender === quote.tx.to` for enforced providers; unenforced providers stay unbound (notably cowswap, whose spender is legitimately the GPv2VaultRelayer, not `tx.to`). Monotonic gate: throws or no-ops, never mutates signed bytes. Initiators set the two equal by construction, so only a hand-built/tampered payload trips it.

- [#1271](https://github.com/vultisig/vultisig-sdk/pull/1271) [`3a40960`](https://github.com/vultisig/vultisig-sdk/commit/3a40960cc6391b69bbe6371874889b64399d64b9) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Swap surface hygiene: SwapService.getQuote now forwards affiliateConfig (per-provider fee-owner overrides) to core findSwapQuote instead of silently dropping it - the field is added to SwapQuoteParams, default behavior unchanged when omitted. The swapEnabledChains aggregate now unions every provider list (kyber/jupiter/cowswap were missing, complete only by accident via LiFi's superset), and kyberSwapEnabledChains drops Zksync/Blast, which Kyber's API 404s on.

## 2.26.0

### Minor Changes

- [#1265](https://github.com/vultisig/vultisig-sdk/pull/1265) [`b6fbbe3`](https://github.com/vultisig/vultisig-sdk/commit/b6fbbe3705d6aae02b483de0b7dd1b8a097acd6b) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Retry transient broadcast transport failures at the dispatcher for non-EVM,
  non-Solana chains with a bounded retry budget.

- [#1317](https://github.com/vultisig/vultisig-sdk/pull/1317) [`a08a52b`](https://github.com/vultisig/vultisig-sdk/commit/a08a52bb0933fd5470ea849613e147baa29286ad) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - Register the Rujira liquid-bond THORChain tokens bRUNE (`x/brune`) and ybRUNE (`x/staking-x/brune`), and add the `bruneBondConfig` staking-contract config. bRUNE is auto-discovered as a normal wallet token priced against RUNE (`priceProviderId: 'thorchain'`); the ybRUNE auto-compounding staking receipt is excluded from wallet discovery and carries native-token metadata for backfill.

- [#1269](https://github.com/vultisig/vultisig-sdk/pull/1269) [`dda2e90`](https://github.com/vultisig/vultisig-sdk/commit/dda2e9084859eae02dd16149ac3ab2240a7d37e5) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Allow Solana status checks to return terminal `not_found` for unknown
  signatures whose `lastValidBlockHeight` has expired.

- [#1128](https://github.com/vultisig/vultisig-sdk/pull/1128) [`f885e91`](https://github.com/vultisig/vultisig-sdk/commit/f885e91da06674dbef2ca1495291ca7d201e4c58) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Add first-class XRP DestinationTag support alongside transaction memos.

### Patch Changes

- [#1306](https://github.com/vultisig/vultisig-sdk/pull/1306) [`747b6c6`](https://github.com/vultisig/vultisig-sdk/commit/747b6c68a81e14f3242003f39a4b58499ef44a21) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Preserve full uint64 Cosmos account numbers and sequences through additive exact QBTC bigint fields and WalletCore signing inputs while retaining the legacy numeric account fields.

- [#1272](https://github.com/vultisig/vultisig-sdk/pull/1272) [`9e366db`](https://github.com/vultisig/vultisig-sdk/commit/9e366db273e87e62d260867ea6702466b325d7fc) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Retry Cardano current-slot lookup before broadcast and submit when the tip guard is temporarily unavailable, while still blocking genuinely stale signed transactions.

- [#1324](https://github.com/vultisig/vultisig-sdk/pull/1324) [`30b76c6`](https://github.com/vultisig/vultisig-sdk/commit/30b76c6d0fbe7f0ad3015fee9bc77b5ee9fa7927) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - Fix broken Hyperliquid block-explorer links by pointing them at hypurrscan's `/evm/` section (`https://hypurrscan.io/evm/tx/<hash>` and `/evm/address/<addr>`). The bare `/tx/` path returned a hypurrscan server error.

- [#1261](https://github.com/vultisig/vultisig-sdk/pull/1261) [`846d6c2`](https://github.com/vultisig/vultisig-sdk/commit/846d6c24e96ba4f8133721f1030dd9d023376570) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Treat XRPL `terQUEUED` submit results as in-flight instead of hard broadcast failures while preserving rejection behavior for other engine results.

- [#1260](https://github.com/vultisig/vultisig-sdk/pull/1260) [`eb11e50`](https://github.com/vultisig/vultisig-sdk/commit/eb11e50b2f478fbb21db2970f8616d5f296b49f5) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Mark Sui, Ton, Tron, Bittensor, and QBTC status lookup misses as `isKnown:false` so broadcast verification rethrows rejected sends instead of reporting false success.

- [#1326](https://github.com/vultisig/vultisig-sdk/pull/1326) [`4815346`](https://github.com/vultisig/vultisig-sdk/commit/4815346d794f4a198e84a562c503b3bdd5ae10b8) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - Fix native swaps from THORChain secured assets. Swap quotes now emit secured-asset notation (`CHAIN-ASSET`, e.g. `XRP-XRP`, `ETH-USDC-0x…`) instead of the L1 pool notation (`CHAIN.ASSET`) that THORNode rejects for `thor1`-settling swaps, and the spent secured asset is encoded correctly in the `MsgDeposit` (L1 chain and symbol derived from the denom, `secured` flag set). Applies to all secured assets and swap directions.

## 2.25.1

### Patch Changes

- [#1175](https://github.com/vultisig/vultisig-sdk/pull/1175) [`e70ddf0`](https://github.com/vultisig/vultisig-sdk/commit/e70ddf0258e22d27d208f02d104d0bc1b5562132) Thanks [@NeOMakinG](https://github.com/NeOMakinG)! - Fix 1inch swap quotes to native ETH (and other EVM chains' native assets) failing route resolution.

  `findSwapQuote`'s 1inch fetcher passed `from.id ?? from.ticker` / `to.id ?? to.ticker` into
  `getOneInchSwapQuote`, so a native asset (no `.id`) fell back to its ticker string (e.g. `"ETH"`).
  `getOneInchSwapQuote`'s `isFeeCoin` check relies on `undefined` to detect the native asset and
  substitute 1inch's `0xEeee...` sentinel address (EIP-7528) — a truthy ticker string defeated that
  check, so 1inch received `dst=ETH` (or `src=ETH`) instead of the sentinel and rejected the request
  with `dst must be an Ethereum address`. This silently removed 1inch as a route for any swap
  involving a chain's native asset (e.g. USDC→ETH), even though 1inch could otherwise fill it.

  Now `findSwapQuote` forwards the coin's raw `.id` (`undefined` for the native asset) so
  `getOneInchSwapQuote`'s existing sentinel-mapping logic works as designed. ERC-20↔ERC-20 quotes
  are unaffected; other providers (Kyber, LiFi, SwapKit) construct their own requests and are not
  touched by this change.

## 2.25.0

### Minor Changes

- [#1169](https://github.com/vultisig/vultisig-sdk/pull/1169) [`1ef64a3`](https://github.com/vultisig/vultisig-sdk/commit/1ef64a39f856d9f1d412df8f5e69c66f7130d8c7) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - Surface XRP issued-currency (trust-line) token balances.

  - `getRippleAccountLines` reads an account's trust lines, following `account_lines` pagination so a large set is not truncated.
  - `getRippleCoinBalance` now dispatches on the coin id: native XRP still returns the reserve-adjusted spendable balance, while an issued-currency coin returns that trust line's balance. Previously the resolver ignored the id and returned the XRP balance for _every_ Ripple coin, so a token row displayed the account's XRP balance.
  - `findRippleCoins` discovers held trust lines for the coin finder, so XRPL tokens appear in the asset list. Lines with a negative balance (the account is the issuer and owes the counterparty) and zero-balance lines are excluded.
  - `rippleKnownIssuedTokens` (RLUSD) is now wired into `knownTokens`, so it is selectable before a trust line exists.

## 2.24.3

### Patch Changes

- [#1115](https://github.com/vultisig/vultisig-sdk/pull/1115) [`4483754`](https://github.com/vultisig/vultisig-sdk/commit/4483754748190fe25654de79fc12fba0edb73963) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Expand large scientific-notation numeric amounts before base-unit parsing.

## 2.24.2

### Patch Changes

- [#1018](https://github.com/vultisig/vultisig-sdk/pull/1018) [`90070f3`](https://github.com/vultisig/vultisig-sdk/commit/90070f39be011821f7508c7ff094025861dce040) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - fix(swap): accept returned quote provider ids in `findSwapQuote.excludeProviders`

  `findSwapQuote.excludeProviders` now accepts both display names (`CowSwap`, `KyberSwap`, `LiFi`) and returned quote provider ids (`cowswap`, `kyber`, `li.fi`) for general providers. Unknown exclude tokens now fail closed instead of silently leaving the provider eligible.

- [#1112](https://github.com/vultisig/vultisig-sdk/pull/1112) [`2c9d34e`](https://github.com/vultisig/vultisig-sdk/commit/2c9d34e0837f68d92769c7aefa566ffb1c0c52c7) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - fix(swap): resolve THORChain limit-swap destination chains via the swap-eligible chain set, not the LP-position map (THOR-04) — `getSupportedThorchainAssetChain` (`limitSwapMemo.ts`) resolved a THORChain asset-prefix (e.g. `SOL`, `NOBLE`) to a `Chain` via `lpChainMap`, a map scoped to the wallet's LP-position-display feature (`chains/cosmos/thor/lp/lpChainMap.ts`), not swap eligibility. Since neither Solana nor Noble has a THORChain LP pool, both were missing from that map, so a limit swap (`LIM=` memo) targeting either failed closed with "unsupported THORChain asset prefix" even though both are valid THORChain market-swap destinations (per THORChain's memo docs, `=` vs `=<` only changes execution behavior — price/queue/TTL — not the destination-chain universe). Fixed by unioning `lpChainMap` with `thorChainSwapEnabledChains` (`swap/native/NativeSwapChain.ts`, now exported) — the same THORChain-specific chain list regular market swaps already use to gate eligibility — rather than replacing `lpChainMap` outright or switching to the broader `nativeSwapChainIds`, which also carries MayaChain-only entries (e.g. `Chain.MayaChain`, `Chain.Cardano`) that aren't valid THORChain limit-swap destinations.

- [#1097](https://github.com/vultisig/vultisig-sdk/pull/1097) [`ffc75a6`](https://github.com/vultisig/vultisig-sdk/commit/ffc75a6e76af699a78b0fc3411ab052ce5000c91) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - fix(swap): exact bigint decimal conversion for the displayed swap output (`toAmountDecimal`) — the float64 `fromChainAmount(...).toFixed()` path silently drifted above 2^53 raw units (e.g. `999999999999999999999999` @18dp rendered as `1000000.000000000000000000`), so the amount the user confirmed could differ from the quoted one. Non-integer provider amount strings keep the legacy fallback instead of throwing mid-build.

## 2.24.1

### Patch Changes

- [#1107](https://github.com/vultisig/vultisig-sdk/pull/1107) [`c5e89cb`](https://github.com/vultisig/vultisig-sdk/commit/c5e89cb317ae6f4ca00eb6c628ad6bac636e4821) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - fix(swap): populate 1inch affiliateFee for display (AGG-05) — 1inch general-swap quotes never populated `affiliateFee` on the returned `GeneralSwapQuote`, unlike Kyber and LI.FI, leaving the fee-transparency row blank for 1inch even though a real affiliate cut is taken via its `fee`/`referrer` params. `getOneInchSwapQuote` now grosses the post-fee `dstAmount` back up (same bps-based calc `getKyberSwapAffiliateFee` uses) to compute and attach a display-only `affiliateFee`.

- [#1101](https://github.com/vultisig/vultisig-sdk/pull/1101) [`9a1fc02`](https://github.com/vultisig/vultisig-sdk/commit/9a1fc0276ddc8fc905fab392875499d39011520d) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - fix(swap): surface non-integer dstAmount drops + validate THORChain/MayaChain MsgDeposit memos (SDK-CORRECTNESS-04/06/08) — a drifted provider's non-integer `dstAmount` used to silently drop that quote from ranking with no signal it was a parse failure; `findSwapQuote` now `console.warn`s the provider + raw value before rethrowing. `prepareThorchainMsgDepositTxFromKeys` accepted an arbitrary memo string with no structural validation, unlike the fully-validated limit-swap memo path; it now fails closed on non-printable/oversized memos and unrecognized THORChain/MayaChain deposit actions (and, for the two documented LP actions, a malformed pool id), while still accepting non-LP operator-style memos (BOND, UNBOND, etc.) verbatim. Also replaced an `as any` cast on the deposit's chain-specific proto binding with per-chain branches so the `case`/`value` pairing is statically checked instead of bypassed.

## 2.24.0

### Minor Changes

- [#1042](https://github.com/vultisig/vultisig-sdk/pull/1042) [`ad6196b`](https://github.com/vultisig/vultisig-sdk/commit/ad6196b32ae879e7b0e0fda48e462fc7a05eb1de) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - feat(ripple): XRP trust-line (TrustSet) support for issued tokens

  Add support for opening/modifying an XRPL trust line so a vault can hold issued
  currencies (e.g. RLUSD). `getRippleSigningInputs` now emits a WalletCore
  `OperationTrustSet` (LimitAmount = { currency, issuer, value }) when the keysign
  coin is an issued currency, and falls through to the existing Payment path for
  native XRP. New `chains/ripple/issuedCurrency` helpers encode the composite
  `currency.issuer` token id, normalise human tickers to on-ledger currency codes,
  format issued-currency values, and expose the 0.2 XRP owner-reserve delta
  (`rippleOwnerReserveDrops`). `isValidTokenId` validates XRPL `currency.issuer`
  ids.

## 2.23.3

### Patch Changes

- [#1024](https://github.com/vultisig/vultisig-sdk/pull/1024) [`3bc7904`](https://github.com/vultisig/vultisig-sdk/commit/3bc790403483dd7e90dac2efc33d7bc64c18b921) Thanks [@neavra](https://github.com/neavra)! - Stop `tx-status` from reporting malformed or never-seen transaction hashes as `pending` forever.

  - The EVM status resolver now distinguishes a genuinely-pending tx (the node knows the hash, receipt still lagging) from one the node has never seen, returning a new terminal `not_found` status for the latter instead of an indefinite `pending`.
  - New `isValidTxHash(chain, hash)` helper validates a hash's shape per chain-kind; the CLI `tx-status` command validates `--tx-hash` before any RPC and fails fast with `INVALID_INPUT` (exit 4) on a malformed hash.
  - CLI `tx-status` polling is now bounded by a total wait budget (`--timeout <seconds>`, default 120) and exits non-zero on give-up — `TX_NOT_FOUND` (exit 5) when the node has no record of the hash, `TX_STATUS_TIMEOUT` (exit 3, retryable) when it is still pending.
  - The poll loop now caps each sleep at the remaining wait budget instead of always sleeping the full poll interval, so a small `--timeout` gives up promptly instead of overshooting by up to one poll interval.

## 2.23.2

### Patch Changes

- [#1014](https://github.com/vultisig/vultisig-sdk/pull/1014) [`c41a219`](https://github.com/vultisig/vultisig-sdk/commit/c41a21950c4cccf70c8298b8e595acf64c276d8c) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - feat(cosmos): initiator-side dynamic gas — simulate native sends and relay `CosmosSpecific.gas_limit`

  `getCosmosChainSpecific` now simulates native Cosmos bank sends via
  `/cosmos/tx/v1beta1/simulate` and relays the padded (`× 1.3`) `gas_used` to
  co-signers in `CosmosSpecific.gas_limit`. The signing-inputs resolver already
  honors this field (scaling the fee amount accordingly) and falls back to the
  static per-chain gas limit when it is absent or zero, so:

  - Only native bank sends are simulated (a relayed dapp `signData`, token / IBC /
    contract / staking txs, and vault-based chains keep the static limit).
  - Estimation fails closed: any simulate/build error leaves the field unset, so
    simulation never blocks signing and peers converge on the static limit.
  - The relayed limit is part of the SignDoc every device hashes; because it is
    computed with exact integer math (ceil of `gas_used × 13 / 10`) and honored
    identically across peers, cross-device co-signing stays byte-identical.

  Mirrors the iOS `CosmosGasEstimator` implementation.

## 2.23.1

### Patch Changes

- [#956](https://github.com/vultisig/vultisig-sdk/pull/956) [`f72cbc3`](https://github.com/vultisig/vultisig-sdk/commit/f72cbc35a23edb2b14984fce0a16495a3339e5e6) Thanks [@gastonm5](https://github.com/gastonm5)! - fix(cardano): attach and plan per-UTXO native-token data for MPC keysign parity

  Adopts commondata's `UtxoInfo.cardano_tokens` across all three missing
  layers, mirroring the mainnet-tested iOS implementation byte-for-byte:

  - Regenerates `utxo_info_pb.ts` so `CardanoTokenAsset` /
    `UtxoInfo.cardanoTokens` exist and can be decoded off the keysign wire.
  - The keysign initiator fetches Cardano UTXOs with Koios `_extended` and
    attaches per-UTXO native assets (UTXOs ordered by `(hash, index)`, assets
    by `(policyId, assetNameHex)`, hex lowercased) so co-signers see
    deterministic, token-aware payload bytes.
  - The Cardano signing-inputs resolver maps `cardanoTokens` onto WalletCore
    `TxInput.token_amount` (minimal big-endian amount bytes), letting the
    planner reconcile input tokens into the change output.

  Fixes MPC co-signing for any Cardano address holding native tokens:
  iOS/macOS-initiated sends no longer fail keysign with a pre-image hash
  mismatch, and SDK-initiated sends no longer build token-dropping bodies
  that the node rejects at broadcast (Ogmios 3123 "value not conserved").

- [#806](https://github.com/vultisig/vultisig-sdk/pull/806) [`119d96d`](https://github.com/vultisig/vultisig-sdk/commit/119d96d5b2c9e1e2d8b322bf31d83f3ac4294244) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Rank swap quotes by net user output and tighten the provider preference band.

## 2.23.0

### Minor Changes

- [#931](https://github.com/vultisig/vultisig-sdk/pull/931) [`45fb0ae`](https://github.com/vultisig/vultisig-sdk/commit/45fb0ae83611dfcd481b1aa9dbcd19fe215642f5) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Add a public `SwapAffiliateConfig.jupiter` fee-owner override for Jupiter affiliate fee account derivation.

- [#930](https://github.com/vultisig/vultisig-sdk/pull/930) [`e11d55f`](https://github.com/vultisig/vultisig-sdk/commit/e11d55f51dc4a65230ca4daa6bbad2580a3d1a81) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - feat(solana): staking APY resolver

  Phase 6 of Solana native staking. Adds `resolveValidatorApy` under
  `@vultisig/core-chain/chains/solana/staking/apyResolver`, which drives the
  per-validator APY on the DeFi stake rows. Two sources, in order: the Stakewiz
  `apy_estimate` passthrough (network-measured, commission-net) from the Phase 2
  metadata seam, then an on-chain fallback derived from the network inflation rate
  and the fraction of supply staked, net of the validator's commission, compounded
  over the epochs-per-year. Returns `undefined` when neither yields a positive
  value so the view hides the APY row.

- [#887](https://github.com/vultisig/vultisig-sdk/pull/887) [`6ff9d7e`](https://github.com/vultisig/vultisig-sdk/commit/6ff9d7eba5699e1db897c5aedbac52632c131cc5) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Add Jupiter as a same-chain Solana swap provider with VULT-scaled affiliate fee support.

### Patch Changes

- [#954](https://github.com/vultisig/vultisig-sdk/pull/954) [`66113c2`](https://github.com/vultisig/vultisig-sdk/commit/66113c2fb2ff61ecda39a7ae5ac83e8c7cd67adc) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Fix Terra Classic address explorer URLs so Terra Finder receives a single `classic` network segment.

- [#923](https://github.com/vultisig/vultisig-sdk/pull/923) [`17a43be`](https://github.com/vultisig/vultisig-sdk/commit/17a43beadda6d3f4f7d97c193067564a2c85bd37) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Fetch Solana signing blockhashes at confirmed commitment and retry transient blockhash misses during standard RPC broadcast.

## 2.22.2

### Patch Changes

- [#921](https://github.com/vultisig/vultisig-sdk/pull/921) [`6eff99f`](https://github.com/vultisig/vultisig-sdk/commit/6eff99fa08f0d2511eab95304c0a0c973944db2e) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - refactor(cardano): attach CIP-20 memo via WalletCore native auxiliary_data

  Bumps `@trustwallet/wallet-core` to `4.7.0`, which adds the Cardano
  `SigningInput.auxiliary_data` field. The Cardano memo path now hands the
  CIP-20 CBOR straight to WalletCore, which commits its Blake2b-256 hash into
  tx body key 7 and embeds the bytes in the signed transaction — replacing the
  client-side body patching and re-hashing in TypeScript. The chain-specific
  fee estimator prices the WalletCore body as-is (it already carries key 7),
  and the now-unused `patchTxBodyWithAuxHash` helper is removed.

- [#924](https://github.com/vultisig/vultisig-sdk/pull/924) [`d08a476`](https://github.com/vultisig/vultisig-sdk/commit/d08a47696d0cb1c8dbcb50d41830b9eae16b6d8c) Thanks [@johnnyluo](https://github.com/johnnyluo)! - fix(terra-classic): align send gas limit with iOS/Android for cross-device co-signing

  Corrects the Terra Classic send gas limit in `cosmosGasLimitRecord` so it matches
  the values used by the iOS and Android clients. When co-signing across devices, a
  mismatched gas limit produces a different transaction hash and the signing session
  fails; aligning the record keeps the payload identical across platforms.

## 2.22.1

### Patch Changes

- Updated dependencies [[`6302825`](https://github.com/vultisig/vultisig-sdk/commit/63028250c7a17bf165046f0bb0c2263354dab66a)]:
  - @vultisig/lib-utils@0.10.4

## 2.22.0

### Minor Changes

- [#915](https://github.com/vultisig/vultisig-sdk/pull/915) [`4941508`](https://github.com/vultisig/vultisig-sdk/commit/4941508f5002e1251b5cc1cbc08ed0ebc379646a) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - feat(solana): native-staking transaction builder (byte-parity)

  Phase 3 of Solana native staking. Adds the signing core for the delegate flow
  (and the proto for the later unstake / withdraw / move-stake ops) under
  `@vultisig/core-chain/chains/solana/staking/tx`:

  - `stakingPayload` — discriminated staking-op intent (delegate / unstake /
    withdraw / move-stake deactivate + redelegate sub-steps).
  - `buildUnsignedStakingTx` — maps a payload to the wallet-core Solana stake
    proto (`delegateStakeTransaction` derives the stake account; move-redelegate
    sets it explicitly), compiles a zero-signature envelope via
    `TransactionCompiler`, and returns it base64-encoded. This is the MPC
    byte-parity contract: the initiating device builds these bytes once (pinning
    the recent blockhash + the derived stake-account address) and relays them via
    `signSolana.rawTransactions`, so every co-signer signs the identical message.

  Adds `long` to core-chain deps (Long-typed proto amount fields). Byte-parity
  tests build delegate / deactivate / withdraw / move-redelegate txs against real
  wallet-core, decode them back, and assert determinism.

### Patch Changes

- [#916](https://github.com/vultisig/vultisig-sdk/pull/916) [`17fcbc0`](https://github.com/vultisig/vultisig-sdk/commit/17fcbc0acf983959be7faaf4ab789b4268a83c31) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - Solana broadcast: surface the on-chain rejection reason. When `sendTransaction` is rejected at preflight, the RPC returns the actionable detail in `data.err` / `data.logs` (the program logs), which web3.js exposes via `SendTransactionError.logs` while leaving the bare `.message` ("failed to send transaction") uninformative. The broadcast resolver now folds those program logs into the thrown error's message (preserving the original error as `cause`), so consumers reading the top-level message see _why_ the network rejected the transaction — "insufficient lamports", a custom program error, a failed instruction — instead of just that it failed.

## 2.21.0

### Minor Changes

- [#912](https://github.com/vultisig/vultisig-sdk/pull/912) [`403d5d5`](https://github.com/vultisig/vultisig-sdk/commit/403d5d5f7c7dba3e45cb818899db00f765541ecf) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - feat(solana): validator-metadata seam (Stakewiz, swappable)

  Phase 2 of Solana native staking. Adds a swappable off-chain enrichment seam for
  validator display metadata (name / logo / APY estimate / score) on top of the
  Phase 1 on-chain `getVoteAccounts` rows, under
  `@vultisig/core-chain/chains/solana/staking/metadata`:

  - `ValidatorMetadataProvider` — provider interface; contract: never throws.
  - `stakewizProvider` — concrete impl over api.stakewiz.com (`apy_estimate`
    percent→fraction, `image`→logo, `wiz_score`→score). Degrades to an empty map
    on any outage / non-OK / parse error so callers fall back to on-chain-only.
  - `enrichValidators` — merges the metadata map onto the validator rows; the
    provider is injectable for tests.

## 2.20.0

### Minor Changes

- [#900](https://github.com/vultisig/vultisig-sdk/pull/900) [`9e72781`](https://github.com/vultisig/vultisig-sdk/commit/9e7278125bd8bc722a26ab3a1f91ba1be03054d1) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - feat(solana): staking foundation — models + RPC read layer

  Phase 1 of Solana native staking. Adds the chain-layer read foundation under
  `@vultisig/core-chain/chains/solana/staking`: config, stake-account/validator
  models (jsonParsed parsing + activation-state derivation), the RPC read layer
  (getVoteAccounts / stake-account scan / epoch / rent / inflation / supply), and
  the withdraw cooldown gate. No UI, no signing, no validator-metadata source.

## 2.19.0

### Minor Changes

- [#894](https://github.com/vultisig/vultisig-sdk/pull/894) [`605fbba`](https://github.com/vultisig/vultisig-sdk/commit/605fbbaf107c553898f11f4f7eb6b56a59c01b9e) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - feat(swap): add Jupiter as a Solana same-chain swap provider with a VULT-scaled affiliate fee

  `findSwapQuote` now offers Jupiter for on-Solana token pairs (SOL↔SPL, SPL↔SPL),
  preferred over SwapKit/LiFi on a near-tie. Jupiter is Solana-only and same-chain
  — it is never offered for any cross-chain route, and native SOL cross-chain swaps
  stay on THORChain.

  The Jupiter quote sends `platformFeeBps` = `max(0, 50 − vultTierDiscountBps)`
  (the existing `getSwapAffiliateBps` value, shared with every other provider), and
  the swap request sends `feeAccount` = the Associated Token Account of
  `(owner = Vultisig fee wallet, mint = output mint)`. An idempotent
  `createAssociatedTokenAccount` instruction for that fee ATA is prepended to the
  returned transaction (Jupiter does not auto-create it). When the affiliate bps
  floors to 0 (Ultimate-tier VULT holder), no platform fee or fee account is used.

  New public surface: `swap/general/jupiter/*` (`getJupiterSwapQuote`,
  `configureJupiter`, `jupiterSwapEnabledChains`) and `jupiter` added to
  `generalSwapProviders` and the swap explorer providers.

- [#893](https://github.com/vultisig/vultisig-sdk/pull/893) [`552064c`](https://github.com/vultisig/vultisig-sdk/commit/552064cbfb7307867f9897734c010e856f8a08f9) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - Add TON nominator-pool staking support. `@vultisig/core-chain` gains a tonapi staking client (`chains/ton/staking`) — pool list, computed pool info, and account nominator positions — plus per-implementation deposit/withdraw comment resolution (`whales` → `Deposit`/`Withdraw`, `tf` → `d`/`w`), pool eligibility/capacity filters, and a `tonAddressToBounceable` helper that normalizes raw `0:` pool addresses to the bounceable `EQ…` form. `@vultisig/core-mpc` now forces TON transfers bounceable for any staking comment (via `isTonStakingComment`), so a rejected pool deposit/withdraw bounces back instead of being absorbed.

### Patch Changes

- [#886](https://github.com/vultisig/vultisig-sdk/pull/886) [`baedd96`](https://github.com/vultisig/vultisig-sdk/commit/baedd96e9d75a9d73880a59503f95b527d692428) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Add an EVM chain balance batching helper backed by Multicall3.

## 2.18.0

### Minor Changes

- [#888](https://github.com/vultisig/vultisig-sdk/pull/888) [`b61410e`](https://github.com/vultisig/vultisig-sdk/commit/b61410ef8b1d0b1baa7d249440176df23bfa471c) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - Add QBTC governance support under `chains/cosmos/qbtc/governance/`: REST clients for the Cosmos `x/gov v1` proposals, tally, votes and params endpoints, plus the domain types and wire parsers. Mirrors the existing `qbtc/claim` split and is consumed by the wallet's QBTC governance UI.

## 2.17.11

### Patch Changes

- [#884](https://github.com/vultisig/vultisig-sdk/pull/884) [`33e663c`](https://github.com/vultisig/vultisig-sdk/commit/33e663ce6ba519cacb7dae5befebe9e3e530b4d7) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - Lower `cosmosGasRecord[TerraClassic]` from 100 LUNC to 20 LUNC.

  Real on-chain MsgSend cost on columbus-5: ~400k gas x 28.325 uluna/gas ~ 11.33 LUNC.
  The 100 LUNC floor was blocking sends from wallets with 20-100 LUNC balance even when
  the transaction would have succeeded. The new 20 LUNC floor gives a ~1.77x buffer.

  Companion to vultisig/agent-backend#1409 and vultisig/mcp-ts#594.

## 2.17.10

### Patch Changes

- [#874](https://github.com/vultisig/vultisig-sdk/pull/874) [`69bb830`](https://github.com/vultisig/vultisig-sdk/commit/69bb8307de72883f0c7693871a6ca040b7a0756c) Thanks [@neavra](https://github.com/neavra)! - fix(core-chain): treat duplicate-signature Solana broadcast errors as idempotent success

  `broadcastSolanaTx` now classifies "already been processed" / `AlreadyProcessed`
  rejections from `sendRawTransaction` as an idempotent success (returns instead
  of routing to `verifyBroadcastByHash`), mirroring the TON/UTXO/Cosmos dedupe
  guards. This stops a headless retry after an ambiguous broadcast from blindly
  re-submitting an already-accepted Solana transaction.

## 2.17.9

### Patch Changes

- Updated dependencies [[`2ff65f3`](https://github.com/vultisig/vultisig-sdk/commit/2ff65f31bbbf64919c456e05dc6d274625127c2e)]:
  - @vultisig/lib-utils@0.10.3

## 2.17.8

### Patch Changes

- [#870](https://github.com/vultisig/vultisig-sdk/pull/870) [`59e66c8`](https://github.com/vultisig/vultisig-sdk/commit/59e66c89858f90222a1d2d74eff9e71b69dd2f03) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Normalize native THORChain and MayaChain swap quote output amounts to destination coin base units before SDK quote formatting and near-zero validation.

## 2.17.7

### Patch Changes

- [#809](https://github.com/vultisig/vultisig-sdk/pull/809) [`e53230e`](https://github.com/vultisig/vultisig-sdk/commit/e53230efd2bb8a4e68f85f74c24655190af405d4) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Honor native swap quote expiry and validate THORChain inbound vault addresses before broadcasting stale signed swaps.

- [#808](https://github.com/vultisig/vultisig-sdk/pull/808) [`ab9cc91`](https://github.com/vultisig/vultisig-sdk/commit/ab9cc91c48588e9ecd96ec7eb50fd8138b88ba13) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Apply native THORChain/Maya swap slippage tolerance to quote requests and signed payload limits so native swaps no longer use a zero minimum-output floor.

## 2.17.6

### Patch Changes

- [#774](https://github.com/vultisig/vultisig-sdk/pull/774) [`0f350ff`](https://github.com/vultisig/vultisig-sdk/commit/0f350ff128a42764950e71b4c156907ec59a3c37) Thanks [@NeOMakinG](https://github.com/NeOMakinG)! - Add scanAddress method for Blockaid EVM address reputation scanning

- [#790](https://github.com/vultisig/vultisig-sdk/pull/790) [`6f53d2c`](https://github.com/vultisig/vultisig-sdk/commit/6f53d2cb3d1a56ff9377cc32c7c6f4e750fe8f21) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Align Dogecoin Blockchair fee estimation with the app clients by using 25% of the reported baseline.

- Updated dependencies [[`b51902b`](https://github.com/vultisig/vultisig-sdk/commit/b51902bc08045e3977116565e430c1454d0ba607)]:
  - @vultisig/lib-utils@0.10.2

## 2.17.5

### Patch Changes

- [#785](https://github.com/vultisig/vultisig-sdk/pull/785) [`4097213`](https://github.com/vultisig/vultisig-sdk/commit/4097213ae0c35b668e54a4a9149968860849b349) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - feat(ton): rebrand native token Toncoin (TON) → Gram (GRAM)

  The Open Network renamed its native token TON → GRAM (effective 2026-06-15).
  Update the display fields of `chainFeeCoin[Chain.Ton]`: `ticker` `TON` → `GRAM`
  and `logo` `ton` → `gram`. This is a cosmetic token rebrand only — the chain
  identity (`Chain.Ton`), `priceProviderId` (`the-open-network`), and `decimals`
  are unchanged, and there is no swap/migration. Patch-bumps `@vultisig/sdk` to
  rebundle.

## 2.17.4

### Patch Changes

- [#773](https://github.com/vultisig/vultisig-sdk/pull/773) [`ba1372e`](https://github.com/vultisig/vultisig-sdk/commit/ba1372e6cc76243e6c44114d706ae0b00c524e47) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - Raise Zcash memo-send fees to the ZIP-317 conventional fee at plan time. WalletCore's `zip_0317` planner flat-sizes OP_RETURN and ignores `byteFee`, so memo sends planned one logical action short and were rejected by the network; the signing-input resolver now re-plans with `zip_0317` off and bumps `byteFee` until the fee clears.

## 2.17.3

### Patch Changes

- [#753](https://github.com/vultisig/vultisig-sdk/pull/753) [`e988851`](https://github.com/vultisig/vultisig-sdk/commit/e98885119f18078a0dde1f1ebdbca20f842c9325) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Fail Cardano broadcasts before submission when the signed transaction TTL is expired or too close to expiry.

- [#754](https://github.com/vultisig/vultisig-sdk/pull/754) [`35c48e3`](https://github.com/vultisig/vultisig-sdk/commit/35c48e3eac615d62697c9052f43a9dab918b94dd) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Route UTXO and Cardano broadcast timeouts through transaction hash verification before treating them as landed.

## 2.17.2

### Patch Changes

- [#769](https://github.com/vultisig/vultisig-sdk/pull/769) [`406c261`](https://github.com/vultisig/vultisig-sdk/commit/406c261a702989fbdcdc3fde54b51c0b3eab8b62) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Handle the current Noon vault APY API shape when reading 7d net yield metrics.

## 2.17.1

### Patch Changes

- [#766](https://github.com/vultisig/vultisig-sdk/pull/766) [`f265fe0`](https://github.com/vultisig/vultisig-sdk/commit/f265fe0d33abda6b1157b248151217fc558f911c) Thanks [@realpaaao](https://github.com/realpaaao)! - fix(zcash): add trailing slash to branch-id RPC URL

  The live ZIP-243 branch-id fetch POSTs to a bare `${rootApiUrl}/zcash`, which the
  proxy now 301-redirects to `/zcash/`. Following a 301 downgrades POST→GET, so the
  request lands as `GET /zcash/` → HTTP 405, breaking all Zcash signing on the
  "Sign Transaction" screen. Add the trailing slash so the POST hits the working
  endpoint directly (live-verified 200 with consensus.nextblock).

## 2.17.0

### Minor Changes

- [#757](https://github.com/vultisig/vultisig-sdk/pull/757) [`0567316`](https://github.com/vultisig/vultisig-sdk/commit/056731699c9d1c9f16d9c9eb049e747c73f1c33d) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - feat(swap): support an external recipient for native + CowSwap swaps

  `findSwapQuote` now accepts an optional `recipient` address. When set, the
  swapped output is routed to that address via the native THORChain/MayaChain
  memo `destination` and the CowSwap order `receiver`. Aggregators that would pay
  the swap initiator (1inch, KyberSwap, LiFi, SwapKit) are skipped for
  custom-recipient swaps so funds are never silently misrouted. When `recipient`
  is omitted, routing and payout are unchanged.

  Part of wiring the Advanced Swap settings (vultisig/vultisig-windows#4131);
  external recipient for the remaining aggregators is a follow-up.

- [#757](https://github.com/vultisig/vultisig-sdk/pull/757) [`e240dae`](https://github.com/vultisig/vultisig-sdk/commit/e240dae5df253b544e688c3e41d3037ec30fbdc0) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - feat(swap): support a custom slippage tolerance in findSwapQuote

  `findSwapQuote` now accepts an optional `slippageTolerance` (in percent, e.g.
  `0.5` = 0.5%). It is forwarded to the general aggregators that accept a slippage
  override, each converted to that provider's native unit: 1inch and SwapKit
  (percent), KyberSwap (basis points), and LiFi (fraction). CowSwap (RFQ limit
  order) and the native THORChain/MayaChain protocols use their own protection
  and ignore it. When omitted, every provider keeps its existing default — no
  behavior change.

  Part of wiring the Advanced Swap settings (vultisig/vultisig-windows#4131).

### Patch Changes

- [#757](https://github.com/vultisig/vultisig-sdk/pull/757) [`a3dbf1b`](https://github.com/vultisig/vultisig-sdk/commit/a3dbf1b55f0e83cacdefbbee3532a01d8f7ba3af) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - fix(swap): validate recipient and slippage overrides in findSwapQuote

  `findSwapQuote` now trims the optional `recipient` and treats empty/whitespace
  strings as no recipient, so a blank value no longer gates off initiator-paying
  aggregators or gets forwarded as a native `destination` / CowSwap `receiver`.
  It also rejects an invalid `slippageTolerance` (negative, `NaN`, or non-finite)
  up front with a `SwapError` instead of letting the bad value propagate into
  every provider call.

## 2.16.6

### Patch Changes

- [#711](https://github.com/vultisig/vultisig-sdk/pull/711) [`ea8afd2`](https://github.com/vultisig/vultisig-sdk/commit/ea8afd2d468380e1f5e36cae50ba9111c7b2c1bd) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Preflight THORChain native swap quotes against inbound halt flags before requesting a quote.

## 2.16.5

### Patch Changes

- [#749](https://github.com/vultisig/vultisig-sdk/pull/749) [`343a921`](https://github.com/vultisig/vultisig-sdk/commit/343a9211d7f5af74753124146a72ebec343e5f2f) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - cosmos/gas: bump TerraClassic staking gas limit from 2M to 3M and cap msgCount scaling

  `getCosmosStakingGasLimit` now returns 3M for `Chain.TerraClassic` regardless of `msgCount`. The previous 2M base caused consistent out-of-gas failures (`ValuePerByte` meter in the classic-terra treasury/tax post-handler adds ~200-800 gas beyond the standard SDK estimate). The msgCount scaling is disabled for TerraClassic: at `msgCount >= 2` the scaled gasWanted would exceed the 100 LUNC fee floor, causing node rejection. Columbus-5 callers must split multi-validator reward claims into separate transactions.

## 2.16.4

### Patch Changes

- [#756](https://github.com/vultisig/vultisig-sdk/pull/756) [`78eb626`](https://github.com/vultisig/vultisig-sdk/commit/78eb6263a0ac33f59c97fd7be81610185d0a7a90) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - fix(pubkey): fall back to bip32 derivation when chainPublicKey is 32 bytes on ecdsa chains

  Older KeyImport vault backups sometimes store the raw 32-byte X coordinate
  for secp256k1 chains instead of the standard 33-byte compressed form.
  WalletCore's createWithData rejects these with "Invalid length: Expected 33
  but received 32", breaking execute_swap / show_receive_request for affected
  users (~7 events/day in prod).

  The fix detects the 32-byte case at runtime for ecdsa chains and falls back
  to BIP32 derivation from the root ECDSA key, which always produces a valid
  33-byte compressed pubkey.

- [#758](https://github.com/vultisig/vultisig-sdk/pull/758) [`10a058b`](https://github.com/vultisig/vultisig-sdk/commit/10a058bf1a2a2c1ed9ba4ec9c4a29830ec6f1aae) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - Use a distinct provider for Kujira's LCD fallback so primary (polkachu) and fallback (rest.cosmos.directory) are independent - restoring real redundancy if polkachu degrades.

- [#756](https://github.com/vultisig/vultisig-sdk/pull/756) [`78eb626`](https://github.com/vultisig/vultisig-sdk/commit/78eb6263a0ac33f59c97fd7be81610185d0a7a90) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - fix: await assertFetchResponse in queryOneInch to prevent "Already read" body error

  assertFetchResponse is an async function that reads the response body. Without
  await, the body read started in the background while response.json() was called
  concurrently - resulting in a "Already read" TypeError on non-2xx EVM discovery
  responses. Fixes dashboard_sdk_discovery_failure events for Ethereum/BSC/Arbitrum.

- [#738](https://github.com/vultisig/vultisig-sdk/pull/738) [`a335ca8`](https://github.com/vultisig/vultisig-sdk/commit/a335ca80e13da83c4ed5c2922f5ae845a4aea712) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Add Noon sUSN Delta Neutral USDC yield vault helpers for Ethereum, including ERC-7540 calldata builders, USDC approval planning, on-chain read helpers, and Noon/Accountable APY plus TVL API clients exposed through the SDK boundary.

- [#756](https://github.com/vultisig/vultisig-sdk/pull/756) [`78eb626`](https://github.com/vultisig/vultisig-sdk/commit/78eb6263a0ac33f59c97fd7be81610185d0a7a90) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - fix(cosmos): bump TerraClassic staking gas limit from 2M to 3M

  The 2M limit was consistently failing with "out of gas in location:
  ValuePerByte" on TerraClassic MsgDelegate / MsgUndelegate / claim-rewards
  txs (gasUsed: 2000201-2000774). The ValuePerByte meter in the classic-terra
  treasury/tax post-handler adds ~200-800 gas on top of the base delegate
  cost, which the standard SDK estimate doesn't account for. 3M fits safely
  within the 100 LUNC fee floor (3M \* 28.325 uluna/gas ≈ 84.97 LUNC < 100
  LUNC).

## 2.16.3

### Patch Changes

- [#748](https://github.com/vultisig/vultisig-sdk/pull/748) [`b544eea`](https://github.com/vultisig/vultisig-sdk/commit/b544eea2bd6f30aef59d6465d89784c763b13c11) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - Add canonical Circle USDC on Base (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`) to the known-token registry. It was the only major-EVM canonical USDC missing, so swaps to Base USDC resolved via the coingecko source and the app flagged the canonical stablecoin as "unverified token". Now it resolves as a known token (verified).

## 2.16.2

### Patch Changes

- [#718](https://github.com/vultisig/vultisig-sdk/pull/718) [`c67da04`](https://github.com/vultisig/vultisig-sdk/commit/c67da049ce35988e82771a1e981b0d84040310e3) Thanks [@realpaaao](https://github.com/realpaaao)! - Replace the dead Hyperliquid block explorer liquidscan.io with hypurrscan.io.

- [#735](https://github.com/vultisig/vultisig-sdk/pull/735) [`9d11951`](https://github.com/vultisig/vultisig-sdk/commit/9d1195121a99b05ac0d0bd6e359933aaf18dad34) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - fix(cosmos): use polkachu for the Kujira LCD + RPC endpoints

  `kujira-rest.publicnode.com` and `kujira-rpc.publicnode.com` both now return
  HTTP 403 "unsupported platform" for our clients, breaking Kujira balance reads
  and tx broadcasts. Point `cosmosRpcUrl` and `tendermintRpcUrl` for Kujira at
  polkachu (the same provider Noble uses, and the one `getCosmosAccountInfo`
  already falls back to). Live-verified 200 with the real ukuji balance.

## 2.16.1

### Patch Changes

- [#702](https://github.com/vultisig/vultisig-sdk/pull/702) [`cb2e8f0`](https://github.com/vultisig/vultisig-sdk/commit/cb2e8f00861daff26ac8b04a34e22be9b243235c) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - Fix TON jetton balances showing a stranger's holdings. Jetton wallet lookups
  queried the proxy with `owner_id` + `jetton_master_id`, which toncenter v3
  ignores (it filters on `owner_address` + `jetton_address`). The proxy then
  returned an unfiltered global list and the code took the first entry — a random
  wallet — so an address with no USDT reported ~200M USDT. Restore the correct
  params and filter the response by both owner and jetton master instead of
  trusting the first entry. This also keeps jetton transfers from resolving the
  wrong source wallet.

## 2.16.0

### Minor Changes

- [#724](https://github.com/vultisig/vultisig-sdk/pull/724) [`fcfd1f9`](https://github.com/vultisig/vultisig-sdk/commit/fcfd1f90550d8f62821167ea349b3e8ee2bf9d24) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - feat(custom-rpc): app-wide per-chain custom RPC endpoint overrides

  Add an in-memory override registry that the EVM and Cosmos URL resolvers consult, so a host app can point a supported chain at its own node. v1 covers the EVM chains and the IBC-enabled Cosmos chains; the override maps to the EVM RPC URL for EVM chains and to the LCD/REST endpoint for Cosmos (balance fallback, account info, fee). Includes `customRpcSupportedChains` as a single source of truth and an `rpcHealthProbe` (EVM `eth_chainId` identity check, Cosmos `node_info` liveness). Default behaviour is byte-identical when no override is set.

## 2.15.3

### Patch Changes

- [#708](https://github.com/vultisig/vultisig-sdk/pull/708) [`d4fa237`](https://github.com/vultisig/vultisig-sdk/commit/d4fa23796053f1a15fcce8b1fad5e9ccbbfbeb3d) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Mark unknown EVM and Cosmos transaction hashes as `isKnown: false` so broadcast verification rethrows real broadcast failures instead of treating unindexed hashes as known pending transactions.

## 2.15.2

### Patch Changes

- [#716](https://github.com/vultisig/vultisig-sdk/pull/716) [`3f622f6`](https://github.com/vultisig/vultisig-sdk/commit/3f622f631089d0e33eb879be3407401887ebf0c8) Thanks [@realpaaao](https://github.com/realpaaao)! - Add a canonical ZIP-317 conventional-fee module to core-chain and floor the Zcash send-builder fee at 5,000 zats per logical action, so low fee rates can no longer produce transactions the network rejects with "tx unpaid action limit exceeded".

## 2.15.1

### Patch Changes

- [#709](https://github.com/vultisig/vultisig-sdk/pull/709) [`de621f3`](https://github.com/vultisig/vultisig-sdk/commit/de621f3fd2a8c1ca64e73f6fe64afb7d77fb3e43) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Resolve Cosmos fee amounts from live node min gas prices when available, keeping the existing static amounts as safe floors.

- [#712](https://github.com/vultisig/vultisig-sdk/pull/712) [`9439a61`](https://github.com/vultisig/vultisig-sdk/commit/9439a6194abf3533ad06aa84847c81b2af7fe8df) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Filter Blockchair UTXO selection to confirmed spendable outputs and request an explicit address-info UTXO limit.

- [#714](https://github.com/vultisig/vultisig-sdk/pull/714) [`625fb42`](https://github.com/vultisig/vultisig-sdk/commit/625fb4205f265587f66f447b4059543756ef1095) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Fetch the live Zcash ZIP-243 consensus branch ID for SDK signing and fail loudly instead of using a stale compiled fallback.

## 2.15.0

### Minor Changes

- [#686](https://github.com/vultisig/vultisig-sdk/pull/686) [`b900fcf`](https://github.com/vultisig/vultisig-sdk/commit/b900fcf95709da28ea7add1ea144d126c9fbcd98) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - Add QBTC support to the Cosmos staking signing path and LCD query layer. QBTC
  is a Cosmos-SDK chain (post-quantum testnet, ML-DSA-signed) but lives in
  `OtherChain`, so it sat outside the staking helpers' typing and LCD root
  resolution.

  - `QBTCHelper.buildTxComponents` now consumes a `signData.signDirect` payload
    verbatim — the `bodyBytes` / `authInfoBytes` already carry the ML-DSA pubkey
    `Any`, gas and fee, so the initiator and every co-signing peer rebuild an
    identical SignDoc hash. Previously it always rebuilt the body from
    `transactionType` (MsgSend / IBC / Vote), which silently turned a staking
    SignDoc into a `MsgSend`. `signAmino` is rejected (ML-DSA is
    SIGN_MODE_DIRECT only). The normal send path (no `signData`) is unchanged.
  - `chains/cosmos/staking/lcdQueries` exports a widened
    `StakingChain = IbcEnabledCosmosChain | Chain.QBTC` and resolves the LCD root
    through a helper that routes QBTC to `qbtcRestUrl` and every other staking
    chain to `cosmosRpcUrl[chain]`.

  Backward compatible: existing IBC-enabled staking chains route exactly as
  before.

## 2.14.1

### Patch Changes

- [#683](https://github.com/vultisig/vultisig-sdk/pull/683) [`4561129`](https://github.com/vultisig/vultisig-sdk/commit/45611297a55da72d3c56b1a2ffe6522da1b64d7b) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Update SDK package dependencies and Yarn tooling.

## 2.14.0

### Minor Changes

- [#676](https://github.com/vultisig/vultisig-sdk/pull/676) [`7572dc0`](https://github.com/vultisig/vultisig-sdk/commit/7572dc0e7fa785453e36a419d678f8a1bf17c8b5) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Add THORChain limit swap memo builder, validation helpers, and JSON test vectors.

## 2.13.0

### Minor Changes

- [#672](https://github.com/vultisig/vultisig-sdk/pull/672) [`7fa4860`](https://github.com/vultisig/vultisig-sdk/commit/7fa48602ba1acfb57746fd22c87ec3aa30bac4a6) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - Add Blockaid Sui transaction simulation support. The existing Sui Blockaid
  scan resolver only requested `validation`; this exposes the simulation block
  returned by the same `/sui/transaction/scan` endpoint via a new
  `getSuiTxBlockaidSimulation` resolver and a `parseBlockaidSuiSimulation`
  parser that produces a UI-facing `{ swap } | { transfer }` headline
  (mirroring the Solana shape). `OtherChain.Sui` is now a member of
  `blockaidSimulationSupportedChains`, with a new `getTxBlockaidSimulation`
  overload, and the mpc package gains a matching
  `getSuiBlockaidTxSimulationInput` for the `KeysignPayload`-driven flow.

  The parser keeps `null` as its failure mode rather than throwing — Blockaid
  field renames degrade to "no preview" instead of breaking consumers.

  Closes [#671](https://github.com/vultisig/vultisig-sdk/issues/671)

## 2.12.0

### Minor Changes

- [#651](https://github.com/vultisig/vultisig-sdk/pull/651) [`e9c4997`](https://github.com/vultisig/vultisig-sdk/commit/e9c4997bae3a499785295b76dbc956807cc704f5) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - Add Sui dApp signing helpers to `@vultisig/core-chain/chains/sui`. Two new
  public modules:
  - `./chains/sui/sign` exports `suiTransactionDataIntent` /
    `suiPersonalMessageIntent` (defensive clones of the 3-byte intent
    prefixes), `getSuiTransactionDataDigest(txBytes)` and
    `getSuiPersonalMessageDigest(messageBytes)` for the intent-prefixed
    blake2b-256 digests the wallet's Ed25519 signer signs, and
    `buildSuiSerializedSignature({ signature, publicKey })` for the 97-byte
    `flag(1) || sig(64) || pubkey(32)` Wallet Standard wire signature.
  - `./chains/sui/buildTransactionFromJson` exports
    `buildSuiTransactionFromJson({ transactionJson, sender })` which hydrates
    a serialized Sui `Transaction` (V1 or V2 JSON) and resolves it to BCS
    bytes via `Transaction.build({ client: getSuiClient() })`. Lets
    extension callers move the build step off the dApp page (where the dApp
    page's Content Security Policy blocks the Sui RPC) and into the
    extension's own context.

## 2.11.0

### Minor Changes

- [#649](https://github.com/vultisig/vultisig-sdk/pull/649) [`9271864`](https://github.com/vultisig/vultisig-sdk/commit/9271864c7cf1030b613f52b5564fc04d9309f069) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - Add custom token support for SUI. SUI is now included in
  `chainsWithTokenMetadataDiscovery`, and a new resolver fetches coin metadata
  (ticker, decimals, logo) from the SUI RPC via `suix_getCoinMetadata`. A new
  `isValidTokenId` helper validates token identifiers per chain — SUI tokens are
  validated as Move struct tags (e.g. `0x2::sui::SUI`) while all other chains keep
  delegating to `isValidAddress`.

## 2.10.2

### Patch Changes

- [#647](https://github.com/vultisig/vultisig-sdk/pull/647) [`55ed503`](https://github.com/vultisig/vultisig-sdk/commit/55ed503e103bdf8884c7ca7a8050742fb87d9e1f) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Enable WalletCore ZIP-317 fee planning for Zcash UTXO signing inputs.

## 2.10.1

### Patch Changes

- [#617](https://github.com/vultisig/vultisig-sdk/pull/617) [`7145713`](https://github.com/vultisig/vultisig-sdk/commit/7145713992199f084d826f160cc20a4c445b14fb) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Select swap quotes with a 1% provider preference band instead of hard native priority.

## 2.10.0

### Minor Changes

- [#618](https://github.com/vultisig/vultisig-sdk/pull/618) [`ddf0bf4`](https://github.com/vultisig/vultisig-sdk/commit/ddf0bf44cc38905370f60246b88503954b3e3418) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - feat(swap/lifi): consumer-supplied LI.FI integrator + apiUrl override

  Adds `SwapAffiliateConfig.lifi: LifiAffiliateConfig` so consumers (e.g. Station via `vultisig/mcp-ts`) can redirect LI.FI affiliate fees to their own portal integrator instead of the SDK-default `vultisig-0`.

  New surface:
  - `LifiAffiliateConfig` type — `{ integratorName: string; apiUrl?: string }`
  - `setupLifi(config?)` — global LI.FI SDK bootstrap; idempotent first-caller-wins. Consumers call this once at module boot to set both the global `integrator` and (optional) `apiUrl` proxy.
  - `getLifiSwapQuote` now accepts an optional `lifiAffiliateConfig` and uses its `integratorName` as the per-call `integrator` in `getQuote(...)`, overriding the global default for THIS quote without mutating the module-level `lifiConfig`.
  - `findSwapQuote` threads `affiliateConfig?.lifi` into `getLifiSwapQuote`.

  No behaviour change for callers that don't supply a `lifi` config — `getLifiSwapQuote` still routes through the existing `vultisig-0` default.

- [#619](https://github.com/vultisig/vultisig-sdk/pull/619) [`c63c713`](https://github.com/vultisig/vultisig-sdk/commit/c63c713de30c847a98d3b73c8ba5b5a882c0699b) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - feat(ton): add jetton master token metadata discovery

  Adds a TON token metadata resolver so pasting a jetton master address (`EQ.../UQ...`) auto-fills ticker, decimals, and logo — same UX as EVM/Solana/Tron custom token discovery.
  - New `getJettonMasterInfo()` helper hits Toncenter v3 `/jetton/masters`, preferring the validated indexer `token_info` entry over on-chain TEP-64 `jetton_content`.
  - Logo selection prefers Toncenter's `imgproxy.toncenter.com` variants (`_image_medium` → `_image_small` → `_image_big`) before the raw `image` URL. Many jetton issuers serve their PNG with `Cross-Origin-Resource-Policy: same-origin`, which browsers refuse to embed cross-origin; the proxied variants load reliably.
  - `OtherChain.Ton` added to `chainsWithTokenMetadataDiscovery`; the new `getTonTokenMetadata` resolver is registered under the `ton` chain kind.

  Unblocks vultisig/vultisig-windows#4029.

## 2.9.0

### Minor Changes

- [#610](https://github.com/vultisig/vultisig-sdk/pull/610) [`c87816b`](https://github.com/vultisig/vultisig-sdk/commit/c87816b6797e8237d7a94923025311e479e0c520) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - fix(swap): proactively detect below-minimum native swaps ([#604](https://github.com/vultisig/vultisig-sdk/issues/604))

  Small cross-chain swaps below the economic minimum (e.g. ETH→BTC ~$2.81) no longer surface a misleading generic "No swap route found" error. `findSwapQuote` now computes the THORChain minimum up front from the destination chain's `outbound_fee` and spot pool prices, and surfaces an actionable `AmountBelowMinimum` error with the concrete threshold ("Minimum is ~0.012 ETH. Please increase the amount.") instead of relying on brittle provider error-string matching.
  - New exported helper `getNativeSwapMinAmountIn` (and `NATIVE_SWAP_MIN_OUTBOUND_FEE_MULTIPLIER`) so consumers can show the minimum proactively as the user types.
  - The computed minimum is now `max(outbound-fee minimum, source dust threshold)` — THORChain rejects an input below the source chain's `dust_threshold` ("amount less than dust threshold") before economics apply (e.g. DOGE's ~1 DOGE floor), so the threshold is included alongside the outbound-fee economics. The result exposes `dustThresholdBaseUnit` and `binding: 'outbound' | 'dust'` for diagnostics.
  - Eager short-circuit only when a native protocol is the sole route family; multi-provider pairs still query every provider so an aggregator with a lower minimum is never blocked.
  - The generic all-fail path now logs raw provider error messages so future sub-minimum wordings become data-driven instead of guessed.
  - Trading-halt detection: when a native protocol rejects with "trading is halted" (THORChain mimir `HALT<CHAIN>TRADING`, pool ragnarok, churn) the pair fails for _every_ amount, so a new `TradingHalted` error surfaces "This swap route is temporarily unavailable — trading is halted on …" instead of the misleading generic "No swap route found" / "increase the amount".

## 2.8.0

### Minor Changes

- [#611](https://github.com/vultisig/vultisig-sdk/pull/611) [`9e405c9`](https://github.com/vultisig/vultisig-sdk/commit/9e405c9459713c5391ca6a85a548eb3750ec2872) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - ## New
  - Osmosis added to `AUTO_DISCOVERY_CHAINS` — IBC balance discovery is now active for Osmosis ([#611](https://github.com/vultisig/vultisig-sdk/issues/611))
  - Osmosis IBC token registry: ATOM (channel-0), USDC/Noble (channel-750), axlUSDC/Axelar (channel-208), stATOM (channel-326), stOSMO (channel-326), TIA/Celestia (channel-6994) — all hashes LCD-verified against osmosis-rest.publicnode.com and cross-referenced with cosmos/chain-registry ([#611](https://github.com/vultisig/vultisig-sdk/issues/611))

## 2.7.0

### Minor Changes

- [#585](https://github.com/vultisig/vultisig-sdk/pull/585) [`1bf8a6d`](https://github.com/vultisig/vultisig-sdk/commit/1bf8a6d36788b702092d92918294d67cdc6e11b7) Thanks [@NeOMakinG](https://github.com/NeOMakinG)! - Add `getSwapExplorerUrl` helper for swap-provider tx links ([#426](https://github.com/vultisig/vultisig-sdk/issues/426)).

  Tx history surfaces (vultisig-windows, vultiagent-app, future RN SDK) now have a single source of truth for "View on Explorer" URLs that point to the swap **provider's** scanner — `scan.li.fi`, `orb.helius.dev` for LI.FI Solana settlement, `runescan.io` for THORChain, and the MayaChain explorer — instead of every consumer reimplementing the routing and most defaulting to the source-chain explorer (which hides cross-chain routes from users).
  - New: `getSwapExplorerUrl({ provider, txHash, fromChain })` in `@vultisig/core-chain/swap/utils/getSwapExplorerUrl`
  - New: `Vultisig.getSwapExplorerUrl(provider, txHash, fromChain)` static method for parity with `getTxExplorerUrl`
  - For `1inch` / `kyber` / `swapkit`, falls back to the source-chain explorer (no public per-tx aggregator page)
  - Mirrors iOS `ExplorerLinkBuilder.swift` and Android `ExplorerLinkRepository.getSwapProgressLink`
  - Pure URL builder, no new deps

### Patch Changes

- [#600](https://github.com/vultisig/vultisig-sdk/pull/600) [`d1c12b2`](https://github.com/vultisig/vultisig-sdk/commit/d1c12b24bc55a318a8f87998d2320651f875b00a) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - fix(swap/swapkit): reclassify noRoutesFound as "amount too small" when the pair is structurally supported - cross-checks the cached /providers snapshot so low-amount swaps (e.g. BCH->ETH) surface an actionable message instead of a misleading "no route" error

## 2.6.0

### Minor Changes

- [#584](https://github.com/vultisig/vultisig-sdk/pull/584) [`a13c644`](https://github.com/vultisig/vultisig-sdk/commit/a13c644be796a7bf10dc0ab426ac888b9e962585) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - feat(cowswap): add CowSwap RFQ as swap provider for same-chain EVM trades (phase 1 sdk scaffold)

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

- [#584](https://github.com/vultisig/vultisig-sdk/pull/584) [`a13c644`](https://github.com/vultisig/vultisig-sdk/commit/a13c644be796a7bf10dc0ab426ac888b9e962585) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - ## New
  - Polkadot Asset Hub USDT (asset_id 1984) + USDC (asset_id 1337) token registry ([#562](https://github.com/vultisig/vultisig-sdk/issues/562))
  - Polkadot `pallet_assets.Account` balance resolver for Asset Hub tokens - replaces placeholder 0n guard ([#563](https://github.com/vultisig/vultisig-sdk/issues/563))
  - Tron native send `data` field (proto field 12) for THORChain memos + exchange deposit memos; `BuildTronSendOptions` and `BuildTrc20TransferOptions` gain optional `data?: Uint8Array` field ([#559](https://github.com/vultisig/vultisig-sdk/issues/559))

  ## Fixed
  - Tron TRC-20 fee estimate now subtracts sender's available energy before charging TRX ([#556](https://github.com/vultisig/vultisig-sdk/issues/556))
  - Tron native send free bandwidth check prevents spurious fee charge when bandwidth is available ([#555](https://github.com/vultisig/vultisig-sdk/issues/555))

### Patch Changes

- [#602](https://github.com/vultisig/vultisig-sdk/pull/602) [`5bb56a4`](https://github.com/vultisig/vultisig-sdk/commit/5bb56a4daba8b896626c54fabd94fd6c9a35320e) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - `getCosmosAccountInfo` now retries against a registered fallback LCD when the primary endpoint fails. Without this, a single-provider degradation (e.g. `terra-classic-lcd.publicnode.com` outage on 2026-05-28) hard-failed every cosmos signing surface that touches this code path — there was no recovery.

  Fallback URLs per chain (Polkachu mirrors where available; Hexxagon for `TerraClassic` since polkachu has no Terra Classic endpoint, verified 2026-05-28). Chains not in the map preserve fail-closed behaviour.

  Parallel to vultiagent-app#1017 (app-side fix) + mcp-ts#266 (mcp-side fix).

- [#592](https://github.com/vultisig/vultisig-sdk/pull/592) [`c4b4560`](https://github.com/vultisig/vultisig-sdk/commit/c4b45604f043700068aaf1c3c1a1ecad5c8a874f) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - lifi: tighten slippage to 0.3% for stablecoin pairs (USDC/USDT/DAI/...), keep 1% for volatile pairs

- [#596](https://github.com/vultisig/vultisig-sdk/pull/596) [`880cde0`](https://github.com/vultisig/vultisig-sdk/commit/880cde00a5978e8a4dff2cf8adb627059e4af5bf) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - Remove i18next dependency from `getNativeSwapQuote` — the lone `t()` call was the only i18next usage in the entire chain package, and consuming apps that don't initialize i18next (or initialize it without a Backend plugin) crash with `Cannot read property 'reload' of undefined` whenever code touches the SDK swap path. Replaced with a plain English fallback string. Drops i18next from `dependencies`.

- [#593](https://github.com/vultisig/vultisig-sdk/pull/593) [`5d11cf3`](https://github.com/vultisig/vultisig-sdk/commit/5d11cf3bfb81aba929fe8e81bb77e7aebff15129) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - refactor(swap): typed SwapError class with stable codes at findSwapQuote throw sites - enables instanceof checks instead of message string matching

## 2.5.0

### Minor Changes

- [#587](https://github.com/vultisig/vultisig-sdk/pull/587) [`8932aff`](https://github.com/vultisig/vultisig-sdk/commit/8932afffbdd57112b9b8e59ac2e909e1654f54a3) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - ## Added
  - `resolveTokenPriceId(chain, denomOrAddress?)` helper in `@vultisig/core-chain/coin/price/resolveTokenPriceId` - pure synchronous lookup against the SDK's curated registry (`chainFeeCoin` + `knownTokensIndex`) that returns a CoinGecko priceProviderId for a chain's native coin or a known token by address/denom. Returns `undefined` when no registry entry exists so callers can fall back to other resolution paths. Phase 1 of registry-driven cross-chain price resolution (refs vultisig/mcp-ts#255).

### Patch Changes

- [#591](https://github.com/vultisig/vultisig-sdk/pull/591) [`88cd323`](https://github.com/vultisig/vultisig-sdk/commit/88cd3235ea463112d378d5e5a2c32aacabe08ab0) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - add 30s per-fetcher timeout guard to findSwapQuote — a hanging provider no longer stalls the whole allSettled fan-out

## 2.4.1

### Patch Changes

- [#582](https://github.com/vultisig/vultisig-sdk/pull/582) [`47860fc`](https://github.com/vultisig/vultisig-sdk/commit/47860fcc6a1fa3600c20b529d29af98d56cbc5b4) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - ## Changed
  - Lower THORChain streaming-quote trigger threshold from 300 bps (3%) to 100 bps (1%) - more mid-size cross-chain trades now compare a streaming quote against the rapid quote and pick the better expected_amount_out. ([#470](https://github.com/vultisig/vultisig-sdk/issues/470))

## 2.4.0

### Minor Changes

- [#583](https://github.com/vultisig/vultisig-sdk/pull/583) [`f2270cd`](https://github.com/vultisig/vultisig-sdk/commit/f2270cd6aaa741d6800bd2d21e9775092be25d31) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - ## New
  - Polkadot Asset Hub USDT (asset_id 1984) + USDC (asset_id 1337) token registry ([#562](https://github.com/vultisig/vultisig-sdk/issues/562))
  - Polkadot `pallet_assets.Account` balance resolver for Asset Hub tokens - replaces placeholder 0n guard ([#563](https://github.com/vultisig/vultisig-sdk/issues/563))
  - Tron native send `data` field (proto field 12) for THORChain memos + exchange deposit memos; `BuildTronSendOptions` and `BuildTrc20TransferOptions` gain optional `data?: Uint8Array` field ([#559](https://github.com/vultisig/vultisig-sdk/issues/559))

  ## Fixed
  - Tron TRC-20 fee estimate now subtracts sender's available energy before charging TRX ([#556](https://github.com/vultisig/vultisig-sdk/issues/556))
  - Tron native send free bandwidth check prevents spurious fee charge when bandwidth is available ([#555](https://github.com/vultisig/vultisig-sdk/issues/555))

## 2.3.2

### Patch Changes

- [#588](https://github.com/vultisig/vultisig-sdk/pull/588) [`256f67d`](https://github.com/vultisig/vultisig-sdk/commit/256f67da13a6d96f34c83c9b56c1cfb574cd8fd1) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Enable pre-built SwapKit Bitcoin PSBT transactions, verify their destination outputs, and route payloads through the SignBitcoin hashing and compilation path.

## 2.3.1

### Patch Changes

- [#579](https://github.com/vultisig/vultisig-sdk/pull/579) [`c3881e5`](https://github.com/vultisig/vultisig-sdk/commit/c3881e549e5678e8806eba5defb2d2d6eefc2cc5) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - ## Fixed
  - Cosmos account info LCD fallback for extended account types that StargateClient cannot decode (vesting wrappers, module accounts) — prevents doomed txs with `sequence:0` that fail at broadcast with `account sequence mismatch, expected N, got 0` ([#579](https://github.com/vultisig/vultisig-sdk/issues/579))
  - Cosmos coin balance LCD fallback when StargateClient returns `amount:"0"` on a funded address — fixes a packaging-level discrepancy in cosmjs's HTTP layer under Hermes/React Native that silently surfaced as "you have 0" on funded Terra/TerraClassic wallets ([#579](https://github.com/vultisig/vultisig-sdk/issues/579))

## 2.3.0

### Minor Changes

- [#577](https://github.com/vultisig/vultisig-sdk/pull/577) [`cc9d67f`](https://github.com/vultisig/vultisig-sdk/commit/cc9d67f0c61d9ebdfc133beac5ef04658d37a37f) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - ## New
  - Polkadot Asset Hub USDT (asset_id 1984) + USDC (asset_id 1337) token registry ([#562](https://github.com/vultisig/vultisig-sdk/issues/562))
  - Polkadot `pallet_assets.Account` balance resolver for Asset Hub tokens - replaces placeholder 0n guard ([#563](https://github.com/vultisig/vultisig-sdk/issues/563))
  - Tron native send `data` field (proto field 12) for THORChain memos + exchange deposit memos; `BuildTronSendOptions` and `BuildTrc20TransferOptions` gain optional `data?: Uint8Array` field ([#559](https://github.com/vultisig/vultisig-sdk/issues/559))

  ## Fixed
  - Tron TRC-20 fee estimate now subtracts sender's available energy before charging TRX ([#556](https://github.com/vultisig/vultisig-sdk/issues/556))
  - Tron native send free bandwidth check prevents spurious fee charge when bandwidth is available ([#555](https://github.com/vultisig/vultisig-sdk/issues/555))

## 2.2.5

### Patch Changes

- [#554](https://github.com/vultisig/vultisig-sdk/pull/554) [`bf7278c`](https://github.com/vultisig/vultisig-sdk/commit/bf7278c5886789c4a181169a36bc9296ef81b79c) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Emit the dedicated commondata SwapKit swap payload for source-chain transfer routes so QR cosigners can distinguish SwapKit swaps from OneInch-compatible swap payloads.

## 2.2.4

### Patch Changes

- [#512](https://github.com/vultisig/vultisig-sdk/pull/512) [`72eb200`](https://github.com/vultisig/vultisig-sdk/commit/72eb200ec647a707d1ebdc1f8b6f0f5243780477) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Add Station Terra import primitives for legacy seed-byte, mnemonic, and raw private-key migration flows.

## 2.2.3

### Patch Changes

- [#519](https://github.com/vultisig/vultisig-sdk/pull/519) [`4c9454e`](https://github.com/vultisig/vultisig-sdk/commit/4c9454eca99f43a2ce572732c3d6fcc74c99e89e) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - fix(swap/lifi/solana): inject createAssociatedTokenAccountInstruction when SPL-token destination ATA is missing

  SOL -> SPL-token swaps via Li.Fi failed simulation with `custom program error: 0x17` when the destination wallet had no Associated Token Account for the output mint (e.g. first-time USDC recipient). LiFi's transaction blob does not include the ATA creation instruction in that case.

  This adds a pre-flight RPC check: if the destination ATA is missing, a `createAssociatedTokenAccountIdempotentInstruction` is prepended to the transaction before the quote data is returned. The idempotent variant is safe even if the ATA is created between quote-time and broadcast-time.

  Also defaults LiFi slippage tolerance to 1% (up from LiFi's default 0.5%) for RN consumers to account for MPC keysign latency (30-90s between quote and broadcast).

## 2.2.2

### Patch Changes

- [#537](https://github.com/vultisig/vultisig-sdk/pull/537) [`fa95600`](https://github.com/vultisig/vultisig-sdk/commit/fa95600887cb8ca603e8ddcb9c8558eff2d0ea6b) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - chore: remove Station affiliate constants from shared SDK (closes [#536](https://github.com/vultisig/vultisig-sdk/issues/536))

  Station-specific constants (`stvs` THORName, `0x649E...076D` EVM fee receiver) do not belong in a public package consumed by Windows and external users. The generic `affiliateConfig` injection seam on `findSwapQuote` + `SwapAffiliateConfig` type remain — those are correct SDK design. Station reconstructs the same three configs in its own consumer package (mcp-ts#201).

  **BREAKING CHANGE:** `stationKyberSwapAffiliateConfig`, `stationNativeSwapAffiliateConfig`, and `stationOneInchAffiliateConfig` are no longer exported from `@vultisig/sdk`. See MIGRATING.md for the reconstruction pattern.

  > **WARNING: DO NOT MERGE until vultisig/mcp-ts#201 lands.** Station must reconstruct these constants in its consumer package before this removal ships. Merging early will silently fall back to vultisig-0 affiliate defaults, breaking Station's affiliate fee routing on native swaps.

## 2.2.1

### Patch Changes

- [#525](https://github.com/vultisig/vultisig-sdk/pull/525) [`b0d0ba9`](https://github.com/vultisig/vultisig-sdk/commit/b0d0ba9d3ff0226149aca9a7446ff07a9eba84fc) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Enable SwapKit source routes for BTC, BCH, DOGE, LTC, XRP, ZEC, TRON, and TON by signing non-EVM SwapKit routes as source-chain transfers.

## 2.2.0

### Minor Changes

- [#507](https://github.com/vultisig/vultisig-sdk/pull/507) [`cb80440`](https://github.com/vultisig/vultisig-sdk/commit/cb804408b9607aacb143a7a941f0f9f1986f2379) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Add SwapKit as a configurable general swap provider for EVM and Solana source routes.

## 2.1.0

### Minor Changes

- [#483](https://github.com/vultisig/vultisig-sdk/pull/483) [`7b384c8`](https://github.com/vultisig/vultisig-sdk/commit/7b384c89cb0fd82e76161feee78eccbc2c4401eb) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - cosmos/staking: add `getCosmosValidators` and `getCosmosValidator` LCD query helpers, plus their URL builders (`getValidatorsUrl`, `getValidatorUrl`) and typed response models (`Validator`, `ValidatorStatus`, `ValidatorDescription`, `ValidatorCommission`).

  `getCosmosValidators` auto-paginates the staking module's validator set with an optional `status` filter (typically `BOND_STATUS_BONDED` for staking-picker UIs) and a 50-page runaway cap. `getCosmosValidator` resolves a single valoper. Both work across every `IbcEnabledCosmosChain` — same paths, same response shape — and accept an optional `fetchImpl` / `signal` for testing and abortability.

  These complete the staking-module read surface: callers can now list validators, list a delegator's delegations / unbondings / rewards, and resolve any individual valoper, all without a Stargate dependency.

  cosmos/gas: add `getCosmosStakingGasLimit({ chain, msgCount })` alongside the existing `getCosmosGasLimit`. The defaults in `getCosmosGasLimit` are calibrated for `bank.MsgSend` / `ibc.MsgTransfer` and run out of gas mid-execution for native staking msgs — most visibly on TerraClassic, where an empirically observed `MsgDelegate` burned 400_659 gas against the 400_000 default. The new helper exposes per-chain limits sized for `MsgDelegate` / `MsgUndelegate` / `MsgBeginRedelegate` / `MsgWithdrawDelegatorReward` and scales by `msgCount` for bulk-claim multi-msg txs.

- [#499](https://github.com/vultisig/vultisig-sdk/pull/499) [`585c177`](https://github.com/vultisig/vultisig-sdk/commit/585c177d4de4960a764f2528aa48aebc42450f7d) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - qbtc: `generateClaimProof` now accepts an optional `broadcast: boolean` input. When set, the proof service signs and broadcasts the resulting `MsgClaimWithProof` itself (via its pre-funded broadcaster account) and returns `tx_hash` in the response. Intended for first-time claimers whose own bech32 address doesn't exist on-chain yet, so they can't produce a SignDoc the chain will accept. Server-side broadcasting is wired up in [btcq-org/qbtc#158](https://github.com/btcq-org/qbtc/pull/158).

### Patch Changes

- [#498](https://github.com/vultisig/vultisig-sdk/pull/498) [`1667b79`](https://github.com/vultisig/vultisig-sdk/commit/1667b79fbc754e36032942fb5e749706dfc09bf3) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Enable Cosmos bank-balance token discovery for Terra and Terra Classic, including denom metadata decimals, IBC denom trace fallback, and hidden unknown denom metadata.

## 2.0.0

### Major Changes

- [#478](https://github.com/vultisig/vultisig-sdk/pull/478) [`2174118`](https://github.com/vultisig/vultisig-sdk/commit/2174118523eacfb97e04ecfa8de96f22059afe99) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - qbtc: add required `broadcaster` field to `BuildMsgClaimWithProofInput` (proto field 9). Mirrors the chain-side signer rework in btcq-org/qbtc#171 - `claimer` is now payload-only (mint destination), while `broadcaster` is the cosmos tx signer. Callers must populate `broadcaster` (typically equal to `claimer` for wallet flows where the user's own MLDSA key signs the tx).

  BREAKING CHANGE: `BuildMsgClaimWithProofInput` now requires a new `broadcaster: string` field. Existing callers will fail at TypeScript compile-time (or runtime if TS is bypassed) until updated. For wallet flows pass `broadcaster === claimer`.

### Patch Changes

- [#467](https://github.com/vultisig/vultisig-sdk/pull/467) [`2d85653`](https://github.com/vultisig/vultisig-sdk/commit/2d85653c23379bc39bb579acf83d7998070b9ed4) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Discover non-zero EVM tokens even when OneInch metadata lacks a logo or CoinGecko provider, with on-chain metadata fallback when token metadata is missing.

- [#474](https://github.com/vultisig/vultisig-sdk/pull/474) [`37c2f82`](https://github.com/vultisig/vultisig-sdk/commit/37c2f82379725ac4ac4d63679afea5c3ac1b7683) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Refresh vulnerable dependency paths for high-severity audit cleanup.

## 1.7.1

### Patch Changes

- [#455](https://github.com/vultisig/vultisig-sdk/pull/455) [`5102976`](https://github.com/vultisig/vultisig-sdk/commit/5102976d7c13fa9578bbbc6e5122526cefc1ec66) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Normalize THORChain/MayaChain native swap asset ids: single-segment denoms and simple `x/…` paths map to `THOR.<ticker>` / `MAYA.<ticker>`; secured `chain-symbol-0x…` denoms map to `CHAIN.SYMBOL` notation using the canonical `nativeSwapChainIds` mapping. Full `CHAIN.SYMBOL` strings and unrecognized complex denoms remain unchanged.

- [#456](https://github.com/vultisig/vultisig-sdk/pull/456) [`b36eb62`](https://github.com/vultisig/vultisig-sdk/commit/b36eb62842051b8b2bae06f1e123a5ebcf6cad88) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Add Terra CW20 metadata resolution and build CW20 token sends as CosmWasm execute transfers.

## 1.7.0

### Minor Changes

- [#441](https://github.com/vultisig/vultisig-sdk/pull/441) [`e3dc2e8`](https://github.com/vultisig/vultisig-sdk/commit/e3dc2e828b3e4f95b293d4493bddbc176bbb3bb7) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - feat(chain/evm): static known-contract label registry for offline transaction-intent display

  Adds `chains/evm/contract/knownContracts.ts` mapping well-known EVM contract addresses (Uniswap V2/V3 routers, 1inch V5/V6, Permit2, THORChain Router, Aave V3 Pool) to human-readable labels and categories. Complements `commonSelectors.ts`: that table labels what function is being called, this one labels who is being called (and lets UIs label spender-style address arguments). Lookup is offline, case-insensitive, and optionally chain-scoped.

## 1.6.1

### Patch Changes

- [#431](https://github.com/vultisig/vultisig-sdk/pull/431) [`1132ae5`](https://github.com/vultisig/vultisig-sdk/commit/1132ae51f8e4d5b8ca8a1855af9ea51031b574e9) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - fix cosmos denom resolver picking wrong segment for 3-part factory denoms

## 1.6.0

### Minor Changes

- [#423](https://github.com/vultisig/vultisig-sdk/pull/423) [`613004f`](https://github.com/vultisig/vultisig-sdk/commit/613004f5fbce2658a439296ca249d3e031a58078) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - Add a static lookup table of common EVM function selectors (`chains/evm/contract/commonSelectors.ts`) with human-readable action labels, and consult it as an offline fast-path in `getEvmContractCallInfo` before falling back to the 4byte API. Covers ERC-20 approvals/transfers/permit, Uniswap V2 / V3 / Universal Router swaps, ERC-721/1155 approvals and transfers, WETH wrap/unwrap, Synthetix-style staking, multicall, THORChain Router cross-chain swaps, and Aave V3 supply/withdraw. Resolved entries expose an optional `actionLabel` (e.g. "Token Approval", "Token Swap", "Cross-Chain Swap", "Lending Supply", "NFT Transfer") on the returned info.

### Patch Changes

- [#427](https://github.com/vultisig/vultisig-sdk/pull/427) [`6b75472`](https://github.com/vultisig/vultisig-sdk/commit/6b7547288f8594fcf8a9c71e46a5163d6b6cd727) Thanks [@realpaaao](https://github.com/realpaaao)! - Preserve known THORChain single-segment denoms such as `tcy` during Cosmos coin discovery, let Solana standard RPC relay retry for its normal validity window, and keep Solana broadcast verification from treating unknown signatures as confirmed pending transactions.

- [#418](https://github.com/vultisig/vultisig-sdk/pull/418) [`2e1bfb8`](https://github.com/vultisig/vultisig-sdk/commit/2e1bfb85417787a7cc5d497d35f6e76d2bb5a41a) Thanks [@premiumjibles](https://github.com/premiumjibles)! - Report all attempted swap quote provider failures with short provider-attributed messages.

## 1.5.3

### Patch Changes

- [#416](https://github.com/vultisig/vultisig-sdk/pull/416) [`198f2af`](https://github.com/vultisig/vultisig-sdk/commit/198f2af1ae22bd379d7eff0c1c428a0ce1043229) Thanks [@realpaaao](https://github.com/realpaaao)! - Relay Solana transactions through standard RPC after JITO acceptance to avoid treating JITO-only acceptance as durable broadcast.

## 1.5.2

### Patch Changes

- [#356](https://github.com/vultisig/vultisig-sdk/pull/356) [`b97da23`](https://github.com/vultisig/vultisig-sdk/commit/b97da233b3fdaeeb75e3a0c986d7fd15e0d743e4) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Rank swap quotes by comparable destination-token amount across eligible providers instead of using the first successful provider. Native THORChain/Maya quotes are re-based from swap API precision (`getNativeSwapDecimals`) to the destination coin decimals before comparison with aggregator `dstAmount`.

- [#383](https://github.com/vultisig/vultisig-sdk/pull/383) [`745172f`](https://github.com/vultisig/vultisig-sdk/commit/745172f3ee511bc4e95914986bfbdb8acf794b1e) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - Migrate THORChain Midgard, THORNode REST, and Tendermint RPC endpoints from the legacy `*.thorchain.network` hosts to the Liquify gateway (`gateway.liquify.com/chain/thorchain_midgard`, `…/thorchain_api`, `…/thorchain_rpc`). Updated `cosmosRpcUrl.THORChain`, `tendermintRpcUrl.THORChain`, `thorchainMidgardBaseUrl`, and the rujira `MAINNET_CONFIG` endpoints accordingly.

  In `RujiraDiscovery.discoverViaChain()`, replaced the brittle `rpc → thornode` string substitution with a direct read of `MAINNET_CONFIG.restEndpoint`. Under the new gateway routing the substitution silently produced an invalid host (`thorchain_thornode`) and the fallback branch was unreachable. Removed the now-unused `rpcEndpoint` option from `DiscoveryOptions` and the related discovery-specific plumbing in `RujiraClient`.

## 1.5.1

### Patch Changes

- [#319](https://github.com/vultisig/vultisig-sdk/pull/319) [`03007d7`](https://github.com/vultisig/vultisig-sdk/commit/03007d7293b2f51f6269d39bf3725715182f933e) Thanks [@rcoderdev](https://github.com/rcoderdev)! - fix(chain): THORChain native swap `streaming_interval` 0 (Rapid Swaps)

  THORChain can serve swaps in a single block and auto-stream when needed.
  Using `1` forced streaming; `0` lets the protocol choose. MayaChain
  unchanged (`3`).

  Refs: https://github.com/vultisig/vultisig-windows/issues/3613

## 1.5.0

### Minor Changes

- [#320](https://github.com/vultisig/vultisig-sdk/pull/320) [`c33d1f0`](https://github.com/vultisig/vultisig-sdk/commit/c33d1f02b6740ef1c7db16cdc1f7290ec7b2f1f5) Thanks [@rcoderdev](https://github.com/rcoderdev)! - feat(chain): THORChain rapid quote with streaming fallback above 3% fee bps

  THORChain swap quotes now request rapid (`streaming_interval=0`) first. When `fees.total_bps` exceeds 300, a second streaming quote is fetched (`interval=1`, optional `streaming_quantity` from `max_streaming_quantity`); the better `expected_amount_out` wins, with silent fallback to rapid on errors. `THORCHAIN_STREAMING_SLIPPAGE_THRESHOLD_BPS` disables the extra fetch when set to `Number.MAX_SAFE_INTEGER`. Keysign payload reads THOR streaming fields from the quote memo so they match the selected route.

### Patch Changes

- Updated dependencies [[`a52980c`](https://github.com/vultisig/vultisig-sdk/commit/a52980c490633da7d7ae36128bc491f8ca3ff565)]:
  - @vultisig/lib-utils@0.10.1

## 1.4.3

### Patch Changes

- [#360](https://github.com/vultisig/vultisig-sdk/pull/360) [`e52914b`](https://github.com/vultisig/vultisig-sdk/commit/e52914ba87f2d740847fc0de3a49827b0da3e0ba) Thanks [@NeOMakinG](https://github.com/NeOMakinG)! - `@vultisig/core-chain`: lift the qbtc protobuf wire-format helpers to a shared `chains/cosmos/protoEncoding` module (extending it with lower-level `varintBig` / `protoField` primitives that don't apply proto3 default-elision, alongside the existing default-eliding `protoVarint` / `protoBytes` / `protoString`), and add `chains/cosmos/terraClassicTax` with LCD fetchers (`getTerraClassicTaxRate`, `getTerraClassicTaxCap`) plus the pure `applyTerraClassicTax` helper for the cosmos-sdk Dec-fixed-point math. Tax rate is `0` on the live chain today (governance-paused) but the helpers are ready for callers that need to be correct when it reactivates. The previous `qbtc/protoEncoding` package export is replaced by `cosmos/protoEncoding`; the qbtc consumers were updated in lockstep, no behavior change.

## 1.4.2

### Patch Changes

- Updated dependencies [[`a3a331a`](https://github.com/vultisig/vultisig-sdk/commit/a3a331a875ebc6868b11c6901c8ed99dde51a4ff)]:
  - @vultisig/lib-utils@0.10.0

## 1.4.1

### Patch Changes

- [#342](https://github.com/vultisig/vultisig-sdk/pull/342) [`77410fb`](https://github.com/vultisig/vultisig-sdk/commit/77410fb28f53dd558f05e5634aadba6a9547ee0f) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - fix(security/blockaid): pair swap diffs across all asset diffs in EVM simulations

  `parseBlockaidEvmSimulation` previously destructured only `assetDiffs[0]` and `assetDiffs[1]`. For router-mediated flows like `permitAndCall`, Blockaid returns three diffs with the user's `in` side at `assetDiffs[2]` and an empty intermediate leg at `assetDiffs[1]`, causing the parser to bail and the simulation hero to render nothing. The parser now scans all diffs for the user-side `out` and `in` legs (preferring an in-asset different from the out-asset), matching the iOS `BlockaidSimulationParser` behaviour.

## 1.4.0

### Minor Changes

- [#309](https://github.com/vultisig/vultisig-sdk/pull/309) [`6f1f8b2`](https://github.com/vultisig/vultisig-sdk/commit/6f1f8b2d9a69b8542da776f69fbddba6eb35bd3e) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - feat(chain): Uniswap Universal Router command decoder

  Decodes `execute(bytes commands, bytes[] inputs, uint256 deadline)` calldata into an aggregate swap intent (from token, to token, amount in, amount out min). Exposed at `@vultisig/core-chain/chains/evm/contract/universalRouter/{decode,opcodes,types}`.

  Covers V2 / V3 / V4 swaps (exact-in and exact-out), WRAP_ETH and UNWRAP_WETH framing, split-route aggregation across identical pairs, and the CONTRACT_BALANCE sentinel. Unknown opcodes (Permit2, sweep, transfer) are skipped rather than rejected so the router's usual bundling doesn't drop the whole decode.

  Returns `null` for non-Universal-Router calldata. Native ETH is represented by the zero address — callers should translate to the chain's fee coin when displaying.

### Patch Changes

- [#325](https://github.com/vultisig/vultisig-sdk/pull/325) [`ef2ffbe`](https://github.com/vultisig/vultisig-sdk/commit/ef2ffbecf5f2b3af69172d34f3fda25055f4e112) Thanks [@realpaaao](https://github.com/realpaaao)! - fix(bittensor): drop polkadot dynamic import in balance resolver

  The Bittensor balance resolver dynamically imported `@polkadot/util-crypto`
  just to base58-decode an SS58 address, blake2_128-hash the pubkey, and
  hex-encode it. In browser/extension bundles this dynamic import pulls in
  a chunk that double-bundles BN.js; the second copy throws
  `TypeError: Cannot assign to read only property 'toString' of object '#<o>'`
  during module init, so every TAO balance fetch fails with no useful
  network/console signal — the chain page only renders "Failed to load".

  The resolver now uses the libraries already in `@vultisig/core-chain`'s
  direct dependency set: `@noble/hashes` for `blake2b` and `bytesToHex`, and
  `bs58` for the SS58 base58 decode. No polkadot, no `Buffer`, no dynamic
  imports. Bittensor uses SS58 prefix 42 (1-byte network prefix + 32-byte
  pubkey + 2-byte checksum = 35 bytes); we slice `[1, 33)` to recover the
  pubkey, then build the storage key and call `state_getStorage` exactly
  as before.

  Behaviour for valid SS58 addresses is unchanged. Invalid-length
  addresses now throw a clearer `Invalid SS58 address length` error
  instead of a polkadot decoding error.

- [#302](https://github.com/vultisig/vultisig-sdk/pull/302) [`d9399c7`](https://github.com/vultisig/vultisig-sdk/commit/d9399c77a932f0ecc9a2e6acec5d8457aa199444) Thanks [@rcoderdev](https://github.com/rcoderdev)! - fix(chain): hash-verify broadcast errors on all chains

  In MPC keysign every participating device broadcasts the same signed
  transaction. When a peer wins the RPC race, the slower device gets an
  "already known / duplicate / in mempool" error — the tx is on-chain, but
  fragile per-chain error-string matching made the slower device fail the
  signing flow anyway.

  Broadcast resolvers now share a `verifyBroadcastByHash` safety net: on
  any broadcast error, re-hash the signed output and check `getTxStatus`;
  if the tx is pending or confirmed, swallow the error. Existing string
  matches stay as a fast path to avoid an extra RPC roundtrip on the
  common case. The five resolvers that previously had no duplicate
  detection at all (Solana, Tron, Sui, Ripple, Polkadot) now tolerate
  duplicate broadcasts; Polkadot additionally surfaces JSON-RPC errors
  that were previously silently ignored.

## 1.3.1

### Patch Changes

- Updated dependencies [[`5aef564`](https://github.com/vultisig/vultisig-sdk/commit/5aef564309aeeede5da250e03447e0a3da0a12ab)]:
  - @vultisig/lib-utils@0.9.3

## 1.3.0

### Minor Changes

- [#291](https://github.com/vultisig/vultisig-sdk/pull/291) [`824e58c`](https://github.com/vultisig/vultisig-sdk/commit/824e58cded1ca80e29a2e19e2bda6957f2da71ad) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - feat(chain/cardano): CIP-30 CBOR helpers and a reusable submit helper

  Adds primitives needed by CIP-30 dApp-wallet bridges on top of `@vultisig/core-chain`:
  - `chains/cardano/cip30/cardanoAddressBytes` — decode a Cardano bech32 address into raw bytes (CIP-30 carries addresses as hex of these bytes, not bech32).
  - `chains/cardano/cip30/cardanoTxBodyHash` — blake2b-256 of the transaction body, extracted from the full tx CBOR **without re-encoding** so the txid matches what dApps sign off on.
  - `chains/cardano/cip30/buildCardanoValue` / `encodeCardanoValue` — build and CBOR-encode a Cardano `value` (coin + multiasset) for `getBalance()`.
  - `chains/cardano/cip30/encodeCardanoUnspentOutput` — CBOR-encode a `transaction_unspent_output` for `getUtxos()`.
  - `chains/cardano/cip30/decodeCardanoAmountValue` — decode the CBOR `value` argument passed to `getUtxos(amount)` into `{ lovelace, hasAssets }`. Returns `null` on malformed input so callers can fall back to returning all UTXOs.
  - `chains/cardano/cip30/selectCardanoUtxosByLovelace` — greedy largest-first coin selection by lovelace; returns `null` when the full set is insufficient. Used by CIP-30 `getUtxos` coin selection.
  - `chains/cardano/cip30/buildCardanoWitnessSet` — CBOR witness set returned by CIP-30 `signTx`.
  - `chains/cardano/cip30/buildCoseStructures` — CIP-8 / COSE_Sign1 + COSE_Key builders for `signData`.
  - `chains/cardano/cip30/cardanoCborPrimitives`, `cborEncoder`, `cborSkip` — minimal, Cardano-correct CBOR primitives (hand-rolled for the integer/bytes-keyed maps that `cbor-x` can't produce, and a byte-range walker used by `cardanoTxBodyHash`).
  - `chains/cardano/submit/submitCardanoCbor` — low-level Cardano broadcast helper that exposes `{ txHash, errorMessage, rpcErrorCode, rawResponse }` so callers can distinguish already-committed (Ogmios code 3117), mempool conflicts, etc.

  The existing `broadcastCardanoTx` resolver is refactored to delegate to `submitCardanoCbor`, preserving the already-committed fallback behavior.

## 1.2.2

### Patch Changes

- Updated dependencies [[`ed1eb16`](https://github.com/vultisig/vultisig-sdk/commit/ed1eb16b868176b796629e10de95fddcf701c151)]:
  - @vultisig/lib-utils@0.9.2

## 1.2.1

### Patch Changes

- [#204](https://github.com/vultisig/vultisig-sdk/pull/204) [`0388700`](https://github.com/vultisig/vultisig-sdk/commit/03887009b7579fc0b193d068d4a205cdd3b7c214) Thanks [@premiumjibles](https://github.com/premiumjibles)! - feat(cli): agent-friendly CLI + new @vultisig/mcp package

  ## @vultisig/cli
  - Auto-TTY JSON output (`--output`, `--ci`, `--quiet`, `--fields`, `--non-interactive`)
  - Versioned `{ success, v: 1, data }` envelope and typed error envelope with exit codes 0-7
  - Safety: fixed `swap`/`send`/`execute`/`rujira swap`/`rujira withdraw` auto-executing in JSON mode; `--yes` now required uniformly
  - `--dry-run` coverage across all mutating commands
  - `vsig schema` machine-readable command introspection
  - Auth: replaced `keytar` with `@napi-rs/keyring`, encrypted-file fallback for headless environments (AES-256-GCM + async scrypt)

  ## @vultisig/client-shared (new package)

  Shared client infrastructure for `@vultisig/cli` and `@vultisig/mcp`: auth setup, config store, credential store (keyring + file fallback), tool descriptions, vault discovery.

  ## @vultisig/sdk
  - `VaultBase.send()` and `VaultBase.swap()` accept `amount: 'max'`
  - `SwapService` rejects quotes with near-zero output to guard against bad provider routes
  - `FiatValueService.fetchTokenPrice` returns `0` for non-EVM chains instead of throwing (effective behavior identical — `getPortfolioValue` already caught the throw)
  - `ServerManager`: removed stdout `console.log` calls that corrupted JSON output; raised `waitForPeers` timeout from 30s to 120s and tightened poll interval from 2s to 500ms

  ## @vultisig/core-chain
  - Narrowed EVM broadcast retry list to strings that genuinely indicate "same tx already in mempool under this hash" (`already known`, `transaction already exists`, `tx already in mempool`). Dropped strings that can silently swallow real broadcast failures (`nonce too low`, `transaction is temporarily banned`, `future transaction tries to replace pending`, `could not replace existing tx`)

  ## @vultisig/core-mpc
  - `maxInboundWaitTime` raised from 1 to 3 minutes for flaky networks
  - Added 100ms sleep in `processInbound` recursion to prevent hot-looping on empty inbound
  - Setup message polling: same 10-second budget, polls 5× more often (50 × 200ms vs 10 × 1000ms)

## 1.2.0

### Minor Changes

- [#235](https://github.com/vultisig/vultisig-sdk/pull/235) [`aea1c28`](https://github.com/vultisig/vultisig-sdk/commit/aea1c28051345ddef9c952108b203caa8b7fa032) Thanks [@rcoderdev](https://github.com/rcoderdev)! - ### Swap amounts (backward compatible)
  - `SwapQuoteParams.amount` and `SwapTxParams.amount` now accept **`string | number`**. Call sites that already pass a **number** require no code changes.
  - Human-readable swap amounts can be passed as **decimal strings** end-to-end (compound `vault.swap()`, `getSwapQuote`, `prepareSwapTx`, CLI agent), avoiding precision loss from `Number()` / `parseFloat()` on extreme magnitudes or fractional digits.
  - `toChainAmount` accepts **`string | number`**; whitespace-only / empty strings throw instead of being treated as zero.

  ### Send preparation (stricter validation)
  - `prepareSendTx` and `estimateSendFee` reject **zero or negative** `amount` in base units. This aligns with real transfers; payloads with `toAmount: "0"` are no longer built for native/token sends.
  - **Zero-value EVM contract calls** are unchanged: use `prepareContractCallTx` (or `vault.contractCall()`), which still builds via the internal path that allows `value: 0n`.

  ### Other
  - Swap approval sizing uses `toChainAmount` instead of float scaling for required allowance.
  - `@vultisig/rujira` (source): `VultisigSignature.format` includes **`MLDSA`** to match SDK `Signature` — type-only widening, no runtime change; Rujira will pick up a **patch** version via normal dependency releases when published next.
  - CLI: direct **`viem`** dependency; Solana local swap human amount via `formatUnits`; agent SSE `Transaction` typing includes optional `swap_tx` / `send_tx` / `tx`.

  **Semver:** **Minor** for `@vultisig/core-chain`, `@vultisig/core-mpc`, and `@vultisig/sdk` (additive types + intentional validation tightening). **`@vultisig/cli` is linked to the SDK** in Changesets config, so it receives the same minor bump. This is **not** a SemVer **major** for integration purposes: swap inputs are only widened; `prepareSendTx({ amount: 0n })` was never a valid broadcast path.

  **Release tooling note:** `yarn changeset status` may still propose a **major** version for `@vultisig/rujira` when the SDK minors, even though the only Rujira change is adding `'MLDSA'` to a string-literal union (fully backward compatible). Review the Version Packages PR and **downgrade Rujira to patch** if your policy is to reserve majors for real breaking API changes.

  **`@vultisig/sdk` is 0.x:** per [SemVer](https://semver.org/#spec-item-4), minor releases on `0.y.z` may include behavior changes; consumers pinning `^0.14.0` should still accept `0.15.0` but should read changelog for validation tightening.

### Patch Changes

- [#174](https://github.com/vultisig/vultisig-sdk/pull/174) [`c630597`](https://github.com/vultisig/vultisig-sdk/commit/c6305970d1685194f1c6c11d5e8d141e8aa6c9a1) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - fix: harden PSBT signing (SignBitcoin) - follow-up on PR [#174](https://github.com/vultisig/vultisig-sdk/issues/174)
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

## 1.1.0

### Minor Changes

- [#179](https://github.com/vultisig/vultisig-sdk/pull/179) [`84a2950`](https://github.com/vultisig/vultisig-sdk/commit/84a295002ed7310320b584fbccb76aaf4a233b31) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Add full QBTC (post-quantum Bitcoin) send support: MLDSA fast signing, address derivation, broadcast via Cosmos REST, funded e2e send test, and `scripts/add-mldsa-to-vault.ts` helper. Switch QBTC core resolvers from dead Tendermint RPC to vultisig Cosmos REST API.

### Patch Changes

- [#164](https://github.com/vultisig/vultisig-sdk/pull/164) [`ec0c298`](https://github.com/vultisig/vultisig-sdk/commit/ec0c2988cfece95a1d66763e830a5b02e33ece9f) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Fix Cosmos transaction status receipts when the indexer reports `gasWanted` as zero: derive the gas denominator from decoded `fee.gasLimit` or `gasUsed`, sum native fee coins case-insensitively, and clamp proportional fees to the max fee. Aligns THORChain swap success fee display with co-signed and cross-client flows (see vultisig-windows#3501).

## 1.0.0

### Major Changes

- [#157](https://github.com/vultisig/vultisig-sdk/pull/157) [`5286b98`](https://github.com/vultisig/vultisig-sdk/commit/5286b98d19692acd216a2c95d5a7a903217bef36) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Regenerate explicit `package.json` exports for `@vultisig/core-config` and `@vultisig/lib-utils` so directory and flat subpaths resolve under Node, TypeScript, and Vite.

  **Breaking (`@vultisig/core-chain`, `@vultisig/core-mpc`):** Remove the npm dependency cycle by dropping `@vultisig/core-mpc` from `core-chain`. Modules that required MPC types or keysign helpers now live under `@vultisig/core-mpc` (for example `tx/compile/compileTx`, `tx/preSigningHashes`, `chains/cosmos/qbtc/QBTCHelper`, Blockaid keysign input builders, `swap/native/utils/nativeSwapQuoteToSwapPayload`, `swap/utils/getSwapTrackingUrl`, and EVM `incrementKeysignPayloadNonce` at `keysign/signingInputs/resolvers/evm/incrementKeysignPayloadNonce`). `getUtxos` / `getCardanoUtxos` return plain `ChainPlainUtxo`; keysign maps to protobuf in MPC.

  **SDK:** QBTC support, shared import updates, and alignment with the new package boundaries.

### Patch Changes

- Updated dependencies [[`5286b98`](https://github.com/vultisig/vultisig-sdk/commit/5286b98d19692acd216a2c95d5a7a903217bef36)]:
  - @vultisig/core-config@0.9.1
  - @vultisig/lib-utils@0.9.1

## 0.10.0

### Minor Changes

- [#149](https://github.com/vultisig/vultisig-sdk/pull/149) [`67dc6ce`](https://github.com/vultisig/vultisig-sdk/commit/67dc6ceaa1b318144cfbe3812ddecb14b108eba4) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Sync Windows-style TSS batching: batched FastVault APIs (`/batch/keygen`, `/batch/import`, `/batch/reshare`), batched relay message IDs for ECDSA, EdDSA, MLDSA, and per-chain import, secure vault QR `tssBatching=1` for joiner alignment, sequential fallbacks, and test coverage.

### Patch Changes

- Updated dependencies [[`67dc6ce`](https://github.com/vultisig/vultisig-sdk/commit/67dc6ceaa1b318144cfbe3812ddecb14b108eba4)]:
  - @vultisig/core-mpc@0.10.0

## 0.9.0

### Minor Changes

- [#147](https://github.com/vultisig/vultisig-sdk/pull/147) [`8f2c9c6`](https://github.com/vultisig/vultisig-sdk/commit/8f2c9c6823d9e5ab0d882a5e8ba47715edaa54c8) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Publish shared chain, MPC, config, and lib packages to npm with compiled `dist/` output, deep subpath exports, and release workflow updates. SDK declares these packages as dependencies; `@vultisig/cli` is versioned with the SDK via changesets link.

### Patch Changes

- Updated dependencies [[`8f2c9c6`](https://github.com/vultisig/vultisig-sdk/commit/8f2c9c6823d9e5ab0d882a5e8ba47715edaa54c8)]:
  - @vultisig/core-config@0.9.0
  - @vultisig/core-mpc@0.9.0
  - @vultisig/lib-utils@0.9.0
