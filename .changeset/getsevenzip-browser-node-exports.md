---
'@vultisig/core-mpc': patch
---

Split `getSevenZip` into browser and Node builds so browser bundles never pull `node:module`, wire conditional `exports` via `generate-shared-exports`, and improve the browser partner example (StrictMode-safe init, dev QR logging, copyable QR textarea, Vite env types).
