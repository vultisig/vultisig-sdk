---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

fix(ton): do not report a failed jetton balance read as 0

`getJettonBalance` turned two broken reads into a zero balance: a 2xx body with no `jetton_wallets` list (proxy or indexer error body) and a matching wallet with a missing or non-numeric `balance`. Both now throw, so the caller keeps its last known balance instead of showing 0 and computing MAX from it. An owner with no jetton wallet still resolves to 0, because on TON that wallet contract only exists once the owner has received the jetton.
