---
'@vultisig/sdk': minor
---

Add `sdk.defi.arkis` — a lender-side **supply** builder for the Arkis protocol on Ethereum. Builds the unsigned 2-step sequence (ERC-20 `approve` → ERC-4626 / Agreement `deposit`) and returns the decoded transactions. Builds UNSIGNED calldata only — never signs, never broadcasts. Also surfaces `resolveArkisPoolKind` (optional on-chain `asset()` probe) and `parseArkisTokenAmount` (exact string-math base-unit parse), exposed via the new `sdk.defi` getter.
