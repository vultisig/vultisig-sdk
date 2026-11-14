---
'@vultisig/cli': patch
---

`send` on a secure vault now renders the keysign QR and reports device joins, matching `sign` (in JSON mode the QR is a `{"qrPayload": ...}` event line before the result). `execute` still prints a bare URL in JSON mode.
