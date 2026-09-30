# Migration Guide

## SDK package paths in the next major

Nineteen narrow `@vultisig/sdk` paths are removed. Import their APIs from the
root (`@vultisig/sdk`) or the matching platform entry (`/node`, `/browser`,
`/chrome-extension`, `/electron`, or `/react-native`). The table shows the
replacement for a former value import. Most type names remain available from
the root; chain, seedphrase, and server types also live inside their
corresponding namespaces. The former `/tools/policy` types `AssetRef` and
`Envelope` use the root names `PolicyAssetRef` and `PolicyEnvelope` to avoid
collisions with other root types.

| Former path suffix      | Replacement from the root                                                       |
| ----------------------- | ------------------------------------------------------------------------------- |
| `/tools/prep`           | Named builders or `prep.*`; `getWalletCore` is named                            |
| `/seedphrase`           | `seedphrase.*` (including normalization, validation, derivation, and discovery) |
| `/tools/balance`        | Named helpers or `balance.*`                                                    |
| `/tools/swap`           | Named helpers or `swap.*`                                                       |
| `/tools/decode`         | Named helpers or `decode.*`                                                     |
| `/tx`                   | Same named exports                                                              |
| `/chains/tron`          | `chainTron.*`                                                                   |
| `/chains/utxo`          | `chainUtxo.*`                                                                   |
| `/chains/ton`           | `chainTon.*`                                                                    |
| `/abi`                  | Same named exports                                                              |
| `/tools/parse`          | Same named exports                                                              |
| `/tools/policy`         | Named helpers or `policy.*`                                                     |
| `/tools/price`          | Named helpers or `price.*`                                                      |
| `/tools/gas`            | Named helpers or `gas.*`                                                        |
| `/tools/bridge`         | Same named exports                                                              |
| `/tools/evm`            | Named helpers or `evm.*`                                                        |
| `/tools/cosmos`         | Named helpers or `cosmos.*` (including `cosmos.gov`)                            |
| `/signable-transaction` | Same named exports                                                              |
| `/server`               | Named fast-vault helpers or `server.*` for relay helpers                        |

For example:

```ts
// Before
import { buildTronSendTx } from '@vultisig/sdk/chains/tron'
import { normalizeMnemonic } from '@vultisig/sdk/seedphrase'

// After
import { chainTron, seedphrase } from '@vultisig/sdk'
chainTron.buildTronSendTx(/* ... */)
seedphrase.normalizeMnemonic('  abandon  ')
```

No helper is intentionally retired. The checked-in
`packages/sdk/public-subpath-migration.json` lists every value and type export,
its source condition, and its exact replacement. `/tools/defi` stays published.

## TAO builders: explicit WalletCore runtime

The next major versions of `@vultisig/core-chain` and `@vultisig/core-mpc` require the caller’s initialized WalletCore for direct TAO payload construction and fee refinement. This enforces SS58 network prefix 42 consistently with address validation and native runtimes.

```ts
// Before
buildBittensorSigningPayload(params)
refineBittensorChainSpecific({ keysignPayload, chainSpecific })

// After: reuse the WalletCore instance initialized by your application
buildBittensorSigningPayload(params, walletCore)
refineBittensorChainSpecific({ keysignPayload, chainSpecific, walletCore })
```

High-level SDK callers need no changes. React Native applications must upgrade `@vultisig/walletcore-native` and rebuild their native app to include the new SS58 constructors; a JavaScript-only update cannot add native methods. Valid TAO addresses and payload bytes are unchanged. Prefix-0 addresses and raw hexadecimal destinations now fail in the direct TAO builder.

## `@vultisig/sdk` v→next major: Station affiliate constants removed

**Removed exports:** `stationKyberSwapAffiliateConfig`, `stationNativeSwapAffiliateConfig`, `stationOneInchAffiliateConfig`

These were Station-specific constants that should never have lived in the shared SDK. The generic injection seam (`affiliateConfig` param on `findSwapQuote`) and the `SwapAffiliateConfig` type remain — those are stable SDK API.

### Who is affected

Only consumers that directly imported the removed Station constants. If you were using the generic `affiliateConfig` injection with your own config objects, no change required.

### How to reconstruct

Copy the constant definitions into your own consumer package:

```ts
import type { KyberSwapBaseAffiliateConfig, NativeSwapAffiliateConfig, OneInchAffiliateConfig } from '@vultisig/sdk'

// Station EVM fee-receiver address (KyberSwap + 1inch)
const STATION_EVM_FEE_RECEIVER = '0x649E1289fD780C2F9A3D27476511283EB0d0076D'

export const stationKyberSwapAffiliateConfig: KyberSwapBaseAffiliateConfig = {
  // Station source ID pending Kyber partner-team confirmation.
  // Using vultisig-v0 as a temp fallback — fees still flow to feeReceiver
  // correctly; only Kyber's attribution dashboard is mis-tagged until the
  // new source ID is registered.
  source: 'vultisig-v0',
  referral: STATION_EVM_FEE_RECEIVER,
}

export const stationOneInchAffiliateConfig: OneInchAffiliateConfig = {
  referrer: STATION_EVM_FEE_RECEIVER,
}

export const stationNativeSwapAffiliateConfig: NativeSwapAffiliateConfig = {
  // THORName must be lowercase — THORChain memo parsing is case-sensitive.
  affiliateFeeAddress: 'stvs',
  referralDiscountAffiliateFeeRateBps: 35,
  referrerFeeRateBps: 10,
}
```

> **THORName case-sensitivity**: `affiliateFeeAddress` must be lowercase `'stvs'`.
> THORChain memo parsing is case-sensitive. Using `'STVS'` or `'Stvs'` will
> silently break affiliate fee routing on native swaps.

### Usage (unchanged)

```ts
import { findSwapQuote } from '@vultisig/sdk'
import {
  stationKyberSwapAffiliateConfig,
  stationNativeSwapAffiliateConfig,
  stationOneInchAffiliateConfig,
} from './your-consumer-package/stationAffiliateConfigs'

const quote = await findSwapQuote({
  // ...
  affiliateConfig: {
    kyber: stationKyberSwapAffiliateConfig,
    native: stationNativeSwapAffiliateConfig,
    oneInch: stationOneInchAffiliateConfig,
  },
})
```

Reference implementation in mcp-ts#201.
