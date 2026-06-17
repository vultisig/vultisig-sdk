# @vultisig/core-chain

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
