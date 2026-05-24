# Migration Guide

## `@vultisig/sdk` v→next major: Station affiliate constants removed

**Removed exports:** `stationKyberSwapAffiliateConfig`, `stationNativeSwapAffiliateConfig`, `stationOneInchAffiliateConfig`

These were Station-specific constants that should never have lived in the shared SDK. The generic injection seam (`affiliateConfig` param on `findSwapQuote`) and the `SwapAffiliateConfig` type remain — those are stable SDK API.

### Who is affected

Only consumers that directly imported the removed Station constants. If you were using the generic `affiliateConfig` injection with your own config objects, no change required.

### How to reconstruct

Copy the constant definitions into your own consumer package:

```ts
import type {
  KyberSwapBaseAffiliateConfig,
  NativeSwapAffiliateConfig,
  OneInchAffiliateConfig,
} from '@vultisig/sdk'

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
