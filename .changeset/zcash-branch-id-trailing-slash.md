---
"@vultisig/core-chain": patch
"@vultisig/sdk": patch
---

fix(zcash): add trailing slash to branch-id RPC URL

The live ZIP-243 branch-id fetch POSTs to a bare `${rootApiUrl}/zcash`, which the
proxy now 301-redirects to `/zcash/`. Following a 301 downgrades POST→GET, so the
request lands as `GET /zcash/` → HTTP 405, breaking all Zcash signing on the
"Sign Transaction" screen. Add the trailing slash so the POST hits the working
endpoint directly (live-verified 200 with consensus.nextblock).
