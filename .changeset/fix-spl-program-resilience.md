---
"@vultisig/sdk": patch
---

fix(solana): use Promise.allSettled across the SPL token programs so one program's failure doesn't hide the other's holdings. `getSplAccounts` used Promise.all, so a single token-program RPC failure (e.g. a 520) rejected the whole lookup; it now only throws when both programs fail.
