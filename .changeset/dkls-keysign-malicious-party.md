---
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

Throw a typed `DklsMaliciousPartyError` when DKLS keysign reports native or vs-wasm abort-and-ban party codes, and resolve the banned `partyId` from the setup-message party order on the initiating device.
