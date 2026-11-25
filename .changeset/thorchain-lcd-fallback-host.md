---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

THORChain's fallback LCD for account lookups is now `https://thorchain.ibs.team/api`. The previous fallback, `thorchain-api.polkachu.com`, no longer resolves (NXDOMAIN), so when the primary LCD failed, `getCosmosAccountInfo` failed too instead of reading the sequence from a second host. The new host returns the same account data as the primary, and answers an account that has never been used with a 404 that is still recognized as "account not found", so a new address still gets sequence 0.
