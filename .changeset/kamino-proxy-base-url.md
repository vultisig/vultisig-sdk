---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

Route the Kamino Earn API through the Vultisig proxy. Upstream answers the CORS preflight with a 404 and returns no `access-control-allow-origin` on the build endpoints, so a browser refuses the POST that deposits and withdrawals depend on — the flows hung on the review screen in any webview. Native clients never saw it, because CORS is enforced by the browser rather than the server.
