# @vultisig/sdk

## 1.8.4

### Patch Changes

- [#649](https://github.com/vultisig/vultisig-sdk/pull/649) [`9271864`](https://github.com/vultisig/vultisig-sdk/commit/9271864c7cf1030b613f52b5564fc04d9309f069) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - Add custom token support for SUI. SUI is now included in
  `chainsWithTokenMetadataDiscovery`, and a new resolver fetches coin metadata
  (ticker, decimals, logo) from the SUI RPC via `suix_getCoinMetadata`. A new
  `isValidTokenId` helper validates token identifiers per chain — SUI tokens are
  validated as Move struct tags (e.g. `0x2::sui::SUI`) while all other chains keep
  delegating to `isValidAddress`.

## 1.8.3

### Patch Changes

- [#647](https://github.com/vultisig/vultisig-sdk/pull/647) [`55ed503`](https://github.com/vultisig/vultisig-sdk/commit/55ed503e103bdf8884c7ca7a8050742fb87d9e1f) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Enable WalletCore ZIP-317 fee planning for Zcash UTXO signing inputs.

## 1.8.2

### Patch Changes

- [#646](https://github.com/vultisig/vultisig-sdk/pull/646) [`72bbcd1`](https://github.com/vultisig/vultisig-sdk/commit/72bbcd17ee5327390c98784f861b7c6b8829cf2f) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Update the default Zcash consensus branch ID to NU6.2 (`30f33754`) for SDK UTXO signing and WalletCore signing inputs.

## 1.8.1

### Patch Changes

- [#617](https://github.com/vultisig/vultisig-sdk/pull/617) [`7145713`](https://github.com/vultisig/vultisig-sdk/commit/7145713992199f084d826f160cc20a4c445b14fb) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Select swap quotes with a 1% provider preference band instead of hard native priority.

- [#644](https://github.com/vultisig/vultisig-sdk/pull/644) [`2417949`](https://github.com/vultisig/vultisig-sdk/commit/24179490c1f80ca55b166a2a33e607574a140782) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - fix fiatToAmount throwing "EVM chains only" for Cosmos and other non-EVM token swaps. USD-denominated swap amounts now resolve correctly for TerraClassic (USTC/LUNC), Cosmos Hub (ATOM), Osmosis (IBC denoms), Solana SPL tokens, Polkadot asset-hub tokens, TON jettons, and any chain with entries in the knownTokens registry. Native Cosmos denoms (uluna, uatom, etc.) are also handled via cosmosFeeCoinDenom fallback.

## 1.8.0

### Minor Changes

- [#618](https://github.com/vultisig/vultisig-sdk/pull/618) [`ddf0bf4`](https://github.com/vultisig/vultisig-sdk/commit/ddf0bf44cc38905370f60246b88503954b3e3418) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - feat(swap/lifi): consumer-supplied LI.FI integrator + apiUrl override

  Adds `SwapAffiliateConfig.lifi: LifiAffiliateConfig` so consumers (e.g. Station via `vultisig/mcp-ts`) can redirect LI.FI affiliate fees to their own portal integrator instead of the SDK-default `vultisig-0`.

  New surface:
  - `LifiAffiliateConfig` type — `{ integratorName: string; apiUrl?: string }`
  - `setupLifi(config?)` — global LI.FI SDK bootstrap; idempotent first-caller-wins. Consumers call this once at module boot to set both the global `integrator` and (optional) `apiUrl` proxy.
  - `getLifiSwapQuote` now accepts an optional `lifiAffiliateConfig` and uses its `integratorName` as the per-call `integrator` in `getQuote(...)`, overriding the global default for THIS quote without mutating the module-level `lifiConfig`.
  - `findSwapQuote` threads `affiliateConfig?.lifi` into `getLifiSwapQuote`.

  No behaviour change for callers that don't supply a `lifi` config — `getLifiSwapQuote` still routes through the existing `vultisig-0` default.

### Patch Changes

- [#631](https://github.com/vultisig/vultisig-sdk/pull/631) [`2ab9eb2`](https://github.com/vultisig/vultisig-sdk/commit/2ab9eb2ad5e2b180078389815f3158b5eb8e602b) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - feat(cosmos): add optional `feeDenom` to `BuildCosmosSendOptions`

  Allows callers to specify a separate gas-fee coin denom when it differs from the send amount denom. Previously `buildCosmosSendTx` always used `denom` (the send coin) as the fee coin — on TerraClassic this meant USTC sends charged fees in USTC instead of LUNC, causing on-chain rejection when the USTC balance was below the fee threshold. Closes vultisig-sdk#624.

## 1.7.0

### Minor Changes

- [#610](https://github.com/vultisig/vultisig-sdk/pull/610) [`c87816b`](https://github.com/vultisig/vultisig-sdk/commit/c87816b6797e8237d7a94923025311e479e0c520) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - fix(swap): proactively detect below-minimum native swaps ([#604](https://github.com/vultisig/vultisig-sdk/issues/604))

  Small cross-chain swaps below the economic minimum (e.g. ETH→BTC ~$2.81) no longer surface a misleading generic "No swap route found" error. `findSwapQuote` now computes the THORChain minimum up front from the destination chain's `outbound_fee` and spot pool prices, and surfaces an actionable `AmountBelowMinimum` error with the concrete threshold ("Minimum is ~0.012 ETH. Please increase the amount.") instead of relying on brittle provider error-string matching.
  - New exported helper `getNativeSwapMinAmountIn` (and `NATIVE_SWAP_MIN_OUTBOUND_FEE_MULTIPLIER`) so consumers can show the minimum proactively as the user types.
  - The computed minimum is now `max(outbound-fee minimum, source dust threshold)` — THORChain rejects an input below the source chain's `dust_threshold` ("amount less than dust threshold") before economics apply (e.g. DOGE's ~1 DOGE floor), so the threshold is included alongside the outbound-fee economics. The result exposes `dustThresholdBaseUnit` and `binding: 'outbound' | 'dust'` for diagnostics.
  - Eager short-circuit only when a native protocol is the sole route family; multi-provider pairs still query every provider so an aggregator with a lower minimum is never blocked.
  - The generic all-fail path now logs raw provider error messages so future sub-minimum wordings become data-driven instead of guessed.
  - Trading-halt detection: when a native protocol rejects with "trading is halted" (THORChain mimir `HALT<CHAIN>TRADING`, pool ragnarok, churn) the pair fails for _every_ amount, so a new `TradingHalted` error surfaces "This swap route is temporarily unavailable — trading is halted on …" instead of the misleading generic "No swap route found" / "increase the amount".

## 1.6.0

### Minor Changes

- [#611](https://github.com/vultisig/vultisig-sdk/pull/611) [`9e405c9`](https://github.com/vultisig/vultisig-sdk/commit/9e405c9459713c5391ca6a85a548eb3750ec2872) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - ## New
  - Osmosis added to `AUTO_DISCOVERY_CHAINS` — IBC balance discovery is now active for Osmosis ([#611](https://github.com/vultisig/vultisig-sdk/issues/611))
  - Osmosis IBC token registry: ATOM (channel-0), USDC/Noble (channel-750), axlUSDC/Axelar (channel-208), stATOM (channel-326), stOSMO (channel-326), TIA/Celestia (channel-6994) — all hashes LCD-verified against osmosis-rest.publicnode.com and cross-referenced with cosmos/chain-registry ([#611](https://github.com/vultisig/vultisig-sdk/issues/611))

- [#606](https://github.com/vultisig/vultisig-sdk/pull/606) [`04cd9e3`](https://github.com/vultisig/vultisig-sdk/commit/04cd9e3881cb0e8cab5b1783be6e8d86970001d6) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - Add optional `appId` to push device registration (`registerDevice`). Apps that
  share a vault with the regular wallet (e.g. Station, `money.terra.station`) can
  now register/unregister under their own bundle id, so the notification service
  routes their pushes to the correct app instead of the wallet that shares the
  vault. The field is optional and omitted by default, so existing wallet
  registrations are unchanged.

## 1.5.0

### Minor Changes

- [#585](https://github.com/vultisig/vultisig-sdk/pull/585) [`1bf8a6d`](https://github.com/vultisig/vultisig-sdk/commit/1bf8a6d36788b702092d92918294d67cdc6e11b7) Thanks [@NeOMakinG](https://github.com/NeOMakinG)! - Add `getSwapExplorerUrl` helper for swap-provider tx links ([#426](https://github.com/vultisig/vultisig-sdk/issues/426)).

  Tx history surfaces (vultisig-windows, vultiagent-app, future RN SDK) now have a single source of truth for "View on Explorer" URLs that point to the swap **provider's** scanner — `scan.li.fi`, `orb.helius.dev` for LI.FI Solana settlement, `runescan.io` for THORChain, and the MayaChain explorer — instead of every consumer reimplementing the routing and most defaulting to the source-chain explorer (which hides cross-chain routes from users).
  - New: `getSwapExplorerUrl({ provider, txHash, fromChain })` in `@vultisig/core-chain/swap/utils/getSwapExplorerUrl`
  - New: `Vultisig.getSwapExplorerUrl(provider, txHash, fromChain)` static method for parity with `getTxExplorerUrl`
  - For `1inch` / `kyber` / `swapkit`, falls back to the source-chain explorer (no public per-tx aggregator page)
  - Mirrors iOS `ExplorerLinkBuilder.swift` and Android `ExplorerLinkRepository.getSwapProgressLink`
  - Pure URL builder, no new deps

## 1.4.0

### Minor Changes

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

- [#601](https://github.com/vultisig/vultisig-sdk/pull/601) [`3eb9b18`](https://github.com/vultisig/vultisig-sdk/commit/3eb9b186b0d021455cf47f957b15a45fcbb2798e) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - Republish the `@vultisig/sdk` bundle so consumers (mcp-ts, vultiagent-app) pick up the latest `@vultisig/core-chain` features that landed without an `@vultisig/sdk` changeset:
  - `resolveTokenPriceId(chain, denomOrAddress?)` helper for registry-driven token price resolution ([#587](https://github.com/vultisig/vultisig-sdk/pull/587))
  - LiFi stable-pair slippage tuning ([changeset](.changeset/lifi-stable-pair-slippage.md))
  - Plus any other pending `@vultisig/core-chain` minors that have been merged without a corresponding sdk-package changeset.

  Pure repackage — no consumer-facing API change; the bundle just embeds the latest core-chain dist.

- [#593](https://github.com/vultisig/vultisig-sdk/pull/593) [`5d11cf3`](https://github.com/vultisig/vultisig-sdk/commit/5d11cf3bfb81aba929fe8e81bb77e7aebff15129) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - refactor(swap): typed SwapError class with stable codes at findSwapQuote throw sites - enables instanceof checks instead of message string matching

## 1.3.1

### Patch Changes

- [#582](https://github.com/vultisig/vultisig-sdk/pull/582) [`47860fc`](https://github.com/vultisig/vultisig-sdk/commit/47860fcc6a1fa3600c20b529d29af98d56cbc5b4) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - ## Changed
  - Lower THORChain streaming-quote trigger threshold from 300 bps (3%) to 100 bps (1%) - more mid-size cross-chain trades now compare a streaming quote against the rapid quote and pick the better expected_amount_out. ([#470](https://github.com/vultisig/vultisig-sdk/issues/470))

## 1.3.0

### Minor Changes

- [#583](https://github.com/vultisig/vultisig-sdk/pull/583) [`f2270cd`](https://github.com/vultisig/vultisig-sdk/commit/f2270cd6aaa741d6800bd2d21e9775092be25d31) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - ## New
  - Polkadot Asset Hub USDT (asset_id 1984) + USDC (asset_id 1337) token registry ([#562](https://github.com/vultisig/vultisig-sdk/issues/562))
  - Polkadot `pallet_assets.Account` balance resolver for Asset Hub tokens - replaces placeholder 0n guard ([#563](https://github.com/vultisig/vultisig-sdk/issues/563))
  - Tron native send `data` field (proto field 12) for THORChain memos + exchange deposit memos; `BuildTronSendOptions` and `BuildTrc20TransferOptions` gain optional `data?: Uint8Array` field ([#559](https://github.com/vultisig/vultisig-sdk/issues/559))

  ## Fixed
  - Tron TRC-20 fee estimate now subtracts sender's available energy before charging TRX ([#556](https://github.com/vultisig/vultisig-sdk/issues/556))
  - Tron native send free bandwidth check prevents spurious fee charge when bandwidth is available ([#555](https://github.com/vultisig/vultisig-sdk/issues/555))

### Patch Changes

- [#594](https://github.com/vultisig/vultisig-sdk/pull/594) [`c1cca9a`](https://github.com/vultisig/vultisig-sdk/commit/c1cca9aa88acef2c0b31884154af2ed1e6b8ff92) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Publish the SDK bundle with the latest SwapKit Bitcoin PSBT signing path from `@vultisig/core-chain` and `@vultisig/core-mpc`.

## 1.2.1

### Patch Changes

- [#579](https://github.com/vultisig/vultisig-sdk/pull/579) [`c3881e5`](https://github.com/vultisig/vultisig-sdk/commit/c3881e549e5678e8806eba5defb2d2d6eefc2cc5) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - ## Fixed
  - Cosmos account info LCD fallback for extended account types that StargateClient cannot decode (vesting wrappers, module accounts) — prevents doomed txs with `sequence:0` that fail at broadcast with `account sequence mismatch, expected N, got 0` ([#579](https://github.com/vultisig/vultisig-sdk/issues/579))
  - Cosmos coin balance LCD fallback when StargateClient returns `amount:"0"` on a funded address — fixes a packaging-level discrepancy in cosmjs's HTTP layer under Hermes/React Native that silently surfaced as "you have 0" on funded Terra/TerraClassic wallets ([#579](https://github.com/vultisig/vultisig-sdk/issues/579))

## 1.2.0

### Minor Changes

- [#577](https://github.com/vultisig/vultisig-sdk/pull/577) [`cc9d67f`](https://github.com/vultisig/vultisig-sdk/commit/cc9d67f0c61d9ebdfc133beac5ef04658d37a37f) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - ## New
  - Polkadot Asset Hub USDT (asset_id 1984) + USDC (asset_id 1337) token registry ([#562](https://github.com/vultisig/vultisig-sdk/issues/562))
  - Polkadot `pallet_assets.Account` balance resolver for Asset Hub tokens - replaces placeholder 0n guard ([#563](https://github.com/vultisig/vultisig-sdk/issues/563))
  - Tron native send `data` field (proto field 12) for THORChain memos + exchange deposit memos; `BuildTronSendOptions` and `BuildTrc20TransferOptions` gain optional `data?: Uint8Array` field ([#559](https://github.com/vultisig/vultisig-sdk/issues/559))

  ## Fixed
  - Tron TRC-20 fee estimate now subtracts sender's available energy before charging TRX ([#556](https://github.com/vultisig/vultisig-sdk/issues/556))
  - Tron native send free bandwidth check prevents spurious fee charge when bandwidth is available ([#555](https://github.com/vultisig/vultisig-sdk/issues/555))

## 1.1.3

### Patch Changes

- [#544](https://github.com/vultisig/vultisig-sdk/pull/544) [`a0b7b6b`](https://github.com/vultisig/vultisig-sdk/commit/a0b7b6b440e0584f4436a81ddf983d0dd28b7a95) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Disable unsupported Bittensor seedphrase import and expose the SDK-owned seedphrase import chain support list.

## 1.1.2

### Patch Changes

- [#554](https://github.com/vultisig/vultisig-sdk/pull/554) [`bf7278c`](https://github.com/vultisig/vultisig-sdk/commit/bf7278c5886789c4a181169a36bc9296ef81b79c) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Emit the dedicated commondata SwapKit swap payload for source-chain transfer routes so QR cosigners can distinguish SwapKit swaps from OneInch-compatible swap payloads.

## 1.1.1

### Patch Changes

- [#512](https://github.com/vultisig/vultisig-sdk/pull/512) [`72eb200`](https://github.com/vultisig/vultisig-sdk/commit/72eb200ec647a707d1ebdc1f8b6f0f5243780477) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Add Station Terra import primitives for legacy seed-byte, mnemonic, and raw private-key migration flows.

## 1.1.0

### Minor Changes

- [#515](https://github.com/vultisig/vultisig-sdk/pull/515) [`5ef62f1`](https://github.com/vultisig/vultisig-sdk/commit/5ef62f1aa20202f4a4eb97afa0cf20216dc5a1f1) Thanks [@NeOMakinG](https://github.com/NeOMakinG)! - Add `buildTronTxFromRawData(rawDataHex)` to sign yield.xyz Tron actions whose `raw_data` is already encoded upstream (FreezeBalanceV2, UnfreezeBalanceV2, VoteWitnessContract, …). Hashes the raw_data bytes with SHA-256, takes the MPC signature, and wraps the final `Transaction { raw_data, signature }` envelope — same `{signingHashHex, unsignedRawHex, finalize(sig)}` contract as `buildTronSendTx`. Includes strict hex-character validation so malformed input fails fast instead of silently producing a wrong signing payload.

## 1.0.0

### Major Changes

- [#537](https://github.com/vultisig/vultisig-sdk/pull/537) [`fa95600`](https://github.com/vultisig/vultisig-sdk/commit/fa95600887cb8ca603e8ddcb9c8558eff2d0ea6b) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - chore: remove Station affiliate constants from shared SDK (closes [#536](https://github.com/vultisig/vultisig-sdk/issues/536))

  Station-specific constants (`stvs` THORName, `0x649E...076D` EVM fee receiver) do not belong in a public package consumed by Windows and external users. The generic `affiliateConfig` injection seam on `findSwapQuote` + `SwapAffiliateConfig` type remain — those are correct SDK design. Station reconstructs the same three configs in its own consumer package (mcp-ts#201).

  **BREAKING CHANGE:** `stationKyberSwapAffiliateConfig`, `stationNativeSwapAffiliateConfig`, and `stationOneInchAffiliateConfig` are no longer exported from `@vultisig/sdk`. See MIGRATING.md for the reconstruction pattern.

  > **WARNING: DO NOT MERGE until vultisig/mcp-ts#201 lands.** Station must reconstruct these constants in its consumer package before this removal ships. Merging early will silently fall back to vultisig-0 affiliate defaults, breaking Station's affiliate fee routing on native swaps.

## 0.28.0

### Minor Changes

- [#530](https://github.com/vultisig/vultisig-sdk/pull/530) [`cb21dcf`](https://github.com/vultisig/vultisig-sdk/commit/cb21dcf127e8e08ceaca76439fa28d557cf0fed9) Thanks [@NeOMakinG](https://github.com/NeOMakinG)! - feat(seedphrase): probe Cosmos-coin-type Terra path (118) for Keplr/Leap seeds when standard 330-path is empty

## 0.27.0

### Minor Changes

- [#516](https://github.com/vultisig/vultisig-sdk/pull/516) [`9a80907`](https://github.com/vultisig/vultisig-sdk/commit/9a8090721008f2a10dffa9cf2d3fac479d65481c) Thanks [@NeOMakinG](https://github.com/NeOMakinG)! - Add `buildTonTxFromSigningPayload({publicKeyEd25519, signingPayloadBoc, includeStateInit, workchain})` to sign yield.xyz TON actions whose signing payload BoC is already constructed upstream. Parses the BoC, hashes the payload cell, takes the MPC signature, and wraps the final external message — same `{signingHashHex, unsignedBocHex, fromAddress, finalize(sig)}` contract as `buildTonSendTx`. Accepts either base64 or hex BoC input. Optional `includeStateInit` flag deploys the v4r2 wallet contract alongside the tx for first-send (seqno === 0) scenarios.

## 0.26.1

### Patch Changes

- [#525](https://github.com/vultisig/vultisig-sdk/pull/525) [`b0d0ba9`](https://github.com/vultisig/vultisig-sdk/commit/b0d0ba9d3ff0226149aca9a7446ff07a9eba84fc) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Enable SwapKit source routes for BTC, BCH, DOGE, LTC, XRP, ZEC, TRON, and TON by signing non-EVM SwapKit routes as source-chain transfers.

## 0.26.0

### Minor Changes

- [#507](https://github.com/vultisig/vultisig-sdk/pull/507) [`cb80440`](https://github.com/vultisig/vultisig-sdk/commit/cb804408b9607aacb143a7a941f0f9f1986f2379) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Add SwapKit as a configurable general swap provider for EVM and Solana source routes.

## 0.25.0

### Minor Changes

- [#502](https://github.com/vultisig/vultisig-sdk/pull/502) [`c2fd086`](https://github.com/vultisig/vultisig-sdk/commit/c2fd08670ad67e9ec93443569f9b9b9aa5f9d685) Thanks [@NeOMakinG](https://github.com/NeOMakinG)! - feat(price): add `Vultisig.getCoinPricesWithChange` returning 24h % change

  `getCoinPrices` returns only `Record<string, number>` (spot price), so
  consumers that need the 24h change — e.g. a price widget's −3.97%
  indicator — had to keep a side-channel CoinGecko call, duplicating the
  SDK and risking drift.

  Adds a parallel, additive path:
  - `Vultisig.getCoinPricesWithChange(params)` →
    `Record<string, { price: number; change24h?: number }>`
  - core-chain `getCoinPricesWithChange` / `queryCoingeickoPricesWithChange`
    (requests `include_24hr_change=true`; `change24h` is omitted when
    CoinGecko has no datum for an id)
  - new public types `CoinPriceWithChange`, `CoinPricesWithChangeResult`

  Deliberately a **separate function**, not a flag on `getCoinPrices`:
  `getCoinPrices` / `CoinPricesResult` / `FiatValueService` /
  `fiatToAmount` / `getErc20Prices` are byte-for-byte unchanged — zero
  regression surface on the existing call sites. Price-only callers should
  keep using `getCoinPrices` (lighter payload, stable contract); reach for
  `getCoinPricesWithChange` only when the change is actually rendered.

  Lets vultiagent-app (and any other client) drop its hand-rolled
  `fetchPrices` 24h-change side-channel and source price+change from the
  SDK alone.

- [#503](https://github.com/vultisig/vultisig-sdk/pull/503) [`0c9f6d5`](https://github.com/vultisig/vultisig-sdk/commit/0c9f6d5139d4a096645a575505c7550c2b26bd2a) Thanks [@NeOMakinG](https://github.com/NeOMakinG)! - feat(tokens): add vault-free `Vultisig.discoverTokens({ chain, address })`

  On-chain token discovery (1inch for EVM, Jupiter for Solana, LCD for
  Cosmos) was only reachable as the instance method
  `vault.discoverTokens(chain)`. Callers that hold a derived address but
  no SDK `Vault` — the agent, a portfolio/dashboard screen, the
  agent-backend — couldn't use it without constructing a full vault.

  Adds a static, vault-free `Vultisig.discoverTokens({ chain, address })`
  returning `DiscoveredToken[]`. It is a thin wrapper over the
  already-vault-free `findCoins({ address, chain })` from
  `@vultisig/core-chain/coin/find` — the exact same call + mapping
  `vault.discoverTokens()` already does internally, minus the
  `getAddress` step. No new discovery logic, no behavioural change to the
  instance method, zero regression surface.

  Lets vultiagent-app discover the long tail of held tokens (beyond
  native + manually-added) on its existing vault-free balance path so the
  dashboard + agent see the same token set as a wallet would.

### Patch Changes

- [#498](https://github.com/vultisig/vultisig-sdk/pull/498) [`1667b79`](https://github.com/vultisig/vultisig-sdk/commit/1667b79fbc754e36032942fb5e749706dfc09bf3) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Enable Cosmos bank-balance token discovery for Terra and Terra Classic, including denom metadata decimals, IBC denom trace fallback, and hidden unknown denom metadata.

- [#505](https://github.com/vultisig/vultisig-sdk/pull/505) [`46274d7`](https://github.com/vultisig/vultisig-sdk/commit/46274d70fe19fb2f44bc90d9ec0cd4ac1994ae69) Thanks [@NeOMakinG](https://github.com/NeOMakinG)! - Export the vault-free Cosmos staking/distribution LCD queries
  (`getCosmosDelegations`, `getCosmosDelegatorRewards`,
  `getCosmosUnbondingDelegations`, `getCosmosVestingAccount`, the URL
  builders, and their types) from the React Native entry point. They
  were already in the generic entry but the hand-curated RN allow-list
  omitted them, forcing RN consumers (vultiagent-app) to hand-roll an
  LCD client for delegations/rewards. Additive only; signing primitives
  remain via `chains.cosmos.buildCosmosStakingTx`.

## 0.24.0

### Minor Changes

- [#463](https://github.com/vultisig/vultisig-sdk/pull/463) [`bd0daf9`](https://github.com/vultisig/vultisig-sdk/commit/bd0daf9a8156c9927643cba8c1af98a2a6d5da56) Thanks [@NeOMakinG](https://github.com/NeOMakinG)! - feat(address): `deriveAddressFromKeys` accepts optional `chainPublicKeys` map

  Callers holding pre-derived hardened per-chain pubkeys (e.g. from KeyImport vaults or the agent-backend's `VaultInfo.ChainPublicKeys`) can now pass them through directly, bypassing the non-hardened BIP32 fallback path that produces a different address. Bidirectional Terra ↔ TerraClassic alias is built-in (both share coin_type 330). Existing callers passing no `chainPublicKeys` are unaffected — the non-hardened path remains the default.

  Unlocks the Luna boundary fix (mcp-ts get_address + agent-backend VaultInfo + vultiagent-app agentContext) so the agent chat path resolves the same Terra/TerraClassic address the in-process wallet derives.

### Patch Changes

- [#474](https://github.com/vultisig/vultisig-sdk/pull/474) [`37c2f82`](https://github.com/vultisig/vultisig-sdk/commit/37c2f82379725ac4ac4d63679afea5c3ac1b7683) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Refresh vulnerable dependency paths for high-severity audit cleanup.

## 0.23.0

### Minor Changes

- [#464](https://github.com/vultisig/vultisig-sdk/pull/464) [`a6db82f`](https://github.com/vultisig/vultisig-sdk/commit/a6db82fd103ea8eea01a084cc8fbd787367db437) Thanks [@neavra](https://github.com/neavra)! - feat(sdk/vault): `signMsgDeposit` for THORChain/MayaChain LP add/remove; sdk-cli dispatches LP memos through it

  Adds `vault.signMsgDeposit({chain, amountBaseUnits, memo})` to `VaultBase`, building a `THORChainDeposit` cosmos message via the existing keysign pipeline (passes `isDeposit: true` through `getChainSpecific`). Memo is opaque pass-through — LP add (`+:POOL[:PAIRED]`), LP remove (`-:POOL:BPS[:ASSET]`), and any future deposit-style intent flow through the same surface.

  sdk-cli's `signNonEvmServerTx` now dispatches THORChain/MayaChain MsgDeposit envelopes by memo prefix: `=:` continues to route through `vault.swap` (Phase D), `+:` and `-:` route through the new `signThorMsgDepositLp` → `vault.signMsgDeposit`. Unsupported prefixes (LOAN, BOND, etc.) throw `NotImplemented` with the offending memo in the error message. Phase E in the envelope-parity progression; previously these memos threw at `parseThorSwapMemo`.

### Patch Changes

- [#459](https://github.com/vultisig/vultisig-sdk/pull/459) [`fde60dc`](https://github.com/vultisig/vultisig-sdk/commit/fde60dcc9f9822e21c2dbaeaacb9afb45cff0955) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Deduplicate vault flows, example adapters, and server mocks; set jscpd threshold to 0%. Add `VaultErrorCode.OperationAborted` and typed errors in shared test mocks.

## 0.22.7

### Patch Changes

- [#457](https://github.com/vultisig/vultisig-sdk/pull/457) [`680119e`](https://github.com/vultisig/vultisig-sdk/commit/680119e7392921b8aeaf859c85e811fb40a25054) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Add regression tests and drift guards for Bitcoin PSBT compilation, ChainKind signing-input alignment, generated protobuf headers, and CLI agent action names aligned with AGENTS.md.

- [#456](https://github.com/vultisig/vultisig-sdk/pull/456) [`b36eb62`](https://github.com/vultisig/vultisig-sdk/commit/b36eb62842051b8b2bae06f1e123a5ebcf6cad88) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Add Terra CW20 metadata resolution and build CW20 token sends as CosmWasm execute transfers.

## 0.22.6

### Patch Changes

- [#419](https://github.com/vultisig/vultisig-sdk/pull/419) [`e434998`](https://github.com/vultisig/vultisig-sdk/commit/e434998069e6af9664db045c5e91c5d5f35feef6) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Browser and Electron example vault UX after QA; secure vault join/create/import flows; MPC session and server coordination fixes.

## 0.22.5

### Patch Changes

- [#431](https://github.com/vultisig/vultisig-sdk/pull/431) [`1132ae5`](https://github.com/vultisig/vultisig-sdk/commit/1132ae51f8e4d5b8ca8a1855af9ea51031b574e9) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - fix cosmos denom resolver picking wrong segment for 3-part factory denoms

## 0.22.3

### Patch Changes

- [#405](https://github.com/vultisig/vultisig-sdk/pull/405) [`441f5bb`](https://github.com/vultisig/vultisig-sdk/commit/441f5bb9022321023a65d28a5941717ac7542bee) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - fix(ustc): dynamic burn-tax for TerraClassic USTC sends, case-insensitive coin id check

  Replaces the hardcoded 1,000,000 uusd fee surcharge with a live LCD `tax_rate` + optional `tax_cap` query for TerraClassic USTC (uusd) sends.
  - `computeUstcBurnTaxAmount()` fetches on-chain rate and cap, returns '0' when rate is zero (current post-UST-collapse governance state)
  - Fail-open on LCD outage: falls back to '0' so sends are never blocked when burn tax is zero; ante handler rejects if rate is non-zero and LCD is down
  - Case-insensitive `coin.id?.toLowerCase() === 'uusd'` guard to match `areEqualCoins` behavior
  - 5 unit tests covering: rate=0, rate=1.2%, rate+cap, LCD outage, LUNC non-USTC exclusion

## 0.22.2

### Patch Changes

- [#371](https://github.com/vultisig/vultisig-sdk/pull/371) [`b713743`](https://github.com/vultisig/vultisig-sdk/commit/b7137437547afc8189af207f210be57f50973dc7) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Install `globalThis.Buffer` before the browser SDK module graph evaluates (`preamble.ts`), align browser `polyfills` with `globalThis`, add explicit `buffer` imports across MPC modules that use `Buffer`, and depend on `buffer` from `@vultisig/core-mpc`. Harden the browser/electron examples: seedphrase import batching/progress and adapter flags, clipboard helper with bounded timeouts, QR/address copy feedback, and send-form amount validation with trimmed recipients.

- [#379](https://github.com/vultisig/vultisig-sdk/pull/379) [`ed6955f`](https://github.com/vultisig/vultisig-sdk/commit/ed6955fe6d218b3b13314db32f8d43c67a41fb48) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Treat a second `WasmMpcEngine` `configureMpc` registration as a no-op when bundlers evaluate the platform entry in multiple chunks (Chrome extension / Vite), preventing dev-time throws and broken signing.

- Updated dependencies [[`ed6955f`](https://github.com/vultisig/vultisig-sdk/commit/ed6955fe6d218b3b13314db32f8d43c67a41fb48)]:
  - @vultisig/mpc-types@0.2.3

## 0.22.1

### Patch Changes

- [#361](https://github.com/vultisig/vultisig-sdk/pull/361) [`a52980c`](https://github.com/vultisig/vultisig-sdk/commit/a52980c490633da7d7ae36128bc491f8ca3ff565) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Build shared workspace packages before bundling the SDK (`yarn build:sdk`). The browser example prepare step now rebuilds shared `dist` outputs when missing or stale, and shared utilities now import `Buffer` explicitly so browser apps do not crash during module evaluation.

- [#364](https://github.com/vultisig/vultisig-sdk/pull/364) [`d49b3e8`](https://github.com/vultisig/vultisig-sdk/commit/d49b3e82e153cf77282cbf06fdf72d9bb37cc836) Thanks [@premiumjibles](https://github.com/premiumjibles)! - `@vultisig/sdk`: re-export `getTxStatus` from `@vultisig/core-chain/tx/status` as a top-level standalone helper alongside `getCoinBalance` and `getPublicKey`. The dispatcher is stateless (`{ chain, hash }` → `TxStatusResult`) and was already compiled into every platform bundle, but was previously only reachable via the `vault.getTxStatus(...)` instance method on `VaultBase`. Vault-free callers (CLI, RN apps that store vault data outside `VaultManager`) can now poll receipts without instantiating an abstract `VaultBase` subclass purely to use a stateless lookup. `TxStatusResult` / `TxReceiptInfo` were already exported as types — this just adds the runtime function.

## 0.22.0

### Minor Changes

- [#293](https://github.com/vultisig/vultisig-sdk/pull/293) [`a3a331a`](https://github.com/vultisig/vultisig-sdk/commit/a3a331a875ebc6868b11c6901c8ed99dde51a4ff) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Password-protected vault backups use PBKDF2-HMAC-SHA256 with a random salt (600k iterations by default) and a versioned blob prefix; legacy SHA-256-only backups still decrypt.

### Patch Changes

- [#354](https://github.com/vultisig/vultisig-sdk/pull/354) [`feac01f`](https://github.com/vultisig/vultisig-sdk/commit/feac01f3225738a14c0123e1c3d70e46b97760fd) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Fix the CommonJS export shape for the `@vultisig/sdk/vite` preset and harden browser Vite support so SDK wasm assets, Node globals, and local example builds resolve correctly in dev and production.

## 0.21.0

### Minor Changes

- [#350](https://github.com/vultisig/vultisig-sdk/pull/350) [`bad88d8`](https://github.com/vultisig/vultisig-sdk/commit/bad88d8d87229284c739995c027eb33d3ffc19e3) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - feat: cosmos-sdk staking module - generic Delegate/Undelegate/BeginRedelegate/WithdrawDelegatorReward + LCD queries

  Adds the cosmos-sdk staking + distribution module to the SDK, generic across every ibcEnabled cosmos chain we support (Cosmos Hub, Osmosis, Kujira, Terra, TerraClassic, Akash, Noble, Dydx).

  **Signing primitives** (`@vultisig/sdk` -> `chains.cosmos.buildCosmosStakingTx`):
  - `MsgDelegate`, `MsgUndelegate`, `MsgBeginRedelegate`, `MsgWithdrawDelegatorReward`
  - Hand-rolled RN-safe protobuf (no cosmjs runtime dep) mirroring the existing `buildCosmosWasmExecuteTx` pattern
  - Multi-msg batch txs supported (e.g. claim rewards from many validators in one tx)
  - Byte-for-byte round-trip verified against `cosmjs-types` canonical decoder

  **LCD query helpers** (`@vultisig/sdk` top-level + `@vultisig/core-chain/chains/cosmos/staking/lcdQueries`):
  - `getCosmosDelegations(chain, address)` -> per-validator balance + shares
  - `getCosmosUnbondingDelegations(chain, address)` -> pending unbondings with completion time
  - `getCosmosDelegatorRewards(chain, address)` -> per-validator rewards + total
  - `getCosmosVestingAccount(chain, address)` -> Periodic / Continuous / Delayed detection (returns null otherwise)

  ship-once, unlock-many: adding a future cosmos chain is a config-only change.

  34 new unit tests including 4 real cosmoshub fixtures captured from `cosmos1a8l3srqyk5krvzhkt7cyzy52yxcght6322w2qy`.

## 0.20.0

### Minor Changes

- [#310](https://github.com/vultisig/vultisig-sdk/pull/310) [`1d1c02c`](https://github.com/vultisig/vultisig-sdk/commit/1d1c02c37e58340b0617eec3a5e44909efc9b452) Thanks [@premiumjibles](https://github.com/premiumjibles)! - feat(sdk/rn): make React Native consumption ergonomic

  Two changes land together because both address making the RN build correctly consumable without the consumer having to hand-roll workarounds.
  1. **`./react-native` subpath export conditions**

  The `./react-native` subpath previously declared only `types` and `import`. Bundlers that prefer a `react-native` condition (Expo Metro on iOS/Android sets `unstable_conditionsByPlatform: { android: ['react-native'], ios: ['react-native'] }`) fall through the `./react-native` subpath when the SDK is resolved through a symlinked location (e.g. `npm install file:../vultisig-sdk/packages/sdk`, `pnpm add @vultisig/sdk@link:...`), producing `Unable to resolve "@vultisig/sdk/react-native"` at bundle time. Published-and-installed SDKs sidestepped the bug because the resolver cached a direct file path without re-walking conditions through the symlink. Mirror the conditions already present on the root `.` export so `./react-native` works identically in both linked and installed modes. 2. **New `./rn-preamble` side-effect subpath**

  Adds `@vultisig/sdk/rn-preamble` — a tiny side-effect module consumers import as the **first statement** in their RN app entry to install `globalThis.Buffer` and repair `Buffer.prototype.subarray` (RN's polyfill returns a plain `Uint8Array`, which breaks `.copy()` on downstream consumers like `@ton/core`). Previously consumers had to hand-write these polyfills, and getting the import order wrong crashed Hermes at boot with `Property 'Buffer' doesn't exist` — before the SDK's own RN entry could install its polyfill, because Metro hoists `require()` calls and transitive chain-lib module bodies evaluate before the SDK entry's statements run. The preamble is designed specifically to be the first `require` Metro hoists, so its body completes before anything else imports.

  Consumer usage:

  ```ts
  // index.ts (RN app entry — must be the first line)
  import "@vultisig/sdk/rn-preamble";

  // ...all other imports follow
  ```

  Additive: no existing export or subpath is changed; consumers who don't use the preamble are unaffected.

## 0.19.1

### Patch Changes

- Updated dependencies [[`e3fa32b`](https://github.com/vultisig/vultisig-sdk/commit/e3fa32b9f29e3a07880ecba117cf40e6dd396a4b)]:
  - @vultisig/mpc-types@0.2.2

## 0.19.0

### Minor Changes

- [#306](https://github.com/vultisig/vultisig-sdk/pull/306) [`c5f9c7b`](https://github.com/vultisig/vultisig-sdk/commit/c5f9c7bcac80d30f0b5e086c9e6860eaa0cf79a9) Thanks [@NeOMakinG](https://github.com/NeOMakinG)! - Add a React Native platform entry for @vultisig/sdk — new subpath export `@vultisig/sdk/react-native`, Hermes-safe tx builders + RPC helpers for 9 chains (EVM, Solana, Cosmos, Sui, TON, Tron, Ripple, UTXO, Cardano), `fastVaultSign` + relay orchestrators, and `configureRuntime` for consumer-injected endpoints. No breaking change for browser / node / electron / chrome-extension / vite consumers — all core chain/swap/balance helpers keep their original sync signatures; RN-only lazy loading is isolated in `packages/sdk/src/platforms/react-native/overrides/` and applied via rollup path-based intercept on the RN build target only. Bumped to `minor` per "new public API surface = minor" semver convention so consumers' `^0.x` ranges accept this only after they opt in.

  **Signature-meaningful fund-safety fixes (applied in R2 + R4 review rounds):**
  - `buildUtxoSendTx().finalize()` now returns a BIP141-compliant **txid** (computed from the witness-stripped base tx) for P2WPKH chains. Previously returned the wtxid, which is unusable for block-explorer / mempool lookups. Callers that persisted the old `txHashHex` for segwit chains (BTC, LTC) were recording the wrong hash.
  - `fastVaultSign` now throws if the MPC engine returns an ECDSA signature without a `recovery_id` (previously silently wrote `v=0`, producing a tx that recovers the wrong EVM signer).
  - `configureRuntime` now validates `vultiServerUrl` / `relayUrl` as http(s) URLs (previously accepted any string including `''`, silently exposing vault passwords to misconfigured endpoints).
  - `ReactNativeStorage.clear()` now calls `AsyncStorage.multiRemove` (was `removeMany`, which does not exist on `^2.x` — the shipped-consumer version — and threw at runtime on every `clear()` call).
  - BCH CashAddr decoder now verifies the polymod checksum before stripping it (previously accepted any typo'd address with valid base32 chars, producing a garbage pubKeyHash and signing the tx to an unrelated address).
  - Ripple `account_info` for unfunded accounts now returns `funded: false` instead of throwing on XRPL's `actNotFound` response.
  - Zcash sighash `branchId` is now a per-call parameter (defaulting to NU6.1) so future consensus upgrades don't require a shipped SDK release.
  - XRP `buildXrpSendTx().finalize()` now accepts both 128-char (`r||s`) and 130-char (`r||s||recovery_id`) hex signatures — `fastVaultSign` returns the 130-char shape for ECDSA, so every `build_xrp_send → fastVaultSign → finalize` flow previously threw at submit time.
  - UTXO base58 decoder now identifies P2SH addresses by version byte (`0x05` BTC, `0x32` LTC, `0x16` DOGE, `0x10` DASH, Zcash `t3...`) and emits the `OP_HASH160 <hash> OP_EQUAL` locking script; previously every base58 destination was re-encoded as P2PKH, so funds sent to a `3...` exchange deposit were locked under a hash that matched no spendable key.
  - Blockchair URL helpers (`getUtxos`, `getUtxoBalance`, `estimateUtxoFee`, `broadcastUtxoTx`) now respect the documented contract that `apiUrl` is already chain-scoped — previously they appended the slug a second time, producing `/blockchair/bitcoin/bitcoin/...` and 404s on every Blockchair-backed UTXO call.
  - `configureMpc` duplicate-engine guard now also reads `EXPO_PUBLIC_VULTISIG_STRICT_SINGLETON` as a fallback so Expo / React Native consumers can opt out of the dev throw without a custom Babel transform (Expo only inlines `EXPO_PUBLIC_*` env vars into the JS bundle). `VULTISIG_STRICT_SINGLETON` still wins when both are set.

## 0.18.0

### Minor Changes

- [#326](https://github.com/vultisig/vultisig-sdk/pull/326) [`f52057b`](https://github.com/vultisig/vultisig-sdk/commit/f52057b4af859018d1c180fa6db9ce15e153409f) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Expand `@vultisig/sdk/vite` into a browser preset: wasm plugin, polyfill shim resolution, `optimizeDeps` tuning, and serve/emit `7zz.wasm` at `/7zz.wasm` without writing into consumers' `public/` folders. Update docs and the browser example.

### Patch Changes

- [#307](https://github.com/vultisig/vultisig-sdk/pull/307) [`2018787`](https://github.com/vultisig/vultisig-sdk/commit/2018787f8101ea9a98e975c0e7477245c3f86fad) Thanks [@premiumjibles](https://github.com/premiumjibles)! - fix(sdk/vault): wrap invalid-receiver error in VaultError

  `getMaxSendAmount` now throws `VaultError(InvalidConfig)` instead of a generic `Error` when the receiver address fails validation. Matches how the rest of `VaultBase`'s address validation surfaces errors, so consumers checking `error.code` or `instanceof VaultError` catch it correctly.

## 0.17.1

### Patch Changes

- Updated dependencies [[`54731db`](https://github.com/vultisig/vultisig-sdk/commit/54731dbc0ded30adc7f76bbc5e3e532ef9414bb2)]:
  - @vultisig/mpc-types@0.2.1

## 0.17.0

### Minor Changes

- [#284](https://github.com/vultisig/vultisig-sdk/pull/284) [`219cb00`](https://github.com/vultisig/vultisig-sdk/commit/219cb00898deeaac418945a89c1d243f25aae152) Thanks [@premiumjibles](https://github.com/premiumjibles)! - feat(sdk): vault-free prep surface + LLM/agent utilities + token-resolution primitives
  - Vault-free `prepare*FromKeys` helpers that build unsigned `KeysignPayload`s from a `VaultIdentity` (raw public keys + identity metadata, no key shares): `prepareSendTxFromKeys`, `prepareSwapTxFromKeys`, `prepareContractCallTxFromKeys`, `prepareSignAminoTxFromKeys`, `prepareSignDirectTxFromKeys`, `getMaxSendAmountFromKeys`. Atomic chain helpers `getCoinBalance` and `getPublicKey` are also re-exported. `VaultBase`, `TransactionBuilder`, and `SwapService` delegate to these internally.
  - LLM/agent utilities: `fiatToAmount` + `FiatToAmountError`, `normalizeChain` + `UnknownChainError`.
  - Token-resolution primitives: `chainFeeCoin`, `knownTokens`, `knownTokensIndex`, `getTokenMetadata`, `getNativeSwapDecimals`, and supporting types `Coin`, `CoinKey`, `CoinMetadata`, `KnownCoin`, `KnownCoinMetadata`, `TokenMetadataResolver`, `VaultIdentity`.

## 0.16.0

### Minor Changes

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

- [#290](https://github.com/vultisig/vultisig-sdk/pull/290) [`83fe4c3`](https://github.com/vultisig/vultisig-sdk/commit/83fe4c3c58637aea4823d0eaa7f21d4c5cdf3dc7) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Add `@vultisig/sdk/vite` helper plugin so Vite consumers exclude wasm glue packages from `optimizeDeps`, and harden dist ESM relative import rewriting with tests.

## 0.15.5

### Patch Changes

- [`78772fd`](https://github.com/vultisig/vultisig-sdk/commit/78772fd061f3061c54802506218e5524a21714bd) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Fix MPC engine singleton so direct `@vultisig/core-mpc` / `@vultisig/mpc-types` / `@vultisig/mpc-wasm` imports register correctly across bundler chunks and Vite `optimizeDeps` scenarios.
  - Runtime singletons (MPC engine, WASM WalletCore getter, default storage factory, platform crypto) now live in a `globalThis`-anchored store keyed by `Symbol.for('vultisig.runtime.store.v1')`, eliminating duplicate-module-instance bugs.
  - `ensureMpcEngine()` added (async) — lazily registers the default `WasmMpcEngine` when no engine has been configured, so consumers that import only `@vultisig/core-mpc` no longer need to bootstrap the SDK.
  - `@vultisig/sdk` `sideEffects` narrowed from `false` to an allowlist of platform entry dist files, preventing tree-shakers from dropping the platform bootstrap.
  - `@vultisig/mpc-wasm` declared as an optional peer dependency of `@vultisig/mpc-types`.

  Closes [#287](https://github.com/vultisig/vultisig-sdk/issues/287).

- Updated dependencies [[`78772fd`](https://github.com/vultisig/vultisig-sdk/commit/78772fd061f3061c54802506218e5524a21714bd)]:
  - @vultisig/mpc-types@0.2.0
  - @vultisig/mpc-native@0.1.4

## 0.15.4

### Patch Changes

- [#276](https://github.com/vultisig/vultisig-sdk/pull/276) [`59382c1`](https://github.com/vultisig/vultisig-sdk/commit/59382c1859512fbd362962ede5e92b100d3a5921) Thanks [@rcoderdev](https://github.com/rcoderdev)! - feat(cli): structured machine-readable errors for agent ask, pipe, and executor
  - `agent ask --json` failures include stable `code` with existing `error` string
  - NDJSON pipe `error` events and failed `tool_result` lines include `code`
  - executor `ActionResult` failures carry `AgentErrorCode`; SSE errors accept optional backend `code`
  - document error codes in CLI README

## 0.15.3

### Patch Changes

- [#264](https://github.com/vultisig/vultisig-sdk/pull/264) [`69b23dc`](https://github.com/vultisig/vultisig-sdk/commit/69b23dca4b24c93c8bc2de51883a9b28e60485be) Thanks [@NeOMakinG](https://github.com/NeOMakinG)! - React Native platform entry now exports typed wrappers for `getPublicKey`, `deriveAddress`, `isValidAddress`, and `getCoinType` that accept `WalletCoreLike` from `@vultisig/walletcore-native` instead of `WalletCore` from `@trustwallet/wallet-core`. Consumers no longer need `as unknown as` casts at the SDK boundary. Also re-exports the `WalletCoreLike` type for convenience.

## 0.15.2

### Patch Changes

- [#263](https://github.com/vultisig/vultisig-sdk/pull/263) [`6585c38`](https://github.com/vultisig/vultisig-sdk/commit/6585c38431db063f600e133d1a23f84b7c19e934) Thanks [@rcoderdev](https://github.com/rcoderdev)! - fix(cli): align agent executor with backend payloads and harden action handling
  - model `tx_ready` / non-streaming transaction payloads with `TxReadyPayload`
  - optional `vultisig` on agent config for shared SDK state (e.g. address book)
  - executor improvements (chain locks, calldata resolution, EVM gas refresh) and unit tests

## 0.15.1

### Patch Changes

- Updated dependencies [[`91aa66a`](https://github.com/vultisig/vultisig-sdk/commit/91aa66a0c23576546895d0946b486ae37cf1b23d)]:
  - @vultisig/mpc-native@0.1.3

## 0.15.0

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

- [#234](https://github.com/vultisig/vultisig-sdk/pull/234) [`9f71a0e`](https://github.com/vultisig/vultisig-sdk/commit/9f71a0e430aadcb96707448c5e5e077aa0b561e0) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Add Vitest for the CLI package and run CLI tests from the root `yarn test` script. Unimplemented agent actions now return `success: false` with an error message instead of `success: true` with a `data.message` field.

## 0.14.3

### Patch Changes

- [#258](https://github.com/vultisig/vultisig-sdk/pull/258) [`0413dec`](https://github.com/vultisig/vultisig-sdk/commit/0413deccf249ecb284c5376a2a07e8ab12c47b48) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - fix: emit dedicated `dist/index.react-native.d.ts` from the react-native platform entry, and wire the `exports` field to resolve it under TypeScript's `react-native` custom condition — downstream consumers can now `import { keysign } from '@vultisig/sdk'` under Metro/Expo without hand-written module augmentations

- Updated dependencies [[`665cf03`](https://github.com/vultisig/vultisig-sdk/commit/665cf037951df40dc35068463c4ddd299cec20dd)]:
  - @vultisig/mpc-native@0.1.2

## 0.14.1

### Patch Changes

- Updated dependencies [[`0775049`](https://github.com/vultisig/vultisig-sdk/commit/07750496b7af1ece840501b8d884087e048c2b2c)]:
  - @vultisig/mpc-native@0.1.1

## 0.14.0

### Minor Changes

- [#222](https://github.com/vultisig/vultisig-sdk/pull/222) [`9e2ffd6`](https://github.com/vultisig/vultisig-sdk/commit/9e2ffd6f6a8e2c8ad507b6ed2e2c1232bf8a98c7) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - feat: add vault-free tools layer for MCP TypeScript rewrite

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

### Patch Changes

- [#210](https://github.com/vultisig/vultisig-sdk/pull/210) [`8bef556`](https://github.com/vultisig/vultisig-sdk/commit/8bef55651cba506a515083765d6f7745cce54abe) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Stop generating ML-DSA during secure vault creation, join, seedphrase import, and reshare. ECDSA and EdDSA only during the ceremony, matching mobile apps; ML-DSA remains available as a separate optional step.

- [#205](https://github.com/vultisig/vultisig-sdk/pull/205) [`99296f5`](https://github.com/vultisig/vultisig-sdk/commit/99296f5aaf3f9bfb7fe694de034037683e7435ed) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Classify vault import failures with specific `VaultImportErrorCode` values (`INVALID_FILE_FORMAT`, `INVALID_PASSWORD`, `UNSUPPORTED_FORMAT`, `CORRUPTED_DATA`) instead of wrapping most errors as `CORRUPTED_DATA`. Add unit tests for import edge cases.

## 0.13.0

### Minor Changes

- [#179](https://github.com/vultisig/vultisig-sdk/pull/179) [`84a2950`](https://github.com/vultisig/vultisig-sdk/commit/84a295002ed7310320b584fbccb76aaf4a233b31) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Add full QBTC (post-quantum Bitcoin) send support: MLDSA fast signing, address derivation, broadcast via Cosmos REST, funded e2e send test, and `scripts/add-mldsa-to-vault.ts` helper. Switch QBTC core resolvers from dead Tendermint RPC to vultisig Cosmos REST API.

### Patch Changes

- [#185](https://github.com/vultisig/vultisig-sdk/pull/185) [`3f46444`](https://github.com/vultisig/vultisig-sdk/commit/3f46444b2a11a41dbbb023919c2f168f9d15cff8) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Restore `publicKeyMldsa` and `keyShareMldsa` when hydrating fast and secure vaults from storage. Run the Vitest integration suite on every PR; keep the full agentic stack workflow manual-only.

## 0.12.0

### Minor Changes

- [#165](https://github.com/vultisig/vultisig-sdk/pull/165) [`4195641`](https://github.com/vultisig/vultisig-sdk/commit/4195641a9eb27d41fb27d2c6b605b34d4c4635b0) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Fast vault creation (CLI and SDK) no longer runs ML-DSA keygen; VultiServer only adds ML-DSA via `POST /mldsa`. Use `Vultisig.addPostQuantumKeysToFastVault` / `FastVault.addPostQuantumKeys` or CLI `vultisig add-mldsa` when post-quantum keys are needed. TSS batching for fast vault create now requests `ecdsa` and `eddsa` only. `MldsaKeygen` default relay message ids match VultiServer classic keygen (empty string); batch flows still pass `p-mldsa` explicitly.

### Patch Changes

- Updated dependencies [[`4195641`](https://github.com/vultisig/vultisig-sdk/commit/4195641a9eb27d41fb27d2c6b605b34d4c4635b0)]:
  - @vultisig/core-mpc@1.0.1

## 0.11.0

### Minor Changes

- [#157](https://github.com/vultisig/vultisig-sdk/pull/157) [`5286b98`](https://github.com/vultisig/vultisig-sdk/commit/5286b98d19692acd216a2c95d5a7a903217bef36) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Regenerate explicit `package.json` exports for `@vultisig/core-config` and `@vultisig/lib-utils` so directory and flat subpaths resolve under Node, TypeScript, and Vite.

  **Breaking (`@vultisig/core-chain`, `@vultisig/core-mpc`):** Remove the npm dependency cycle by dropping `@vultisig/core-mpc` from `core-chain`. Modules that required MPC types or keysign helpers now live under `@vultisig/core-mpc` (for example `tx/compile/compileTx`, `tx/preSigningHashes`, `chains/cosmos/qbtc/QBTCHelper`, Blockaid keysign input builders, `swap/native/utils/nativeSwapQuoteToSwapPayload`, `swap/utils/getSwapTrackingUrl`, and EVM `incrementKeysignPayloadNonce` at `keysign/signingInputs/resolvers/evm/incrementKeysignPayloadNonce`). `getUtxos` / `getCardanoUtxos` return plain `ChainPlainUtxo`; keysign maps to protobuf in MPC.

  **SDK:** QBTC support, shared import updates, and alignment with the new package boundaries.

### Patch Changes

- Updated dependencies [[`5286b98`](https://github.com/vultisig/vultisig-sdk/commit/5286b98d19692acd216a2c95d5a7a903217bef36)]:
  - @vultisig/core-config@0.9.1
  - @vultisig/lib-utils@0.9.1
  - @vultisig/core-chain@1.0.0
  - @vultisig/core-mpc@1.0.0

## 0.10.0

### Minor Changes

- [#149](https://github.com/vultisig/vultisig-sdk/pull/149) [`67dc6ce`](https://github.com/vultisig/vultisig-sdk/commit/67dc6ceaa1b318144cfbe3812ddecb14b108eba4) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Sync Windows-style TSS batching: batched FastVault APIs (`/batch/keygen`, `/batch/import`, `/batch/reshare`), batched relay message IDs for ECDSA, EdDSA, MLDSA, and per-chain import, secure vault QR `tssBatching=1` for joiner alignment, sequential fallbacks, and test coverage.

### Patch Changes

- Updated dependencies [[`67dc6ce`](https://github.com/vultisig/vultisig-sdk/commit/67dc6ceaa1b318144cfbe3812ddecb14b108eba4)]:
  - @vultisig/core-chain@0.10.0
  - @vultisig/core-mpc@0.10.0

## 0.9.0

### Minor Changes

- [#142](https://github.com/vultisig/vultisig-sdk/pull/142) [`75cf69f`](https://github.com/vultisig/vultisig-sdk/commit/75cf69f24cee843f9b508cc370c105e6339f01a8) Thanks [@realpaaao](https://github.com/realpaaao)! - Add compound wrapper methods to VaultBase: signMessage, allBalances, portfolio, send, swap. These chain existing atomic methods into single-call operations for agent-friendly DX.

- [#138](https://github.com/vultisig/vultisig-sdk/pull/138) [`b8770b3`](https://github.com/vultisig/vultisig-sdk/commit/b8770b33b3c38f3bd676e16e7c26f1464bb28548) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Integrate ML-DSA-44 post-quantum signing into the SDK signing pipeline and CLI output

- [#147](https://github.com/vultisig/vultisig-sdk/pull/147) [`8f2c9c6`](https://github.com/vultisig/vultisig-sdk/commit/8f2c9c6823d9e5ab0d882a5e8ba47715edaa54c8) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Publish shared chain, MPC, config, and lib packages to npm with compiled `dist/` output, deep subpath exports, and release workflow updates. SDK declares these packages as dependencies; `@vultisig/cli` is versioned with the SDK via changesets link.

### Patch Changes

- [#145](https://github.com/vultisig/vultisig-sdk/pull/145) [`60c1be9`](https://github.com/vultisig/vultisig-sdk/commit/60c1be943599c1d41dd2b6110dae05a40d50f74e) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Fix MLDSA keygen and signing for FastVault

- [#140](https://github.com/vultisig/vultisig-sdk/pull/140) [`813b160`](https://github.com/vultisig/vultisig-sdk/commit/813b16058c816853ed18a82dcc8b967047c46b50) Thanks [@RaghavSood](https://github.com/RaghavSood)! - Increase Osmosis gas fee from 7500 to 9000 uosmo to meet the chain's minimum fee requirement

- [#140](https://github.com/vultisig/vultisig-sdk/pull/140) [`813b160`](https://github.com/vultisig/vultisig-sdk/commit/813b16058c816853ed18a82dcc8b967047c46b50) Thanks [@RaghavSood](https://github.com/RaghavSood)! - Fix Sei EVM chain ID resolution to use 1329 instead of the default 1, which caused transaction signing failures on Sei

- [#140](https://github.com/vultisig/vultisig-sdk/pull/140) [`813b160`](https://github.com/vultisig/vultisig-sdk/commit/813b16058c816853ed18a82dcc8b967047c46b50) Thanks [@RaghavSood](https://github.com/RaghavSood)! - Fix Tron broadcast: use secp256k1Extended key type for 65-byte uncompressed public keys, and check the Tron API response for broadcast errors instead of silently succeeding

- [#140](https://github.com/vultisig/vultisig-sdk/pull/140) [`813b160`](https://github.com/vultisig/vultisig-sdk/commit/813b16058c816853ed18a82dcc8b967047c46b50) Thanks [@RaghavSood](https://github.com/RaghavSood)! - Remove hardcoded 1000 sat/byte Zcash fee override — use the standard UTXO fee rate lookup instead, which returns a reasonable fee that satisfies ZIP-317

- Updated dependencies [[`8f2c9c6`](https://github.com/vultisig/vultisig-sdk/commit/8f2c9c6823d9e5ab0d882a5e8ba47715edaa54c8)]:
  - @vultisig/core-chain@0.9.0
  - @vultisig/core-config@0.9.0
  - @vultisig/core-mpc@0.9.0
  - @vultisig/lib-utils@0.9.0
  - @vultisig/lib-dkls@0.9.0
  - @vultisig/lib-mldsa@0.9.0
  - @vultisig/lib-schnorr@0.9.0

## 0.8.0

### Minor Changes

- [#125](https://github.com/vultisig/vultisig-sdk/pull/125) [`7677523`](https://github.com/vultisig/vultisig-sdk/commit/76775232866dccf4e1e85aa0fe0d91c2fd8fdddb) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Use production notification API base path `/notification` (aligned with iOS), extend `PushNotificationService` for web device registration and WebSocket flows, export `computeNotificationVaultId`, add notification mock E2E tests, and ship a `live-web-push-e2e` harness for browser Web Push verification.

### Patch Changes

- [#121](https://github.com/vultisig/vultisig-sdk/pull/121) [`da88c6f`](https://github.com/vultisig/vultisig-sdk/commit/da88c6f06b8d74ccb5642f793e386d85ff6f30b1) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Fix SecureVault join keygen/import (sorted committee, ML-DSA on joiners, relay `/start` semantics), increase default MPC relay round timeouts, use `ServerManager.messageRelay` in join/import paths, and stabilize E2E (serial files, heap, harness tweaks).

- [#118](https://github.com/vultisig/vultisig-sdk/pull/118) [`4b29636`](https://github.com/vultisig/vultisig-sdk/commit/4b29636514edccf0980eddf5e8fffacfcb31c88f) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Enable strictNullChecks, fix TypeScript check system, and update dependencies

## 0.7.0

### Minor Changes

- [#113](https://github.com/vultisig/vultisig-sdk/pull/113) [`da68dda`](https://github.com/vultisig/vultisig-sdk/commit/da68dda0622a024af35666bb7b7088dea4cf3cfd) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Add `--two-step` flag for fast vault creation with persistent pending vault state and cross-session verification

## 0.6.0

### Minor Changes

- [#100](https://github.com/vultisig/vultisig-sdk/pull/100) [`26d3cae`](https://github.com/vultisig/vultisig-sdk/commit/26d3cae3066a316d1e9429a2664a6b4ea18dd8a2) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Add ML-DSA (post-quantum) keygen to all vault creation flows and sync CosmosMsgType
  - Integrate ML-DSA keygen as a third step (after ECDSA + EdDSA) in SecureVaultCreationService, ServerManager, FastVaultFromSeedphraseService, and SecureVaultFromSeedphraseService
  - Populate `publicKeyMldsa` and `keyShareMldsa` fields on created vaults
  - Add ML-DSA step to reshare flow in SecureVaultCreationService
  - Add `'mldsa'` to `KeygenPhase` type
  - Add `ThorchainMsgLeavePool` and `ThorchainMsgLeavePoolUrl` to `CosmosMsgType`

- [#100](https://github.com/vultisig/vultisig-sdk/pull/100) [`2ed545f`](https://github.com/vultisig/vultisig-sdk/commit/2ed545fb20f5920cb70d096076d55756cea222aa) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Add push notification support for multi-party signing coordination

  New `PushNotificationService` accessible via `sdk.notifications` enables the full vault notification flow:
  - **Register**: Register devices (iOS/Android/Web) to receive push notifications for a vault
  - **Notify**: Notify other vault members with keysign session data when initiating signing
  - **Receive**: Handle incoming push notifications with typed callbacks and payload parsing

  Platform-agnostic design — SDK handles server communication while consumers wire their platform's push infrastructure (APNs, FCM, Web Push).

- [#100](https://github.com/vultisig/vultisig-sdk/pull/100) [`a2d545b`](https://github.com/vultisig/vultisig-sdk/commit/a2d545b96794cce087eb4ea8ce955db20212c926) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Sync upstream core/lib changes and add new SDK features
  - **`getTxStatus()`**: New method on VaultBase to check transaction confirmation status across all supported chains. Emits `transactionConfirmed` and `transactionFailed` events. Supports EVM, UTXO, Cosmos, Solana, THORChain, and more.
  - **ML-DSA (post-quantum) WASM support**: Added `@lib/mldsa` package and integrated ML-DSA WASM initialization across all platforms (browser, Node.js, Electron, Chrome extension).
  - **Upstream sync**: Core/lib updates including Cosmos fee resolver improvements, Solana signing fixes, keygen step updates, and protobuf type regeneration.

- [#100](https://github.com/vultisig/vultisig-sdk/pull/100) [`f5176ba`](https://github.com/vultisig/vultisig-sdk/commit/f5176ba4a9fda2c82b6264a958d61d5170e3d2cd) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Add WebSocket real-time notification delivery to PushNotificationService

  New methods on `sdk.notifications`:
  - `connect(options)` — Open WebSocket for real-time signing notifications with auto-reconnect
  - `disconnect()` — Close WebSocket and stop reconnect (also called by `sdk.dispose()`)
  - `connectionState` — Current connection state (`disconnected` | `connecting` | `connected` | `reconnecting`)
  - `onConnectionStateChange(handler)` — Subscribe to connection state changes

  Messages are delivered through the existing `onSigningRequest()` callbacks. Auto-reconnects with exponential backoff (1s → 30s cap). Server retains unacked messages for 60s for reliable delivery across reconnections.

### Patch Changes

- [#114](https://github.com/vultisig/vultisig-sdk/pull/114) [`355c700`](https://github.com/vultisig/vultisig-sdk/commit/355c700e7caca812199fafceb3767b8b3c5fd236) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Inline all `@core/*` and `@lib/*` types into bundled `.d.ts` files so external consumers no longer get unresolved import paths. Fixes circular type resolution errors when the consuming workspace has its own `@core/*` packages.

- [#100](https://github.com/vultisig/vultisig-sdk/pull/100) [`78f8bd2`](https://github.com/vultisig/vultisig-sdk/commit/78f8bd237dc3ca6f42dd268d069ed8f7902e733b) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - feat(examples): add transaction confirmation polling to example UI

  Adds `getTxStatus` support to the browser and electron example apps with non-blocking
  background polling after broadcast. The success banner shows immediately after broadcast
  with a "Confirming..." spinner, then updates to "Transaction Confirmed!" (with fee) or
  "Transaction failed on-chain" when the poll resolves.

  Also fixes:
  - Missing `MaxSendAmountResult` re-export from shared package
  - `@cosmjs/proto-signing` not externalized in SDK rollup config (caused runtime crash in browser)

## 0.5.0

### Minor Changes

- [#97](https://github.com/vultisig/vultisig-sdk/pull/97) [`cd57d64`](https://github.com/vultisig/vultisig-sdk/commit/cd57d6482e08bd6172550ec4eea0e0233abd7f76) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Add max send/swap support across SDK, CLI, and example apps
  - Add `vault.getMaxSendAmount()` returning `{ balance, fee, maxSendable }` for fee-accurate max sends
  - Add `vault.estimateSendFee()` for gas estimation without max calculation
  - Enrich `getSwapQuote()` with `balance` and `maxSwapable` fields
  - CLI: Add `--max` flag to `send`, `swap`, and `swap-quote` commands
  - Browser/Electron examples: Add "Max" button to Send and Swap screens
  - Fix native token ticker resolution in example swap UI (was using chain name instead of ticker)

- [#97](https://github.com/vultisig/vultisig-sdk/pull/97) [`ea1e8d5`](https://github.com/vultisig/vultisig-sdk/commit/ea1e8d5dd14a7273021577471e44719609f983ca) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Add vault reshare support, fix secure vault creation progress steps, and add balancesWithPrices method
  - Add `performReshare()` to Vultisig class and SecureVaultCreationService for vault reshare operations
  - Fix secure vault creation progress mapping so QR code and device discovery UI display correctly during the waiting-for-devices phase
  - Add `balancesWithPrices()` to VaultBase that returns balances enriched with price and fiat value data from FiatValueService

- [#97](https://github.com/vultisig/vultisig-sdk/pull/97) [`3f5fdcb`](https://github.com/vultisig/vultisig-sdk/commit/3f5fdcbfbe23aa287dfbcb38e9be6c904af9caf0) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Add SDK gap features for extension migration: token registry (getKnownTokens, getKnownToken, getFeeCoin), price feeds (getCoinPrices), security scanning (scanSite, validateTransaction, simulateTransaction), fiat on-ramp (getBanxaSupportedChains, getBuyUrl), token discovery (discoverTokens, resolveToken), and CosmosMsgType constants. All features use SDK-owned types decoupled from core internals.

### Patch Changes

- [#95](https://github.com/vultisig/vultisig-sdk/pull/95) [`bd543af`](https://github.com/vultisig/vultisig-sdk/commit/bd543af73a50a4ce431f38e3ed77511c4ef65ea7) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Align SDK dependency versions with upstream core packages
  - viem: 2.37.4 → ^2.45.1 (external - critical for consumers)
  - @trustwallet/wallet-core: ^4.3.22 → ^4.6.0 (external)
  - @bufbuild/protobuf: ^2.10.2 → ^2.11.0 (external)
  - @mysten/sui: ^1.37.6 → ^2.3.0 (SUI v2 migration)
  - @lifi/sdk: ^3.12.2 → ^3.15.5
  - i18next: ^25.5.2 → ^25.8.4

- [#95](https://github.com/vultisig/vultisig-sdk/pull/95) [`74516fa`](https://github.com/vultisig/vultisig-sdk/commit/74516fae8dabd844c9e0793b932f6284ce9aa009) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Add SDK-level chain validation to catch invalid enum values (e.g. "BitcoinCash" vs Chain.BitcoinCash) with descriptive error messages. Fix incorrect CoinType mappings for CronosChain and Sei in MasterKeyDeriver. Fix SwapService crash on general swap quotes by unwrapping SwapQuote wrapper to access the inner discriminated union.

- [#97](https://github.com/vultisig/vultisig-sdk/pull/97) [`7ceab79`](https://github.com/vultisig/vultisig-sdk/commit/7ceab79e53986bfefa3f5d4cb5d25855572fbd3f) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Use KeysignLibType for keysign payloads to correctly handle seedphrase-imported vaults

- [#97](https://github.com/vultisig/vultisig-sdk/pull/97) [`e172aff`](https://github.com/vultisig/vultisig-sdk/commit/e172aff35aff86d182646a521dc1e3ac9e381f60) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - fix: address PR review bugs and safety issues
  - Fix missing ChromeExtensionPolyfills import causing build failure
  - Fix floating-point precision loss in CLI amount parsing for high-decimal tokens
  - Fix BigInt crash on non-integer amount strings in swap validation
  - Fix Number exponentiation precision loss in VaultSend formatAmount
  - Use VaultError with error codes in chain validation instead of generic Error
  - Add chainId mismatch validation in signAndBroadcast
  - Add hex string input validation in hexDecode
  - Guard against empty accounts array in client getAddress
  - Use stricter bech32 THORChain address validator in deposit module

- [#95](https://github.com/vultisig/vultisig-sdk/pull/95) [`6c5c77c`](https://github.com/vultisig/vultisig-sdk/commit/6c5c77ceb49620f711285effee98b052e6aab1f8) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Sync upstream core and lib from vultisig-windows
  - Solana: support multiple raw transactions in signing inputs
  - EVM: fetch token logos from 1Inch API in metadata resolver
  - Cosmos: normalize fee denominations with toChainFeeDenom helper
  - Cosmos: filter out TCY autocompounder share denom from coin discovery
  - Cosmos: add AZTEC token to Thorchain known tokens
  - Swap: add getSwapTrackingUrl utility for block explorer URLs
  - Remove unused getRecordSize utility

## 0.4.3

### Patch Changes

- [#95](https://github.com/vultisig/vultisig-sdk/pull/95) [`182f723`](https://github.com/vultisig/vultisig-sdk/commit/182f723ec9b7c68988ac69e9a136c8d8c482c6c1) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Align SDK dependency versions with upstream core packages
  - viem: 2.37.4 → ^2.45.1 (external - critical for consumers)
  - @trustwallet/wallet-core: ^4.3.22 → ^4.6.0 (external)
  - @bufbuild/protobuf: ^2.10.2 → ^2.11.0 (external)
  - @mysten/sui: ^1.37.6 → ^2.3.0 (SUI v2 migration)
  - @lifi/sdk: ^3.12.2 → ^3.15.5
  - i18next: ^25.5.2 → ^25.8.4

- [#95](https://github.com/vultisig/vultisig-sdk/pull/95) [`182f723`](https://github.com/vultisig/vultisig-sdk/commit/182f723ec9b7c68988ac69e9a136c8d8c482c6c1) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Fix opaque "is not a function" error when chain value doesn't match enum (e.g. BCH). match() now throws a descriptive error with the bad value and available handlers. Also fix incorrect CoinType mappings for CronosChain and Sei in MasterKeyDeriver.

- [#95](https://github.com/vultisig/vultisig-sdk/pull/95) [`182f723`](https://github.com/vultisig/vultisig-sdk/commit/182f723ec9b7c68988ac69e9a136c8d8c482c6c1) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Sync upstream core and lib from vultisig-windows
  - Solana: support multiple raw transactions in signing inputs
  - EVM: fetch token logos from 1Inch API in metadata resolver
  - Cosmos: normalize fee denominations with toChainFeeDenom helper
  - Cosmos: filter out TCY autocompounder share denom from coin discovery
  - Cosmos: add AZTEC token to Thorchain known tokens
  - Swap: add getSwapTrackingUrl utility for block explorer URLs
  - Remove unused getRecordSize utility

## 0.4.2

### Patch Changes

- [#91](https://github.com/vultisig/vultisig-sdk/pull/91) [`57adaf8`](https://github.com/vultisig/vultisig-sdk/commit/57adaf8b391dc57956073b4b06efa3f7566a275a) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - fix(sdk): fix SecureVault relay signing for EdDSA chains
  - Fix QR payload to include full transaction details using `getJoinKeysignUrl` from core
  - Fix chainPath derivation using `getChainSigningInfo` adapter
  - Fix EdDSA signature format: use raw r||s (128 hex chars) instead of DER encoding

  Affected chains: Solana, Sui, Polkadot, TON, Cardano

## 0.4.1

### Patch Changes

- [#89](https://github.com/vultisig/vultisig-sdk/pull/89) [`e5812b7`](https://github.com/vultisig/vultisig-sdk/commit/e5812b743a3e1c8ce27b81f8940d5c818cf66017) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Fix EdDSA signature verification failure for Solana and other EdDSA chains

  The signature format conversion was corrupting EdDSA signatures by round-tripping through DER encoding. EdDSA signatures now store raw r||s format directly, preserving the correct endianness from keysign.

  Affected chains: Solana, Sui, Polkadot, Ton, Cardano

- [#89](https://github.com/vultisig/vultisig-sdk/pull/89) [`f0d39d2`](https://github.com/vultisig/vultisig-sdk/commit/f0d39d2615968ea2761c1e19d64b2a54ba72a1a9) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Fix FastVault signing to show session ID instead of "undefined" in server acknowledgment log, and add missing `chain` parameter to signWithServer call

## 0.4.0

### Minor Changes

- [#84](https://github.com/vultisig/vultisig-sdk/pull/84) [`86cf505`](https://github.com/vultisig/vultisig-sdk/commit/86cf50517a528a0ef43c36b70c477adbec245160) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - feat: add Phantom wallet Solana derivation path support

  When importing a seedphrase, the SDK now detects if the mnemonic was originally created in Phantom wallet by checking both the standard Solana BIP44 path and Phantom's non-standard path (`m/44'/501'/0'/0'`).

  **SDK changes:**
  - `discoverChainsFromSeedphrase()` now returns `ChainDiscoveryAggregate` with `results` and `usePhantomSolanaPath` flag
  - Added `usePhantomSolanaPath` option to `createFastVaultFromSeedphrase()`, `createSecureVaultFromSeedphrase()`, and `joinSecureVault()`
  - Auto-detection during chain discovery: uses Phantom path when it has balance and standard path doesn't

  **CLI changes:**
  - Added `--use-phantom-solana-path` flag to `create-from-seedphrase fast` and `create-from-seedphrase secure` commands

  **Examples:**
  - Added Phantom Solana path toggle checkbox in SeedphraseImporter component

- [#84](https://github.com/vultisig/vultisig-sdk/pull/84) [`86cf505`](https://github.com/vultisig/vultisig-sdk/commit/86cf50517a528a0ef43c36b70c477adbec245160) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Add automatic VULT discount tier support for swap affiliate fees
  - Add `DiscountTierService` that fetches VULT token and Thorguard NFT balances on Ethereum
  - Automatically apply discount tiers (bronze through ultimate) to all swap quotes
  - Add `vault.getDiscountTier()` to check current discount tier
  - Add `vault.updateDiscountTier()` to force refresh after acquiring more VULT
  - Remove manual `affiliateBps` parameter from swap quote params (now automatic)
  - Cache discount tier for 15 minutes to minimize RPC calls

### Patch Changes

- [#84](https://github.com/vultisig/vultisig-sdk/pull/84) [`86cf505`](https://github.com/vultisig/vultisig-sdk/commit/86cf50517a528a0ef43c36b70c477adbec245160) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - feat(examples): add discount tier display to browser and electron examples
  - Add `getDiscountTier()` and `updateDiscountTier()` to ISDKAdapter interface
  - Implement discount tier methods in BrowserSDKAdapter and ElectronSDKAdapter
  - Add VULT Discount Tier card to VaultOverview with color-coded tier badge and refresh button
  - Display discount tier in swap quote details
  - Update browser README with discount tier and swap documentation

- [#84](https://github.com/vultisig/vultisig-sdk/pull/84) [`86cf505`](https://github.com/vultisig/vultisig-sdk/commit/86cf50517a528a0ef43c36b70c477adbec245160) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - fix: address code review items across SDK and CLI

  **CLI improvements:**
  - Fix Phantom path detection message to use effective flag value
  - Add ambiguous vault detection in delete command with descriptive error messages
  - Refactor `findVaultByIdOrName` to use object parameter and throw on ambiguous matches
  - Import tier config from SDK instead of hardcoding values in discount command

  **SDK improvements:**
  - Export VULT discount tier configuration for CLI consumption
  - Add error handling in SwapService using attempt/withFallback pattern

  **Documentation fixes:**
  - Add `text` language identifier to code fence in CLI README
  - Remove redundant "originally" word from Phantom wallet descriptions
  - Update "affiliate fee discounts" to "swap fee discounts" terminology

- [#84](https://github.com/vultisig/vultisig-sdk/pull/84) [`86cf505`](https://github.com/vultisig/vultisig-sdk/commit/86cf50517a528a0ef43c36b70c477adbec245160) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Sync upstream changes and use core's defaultChains
  - Import `defaultChains` from core instead of defining locally in SDK
  - Default chains now: Bitcoin, Ethereum, THORChain, Solana, BSC
  - Upstream: Added thor.ruji and thor.rune token metadata
  - Upstream: Fixed commVault serialization for empty chain keys
  - Upstream: Enhanced formatAmount with suffix support

- [#84](https://github.com/vultisig/vultisig-sdk/pull/84) [`86cf505`](https://github.com/vultisig/vultisig-sdk/commit/86cf50517a528a0ef43c36b70c477adbec245160) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Use core's `vaultConfig.maxNameLength` for vault name validation instead of hardcoded value

## 0.3.0

### Minor Changes

- [#71](https://github.com/vultisig/vultisig-sdk/pull/71) [`695e664`](https://github.com/vultisig/vultisig-sdk/commit/695e664668082ca55861cf4d8fcc8c323be94c06) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - feat(sdk): add multi-language BIP39 mnemonic support

  **New Features:**
  - Support for all 10 BIP39 languages: English, Japanese, Korean, Spanish, Chinese (Simplified/Traditional), French, Italian, Czech, Portuguese
  - Auto-detection of mnemonic language during validation
  - Explicit language validation with `{ language: 'japanese' }` option
  - Word suggestions for autocomplete with `getSuggestions(prefix, language)`
  - Japanese ideographic space (U+3000) handling
  - Proper Unicode NFKD normalization

  **New Exports:**
  - `Bip39Language` - Union type of supported languages
  - `BIP39_LANGUAGES` - Array of supported language codes
  - `SeedphraseValidationOptions` - Options for explicit language validation
  - `detectMnemonicLanguage()` - Detect language from mnemonic
  - `getWordlist()` - Get wordlist for a specific language
  - `BIP39_WORDLISTS` - Map of all wordlists
  - `normalizeMnemonic()` - Normalize mnemonic with Unicode handling

  **API Usage:**

  ```typescript
  // Auto-detect language
  const result = await sdk.validateSeedphrase(japaneseMnemonic);
  console.log(result.detectedLanguage); // 'japanese'

  // Explicit language
  const result = await sdk.validateSeedphrase(mnemonic, { language: "korean" });
  ```

- [#71](https://github.com/vultisig/vultisig-sdk/pull/71) [`d145809`](https://github.com/vultisig/vultisig-sdk/commit/d145809eb68653a3b22921fcb90ebc985de2b16a) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - feat(sdk): rename seedphrase import APIs and add joinSecureVault method

  **Breaking Changes:**
  - `importSeedphraseAsFastVault()` → `createFastVaultFromSeedphrase()`
  - `importSeedphraseAsSecureVault()` → `createSecureVaultFromSeedphrase()`
  - Type renames: `ImportSeedphraseAsFastVaultOptions` → `CreateFastVaultFromSeedphraseOptions`, etc.

  **New Features:**
  - `joinSecureVault(qrPayload, options)` - Programmatically join SecureVault creation sessions
    - Auto-detects keygen vs seedphrase mode from QR payload's `libType` field
    - For keygen sessions: no mnemonic required
    - For seedphrase sessions: `mnemonic` option required and must match initiator's

  **Documentation:**
  - Updated README.md with new method names and `joinSecureVault()` API docs
  - Updated SDK-USERS-GUIDE.md with new section "Joining a SecureVault Session"

### Patch Changes

- [#71](https://github.com/vultisig/vultisig-sdk/pull/71) [`fee3f37`](https://github.com/vultisig/vultisig-sdk/commit/fee3f375f85011d14be814f06ff3d7f6684ea2fe) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - fix: address CodeRabbit PR #71 review suggestions

  **Critical fixes:**
  - JoinSecureVaultService: require `devices` parameter instead of defaulting to 2
  - CLI vault-management: validate `devices` parameter before calling SDK
  - parseKeygenQR: throw error on unknown libType instead of silently defaulting

  **Code quality:**
  - Replace try-catch with attempt() pattern in JoinSecureVaultService and parseKeygenQR
  - Add abort signal checks in SecureVaultJoiner callbacks

  **Documentation:**
  - Add onProgress callback to joinSecureVault README documentation
  - Fix markdown heading format in SDK-USERS-GUIDE.md
  - Add language specifier to code block in CLAUDE.md

  **Tests:**
  - Fix Korean test mnemonic (removed invalid comma)
  - Add Korean language detection test
  - Remove sensitive private key logging in test helpers

- [#72](https://github.com/vultisig/vultisig-sdk/pull/72) [`4edf52d`](https://github.com/vultisig/vultisig-sdk/commit/4edf52d3a2985d2adf772239bf19b8301f360af8) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - fix: address review comments for type safety and test reliability

  **Type safety:**
  - JoinSecureVaultOptions: make `devices` field required (was optional but enforced at runtime)
  - parseKeygenQR: validate chains against Chain enum instead of unsafe cast

  **Test improvements:**
  - generateTestPartyId: use deterministic index-based suffix to avoid collisions
  - multi-party-keygen-helpers: fail-fast when chainCodeHex is missing instead of silent fallback
  - languageDetection tests: replace invalid Chinese mnemonics with valid BIP39 test vectors
  - Add Chinese Simplified and Traditional language detection tests

  **Documentation:**
  - README: rename "Import from Seedphrase" to "Create Vault from Seedphrase" to match API naming

## 0.2.0

### Minor Changes

- [#68](https://github.com/vultisig/vultisig-sdk/pull/68) [`7979f3c`](https://github.com/vultisig/vultisig-sdk/commit/7979f3c502ea04db3c3de551bee297b8a9f9808b) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Add AbortSignal support for keygen and seedphrase import operations
  - Added `signal?: AbortSignal` parameter to `createFastVault()`, `createSecureVault()`, `importSeedphraseAsFastVault()`, and `importSeedphraseAsSecureVault()`
  - Abort checks are performed at natural breakpoints: in waitForPeers loops, between ECDSA/EdDSA keygen phases, and between per-chain key imports
  - Allows users to cancel long-running vault creation operations gracefully using standard AbortController API

- [#56](https://github.com/vultisig/vultisig-sdk/pull/56) [`7f60cd5`](https://github.com/vultisig/vultisig-sdk/commit/7f60cd5835510bd9110d6382cf7d03bf1d5e04ff) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - feat(sdk): add signBytes() method for signing arbitrary pre-hashed data

  Adds a new `signBytes()` method to vaults that allows signing arbitrary byte arrays:
  - Accepts `Uint8Array`, `Buffer`, or hex string input
  - Uses chain parameter to determine signature algorithm (ECDSA/EdDSA) and derivation path
  - Available on FastVault (implemented) and SecureVault (placeholder for future)

  Example usage:

  ```typescript
  const sig = await vault.signBytes({
    data: keccak256(message),
    chain: Chain.Ethereum,
  });
  ```

- [#64](https://github.com/vultisig/vultisig-sdk/pull/64) [`a36a7f6`](https://github.com/vultisig/vultisig-sdk/commit/a36a7f614c03e32ebc7e843cbf1ab30b6be0d4af) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - feat(sdk): add broadcastRawTx() for broadcasting pre-signed transactions

  Adds `broadcastRawTx()` method supporting all chain families:
  - EVM: Ethereum, Polygon, BSC, Arbitrum, Base, etc. (hex-encoded)
  - UTXO: Bitcoin, Litecoin, Dogecoin, etc. (hex-encoded)
  - Solana: Base58 or Base64 encoded transaction bytes
  - Cosmos: JSON `{tx_bytes}` or raw base64 protobuf (10 chains)
  - TON: BOC as base64 string
  - Polkadot: Hex-encoded extrinsic
  - Ripple: Hex-encoded transaction blob
  - Sui: JSON `{unsignedTx, signature}`
  - Tron: JSON transaction object

  CLI commands added:
  - `vultisig sign --chain <chain> --bytes <base64>` - sign pre-hashed data
  - `vultisig broadcast --chain <chain> --raw-tx <data>` - broadcast raw tx

  Documentation updated with complete workflow examples for EVM, UTXO, Solana, and Sui.

- [#68](https://github.com/vultisig/vultisig-sdk/pull/68) [`7979f3c`](https://github.com/vultisig/vultisig-sdk/commit/7979f3c502ea04db3c3de551bee297b8a9f9808b) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Add SignAmino and SignDirect Cosmos SDK signing methods

  This release adds support for custom Cosmos transaction signing with two new methods:
  - `vault.prepareSignAminoTx()` - Sign using the legacy Amino (JSON) format
  - `vault.prepareSignDirectTx()` - Sign using the modern Protobuf format

  These methods enable governance votes, staking operations, IBC transfers, and other custom Cosmos transactions across all supported Cosmos SDK chains (Cosmos, Osmosis, THORChain, MayaChain, Dydx, Kujira, Terra, TerraClassic, Noble, Akash).

  New exported types:
  - `SignAminoInput`, `SignDirectInput`
  - `CosmosMsgInput`, `CosmosFeeInput`, `CosmosCoinAmount`
  - `CosmosSigningOptions`

- [#55](https://github.com/vultisig/vultisig-sdk/pull/55) [`95ba10b`](https://github.com/vultisig/vultisig-sdk/commit/95ba10baf2dc2dc4ba8e48825f10f34ec275a73c) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - **BREAKING**: Change fast vault creation API to return vault from verification
  - `createFastVault()` now returns `Promise<string>` (just the vaultId)
  - `verifyVault()` now returns `Promise<FastVault>` instead of `Promise<boolean>`
  - Vault is only persisted to storage after successful email verification
  - If process is killed before verification, vault is lost (user recreates)

  This is a cleaner API - the user only gets the vault after it's verified and persisted.

- [#68](https://github.com/vultisig/vultisig-sdk/pull/68) [`7979f3c`](https://github.com/vultisig/vultisig-sdk/commit/7979f3c502ea04db3c3de551bee297b8a9f9808b) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Remove internal-only exports from public API for GA launch

  Removed exports that were implementation details not intended for SDK users:
  - `FastSigningInput` - internal signing type
  - `MasterKeyDeriver` - internal key derivation class
  - `ChainDiscoveryService` - internal chain discovery class
  - `SeedphraseValidator` - internal class (use `validateSeedphrase()` function instead)
  - `cleanMnemonic` - internal utility function
  - `FastVaultSeedphraseImportService` - internal service
  - `SecureVaultSeedphraseImportService` - internal service
  - `DerivedMasterKeys` - internal type

  Users should use the `Vultisig` class methods for seedphrase import operations instead of these internal services.

- [#60](https://github.com/vultisig/vultisig-sdk/pull/60) [`b4cf357`](https://github.com/vultisig/vultisig-sdk/commit/b4cf357c98ef493b48c807e5bb45cd40b9893295) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - feat: Add SecureVault support for multi-device MPC vaults
  - Implement SecureVault.create() for multi-device keygen ceremony
  - Add RelaySigningService for coordinated signing via relay server
  - Implement SecureVault.sign() and signBytes() methods
  - Add QR code generation for mobile app pairing (compatible with Vultisig iOS/Android)
  - CLI: Add `vault create --type secure` with terminal QR display
  - CLI: Support secure vault signing with device coordination
  - Add comprehensive unit, integration, and E2E tests

- [#68](https://github.com/vultisig/vultisig-sdk/pull/68) [`7979f3c`](https://github.com/vultisig/vultisig-sdk/commit/7979f3c502ea04db3c3de551bee297b8a9f9808b) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Add per-chain MPC key import for feature parity with vultisig-windows

  Seedphrase import now runs MPC key import for each chain's derived key, matching vultisig-windows behavior. This ensures imported vaults have chain-specific key shares that can be used for signing.

  **Changes:**
  - `MasterKeyDeriver.ts`: Add `deriveChainPrivateKeys()` method for batch chain key derivation
  - `FastVaultSeedphraseImportService.ts`: Add per-chain MPC import loop, fix lib_type to use KEYIMPORT (2)
  - `SecureVaultSeedphraseImportService.ts`: Add per-chain MPC import loop, include chains in QR KeygenMessage

  **How it works:**
  For N chains, import runs N+2 MPC rounds:
  1. Master ECDSA key via DKLS
  2. Master EdDSA key via Schnorr
  3. Each chain's key via DKLS (ECDSA chains) or Schnorr (EdDSA chains)

  The vault now includes `chainPublicKeys` and `chainKeyShares` populated with results from per-chain MPC imports.

- [#68](https://github.com/vultisig/vultisig-sdk/pull/68) [`7979f3c`](https://github.com/vultisig/vultisig-sdk/commit/7979f3c502ea04db3c3de551bee297b8a9f9808b) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Add seedphrase (BIP39 mnemonic) import functionality

  This release adds the ability to import existing wallets from BIP39 mnemonic phrases (12 or 24 words) into Vultisig vaults, mirroring the iOS implementation.

  **New SDK Methods:**
  - `sdk.validateSeedphrase()` - Validate a BIP39 mnemonic phrase
  - `sdk.discoverChainsFromSeedphrase()` - Discover chains with balances before import
  - `sdk.importSeedphraseAsFastVault()` - Import as FastVault (2-of-2 with VultiServer)
  - `sdk.importSeedphraseAsSecureVault()` - Import as SecureVault (N-of-M multi-device)

  **Features:**
  - Chain discovery with progress callbacks to find existing balances
  - Auto-enable chains with balances during import
  - EdDSA key transformation using SHA-512 clamping for Schnorr TSS compatibility
  - Full ECDSA (secp256k1) and EdDSA (ed25519) master key derivation

  **New exported types:**
  - `SeedphraseValidation`, `ChainDiscoveryProgress`, `ChainDiscoveryResult`
  - `ChainDiscoveryPhase`, `DerivedMasterKeys`
  - `ImportSeedphraseAsFastVaultOptions`, `ImportSeedphraseAsSecureVaultOptions`
  - `SeedphraseImportResult`

  **New services:**
  - `SeedphraseValidator` - BIP39 validation using WalletCore
  - `MasterKeyDeriver` - Key derivation from mnemonic
  - `ChainDiscoveryService` - Balance scanning across chains
  - `FastVaultSeedphraseImportService` - FastVault import orchestration
  - `SecureVaultSeedphraseImportService` - SecureVault import orchestration

  **New CLI Commands:**
  - `vultisig import-seedphrase fast` - Import as FastVault (2-of-2 with VultiServer)
  - `vultisig import-seedphrase secure` - Import as SecureVault (N-of-M multi-device)

  **CLI Features:**
  - Secure seedphrase input (masked with `*`)
  - `--discover-chains` flag to scan for existing balances
  - `--chains` flag to specify chains (comma-separated)
  - Interactive shell support with tab completion
  - Progress spinners during import

### Patch Changes

- [#57](https://github.com/vultisig/vultisig-sdk/pull/57) [`22bb16b`](https://github.com/vultisig/vultisig-sdk/commit/22bb16be8421a51aa32da6c1166539015380651e) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Optimize SDK bundling configuration
  - Add terser minification (~60% bundle size reduction)
  - Add clean script to remove stale dist files before builds
  - Centralize duplicated onwarn handler in rollup config
  - Add package.json exports for react-native and electron platforms

- [`cc96f64`](https://github.com/vultisig/vultisig-sdk/commit/cc96f64622a651eb6156f279afbbfe0aa4219179) - fix: re-release as alpha (0.1.0 was accidentally published as stable)

- [#68](https://github.com/vultisig/vultisig-sdk/pull/68) [`7979f3c`](https://github.com/vultisig/vultisig-sdk/commit/7979f3c502ea04db3c3de551bee297b8a9f9808b) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Fix CodeRabbit review issues for beta-3 release
  - Fix `@noble/hashes` import path for v2 compatibility (sha512 → sha2)
  - Fix chainPublicKeys/chainKeyShares persistence in VaultData to prevent data loss on vault reload

- [#68](https://github.com/vultisig/vultisig-sdk/pull/68) [`7979f3c`](https://github.com/vultisig/vultisig-sdk/commit/7979f3c502ea04db3c3de551bee297b8a9f9808b) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Fix EdDSA public key derivation and ChainDiscoveryService issues
  - Fix `deriveChainKey` to use correct public key type for EdDSA chains (Solana, Sui, Polkadot, Ton use ed25519, Cardano uses ed25519Cardano)
  - Fix timeout cleanup in ChainDiscoveryService to prevent unhandled rejections and memory leaks
  - Add guard against zero/negative concurrencyLimit to prevent infinite loop

- [#57](https://github.com/vultisig/vultisig-sdk/pull/57) [`22bb16b`](https://github.com/vultisig/vultisig-sdk/commit/22bb16be8421a51aa32da6c1166539015380651e) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - fix(node): add globalThis.crypto polyfill for WASM MPC libraries

  The WASM MPC libraries (DKLS, Schnorr) use `crypto.getRandomValues()` internally via wasm-bindgen. Node.js 18+ has webcrypto but it's not on `globalThis` by default, causing "unreachable" errors during MPC signing. This adds the polyfill before any WASM initialization.

- [#68](https://github.com/vultisig/vultisig-sdk/pull/68) [`7979f3c`](https://github.com/vultisig/vultisig-sdk/commit/7979f3c502ea04db3c3de551bee297b8a9f9808b) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Fix seedphrase import portfolio showing zero balances

  After importing a seedphrase with detected balances, portfolio was showing zero balances because chain-specific public keys from the MPC import were not being used for address derivation.

  **Root cause:** BIP44 derivation paths contain hardened levels (e.g., `m/44'/60'/0'`) which cannot be derived from a public key alone. Chain-specific public keys must be stored during import (when private keys are available) and used later for address derivation.

  **Fixes:**
  - `VaultBase.ts`: Preserve `chainPublicKeys` and `chainKeyShares` when loading vaults
  - `AddressService.ts`: Pass `chainPublicKeys` to `getPublicKey()` for correct address derivation
  - `Vultisig.ts`: Set imported chains as active chains so portfolio shows relevant chains

  **Backwards compatible:** Non-import vaults (regular fast/secure, imported shares) are unaffected as they fall back to master key derivation when `chainPublicKeys` is undefined.

- [#62](https://github.com/vultisig/vultisig-sdk/pull/62) [`008db7f`](https://github.com/vultisig/vultisig-sdk/commit/008db7fb27580ec78df3bbc41b25aac24924ffd8) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - fix: preserve keyshares in VaultBase constructor when provided via parsedVaultData

  Previously, the VaultBase constructor always set `keyShares: { ecdsa: '', eddsa: '' }` for lazy loading, ignoring any keyshares passed in `parsedVaultData`. This caused exported vault files to be missing keyshare data (~700 bytes instead of ~157KB), making them unusable for signing or re-import.

  The fix preserves keyshares from `parsedVaultData` when available, falling back to empty strings for lazy loading only when keyshares aren't provided.

- [#64](https://github.com/vultisig/vultisig-sdk/pull/64) [`91990d3`](https://github.com/vultisig/vultisig-sdk/commit/91990d3fc7ef1a8d7068f5cbae8f8f3dda5b68f3) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - feat: shared examples package and electron adapter parity
  - Created `examples/shared` package with shared components and adapters for browser and electron examples
  - Implemented adapter pattern (ISDKAdapter, IFileAdapter) for platform-agnostic code
  - Added full Electron IPC handlers for token, portfolio, and swap operations
  - Fixed BigInt serialization for Electron IPC (prepareSendTx, sign, swap operations)
  - Fixed SecureVault threshold calculation using correct 2/3 majority formula
  - Added event subscriptions in Electron app for balance, chain, transaction, and error events
  - Reduced code duplication between browser and electron examples by ~1400 lines

- [#55](https://github.com/vultisig/vultisig-sdk/pull/55) [`95ba10b`](https://github.com/vultisig/vultisig-sdk/commit/95ba10baf2dc2dc4ba8e48825f10f34ec275a73c) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Update ARCHITECTURE.md and SDK-USERS-GUIDE.md to reflect current codebase state: fix version number, monorepo structure, createFastVault API example, platform bundles table, and storage layer description.

- [#68](https://github.com/vultisig/vultisig-sdk/pull/68) [`7979f3c`](https://github.com/vultisig/vultisig-sdk/commit/7979f3c502ea04db3c3de551bee297b8a9f9808b) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - chore: update upstream DKLS and Schnorr WASM libraries

## 0.2.0-beta.9

### Minor Changes

- [#64](https://github.com/vultisig/vultisig-sdk/pull/64) [`a36a7f6`](https://github.com/vultisig/vultisig-sdk/commit/a36a7f614c03e32ebc7e843cbf1ab30b6be0d4af) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - feat(sdk): add broadcastRawTx() for broadcasting pre-signed transactions

  Adds `broadcastRawTx()` method supporting all chain families:
  - EVM: Ethereum, Polygon, BSC, Arbitrum, Base, etc. (hex-encoded)
  - UTXO: Bitcoin, Litecoin, Dogecoin, etc. (hex-encoded)
  - Solana: Base58 or Base64 encoded transaction bytes
  - Cosmos: JSON `{tx_bytes}` or raw base64 protobuf (10 chains)
  - TON: BOC as base64 string
  - Polkadot: Hex-encoded extrinsic
  - Ripple: Hex-encoded transaction blob
  - Sui: JSON `{unsignedTx, signature}`
  - Tron: JSON transaction object

  CLI commands added:
  - `vultisig sign --chain <chain> --bytes <base64>` - sign pre-hashed data
  - `vultisig broadcast --chain <chain> --raw-tx <data>` - broadcast raw tx

  Documentation updated with complete workflow examples for EVM, UTXO, Solana, and Sui.

### Patch Changes

- [#64](https://github.com/vultisig/vultisig-sdk/pull/64) [`91990d3`](https://github.com/vultisig/vultisig-sdk/commit/91990d3fc7ef1a8d7068f5cbae8f8f3dda5b68f3) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - feat: shared examples package and electron adapter parity
  - Created `examples/shared` package with shared components and adapters for browser and electron examples
  - Implemented adapter pattern (ISDKAdapter, IFileAdapter) for platform-agnostic code
  - Added full Electron IPC handlers for token, portfolio, and swap operations
  - Fixed BigInt serialization for Electron IPC (prepareSendTx, sign, swap operations)
  - Fixed SecureVault threshold calculation using correct 2/3 majority formula
  - Added event subscriptions in Electron app for balance, chain, transaction, and error events
  - Reduced code duplication between browser and electron examples by ~1400 lines

## 0.2.0-beta.8

### Patch Changes

- [#62](https://github.com/vultisig/vultisig-sdk/pull/62) [`008db7f`](https://github.com/vultisig/vultisig-sdk/commit/008db7fb27580ec78df3bbc41b25aac24924ffd8) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - fix: preserve keyshares in VaultBase constructor when provided via parsedVaultData

  Previously, the VaultBase constructor always set `keyShares: { ecdsa: '', eddsa: '' }` for lazy loading, ignoring any keyshares passed in `parsedVaultData`. This caused exported vault files to be missing keyshare data (~700 bytes instead of ~157KB), making them unusable for signing or re-import.

  The fix preserves keyshares from `parsedVaultData` when available, falling back to empty strings for lazy loading only when keyshares aren't provided.

## 0.2.0-alpha.7

### Minor Changes

- [#60](https://github.com/vultisig/vultisig-sdk/pull/60) [`b4cf357`](https://github.com/vultisig/vultisig-sdk/commit/b4cf357c98ef493b48c807e5bb45cd40b9893295) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - feat: Add SecureVault support for multi-device MPC vaults
  - Implement SecureVault.create() for multi-device keygen ceremony
  - Add RelaySigningService for coordinated signing via relay server
  - Implement SecureVault.sign() and signBytes() methods
  - Add QR code generation for mobile app pairing (compatible with Vultisig iOS/Android)
  - CLI: Add `vault create --type secure` with terminal QR display
  - CLI: Support secure vault signing with device coordination
  - Add comprehensive unit, integration, and E2E tests

## 0.2.0-alpha.5

### Patch Changes

- [#57](https://github.com/vultisig/vultisig-sdk/pull/57) [`6137bc6`](https://github.com/vultisig/vultisig-sdk/commit/6137bc65bdf06ea5f6ede009ac72ec58b7cac7d1) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Optimize SDK bundling configuration
  - Add terser minification (~60% bundle size reduction)
  - Add clean script to remove stale dist files before builds
  - Centralize duplicated onwarn handler in rollup config
  - Add package.json exports for react-native and electron platforms

- [#57](https://github.com/vultisig/vultisig-sdk/pull/57) [`c75f442`](https://github.com/vultisig/vultisig-sdk/commit/c75f442ce4e34521aa8d0f704c415f63c24dba8f) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - fix(node): add globalThis.crypto polyfill for WASM MPC libraries

  The WASM MPC libraries (DKLS, Schnorr) use `crypto.getRandomValues()` internally via wasm-bindgen. Node.js 18+ has webcrypto but it's not on `globalThis` by default, causing "unreachable" errors during MPC signing. This adds the polyfill before any WASM initialization.

## 0.2.0-alpha.4

### Minor Changes

- [#56](https://github.com/vultisig/vultisig-sdk/pull/56) [`7f60cd5`](https://github.com/vultisig/vultisig-sdk/commit/7f60cd5835510bd9110d6382cf7d03bf1d5e04ff) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - feat(sdk): add signBytes() method for signing arbitrary pre-hashed data

  Adds a new `signBytes()` method to vaults that allows signing arbitrary byte arrays:
  - Accepts `Uint8Array`, `Buffer`, or hex string input
  - Uses chain parameter to determine signature algorithm (ECDSA/EdDSA) and derivation path
  - Available on FastVault (implemented) and SecureVault (placeholder for future)

  Example usage:

  ```typescript
  const sig = await vault.signBytes({
    data: keccak256(message),
    chain: Chain.Ethereum,
  });
  ```

## 0.2.0-alpha.3

### Minor Changes

- [#55](https://github.com/vultisig/vultisig-sdk/pull/55) [`95ba10b`](https://github.com/vultisig/vultisig-sdk/commit/95ba10baf2dc2dc4ba8e48825f10f34ec275a73c) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - **BREAKING**: Change fast vault creation API to return vault from verification
  - `createFastVault()` now returns `Promise<string>` (just the vaultId)
  - `verifyVault()` now returns `Promise<FastVault>` instead of `Promise<boolean>`
  - Vault is only persisted to storage after successful email verification
  - If process is killed before verification, vault is lost (user recreates)

  This is a cleaner API - the user only gets the vault after it's verified and persisted.

### Patch Changes

- [#55](https://github.com/vultisig/vultisig-sdk/pull/55) [`95ba10b`](https://github.com/vultisig/vultisig-sdk/commit/95ba10baf2dc2dc4ba8e48825f10f34ec275a73c) Thanks [@bornslippynuxx](https://github.com/bornslippynuxx)! - Update ARCHITECTURE.md and SDK-USERS-GUIDE.md to reflect current codebase state: fix version number, monorepo structure, createFastVault API example, platform bundles table, and storage layer description.

## 0.1.1-alpha.0

### Patch Changes

- [`cc96f64`](https://github.com/vultisig/vultisig-sdk/commit/cc96f64622a651eb6156f279afbbfe0aa4219179) - fix: re-release as alpha (0.1.0 was accidentally published as stable)

## 0.1.0

### Patch Changes

- [`8694cd9`](https://github.com/vultisig/vultisig-sdk/commit/8694cd957573b8334ff0f29167f8b45c5140ce42) - Add BrowserStorage and FileStorage to TypeScript documentation

- [`1f20084`](https://github.com/vultisig/vultisig-sdk/commit/1f20084bdaf6ddf00d2dd5c70ec6070e00a94e91) - docs: update documentation to reflect current SDK and CLI interfaces
  - Fix import paths: use `@vultisig/sdk` instead of platform-specific paths (`/node`, `/browser`)
  - Update Node.js version requirement from 18+ to 20+
  - Fix Storage interface documentation (generic types, correct method signatures)
  - Fix WASM copy instruction package name (`@vultisig/sdk` not `vultisig-sdk`)
  - Add missing CLI environment variable `VULTISIG_VAULT`
  - Add missing CLI interactive shell commands (`vault`, `.clear`)
  - Add `--vault` global option to CLI documentation
  - Fix project structure paths in SDK README

- [`c862869`](https://github.com/vultisig/vultisig-sdk/commit/c8628695cfc47209b26bfe628c9608d29c541a5b) - fix: npm package installation issues
  - Remove bundled internal packages (@core/_, @lib/_) from SDK dependencies - these are bundled into dist
  - Switch CLI build from tsc to esbuild for proper ESM compatibility
  - Update publish workflow to use `yarn npm publish` with --tolerate-republish
  - Require Node.js >= 20
