---
'@vultisig/rujira': patch
---

Type FIN `CallbackData` as the base64 string the contract's `CallbackData(Binary)` expects. The previous `{ contract, msg }` shape would make FIN reject the message.
