# @vultisig/core-mpc

## 1.3.10

### Patch Changes

- [#647](https://github.com/vultisig/vultisig-sdk/pull/647) [`55ed503`](https://github.com/vultisig/vultisig-sdk/commit/55ed503e103bdf8884c7ca7a8050742fb87d9e1f) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Enable WalletCore ZIP-317 fee planning for Zcash UTXO signing inputs.

- Updated dependencies [[`55ed503`](https://github.com/vultisig/vultisig-sdk/commit/55ed503e103bdf8884c7ca7a8050742fb87d9e1f)]:
  - @vultisig/core-chain@2.10.2

## 1.3.9

### Patch Changes

- [#646](https://github.com/vultisig/vultisig-sdk/pull/646) [`72bbcd1`](https://github.com/vultisig/vultisig-sdk/commit/72bbcd17ee5327390c98784f861b7c6b8829cf2f) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Update the default Zcash consensus branch ID to NU6.2 (`30f33754`) for SDK UTXO signing and WalletCore signing inputs.

## 1.3.8

### Patch Changes

- Updated dependencies [[`7145713`](https://github.com/vultisig/vultisig-sdk/commit/7145713992199f084d826f160cc20a4c445b14fb)]:
  - @vultisig/core-chain@2.10.1

## 1.3.7

### Patch Changes

- Updated dependencies [[`ddf0bf4`](https://github.com/vultisig/vultisig-sdk/commit/ddf0bf44cc38905370f60246b88503954b3e3418), [`c63c713`](https://github.com/vultisig/vultisig-sdk/commit/c63c713de30c847a98d3b73c8ba5b5a882c0699b)]:
  - @vultisig/core-chain@2.10.0

## 1.3.6

### Patch Changes

- Updated dependencies [[`c87816b`](https://github.com/vultisig/vultisig-sdk/commit/c87816b6797e8237d7a94923025311e479e0c520)]:
  - @vultisig/core-chain@2.9.0

## 1.3.5

### Patch Changes

- Updated dependencies [[`9e405c9`](https://github.com/vultisig/vultisig-sdk/commit/9e405c9459713c5391ca6a85a548eb3750ec2872)]:
  - @vultisig/core-chain@2.8.0

## 1.3.4

### Patch Changes

- Updated dependencies [[`1bf8a6d`](https://github.com/vultisig/vultisig-sdk/commit/1bf8a6d36788b702092d92918294d67cdc6e11b7), [`d1c12b2`](https://github.com/vultisig/vultisig-sdk/commit/d1c12b24bc55a318a8f87998d2320651f875b00a)]:
  - @vultisig/core-chain@2.7.0

## 1.3.3

### Patch Changes

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

- Updated dependencies [[`5bb56a4`](https://github.com/vultisig/vultisig-sdk/commit/5bb56a4daba8b896626c54fabd94fd6c9a35320e), [`a13c644`](https://github.com/vultisig/vultisig-sdk/commit/a13c644be796a7bf10dc0ab426ac888b9e962585), [`c4b4560`](https://github.com/vultisig/vultisig-sdk/commit/c4b45604f043700068aaf1c3c1a1ecad5c8a874f), [`a13c644`](https://github.com/vultisig/vultisig-sdk/commit/a13c644be796a7bf10dc0ab426ac888b9e962585), [`880cde0`](https://github.com/vultisig/vultisig-sdk/commit/880cde00a5978e8a4dff2cf8adb627059e4af5bf), [`5d11cf3`](https://github.com/vultisig/vultisig-sdk/commit/5d11cf3bfb81aba929fe8e81bb77e7aebff15129)]:
  - @vultisig/core-chain@2.6.0

## 1.3.2

### Patch Changes

- Updated dependencies [[`8932aff`](https://github.com/vultisig/vultisig-sdk/commit/8932afffbdd57112b9b8e59ac2e909e1654f54a3), [`88cd323`](https://github.com/vultisig/vultisig-sdk/commit/88cd3235ea463112d378d5e5a2c32aacabe08ab0)]:
  - @vultisig/core-chain@2.5.0

## 1.3.1

### Patch Changes

- Updated dependencies [[`47860fc`](https://github.com/vultisig/vultisig-sdk/commit/47860fcc6a1fa3600c20b529d29af98d56cbc5b4)]:
  - @vultisig/core-chain@2.4.1

## 1.3.0

### Minor Changes

- [#583](https://github.com/vultisig/vultisig-sdk/pull/583) [`f2270cd`](https://github.com/vultisig/vultisig-sdk/commit/f2270cd6aaa741d6800bd2d21e9775092be25d31) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - feat(cardano): attach CIP-20 label-674 metadata when memo is provided

  Cardano direct sends with a non-empty memo now embed the memo as
  CIP-20 on-chain metadata (`{ 674: { "msg": [...] } }`) instead of
  silently dropping it.

  Implementation:
  - `buildCip20AuxData` encodes the memo into CIP-20 CBOR and computes
    the blake2b-256 aux data hash
  - `patchTxBodyWithAuxHash` byte-patches the WalletCore-produced tx body
    to include the auxiliary_data_hash at key 7 (CBOR map header bump)
  - `getPreSigningHashes` for Cardano now returns blake2b of the PATCHED
    body when a memo is present, so all MPC devices sign the correct hash
  - `compileTx` for Cardano re-derives the pre-signing output, patches
    the body when memo is present, and passes auxDataCbor to
    buildSignedCardanoTx so element [3] carries the metadata
  - `getCardanoChainSpecific` bumps the forced fee by 44 \* len(auxDataCbor)
    to account for the extra bytes WalletCore cannot anticipate
  - Sends without memo are byte-identical to the pre-fix behavior

### Patch Changes

- [#583](https://github.com/vultisig/vultisig-sdk/pull/583) [`f2270cd`](https://github.com/vultisig/vultisig-sdk/commit/f2270cd6aaa741d6800bd2d21e9775092be25d31) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - ## New
  - Polkadot Asset Hub USDT (asset_id 1984) + USDC (asset_id 1337) token registry ([#562](https://github.com/vultisig/vultisig-sdk/issues/562))
  - Polkadot `pallet_assets.Account` balance resolver for Asset Hub tokens - replaces placeholder 0n guard ([#563](https://github.com/vultisig/vultisig-sdk/issues/563))
  - Tron native send `data` field (proto field 12) for THORChain memos + exchange deposit memos; `BuildTronSendOptions` and `BuildTrc20TransferOptions` gain optional `data?: Uint8Array` field ([#559](https://github.com/vultisig/vultisig-sdk/issues/559))

  ## Fixed
  - Tron TRC-20 fee estimate now subtracts sender's available energy before charging TRX ([#556](https://github.com/vultisig/vultisig-sdk/issues/556))
  - Tron native send free bandwidth check prevents spurious fee charge when bandwidth is available ([#555](https://github.com/vultisig/vultisig-sdk/issues/555))

- Updated dependencies [[`f2270cd`](https://github.com/vultisig/vultisig-sdk/commit/f2270cd6aaa741d6800bd2d21e9775092be25d31)]:
  - @vultisig/core-chain@2.4.0

## 1.2.23

### Patch Changes

- [#588](https://github.com/vultisig/vultisig-sdk/pull/588) [`256f67d`](https://github.com/vultisig/vultisig-sdk/commit/256f67da13a6d96f34c83c9b56c1cfb574cd8fd1) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Enable pre-built SwapKit Bitcoin PSBT transactions, verify their destination outputs, and route payloads through the SignBitcoin hashing and compilation path.

- Updated dependencies [[`256f67d`](https://github.com/vultisig/vultisig-sdk/commit/256f67da13a6d96f34c83c9b56c1cfb574cd8fd1)]:
  - @vultisig/core-chain@2.3.2

## 1.2.22

### Patch Changes

- Updated dependencies [[`c3881e5`](https://github.com/vultisig/vultisig-sdk/commit/c3881e549e5678e8806eba5defb2d2d6eefc2cc5)]:
  - @vultisig/core-chain@2.3.1

## 1.2.21

### Patch Changes

- [#577](https://github.com/vultisig/vultisig-sdk/pull/577) [`cc9d67f`](https://github.com/vultisig/vultisig-sdk/commit/cc9d67f0c61d9ebdfc133beac5ef04658d37a37f) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - feat(mpc): env-gated diagnostic logging for relay-decrypt ghash tag investigation

  Adds non-default-on diagnostic logging to `fromMpcServerMessage` and the
  `receiveMessages` keysign relay loop, gated on `VULTISIG_DIAG_MPC_RELAY=1`.
  Logs envelope shape (`body_len`, `decoded_len`, `nonce_hex`, first 32 bytes
  of ciphertext) plus a `key_fingerprint` (sha256-truncated of decoded key
  bytes, NOT raw key material) for cross-node correlation of the persistent
  "aes/gcm: invalid ghash tag" failures. Behavior unchanged when the env flag
  is absent.

- [#577](https://github.com/vultisig/vultisig-sdk/pull/577) [`cc9d67f`](https://github.com/vultisig/vultisig-sdk/commit/cc9d67f0c61d9ebdfc133beac5ef04658d37a37f) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - ## New
  - Polkadot Asset Hub USDT (asset_id 1984) + USDC (asset_id 1337) token registry ([#562](https://github.com/vultisig/vultisig-sdk/issues/562))
  - Polkadot `pallet_assets.Account` balance resolver for Asset Hub tokens - replaces placeholder 0n guard ([#563](https://github.com/vultisig/vultisig-sdk/issues/563))
  - Tron native send `data` field (proto field 12) for THORChain memos + exchange deposit memos; `BuildTronSendOptions` and `BuildTrc20TransferOptions` gain optional `data?: Uint8Array` field ([#559](https://github.com/vultisig/vultisig-sdk/issues/559))

  ## Fixed
  - Tron TRC-20 fee estimate now subtracts sender's available energy before charging TRX ([#556](https://github.com/vultisig/vultisig-sdk/issues/556))
  - Tron native send free bandwidth check prevents spurious fee charge when bandwidth is available ([#555](https://github.com/vultisig/vultisig-sdk/issues/555))

- Updated dependencies [[`cc9d67f`](https://github.com/vultisig/vultisig-sdk/commit/cc9d67f0c61d9ebdfc133beac5ef04658d37a37f)]:
  - @vultisig/core-chain@2.3.0

## 1.2.20

### Patch Changes

- [#554](https://github.com/vultisig/vultisig-sdk/pull/554) [`bf7278c`](https://github.com/vultisig/vultisig-sdk/commit/bf7278c5886789c4a181169a36bc9296ef81b79c) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Emit the dedicated commondata SwapKit swap payload for source-chain transfer routes so QR cosigners can distinguish SwapKit swaps from OneInch-compatible swap payloads.

- Updated dependencies [[`bf7278c`](https://github.com/vultisig/vultisig-sdk/commit/bf7278c5886789c4a181169a36bc9296ef81b79c)]:
  - @vultisig/core-chain@2.2.5

## 1.2.19

### Patch Changes

- Updated dependencies [[`72eb200`](https://github.com/vultisig/vultisig-sdk/commit/72eb200ec647a707d1ebdc1f8b6f0f5243780477)]:
  - @vultisig/core-chain@2.2.4

## 1.2.18

### Patch Changes

- Updated dependencies [[`4c9454e`](https://github.com/vultisig/vultisig-sdk/commit/4c9454eca99f43a2ce572732c3d6fcc74c99e89e)]:
  - @vultisig/core-chain@2.2.3

## 1.2.17

### Patch Changes

- Updated dependencies [[`fa95600`](https://github.com/vultisig/vultisig-sdk/commit/fa95600887cb8ca603e8ddcb9c8558eff2d0ea6b)]:
  - @vultisig/core-chain@2.2.2

## 1.2.16

### Patch Changes

- [#525](https://github.com/vultisig/vultisig-sdk/pull/525) [`b0d0ba9`](https://github.com/vultisig/vultisig-sdk/commit/b0d0ba9d3ff0226149aca9a7446ff07a9eba84fc) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Enable SwapKit source routes for BTC, BCH, DOGE, LTC, XRP, ZEC, TRON, and TON by signing non-EVM SwapKit routes as source-chain transfers.

- Updated dependencies [[`b0d0ba9`](https://github.com/vultisig/vultisig-sdk/commit/b0d0ba9d3ff0226149aca9a7446ff07a9eba84fc)]:
  - @vultisig/core-chain@2.2.1

## 1.2.15

### Patch Changes

- [#508](https://github.com/vultisig/vultisig-sdk/pull/508) [`40df23c`](https://github.com/vultisig/vultisig-sdk/commit/40df23c2ce48f51e2664528b0db5f1b8f14448c7) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - fix(core-mpc/cardano): throw a clear error when a Cardano memo is provided

  Until CIP-20 auxiliary-data support lands (see vultisig/vultisig-sdk#432),
  `getCardanoSigningInputs` would silently drop `keysignPayload.memo` and
  produce a signed Cardano transaction with `auxiliary_data = null` — the
  memo never made it on-chain (e.g. tx
  `9c8549aea24106c699fffe74c7ded7186c25c390b33415853a83b0781efe4efe`).

  The resolver now fails fast with an explanatory error so callers (direct
  send, deposit, `VaultBase.send()`, `prepareSendTxFromKeys`, CLI/MCP) can
  surface the limitation to the user instead of issuing a tx that loses
  their memo. The CIP-30 path (`cardanoCip30.ts`) is unaffected — it signs
  the dApp-provided tx body hash and does not read `keysignPayload.memo`.

- Updated dependencies [[`cb80440`](https://github.com/vultisig/vultisig-sdk/commit/cb804408b9607aacb143a7a941f0f9f1986f2379)]:
  - @vultisig/core-chain@2.2.0

## 1.2.14

### Patch Changes

- Updated dependencies [[`7b384c8`](https://github.com/vultisig/vultisig-sdk/commit/7b384c89cb0fd82e76161feee78eccbc2c4401eb), [`585c177`](https://github.com/vultisig/vultisig-sdk/commit/585c177d4de4960a764f2528aa48aebc42450f7d), [`1667b79`](https://github.com/vultisig/vultisig-sdk/commit/1667b79fbc754e36032942fb5e749706dfc09bf3)]:
  - @vultisig/core-chain@2.1.0

## 1.2.13

### Patch Changes

- [#474](https://github.com/vultisig/vultisig-sdk/pull/474) [`37c2f82`](https://github.com/vultisig/vultisig-sdk/commit/37c2f82379725ac4ac4d63679afea5c3ac1b7683) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Refresh vulnerable dependency paths for high-severity audit cleanup.

- Updated dependencies [[`2d85653`](https://github.com/vultisig/vultisig-sdk/commit/2d85653c23379bc39bb579acf83d7998070b9ed4), [`37c2f82`](https://github.com/vultisig/vultisig-sdk/commit/37c2f82379725ac4ac4d63679afea5c3ac1b7683), [`2174118`](https://github.com/vultisig/vultisig-sdk/commit/2174118523eacfb97e04ecfa8de96f22059afe99)]:
  - @vultisig/core-chain@2.0.0

## 1.2.12

### Patch Changes

- [#466](https://github.com/vultisig/vultisig-sdk/pull/466) [`af16c0d`](https://github.com/vultisig/vultisig-sdk/commit/af16c0d8f59fd9b339f1a6b41229f105bd81820f) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Clean shared package build output before generating package exports so removed modules do not leave stale subpath entries.

## 1.2.11

### Patch Changes

- [#457](https://github.com/vultisig/vultisig-sdk/pull/457) [`680119e`](https://github.com/vultisig/vultisig-sdk/commit/680119e7392921b8aeaf859c85e811fb40a25054) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Add regression tests and drift guards for Bitcoin PSBT compilation, ChainKind signing-input alignment, generated protobuf headers, and CLI agent action names aligned with AGENTS.md.

- [#456](https://github.com/vultisig/vultisig-sdk/pull/456) [`b36eb62`](https://github.com/vultisig/vultisig-sdk/commit/b36eb62842051b8b2bae06f1e123a5ebcf6cad88) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Add Terra CW20 metadata resolution and build CW20 token sends as CosmWasm execute transfers.

- Updated dependencies [[`5102976`](https://github.com/vultisig/vultisig-sdk/commit/5102976d7c13fa9578bbbc6e5122526cefc1ec66), [`b36eb62`](https://github.com/vultisig/vultisig-sdk/commit/b36eb62842051b8b2bae06f1e123a5ebcf6cad88)]:
  - @vultisig/core-chain@1.7.1

## 1.2.10

### Patch Changes

- Updated dependencies [[`e3dc2e8`](https://github.com/vultisig/vultisig-sdk/commit/e3dc2e828b3e4f95b293d4493bddbc176bbb3bb7)]:
  - @vultisig/core-chain@1.7.0

## 1.2.9

### Patch Changes

- [#419](https://github.com/vultisig/vultisig-sdk/pull/419) [`e434998`](https://github.com/vultisig/vultisig-sdk/commit/e434998069e6af9664db045c5e91c5d5f35feef6) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Browser and Electron example vault UX after QA; secure vault join/create/import flows; MPC session and server coordination fixes.

- [#438](https://github.com/vultisig/vultisig-sdk/pull/438) [`7eca3db`](https://github.com/vultisig/vultisig-sdk/commit/7eca3db2b5455e651ae3201633b9f9dcffbc6447) Thanks [@Ehsan-saradar](https://github.com/Ehsan-saradar)! - mpc/keygen: support multi-namespace DKLS setup messages and propagate `is_tss_batch` so parallel batched keygen interops with Android (uses default namespace) and iOS (uses `p-ecdsa`/`p-eddsa` after iOS PR [#4246](https://github.com/vultisig/vultisig-sdk/issues/4246)). `DKLS.prepareKeygenSetup` now accepts a list of mirror `message_id` namespaces — initiator writes to all, joiner races a poll across them and back-fills the rest. `DKLS.startReshareWithRetry` accepts a `setupMessageId` so reshare's setup matches per-protocol exchange channels. Regenerated `KeygenMessage` and `ReshareMessage` protos pick up the upstream `is_tss_batch` field.

## 1.2.8

### Patch Changes

- Updated dependencies [[`1132ae5`](https://github.com/vultisig/vultisig-sdk/commit/1132ae51f8e4d5b8ca8a1855af9ea51031b574e9)]:
  - @vultisig/core-chain@1.6.1

## 1.2.7

### Patch Changes

- Updated dependencies [[`6b75472`](https://github.com/vultisig/vultisig-sdk/commit/6b7547288f8594fcf8a9c71e46a5163d6b6cd727), [`613004f`](https://github.com/vultisig/vultisig-sdk/commit/613004f5fbce2658a439296ca249d3e031a58078), [`2e1bfb8`](https://github.com/vultisig/vultisig-sdk/commit/2e1bfb85417787a7cc5d497d35f6e76d2bb5a41a)]:
  - @vultisig/core-chain@1.6.0

## 1.2.6

### Patch Changes

- Updated dependencies [[`198f2af`](https://github.com/vultisig/vultisig-sdk/commit/198f2af1ae22bd379d7eff0c1c428a0ce1043229)]:
  - @vultisig/core-chain@1.5.3

## 1.2.5

### Patch Changes

- Updated dependencies [[`b97da23`](https://github.com/vultisig/vultisig-sdk/commit/b97da233b3fdaeeb75e3a0c986d7fd15e0d743e4), [`745172f`](https://github.com/vultisig/vultisig-sdk/commit/745172f3ee511bc4e95914986bfbdb8acf794b1e)]:
  - @vultisig/core-chain@1.5.2

## 1.2.4

### Patch Changes

- [#371](https://github.com/vultisig/vultisig-sdk/pull/371) [`b713743`](https://github.com/vultisig/vultisig-sdk/commit/b7137437547afc8189af207f210be57f50973dc7) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Install `globalThis.Buffer` before the browser SDK module graph evaluates (`preamble.ts`), align browser `polyfills` with `globalThis`, add explicit `buffer` imports across MPC modules that use `Buffer`, and depend on `buffer` from `@vultisig/core-mpc`. Harden the browser/electron examples: seedphrase import batching/progress and adapter flags, clipboard helper with bounded timeouts, QR/address copy feedback, and send-form amount validation with trimmed recipients.

- [#376](https://github.com/vultisig/vultisig-sdk/pull/376) [`502c7ec`](https://github.com/vultisig/vultisig-sdk/commit/502c7ec37e7853543c22311af0ada995fa2c47e2) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Split `getSevenZip` into browser and Node builds so browser bundles never pull `node:module`, wire conditional `exports` via `generate-shared-exports`, and improve the browser partner example (StrictMode-safe init, dev QR logging, copyable QR textarea, Vite env types).

- Updated dependencies [[`ed6955f`](https://github.com/vultisig/vultisig-sdk/commit/ed6955fe6d218b3b13314db32f8d43c67a41fb48)]:
  - @vultisig/mpc-types@0.2.3

## 1.2.3

### Patch Changes

- Updated dependencies [[`03007d7`](https://github.com/vultisig/vultisig-sdk/commit/03007d7293b2f51f6269d39bf3725715182f933e)]:
  - @vultisig/core-chain@1.5.1

## 1.2.2

### Patch Changes

- [#320](https://github.com/vultisig/vultisig-sdk/pull/320) [`c33d1f0`](https://github.com/vultisig/vultisig-sdk/commit/c33d1f02b6740ef1c7db16cdc1f7290ec7b2f1f5) Thanks [@rcoderdev](https://github.com/rcoderdev)! - feat(chain): THORChain rapid quote with streaming fallback above 3% fee bps

  THORChain swap quotes now request rapid (`streaming_interval=0`) first. When `fees.total_bps` exceeds 300, a second streaming quote is fetched (`interval=1`, optional `streaming_quantity` from `max_streaming_quantity`); the better `expected_amount_out` wins, with silent fallback to rapid on errors. `THORCHAIN_STREAMING_SLIPPAGE_THRESHOLD_BPS` disables the extra fetch when set to `Number.MAX_SAFE_INTEGER`. Keysign payload reads THOR streaming fields from the quote memo so they match the selected route.

- Updated dependencies [[`a52980c`](https://github.com/vultisig/vultisig-sdk/commit/a52980c490633da7d7ae36128bc491f8ca3ff565), [`c33d1f0`](https://github.com/vultisig/vultisig-sdk/commit/c33d1f02b6740ef1c7db16cdc1f7290ec7b2f1f5)]:
  - @vultisig/lib-utils@0.10.1
  - @vultisig/core-chain@1.5.0

## 1.2.1

### Patch Changes

- Updated dependencies [[`e52914b`](https://github.com/vultisig/vultisig-sdk/commit/e52914ba87f2d740847fc0de3a49827b0da3e0ba)]:
  - @vultisig/core-chain@1.4.3

## 1.2.0

### Minor Changes

- [#293](https://github.com/vultisig/vultisig-sdk/pull/293) [`a3a331a`](https://github.com/vultisig/vultisig-sdk/commit/a3a331a875ebc6868b11c6901c8ed99dde51a4ff) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Password-protected vault backups use PBKDF2-HMAC-SHA256 with a random salt (600k iterations by default) and a versioned blob prefix; legacy SHA-256-only backups still decrypt.

### Patch Changes

- Updated dependencies [[`a3a331a`](https://github.com/vultisig/vultisig-sdk/commit/a3a331a875ebc6868b11c6901c8ed99dde51a4ff)]:
  - @vultisig/lib-utils@0.10.0
  - @vultisig/core-chain@1.4.2

## 1.1.9

### Patch Changes

- Updated dependencies [[`e3fa32b`](https://github.com/vultisig/vultisig-sdk/commit/e3fa32b9f29e3a07880ecba117cf40e6dd396a4b)]:
  - @vultisig/mpc-types@0.2.2

## 1.1.8

### Patch Changes

- Updated dependencies [[`77410fb`](https://github.com/vultisig/vultisig-sdk/commit/77410fb28f53dd558f05e5634aadba6a9547ee0f)]:
  - @vultisig/core-chain@1.4.1

## 1.1.7

### Patch Changes

- Updated dependencies [[`ef2ffbe`](https://github.com/vultisig/vultisig-sdk/commit/ef2ffbecf5f2b3af69172d34f3fda25055f4e112), [`d9399c7`](https://github.com/vultisig/vultisig-sdk/commit/d9399c77a932f0ecc9a2e6acec5d8457aa199444), [`6f1f8b2`](https://github.com/vultisig/vultisig-sdk/commit/6f1f8b2d9a69b8542da776f69fbddba6eb35bd3e)]:
  - @vultisig/core-chain@1.4.0

## 1.1.6

### Patch Changes

- Updated dependencies [[`54731db`](https://github.com/vultisig/vultisig-sdk/commit/54731dbc0ded30adc7f76bbc5e3e532ef9414bb2)]:
  - @vultisig/mpc-types@0.2.1

## 1.1.5

### Patch Changes

- Updated dependencies [[`5aef564`](https://github.com/vultisig/vultisig-sdk/commit/5aef564309aeeede5da250e03447e0a3da0a12ab)]:
  - @vultisig/lib-utils@0.9.3
  - @vultisig/core-chain@1.3.1

## 1.1.4

### Patch Changes

- Updated dependencies [[`824e58c`](https://github.com/vultisig/vultisig-sdk/commit/824e58cded1ca80e29a2e19e2bda6957f2da71ad)]:
  - @vultisig/core-chain@1.3.0

## 1.1.3

### Patch Changes

- Updated dependencies [[`ed1eb16`](https://github.com/vultisig/vultisig-sdk/commit/ed1eb16b868176b796629e10de95fddcf701c151)]:
  - @vultisig/lib-utils@0.9.2
  - @vultisig/core-chain@1.2.2

## 1.1.2

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

- Updated dependencies [[`0388700`](https://github.com/vultisig/vultisig-sdk/commit/03887009b7579fc0b193d068d4a205cdd3b7c214)]:
  - @vultisig/core-chain@1.2.1

## 1.1.1

### Patch Changes

- [`78772fd`](https://github.com/vultisig/vultisig-sdk/commit/78772fd061f3061c54802506218e5524a21714bd) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Fix MPC engine singleton so direct `@vultisig/core-mpc` / `@vultisig/mpc-types` / `@vultisig/mpc-wasm` imports register correctly across bundler chunks and Vite `optimizeDeps` scenarios.
  - Runtime singletons (MPC engine, WASM WalletCore getter, default storage factory, platform crypto) now live in a `globalThis`-anchored store keyed by `Symbol.for('vultisig.runtime.store.v1')`, eliminating duplicate-module-instance bugs.
  - `ensureMpcEngine()` added (async) — lazily registers the default `WasmMpcEngine` when no engine has been configured, so consumers that import only `@vultisig/core-mpc` no longer need to bootstrap the SDK.
  - `@vultisig/sdk` `sideEffects` narrowed from `false` to an allowlist of platform entry dist files, preventing tree-shakers from dropping the platform bootstrap.
  - `@vultisig/mpc-wasm` declared as an optional peer dependency of `@vultisig/mpc-types`.

  Closes [#287](https://github.com/vultisig/vultisig-sdk/issues/287).

- Updated dependencies [[`78772fd`](https://github.com/vultisig/vultisig-sdk/commit/78772fd061f3061c54802506218e5524a21714bd)]:
  - @vultisig/mpc-types@0.2.0

## 1.1.0

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

- Updated dependencies [[`c630597`](https://github.com/vultisig/vultisig-sdk/commit/c6305970d1685194f1c6c11d5e8d141e8aa6c9a1), [`aea1c28`](https://github.com/vultisig/vultisig-sdk/commit/aea1c28051345ddef9c952108b203caa8b7fa032)]:
  - @vultisig/core-chain@1.2.0

## 1.0.2

### Patch Changes

- [#164](https://github.com/vultisig/vultisig-sdk/pull/164) [`ec0c298`](https://github.com/vultisig/vultisig-sdk/commit/ec0c2988cfece95a1d66763e830a5b02e33ece9f) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Fix Cosmos transaction status receipts when the indexer reports `gasWanted` as zero: derive the gas denominator from decoded `fee.gasLimit` or `gasUsed`, sum native fee coins case-insensitively, and clamp proportional fees to the max fee. Aligns THORChain swap success fee display with co-signed and cross-client flows (see vultisig-windows#3501).

- Updated dependencies [[`ec0c298`](https://github.com/vultisig/vultisig-sdk/commit/ec0c2988cfece95a1d66763e830a5b02e33ece9f), [`84a2950`](https://github.com/vultisig/vultisig-sdk/commit/84a295002ed7310320b584fbccb76aaf4a233b31)]:
  - @vultisig/core-chain@1.1.0

## 1.0.1

### Patch Changes

- [#165](https://github.com/vultisig/vultisig-sdk/pull/165) [`4195641`](https://github.com/vultisig/vultisig-sdk/commit/4195641a9eb27d41fb27d2c6b605b34d4c4635b0) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Fast vault creation (CLI and SDK) no longer runs ML-DSA keygen; VultiServer only adds ML-DSA via `POST /mldsa`. Use `Vultisig.addPostQuantumKeysToFastVault` / `FastVault.addPostQuantumKeys` or CLI `vultisig add-mldsa` when post-quantum keys are needed. TSS batching for fast vault create now requests `ecdsa` and `eddsa` only. `MldsaKeygen` default relay message ids match VultiServer classic keygen (empty string); batch flows still pass `p-mldsa` explicitly.

## 1.0.0

### Major Changes

- [#157](https://github.com/vultisig/vultisig-sdk/pull/157) [`5286b98`](https://github.com/vultisig/vultisig-sdk/commit/5286b98d19692acd216a2c95d5a7a903217bef36) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Regenerate explicit `package.json` exports for `@vultisig/core-config` and `@vultisig/lib-utils` so directory and flat subpaths resolve under Node, TypeScript, and Vite.

  **Breaking (`@vultisig/core-chain`, `@vultisig/core-mpc`):** Remove the npm dependency cycle by dropping `@vultisig/core-mpc` from `core-chain`. Modules that required MPC types or keysign helpers now live under `@vultisig/core-mpc` (for example `tx/compile/compileTx`, `tx/preSigningHashes`, `chains/cosmos/qbtc/QBTCHelper`, Blockaid keysign input builders, `swap/native/utils/nativeSwapQuoteToSwapPayload`, `swap/utils/getSwapTrackingUrl`, and EVM `incrementKeysignPayloadNonce` at `keysign/signingInputs/resolvers/evm/incrementKeysignPayloadNonce`). `getUtxos` / `getCardanoUtxos` return plain `ChainPlainUtxo`; keysign maps to protobuf in MPC.

  **SDK:** QBTC support, shared import updates, and alignment with the new package boundaries.

### Patch Changes

- Updated dependencies [[`5286b98`](https://github.com/vultisig/vultisig-sdk/commit/5286b98d19692acd216a2c95d5a7a903217bef36)]:
  - @vultisig/core-config@0.9.1
  - @vultisig/lib-utils@0.9.1
  - @vultisig/core-chain@1.0.0

## 0.10.0

### Minor Changes

- [#149](https://github.com/vultisig/vultisig-sdk/pull/149) [`67dc6ce`](https://github.com/vultisig/vultisig-sdk/commit/67dc6ceaa1b318144cfbe3812ddecb14b108eba4) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Sync Windows-style TSS batching: batched FastVault APIs (`/batch/keygen`, `/batch/import`, `/batch/reshare`), batched relay message IDs for ECDSA, EdDSA, MLDSA, and per-chain import, secure vault QR `tssBatching=1` for joiner alignment, sequential fallbacks, and test coverage.

### Patch Changes

- Updated dependencies [[`67dc6ce`](https://github.com/vultisig/vultisig-sdk/commit/67dc6ceaa1b318144cfbe3812ddecb14b108eba4)]:
  - @vultisig/core-chain@0.10.0

## 0.9.0

### Minor Changes

- [#147](https://github.com/vultisig/vultisig-sdk/pull/147) [`8f2c9c6`](https://github.com/vultisig/vultisig-sdk/commit/8f2c9c6823d9e5ab0d882a5e8ba47715edaa54c8) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Publish shared chain, MPC, config, and lib packages to npm with compiled `dist/` output, deep subpath exports, and release workflow updates. SDK declares these packages as dependencies; `@vultisig/cli` is versioned with the SDK via changesets link.

### Patch Changes

- Updated dependencies [[`8f2c9c6`](https://github.com/vultisig/vultisig-sdk/commit/8f2c9c6823d9e5ab0d882a5e8ba47715edaa54c8)]:
  - @vultisig/core-chain@0.9.0
  - @vultisig/core-config@0.9.0
  - @vultisig/lib-utils@0.9.0
  - @vultisig/lib-dkls@0.9.0
  - @vultisig/lib-mldsa@0.9.0
  - @vultisig/lib-schnorr@0.9.0
