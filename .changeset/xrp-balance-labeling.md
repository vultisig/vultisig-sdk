---
'@vultisig/core-chain': minor
'@vultisig/sdk': minor
'@vultisig/cli': minor
---

Label XRP spendable-vs-total balance. `getRippleNativeBalanceDetail` exposes the `{ total, spendable, reserve }` breakdown of a native XRP balance (the existing resolvers keep returning the spendable number, so no consumer changes meaning). SDK `Balance` gains optional `totalAmount`/`reserveAmount` fields, populated for native XRP. The CLI labels the spendable headline and prints the locked reserve for XRP balances; all other chains render unchanged.
