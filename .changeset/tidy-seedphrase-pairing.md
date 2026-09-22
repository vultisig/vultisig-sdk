---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Carry seedphrase import derivation settings in SDK pairing QR codes and apply them in sequential and batched joins. Reject conflicting settings before joining, and add CLI overrides for legacy pairing payloads.

Keep the import initiator first in MPC committees so multi-device seedphrase imports complete regardless of device ID sort order.
