---
"@vultisig/sdk": patch
---

fix(ton): fail closed on a null account-info result before it crashes keysign. A transient `ok:false`/null-result response from `getExtendedAddressInformation` slipped through as a 200 and crashed the TON keysign resolver on `const { account_state } = undefined`; `getTonAccountInfo` now throws a descriptive error instead of returning null.
